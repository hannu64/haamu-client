// The upgrade test. D-032 requires it and it is not optional.
//
// ## What it is for
//
// §6.2 needs Olm keys derived from the channel root `R`, and vodozemac has no
// constructor for chosen keys. The wrapper injects them through the pickle,
// which is a coupling to a structure outside vodozemac's semver guarantee. D-032
// spells out the failure mode: **if a release renames a pickle field, serde
// ignores the unknown key and leaves the randomly generated key in place.
// Nothing errors.** The result is a session that encrypts and decrypts perfectly
// and a channel that cannot be recovered on a new device — discovered weeks
// later by someone who has lost a conversation.
//
// `account_from_derived` has three guards against that, and they are worth
// having, but every one of them asks this build to check this build. They cannot
// see a change of *interpretation*, where the same 32 bytes become a different
// key on both sides at once. Two things here can:
//
//   * public keys computed by **Node's** HKDF and X25519 (`derive.mjs`), which
//     shares no code with vodozemac; and
//   * **ciphertext frozen before the upgrade**, which cannot move when the
//     library does.
//
// ## Run it
//
//   node test/upgrade.mjs
//
// on every vodozemac bump, before anything else, and read the failure text
// rather than regenerating the vectors.
//
// ⚠️ **2026-08-11: the wrapper's plaintext boundary changed from `String` to
// `Uint8Array` — §6.5 pads to a byte string that is not UTF-8 — and these vectors
// were NOT regenerated.** Only the comparisons below moved: they decode the bytes
// and compare against the same frozen text. That is exactly the distinction
// `gen-vectors.mjs` is about. Adapting the READER to a changed API keeps the
// evidence; re-running the generator would have destroyed it and replaced it with
// something that agrees with today's build by construction. The ciphertext, the
// pickle and the derived keys in `vectors/upgrade.json` are still the ones the
// first production build produced.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { load, check, done, text } from "./harness.mjs";
import { derivePublicKeys } from "./derive.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const v = JSON.parse(readFileSync(join(here, "vectors", "upgrade.json"), "utf8"));

const { LpmSession, prekeyPublicKeys, lpmBuildInfo } = await load();
const build = JSON.parse(lpmBuildInfo());

const ROOT = Buffer.from(v.root_b64u, "base64url");
const SESSION_ID = Buffer.from(v.session_id_b64u, "base64url");
const PICKLE_KEY = Buffer.from(v.pickle_key_b64u, "base64url");

console.log("LPM Olm wrapper — upgrade vectors\n");
console.log(`  vectors frozen ${v.frozen} by vodozemac ${v.producedBy.vodozemac}, wrapper ${v.producedBy.wrapper}`);
console.log(`  running        vodozemac ${build.vodozemac}, wrapper ${build.wrapper}`);
if (build.vodozemac !== v.producedBy.vodozemac) {
  console.log(`\n  ⚠️  VODOZEMAC HAS MOVED, ${v.producedBy.vodozemac} → ${build.vodozemac}.`);
  console.log("      This is the exact case these vectors exist for. If anything below");
  console.log("      fails, the upgrade is not safe to ship: sessions established by the");
  console.log("      old build would stop being recoverable, silently.");
}
console.log();

// --- 1. The derivation, computed by something that is not this crate. ------
// If this fails, either §6.2 was reimplemented differently or the vector file
// was regenerated — which is the one thing gen-vectors.mjs tells you not to do.
const derived = derivePublicKeys(ROOT, SESSION_ID);
for (const name of ["idk_I", "idk_J", "otk"]) {
  check(`§6.2 ${name} matches the frozen value, recomputed by Node`,
    derived[name] === v.derived_public_keys[name],
    derived[name] === v.derived_public_keys[name] ? derived[name].slice(0, 12) + "…"
      : `node ${derived[name]} vs frozen ${v.derived_public_keys[name]}`);
}

// --- 2. The keys the wrapper actually puts on the wire are those keys. -----
// This is the join between the independent computation and the library. `idk_J`
// is not on the wire and cannot be checked here — it is covered by step 3, which
// cannot succeed without its private half.
const wire = JSON.parse(prekeyPublicKeys(v.prekey_message));
check("the frozen pre-key message is addressed to the derived one-time key",
  wire.oneTimeKey === derived.otk, wire.oneTimeKey.slice(0, 12) + "…");
check("the frozen pre-key message carries the derived identity key",
  wire.identityKey === derived.idk_I, wire.identityKey.slice(0, 12) + "…");
check("T_0 is still not the base key", wire.ratchetKey !== wire.baseKey);

// --- 3. Key injection, against ciphertext this build did not produce. ------
// The one that matters. Opening this message requires the private halves of both
// idk_J and otk to come out of `R` exactly as they did before the upgrade. A
// renamed pickle field leaves a random key in place and this fails; every guard
// inside the wrapper would still pass.
let accepted = null;
try {
  accepted = LpmSession.accept(ROOT, SESSION_ID, v.prekey_message, "J");
} catch (e) {
  console.log(`  (accept threw: ${String(e?.message ?? e).split("\n")[0]})`);
}
check("KEY INJECTION: ciphertext frozen before the upgrade still opens",
  accepted !== null && text(accepted.plaintext) === v.prekey_plaintext);

// --- 4. Persistence, against a pickle this build did not produce. ----------
// A pickle format change is a legitimate thing for vodozemac to do and a
// catastrophic thing for us to ship unnoticed: every stored session on every
// device becomes unreadable. This turns that into a failed test.
let restored = null;
try {
  restored = LpmSession.unpickle(v.responder_pickle, PICKLE_KEY);
} catch (e) {
  console.log(`  (unpickle threw: ${String(e?.message ?? e).split("\n")[0]})`);
}
check("PERSISTENCE: a session pickled before the upgrade still restores", restored !== null);
check("PERSISTENCE: and the restored session still decrypts its next message",
  restored !== null && text(restored.decrypt(v.normal_message)) === v.normal_plaintext);

// --- 5. The OTHER direction: a session the pairing JOINER opened. ----------
//
// ⚠️⚠️ ADDED 2026-08-24, AND THE REASON IS THAT THIS DIRECTION HAD NO VECTOR AND
// TURNED OUT TO HAVE THE DEFECT. Until that date `initiate` used `idk_I` whoever
// called it, so a role-J device addressed its pre-key message from the wrong
// identity key — §6.2 says each party "uses only its own role's identity key", and
// the role there is §3's PAIRING role, fixed for the life of the channel, not
// "whoever is starting this session". §6.3 has either party open a session whenever
// it has no usable state, so role J does it routinely.
//
// ⭐⭐ NOTHING COULD SEE IT, AND THE REASON IS WORTH KEEPING. §6.2 gives both parties
// both private keys — that is its deniability property — so two copies of this
// wrapper talk perfectly with the roles swapped, every session opens, every message
// decrypts, and 25 of 25 checks pass. What breaks is a SECOND implementation built
// from PROTOCOL.md, which is exactly the reader this file exists to protect and
// exactly the one no test can be.
//
// ➡️ **WHEN BOTH SIDES ARE THE SAME IMPLEMENTATION, A SHARED MISREADING IS
// INDISTINGUISHABLE FROM THE SPECIFICATION.** The only witness that is not a party
// to it is `derive.mjs`, computing §6.2 from the document with Node's own primitives.
const J_SESSION_ID = Buffer.from(v.j_session_id_b64u, "base64url");
const jDerived = derivePublicKeys(ROOT, J_SESSION_ID);

for (const name of ["idk_I", "idk_J", "otk"]) {
  check(`§6.2 ${name} for the J session, recomputed by Node`,
    jDerived[name] === v.j_derived_public_keys[name]);
}

const jWire = JSON.parse(prekeyPublicKeys(v.j_prekey_message));
check("⭐⭐ the frozen role-J pre-key message is addressed FROM idk_J",
  jWire.identityKey === jDerived.idk_J,
  jWire.identityKey === jDerived.idk_J ? jWire.identityKey.slice(0, 12) + "…"
    : `wire ${jWire.identityKey.slice(0, 12)}… but idk_J is ${jDerived.idk_J.slice(0, 12)}…`);
check("⭐⭐ and NOT from idk_I — that was the defect frozen out on 2026-08-24",
  jWire.identityKey !== jDerived.idk_I);

let jAccepted = null;
try {
  jAccepted = LpmSession.accept(ROOT, J_SESSION_ID, v.j_prekey_message, "I");
} catch (e) {
  console.log(`  (role-I accept threw: ${String(e?.message ?? e).split("\n")[0]})`);
}
check("KEY INJECTION, other direction: a role-I device opens the joiner's message",
  jAccepted !== null && text(jAccepted.plaintext) === v.j_prekey_plaintext);

done();
