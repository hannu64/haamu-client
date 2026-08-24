// End-to-end check of the LPM Olm wrapper, driven from JavaScript.
//
// Proves §6.2's bootstrap survives the WASM boundary, not just `cargo build`.
// This is the suite that answers "does it work"; `upgrade.mjs` is the one that
// answers "is it still doing the same thing as before the dependency moved".

import zlib from "node:zlib";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load, check, rejects, done, DIST, bytes, text } from "./harness.mjs";

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
const initiator = LpmSession.initiate(R, SESSION_ID);
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
const accepted = LpmSession.accept(R, SESSION_ID, first);
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

// --- 7. Rejections. Every one of these is a caller error that must return an
// error rather than trap, because `panic = "abort"` poisons the instance. -----
rejects("a wrong-length root is rejected",
  () => LpmSession.initiate(bytes("too short"), SESSION_ID), /32 bytes/);
rejects("a wrong-length session_id is rejected",
  () => LpmSession.initiate(R, new Uint8Array(15).fill(0x5e)), /16 bytes/);
rejects("a wrong-length pickle key is rejected",
  () => initiator.pickle(new Uint8Array(31)), /32 bytes/);
rejects("standard-alphabet base64 is rejected",
  () => LpmSession.accept(R, SESSION_ID, JSON.stringify({ type: "prekey", body: "AA+/" })),
  /base64url/);
rejects("an unknown envelope type is rejected",
  () => LpmSession.accept(R, SESSION_ID, JSON.stringify({ type: "olm", body: "AAAA" })),
  /prekey.*normal/);
rejects("a truncated envelope is rejected",
  () => LpmSession.accept(R, SESSION_ID, "{not json"), /malformed/);
// A *well-formed* normal message, not a garbage one: garbage is rejected by the
// version check inside `decode` and would never reach the rule being tested.
check("the second turn really is a normal message", JSON.parse(second).type === "normal");
rejects("a normal message cannot open a session",
  () => LpmSession.accept(R, SESSION_ID, second), /pre-key/);
rejects("a wrong channel root cannot open the message",
  () => LpmSession.accept(bytes("lpm-e2e-WRONG-root----32-bytes!!"), SESSION_ID, first),
  /inbound session/);
rejects("a wrong session_id cannot open the message",
  () => LpmSession.accept(R, new Uint8Array(16).fill(0x11), first), /inbound session/);

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
