// X25519 (PROTOCOL.md §0.2), used by §3's pairing handshake and nowhere else in
// JavaScript — §6.2's three derived keypairs live inside the Olm wrapper.
//
// ⚠️ Keys are raw bytes here, not non-extractable CryptoKeys, and that is forced
// rather than chosen: §3.4.1 requires the initiator's `i_priv` to survive in
// storage for the link's whole lifetime (§1, one day since D-136), and both stores
// that can hold it — `sessionStorage` for Ghost, the sealed `conversation` store for
// Kept (§3.4.1b) — take serialisable values, not CryptoKeys. §3.4.1 states the cost
// out loud: the link secret reaches disk for that time, and §7.8 must clear it. Nothing is gained by hiding the same value behind a
// CryptoKey on the path where it is also written to storage in the clear.
//
// ⚠️⚠️ **THIS FILE HAS TWO IMPLEMENTATIONS BEHIND IT AND ONE SET OF RULES.** §0.2
// requires a WASM fallback for browsers without X25519 in WebCrypto, so every
// exported function here can run either implementation. Every check therefore
// happens BEFORE the branch that chooses one — see `requireBytes` in `okp.js`
// for what happened when they did not, and D-076. A reader adding a function to
// this file should read its four lines in this order: validate, branch, compute,
// check the result.

import { importPrivate, importPublic, probe, requireBytes, MissingPrimitiveError } from "./okp.js";
import { randomBytes } from "./random.js";

const subtle = globalThis.crypto.subtle;
const ALG = "X25519";

let fallback = null;
let override = false;

/**
 * Whether WebCrypto itself has X25519 here. `null` until probed, then cached.
 *
 * ⚠️ It is cached because `probe()` GENERATES A KEY, and this used to be asked
 * on every single operation: `available()` cached its answer, and the private
 * helper that chose the path called `probe()` directly. §5.2 signs every request
 * — with the Ed25519 twin of this file doing the same thing, a device paid for a
 * throwaway keypair per network call to re-learn a fact about its own browser
 * that cannot change while the page is open.
 */
let native = null;

/**
 * Install a WASM implementation for browsers without X25519 in WebCrypto.
 *
 * `impl` provides two SYNCHRONOUS functions:
 *
 *   publicFromPrivate(privateKey) -> Uint8Array(32)
 *   dh(privateKey, peerPublicKey) -> Uint8Array(32)
 *
 * Synchronous is a requirement, not a convention — see the top of
 * `crypto/curve.js`. Initialisation may be async; operations may not.
 *
 * There is deliberately no `generateKeyPair` in that list: a keypair is
 * `keyPairFromPrivate(randomBytes(32))` whichever implementation is underneath,
 * so both paths draw from one source of randomness rather than two.
 *
 * `insteadOfWebCrypto` runs the fallback on a device that does not need it. It
 * exists because otherwise the only browsers that ever execute this path are the
 * ones a developer cannot test on — `client/curve/test/curve.mjs` runs every
 * §0.2 vector twice, once per implementation, and compares the two.
 */
export function installFallback(impl, { insteadOfWebCrypto = false } = {}) {
  fallback = impl;
  override = insteadOfWebCrypto;
}

async function inWebCrypto() {
  if (native === null) native = await probe(ALG);
  return native;
}

/** Feature detection (§0.2): can this client do X25519 at all? */
export async function available() {
  return (await inWebCrypto()) || fallback !== null;
}

async function useFallback() {
  if (fallback === null) return false;
  return override || !(await inWebCrypto());
}

/**
 * A fresh ephemeral keypair — §3.1's `(i_priv, I_pub)` and §3.2's `(j_priv, J_pub)`.
 * Returns raw 32-byte values.
 *
 * Generated as a random seed rather than by `subtle.generateKey`, so that the
 * private half is a value this code holds rather than one it has to export — and
 * so that the fallback path needs no randomness of its own.
 */
export async function generateKeyPair() {
  return keyPairFromPrivate(randomBytes(32));
}

/** The public half of a private key. */
export async function keyPairFromPrivate(privateKey) {
  requireBytes(ALG, "private key", privateKey, 32);
  const publicKey = (await useFallback())
    ? fallback.publicFromPrivate(privateKey)
    : await nativePublic(privateKey);
  return { privateKey, publicKey };
}

async function nativePublic(privateKey) {
  if (!(await available())) throw new MissingPrimitiveError(ALG);
  const { publicKey } = await importPrivate(ALG, privateKey, ["deriveBits"]);
  return publicKey;
}

/**
 * X25519 Diffie–Hellman — §3.3's `dh = X25519(own_priv, peer_pub)`.
 *
 * ⚠️ **The all-zero check below is after the branch, and that is the whole
 * point.** RFC 7748 §6.1 recommends it, and here it means a peer public key of
 * small order — which in this protocol can only arrive from a server substituting
 * keys, the exact case §3.3 says the MACs catch. Two checks on one attack is the
 * correct number when one of them costs a loop over 32 bytes; nought checks is
 * what a fallback path gets when the loop is written after an early `return`.
 * `client/curve/` also rejects it, for a caller that wants a reason rather than a
 * comparison, and because this check must hold for any implementation handed to
 * `installFallback` — including one that is not ours.
 */
export async function dh(privateKey, peerPublicKey) {
  requireBytes(ALG, "private key", privateKey, 32);
  requireBytes(ALG, "peer public key", peerPublicKey, 32);

  const shared = (await useFallback())
    ? fallback.dh(privateKey, peerPublicKey)
    : await nativeDh(privateKey, peerPublicKey);

  let acc = 0;
  for (const b of shared) acc |= b;
  if (acc === 0) throw new Error("X25519: peer public key has small order (all-zero shared secret)");
  return shared;
}

async function nativeDh(privateKey, peerPublicKey) {
  if (!(await available())) throw new MissingPrimitiveError(ALG);
  const { key } = await importPrivate(ALG, privateKey, ["deriveBits"]);
  const peer = await importPublic(ALG, peerPublicKey, []);
  try {
    return new Uint8Array(await subtle.deriveBits({ name: ALG, public: peer }, key, 256));
  } catch (e) {
    // WebCrypto is specified to throw on an all-zero result. Not every engine
    // does, which is why the explicit check in `dh` exists as well.
    throw new Error(`X25519: key agreement failed (${e.message})`);
  }
}
