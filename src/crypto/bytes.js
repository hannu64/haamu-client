// Byte helpers. No cryptography here — but two of these exist because getting
// them wrong is how PROTOCOL.md §4.2 and §5.2 each describe a protocol that does
// not interoperate with itself.

/** Concatenate byte arrays. */
export function concat(...parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/**
 * Constant-time equality.
 *
 * Used for every MAC and digest comparison in /protocol. `===` on a decoded
 * string, or an early-returning loop, leaks the position of the first differing
 * byte — which for §3.2's pairing MAC is an online forgery oracle against a value
 * the server chooses.
 *
 * Unequal lengths return false immediately: length is not a secret here (every
 * one of these values has a fixed size fixed by this protocol), and pretending
 * otherwise would mean hashing to compare.
 */
export function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * ASCII bytes, and it REFUSES anything else.
 *
 * ⚠️ This guard is the whole of PROTOCOL.md §5.2's warning, made mechanical.
 * Every `info` string, every canonical signing string and every decimal integer
 * in this protocol is ASCII, and the failure of the earlier design was that a
 * browser encoding a string with TextEncoder UTF-8-expands any byte ≥ 0x80 into
 * two bytes while a Go server writing the same value as bytes does not. The two
 * then sign different byte strings and every request 401s — intermittently at
 * first, which is worse than never working at all.
 *
 * There is no ASCII TextEncoder, so this checks and then encodes.
 */
export function asciiBytes(s, what = "value") {
  if (typeof s !== "string") throw new TypeError(`${what}: expected a string`);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c > 0x7f) {
      throw new RangeError(
        `${what}: contains a non-ASCII character at index ${i} (U+${c
          .toString(16)
          .toUpperCase()
          .padStart(4, "0")}); PROTOCOL.md §5.2 requires ASCII`
      );
    }
    out[i] = c;
  }
  return out;
}

/** UTF-8 bytes. For user text only — never for an `info` or a canonical string. */
export function utf8Bytes(s) {
  return new TextEncoder().encode(s);
}

/** UTF-8 decode. Throws on malformed input rather than substituting U+FFFD. */
export function utf8String(bytes) {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/**
 * Decimal ASCII of a non-negative integer, no padding (PROTOCOL.md §4.2, §5.2).
 *
 * ⚠️ §4.2 spells out why this is not `LE64`: the earlier form concatenated a
 * UTF-8 string with eight raw bytes, and the two encodings agree only while the
 * epoch's low byte stays below 0x80. They diverge at e = 2944, about 308 days
 * from the day that was written, with no diagnosable cause.
 */
export function decimal(n, what = "value") {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new RangeError(`${what}: expected a non-negative safe integer, got ${n}`);
  }
  return String(n);
}

/** 32-bit little-endian (PROTOCOL.md §6.5 padding prefix). */
export function le32(n) {
  if (!Number.isSafeInteger(n) || n < 0 || n > 0xffffffff) {
    throw new RangeError(`le32: ${n} out of range`);
  }
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n, true);
  return out;
}

/** Read a 32-bit little-endian integer. */
export function readLe32(bytes, offset = 0) {
  if (bytes.length < offset + 4) throw new RangeError("readLe32: short buffer");
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true);
}

/**
 * Read a 64-bit little-endian integer as a BigInt (PROTOCOL.md §4.1's epoch
 * offset). BigInt because 2^64 does not fit a JS number and `offset` is taken
 * mod EPOCH_SECONDS afterwards, so the high bits matter.
 */
export function readLe64(bytes, offset = 0) {
  if (bytes.length < offset + 8) throw new RangeError("readLe64: short buffer");
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(offset, true);
}

/** Read a 32-bit big-endian integer (PROTOCOL.md §3.6's `BE32`). */
export function readBe32(bytes, offset = 0) {
  if (bytes.length < offset + 4) throw new RangeError("readBe32: short buffer");
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, false);
}

/**
 * Unsigned big-endian comparison of two equal-length byte strings.
 * Returns <0, 0 or >0.
 *
 * PROTOCOL.md §6.3 rule 3 needs exactly this and says why: `session_id` travels
 * as b64u, whose alphabet is **not** ASCII-monotonic, so comparing the encoded
 * strings and comparing the raw bytes genuinely disagree — for x = 00…00 d0 and
 * y = 00…00 04, x > y as bytes while b64u(x) < b64u(y). Two clients would each
 * conclude the other's session had won.
 */
export function compareBytes(a, b) {
  if (a.length !== b.length) {
    throw new RangeError("compareBytes: lengths differ; §6.3 compares 16 raw bytes");
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/** Assert a byte array has an exact length, with a message worth reading. */
export function expectLength(bytes, len, what) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError(`${what}: expected a Uint8Array`);
  if (bytes.length !== len) {
    throw new RangeError(`${what}: expected ${len} bytes, got ${bytes.length}`);
  }
  return bytes;
}
