// PROTOCOL.md §6.4 (wire format) and §6.5 (padding).

import { b64uDecode, b64uDecodeExact, b64uEncode } from "../crypto/b64u.js";
import { concat, le32, readLe32 } from "../crypto/bytes.js";
import { randomBytes } from "../crypto/random.js";

/** §6.5's ladder. */
export const PAD_BUCKETS = [256, 1024, 4096, 16384, 65536];

/**
 * §6.5: "Anything with plaintext_length > 65532 must be sent as a file blob (§8),
 * not an inline message" — not "anything above 64 KiB", which is off by the four
 * bytes of the length prefix: a 65,536-byte plaintext needs 65,540 and fits no
 * bucket.
 */
export const MAX_PLAINTEXT = 65532;

export const SESSION_ID_BYTES = 16;
export const TYPE_PREKEY = "prekey";
export const TYPE_NORMAL = "normal";

/** A fresh `session_id` (§6.3: 16 random bytes chosen by the session initiator). */
export function newSessionId() {
  return randomBytes(SESSION_ID_BYTES);
}

/** §6.5: `LE32(true_length) || plaintext || zeros`, to the next bucket. */
export function pad(plaintext) {
  if (!(plaintext instanceof Uint8Array)) throw new TypeError("pad: expected a Uint8Array");
  if (plaintext.length > MAX_PLAINTEXT) {
    throw new RangeError(
      `pad: ${plaintext.length} bytes exceeds ${MAX_PLAINTEXT}; §6.5 requires a file blob (§8) above that`
    );
  }
  const needed = plaintext.length + 4;
  const bucket = PAD_BUCKETS.find((b) => b >= needed);
  return padToFixed(plaintext, bucket);
}

/**
 * The same encoding to a caller-chosen fixed size — §7.3's roster, which pads to
 * a constant 16 KiB rather than to the ladder. A ladder there would leak the
 * channel count within a factor of four and make every bucket transition an
 * observable growth event on a permanent identifier.
 */
export function padToFixed(plaintext, size) {
  const needed = plaintext.length + 4;
  if (!Number.isSafeInteger(size) || size < needed) {
    throw new RangeError(`padToFixed: ${plaintext.length} bytes plus a 4-byte prefix does not fit ${size}`);
  }
  const out = new Uint8Array(size);
  out.set(le32(plaintext.length), 0);
  out.set(plaintext, 4);
  return out;
}

/**
 * Undo the padding.
 *
 * ⚠️ §6.5: "The receiver MUST bounds-check `true_length` against the decrypted
 * buffer before using it. The field is attacker-influenced in the malicious-peer
 * case." A length longer than the buffer must be an error, never a truncated read
 * of whatever follows in memory.
 */
export function unpad(padded) {
  if (!(padded instanceof Uint8Array) || padded.length < 4) {
    throw new RangeError("unpad: buffer is too short to hold a length prefix");
  }
  const trueLength = readLe32(padded);
  if (trueLength > padded.length - 4) {
    throw new RangeError(
      `unpad: declared length ${trueLength} exceeds the ${padded.length - 4} bytes available`
    );
  }
  return padded.slice(4, 4 + trueLength);
}

/** §6.4's envelope, as the object that goes on the wire. */
export function buildEnvelope({ sessionId, generation, type, body }) {
  if (!(sessionId instanceof Uint8Array) || sessionId.length !== SESSION_ID_BYTES) {
    throw new RangeError("session_id: expected 16 bytes");
  }
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw new RangeError(`generation: expected a non-negative integer, got ${generation}`);
  }
  if (type !== TYPE_PREKEY && type !== TYPE_NORMAL) {
    throw new RangeError(`type: expected "prekey" or "normal", got ${JSON.stringify(type)}`);
  }
  if (!(body instanceof Uint8Array)) throw new TypeError("body: expected the Olm ciphertext as bytes");

  return { v: 1, session_id: b64uEncode(sessionId), generation, type, body: b64uEncode(body) };
}

/**
 * Validate the SHAPE of a received envelope and decode its fields.
 *
 * ⚠️ §6.4: "Every field outside `body` is unauthenticated. The server can alter
 * any of them." No alteration is a break — each produces a decryption failure, and
 * the server can already drop messages outright — but an implementer must not
 * treat `session_id` or `generation` as trustworthy input to a state lookup, or
 * build a session-table poisoning bug on top of them. **Validate shape, then let
 * decryption be the authority.** This function does the first half and is
 * deliberately incapable of doing the second.
 *
 * ⚠️ There is no `eph_pub` field and there must never be one: the pre-key message
 * inside `body` already carries the base key, authenticated, bound into the 3DH.
 * An outer copy would be a second, unauthenticated duplicate that a server could
 * make disagree with the real one. There is no direction field either — direction
 * is expressed by which mailbox the message is in (§4.2).
 */
export function parseEnvelope(obj) {
  if (obj === null || typeof obj !== "object") throw new TypeError("envelope: expected an object");
  if (obj.v !== 1) throw new RangeError(`envelope: unsupported version ${obj.v}`);
  if (obj.type !== TYPE_PREKEY && obj.type !== TYPE_NORMAL) {
    throw new RangeError(`envelope: bad type ${JSON.stringify(obj.type)}`);
  }
  if (!Number.isSafeInteger(obj.generation) || obj.generation < 0) {
    throw new RangeError(`envelope: bad generation ${obj.generation}`);
  }
  const sessionId = b64uDecodeExact(obj.session_id, SESSION_ID_BYTES, "envelope session_id");
  const body = b64uDecode(obj.body, "envelope body");
  if (body.length === 0) throw new RangeError("envelope: empty body");

  return { version: 1, sessionId, generation: obj.generation, type: obj.type, body };
}
