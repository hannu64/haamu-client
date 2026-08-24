// End-to-end check of the LPM Olm wrapper, driven from JavaScript.
//
// Proves §6.2's bootstrap survives the WASM boundary, not just `cargo build`.
// This is the suite that answers "does it work"; `upgrade.mjs` is the one that
// answers "is it still doing the same thing as before the dependency moved".

import zlib from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load, check, rejects, done, DIST, bytes, text } from "./harness.mjs";
import { derivePublicKeys } from "./derive.mjs";

const { LpmSession, prekeyPublicKeys, lpmBuildInfo } = await load();

// The channel root R, agreed during pairing. Same value on both sides — that is
// the whole point: no key directory, no round trip.
const R = bytes("lpm-e2e-channel-root--32-bytes!!");
const SESSION_ID = new Uint8Array(16).fill(0x5e);

console.log("LPM Olm wrapper — end to end\n");

const build = JSON.parse(lpmBuildInfo());
check("the build reports what it is", !!build.wrapper && !!build.vodozemac,
  `wrapper ${build.wrapper}, vodozemac ${build.vodozemac}`);

// --- 1. The initiator starts a session from R alone. -----------------------
let t = process.hrtime.bigint();
const initiator = LpmSession.initiate(R, SESSION_ID, "I");
const initiateMs = Number(process.hrtime.bigint() - t) / 1e6;
check("initiator creates a session from R with no round trip", true, `${initiateMs.toFixed(1)} ms`);

const first = initiator.encrypt(bytes("the first message, sent before any reply exists"));
// §6.4's envelope: a named `type` and a base64url `body` — not the library's
// numeric `0:` prefix and not its standard-alphabet base64.
const firstEnv = JSON.parse(first);
check("first message is a pre-key message", firstEnv.type === "prekey", firstEnv.type);
check("body is base64url, unpadded (§0.1)",
  typeof firstEnv.body === "string" && !/[+/=]/.test(firstEnv.body));

// --- 2. The responder accepts, deriving its own keys from the same R. ------
t = process.hrtime.bigint();
const accepted = LpmSession.accept(R, SESSION_ID, first, "J");
const acceptMs = Number(process.hrtime.bigint() - t) / 1e6;
check("responder decrypts it having derived its keys from R",
  text(accepted.plaintext) === "the first message, sent before any reply exists",
  `${acceptMs.toFixed(1)} ms`);

const responder = accepted.takeSession();
check("plaintext is still readable after the session is taken",
  text(accepted.plaintext) === "the first message, sent before any reply exists");
rejects("taking the session twice is an error, not a trap",
  () => accepted.takeSession(), /already been called/);

// --- 3. Both sides agree on the Olm session id. ----------------------------
check("both sides compute the same Olm session id",
  initiator.olmSessionId() === responder.olmSessionId(), initiator.olmSessionId());

// --- 4. A full round trip, then a second turn. -----------------------------
const reply = responder.encrypt(bytes("a reply, which advances the DH ratchet"));
check("initiator decrypts the reply",
  text(initiator.decrypt(reply)) === "a reply, which advances the DH ratchet");
const second = initiator.encrypt(bytes("second turn"));
check("responder decrypts the second turn", text(responder.decrypt(second)) === "second turn");

// --- 5. T_0 is not the base key, checked through the wrapper. --------------
const pub = JSON.parse(prekeyPublicKeys(first));
check("T_0 differs from the base key", pub.ratchetKey !== pub.baseKey,
  `T_0=${pub.ratchetKey.slice(0, 10)}… base=${pub.baseKey.slice(0, 10)}…`);
check("every public key on the wire is base64url (§0.1)",
  Object.values(pub).every((k) => typeof k === "string" && !/[+/=]/.test(k)));

// --- 6. Persistence across a reload. --------------------------------------
const pickleKey = new Uint8Array(32).fill(7);
const restored = LpmSession.unpickle(initiator.pickle(pickleKey), pickleKey);
check("a pickled session survives a reload",
  text(responder.decrypt(restored.encrypt(bytes("sent after a page reload")))) === "sent after a page reload");
rejects("a wrong pickle key is rejected",
  () => LpmSession.unpickle(initiator.pickle(pickleKey), new Uint8Array(32).fill(8)),
  /unpickle/);

// --- 6b. THE OTHER DIRECTION: the pairing JOINER opens the session. --------
//
// ⚠️⚠️ THIS IS THE DIRECTION THAT WAS WRONG FROM THE FIRST BUILD UNTIL 2026-08-24,
// AND NO TEST COULD SEE IT, INCLUDING THIS ONE. `initiate` always used `idk_I` and
// `accept` always used `idk_J`, which reads §6.2's *"its own role's identity key"*
// as though I and J meant session initiator and responder rather than §3's fixed
// pairing roles. Both parties derive both private keys from `R` — §6.2's
// deniability property — so the pair below talks perfectly either way and every
// check above stays green. ➡️ **WHEN BOTH SIDES ARE THE SAME IMPLEMENTATION, A
// SHARED MISREADING IS INDISTINGUISHABLE FROM THE SPECIFICATION.**
//
// ⭐ So the check that has teeth is not "can they talk" — they always could. It is
// WHICH IDENTITY KEY IS ON THE WIRE, compared against a value `derive.mjs` computes
// from PROTOCOL.md with Node's own HKDF and X25519 and none of this crate's code.
// That is the only witness here that is not a party to the misreading.
{
  const jSessionId = new Uint8Array(16).fill(0x4a);
  const jStarts = LpmSession.initiate(R, jSessionId, "J");
  const jFirst = jStarts.encrypt(bytes("the joiner had no session and sent first"));

  const onWire = JSON.parse(prekeyPublicKeys(jFirst));
  const expected = derivePublicKeys(Buffer.from(R), Buffer.from(jSessionId));
  check("⭐⭐ a role-J device addresses its pre-key message FROM idk_J",
    onWire.identityKey === expected.idk_J,
    onWire.identityKey === expected.idk_J ? onWire.identityKey.slice(0, 12) + "…"
      : `wire ${onWire.identityKey.slice(0, 12)}… but idk_J is ${expected.idk_J.slice(0, 12)}…`);
  check("⭐⭐ and NOT from idk_I, which is what it did until 2026-08-24",
    onWire.identityKey !== expected.idk_I);
  check("the one-time key is the session's, whichever role responds",
    onWire.oneTimeKey === expected.otk);

  const iAccepts = LpmSession.accept(R, jSessionId, jFirst, "I");
  check("and a role-I device accepts it",
    text(iAccepts.plaintext) === "the joiner had no session and sent first");
  const iSide = iAccepts.takeSession();
  const back = iSide.encrypt(bytes("answered in the other direction"));
  check("the reply comes back the other way",
    text(jStarts.decrypt(back)) === "answered in the other direction");

  // ⚠️ AND THE CROSS: the roles are not interchangeable labels. A device that
  // answered with the WRONG role holds the wrong private key and cannot open it.
  rejects("a device that answers with the wrong pairing role cannot open it",
    () => LpmSession.accept(R, jSessionId, jFirst, "J"), /inbound session/);
}

// --- 6c. The role argument itself. ----------------------------------------
rejects("an unknown role is refused, not guessed",
  () => LpmSession.initiate(R, SESSION_ID, "i"), /pairing role/);
rejects("and an absent one is refused too",
  () => LpmSession.initiate(R, SESSION_ID, ""), /pairing role/);

// --- 7. Rejections. Every one of these is a caller error that must return an
// error rather than trap, because `panic = "abort"` poisons the instance. -----
rejects("a wrong-length root is rejected",
  () => LpmSession.initiate(bytes("too short"), SESSION_ID, "I"), /32 bytes/);
rejects("a wrong-length session_id is rejected",
  () => LpmSession.initiate(R, new Uint8Array(15).fill(0x5e), "I"), /16 bytes/);
rejects("a wrong-length pickle key is rejected",
  () => initiator.pickle(new Uint8Array(31)), /32 bytes/);
rejects("standard-alphabet base64 is rejected",
  () => LpmSession.accept(R, SESSION_ID, JSON.stringify({ type: "prekey", body: "AA+/" }), "J"),
  /base64url/);
rejects("an unknown envelope type is rejected",
  () => LpmSession.accept(R, SESSION_ID, JSON.stringify({ type: "olm", body: "AAAA" }), "J"),
  /prekey.*normal/);
rejects("a truncated envelope is rejected",
  () => LpmSession.accept(R, SESSION_ID, "{not json", "J"), /malformed/);
// A *well-formed* normal message, not a garbage one: garbage is rejected by the
// version check inside `decode` and would never reach the rule being tested.
check("the second turn really is a normal message", JSON.parse(second).type === "normal");
rejects("a normal message cannot open a session",
  () => LpmSession.accept(R, SESSION_ID, second, "J"), /pre-key/);
rejects("a wrong channel root cannot open the message",
  () => LpmSession.accept(bytes("lpm-e2e-WRONG-root----32-bytes!!"), SESSION_ID, first, "J"),
  /inbound session/);
rejects("a wrong session_id cannot open the message",
  () => LpmSession.accept(R, new Uint8Array(16).fill(0x11), first, "J"), /inbound session/);

// --- 8. Throughput on this machine. ---------------------------------------
const N = 2000;
t = process.hrtime.bigint();
for (let i = 0; i < N; i++) restored.encrypt(bytes(`bulk ${i}`));
check(`${N} encryptions`, true,
  `${(Number(process.hrtime.bigint() - t) / 1e6 / N).toFixed(3)} ms/message`);

// --- Payload size, as a browser would receive it. -------------------------
const fmt = (n) => `${(n / 1024).toFixed(0)} KB`;
let overTheWire = 0;
console.log("\n  payload, as served:");
for (const name of ["lpm_olm_wasm_bg.wasm", "lpm_olm_wasm.js"]) {
  const buf = readFileSync(join(DIST, name));
  const br = zlib.brotliCompressSync(buf).length;
  overTheWire += br;
  console.log(`    ${name.padEnd(22)} raw ${fmt(buf.length).padStart(7)}   ` +
    `gzip ${fmt(zlib.gzipSync(buf, { level: 9 }).length).padStart(7)}   brotli ${fmt(br).padStart(7)}`);
}
console.log(`    ${"TOTAL over the wire".padEnd(22)} brotli ${fmt(overTheWire)}`);

done();
