// §6.2's key derivation, computed a second time by a second implementation.
//
// This is the whole point of the upgrade test. Every guard inside the wrapper
// asks vodozemac to check vodozemac's own work, so a release that *reinterprets*
// the same 32 bytes — different clamping, a different scalar convention — moves
// both sides of every one of those checks together and passes. Nothing in Rust
// can catch that. This file can, because it shares no code with the wrapper:
// Node's HKDF and Node's X25519 against the spec as written.
//
//   idk_I = X25519_keypair_from_seed(HKDF(R, "lpm-olm-idk-I-v1", 32))
//   idk_J = X25519_keypair_from_seed(HKDF(R, "lpm-olm-idk-J-v1", 32))
//   otk   = X25519_keypair_from_seed(HKDF(R, "lpm-olm-otk-v1" || session_id, 32))
//
// §6.2 gives HKDF no salt. RFC 5869 defines that as HashLen zero bytes, and an
// empty salt is the same thing here: HMAC pads any key shorter than the block
// size with zeros, so a zero-length key and 32 zero bytes produce one PRK.

import crypto from "node:crypto";

export const b64u = (buf) => Buffer.from(buf).toString("base64url");

// PKCS#8 and SPKI wrappers for X25519 (OID 1.3.101.110). Node has no raw-scalar
// import, so the 32 bytes are wrapped in the DER the standard defines. The
// prefixes are fixed-length, which is why the public half can be sliced back out.
const PKCS8_X25519 = Buffer.from("302e020100300506032b656e04220420", "hex");
const SPKI_X25519_LEN = 12;

export function x25519PublicFromSeed(seed) {
  const priv = crypto.createPrivateKey({
    key: Buffer.concat([PKCS8_X25519, Buffer.from(seed)]),
    format: "der",
    type: "pkcs8",
  });
  const spki = crypto.createPublicKey(priv).export({ format: "der", type: "spki" });
  return spki.subarray(SPKI_X25519_LEN);
}

const hkdf32 = (root, info) =>
  Buffer.from(crypto.hkdfSync("sha256", root, Buffer.alloc(0), info, 32));

/// The three public keys §6.2 derives, as b64u, from `R` and a session id.
export function derivePublicKeys(root, sessionId) {
  const otkInfo = Buffer.concat([Buffer.from("lpm-olm-otk-v1"), Buffer.from(sessionId)]);
  return {
    idk_I: b64u(x25519PublicFromSeed(hkdf32(root, Buffer.from("lpm-olm-idk-I-v1")))),
    idk_J: b64u(x25519PublicFromSeed(hkdf32(root, Buffer.from("lpm-olm-idk-J-v1")))),
    otk: b64u(x25519PublicFromSeed(hkdf32(root, otkInfo))),
  };
}
