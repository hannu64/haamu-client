// AES-256-GCM (PROTOCOL.md §0.2).
//
// ⚠️ §0.2 states the IV rule once, for the whole document, and says why: it used
// to be stated only in §7.3 and omitted in §8, "and an omitted IV rule is how GCM
// nonce reuse gets invented by a well-meaning implementer". Here it is not a rule
// an implementer follows — there is no way to pass an IV to seal(), and open()
// takes it from the front of the ciphertext. A caller cannot reuse one.

import { concat } from "./bytes.js";
import { randomBytes } from "./random.js";

const subtle = globalThis.crypto.subtle;

export const IV_LENGTH = 12;
export const TAG_LENGTH = 16;

/**
 * The key, as WebCrypto wants it.
 *
 * ⚠️⚠️ A `CryptoKey` IS PASSED STRAIGHT THROUGH, AND THAT PATH IS THE POINT. §7.7
 * requires `roster_key` to be produced by `deriveKey` and to exist *"never as
 * bytes"*; a `seal`/`open` pair that could only take a `Uint8Array` would force
 * every caller to materialise it, which is exactly what the client did until
 * 2026-08-24 and exactly what the table said it did not. So the raw form is still
 * accepted — `local_key` and the message vault genuinely come out of the Argon2 heap
 * as bytes and §7.7's table says so plainly — and the derived form costs nothing.
 *
 * ⚠️ A `CryptoKey` ARRIVES WITH ITS USAGES ALREADY FIXED and this function cannot
 * widen them. `hkdfKey` is called with both, so a key that reaches here can do both;
 * a caller that supplied a narrower one gets WebCrypto's own refusal, which names
 * the operation.
 */
async function importKey(key, usage) {
  if (key instanceof CryptoKey) return key;
  if (!(key instanceof Uint8Array) || key.length !== 32) {
    throw new RangeError("aead: key must be 32 bytes (AES-256) or a CryptoKey");
  }
  return subtle.importKey("raw", key, "AES-GCM", false, [usage]);
}

/**
 * Encrypt under a fresh random 12-byte IV, returning `iv || ciphertext || tag`.
 *
 * `aad` is optional additional authenticated data. Nothing in MVP passes it; it
 * exists so that a call site which needs to bind context can do so without
 * inventing a construction.
 */
export async function seal(key, plaintext, aad) {
  const iv = randomBytes(IV_LENGTH);
  const params = { name: "AES-GCM", iv, tagLength: TAG_LENGTH * 8 };
  if (aad) params.additionalData = aad;
  const ct = new Uint8Array(await subtle.encrypt(params, await importKey(key, "encrypt"), plaintext));
  return concat(iv, ct);
}

/**
 * Decrypt `iv || ciphertext || tag`. Throws on any authentication failure — the
 * caller gets no partial plaintext, which is the property the whole scheme rests
 * on.
 */
export async function open(key, blob, aad) {
  if (!(blob instanceof Uint8Array) || blob.length < IV_LENGTH + TAG_LENGTH) {
    throw new RangeError("aead: ciphertext is too short to contain an IV and a tag");
  }
  const params = { name: "AES-GCM", iv: blob.subarray(0, IV_LENGTH), tagLength: TAG_LENGTH * 8 };
  if (aad) params.additionalData = aad;
  const pt = await subtle.decrypt(params, await importKey(key, "decrypt"), blob.subarray(IV_LENGTH));
  return new Uint8Array(pt);
}
