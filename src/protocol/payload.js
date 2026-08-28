// PROTOCOL.md §6.7 (the message payload), §6.7.2 (the binding) and §6.6 (message TTL).
//
// This is the object that gets padded by §6.5 and encrypted by §6.2 — the
// innermost layer, the only one the server never sees in any form.
//
// ⚠️ §6.7 EXISTS BECAUSE STEP 5 WENT LOOKING FOR IT AND IT WAS NOT THERE. §6.6
// required a `sent_at` "inside the encrypted payload" and made it the value the
// interface displays, §6.5 padded "the plaintext" to a bucket, and no section ever
// said what that plaintext was. A field was specified without the object it lives
// in: one implementer sends bare UTF-8 text and has nowhere to put `sent_at`,
// another sends JSON, and the two never interoperate — while each is faithful to
// every sentence that existed.
//
// ⚠️⚠️ AND §6.7.2 EXISTS BECAUSE THE 2026-08-24 OUTSIDE REVIEW WENT LOOKING FOR
// THE OTHER HALF OF §6.4'S OWN WARNING AND IT WAS NOT THERE EITHER. §6.4 said
// every field outside `body` is unauthenticated and that an implementer "must not
// treat `session_id` or `generation` as trustworthy input to a state lookup" — and
// then §6.3 required the receiver to WRITE the envelope's `generation` into
// durable channel state on accepting a pre-key message. Both sentences were
// obeyed exactly, and between them a hostile server could set `generation` to
// `Number.MAX_SAFE_INTEGER` on one genuine message and permanently end the
// channel: the value survives §7.3.1 rule 3's max-merge, and `nextGeneration()`
// can never exceed it again, so no later session can be established even after the
// server becomes honest.
//
// ➡️ **A FIELD THE SERVER CAN ALTER AND THE CLIENT MUST PERSIST HAS TO BE INSIDE
// THE CIPHERTEXT.** Capping the value bounds the damage; it does not authenticate
// anything. So the payload carries its own copy of both routing fields, the
// receiver compares them after decryption, and a disagreement means the server
// touched the envelope.

import { b64uDecodeExact, b64uEncode } from "../crypto/b64u.js";
import { utf8Bytes, utf8String } from "../crypto/bytes.js";
import { MAX_PLAINTEXT, SESSION_ID_BYTES } from "./envelope.js";

/**
 * §6.7. Distinct from the envelope's `v`, which versions the wire format.
 *
 * ⚠️ 1 → 2 on 2026-08-24 (PROTOCOL 0.9.21), for §6.7.2's binding. The envelope's
 * `v` STAYS AT 1 and the server parses exactly what it parsed before: this is a
 * change to a structure no server can see, which is the case §6.7 explicitly
 * reserved this version number for.
 */
export const PAYLOAD_V = 2;

/**
 * The first payload version that carries §6.7.2's binding.
 *
 * ⚠️⚠️ IT IS A SEPARATE CONSTANT FROM `PAYLOAD_V` ON PURPOSE, AND THE REASON IS
 * FORWARD COMPATIBILITY THAT DOES NOT COST THE SECURITY PROPERTY. §6.7 rule 3
 * requires an unrecognised `v` to be shown as "a message from a newer version"
 * rather than as damage — so a v3 payload from a future build must still reach
 * that branch. But a v3 payload also opens a session, and opening a session writes
 * a generation. If the binding could only be read from a version this build
 * understands in full, every future version would silently become unauthenticated
 * again. So §6.7.2 fixes the two fields at the FRAME level: every version from
 * this one onward carries them under these exact names, they are verified BEFORE
 * `v` is judged renderable, and a build that cannot render a payload can still
 * prove nobody rewrote its envelope.
 */
export const BINDING_FROM_V = 2;

/** A message somebody typed. Blobs (§8) are Phase 2 and add a third. */
export const KIND_TEXT = "text";

/**
 * §6.7.1 — the notice the product sends by itself.
 *
 * ⚠️ IT IS NOT THE ONLY MESSAGE THE PRODUCT SENDS BY ITSELF, AND THIS LINE SAID IT WAS
 * UNTIL D-172. §6.3.1's reconnect send is a second one — an ORDINARY message, not a
 * `kind`, which is why nothing here ever contradicted it. A claim about the whole
 * product, made from inside the file about one payload kind, is a claim nobody re-reads
 * when the product changes elsewhere.
 *
 * ⚠️⚠️ IT CARRIES NO `text`, AND THAT IS THE RULE RATHER THAN AN ECONOMY. The
 * sender is destroying their own ability to receive an answer in the same act, so
 * a free-text field here is a one-way channel for a parting shot — and an
 * arbitrary string that the receiving client will render. **The sender decides to
 * close; they do not choose the words.**
 */
export const KIND_CLOSED = "closed";

/** §6.6: the receiver deletes 24 hours after FIRST RECEIPT, never after `sent_at`. */
export const TTL_SECONDS = 86400;

/**
 * A payload that decoded but that this build cannot render — a newer `v`, or a
 * `kind` from a later version. It is NOT a decryption failure: the message
 * arrived intact, so §5.4.2's retry counter must not see it and the server's copy
 * must be acknowledged like any other.
 *
 * ⚠️ `bound` IS NOT DECORATION AND THE CALLER MUST READ IT. It says whether
 * §6.7.2's comparison actually ran — false only for a payload older than
 * `BINDING_FROM_V`, which has no copy of the routing fields to compare. Such a
 * message may be shown; the envelope it arrived in may NOT be trusted, so nothing
 * derived from its `generation` may reach durable state. See `flow/message.js`.
 */
export class UnsupportedPayload {
  constructor(reason, detail, bound) {
    this.unsupported = reason;
    this.detail = detail;
    this.bound = bound;
  }
}

/**
 * §6.7.2's comparison failed: the plaintext's copy of a routing field is not the
 * one the envelope carried.
 *
 * ⚠️ THIS IS NOT A DECRYPTION FAILURE AND MUST NOT BE COUNTED AS ONE. The ratchet
 * worked perfectly — that is precisely how the disagreement became visible. It
 * means the envelope was rewritten in transit, which only the server can do, and
 * §5.4.2's three-strike counter is about messages that might yet become readable.
 * This one never will and never should be.
 */
export class MisboundPayload {
  constructor(field, claimed, sealed) {
    this.field = field;
    this.claimed = claimed;
    this.sealed = sealed;
  }
}

/** §6.6: `first_seen + 24 h`, on the receiver's clock. */
export function expiresAt(firstSeen) {
  return firstSeen + TTL_SECONDS;
}

/** §6.7.2's two fields, validated as the sender's own values before they are sealed. */
function binding({ sessionId, generation }) {
  if (!(sessionId instanceof Uint8Array) || sessionId.length !== SESSION_ID_BYTES) {
    throw new RangeError("payload: session_id must be 16 bytes");
  }
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw new RangeError(`payload: generation must be a non-negative integer, got ${generation}`);
  }
  return { session_id: b64uEncode(sessionId), generation };
}

/**
 * Build the payload object. `sentAt` is the sender's own clock.
 *
 * ⚠️ `sent_at` IS DISPLAY ONLY, and §6.6 is explicit that it is not the input to
 * the deletion timer. It is authentic — it comes through the ratchet, so no third
 * party wrote it — but it is the *peer's* clock: a wrong one, or a hostile one,
 * puts a message in the wrong place in a history sorted by it. Sort by arrival.
 *
 * ⚠️⚠️ `sessionId` AND `generation` ARE REQUIRED, AND THEY ARE THE SAME VALUES
 * THE ENVELOPE WILL CARRY (§6.7.2). They are not optional arguments with a
 * default, because a default is how a field that must be present becomes a field
 * that is usually present: the sender knows both before it encrypts anything, and
 * a caller that has to pass them cannot forget to.
 */
export function buildPayload({ text, sentAt, kind = KIND_TEXT, sessionId, generation }) {
  if (!Number.isSafeInteger(sentAt) || sentAt < 0) {
    throw new RangeError(`payload: sent_at must be a non-negative integer, got ${sentAt}`);
  }
  const bound = binding({ sessionId, generation });
  // §6.7.1: no `text` key at all, rather than an empty one. A key that is present
  // and empty is a key a later version can be tempted to fill.
  if (kind === KIND_CLOSED) return { v: PAYLOAD_V, kind, sent_at: sentAt, ...bound };
  if (typeof text !== "string") throw new TypeError("payload: text must be a string");
  return { v: PAYLOAD_V, kind, sent_at: sentAt, ...bound, text };
}

/** §6.7.1's closing notice, which is the whole of what this client ever sends alone. */
export function buildClosing({ sentAt, sessionId, generation }) {
  return buildPayload({ sentAt, kind: KIND_CLOSED, sessionId, generation });
}

/**
 * Encode for §6.5's padding: UTF-8 JSON.
 *
 * The limit it enforces is §6.5's, measured on the ENCODED payload rather than on
 * the user's text: JSON escaping makes the two differ by a factor of six in the
 * worst case (a message of nothing but quotation marks), so a limit applied to the
 * text would be a limit that is sometimes wrong.
 */
export function encodePayload(payload) {
  const bytes = utf8Bytes(JSON.stringify(payload));
  if (bytes.length > MAX_PLAINTEXT) {
    throw new RangeError(
      `payload: ${bytes.length} encoded bytes exceeds ${MAX_PLAINTEXT}; §6.5 requires a file blob (§8) above that`
    );
  }
  return bytes;
}

/**
 * Whether a message of this text would fit, for an interface that must say so.
 *
 * ⚠️ IT MEASURES AGAINST THE LARGEST BINDING §6.7.2 CAN PRODUCE, not against the
 * caller's real one. `session_id` is a fixed 22 characters, but `generation` is a
 * decimal number whose length grows, and a `fits` that answered for generation 1
 * would be answering a question the sender is not asking by the time it matters.
 * Pessimistic by at most fifteen characters at the very top of the 64 KiB range;
 * the other direction returns `true` and then throws.
 */
export function fits(text, sentAt = 0) {
  try {
    encodePayload(
      buildPayload({
        text,
        sentAt,
        sessionId: new Uint8Array(SESSION_ID_BYTES),
        generation: Number.MAX_SAFE_INTEGER,
      })
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Decode a payload that came off the ratchet, and check §6.7.2's binding against
 * the envelope it arrived in.
 *
 * ⚠️ EVERY FIELD HERE IS PEER-CONTROLLED. Authenticated is not the same as
 * trustworthy: the ratchet proves the bytes came from the other party to this
 * channel and nothing about what they contain. A malicious peer is in scope
 * (§11), so shape is checked before anything is read.
 *
 * ⚠️⚠️ `claimed` IS A REQUIRED ARGUMENT AND THERE IS NO DEFAULT. The comparison it
 * enables is the whole of §6.7.2, and an optional argument is an invitation to
 * call this the way the old signature allowed — which would compile, pass, and
 * silently restore the bug. `flow/message.js` is the only caller and it has the
 * envelope in its hand.
 *
 * Returns, rather than throwing, for the two cases the caller has to treat
 * differently from a fault:
 *
 *   `UnsupportedPayload`  it decrypted perfectly and this build cannot render it
 *   `MisboundPayload`     it decrypted perfectly and the envelope was rewritten
 *
 * A genuinely malformed payload throws, and that is a third thing again.
 */
export function decodePayload(bytes, claimed) {
  if (claimed === null || typeof claimed !== "object") {
    throw new TypeError("payload: decodePayload needs the envelope's session_id and generation (§6.7.2)");
  }
  const expected = binding(claimed);

  let obj;
  try {
    obj = JSON.parse(utf8String(bytes));
  } catch (err) {
    throw new TypeError(`payload: not JSON (${err.message})`);
  }
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    throw new TypeError("payload: expected an object");
  }
  if (!Number.isSafeInteger(obj.v) || obj.v < 1) throw new RangeError(`payload: bad v ${obj.v}`);

  /*
    ⚠️⚠️ THE ORDER OF THE NEXT THREE BLOCKS IS THE SECURITY PROPERTY, and reading
    them in any other order gives a build that passes every test and authenticates
    nothing.

      1. too old to carry a binding  →  unsupported, and `bound: false`
      2. the binding, for EVERY version from `BINDING_FROM_V` up
      3. only now, whether this build can render what is inside

    Putting 3 before 2 is the natural way to write it — check the version you
    support, then read the fields you know — and it is exactly wrong: a v3 payload
    would return at 3 with its binding never compared, and a future version would
    inherit the vulnerability this section was added to close.
  */
  if (obj.v < BINDING_FROM_V) return new UnsupportedPayload("version", obj.v, false);

  let sealedId;
  try {
    sealedId = b64uDecodeExact(obj.session_id, SESSION_ID_BYTES, "payload session_id");
  } catch (err) {
    throw new RangeError(`payload: §6.7.2 session_id is unreadable (${err.message})`);
  }
  const sealed = binding({ sessionId: sealedId, generation: obj.generation });

  if (sealed.session_id !== expected.session_id) {
    return new MisboundPayload("session_id", expected.session_id, sealed.session_id);
  }
  if (sealed.generation !== expected.generation) {
    return new MisboundPayload("generation", expected.generation, sealed.generation);
  }

  if (obj.v > PAYLOAD_V) return new UnsupportedPayload("version", obj.v, true);

  if (!Number.isSafeInteger(obj.sent_at) || obj.sent_at < 0) {
    throw new RangeError(`payload: bad sent_at ${obj.sent_at}`);
  }
  if (typeof obj.kind !== "string") throw new TypeError("payload: kind must be a string");

  // ⚠️ §6.7.1, AND WHAT IS *NOT* READ HERE IS THE POINT. A peer may put a `text`
  // key in a closing notice — every field is peer-controlled and authenticated is
  // not trustworthy (§11) — and this returns a payload that has nowhere to put it.
  // Reading it "just in case a later version uses it" is how the field that must
  // not exist arrives anyway.
  if (obj.kind === KIND_CLOSED) return { v: obj.v, kind: KIND_CLOSED, sentAt: obj.sent_at };

  if (obj.kind !== KIND_TEXT) return new UnsupportedPayload("kind", obj.kind, true);
  if (typeof obj.text !== "string") throw new TypeError("payload: text must be a string");

  return { v: obj.v, kind: obj.kind, sentAt: obj.sent_at, text: obj.text };
}
