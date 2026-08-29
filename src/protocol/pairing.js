// PROTOCOL.md §2 (the pairing link) and §3 (the handshake).

import { b64uEncode, b64uDecodeExact } from "../crypto/b64u.js";
import { asciiBytes, concat, expectLength, readBe32, timingSafeEqual } from "../crypto/bytes.js";
import { hkdf } from "../crypto/hkdf.js";
import { hmacSha256, sha256 } from "../crypto/hash.js";
import { randomBytes } from "../crypto/random.js";
import * as x25519 from "../crypto/x25519.js";

/** §2.1: `L` is 16 bytes (128 bits) from crypto.getRandomValues. */
export const LINK_SECRET_BYTES = 16;

/**
 * §1: a pairing session lives one day or until claimed (D-136, 2026-08-19).
 *
 * ⚠️⚠️ IT MUST EQUAL `store.PairingTTL` ON THE SERVER, and `test/e2e-pair.mjs`
 * measures that against a real offer rather than trusting either number. The server
 * is the authority — it stamps `expires_at` from its own clock and every query
 * filters on it — so a client reading high here would promise a life the link does
 * not have.
 *
 * ⚠️ RAISING THIS IS PERMITTED ONLY AT §2.2's SIXTEEN CHARACTERS (§2.2a, D-101):
 * below that length the code's guessability depends on the lifetime. Sixteen is the
 * built length, which is why the change was available at all.
 */
export const PAIRING_TTL_SECONDS = 86400;

export const ROLE_INITIATOR = "I";
export const ROLE_JOINER = "J";

const INFO_PAIRING_ID = "lpm-pairing-id-v1";
const INFO_PAIRING_MAC = "lpm-pairing-mac-v1";
/**
 * §2.3, added 0.9.31 (D-174). The value a client keeps, sealed, so that ANY device of
 * this identity can recognise a link it is already a party to (§3.4.1c).
 *
 * ⚠️⚠️ IT IS NEVER SENT ANYWHERE, and the two things it is deliberately NOT are the
 * whole of why it exists:
 *   · NOT `pairing_id`, which would serve identically — that one travels in the request
 *     PATH, so anyone watching traffic already holds it, and storing it would put an
 *     eavesdropper's value into long-term sealed storage for nothing.
 *   · ⛔⛔ NOT anything derived from `K_master`. A tag in the offer, a tag in the link,
 *     or pairing keys derived from the identity would each let ANY HOLDER OF THE LINK
 *     test a candidate passphrase offline — one Argon2id, one derivation, one compare.
 *     §7.3.3 names that oracle already, but its version sits behind server data, and an
 *     invite link is SENT TO PEOPLE. `HKDF(L, …)` tells a holder of the link nothing
 *     they do not already have.
 */
const INFO_LINK_MEMO = "lpm-link-memo-v1";
const INFO_CHANNEL_ROOT = "lpm-channel-root-v1";
const INFO_SAS = "lpm-sas-v1";

const CONTEXT_OFFER = "offer-v1";
const CONTEXT_CLAIM = "claim-v1";
const INFO_PAIR_COMMIT = "lpm-pair-commit-v1";

/** A fresh link secret. */
export function newLinkSecret() {
  return randomBytes(LINK_SECRET_BYTES);
}

/**
 * §2.1: `https://<host>/c#<b64u(L)>`.
 *
 * The secret lives in the fragment because browsers never transmit fragments to
 * the server. Two obligations come with that and neither lives in this function:
 * the server must never generate a page that echoes the fragment, and the client
 * must call `history.replaceState` to strip it from the address bar the moment it
 * is read — otherwise it leaks into history, screenshots, and the `Referer` of
 * every subsequent navigation.
 */
export function buildLink(origin, linkSecret) {
  expectLength(linkSecret, LINK_SECRET_BYTES, "L");
  return `${origin.replace(/\/+$/, "")}/c#${b64uEncode(linkSecret)}`;
}

/**
 * Read `L` out of a link. Accepts the full URL or the bare fragment.
 *
 * A URL with no fragment is its own error rather than a base64 complaint, because
 * it is a real case with a real cause: something stripped the fragment in transit
 * — a link shortener, a chat client's preview fetch, a copy that stopped at the
 * `#`. The user needs to hear that the secret is missing, not that a string is
 * not base64url.
 */
export function parseLink(link) {
  if (typeof link !== "string") throw new TypeError("pairing link: expected a string");
  const hash = link.includes("#") ? link.slice(link.indexOf("#") + 1) : link;
  if (hash === "" || (!link.includes("#") && /[:/]/.test(link))) {
    throw new SyntaxError("pairing link: no fragment — the secret is missing from this link");
  }
  return b64uDecodeExact(hash, LINK_SECRET_BYTES, "L");
}

/**
 * §2.3:
 *   pairing_id      = HKDF(L, "lpm-pairing-id-v1", 16)
 *   pairing_mac_key = HKDF(L, "lpm-pairing-mac-v1", 32)
 */
export async function derivePairing(linkSecret) {
  expectLength(linkSecret, LINK_SECRET_BYTES, "L");
  const [pairingId, macKey, linkMemo] = await Promise.all([
    hkdf(linkSecret, INFO_PAIRING_ID, 16),
    hkdf(linkSecret, INFO_PAIRING_MAC, 32),
    hkdf(linkSecret, INFO_LINK_MEMO, 16),
  ]);
  return { pairingId, macKey, linkMemo };
}

/**
 * §3: `commit_I = SHA256("lpm-pair-commit-v1" || I_pub)`.
 *
 * ⚠️⚠️ THIS IS THE SECURITY OF §3.6, NOT A TIDY-UP. Up to protocol 0.8.4 the
 * initiator published `I_pub` itself, so the joiner — or an attacker standing in
 * the joiner's position with `L` in hand — chose its own key **after seeing it**.
 * That is enough to defeat the six-digit short authentication string, which is
 * the only defence this design has against a relaying man-in-the-middle: the
 * attacker fixes one channel's root, then grinds candidate keys on the other
 * until both channels display the same six digits. Measured at 2,700 attempts a
 * second in unoptimised Node — about six minutes on one weak core, seconds
 * natively — against a session that lives a day (D-136).
 *
 * With the commitment, neither party can choose its key after seeing the other's,
 * so the digits are uniform to both and each attempt is a 1-in-10⁶ shot that
 * costs a whole fresh pairing, visible to both users. That is what §3.6's
 * "one-shot and online" has always claimed and what it now actually is.
 *
 * Commit-then-reveal is ZRTP's construction, restored — §0 forbids inventing one.
 */
export async function commitTo(initiatorPublic) {
  expectLength(initiatorPublic, 32, "I_pub");
  return sha256(concat(asciiBytes(INFO_PAIR_COMMIT), initiatorPublic));
}

/**
 * §3.4, J's check: does the revealed key open the commitment it was given?
 *
 * A mismatch is an attempted substitution, not a transient failure — the server
 * served a key its own stored commitment does not cover. The caller MUST abort
 * hard and MUST NOT retry.
 */
export async function openCommitment(commit, initiatorPublic) {
  return timingSafeEqual(await commitTo(initiatorPublic), commit);
}

/** §3.1: `mac_I = HMAC(pairing_mac_key, "offer-v1" || commit_I)`. */
export function macOffer(macKey, commit) {
  expectLength(commit, 32, "commit_I");
  return hmacSha256(macKey, concat(asciiBytes(CONTEXT_OFFER), commit));
}

/**
 * §3.2: `mac_J = HMAC(pairing_mac_key, "claim-v1" || J_pub || commit_I)`.
 *
 * ⚠️ Over the COMMITMENT, not `I_pub` — J does not have `I_pub` yet, and that is
 * the whole point. An implementation that "fixes" this by moving `I_pub` earlier
 * has undone §3.
 */
export function macClaim(macKey, joinerPublic, commit) {
  expectLength(joinerPublic, 32, "J_pub");
  expectLength(commit, 32, "commit_I");
  return hmacSha256(macKey, concat(asciiBytes(CONTEXT_CLAIM), joinerPublic, commit));
}

/**
 * Verify an offer MAC (§3.2, done by J).
 *
 * §3.2: "J MUST verify `mac_I` before proceeding. If verification fails, abort
 * and show a hard error — this means either a corrupted link or a server
 * attempting a man-in-the-middle." A caller that ignores the return value of this
 * function has removed the only check standing between a user and a substituted
 * key, so it returns a boolean rather than throwing, and every call site is
 * expected to branch on it.
 */
export async function verifyOffer(macKey, commit, mac) {
  return timingSafeEqual(await macOffer(macKey, commit), mac);
}

/** Verify a claim MAC (§3.3, done by I). */
export async function verifyClaim(macKey, joinerPublic, commit, mac) {
  return timingSafeEqual(await macClaim(macKey, joinerPublic, commit), mac);
}

/**
 * §3.3: `R = HKDF(dh || L, "lpm-channel-root-v1", 32)`.
 *
 * Mixing `L` into the KDF binds the channel to the out-of-band secret: a server
 * that substituted its own public keys would not know `L` and could not produce
 * valid MACs, so the substitution is caught in §3.2 and §3.4.
 *
 * ⚠️ This does not defend against the RELAY variant of §3.6, and no key
 * derivation can. The attacker who holds `L` runs two honest pairings. The short
 * authentication string below is the only mechanism in this design that catches
 * it.
 */
export async function deriveChannelRoot(ownPrivate, peerPublic, linkSecret) {
  expectLength(linkSecret, LINK_SECRET_BYTES, "L");
  const shared = await x25519.dh(ownPrivate, peerPublic);
  return hkdf(concat(shared, linkSecret), INFO_CHANNEL_ROOT, 32);
}

/**
 * §3.6: `d = BE32(HKDF(R, "lpm-sas-v1", 4)) mod 1000000`, displayed as six
 * digits, zero-padded.
 *
 * ⚠️ The encoding is specified exactly and this function is written to match it
 * exactly, because the failure mode is not a security hole but something worse
 * for the product: two implementations that differ would show honest users a
 * mismatch on a legitimate channel, and would train people to ignore the one
 * check that catches a full man-in-the-middle. Big-endian, `mod 10^6`, not
 * truncation, zero-padded to six characters.
 *
 * ~20 bits is adequate because the comparison is one-shot and online — the
 * attacker must commit to a relay before the comparison happens and gets no
 * retries. Nobody may later "improve" this by comparing fewer digits.
 */
export async function shortAuthString(channelRoot) {
  expectLength(channelRoot, 32, "R");
  const bytes = await hkdf(channelRoot, INFO_SAS, 4);
  return String(readBe32(bytes) % 1000000).padStart(6, "0");
}

/**
 * The offer body of §3.1, ready to POST to /api/pair/{pairing_id}.
 *
 * It carries the COMMITMENT, never the key. `pow` comes from the caller (§9.1);
 * creating a pairing session requires it.
 */
export async function buildOffer(macKey, commit, pow) {
  return {
    role: ROLE_INITIATOR,
    commit: b64uEncode(commit),
    mac: b64uEncode(await macOffer(macKey, commit)),
    pow,
  };
}

/** The claim body of §3.2, ready to POST to /api/pair/{pairing_id}/claim. */
export async function buildClaim(macKey, joinerPublic, commit) {
  return {
    pub: b64uEncode(joinerPublic),
    mac: b64uEncode(await macClaim(macKey, joinerPublic, commit)),
  };
}

/**
 * The reveal body of §3.3, ready to POST to /api/pair/{pairing_id}/reveal.
 *
 * Sent only after `mac_J` has verified and `R` has been derived. It carries no
 * MAC of its own: the commitment already binds this value, and J checks it
 * against the commitment rather than against anything the server says.
 */
export function buildReveal(initiatorPublic) {
  expectLength(initiatorPublic, 32, "I_pub");
  return { pub: b64uEncode(initiatorPublic) };
}
