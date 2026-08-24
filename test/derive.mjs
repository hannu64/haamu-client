// A SECOND IMPLEMENTATION of the lpm derivations, written from PROTOCOL.md and
// sharing no code with src/.
//
// ⭐ Why this file exists, in one sentence: the lpm-specific derivations have no
// published test vectors — no other implementation exists yet — so the only
// available anchor is a second reading of the specification, on a different code
// path, that must agree.
//
// It uses `node:crypto`'s classic API (hkdfSync, createHash, createHmac,
// createPublicKey, sign, diffieHellman); src/ uses WebCrypto's subtle. Both are
// OpenSSL underneath, so this proves less than an independent library would — it
// catches every ENCODING and STRUCTURE error, which is where §4.2 and §5.2 record
// that the real failures were, and it does not catch a bug inside SHA-256. The
// RFC vectors in rfc.mjs cover that half.
//
// ⚠️ Nothing in this file may import from ../src. If it ever does, it stops being
// a second implementation and becomes a mirror.

import { createHash, createHmac, createPrivateKey, createPublicKey, hkdfSync, sign, diffieHellman } from "node:crypto";

const ED_PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");
const X_PKCS8 = Buffer.from("302e020100300506032b656e04220420", "hex");
const SPKI_HEADER_LEN = 12; // SEQUENCE, algorithm SEQUENCE, BIT STRING — then 32 bytes

const b64u = (b) => Buffer.from(b).toString("base64url");
const ascii = (s) => Buffer.from(s, "ascii");

/** HKDF-SHA-256 with an empty salt (§0.1). */
export function hkdf(key, info, len) {
  return Buffer.from(hkdfSync("sha256", key, Buffer.alloc(0), typeof info === "string" ? ascii(info) : info, len));
}

export const sha256 = (data) => createHash("sha256").update(data).digest();
export const hmac = (key, data) => createHmac("sha256", key).update(data).digest();

function edPrivate(seed) {
  return createPrivateKey({ key: Buffer.concat([ED_PKCS8, Buffer.from(seed)]), format: "der", type: "pkcs8" });
}

/** RFC 8032 keypair from a 32-byte seed (§4.2, §7.2). */
export function ed25519FromSeed(seed) {
  const priv = edPrivate(seed);
  const spki = createPublicKey(priv).export({ type: "spki", format: "der" });
  return { privateKey: Buffer.from(seed), publicKey: spki.subarray(SPKI_HEADER_LEN) };
}

export function ed25519Sign(seed, message) {
  return sign(null, Buffer.from(message), edPrivate(seed));
}

/** X25519 (§3.3). */
export function x25519Public(privateKey) {
  const priv = createPrivateKey({ key: Buffer.concat([X_PKCS8, Buffer.from(privateKey)]), format: "der", type: "pkcs8" });
  return createPublicKey(priv).export({ type: "spki", format: "der" }).subarray(SPKI_HEADER_LEN);
}

export function x25519Dh(privateKey, peerPublic) {
  const privateKeyObj = createPrivateKey({
    key: Buffer.concat([X_PKCS8, Buffer.from(privateKey)]),
    format: "der",
    type: "pkcs8",
  });
  const publicKey = createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b656e032100", "hex"), Buffer.from(peerPublic)]),
    format: "der",
    type: "spki",
  });
  return diffieHellman({ privateKey: privateKeyObj, publicKey });
}

// --------------------------------------------------------------- §2.3, §3, §4

/** §2.3 */
export function pairing(L) {
  return { pairingId: hkdf(L, "lpm-pairing-id-v1", 16), macKey: hkdf(L, "lpm-pairing-mac-v1", 32) };
}

/**
 * §2.2c: `normalise(s)`, and `L = ASCII(normalise(s))`, read off the specification.
 *
 * ⚠️⚠️ THE POINT OF A SECOND READING IS SHARPEST HERE. Every other derivation in
 * this file fails LOUDLY when two implementations disagree — a MAC does not verify,
 * a signature is rejected, somebody notices. §2.2c's normalisation fails SILENTLY:
 * two clients differing by one rule derive two `pairing_id`s, the joiner is told
 * `not_found`, and neither screen can say why. So the three rules are written out
 * here longhand, from the document, sharing nothing with `src/`.
 *
 * ⚠️ The alphabet is transcribed rather than imported, for the same reason and for
 * one more: a character added to one copy and not the other makes the generator
 * refuse to write. That is the only mechanism in this repository that would have
 * caught D-115 — a stated size that nobody counted.
 */
export const CODE_ALPHABET = "ABCDEFGHJKMNOPQRSTUVWXYZ23456789";

export function normaliseCode(s) {
  let out = "";
  for (const raw of s.toUpperCase()) {
    const c = raw === "0" ? "O" : raw;
    if (CODE_ALPHABET.includes(c)) out += c;
  }
  return out;
}

export const codeSecret = (s) => ascii(normaliseCode(s));

/** §3: commit_I = SHA256("lpm-pair-commit-v1" || I_pub) */
export const commitTo = (iPub) => sha256(Buffer.concat([ascii("lpm-pair-commit-v1"), Buffer.from(iPub)]));

/** §3.1 and §3.2 — both MAC the COMMITMENT, because J has no I_pub yet */
export const macOffer = (macKey, commit) => hmac(macKey, Buffer.concat([ascii("offer-v1"), Buffer.from(commit)]));
export const macClaim = (macKey, jPub, commit) =>
  hmac(macKey, Buffer.concat([ascii("claim-v1"), Buffer.from(jPub), Buffer.from(commit)]));

/** §3.3: R = HKDF(dh || L, "lpm-channel-root-v1", 32) */
export function channelRoot(ownPrivate, peerPublic, L) {
  return hkdf(Buffer.concat([x25519Dh(ownPrivate, peerPublic), Buffer.from(L)]), "lpm-channel-root-v1", 32);
}

/** §3.6: BE32(HKDF(R, "lpm-sas-v1", 4)) mod 1000000, six digits, zero-padded */
export function sas(R) {
  return String(hkdf(R, "lpm-sas-v1", 4).readUInt32BE(0) % 1000000).padStart(6, "0");
}

/** §4.1 */
export function epochOffset(R) {
  return Number(hkdf(R, "lpm-epoch-offset-v1", 8).readBigUInt64LE(0) % 604800n);
}

/** §4.2 — note the DECIMAL epoch in the info string, and Trunc128 of the digest */
export function mailbox(R, e, dir) {
  const seed = hkdf(R, `lpm-mbauth-${dir}-v1:${e}`, 32);
  const { publicKey } = ed25519FromSeed(seed);
  return {
    seed,
    publicKey,
    mailboxId: sha256(Buffer.concat([ascii("lpm-mailbox-id-v1"), publicKey])).subarray(0, 16),
  };
}

/** §5.2 — the canonical string, built as ASCII text and nothing else */
export function canonicalRequest({ tag, method, path, id, timestamp, nonce, body }) {
  const line = [
    tag,
    method,
    path,
    b64u(id),
    String(timestamp),
    b64u(nonce),
    b64u(sha256(body ?? Buffer.alloc(0))),
  ].join("\n");
  return ascii(line);
}

/** §7.2 — everything after Argon2id, which is not implemented on either side yet */
export function rosterKeys(kMaster) {
  const authSeed = hkdf(kMaster, "lpm-roster-auth-v1", 32);
  return {
    rosterId: hkdf(kMaster, "lpm-roster-id-v1", 16),
    rosterKey: hkdf(kMaster, "lpm-roster-key-v1", 32),
    rosterAuth: ed25519FromSeed(authSeed),
  };
}

/** §7.2's salt, over the canonical passphrase bytes */
export const rosterSalt = (P) => sha256(Buffer.concat([ascii("lpm-roster-salt-v1"), Buffer.from(P)]));

export { b64u };
