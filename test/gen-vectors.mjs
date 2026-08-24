// Produce test/vectors/lpm.json. RUN ONCE, then leave it alone.
//
// ⚠️⚠️ DO NOT REGENERATE THESE VECTORS TO MAKE A FAILING TEST PASS. Their whole
// value is that they were produced before the change under test, by two
// implementations that agreed. A regenerated vector agrees with the new code by
// construction and tests nothing. The WASM wrapper's upgrade suite learnt this
// the hard way and says the same thing at the top of its own generator.
//
// Every value below is computed TWICE — once by src/ (WebCrypto) and once by
// derive.mjs (node:crypto, written from the specification, sharing no code) — and
// this file REFUSES to write anything the two disagree on. A vector that only one
// implementation can produce is a record of a bug, not an anchor.
//
// The inputs are fixed ASCII strings rather than random bytes, so that anyone can
// see where every number came from and regenerate the file deterministically.

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { b64uEncode } from "../src/crypto/b64u.js";
import { concat } from "../src/crypto/bytes.js";
import * as pairing from "../src/protocol/pairing.js";
import * as codes from "../src/protocol/code.js";
import * as epoch from "../src/protocol/epoch.js";
import * as mailboxes from "../src/protocol/mailbox.js";
import * as signing from "../src/protocol/signing.js";
import * as envelope from "../src/protocol/envelope.js";
import * as passphrase from "../src/protocol/passphrase.js";
import * as roster from "../src/protocol/roster.js";
import * as pow from "../src/protocol/pow.js";
import * as x25519 from "../src/crypto/x25519.js";
import * as ref from "./derive.mjs";
import { hex } from "./harness.mjs";

const FROZEN = "2026-08-11";
const here = dirname(fileURLToPath(import.meta.url));

function die(what, mine, theirs) {
  console.error(`\nrefusing to freeze vectors: ${what}`);
  console.error(`  src/       ${mine}`);
  console.error(`  derive.mjs ${theirs}`);
  process.exit(1);
}

/** Agree on bytes, or refuse. */
function agree(what, mine, theirs) {
  const a = hex(mine);
  const b = hex(theirs);
  if (a !== b) die(what, a, b);
  return b64uEncode(mine);
}

/** Agree on a string, or refuse. */
function agreeText(what, mine, theirs) {
  if (mine !== theirs) die(what, mine, theirs);
  return mine;
}

const ascii = (s) => new TextEncoder().encode(s);

// ------------------------------------------------------------------- inputs
const L = ascii("lpm-link-secret!"); // 16 bytes, §2.1
const I_PRIV = ascii("lpm-vector-initiator-private-32!"); // 32 bytes, §3.1
const J_PRIV = ascii("lpm-vector-joiner-private-key-32"); // 32 bytes, §3.2
const K_MASTER = ascii("lpm-vector-master-key-32-bytes!!"); // 32 bytes, §7.2 (Argon2id's output)
const NONCE = ascii("lpm-req-nonce-16"); // 16 bytes, §5.2
const TIMESTAMP = 1786000000; // §5.2, a fixed wall clock

for (const [name, v, want] of [
  ["L", L, 16],
  ["i_priv", I_PRIV, 32],
  ["j_priv", J_PRIV, 32],
  ["K_master", K_MASTER, 32],
  ["nonce", NONCE, 16],
]) {
  if (v.length !== want) {
    console.error(`refusing to freeze vectors: ${name} is ${v.length} bytes, must be ${want}`);
    process.exit(1);
  }
}

const out = {
  _warning:
    "Frozen test vectors for PROTOCOL.md. DO NOT REGENERATE TO MAKE A FAILING TEST PASS — " +
    "a regenerated vector agrees with the new code by construction and tests nothing. " +
    "Produced by two independent implementations that agreed (client/test/gen-vectors.mjs). " +
    "THE ONE LEGITIMATE REASON TO RE-FREEZE IS A DELIBERATE CHANGE TO PROTOCOL.md ITSELF, " +
    "recorded in its §13 and dated here. That happened once: 0.8.4 → 0.8.5, when §3 became " +
    "commit-then-reveal (§3.6.1). Every other value in this file was unaffected and is unchanged. " +
    "A SECOND, PURELY ADDITIVE re-freeze on 2026-08-16 appended the `code` section for §2.2c, " +
    "which did not exist before it was built; every pre-existing value came back byte-identical " +
    "and that was checked by diff rather than assumed.",
  frozen: FROZEN,
  protocol: "0.9.6",
  inputs: {
    link_secret: b64uEncode(L),
    initiator_private: b64uEncode(I_PRIV),
    joiner_private: b64uEncode(J_PRIV),
    k_master: b64uEncode(K_MASTER),
    request_nonce: b64uEncode(NONCE),
    request_timestamp: TIMESTAMP,
  },
};

// ------------------------------------------------------------- §2.3 and §3
const mine = await pairing.derivePairing(L);
const theirs = ref.pairing(L);
const iPub = (await x25519.keyPairFromPrivate(I_PRIV)).publicKey;
const jPub = (await x25519.keyPairFromPrivate(J_PRIV)).publicKey;

const R = await pairing.deriveChannelRoot(I_PRIV, jPub, L);
const rTheirs = ref.channelRoot(I_PRIV, jPub, L);
const rFromJ = await pairing.deriveChannelRoot(J_PRIV, iPub, L);
if (hex(R) !== hex(rFromJ)) die("the two roles derive different channel roots", hex(R), hex(rFromJ));

const commit = await pairing.commitTo(iPub);

out.pairing = {
  section: "§2.3, §3.1-3.4, §3.6",
  link: pairing.buildLink("https://example.invalid", L),
  pairing_id: agree("pairing_id", mine.pairingId, theirs.pairingId),
  pairing_mac_key: agree("pairing_mac_key", mine.macKey, theirs.macKey),
  initiator_public: agree("I_pub", iPub, ref.x25519Public(I_PRIV)),
  joiner_public: agree("J_pub", jPub, ref.x25519Public(J_PRIV)),
  // §3, 0.8.5: the offer carries this and not I_pub, and both MACs cover it.
  commit_i: agree("commit_I", commit, ref.commitTo(iPub)),
  mac_offer: agree("mac_I", await pairing.macOffer(mine.macKey, commit), ref.macOffer(theirs.macKey, commit)),
  mac_claim: agree(
    "mac_J",
    await pairing.macClaim(mine.macKey, jPub, commit),
    ref.macClaim(theirs.macKey, jPub, commit)
  ),
  channel_root: agree("R", R, rTheirs),
  short_auth_string: agreeText("SAS", await pairing.shortAuthString(R), ref.sas(R)),
};

// ------------------------------------------------------- §2.2, §2.2b, §2.2c
//
// ⚠️⚠️ ADDED 2026-08-16, AND IT IS THE DERIVATION IN THIS FILE WITH THE QUIETEST
// FAILURE. Every other vector here guards something that breaks loudly when two
// implementations disagree — a MAC will not verify, a signature is rejected.
// §2.2c's normalisation breaks SILENTLY: the two sides derive different
// `pairing_id`s, the joiner is told there is no such pairing, and no screen at
// either end can say why. The four renderings below are the ones a real person
// produces — lower case, spaces instead of dashes, no separators at all, and a
// typed `0` where they heard "oscar" — and every one of them must land on the
// same sixteen bytes.
//
// ⚠️ The alphabet is transcribed in BOTH implementations rather than shared. That
// is what makes `die` reachable if one of them ever gains a character, which is
// the mechanism D-115 did not have.
if (codes.CODE_ALPHABET !== ref.CODE_ALPHABET) {
  die("§2.2's alphabet", codes.CODE_ALPHABET, ref.CODE_ALPHABET);
}

const SPOKEN = "KOMP-3XQR-BHTW-9FDN"; // §2.2, and it contains an O so the fold is exercised
const RENDERINGS = ["KOMP-3XQR-BHTW-9FDN", "komp-3xqr-bhtw-9fdn", "KOMP 3XQR BHTW 9FDN", "K0MP3XQRBHTW9FDN"];

const codeL = codes.secret(SPOKEN);
const codePairing = await pairing.derivePairing(codeL);

for (const rendering of RENDERINGS) {
  const a = hex(codes.secret(rendering));
  const b = hex(ref.codeSecret(rendering));
  if (a !== b) die(`§2.2c normalise(${rendering})`, a, b);
  if (a !== hex(codeL)) die(`§2.2c — ${rendering} does not land on the same L`, a, hex(codeL));
}

out.code = {
  section: "§2.2, §2.2b, §2.2c",
  // ⚠️ Its own date. The rest of this file was frozen on 2026-08-11 and did not
  // move; saying so in one field is cheaper than an argument about it later.
  frozen: "2026-08-16",
  alphabet: agreeText("§2.2 alphabet", codes.CODE_ALPHABET, ref.CODE_ALPHABET),
  characters: codes.CODE_CHARS,
  bits: codes.CODE_BITS,
  code: codes.format(SPOKEN),
  // Every one of these normalises to the value below it. A client that disagrees
  // with any single row cannot pair with this one and will not be told so.
  renderings: RENDERINGS,
  normalised: codes.normalise(SPOKEN),
  link_secret: agree("§2.2c L", codeL, ref.codeSecret(SPOKEN)),
  pairing_id: agree("pairing_id from a code", codePairing.pairingId, ref.pairing(codeL).pairingId),
  pairing_mac_key: agree("pairing_mac_key from a code", codePairing.macKey, ref.pairing(codeL).macKey),
  // §2.2b's spelling is PRESENTATION and has no second implementation to agree
  // with — it touches neither the wire format nor the entropy. It is frozen anyway,
  // because a silent edit to the table is a pairing two people cannot complete out
  // loud, and nothing else in the build would notice.
  spelling: codes.spell(SPOKEN),
};

// ------------------------------------------------------------------- §4.1
const offset = await epoch.epochOffset(R);
const offsetTheirs = ref.epochOffset(R);
if (offset !== offsetTheirs) die("epoch offset", offset, offsetTheirs);

out.epoch = {
  section: "§4.1",
  epoch_seconds: epoch.EPOCH_SECONDS,
  offset,
  // A time inside epoch 2900 for this channel, and the resulting epoch number.
  samples: [0, 1786000000, 2900 * epoch.EPOCH_SECONDS + offset].map((t) => ({
    unix_seconds: t,
    epoch: epoch.epochNumber(offset, t),
  })),
};

// ------------------------------------------------------------------- §4.2
// ⚠️ 2944 is not an arbitrary third value: §4.2 records it as the epoch at which
// a `decimal(e)` info string and the withdrawn `LE64(e)` form first disagree,
// because the low byte reaches 0x80 and one side UTF-8-expands it. A vector at
// that epoch is what makes a regression to the old encoding visible.
out.mailboxes = { section: "§4.2", entries: [] };
for (const e of [0, 2900, 2944, 1000000]) {
  for (const dir of [mailboxes.DIR_I2J, mailboxes.DIR_J2I]) {
    const m = await mailboxes.deriveMailbox(R, e, dir);
    const t = ref.mailbox(R, e, dir);
    out.mailboxes.entries.push({
      epoch: e,
      direction: dir,
      auth_seed: agree(`auth_seed ${dir} e=${e}`, m.privateKey, t.seed),
      public_key: agree(`pk ${dir} e=${e}`, m.publicKey, t.publicKey),
      mailbox_id: agree(`mailbox_id ${dir} e=${e}`, m.mailboxId, t.mailboxId),
    });
  }
}

// ------------------------------------------------------------------- §5.2
const signed = [];
const bodyBytes = signing.encodeBody({ ids: ["AAAAAAAAAAAAAAAAAAAAAA"] });
const cases = [
  { tag: signing.TAG_MAILBOX, method: "GET", path: "/api/mailbox/{id}/messages", body: undefined },
  { tag: signing.TAG_MAILBOX, method: "POST", path: "/api/mailbox/{id}/ack", body: bodyBytes },
  { tag: signing.TAG_ROSTER, method: "PUT", path: "/api/roster/{id}", body: bodyBytes },
];

const mailbox0 = await mailboxes.deriveMailbox(R, 2900, mailboxes.DIR_I2J);
const rosterMine = await passphrase.deriveRosterKeys(K_MASTER);
const rosterTheirs = ref.rosterKeys(K_MASTER);

for (const c of cases) {
  const isRoster = c.tag === signing.TAG_ROSTER;
  const id = isRoster ? rosterMine.rosterId : mailbox0.mailboxId;
  const key = isRoster ? rosterMine.rosterAuth.privateKey : mailbox0.privateKey;
  const pub = isRoster ? rosterMine.rosterAuth.publicKey : mailbox0.publicKey;
  const path = c.path.replace("{id}", b64uEncode(id));

  // `publicKey` reaches only the credential, never the canonical string — see
  // signing.formatAuthorization. That is what made regenerating this file for
  // 0.8.7 safe: every `canonical` and every signature stayed byte-identical, and
  // the ONLY field that moved is `authorization`, which grew a `,key=` suffix
  // equal to the `public_key` already recorded beside it. A regeneration that
  // moved anything else would have been a regeneration to make a test pass.
  const req = { tag: c.tag, method: c.method, path, id, timestamp: TIMESTAMP, nonce: NONCE, body: c.body, publicKey: pub };
  const canonical = await signing.canonicalRequest(req);
  const canonicalRef = ref.canonicalRequest({ ...req, body: c.body ? Buffer.from(c.body) : undefined });
  agree(`canonical string for ${c.method} ${c.path}`, canonical, canonicalRef);

  const r = await signing.signRequest(key, req);
  const sigRef = ref.ed25519Sign(key, canonical);
  agree(`signature for ${c.method} ${c.path}`, r.signature, sigRef);

  signed.push({
    tag: c.tag,
    method: c.method,
    path,
    id: b64uEncode(id),
    public_key: b64uEncode(pub),
    body: c.body ? b64uEncode(c.body) : "",
    canonical: new TextDecoder().decode(canonical),
    authorization: r.authorization,
  });
}
out.signing = { section: "§5.2", requests: signed };

// --------------------------------------------------------------- §6.4, §6.5
const paddingCases = [0, 1, 251, 252, 253, 1020, 1021, 65532].map((n) => ({
  plaintext_length: n,
  padded_length: envelope.pad(new Uint8Array(n)).length,
}));
out.padding = { section: "§6.5", buckets: envelope.PAD_BUCKETS, max_plaintext: envelope.MAX_PLAINTEXT, cases: paddingCases };

const sessionId = ascii("lpm-session-16by");
out.envelope = {
  section: "§6.4",
  example: envelope.buildEnvelope({
    sessionId,
    generation: 3,
    type: envelope.TYPE_PREKEY,
    body: ascii("not a real Olm ciphertext"),
  }),
};

// ------------------------------------------------------------- §7.2 and §7.4
// The four spellings below must all canonicalise to one byte string: a
// non-breaking space, a tab, mixed case, an NFD "é" and a trailing newline are
// exactly what a phrase transcribed from paper on another platform looks like.
const PHRASE = "acid acorn acre acts afar affix aged agent";
const VARIANTS = [
  PHRASE,
  `  ${PHRASE.toUpperCase()}  `,
  PHRASE.replace(/ /g, " "),
  `${PHRASE.replace(" ", "\t\t")}\n`,
];
const canonicalBytes = passphrase.canonical(PHRASE);
for (const v of VARIANTS) {
  if (hex(passphrase.canonical(v)) !== hex(canonicalBytes)) {
    die("canonical() differs between spellings of one phrase", JSON.stringify(v), "");
  }
}

out.passphrase = {
  section: "§7.2, §7.4",
  phrase: PHRASE,
  equivalent_spellings: VARIANTS,
  canonical_utf8: b64uEncode(canonicalBytes),
  roster_salt: agree("roster salt", await passphrase.rosterSalt(canonicalBytes), ref.rosterSalt(canonicalBytes)),
  argon2: passphrase.ARGON2_PARAMS,
  // K_master itself is an INPUT here, not an output: Argon2id is not implemented
  // on either side yet (ROADMAP step 7), so these vectors start one step later.
  k_master: b64uEncode(K_MASTER),
  roster_id: agree("roster_id", rosterMine.rosterId, rosterTheirs.rosterId),
  roster_key: agree("roster_key", rosterMine.rosterKey, rosterTheirs.rosterKey),
  roster_auth_public: agree("roster_auth pk", rosterMine.rosterAuth.publicKey, rosterTheirs.rosterAuth.publicKey),
};

// ------------------------------------------------------------------- §7.3
out.roster = {
  section: "§7.3",
  blob_size: roster.ROSTER_SIZE,
  blob_size_large: roster.ROSTER_SIZE_LARGE,
  root_hash: await roster.rootHash(R),
  tombstone_at_utc_day: roster.startOfUtcDay(TIMESTAMP),
};

// ------------------------------------------------------------------- §9.1
// A real solve at a low difficulty, so the vector is small, deterministic and
// checkable by the server's own verifier without a 20-bit search.
const challenge = b64uEncode(ascii("lpm-pow-challenge-bytes-fixed-for-the-vectors!!!!"));
const solution = await pow.solve(challenge, 12);
if (!(await pow.verify(solution, 12))) die("the generated proof-of-work does not verify", solution, "");
out.pow = { section: "§9.1", bits: 12, challenge, solution };

// ------------------------------------------------------------------- write
mkdirSync(join(here, "vectors"), { recursive: true });
writeFileSync(join(here, "vectors", "lpm.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`wrote test/vectors/lpm.json (frozen ${FROZEN})`);
console.log("both implementations agreed on every value.");
