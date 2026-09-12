// §7.5's WebAuthn PRF wrapper — the mechanism, and nothing that knows about a screen.
//
// ⚠️⚠️ THIS IS NOT AN AUTHENTICATION CEREMONY AND MUST NOT BE READ AS ONE. There is
// no relying-party server here, nobody verifies the attestation, and the signature
// over the challenge is thrown away unread. **The only thing this takes from WebAuthn
// is the PRF output** — 32 bytes the authenticator computes for this origin and this
// salt, which it will compute identically tomorrow and will not compute for anybody
// else's origin. Everything protective about that comes from the authenticator's own
// refusal to evaluate without a user-verification gesture, which is why
// `userVerification: "required"` and the UV-flag check below are the whole of the
// security here and the challenge is not.
//
// ⚠️ SO A RANDOM CHALLENGE IS CORRECT AND A SERVER-ISSUED ONE WOULD BUY NOTHING. A
// challenge exists to stop replay against a verifier. There is no verifier.
//
// ⚠️⚠️ WHAT THIS BUYS AND WHAT IT DOES NOT (§7.5, measured — open items 4c and 4e-i).
// The wrapped `K_master` is local to ONE browser on ONE device; the PRF output is
// account-bound and travels to every device the platform account can enrol. **The
// wrap key travels; the ciphertext does not.** So this removes the KEY from the daily
// unlock on a device that has already been set up, and never from setting one up.
//
// ⛔ AND THE RECORD HAS EXACTLY ONE JOB (D-193 rule 2). It unwraps this browser's own
// blob. It is not a device identity, it may not stand in for possession anywhere in
// §3's pairing, and no sentence in the product may describe it as proving that this
// device is yours — a synced passkey proves the platform account holder was there and
// touched something, which is a different claim.

import * as aead from "../crypto/aead.js";
import { utf8Bytes } from "../crypto/bytes.js";
import { b64uDecode, b64uEncode } from "../crypto/b64u.js";
import { sha256 } from "../crypto/hash.js";
import { hkdfKey } from "../crypto/hkdf.js";
import { randomBytes } from "../crypto/random.js";

/** §7.5's two labels, exactly as the protocol writes them. */
export const PRF_SALT_LABEL = "lpm-prf-v1";
export const WRAP_INFO = "lpm-wrap-v1";

/** What the platform's saved-password list will show. */
export const RP_NAME = "haamu";

/**
 * ⚠️⚠️ THE USER HANDLE IS RANDOM PER ENROLMENT, AND THE TIDY ALTERNATIVE IS A TRAP.
 *
 * A **constant** handle would make each new enrolment REPLACE the credential instead
 * of adding one, which looks like the answer to §7.5.1's *"five accumulated passkeys,
 * none of them removable by the page that created them"*. It is not, because passkeys
 * sync: replacement is account-wide, not browser-wide.
 *
 * ➡️ And open item 4e-i measured that the CIPHERTEXT does not travel, so **enrolling a
 * second device is the ordinary thing a two-device person does** — and under a constant
 * handle that ordinary act would silently break the first device's quick unlock every
 * time. Accumulation is disclosed (§7.5.2) and costs the person a list entry; the tidy
 * option costs them the feature on the device they still use.
 */
const HANDLE_BYTES = 16;

/** ⚠️ Refusals, each its own value so each can have its own sentence (D-163). */
export const NO_API = "no_api"; // this browser has no WebAuthn at all
export const DECLINED = "declined"; // the platform sheet was dismissed
export const NO_PRF = "no_prf"; // credential made, PRF absent or empty
export const NOT_PLATFORM = "not_platform"; // answered from somewhere that is not here
export const NOT_VERIFIED = "not_verified"; // UV was asked for and not delivered
export const NO_RECORD = "no_record"; // nothing stored to evaluate against
export const FAILED = "failed"; // anything else the platform threw

/** The stored record's version. Everything else about it is in `encodeRecord`. */
export const RECORD_V = 1;

/**
 * Is there anything here to try? A shape test and deliberately nothing more.
 *
 * ⚠️⚠️ THIS IS NOT A SUPPORT CHECK AND MUST NEVER BE USED AS ONE. §7.5 records the
 * measurement that makes the distinction: a current Samsung flagship reports
 * `extension:prf: true` from `getClientCapabilities()` and returns **nothing at all**
 * from the round trip. The authority is the round trip. What this answers is the much
 * smaller question of whether the call would throw a `TypeError` before reaching it —
 * which is what decides whether a screen may mention the feature.
 */
export function available(credentials = globalThis.navigator?.credentials) {
  return Boolean(credentials && typeof credentials.create === "function" && typeof credentials.get === "function");
}

/** §7.5: `salt = SHA256("lpm-prf-v1")`. */
export async function prfSalt() {
  return sha256(utf8Bytes(PRF_SALT_LABEL));
}

/**
 * The flags byte of `authenticatorData`, which is the only part of it this client
 * reads. Layout is fixed by WebAuthn: `rpIdHash` (32) || `flags` (1) || `signCount` (4).
 *
 * ⚠️⚠️ `uv` IS NORMATIVE AND THE OTHER THREE ARE DIAGNOSTICS. §7.5 requires the client
 * to PARSE this flag rather than trust that asking for verification produced it —
 * WebAuthn's default is `"preferred"`, under which mere presence satisfies the
 * ceremony on some platforms, and a tap on an already-unlocked device would then
 * unwrap `K_master` and through it every channel root.
 *
 * ⭐ `be` and `bs` are here because they are the one measurement of §7.5.2's privacy
 * cost that the device itself will state: `be` means this credential is eligible to
 * be backed up to the platform account, `bs` that it currently is. They gate nothing —
 * the disclosure is made BEFORE the credential exists, so it must be written for the
 * case where both are set — but a panel that can report them turns an argument into a
 * reading.
 */
export function flagsOf(authenticatorData) {
  const bytes = asBytes(authenticatorData);
  if (!bytes || bytes.length < 37) return null;
  const f = bytes[32];
  return { up: (f & 0x01) !== 0, uv: (f & 0x04) !== 0, be: (f & 0x08) !== 0, bs: (f & 0x10) !== 0 };
}

/**
 * `wrap_key = HKDF(prf_out, "lpm-wrap-v1", 32)`, straight into a non-extractable key.
 *
 * ⚠️ §7.7's rule, applied to the one new key this feature introduces: the wrap key's
 * bytes never exist in JavaScript, because `deriveKey` produces it directly. The PRF
 * output itself cannot be given that treatment — the platform hands it over as bytes —
 * which is why every caller here zeroes it the moment it has been used.
 */
export async function wrapKeyFrom(prfOut) {
  if (!(prfOut instanceof Uint8Array) || prfOut.length !== 32) {
    throw new RangeError("passkey: PRF output must be 32 bytes — see PROTOCOL.md §7.5");
  }
  return hkdfKey(prfOut, WRAP_INFO, { name: "AES-GCM", length: 256 }, ["encrypt", "decrypt"]);
}

/**
 * What the ciphertext is bound to.
 *
 * ⚠️ THE SAME REASONING `storage/vault.js` GIVES FOR ITS SLOT, FOR THE SAME REASON. A
 * record that authenticates only its own bytes is valid in every row of the store, so
 * one identity's blob moved into another's row would be opened by whatever key happens
 * to unwrap it. Binding the scope makes "it opened" a statement about **this** row.
 */
export function aadFor(scope) {
  if (typeof scope !== "string" || !scope) throw new RangeError("passkey: scope is required");
  return utf8Bytes(`lpm-unlock-v1|${scope}`);
}

/** `stored = AES-256-GCM(wrap_key, K_master)`, bound to the row it will live in. */
export async function sealMaster(prfOut, kMaster, scope) {
  if (!(kMaster instanceof Uint8Array) || kMaster.length !== 32) {
    throw new RangeError("passkey: K_master must be 32 bytes");
  }
  return aead.seal(await wrapKeyFrom(prfOut), kMaster, aadFor(scope));
}

/**
 * The other direction — and it is the direction that defends itself (D-193 rule 1).
 * A `wrap_key` derived from the wrong authenticator fails the GCM tag and throws, so a
 * caller gets no partial answer and falls through to the KEY. Nothing is watching at
 * SEAL time, which is why the attachment check below lives there.
 */
export async function openMaster(prfOut, blob, scope) {
  return aead.open(await wrapKeyFrom(prfOut), blob, aadFor(scope));
}

/**
 * §7.5.1: `{ credential_id, rk_requested, wrapped_K_master }` as ONE record, never
 * more than one, written only after a successful PRF evaluation.
 *
 * ⚠️ IT IS STORED IN THE CLEAR AND IT HAS TO BE. Every other record in this client is
 * sealed under `local_key`, which derives from `K_master` — the thing inside this one.
 * A record that could only be read after unlocking is a record that cannot be used to
 * unlock. What protects the payload is the wrap key, and nothing here pretends
 * otherwise; `storage/db.js` gives it its own object store so that the exception is
 * structural rather than remembered.
 */
export function encodeRecord({ credentialId, rkRequested, blob }) {
  return {
    v: RECORD_V,
    id: b64uEncode(asBytes(credentialId)),
    rk: rkRequested,
    blob: b64uEncode(blob),
  };
}

/** The inverse, answering `null` rather than throwing — the caller is a launch path. */
export function decodeRecord(rec) {
  if (!rec || rec.v !== RECORD_V || typeof rec.id !== "string" || typeof rec.blob !== "string") return null;
  try {
    return { credentialId: b64uDecode(rec.id, "credential id"), blob: b64uDecode(rec.blob, "wrapped K_master") };
  } catch {
    return null;
  }
}

function asBytes(v) {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  return null;
}

function prfFirst(credential) {
  const results = credential?.getClientExtensionResults?.();
  const first = asBytes(results?.prf?.results?.first);
  // ⚠️ LENGTH IS CHECKED AND NOT PRESENCE. The Samsung reading in §7.5 returned the
  // field with **zero bytes** in it, which is truthy in every shape test and is not a key.
  return first && first.length === 32 ? first : null;
}

/**
 * ⛔⛔ D-193 RULE 1, AND IT IS APPLIED TO THE WRAPPING ASSERTION BECAUSE THAT IS THE
 * ONE DIRECTION NOTHING ELSE WATCHES.
 *
 * A desktop browser with no platform authenticator offers *"use a phone"* over hybrid
 * transport. That assertion succeeds and returns 32 perfectly good bytes, and the
 * record it produces looks exactly like a healthy one — while what it has actually
 * built is a device whose daily unlock needs a second device in the room, after §7.5.2
 * has promised the person *"this browser on this device"*.
 *
 * ⚠️ `null` IS REFUSED ALONG WITH `"cross-platform"`. A value that cannot be verified
 * has not been verified, and the fall-through costs an Argon2id rather than a secret.
 */
function attachedHere(credential) {
  return credential?.authenticatorAttachment === "platform";
}

function challenge() {
  return randomBytes(32);
}

/**
 * Create the credential and evaluate the PRF once, in that order, on this device.
 *
 * ⚠️⚠️ ONE CEREMONY AND ONE `residentKey` VALUE — THE ESCALATION LADDER IS GONE, AND
 * ITS OWN MEASUREMENT IS WHAT REMOVED IT. §7.5.1 kept a `discouraged`-then-`required`
 * ladder after the platform split was struck, on the reasoning that trying the cheaper
 * credential first is how a client discovers whether PRF works at all. But the same
 * section measured that `discouraged` **returns nothing on Android** and that iOS
 * produces a discoverable, listed, synced credential no matter which value is asked
 * for. So the cheap rung works nowhere Android is, buys no privacy where iOS is, and
 * on Android leaves behind a **permanently listed passkey that can never be deleted**
 * before the second rung is even tried. ➡️ **A ladder whose first rung cannot succeed
 * and cannot be cleaned up is a way of charging the user twice for one feature.**
 *
 * ⚠️ `extensions.prf: {}` at `create()` and the evaluation at a later `get()` — §7.5
 * is explicit that evaluation at `create()` is not available everywhere and MUST NOT
 * be relied on. This is the path measured on all six panel devices.
 */
export async function enrol({ credentials = globalThis.navigator?.credentials, kMaster, scope, rpId = undefined }) {
  if (!available(credentials)) return { ok: false, reason: NO_API };
  const salt = await prfSalt();
  const publicKey = {
    rp: rpId ? { id: rpId, name: RP_NAME } : { name: RP_NAME },
    user: { id: randomBytes(HANDLE_BYTES), name: RP_NAME, displayName: RP_NAME },
    challenge: challenge(),
    // ES256 first, RS256 for authenticators that have only ever done RSA.
    pubKeyCredParams: [
      { type: "public-key", alg: -7 },
      { type: "public-key", alg: -257 },
    ],
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      residentKey: "required",
      userVerification: "required",
    },
    extensions: { prf: {}, credProps: true },
  };

  let created;
  try {
    created = await credentials.create({ publicKey });
  } catch {
    // ⚠️ EVERY THROW FROM THE SHEET IS READ AS A DECLINE, AND THAT IS THE HONEST
    // READING RATHER THAN A LAZY ONE. `NotAllowedError` covers a dismissal, a timeout
    // and a platform that has no authenticator to offer, and WebAuthn deliberately
    // does not distinguish them so that a page cannot probe for what is installed.
    return { ok: false, reason: DECLINED };
  }
  if (!created) return { ok: false, reason: DECLINED };
  if (!attachedHere(created)) return { ok: false, reason: NOT_PLATFORM };

  // ⚠️ `credProps.rk` IS A DIAGNOSTIC AND NEVER THE TEST (§7.5.1). Safari returns no
  // `credProps` result at all, so it is three-valued — true, false, unknown — and a
  // client that read it as a boolean would call Safari's working credential a failure.
  const rk = created.getClientExtensionResults?.()?.credProps?.rk;
  const rkRequested = rk === true ? "required" : rk === false ? "refused" : "unknown";

  const got = await evaluateWith(credentials, [asBytes(created.rawId ?? created.id)], salt);
  if (!got.ok) return got;

  try {
    const blob = await sealMaster(got.prfOut, kMaster, scope);
    return {
      ok: true,
      record: encodeRecord({ credentialId: asBytes(created.rawId), rkRequested, blob }),
      flags: got.flags,
    };
  } finally {
    got.prfOut.fill(0);
  }
}

/**
 * Ask the authenticator for the PRF output behind a user-verification gesture.
 *
 * `entries` are `{ scope, credentialId }` — every unlock record in this browser, asked
 * for in ONE ceremony.
 *
 * ⚠️⚠️ ONE PROMPT FOR ALL OF THEM, AND THE ALTERNATIVE IS WHY. A browser can hold two
 * identities (D-170), so it can hold two unlock records; trying them one at a time
 * would put one biometric sheet in front of the person per identity, and the second
 * would appear only after the first had been refused. `allowCredentials` takes the
 * whole list, the platform offers what it can answer, and the response names which one
 * it was.
 */
export async function evaluate({ credentials = globalThis.navigator?.credentials, entries }) {
  if (!available(credentials)) return { ok: false, reason: NO_API };
  const list = (entries ?? []).filter((e) => e && typeof e.scope === "string" && asBytes(e.credentialId));
  if (list.length === 0) return { ok: false, reason: NO_RECORD };

  const salt = await prfSalt();
  const got = await evaluateWith(
    credentials,
    list.map((e) => asBytes(e.credentialId)),
    salt
  );
  if (!got.ok) return got;

  const answered = got.credentialId;
  const match = list.find((e) => sameBytes(asBytes(e.credentialId), answered));
  if (!match) {
    got.prfOut.fill(0);
    // ⚠️ The platform answered with a credential this browser has no record for. It is
    // not a failure of the authenticator and it is not the person's doing — it is a
    // stale entry in their account, from an identity that has since ended here.
    return { ok: false, reason: NO_RECORD };
  }
  return { ok: true, scope: match.scope, prfOut: got.prfOut, flags: got.flags };
}

async function evaluateWith(credentials, ids, salt) {
  let assertion;
  try {
    assertion = await credentials.get({
      publicKey: {
        challenge: challenge(),
        // ⚠️ `transports: ["internal"]` IS A HINT AND NOT THE CHECK. It tells the
        // browser to prefer the authenticator built into this device rather than
        // offering the QR/hybrid route, which makes the common case quiet; D-193 rule 1
        // is still enforced by reading `authenticatorAttachment` off the response,
        // because a hint the platform may ignore cannot be a rule.
        allowCredentials: ids.map((id) => ({ type: "public-key", id, transports: ["internal"] })),
        userVerification: "required",
        extensions: { prf: { eval: { first: salt } } },
      },
    });
  } catch {
    return { ok: false, reason: DECLINED };
  }
  if (!assertion) return { ok: false, reason: DECLINED };
  if (!attachedHere(assertion)) return { ok: false, reason: NOT_PLATFORM };

  const flags = flagsOf(assertion.response?.authenticatorData);
  // ⚠️⚠️ ASKING FOR VERIFICATION IS NOT RECEIVING IT (§7.5). Fail closed, the same
  // shape as §6.1's pickle guard — an absent or unreadable `authenticatorData` is a
  // missing answer and never an assumed one.
  if (!flags?.uv) return { ok: false, reason: NOT_VERIFIED };

  const prfOut = prfFirst(assertion);
  if (!prfOut) return { ok: false, reason: NO_PRF };

  return { ok: true, prfOut, flags, credentialId: asBytes(assertion.rawId) };
}

function sameBytes(a, b) {
  // ⚠️ NOT `timingSafeEqual`. A credential id is public — it is stored in the clear and
  // the platform hands it back — so there is no secret here to leak through a timing
  // difference, and the lengths genuinely differ between entries.
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
