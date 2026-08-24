// Ed25519 (PROTOCOL.md §0.2): §4.2's mailbox keys, §5.2's request signatures and
// §7.2's `roster_auth`.
//
// Every Ed25519 key in this protocol is DERIVED from a 32-byte seed — from `R`
// for a mailbox, from `K_master` for the roster — by the standard RFC 8032
// procedure. There is no key generation here at all, which is why this module
// takes a seed and never returns one it invented.
//
// ⚠️⚠️ **TWO IMPLEMENTATIONS, ONE SET OF RULES**, exactly as in `x25519.js`: §0.2
// requires a WASM fallback, so every check here happens BEFORE the branch that
// chooses an implementation. See `requireBytes` in `okp.js` and D-076.

import { importPrivate, importPublic, probe, requireBytes, MissingPrimitiveError } from "./okp.js";

const subtle = globalThis.crypto.subtle;
const ALG = "Ed25519";

let fallback = null;
let override = false;

/**
 * Whether WebCrypto itself has Ed25519 here. `null` until probed, then cached.
 *
 * ⚠️ Cached because `probe()` generates a key and §5.2 signs every request. See
 * the same variable in `x25519.js` for what that cost before it was cached.
 */
let native = null;

/**
 * Install a WASM implementation for browsers without Ed25519 in WebCrypto.
 *
 * `impl` provides three SYNCHRONOUS functions:
 *
 *   publicFromSeed(seed)              -> Uint8Array(32)
 *   sign(seed, message)               -> Uint8Array(64)
 *   verify(publicKey, signature, msg) -> boolean
 *
 * Synchronous is a requirement — see the top of `crypto/curve.js`.
 *
 * `insteadOfWebCrypto` runs the fallback on a device that does not need it, so
 * that the path can be tested by somebody whose browser has the primitive.
 */
export function installFallback(impl, { insteadOfWebCrypto = false } = {}) {
  fallback = impl;
  override = insteadOfWebCrypto;
}

async function inWebCrypto() {
  if (native === null) native = await probe(ALG);
  return native;
}

/** Feature detection (§0.2): can this client do Ed25519 at all? */
export async function available() {
  return (await inWebCrypto()) || fallback !== null;
}

async function useFallback() {
  if (fallback === null) return false;
  return override || !(await inWebCrypto());
}

/**
 * RFC 8032 key generation from a 32-byte seed — §4.2's
 * `(sk, pk) = Ed25519_keypair_from_seed(auth_seed_<dir>)`.
 *
 * Returns `{ privateKey, publicKey }` where `privateKey` IS the seed. RFC 8032
 * calls the 32-byte value the private key and the 64-byte form "private key ||
 * public key"; libraries differ on which they call a secret key, and this
 * protocol only ever names the 32-byte one.
 */
export async function keyPairFromSeed(seed) {
  requireBytes(ALG, "seed", seed, 32);
  const publicKey = (await useFallback())
    ? fallback.publicFromSeed(seed)
    : (await nativeImport(seed)).publicKey;
  return { privateKey: seed, publicKey };
}

/** Sign with a 32-byte seed (§5.2). */
export async function sign(seed, message) {
  requireBytes(ALG, "seed", seed, 32);
  if (!(message instanceof Uint8Array)) {
    throw new TypeError(`${ALG}: message must be the exact bytes to sign`);
  }
  if (await useFallback()) return fallback.sign(seed, message);
  const { key } = await nativeImport(seed);
  return new Uint8Array(await subtle.sign(ALG, key, message));
}

/**
 * Verify a signature against a 32-byte public key.
 *
 * The client verifies no Ed25519 signature in MVP — the server is the verifier —
 * but this is what makes the §5.2 test vectors checkable from the side that
 * produces them, and a client that cannot verify its own signature cannot tell a
 * broken signer from a broken server.
 *
 * ⚠️ The two length checks are before the branch. A 63-byte signature returned
 * `false` on the WebCrypto path and reached the fallback's fixed 64-byte buffer
 * on the other one.
 *
 * ⚠️ §0.2 records the one way the two implementations may disagree: the fallback
 * uses `verify_strict`, which refuses small-order public keys and takes RFC
 * 8032's cofactorless equation. No signature this protocol produces is affected.
 * A verifier stricter than its peers is the safe direction for a difference to
 * run in — and it is the direction that cannot silently accept a forgery.
 */
export async function verify(publicKey, signature, message) {
  requireBytes(ALG, "public key", publicKey, 32);
  if (!(signature instanceof Uint8Array) || signature.length !== 64) return false;
  if (!(message instanceof Uint8Array)) {
    throw new TypeError(`${ALG}: message must be the exact bytes that were signed`);
  }
  if (await useFallback()) return fallback.verify(publicKey, signature, message);

  // ⚠️ A 32-byte value that is not a point on the curve is not a signature
  // question, and the two implementations must still give one answer. The
  // fallback returns false (its `ERR_PUBKEY`); WebCrypto engines differ on
  // whether they refuse such a key at IMPORT or at verification — Node imports it
  // and answers false, others throw. Left uncaught, "is this signature valid?"
  // would be `false` on one device and an exception on another, which is the
  // device-dependent split §0.2's fallback exists to prevent.
  let key;
  try {
    key = await importPublic(ALG, publicKey, ["verify"]);
  } catch {
    return false;
  }
  return subtle.verify(ALG, key, signature, message);
}

async function nativeImport(seed) {
  if (!(await available())) throw new MissingPrimitiveError(ALG);
  return importPrivate(ALG, seed, ["sign"]);
}
