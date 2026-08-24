// PROTOCOL.md §6.7 (the message payload) and §6.6 (message TTL).
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

import { utf8Bytes, utf8String } from "../crypto/bytes.js";
import { MAX_PLAINTEXT } from "./envelope.js";

/** §6.7. Distinct from the envelope's `v`, which versions the wire format. */
export const PAYLOAD_V = 1;

/** A message somebody typed. Blobs (§8) are Phase 2 and add a third. */
export const KIND_TEXT = "text";

/**
 * §6.7.1 — the one message the product sends by itself.
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
 */
export class UnsupportedPayload {
  constructor(reason, detail) {
    this.unsupported = reason;
    this.detail = detail;
  }
}

/** §6.6: `first_seen + 24 h`, on the receiver's clock. */
export function expiresAt(firstSeen) {
  return firstSeen + TTL_SECONDS;
}

/**
 * Build the payload object. `sentAt` is the sender's own clock.
 *
 * ⚠️ `sent_at` IS DISPLAY ONLY, and §6.6 is explicit that it is not the input to
 * the deletion timer. It is authentic — it comes through the ratchet, so no third
 * party wrote it — but it is the *peer's* clock: a wrong one, or a hostile one,
 * puts a message in the wrong place in a history sorted by it. Sort by arrival.
 */
export function buildPayload({ text, sentAt, kind = KIND_TEXT }) {
  if (!Number.isSafeInteger(sentAt) || sentAt < 0) {
    throw new RangeError(`payload: sent_at must be a non-negative integer, got ${sentAt}`);
  }
  // §6.7.1: no `text` key at all, rather than an empty one. A key that is present
  // and empty is a key a later version can be tempted to fill.
  if (kind === KIND_CLOSED) return { v: PAYLOAD_V, kind, sent_at: sentAt };
  if (typeof text !== "string") throw new TypeError("payload: text must be a string");
  return { v: PAYLOAD_V, kind, sent_at: sentAt, text };
}

/** §6.7.1's closing notice, which is the whole of what this client ever sends alone. */
export function buildClosing({ sentAt }) {
  return buildPayload({ sentAt, kind: KIND_CLOSED });
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

/** Whether a message of this text would fit, for an interface that must say so. */
export function fits(text, sentAt = 0) {
  try {
    encodePayload(buildPayload({ text, sentAt }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Decode a payload that came off the ratchet.
 *
 * ⚠️ EVERY FIELD HERE IS PEER-CONTROLLED. Authenticated is not the same as
 * trustworthy: the ratchet proves the bytes came from the other party to this
 * channel and nothing about what they contain. A malicious peer is in scope
 * (§11), so shape is checked before anything is read.
 *
 * Returns an `UnsupportedPayload` — not an exception — for anything a later
 * version might legitimately send, because the caller has to treat those two
 * cases differently: a malformed payload is a fault, an unsupported one is a
 * message the user should be told about but this build cannot show.
 */
export function decodePayload(bytes) {
  let obj;
  try {
    obj = JSON.parse(utf8String(bytes));
  } catch (err) {
    throw new TypeError(`payload: not JSON (${err.message})`);
  }
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    throw new TypeError("payload: expected an object");
  }
  if (obj.v !== PAYLOAD_V) return new UnsupportedPayload("version", obj.v);
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

  if (obj.kind !== KIND_TEXT) return new UnsupportedPayload("kind", obj.kind);
  if (typeof obj.text !== "string") throw new TypeError("payload: text must be a string");

  return { v: obj.v, kind: obj.kind, sentAt: obj.sent_at, text: obj.text };
}
