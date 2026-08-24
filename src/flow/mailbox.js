// Mailboxes against the live server — PROTOCOL.md §5, protocol version 0.8.7.
//
// `src/protocol/mailbox.js` derives the identifiers and `src/protocol/signing.js`
// builds the credential; both are pure and both are anchored to frozen vectors.
// This file holds what those two cannot: the ORDER of the calls, and which mailbox
// each one is addressed to.
//
//   §5.1    POST /api/mailbox/{id}/register    [PoW when it does not exist]
//   §5.5    POST /api/mailbox/{id}/send        → { msg_id, expires }
//   §5.4.1  GET  /api/mailbox/{id}/messages    → up to 100, oldest first
//   §5.4.1  POST /api/mailbox/{id}/ack         explicit ids, never a high-water mark
//   §5.5    POST /api/mailbox/{id}/status      queued | gone
//
// ⚠️ A CHANNEL HAS TWO MAILBOXES PER EPOCH AND THEY ARE NOT INTERCHANGEABLE
// (§4.2). This device WRITES to the peer's inbound mailbox and READS from its own,
// and `send`/`status` therefore address a different identifier from
// `messages`/`ack`. With a single shared mailbox — which v0.1 specified — a sender
// drains its own ciphertext and then either acknowledges it, destroying the message
// before the recipient ever sees it, or fails to decrypt it forever.
//
// ⚠️ THE THREE-EPOCH POLL IS NOT BELT AND BRACES (§4.1). A client polls `e-1`, `e`
// and `e+1`, and `e+1` normally does not exist yet: registering it in order to poll
// it would start the server's `created_at + 2 × EPOCH_SECONDS` clock two epochs
// early, so a message sent late in `e+1` would expire seconds after it arrived,
// against a promise of "at least 7 days". Polling an absent mailbox returns empty
// and creates nothing — which is why §5.2's credential has to carry the public key
// (0.8.7): the server has no stored key for a mailbox nobody registered.

import { b64uDecode, b64uEncode } from "../crypto/b64u.js";
import * as epochs from "../protocol/epoch.js";
import * as mailboxes from "../protocol/mailbox.js";
import * as signing from "../protocol/signing.js";
import * as pow from "../protocol/pow.js";

/**
 * A mailbox operation that did not complete, with a machine-readable reason.
 *
 *   clock_skew    §5.2: this device's clock is more than 60 seconds out, so EVERY
 *                 signed request 401s. The one failure the user must be told about
 *                 in plain words, because nothing else in the product would say why
 *   unauthorized  a 401 the clock does not explain: a client bug, or a server that
 *                 is not the one this key belongs to
 *   not_found     the mailbox is gone. For a send, register first; for a status
 *                 query, the mailbox expired and took its messages with it
 *   mailbox_full  §5.4: 200 messages or 20 MB queued. The recipient has been
 *                 offline a long time
 *   storage_full  §9.3: the server is at its global ceiling and refuses new
 *                 writes. It deletes nothing to make room, and it recovers on its
 *                 own as retention expires
 *   rate_limited  §9.2's per-mailbox limit
 *   unavailable   the server is degraded — a saturated replay set, most likely
 *   key_mismatch  §5.1: this identifier is registered under another key. Reaching
 *                 this needs a 128-bit second preimage, so in practice it means a
 *                 server that is not answering honestly
 *   server_state  anything else the server refused
 */
export class MailboxFailure extends Error {
  constructor(reason, message, cause, skew) {
    super(message);
    this.name = "MailboxFailure";
    this.reason = reason;
    this.cause = cause;
    // ⚠️⚠️ D-152 — §5.2's OFFSET IS A NUMBER HERE AND A SENTENCE IN `ui/copy.js`.
    // This used to build the English itself, and `flow/mailbox.js` built the same
    // English again, byte for byte — the only prose in the product outside the copy
    // gate, in two copies. `skew` is the measured offset in seconds and nothing else.
    if (skew !== undefined) this.skew = skew;
  }
}

/** §5.4.1 and §5.5 both cap an id list at 100. */
export const MAX_IDS = 100;

/**
 * Turn a server refusal into a reason.
 *
 * ⚠️ THE 401 BRANCH IS THE IMPORTANT ONE. §5.2 makes a wrong device clock a total
 * and unexplained failure, and D-016 identifies exactly that shape — everything
 * broken, nothing saying why — as the one most likely to send somebody back to an
 * insecure channel. The `Date` header is on every response, so the diagnosis is
 * free and must not be skipped.
 */
export function describeFailure(err, localSeconds = epochs.nowSeconds()) {
  if (err instanceof MailboxFailure) return err;
  if (err?.name !== "ApiError") return err;

  if (err.status === 401) {
    const skew = signing.clockSkewFromDate(err.date, localSeconds);
    if (skew !== null && Math.abs(skew) > signing.MAX_CLOCK_SKEW_SECONDS) {
      // ⚠️ D-152 — see `flow/roster.js`. This built the identical sentence, and the
      // two copies were free to drift. The number travels; the words do not.
      return new MailboxFailure("clock_skew", `clock skew ${skew}s`, err, skew);
    }
    return new MailboxFailure("unauthorized", "the server refused this device's signature", err);
  }
  if (err.status === 404) return new MailboxFailure("not_found", "no such mailbox", err);
  if (err.status === 409) return new MailboxFailure("key_mismatch", "this mailbox is registered under another key", err);
  if (err.status === 429) return new MailboxFailure("rate_limited", "too many requests for this mailbox", err);
  if (err.status === 503) return new MailboxFailure("unavailable", "the server is refusing signed requests", err);
  if (err.code === "mailbox_full") {
    return new MailboxFailure("mailbox_full", "the recipient's mailbox is full — they may have been offline for a long time", err);
  }
  if (err.code === "storage_full") {
    return new MailboxFailure("storage_full", "the server is out of space and is not accepting new messages", err);
  }
  return new MailboxFailure("server_state", `server refused: ${err.code}`, err);
}

const pathFor = (mailbox, verb) => `/api/mailbox/${b64uEncode(mailbox.mailboxId)}/${verb}`;

/**
 * One signed call (§5.2).
 *
 * ⚠️ THE BODY IS SERIALISED ONCE. The bytes hashed into the signature are the
 * bytes transmitted — see `net/api.js`. Signing an object and letting `fetch`
 * serialise it again would work until the day the two serialisations differ.
 */
async function call(api, mailbox, method, verb, value, { signal } = {}) {
  const path = pathFor(mailbox, verb);
  const bodyBytes = value === undefined ? undefined : signing.encodeBody(value);
  const { authorization } = await signing.signRequest(mailbox.privateKey, {
    tag: signing.TAG_MAILBOX,
    method,
    path,
    id: mailbox.mailboxId,
    timestamp: epochs.nowSeconds(),
    nonce: signing.newNonce(),
    body: bodyBytes,
    publicKey: mailbox.publicKey,
  });
  try {
    return await api.signed(method, path, { bodyBytes, authorization, signal });
  } catch (err) {
    throw describeFailure(err);
  }
}

/**
 * §5.1's registration, with §9.1's proof-of-work supplied only if it is asked for.
 *
 * ⚠️ THE TWO ROUND TRIPS ARE THE POINT, not an inefficiency to optimise away. §5.1
 * requires the server to demand proof-of-work only when the row is absent, and the
 * client cannot know which case it is in — that is the whole of the ordering
 * argument, since knowing would be the existence oracle §5.1 closes. So: ask, and
 * if the answer is `pow_required`, spend the work and ask again. The second trip
 * happens once per mailbox per epoch and never again.
 *
 * ⚠️ REGISTER ONLY WHAT YOU ARE ABOUT TO SEND TO (§5.1.1). Registration is a step
 * of sending, never of polling: it starts the server's expiry clock, and starting
 * it two epochs early is what would make §5.4's "at least 7 days" false. The server
 * cannot enforce this — it cannot compute `e` — so it lives here.
 */
export async function register(api, mailbox, { signal } = {}) {
  try {
    const res = await call(api, mailbox, "POST", "register", {}, { signal });
    return { expires: res.expires, created: false };
  } catch (err) {
    if (err?.cause?.code !== "pow_required") throw err;
  }
  // `created` is worth returning: being the one who had to create the peer's
  // inbound mailbox says the peer has not written in this epoch. It is this
  // device's own observation, not something the server volunteered.
  const challenge = await api.powChallenge({ signal });
  const solution = await pow.solve(challenge.challenge, challenge.bits, { signal });
  const res = await call(api, mailbox, "POST", "register", { pow: solution }, { signal });
  return { expires: res.expires, created: true };
}

/**
 * §5.5's send. `payload` is the opaque envelope of §6.4 — this layer does not
 * build it, read it, or care what is in it.
 *
 * Returns `{ msgId, expires }`. ⚠️ KEEP `expires`: §5.5's third display state,
 * "Expired, never delivered", is computed on this device's own clock from that
 * value, and the client MUST NOT ask the server once `now >= expires`. By then the
 * mailbox is gone, and a server answering about a mailbox it no longer has could
 * only say "gone", which renders as **Delivered** — the precise lie §5.5 exists to
 * prevent.
 */
export async function send(api, mailbox, payload, { signal } = {}) {
  const res = await call(api, mailbox, "POST", "send", { body: b64uEncode(payload) }, { signal });
  return { msgId: res.msg_id, expires: res.expires };
}

/**
 * §5.4.1's drain of ONE mailbox: up to 100, oldest first, and it deletes nothing.
 *
 * ⚠️ THERE IS NO CURSOR, so "the client repeats until the queue is empty" means
 * "acknowledge, then repeat" — a second call with nothing acknowledged returns the
 * same messages. That is a consequence of §5.4.1's design and not an oversight:
 * retrieval and deletion are separate steps precisely so that a client which
 * crashes between them loses nothing.
 *
 * A message that cannot be decrypted is left unacknowledged (§5.4.2) and comes back
 * on the next drain, which is what allows the retry that section asks for. Progress
 * past position 100 still happens, because its neighbours are acknowledged and it
 * moves to the front — and §5.4.2 forces an acknowledgement after three failures
 * against an established session, so it cannot accumulate.
 */
export async function drain(api, mailbox, { signal } = {}) {
  const res = await call(api, mailbox, "GET", "messages", undefined, { signal });
  return (res?.messages ?? []).map((m) => ({
    mailbox,
    msgId: m.msg_id,
    body: b64uDecode(m.body, "message body"),
  }));
}

/**
 * §5.4.1's acknowledgement: delete by explicit ids.
 *
 * ⚠️ NEVER A HIGH-WATER MARK, and §5.4.1 is emphatic about why: a high-water mark
 * acknowledges an undecryptable message along with its neighbours, and §5.4.2 needs
 * that one message left in place. There is deliberately no range form of this call.
 */
export async function ack(api, mailbox, msgIds, { signal } = {}) {
  let deleted = 0;
  for (const chunk of chunked(msgIds, MAX_IDS)) {
    const res = await call(api, mailbox, "POST", "ack", { ids: chunk }, { signal });
    deleted += res?.deleted ?? 0;
  }
  return deleted;
}

/**
 * §5.5's delivery state, asked on the mailbox this device WRITES to.
 *
 * The caller filters out anything whose `expires` has passed before calling — see
 * `send`. This is a hint and not a guarantee: a dishonest server can claim delivery
 * for a message it kept, or claim a delivered message is still waiting. It is in
 * the same class as the pairing tripwire (§3.5).
 */
export async function statusOf(api, mailbox, msgIds, { signal } = {}) {
  const out = {};
  for (const chunk of chunked(msgIds, MAX_IDS)) {
    Object.assign(out, await call(api, mailbox, "POST", "status", { ids: chunk }, { signal }));
  }
  return out;
}

/**
 * §5.3's mint: exchange a signed request for a short-lived opaque token.
 *
 * ⚠️ THE TOKEN IS SINGLE-USE AND LIVES 30 SECONDS. Mint it immediately before
 * opening the stream and never cache it: a token held for later is a bearer
 * credential waiting to be stale, and re-minting costs one signed request.
 *
 * ⚠️ ITS RATE LIMIT IS NOT THE ONE THE OTHER FIVE CALLS SHARE. §9.2 names this
 * endpoint as the reason a per-`mailbox_id` limit exists at all, and the server
 * gives it a much tighter bucket — so a `rate_limited` here says nothing about
 * whether messages can still be sent, and the caller must fall back to polling
 * rather than concluding the channel is down.
 */
export async function streamToken(api, mailbox, { signal } = {}) {
  const res = await call(api, mailbox, "POST", "stream-token", {}, { signal });
  return { token: res.token, ttl: res.ttl };
}

// ------------------------------------------------------------- whole channel

/**
 * The mailbox this device writes to, for the epoch that is current on its clock.
 */
export async function outboundNow(channelRoot, role, unixSeconds = epochs.nowSeconds()) {
  const e = await epochs.currentEpoch(channelRoot, unixSeconds);
  return mailboxes.deriveMailbox(channelRoot, e, mailboxes.outboundDirection(role));
}

/**
 * The mailbox this device READS from, for the epoch that is current on its clock —
 * the one §5.3's stream is opened on.
 */
export async function inboundNow(channelRoot, role, unixSeconds = epochs.nowSeconds()) {
  const e = await epochs.currentEpoch(channelRoot, unixSeconds);
  return mailboxes.deriveMailbox(channelRoot, e, mailboxes.inboundDirection(role));
}

/**
 * Drain all three of §4.1's epochs and return everything found, oldest epoch
 * first. Each message carries the mailbox it came from, because acknowledging it
 * has to be addressed to that same mailbox and not to the current one.
 */
export async function drainChannel(api, channelRoot, role, { signal, unixSeconds } = {}) {
  const now = unixSeconds ?? epochs.nowSeconds();
  const e = await epochs.currentEpoch(channelRoot, now);
  const dir = mailboxes.inboundDirection(role);

  const out = [];
  for (const candidate of epochs.pollEpochs(e)) {
    const mailbox = await mailboxes.deriveMailbox(channelRoot, candidate, dir);
    out.push(...(await drain(api, mailbox, { signal })));
  }
  return out;
}

/**
 * Register the outbound mailbox if necessary and send. This is the whole of "put a
 * message in front of the other person" at this layer.
 */
export async function sendToPeer(api, channelRoot, role, payload, { signal, unixSeconds } = {}) {
  const mailbox = await outboundNow(channelRoot, role, unixSeconds);
  try {
    return { mailbox, ...(await send(api, mailbox, payload, { signal })) };
  } catch (err) {
    if (err?.reason !== "not_found") throw err;
  }
  // §5.1.1: "a sender must be able to create the peer's inbound mailbox, or it
  // could not write to a peer who has been offline since the epoch turned."
  await register(api, mailbox, { signal });
  return { mailbox, ...(await send(api, mailbox, payload, { signal })) };
}

function* chunked(items, size) {
  for (let i = 0; i < items.length; i += size) yield items.slice(i, i + size);
}
