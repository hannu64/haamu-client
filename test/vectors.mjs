// Check src/ against the FROZEN vectors in vectors/lpm.json.
//
// rfc.mjs proves the primitives match published numbers. derive.mjs proves a
// second reading of the specification agrees today. This file proves the answers
// have not MOVED since the day they were frozen — the only one of the three that
// survives a refactor, a library bump, or a well-meaning "simplification" of an
// info string.
//
// The same file is read by the Go server's TestProtocolVectors, which is the
// check that actually matters for §5.2: client and server signing different byte
// strings is the failure that document spends a page warning about.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { b64uDecode, b64uEncode } from "../src/crypto/b64u.js";
import * as ed25519 from "../src/crypto/ed25519.js";
import * as pairing from "../src/protocol/pairing.js";
import * as codes from "../src/protocol/code.js";
import * as epoch from "../src/protocol/epoch.js";
import * as mailboxes from "../src/protocol/mailbox.js";
import * as signing from "../src/protocol/signing.js";
import * as envelope from "../src/protocol/envelope.js";
import * as payload from "../src/protocol/payload.js";
import * as passphrase from "../src/protocol/passphrase.js";
import * as roster from "../src/protocol/roster.js";
import * as pow from "../src/protocol/pow.js";
import * as x25519 from "../src/crypto/x25519.js";
import { check, equal, rejects, section, done, hex } from "./harness.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const v = JSON.parse(readFileSync(join(here, "vectors", "lpm.json"), "utf8"));

console.log(`frozen ${v.frozen}, PROTOCOL.md ${v.protocol}`);

const L = b64uDecode(v.inputs.link_secret);
const I_PRIV = b64uDecode(v.inputs.initiator_private);
const J_PRIV = b64uDecode(v.inputs.joiner_private);
const K_MASTER = b64uDecode(v.inputs.k_master);
const NONCE = b64uDecode(v.inputs.request_nonce);
const TIMESTAMP = v.inputs.request_timestamp;

// -------------------------------------------------------------- §2.3 and §3
section("§2.3, §3 — pairing");

const p = await pairing.derivePairing(L);
equal("pairing_id", b64uEncode(p.pairingId), v.pairing.pairing_id);
equal("pairing_mac_key", b64uEncode(p.macKey), v.pairing.pairing_mac_key);
equal("the link", pairing.buildLink("https://example.invalid", L), v.pairing.link);
equal("L parses back out of the link", hex(pairing.parseLink(v.pairing.link)), hex(L));

const iPub = (await x25519.keyPairFromPrivate(I_PRIV)).publicKey;
const jPub = (await x25519.keyPairFromPrivate(J_PRIV)).publicKey;
equal("I_pub", b64uEncode(iPub), v.pairing.initiator_public);
equal("J_pub", b64uEncode(jPub), v.pairing.joiner_public);

const commit = await pairing.commitTo(iPub);
equal("commit_I", b64uEncode(commit), v.pairing.commit_i);
check("the commitment opens to I_pub", await pairing.openCommitment(commit, iPub));
check("and to nothing else", !(await pairing.openCommitment(commit, jPub)));

equal("mac_I", b64uEncode(await pairing.macOffer(p.macKey, commit)), v.pairing.mac_offer);
equal("mac_J", b64uEncode(await pairing.macClaim(p.macKey, jPub, commit)), v.pairing.mac_claim);

check("J verifies mac_I", await pairing.verifyOffer(p.macKey, commit, b64uDecode(v.pairing.mac_offer)));
check("I verifies mac_J", await pairing.verifyClaim(p.macKey, jPub, commit, b64uDecode(v.pairing.mac_claim)));

const R = await pairing.deriveChannelRoot(I_PRIV, jPub, L);
equal("R, derived by I", b64uEncode(R), v.pairing.channel_root);
equal("R, derived by J", b64uEncode(await pairing.deriveChannelRoot(J_PRIV, iPub, L)), v.pairing.channel_root);
equal("the short authentication string", await pairing.shortAuthString(R), v.pairing.short_auth_string);
check("the SAS is six digits, zero-padded", /^[0-9]{6}$/.test(v.pairing.short_auth_string));

// ------------------------------------------------------- §2.2, §2.2b, §2.2c
section("§2.2 — the spoken code, and the four ways a person renders it");

/**
 * ⚠️⚠️ THE ONE FROZEN DERIVATION WHOSE FAILURE IS SILENT. Everywhere else in this
 * file a disagreement between two implementations announces itself — a MAC will not
 * verify, a signature is rejected. A disagreement about §2.2c's normalisation makes
 * two `pairing_id`s, and the only symptom is that the joiner is told there is no
 * such pairing. Both people then look at a correct code and a screen that cannot
 * explain itself.
 */
equal("§2.2's alphabet has not moved", codes.CODE_ALPHABET, v.code.alphabet);
equal("nor its length", String(codes.CODE_CHARS), String(v.code.characters));
equal("nor the entropy §2.2a's table rests on", String(codes.CODE_BITS), String(v.code.bits));

equal("the frozen code, formatted", codes.format(v.code.normalised), v.code.code);
equal("L from the code", b64uEncode(codes.secret(v.code.code)), v.code.link_secret);

for (const rendering of v.code.renderings) {
  equal(`"${rendering}" normalises to the same L`, b64uEncode(codes.secret(rendering)), v.code.link_secret);
}

{
  const cp = await pairing.derivePairing(codes.secret(v.code.code));
  equal("pairing_id, from a spoken code", b64uEncode(cp.pairingId), v.code.pairing_id);
  equal("pairing_mac_key, from a spoken code", b64uEncode(cp.macKey), v.code.pairing_mac_key);
}

// §2.2b. Presentation, and frozen anyway: a silent edit to the spelling table is a
// pairing two people cannot complete out loud, and nothing else would notice.
equal("§2.2b's spelling", JSON.stringify(codes.spell(v.code.code)), JSON.stringify(v.code.spelling));

// -------------------------------------------------------------------- §4.1
section("§4.1 — epochs");

const offset = await epoch.epochOffset(R);
equal("the per-channel offset", String(offset), String(v.epoch.offset));
check("the offset is inside one epoch", offset >= 0 && offset < epoch.EPOCH_SECONDS);
for (const s of v.epoch.samples) {
  equal(`epoch at t=${s.unix_seconds}`, String(epoch.epochNumber(offset, s.unix_seconds)), String(s.epoch));
}

// -------------------------------------------------------------------- §4.2
section("§4.2 — mailbox derivation");

for (const e of v.mailboxes.entries) {
  const m = await mailboxes.deriveMailbox(R, e.epoch, e.direction);
  equal(`auth_seed ${e.direction} e=${e.epoch}`, b64uEncode(m.privateKey), e.auth_seed);
  equal(`pk ${e.direction} e=${e.epoch}`, b64uEncode(m.publicKey), e.public_key);
  equal(`mailbox_id ${e.direction} e=${e.epoch}`, b64uEncode(m.mailboxId), e.mailbox_id);
  check(
    `mailbox_id ${e.direction} e=${e.epoch} commits to pk (§5.1)`,
    await mailboxes.verifyMailboxCommitment(b64uDecode(e.mailbox_id), b64uDecode(e.public_key))
  );
}

// The two directions must not collide — §4.2 exists because one shared mailbox
// makes a sender drain its own ciphertext.
const i2j = v.mailboxes.entries.filter((e) => e.direction === "i2j");
const j2i = v.mailboxes.entries.filter((e) => e.direction === "j2i");
check(
  "the two directions give different mailboxes in every epoch",
  i2j.every((a, k) => a.mailbox_id !== j2i[k].mailbox_id)
);
check(
  "consecutive epochs give unrelated mailboxes",
  new Set(v.mailboxes.entries.map((e) => e.mailbox_id)).size === v.mailboxes.entries.length
);

// -------------------------------------------------------------------- §5.2
section("§5.2 — request signing");

for (const r of v.signing.requests) {
  const id = b64uDecode(r.id);
  const body = r.body === "" ? undefined : b64uDecode(r.body);
  const canonical = await signing.canonicalRequest({
    tag: r.tag,
    method: r.method,
    path: r.path,
    id,
    timestamp: TIMESTAMP,
    nonce: NONCE,
    body,
  });
  equal(`canonical string, ${r.method} ${r.tag}`, new TextDecoder().decode(canonical), r.canonical);
  check(
    `canonical string is ASCII, ${r.method} ${r.tag}`,
    [...r.canonical].every((c) => c.charCodeAt(0) < 0x80)
  );
  check(`canonical string has seven fields, ${r.method}`, r.canonical.split("\n").length === 7);

  const parsed = signing.parseAuthorization(r.authorization);
  equal(`ts in the header, ${r.method}`, parsed.ts, String(TIMESTAMP));
  check(
    `the frozen signature verifies under the frozen public key, ${r.method} ${r.tag}`,
    await ed25519.verify(b64uDecode(r.public_key), b64uDecode(parsed.sig), canonical)
  );

  // ⭐ 0.8.7: the credential carries the signing key, because §5.1 requires an
  // authenticated read of a mailbox that does not exist and the server has no
  // stored key for one. It is NOT in the canonical string above — which is why
  // regenerating the vectors for 0.8.7 left every signature byte-identical.
  equal(`the credential carries the public key, ${r.method} ${r.tag}`, parsed.key, r.public_key);

  // Ed25519 is deterministic (RFC 8032), so re-signing must reproduce the header
  // byte for byte. If it ever does not, the canonical string moved.
  const pair =
    r.tag === signing.TAG_ROSTER
      ? (await passphrase.deriveRosterKeys(K_MASTER)).rosterAuth
      : await mailboxes.deriveMailbox(R, 2900, mailboxes.DIR_I2J);
  const again = await signing.signRequest(pair.privateKey, {
    tag: r.tag,
    method: r.method,
    path: r.path,
    id,
    timestamp: TIMESTAMP,
    nonce: NONCE,
    body,
    publicKey: pair.publicKey,
  });
  equal(`the Authorization header, ${r.method} ${r.tag}`, again.authorization, r.authorization);
}

// --------------------------------------------------------------- §6.4, §6.5
section("§6.4, §6.5 — envelope and padding");

for (const c of v.padding.cases) {
  const padded = envelope.pad(new Uint8Array(c.plaintext_length));
  equal(`pad(${c.plaintext_length})`, String(padded.length), String(c.padded_length));
  equal(`unpad(pad(${c.plaintext_length}))`, String(envelope.unpad(padded).length), String(c.plaintext_length));
}
equal("the bucket ladder", v.padding.buckets.join(","), envelope.PAD_BUCKETS.join(","));
equal("the inline maximum", String(v.padding.max_plaintext), String(envelope.MAX_PLAINTEXT));

const parsedEnvelope = envelope.parseEnvelope(v.envelope.example);
equal("envelope session_id", b64uEncode(parsedEnvelope.sessionId), v.envelope.example.session_id);
equal("envelope type", parsedEnvelope.type, v.envelope.example.type);
check("the envelope carries no eph_pub (§6.4)", !("eph_pub" in v.envelope.example));
check("the envelope carries no direction field (§4.2)", !("direction" in v.envelope.example));

// -------------------------------------------------------- §6.7, §6.7.1, §6.7.2
section("§6.7 — the payload, and §6.7.2's binding");

{
  const sessionId = b64uDecode(v.payload.example.session_id);
  const built = payload.buildPayload({
    text: v.payload.example.text,
    sentAt: v.payload.example.sent_at,
    sessionId,
    generation: v.payload.example.generation,
  });
  equal("the payload this build produces is the frozen one",
    JSON.stringify(built, Object.keys(v.payload.example).sort()),
    JSON.stringify(v.payload.example, Object.keys(v.payload.example).sort()));
  equal("payload v", String(payload.PAYLOAD_V), String(v.payload.v));
  equal("the version the binding starts at", String(payload.BINDING_FROM_V), String(v.payload.binding_from_v));

  // ⚠️ §6.5's bucket is the ONE thing about the encoding a server can observe, so it
  // is the one thing worth freezing. The byte string itself is not — see the `_note`.
  equal("and it pads to the frozen bucket",
    String(envelope.pad(payload.encodePayload(built)).length), String(v.payload.example_padded_length));

  const closing = payload.buildClosing({
    sentAt: v.payload.closing.sent_at,
    sessionId,
    generation: v.payload.closing.generation,
  });
  check("§6.7.1's notice still carries no words", !("text" in closing));
  equal("and pads to the same bucket, so the server cannot tell it from a message",
    String(envelope.pad(payload.encodePayload(closing)).length), String(v.payload.closing_padded_length));

  // ⭐⭐ THE ONE A SECOND IMPLEMENTATION CAN FAIL. Everything above says the payload
  // has the fields; this says the receiver ACTS on them. §6.7.2's whole value is the
  // comparison, and a build that carried both fields and compared neither would pass
  // every other line here.
  const sealed = payload.encodePayload(built);
  const honest = payload.decodePayload(sealed, { sessionId, generation: v.payload.example.generation });
  equal("an untouched envelope reads back as the message", honest.text, v.payload.example.text);
  const rewritten = payload.decodePayload(sealed, { sessionId, generation: Number.MAX_SAFE_INTEGER });
  check("⭐⭐ and a rewritten generation is refused, not adopted",
    rewritten instanceof payload.MisboundPayload, rewritten?.field);
}

// -------------------------------------------------------------- §7.2, §7.4
section("§7.2, §7.4 — passphrase derivations");

const canonicalBytes = passphrase.canonical(v.passphrase.phrase);
equal("canonical(phrase)", b64uEncode(canonicalBytes), v.passphrase.canonical_utf8);
for (const spelling of v.passphrase.equivalent_spellings) {
  equal(
    `canonical(${JSON.stringify(spelling.slice(0, 22))}…) is the same input`,
    b64uEncode(passphrase.canonical(spelling)),
    v.passphrase.canonical_utf8
  );
}
equal("the roster salt", b64uEncode(await passphrase.rosterSalt(canonicalBytes)), v.passphrase.roster_salt);

const rk = await passphrase.deriveRosterKeys(K_MASTER);
equal("roster_id", b64uEncode(rk.rosterId), v.passphrase.roster_id);
/*
  ⚠️⚠️ `roster_key` IS THE ONE VECTOR HERE THAT IS NO LONGER COMPARED AS BYTES, AND
  THAT IS §7.7 WORKING RATHER THAN A GAP IN THIS FILE. Its table says of this key
  *"yes — `deriveKey` produces it directly, never as bytes"* — so from 2026-08-24
  `deriveRosterKeys` returns a non-extractable `CryptoKey` and there are no bytes
  for `b64uEncode` to take. The frozen value did not move: it is the same 32 bytes
  the 2026-08-11 freeze recorded, and `test/derive.mjs` still computes them
  independently from PROTOCOL.md.

  ⭐ WHAT CHANGED IS HOW AGREEMENT IS PROVED, AND THE NEW PROOF IS THE STRONGER ONE.
  Sealing under the frozen bytes and opening with the derived key shows the two are
  the same key AND that the derived one reached WebCrypto as an AES-GCM key with the
  usages the roster needs — neither of which a string comparison could see. A byte
  comparison that passes while the key is imported for the wrong algorithm is a real
  failure mode; this one cannot have it.
*/
const frozenRosterKey = b64uDecode(v.passphrase.roster_key);
const sealedUnderFrozen = await roster.sealRoster(frozenRosterKey, roster.emptyRoster(TIMESTAMP));
let openedByDerived = null;
try {
  openedByDerived = await roster.openRoster(rk.rosterKey, sealedUnderFrozen.blob);
} catch (err) {
  console.log(`  (opening with the derived key threw: ${err.message})`);
}
check("⭐⭐ roster_key — the derived key OPENS what the frozen bytes sealed",
  openedByDerived?.roster?.written_at === TIMESTAMP);
check("⭐ and it is a CryptoKey that says it is not extractable (§7.7)",
  rk.rosterKey instanceof CryptoKey && rk.rosterKey.extractable === false);
// ⚠️ THE PATTERN IS NARROW ON PURPOSE. With `/.*/` this check passes when
// `rosterKey` is a `Uint8Array` again — `exportKey` then throws a TYPE error, which
// is an error, which satisfies "rejects". Measured while mutation-testing this very
// fix on 2026-08-24: the raw-bytes mutation left this line green and only the
// `instanceof` beside it went red. A refusal is only evidence if it is the RIGHT
// refusal.
await rejects("⭐⭐ and WebCrypto REFUSES to export it — the claim, not the flag",
  () => globalThis.crypto.subtle.exportKey("raw", rk.rosterKey), /extractab/i);
// ⚠️ The negative, in the same shape, so the check above is testing the key rather
// than AES-GCM's willingness to open anything.
const otherKeys = await passphrase.deriveRosterKeys(new Uint8Array(32).fill(0x77));
await rejects("a different key does not open the same blob",
  () => roster.openRoster(otherKeys.rosterKey, sealedUnderFrozen.blob), /.*/);
equal("roster_auth public key", b64uEncode(rk.rosterAuth.publicKey), v.passphrase.roster_auth_public);
equal("the Argon2id parameters (D-034)", JSON.stringify(passphrase.ARGON2_PARAMS), JSON.stringify(v.passphrase.argon2));

// -------------------------------------------------------------------- §7.3
section("§7.3 — the roster blob");

equal("root_hash of R", await roster.rootHash(R), v.roster.root_hash);
equal("tombstone day rounding", String(roster.startOfUtcDay(TIMESTAMP)), String(v.roster.tombstone_at_utc_day));
equal("the fixed blob size", String(roster.ROSTER_SIZE), String(v.roster.blob_size));

// -------------------------------------------------------------------- §9.1
section("§9.1 — proof-of-work");

check("the frozen solution still meets its difficulty", await pow.verify(v.pow.solution, v.pow.bits));
const parts = pow.parseSolution(v.pow.solution);
equal("the solution carries the challenge back", b64uEncode(parts.challenge), v.pow.challenge);
check("the solution is b64u(challenge).b64u(nonce)", v.pow.solution.split(".").length === 2);

done();
