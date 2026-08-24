// HKDF-SHA-256 (PROTOCOL.md §0.1: `HKDF(key, info, len)`, empty salt unless
// stated — and it is never stated anywhere in the document).

import { asciiBytes } from "./bytes.js";

const subtle = globalThis.crypto.subtle;

/** RFC 5869 caps the output at 255 × HashLen. Nothing here comes close. */
const MAX_OUTPUT = 255 * 32;

/**
 * HKDF-SHA-256 with an empty salt.
 *
 * `info` is either an ASCII string — the ordinary case, every `info` in
 * PROTOCOL.md is one — or raw bytes, for §6.2's `"lpm-olm-otk-v1" || session_id`
 * where a binary value is concatenated onto the label. A string goes through
 * asciiBytes(), which refuses anything that would UTF-8-expand.
 *
 * On the empty salt: RFC 5869 defines an absent salt as HashLen zero bytes, and
 * WebCrypto's zero-length salt gives the same PRK — HMAC pads a short key to the
 * block size with zeros, so a zero-length key and 32 zero bytes are one key.
 * Node's `crypto.hkdfSync` with an empty salt agrees, which is what test/derive.mjs
 * checks from outside this file.
 */
export async function hkdf(key, info, len) {
  if (!(key instanceof Uint8Array)) throw new TypeError("hkdf: key must be a Uint8Array");
  if (!Number.isSafeInteger(len) || len <= 0 || len > MAX_OUTPUT) {
    throw new RangeError(`hkdf: len ${len} out of range (1..${MAX_OUTPUT})`);
  }
  const infoBytes = typeof info === "string" ? asciiBytes(info, "hkdf info") : info;
  if (!(infoBytes instanceof Uint8Array)) throw new TypeError("hkdf: info must be a string or Uint8Array");

  const k = await subtle.importKey("raw", key, "HKDF", false, ["deriveBits"]);
  const bits = await subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: infoBytes },
    k,
    len * 8
  );
  return new Uint8Array(bits);
}

/**
 * HKDF with an explicit salt. Present only so the RFC 5869 test vectors — which
 * all use a salt — can exercise the same code path the protocol uses. No
 * protocol call site passes a salt; if one ever does, PROTOCOL.md §0.1 has to say
 * so first.
 */
export async function hkdfWithSalt(key, salt, info, len) {
  const k = await subtle.importKey("raw", key, "HKDF", false, ["deriveBits"]);
  const bits = await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, len * 8);
  return new Uint8Array(bits);
}
