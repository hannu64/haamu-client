// Sending and receiving an encrypted message — PROTOCOL.md §6, on top of §5.
//
// `protocol/session.js` holds §6.3's rules, `protocol/envelope.js` §6.4 and §6.5,
// `protocol/payload.js` §6.6 and §6.7, `crypto/olm.js` the library. This file holds
// what none of them can: the ORDER, and what happens when a step fails.
//
//   send:     ensure a session → pad → encrypt → PERSIST → transmit
//   receive:  drain → classify → decrypt → PERSIST → hand over → acknowledge
//
// ⚠️⚠️ THE TWO CAPITALISED WORDS ARE THE WHOLE FILE, AND EACH IS AN ORDER THAT
// CANNOT BE RELAXED.
//
// **Persist before transmit.** `encrypt` advances the sending ratchet. A client
// that transmitted first and crashed before writing would come back holding a
// chain key it has already used, and the next message would be encrypted under a
// message key that is already spent — two plaintexts under one key, which for
// AES-CBC is the plaintexts' XOR, recoverable by anyone holding both ciphertexts.
// The other order merely loses a message that was never sent, and the ratchet
// tolerates the gap by design.
//
// **Persist before acknowledge.** `decrypt` advances the receiving ratchet too, so
// draining is only repeatable up to the point where the plaintext exists. §5.4.1
// separates retrieval from deletion so that "a client which crashes between them
// loses nothing" — true of the message, but a client that crashes after decrypting
// and before acknowledging meets the SAME ciphertext again and can no longer read
// it, and would report to its user that a message arrived which it cannot read.
// A false alarm, manufactured by its own crash, in the one place this protocol
// promises never to lose mail silently. So the decrypted plaintext, the advanced
// ratchet and the ids that are now safe to delete are one write (§5.4.2 → the
// staging list in `storage/sessions.js`), and the acknowledgement follows it.
//
// ⚠️⚠️ BOTH OF THOSE ARE RULES ABOUT ORDER, AND AN ORDER ASSUMES ONE WRITER
// (PROTOCOL 0.8.12, step 9). They were written against a CRASH — this client,
// interrupted between two of its own steps. Step 8 moved the record into IndexedDB,
// which every tab of the origin shares, and a second tab is not an interruption:
// two tabs each load the record, each advance the ratchet, and each store. The
// second store erases the first, and what it erases is the fact that a chain key
// was used. The very next send encrypts under a spent message key — the exact
// catastrophe the first rule exists to prevent, reached by a route the rule does
// not address, in a design that follows it to the letter.
//
// ⭐ WHAT MAKES THE ORDERS SUFFICIENT AGAIN IS THAT THEY WERE ALREADY THE RIGHT
// ORDERS. Because every irreversible act sits after the write, a write that is
// REFUSED is always safe to answer by starting the whole operation over: nothing
// was transmitted, nothing was acknowledged, and the retry reads the state the
// other tab left. So `storage/sessions.js` makes the write conditional and the two
// entry points below simply run again — `attempts()` is that, and it is the whole
// of the fix. `flow/tabs.js` then makes the conflict rare rather than correct;
// these lines are what make it correct, including on browsers that have no locks.

import { b64uEncode } from "../crypto/b64u.js";
import { utf8Bytes, utf8String } from "../crypto/bytes.js";
import * as olm from "../crypto/olm.js";
import * as envelopes from "../protocol/envelope.js";
import * as epochs from "../protocol/epoch.js";
import * as mailboxes from "../protocol/mailbox.js";
import * as payloads from "../protocol/payload.js";
import * as sessionRules from "../protocol/session.js";
import { rootHash } from "../protocol/roster.js";
import * as store from "../storage/sessions.js";
import * as mailboxFlow from "./mailbox.js";

/**
 * Why a message that arrived cannot be shown. Each is a distinct thing to tell a
 * person, which is why they are not one "error".
 *
 *   undecryptable   §5.4.2's case: it failed three drains against a session this
 *                   device has. Almost always honest state loss — it was sent
 *                   before this device was restored
 *   stale_session   §6.3 rule 1: a session older than the highest this device has
 *                   accepted. It can never be read and never becomes readable
 *   replayed        a pre-key message for a session already accepted at this
 *                   generation. Either the server replayed it or it is a duplicate
 *   malformed       not an envelope this version can parse
 *   unsupported     it decrypted perfectly and this build cannot draw it (§6.7):
 *                   an OLDER payload, a NEWER one, or a `kind` from another
 *                   version. NOT a failure — say so differently.
 *                   ⚠️ D-191: THIS LINE SAID "from a newer version" AND SO DID THE
 *                   SENTENCE THE USER READ. `protocol/payload.js` has three routes
 *                   here and only one of them is newer; the reachable one today is
 *                   the OLDEST. A code comment that names one branch of three is
 *                   where the wrong user-facing sentence came from.
 *   tampered        it decrypted perfectly and §6.7.2's copy of the routing fields
 *                   disagrees with the envelope's. Only the server can do that
 */
export const UNDECRYPTABLE = "undecryptable";
export const STALE_SESSION = "stale_session";
export const REPLAYED = "replayed";
export const MALFORMED = "malformed";
export const UNSUPPORTED = "unsupported";
export const TAMPERED = "tampered";

/**
 * Everything the two calls below need.
 *
 * `pickleKey` is a device key (§7.5) and never `R` — see `storage/sessions.js`.
 *
 * `guard(fn)` is the channel's critical section across TABS — `flow/tabs.js`
 * supplies one built on Web Locks, and the default runs `fn` straight. ⚠️ It is an
 * optimisation and not the safety property: what makes concurrent writes safe is
 * that `saveRecord` refuses a stale one. A client with no guard is correct and
 * retries more; a client with a guard and no conditional write is neither.
 *
 * ⚠️⚠️ `generation` AND `onGeneration` ARE THE ROSTER, AND THEY ARE NOT OPTIONAL
 * IN A REAL CLIENT. §6.3 puts the session generation in the roster (§7.3) rather
 * than in device storage, and step 5 found out why by putting it in the wrong
 * place first: with the generation held only in the session store, a device
 * restored from a migration has no memory of it and starts again at 1 — the exact
 * frozen-generation failure §6.3's warning describes, reached from the other
 * direction. On the SECOND migration the peer's rule-3 tie-break then has a
 * coin-flip chance of pointing at a session the restored device cannot read, with
 * the sender shown "Delivered" and no cause displayed to either person.
 *
 * So the caller supplies the channel's generation from durable channel state and
 * takes `onGeneration` as an instruction: **persist this before the message goes
 * out**. §7.3.1 rule 3 merges it by taking the maximum, and §7.3.3 case 3 permits
 * the write. The roster itself is ROADMAP step 7; this is the seam it plugs into.
 */
export function openChannel({
  api,
  backend,
  scope,
  pickleKey,
  channelRoot,
  role,
  generation = 0,
  onGeneration,
  guard = (_channelHash, fn) => fn(),
}) {
  // ⛔ D-171: the stored record's name has to say whose it is, and only a caller knows.
  // `storage/sessions.js` refuses an absent scope; failing HERE instead names the
  // channel that was opened without one, which is the thing a reader needs.
  if (typeof scope !== "string" || scope.length === 0) {
    throw new RangeError("message flow: a channel needs the identity scope its records are named with");
  }
  return { api, backend, scope, pickleKey, channelRoot, role, generation, onGeneration, guard };
}

/** §7.3's 128-bit commitment to the root — the name the guard locks on. */
const channelHash = (channel) => rootHash(channel.channelRoot);

/**
 * How many times an operation restarts after another client wrote first.
 *
 * Each restart means a different tab of this browser touched the same channel in
 * the window between this one's read and its write. Two or three is ordinary when
 * somebody has the same conversation open twice; a run of eight is not contention,
 * it is a tab writing continuously, and stopping is better than looping.
 */
export const MAX_WRITE_ATTEMPTS = 8;

/**
 * Run `fn` again while the store says somebody else wrote first.
 *
 * ⚠️ IT MAY ONLY WRAP AN OPERATION WHOSE EFFECTS ARE ALL LOCAL UNTIL THE WRITE
 * LANDS. That is not a caveat about this helper, it is the reason the two rules in
 * the header are ordered the way they are — and it is why `settle()` is NOT wrapped
 * as a whole: by the time it writes, it has already deleted messages from the
 * server, and running it twice would be running that deletion twice.
 */
async function attempts(what, fn) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!store.isConflict(err) || attempt >= MAX_WRITE_ATTEMPTS) {
        if (store.isConflict(err)) {
          throw new store.RecordConflict(
            `${what}: another tab of this browser wrote to this conversation ${MAX_WRITE_ATTEMPTS} times running`
          );
        }
        throw err;
      }
    }
  }
}

/**
 * Raise the channel's generation and persist it, before anything depends on it.
 *
 * §6.3: "writes it to the roster BEFORE OR WITH the first message on that
 * session". If the write fails, so does the send — a generation that reached the
 * peer but not the roster is the frozen-generation bug with an extra step.
 */
async function raise(channel, generation) {
  if (generation <= channel.generation) return;

  // ⚠️⚠️ THE AWAIT COMES FIRST, AND THE ORDER IS THE WHOLE OF THIS FUNCTION.
  // Assigning before the write meant a FAILED roster write still moved the
  // in-memory floor, so the retry took the early return above, never re-attempted
  // the write, and the message was then persisted and acknowledged with the roster
  // still at the old generation. That is the frozen-generation bug this function's
  // own comment warns about, reached through its recovery path rather than its
  // failure path — the first attempt fails loudly and correctly, and the second one
  // succeeds while being wrong. Found by the 2026-08-24 outside review.
  if (channel.onGeneration) await channel.onGeneration(generation);
  channel.generation = generation;
}

/** The durable floor: what the roster knows, or what this device has seen. */
function withFloor(channel, record) {
  return channel.generation > record.generation ? { ...record, generation: channel.generation } : record;
}

/** §6.4: the envelope as the bytes a mailbox carries. */
const toWire = (envelope) => utf8Bytes(JSON.stringify(envelope));
const fromWire = (bytes) => envelopes.parseEnvelope(JSON.parse(utf8String(bytes)));

// ------------------------------------------------------------------- sending

/**
 * §6.7.1 rule 5 — *"The client MUST stop offering to send in that conversation."*
 *
 * ⛔⛔ NOT A NETWORK FAILURE, AND NOT A REASON TO RETRY. Nothing was encrypted,
 * nothing was persisted and nothing left the device; there is no later moment at
 * which the same call would work, because the ratchet at the other end is gone.
 * It is a refusal, and `attempts` passes it through untouched — the retry loop
 * turns only on `RecordConflict`.
 */
export class ConversationClosed extends Error {
  constructor(message) {
    super(message);
    this.name = "ConversationClosed";
    this.reason = "conversation_closed";
  }
}

/** Is this the send path saying "the other person has left"? */
export function isClosed(err) {
  return err?.reason === "conversation_closed";
}

/**
 * Encrypt `text` and put it in the peer's inbound mailbox for this epoch.
 *
 * Creates the Olm session if there is none — §6.3's "first message, cleared
 * storage, or device migration" — at generation (highest ever accepted) + 1.
 */
export async function send(channel, text, opts = {}) {
  await olm.initOlm();
  // ⭐ THE WHOLE SEND RESTARTS, not the write. A conflict means the record this
  // encryption was derived from is gone, so the ciphertext it produced is derived
  // from a ratchet position that no longer exists — it cannot be re-persisted
  // against the new state, only recomputed from it. Nothing left the device
  // (persist before transmit), so there is nothing to undo.
  return channel.guard(await channelHash(channel), () => attempts("send", () => sendOnce(channel, text, opts)));
}

/**
 * §6.7.1's closing notice — *"I have removed this conversation"* — and the only
 * message this product ever sends without somebody typing it.
 *
 * ⚠️⚠️ THE CALLER MUST AWAIT THIS BEFORE IT STARTS TEARING ANYTHING DOWN. §7.8
 * step 1 stops the things that write and step 2 destroys the key that would
 * encrypt this, so a notice sent "as part of" an ending is a notice that cannot be
 * built. Send, settle, then end.
 *
 * ⚠️ AND THE CALLER MUST NOT LET IT BLOCK THE REMOVAL. The person asked for
 * something to be gone from their device; a network error is not a reason to leave
 * it there. Every caller in `app/app.js` catches and continues, and the copy says
 * the notice was *sent*, never that it arrived.
 */
export async function sendClosing(channel, opts = {}) {
  await olm.initOlm();
  return channel.guard(await channelHash(channel), () =>
    attempts("send", () =>
      // ⚠️ THE ONE EXEMPTION FROM THE CLOSED GUARD BELOW, and it is the product's own
      // bookkeeping rather than a person's message. Ending a conversation whose peer
      // ended theirs first is an ordinary thing to do — B receives A's notice, marks
      // closed, and later removes their own copy — and §6.7.1 rule 1 makes this notice
      // part of that removal. Guarding it would make an ending depend on whether the
      // other end had ended first, which is not a rule anything states.
      sendOnce(channel, null, { ...opts, kind: payloads.KIND_CLOSED, evenIfClosed: true })
    )
  );
}

async function sendOnce(
  channel,
  text,
  { signal, unixSeconds, kind = payloads.KIND_TEXT, evenIfClosed = false } = {}
) {
  // ⛔⛔⛔⛔ §6.7.1 RULE 5 LIVES HERE BECAUSE THIS IS THE ONE PLACE SENDING HAPPENS,
  // AND D-172 IS WHY IT IS NOT LEFT TO THE CALLERS. The rule was obeyed twice by hand:
  // the composer is hidden AND disabled while closed, and `reconnectAutomatically`
  // asks `loadClosed` itself. The second of those was added only after the app had
  // shipped able to send, BY ITSELF, into a mailbox nobody will ever drain again —
  // the exact defect §6.7.1 was written to end. Two correct callers are not a
  // guarantee. They are two copies of one rule, and the next caller inherits neither.
  //
  // ⚠️ IT IS IN `sendOnce` AND NOT IN `send`, so `attempts` re-asks on every retry.
  // A marker the receive path writes while a conflicted send is spinning then stops
  // the next attempt instead of being overtaken by it.
  //
  // ⚠️⚠️ AND THE EXEMPTION IS AN OPT-IN, NOT A TEST ON `kind`. `kind !== KIND_CLOSED`
  // reads identically today and is a discriminator that answers a different question:
  // it exempts every kind that does not exist yet. Default-deny, and `sendClosing`
  // says so out loud.
  //
  // ⭐ NO NEW COPY. If this ever reaches the composer it is a bug in a caller, and the
  // screen behind it is already showing §6.7.1's closing banner; `chat.notSent` plus
  // that banner is the truth. A sentence reachable only through a defect is a sentence
  // nobody can check.
  if (!evenIfClosed && (await store.loadClosed(channel.backend, channel.scope, channel.channelRoot))) {
    throw new ConversationClosed("send: this conversation was ended by the other person");
  }

  const now = unixSeconds ?? epochs.nowSeconds();
  const epoch = await epochs.currentEpoch(channel.channelRoot, now);

  const loaded = await store.loadRecord(channel.backend, channel.scope, channel.channelRoot);
  let record = sessionRules.prune(withFloor(channel, loaded.record), epoch).state;

  const existing = record.sending ? record.sessions[record.sending] : null;
  const sessionId = existing ? sessionRules.idFromKey(record.sending) : envelopes.newSessionId();
  const generation = existing ? existing.generation : sessionRules.nextGeneration(record);
  const k = sessionRules.key(sessionId);

  if (!existing) {
    // ⚠️ §6.3: the generation is written "before or with the first message on that
    // session". Here that is literal — both writes precede the send.
    await raise(channel, generation);
    record = sessionRules.created(record, { sessionId, generation, epoch });
  }

  const session = existing
    ? olm.unpickle(existing.pickle, channel.pickleKey)
    : olm.initiate(channel.channelRoot, sessionId, channel.role);

  let envelope;
  try {
    const payload = payloads.buildPayload({ text, sentAt: now, kind, sessionId, generation });
    const message = session.encrypt(envelopes.pad(payloads.encodePayload(payload)));
    envelope = envelopes.buildEnvelope({ sessionId, generation, type: message.type, body: message.body });
    record = withPickle(record, k, session.pickle(channel.pickleKey));
  } finally {
    session.free();
  }

  // ⚠️ PERSIST BEFORE TRANSMIT — see the header. Never move this below the send.
  // The token is what makes it a persist rather than an overwrite: if another tab
  // advanced this channel while the lines above ran, this throws and `send` starts
  // again, and the envelope built here is discarded unsent.
  await store.saveRecord(channel.backend, channel.scope, channel.channelRoot, record, loaded.token);

  const sent = await mailboxFlow.sendToPeer(channel.api, channel.channelRoot, channel.role, toWire(envelope), {
    signal,
    unixSeconds: now,
  });
  return {
    msgId: sent.msgId,
    expires: sent.expires,
    mailbox: sent.mailbox,
    sessionId: b64uEncode(sessionId),
    generation,
    type: envelope.type,
    sentAt: now,
  };
}

// ----------------------------------------------------------------- receiving

/**
 * Drain this device's inbound mailboxes, decrypt what can be decrypted, and hand
 * the result over with an acknowledgement still pending.
 *
 * Returns `{ messages, settle }`. **Nothing is deleted from the server until
 * `settle()` is called**, and `settle()` is the caller's statement that it has
 * stored what it was given. Until then a repeat call re-delivers the same
 * messages rather than decrypting them again — see the header for why that is not
 * the same thing.
 *
 * ⚠️ DEDUPLICATE ON `msgId`. A crash between the acknowledgement and the clearing
 * of the staging list re-delivers; the alternative order manufactures a false
 * "cannot read this message" for a message the user has already seen, which is
 * worse.
 */
export async function receive(channel, opts = {}) {
  await olm.initOlm();
  // ⚠️ THE GUARD COVERS THE DRAIN AND THE DECRYPTION, AND NOT `settle`. Settling
  // outside it is safe for a reason worth writing down rather than trusting: the
  // other tab, draining the same mailbox in the gap, finds these messages already
  // in the staging list and skips the decryption entirely (§5.4.2). It re-delivers
  // them, which the caller deduplicates on `msg_id`, and its acknowledgement
  // deletes nothing that was not already going. Holding the lock through a
  // caller-supplied `onMessages` would be holding it through arbitrary code.
  return channel.guard(await channelHash(channel), () => receiveOnce(channel, opts));
}

async function receiveOnce(channel, { signal, unixSeconds } = {}) {
  const now = unixSeconds ?? epochs.nowSeconds();
  const epoch = await epochs.currentEpoch(channel.channelRoot, now);

  // ⭐ THE DRAIN IS OUTSIDE THE RETRY AND THE DECRYPTION IS INSIDE IT. Reading a
  // mailbox is idempotent — §5.4.1 deletes nothing until `settle` — so re-fetching
  // on a conflict would only be waste; re-DECRYPTING, on the other hand, is exactly
  // what a conflict calls for, because the other tab may have advanced the ratchet
  // these ciphertexts have to be read against, or read them itself and staged them.
  const drained = await mailboxFlow.drainChannel(channel.api, channel.channelRoot, channel.role, {
    signal,
    unixSeconds: now,
  });
  const seen = new Set(drained.map((m) => m.msgId));

  // ⚠️ REBUILT ON EVERY ATTEMPT, NOT ACCUMULATED ACROSS THEM. `attempts` re-runs the whole
  // decryption on a write conflict, so a list that survived the retry would report the same
  // refusal twice for one drain.
  let refused = [];
  const record = await attempts("receive", async () => {
    refused = [];
    const loaded = await store.loadRecord(channel.backend, channel.scope, channel.channelRoot);
    let next = sessionRules.prune(withFloor(channel, loaded.record), epoch).state;

    const staged = new Set(next.staged.map((s) => s.msgId));
    for (const m of drained) {
      if (staged.has(m.msgId)) continue; // already read, waiting only to be acknowledged
      next = handle(channel, next, m, epoch, now, refused);
    }

    // §5.4.2's counters are only meaningful for messages still queued. Dropping the
    // rest bounds the map; a message the 100-message cap hid from this drain simply
    // starts again, which errs towards keeping it rather than destroying it.
    next.failures = Object.fromEntries(Object.entries(next.failures).filter(([id]) => seen.has(id)));

    // §7.3.1 rule 3 merges the generation by taking the maximum, so a generation
    // accepted from the peer is durable state too — not only one this device chose.
    await raise(channel, next.generation);

    // ⚠️ ONE WRITE: advanced ratchets, plaintexts and the ids now safe to delete.
    await store.saveRecord(channel.backend, channel.scope, channel.channelRoot, next, loaded.token);
    return next;
  });

  const messages = record.staged.map((s) => ({ ...s }));
  // ⚠️ A MESSAGE THAT REACHED `staged` THIS DRAIN IS NOT ALSO 'refused' — it is being
  // delivered for real, and reporting both would draw the line twice.
  const settled = new Set(messages.map((s) => s.msgId));
  return {
    messages,
    refused: refused.filter((r) => !settled.has(r.msgId)),
    settle: (opts = {}) => settle(channel, messages, { signal, ...opts }),
  };
}

/** One drained message, from bytes to either a plaintext or a named refusal. */
function handle(channel, record, m, epoch, now, refused) {
  let envelope;
  try {
    envelope = fromWire(m.body);
  } catch (err) {
    // Nothing of ours can be lost by deleting this: no session anywhere could
    // read it, and a server that can corrupt a message can drop it outright.
    return stage(record, m, epoch, now, { failure: MALFORMED, detail: err.message });
  }

  const decision = sessionRules.classify(envelope, record);

  if (decision.action === sessionRules.WAIT) {
    // ⚠️⚠️ TRANSIENT (§5.4.2). No counter, no acknowledgement: the pre-key message
    // may yet arrive. Counting this is a destruction primitive for a dishonest
    // server — withhold the pre-key, release the rest, and the recipient destroys
    // them itself while the sender is shown "Delivered".
    return record;
  }
  if (decision.action === sessionRules.REFUSE) {
    /*
      D-146. ⚠️⚠️ STAGED AT ONCE, NOT COUNTED TO THREE — PROTOCOL 0.9.19, and the
      sentence it changes is one §5.4.2 wrote about itself.

      §5.4.2's table used to say a session below the highest accepted generation is
      counted, because "it is refused without being tried and can never become
      readable, so the three drains are **a formality that bounds it**." Both halves
      of that are true and the conclusion does not follow: a formality with a
      two-drain latency is not a formality when a NOTICE hangs off it.

      Measured, from Hannu's round-22 report — an old conversation opened on two
      devices that both needed D-130's reconnect:

        drain 1   the stale message is refused, counted to 1, nothing durable
        drain 2   counted to 2 — and his first real message arrives, fine
        drain 3   the count reaches three, the failure is staged, and the red line
                  "A message is lost" appears BELOW the message he had just sent

      ➡️ **He read it as a verdict on his own message. It is about one his friend
      sent days earlier.** An undecryptable message has no readable timestamp, so
      the line can only ever be drawn at "now" — which makes WHEN it is drawn the
      whole of what it appears to be about. Two drains of delay moved it from "when
      you open this old conversation", where the reconnect banner is standing right
      there explaining it, to "just after you pressed send".

      ⚠️ NOTHING IS LOST BY REFUSING ON THE FIRST SIGHT. `classify` returns this only
      when there is no session for the id AND the envelope's generation is below
      this device's; `state.generation` never decreases and the peer re-establishes
      higher rather than resending on a dead session, so the verdict cannot change on
      a later drain. Both reasons here are terminal by `protocol/session.js`'s own
      comments. ⭐ And it bounds the mailbox BETTER than the rule it replaces — one
      fetch of that ciphertext instead of three.

      ⚠️ THE THREE-STRIKE COUNT IS UNTOUCHED FOR `UNDECRYPTABLE`, which is §5.4.2's
      genuine case: a failure AGAINST a session this device holds, where the limit is
      what stops a dishonest server turning withheld pre-keys into a destruction
      primitive. That argument is about messages that might yet become readable, and
      it has never been about these two.
    */
    return stage(record, m, epoch, now, {
      failure: decision.reason === "stale_generation" ? STALE_SESSION : REPLAYED,
      attempts: 1,
    });
  }

  if (decision.action === sessionRules.DECRYPT) {
    const stored = record.sessions[decision.session];
    const session = olm.unpickle(stored.pickle, channel.pickleKey);
    try {
      const padded = session.decrypt({ type: envelope.type, body: envelope.body });
      record = withPickle(record, decision.session, session.pickle(channel.pickleKey));
      // ⚠️ NO `bound` CHECK IS NEEDED HERE and its absence is deliberate: this branch
      // adopts nothing. The session already exists and its generation is this device's
      // own durable record of it, so §6.7.2's verdict has no state to protect — only a
      // sentence to choose, which `result` already carries.
      return stage(record, m, epoch, now, read(padded, envelope).result);
    } catch {
      // A failure against a session this device HAS is §5.4.2's genuine case.
      return count(record, m, epoch, now, UNDECRYPTABLE, refused);
    } finally {
      session.free();
    }
  }

  // ACCEPT — §6.3, and the only place a pre-key message may open a new session.
  let accepted;
  try {
    accepted = olm.accept(
      channel.channelRoot,
      envelope.sessionId,
      { type: envelope.type, body: envelope.body },
      // ⚠️ THIS DEVICE'S PAIRING ROLE, not "the responder" — §6.2 via `crypto/olm.js`.
      // The same value goes to `initiate`, because it is a property of the channel
      // rather than of the direction this particular session happens to run in.
      channel.role
    );
  } catch {
    return count(record, m, epoch, now, UNDECRYPTABLE, refused);
  }
  try {
    /*
      ⚠️⚠️ THE DECRYPTION COMES FIRST AND THE ADOPTION IS CONDITIONAL ON IT — §6.7.2,
      and this ORDER is the whole of the fix the 2026-08-24 outside review asked for.

      This is the only place in the client where a value the server can alter is
      written into durable state, and until today it was written BEFORE the plaintext
      that authenticates it had been looked at. `olm.accept` succeeding proves the
      BODY is genuine and says nothing whatever about `generation`, which is not an
      input to it. So a hostile server could take one real pre-key message, change
      `generation: 1` to `Number.MAX_SAFE_INTEGER`, and this device would decrypt it
      happily and persist the attacker's number — where §7.3.1 rule 3's max-merge
      makes it permanent and `nextGeneration()` can never exceed it. The channel is
      then dead for good, including after the server becomes honest again, and the
      only cure is to pair again.

      ⭐ AND `bound` IS NOT THE SAME QUESTION AS "CAN I SHOW THIS". A payload from a
      newer version is unrenderable and perfectly bound — it may open its session. A
      payload from an OLDER version renders as a version notice and proves nothing
      about its envelope — it may not. Reading one answer off the other is how the
      check would come back on the day a `kind` is added.
    */
    const { bound, result } = read(accepted.plaintext, envelope);
    if (!bound) return stage(record, m, epoch, now, result);

    record = sessionRules.accepted(record, {
      sessionId: envelope.sessionId,
      generation: envelope.generation,
    });
    record = sessionRules.adopt(record, {
      sessionId: envelope.sessionId,
      generation: envelope.generation,
      epoch,
    });
    const k = sessionRules.key(envelope.sessionId);
    record = withPickle(record, k, accepted.session.pickle(channel.pickleKey));
    return stage(record, m, epoch, now, result);
  } finally {
    accepted.session.free();
  }
}

/**
 * Store a session's pickle.
 *
 * ⚠️ EVERY `encrypt` AND EVERY `decrypt` MOVES THE RATCHET, so every one of them
 * ends here. A stored pickle that is one operation behind the session that
 * produced it is not a stale cache: it is a device that will re-use a message key
 * or fail to decrypt, and it says nothing at the time.
 */
function withPickle(record, k, pickle) {
  return { ...record, sessions: { ...record.sessions, [k]: { ...record.sessions[k], pickle } } };
}

/**
 * Padded bytes → §6.7's payload, or a named refusal that is not a failure.
 *
 * ⚠️⚠️ IT RETURNS TWO THINGS AND THE SECOND ONE IS NOT FOR THE SCREEN. `result` is
 * what the person is shown; `bound` is whether §6.7.2's comparison actually ran and
 * agreed, which is the caller's permission to write anything derived from this
 * envelope's `generation` into durable state. They are separate because they answer
 * to different sections and disagree in both directions: a payload from a newer
 * version cannot be RENDERED and is perfectly bound, and a payload from an older one
 * renders as a version notice while proving nothing about the envelope it rode in.
 *
 * ⚠️ `bound` IS DELIBERATELY NOT PART OF `result`. `stage()` spreads the result into
 * the staging list, and this is a decision taken once at the moment of decryption —
 * not a fact about the message worth carrying to storage, where a later reader could
 * mistake a stale copy of it for a fresh check.
 */
function read(padded, envelope) {
  let payload;
  try {
    // ⚠️ §6.5: bounds-check `true_length` before using it — `unpad` does, and the
    // field is peer-controlled.
    //
    // ⚠️⚠️ §6.7.2: THE ENVELOPE GOES IN. `decodePayload` has no default for it, so
    // the comparison cannot be skipped by a caller that forgets it exists — which
    // is what the signature it replaced allowed, and what the bug was.
    payload = payloads.decodePayload(envelopes.unpad(padded), {
      sessionId: envelope.sessionId,
      generation: envelope.generation,
    });
  } catch (err) {
    return { bound: false, result: { failure: MALFORMED, detail: err.message } };
  }
  if (payload instanceof payloads.MisboundPayload) {
    // The ratchet worked and the two copies disagree, so the envelope was rewritten
    // between the sender and here. Nothing but the server is in that position.
    return {
      bound: false,
      result: {
        failure: TAMPERED,
        detail: `${payload.field}: envelope ${payload.claimed}, message ${payload.sealed}`,
      },
    };
  }
  if (payload instanceof payloads.UnsupportedPayload) {
    return {
      bound: payload.bound,
      result: { failure: UNSUPPORTED, detail: `${payload.unsupported}: ${payload.detail}` },
    };
  }
  return {
    bound: true,
    result: { payload, sessionId: b64uEncode(envelope.sessionId), generation: envelope.generation },
  };
}

/**
 * §5.4.2: "After n failed attempts on the same msg_id (recommended: 3, across
 * separate drains), acknowledge it anyway and surface a distinct local state."
 *
 * ⚠️⚠️ THAT SENTENCE BINDS TWO THINGS AND ONLY ONE OF THEM NEEDS THE COUNT. The count
 * exists so that a message is not ACKNOWLEDGED — which deletes it — before it has had
 * its chances; §5.4.2's own table says of this refusal class that it *"can never become
 * readable, so the three drains are a formality that bounds it"*. Nothing there asks the
 * client to stay SILENT meanwhile, and staying silent is what Hannu met: the red line
 * trailed his own repair by three deliveries, because a drain happens per delivery and
 * he had to generate them himself.
 *
 * So the refusal is reported on the FIRST drain and acknowledged on the third. `refused`
 * carries the early report; `staged` is untouched, and with it every rule about what may
 * be deleted and when. ⭐ The reported line is drawn and not stored — `renderLog` rebuilds
 * from the store, so the provisional line is replaced by the real one the moment there
 * is a real one, and a reload shows nothing until the next drain says so again.
 */
function count(record, m, epoch, now, failure, refused) {
  const n = (record.failures[m.msgId] ?? 0) + 1;
  if (n < store.MAX_DECRYPT_FAILURES) {
    record.failures = { ...record.failures, [m.msgId]: n };
    refused?.push({ msgId: m.msgId, epoch, firstSeen: now, failure, attempts: n });
    return record;
  }
  const { [m.msgId]: _spent, ...rest } = record.failures;
  record.failures = rest;
  return stage(record, m, epoch, now, { failure, attempts: n });
}

/** Add to the staging list — the thing that is written before anything is acked. */
function stage(record, m, epoch, now, result) {
  const { [m.msgId]: _done, ...failures } = record.failures;
  return {
    ...record,
    failures,
    staged: [...record.staged, { msgId: m.msgId, epoch, firstSeen: now, ...result }],
  };
}

/**
 * Acknowledge, then forget. §5.4.1's ids are explicit and never a high-water mark,
 * and they are addressed to the mailbox they came from — which is why the epoch is
 * staged alongside the id: after a reload there is no drained message to ask.
 */
async function settle(channel, messages, { signal } = {}) {
  const byEpoch = new Map();
  for (const m of messages) {
    if (!byEpoch.has(m.epoch)) byEpoch.set(m.epoch, []);
    byEpoch.get(m.epoch).push(m.msgId);
  }

  let deleted = 0;
  const direction = mailboxes.inboundDirection(channel.role);
  for (const [epoch, ids] of byEpoch) {
    const mailbox = await mailboxes.deriveMailbox(channel.channelRoot, epoch, direction);
    deleted += await mailboxFlow.ack(channel.api, mailbox, ids, { signal });
  }

  // Only now. A crash before this line re-delivers (dedupe on `msgId`); a crash
  // after a clear-first would have left a read message on the server that this
  // device can no longer decrypt.
  //
  // ⚠️ ONLY THIS PART RETRIES, and the deletions above deliberately sit outside it.
  // Re-running `settle` whole would re-issue an acknowledgement that has already
  // been honoured; re-running the bookkeeping is free, because striking ids off a
  // list is the same operation however many times another tab has done it too.
  const settled = new Set(messages.map((m) => m.msgId));
  await attempts("settle", async () => {
    const loaded = await store.loadRecord(channel.backend, channel.scope, channel.channelRoot);
    const record = { ...loaded.record, staged: loaded.record.staged.filter((s) => !settled.has(s.msgId)) };
    await store.saveRecord(channel.backend, channel.scope, channel.channelRoot, record, loaded.token);
  });

  return { deleted };
}
