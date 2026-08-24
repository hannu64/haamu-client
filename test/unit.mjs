// Behaviour the vectors cannot express: the refusals, the bounds checks, and the
// three places where PROTOCOL.md says two readings would diverge.
//
// Almost every check here exists because the specification records a specific way
// of getting it wrong. Where it does, the section number is in the label — a
// failure should tell you which paragraph you just broke.

import { compareBytes, timingSafeEqual } from "../src/crypto/bytes.js";
import { b64uEncode } from "../src/crypto/b64u.js";
import { seal, open } from "../src/crypto/aead.js";
import { randomBytes, randomIndex } from "../src/crypto/random.js";
import { sha256 } from "../src/crypto/hash.js";
import { detectPrimitives } from "../src/crypto/index.js";
import * as x25519 from "../src/crypto/x25519.js";
import * as ed25519 from "../src/crypto/ed25519.js";
import * as pairing from "../src/protocol/pairing.js";
import * as codes from "../src/protocol/code.js";
import * as epoch from "../src/protocol/epoch.js";
import * as mailboxes from "../src/protocol/mailbox.js";
import * as signing from "../src/protocol/signing.js";
import * as envelope from "../src/protocol/envelope.js";
import * as passphrase from "../src/protocol/passphrase.js";
import { WORDLIST, WORDLIST_SHA256 } from "../src/protocol/wordlist.js";
import * as roster from "../src/protocol/roster.js";
import * as pow from "../src/protocol/pow.js";
import { check, equal, rejects, section, done, hex, ascii } from "./harness.mjs";

const R = await sha256(ascii("a channel root for the unit tests"));

// ------------------------------------------------------------------- startup
section("§0.2 — startup feature detection");

const detected = await detectPrimitives();
check("X25519 and Ed25519 are both present here", detected.complete, JSON.stringify(detected));

// ⚠️⚠️ THE FALLBACK PATH, WITHOUT THE FALLBACK. §0.2's WASM implementation is
// built and checked in `client/curve/`, against WebCrypto, on both paths. What
// cannot be checked there is what happens when the implementation installed is
// NOT ours — and `installFallback` is a public hook that takes whatever it is
// given. So the one below is deliberately hostile: it returns the wrong length,
// it returns an all-zero shared secret, and it says yes to every signature.
//
// Every rule that survives it is a rule that lives in `x25519.js`/`ed25519.js`
// before the branch. Every rule that does not was a rule about WebCrypto wearing
// a function's name (D-076).
{
  const zeros = (n) => new Uint8Array(n);
  const hostile = {
    publicFromPrivate: () => zeros(32),
    publicFromSeed: () => zeros(32),
    dh: () => zeros(32), // the all-zero shared secret §3.3 must never accept
    sign: () => zeros(64),
    verify: () => true, // "yes" to everything, including a 63-byte signature
  };
  x25519.installFallback(hostile, { insteadOfWebCrypto: true });
  ed25519.installFallback(hostile, { insteadOfWebCrypto: true });

  await rejects(
    "§3.3's all-zero check holds for an implementation that is not ours",
    () => x25519.dh(randomBytes(32), randomBytes(32)),
    /small order/
  );
  await rejects(
    "a 31-byte private key is refused before any implementation sees it",
    () => x25519.keyPairFromPrivate(randomBytes(31)),
    /must be 32 bytes/
  );
  await rejects(
    "and a 33-byte peer public key",
    () => x25519.dh(randomBytes(32), randomBytes(33)),
    /must be 32 bytes/
  );
  await rejects(
    "a 31-byte Ed25519 seed is refused before it reaches a 32-byte buffer",
    () => ed25519.sign(randomBytes(31), ascii("x")),
    /must be 32 bytes/
  );
  check(
    "⭐ a 63-byte signature is false even when the implementation says true",
    !(await ed25519.verify(randomBytes(32), randomBytes(63), ascii("x")))
  );
  await rejects(
    "and a 31-byte public key is refused rather than asked about",
    () => ed25519.verify(randomBytes(31), randomBytes(64), ascii("x")),
    /must be 32 bytes/
  );

  // Put the client back on WebCrypto: nothing after this section may inherit a
  // hostile implementation, and a test file that leaves global state behind is
  // its own kind of defect.
  x25519.installFallback(null);
  ed25519.installFallback(null);
  check("the hostile implementation is uninstalled again", (await detectPrimitives()).complete);
}

// -------------------------------------------------------------------- §6.3
section("§6.3 — session_id ordering, the trap that would split implementations");

// The exact pair §6.3 rule 2 names: as raw bytes x > y, but b64u(x) < b64u(y),
// because '0' is ASCII 48 and 'B' is 66. Two clients comparing the encoded
// strings would each conclude the other's session had won.
const x = new Uint8Array(16);
const y = new Uint8Array(16);
x[15] = 0xd0;
y[15] = 0x04;
check("as 16 raw bytes, x > y", compareBytes(x, y) > 0);
check("as base64url text, x < y — which is why the rule says RAW BYTES", b64uEncode(x) < b64uEncode(y));

check("timingSafeEqual agrees with itself", timingSafeEqual(x, x.slice()));
check("timingSafeEqual rejects a one-bit difference", !timingSafeEqual(x, y));

// --------------------------------------------------------------------- §2, §3
section("§2, §3 — pairing");

const L = pairing.newLinkSecret();
equal("L is 16 bytes", String(L.length), "16");
const { macKey } = await pairing.derivePairing(L);
const i = await (await import("../src/crypto/x25519.js")).generateKeyPair();
const j = await (await import("../src/crypto/x25519.js")).generateKeyPair();

// ⚠️⚠️ THE REGRESSION TEST FOR §3.6.1. The offer must carry a HASH and never the
// key: if I_pub is published up front, the joiner — or an attacker in the
// joiner's position holding L — picks its own key after seeing it and grinds the
// six-digit SAS to match a second channel in seconds. This one line is what fails
// if anyone ever "simplifies" the handshake back to two messages.
const commit = await pairing.commitTo(i.publicKey);
const offer = await pairing.buildOffer(macKey, commit, "pow");
check("the offer carries a commitment", offer.commit === (await import("../src/crypto/b64u.js")).b64uEncode(commit));
check("⭐ the offer does NOT carry I_pub (§3.6.1)", !("pub" in offer));

check("the commitment opens to the key it was made from", await pairing.openCommitment(commit, i.publicKey));
check("and to no other key", !(await pairing.openCommitment(commit, j.publicKey)));
check(
  "a commitment to a different key is a different commitment",
  hex(commit) !== hex(await pairing.commitTo(j.publicKey))
);

const macI = await pairing.macOffer(macKey, commit);
check("a good offer MAC verifies", await pairing.verifyOffer(macKey, commit, macI));
const tampered = macI.slice();
tampered[0] ^= 0x80;
check("a tampered offer MAC does not", !(await pairing.verifyOffer(macKey, commit, tampered)));
check(
  "an offer MAC under a different key does not",
  !(await pairing.verifyOffer((await pairing.derivePairing(pairing.newLinkSecret())).macKey, commit, macI))
);

// §3.2's MAC binds J_pub to the commitment, so a claim cannot be replayed against
// a substituted offer.
const macJ = await pairing.macClaim(macKey, j.publicKey, commit);
check(
  "a claim MAC is bound to BOTH J_pub and the commitment",
  !(await pairing.verifyClaim(macKey, j.publicKey, await pairing.commitTo(j.publicKey), macJ))
);
check(
  "the reveal body carries the key and nothing else",
  JSON.stringify(Object.keys(pairing.buildReveal(i.publicKey))) === '["pub"]'
);

const rI = await pairing.deriveChannelRoot(i.privateKey, j.publicKey, L);
const rJ = await pairing.deriveChannelRoot(j.privateKey, i.publicKey, L);
equal("both roles derive the same R", hex(rI), hex(rJ));
const rWrongLink = await pairing.deriveChannelRoot(i.privateKey, j.publicKey, pairing.newLinkSecret());
check("R is bound to L — a different link gives a different root", hex(rI) !== hex(rWrongLink));

await rejects("a link with the wrong secret length is refused", () => pairing.parseLink("https://x/c#AAAA"), /expected 16 bytes/);
await rejects("a link with no fragment is refused", () => pairing.parseLink("https://x/c"), /no fragment/);

// ------------------------------------------------------ §2.2, §2.2b, §2.2c
section("§2.2 — the spoken code, its alphabet, and the L it makes");

/**
 * ⚠️⚠️ THE FIRST FOUR CHECKS ARE D-115, AND D-115 IS WHY THEY ARE CHECKS AT ALL.
 * §2.2 carried the parenthesis "(32 chars; 0/O/1/I/L excluded)" beside an alphabet
 * of 31 characters, for eleven days, through two outside triages and a rewrite of
 * the same eight lines. Nobody counts a parenthesis. **A stated property of a list
 * is an assertion**, and the only thing that ever tests one is arithmetic.
 */
equal(`the alphabet is 32 characters — §2.2's own figure`, String(codes.CODE_ALPHABET.length), "32");
check(
  "⭐ it is a power of two, which is what makes 16 characters exactly 80 bits",
  Number.isInteger(Math.log2(codes.CODE_ALPHABET.length)) && codes.CODE_BITS === 80,
  `${codes.CODE_BITS} bits`
);
equal("no character is in it twice", String(new Set(codes.CODE_ALPHABET).size), "32");
equal(
  "§2.2's four excluded characters are absent",
  ["0", "1", "I", "L"].filter((c) => codes.CODE_ALPHABET.includes(c)).join(","),
  ""
);

// §2.2c's three normalisation rules, each on its own, then together.
equal("§2.2c — lower case is folded up", codes.normalise("k7mp3xqrbhtw9fdn"), "K7MP3XQRBHTW9FDN");
equal("§2.2c — dashes and spaces are dropped", codes.normalise("K7MP-3XQR BHTW-9FDN"), "K7MP3XQRBHTW9FDN");
equal("§2.2c — a typed 0 becomes O, which is the one fold there is", codes.normalise("0"), "O");
equal(
  "⚠️ and the fold is ONE-WAY: O is in the alphabet, 0 is not, so nothing collides",
  `${codes.CODE_ALPHABET.includes("O")} ${codes.CODE_ALPHABET.includes("0")}`,
  "true false"
);
equal(
  "a character in neither the alphabet nor the fold is dropped, not kept",
  codes.normalise("K7MP-3XQR-BHTW-9FD!"),
  "K7MP3XQRBHTW9FD"
);

/**
 * ⚠️ `toUpperCase`, NEVER `toLocaleUpperCase`. In a Turkish locale the latter maps
 * "i" to "İ" — outside the alphabet, therefore silently deleted rather than folded
 * to "I" (which is excluded anyway). The failure would be a code that works
 * everywhere except on one person's phone, which is §7.2's `canonical()` trap in a
 * second place. This asserts the property rather than the call.
 */
equal("locale-independent case folding", codes.normalise("mnop").length, 4);

/**
 * §2.2c: `L = ASCII(normalise(s))`, and the point of choosing it is right here —
 * `L` is still 16 bytes, so every `expectLength(L, 16)` in §3 is untouched (D-116).
 */
{
  const spoken = codes.newCode();
  const Lc = codes.secret(spoken);
  equal("§2.2c — L from a code is 16 bytes, the same length §2.1 gives", String(Lc.length), "16");
  equal("and it is the ASCII of the normalised characters", hex(ascii(spoken)), hex(Lc));
  equal(
    "⭐ so the dashes a person types change nothing at all",
    hex(codes.secret(codes.format(spoken))),
    hex(Lc)
  );
  equal("and neither does lower case", hex(codes.secret(spoken.toLowerCase())), hex(Lc));

  // The pairing derivation takes it unchanged — the whole reason this encoding won.
  const derived = await pairing.derivePairing(Lc);
  equal("§2.3 derives from it with no special case", String(derived.pairingId.length), "16");
}

equal("§2.2 — a fresh code is 16 characters", String(codes.newCode().length), "16");
check(
  "and every character of it is in the alphabet",
  [...codes.newCode()].every((c) => codes.CODE_ALPHABET.includes(c)),
  codes.format(codes.newCode())
);
equal("§2.2's grouping is four groups of four", codes.format("ABCDEFGHJKMNPQRS"), "ABCD-EFGH-JKMN-PQRS");
// ⚠️ THE FROZEN VECTOR CAUGHT THIS ON ITS FIRST RUN. `format` used to slice every
// fourth character of whatever it was handed, so formatting an already-formatted
// code counted the dashes and gave `KOMP--3XQ-R-BH-TW-9-FDN`. A display helper that
// mangles its own output is a trap for every later caller.
equal("⭐ and formatting is idempotent", codes.format("ABCD-EFGH-JKMN-PQRS"), "ABCD-EFGH-JKMN-PQRS");

// ⭐ Two codes must differ. A generator that returned a constant would pass every
// other check on this page, and the pairing would still work — for everybody, with
// each other.
check("two codes drawn in a row are not the same", codes.newCode() !== codes.newCode());

await rejects("a short code is refused, with the count in the message", () => codes.secret("ABCD-EFGH"), /found 8/);
await rejects("and so is a long one", () => codes.secret(`${codes.newCode()}XY`), /found 18/);
check("looksLikeCode says no to a link", !codes.looksLikeCode("https://haamu.app/c#abc"), "url");
check("and yes to sixteen characters of the alphabet", codes.looksLikeCode(codes.format(codes.newCode())));

/**
 * §2.2b, and it is a MUST in the specification rather than a nicety (D-113): the
 * alphabet was chosen for an eye and this section's channel is an ear.
 */
{
  const missing = [...codes.CODE_ALPHABET].filter((c) => !codes.SPELLING[c]);
  const extra = Object.keys(codes.SPELLING).filter((c) => !codes.CODE_ALPHABET.includes(c));
  equal("§2.2b — every character has a spelling word", missing.join(","), "");
  equal("and no spelling word survives for a character that left the alphabet", extra.join(","), "");
  equal(
    "no two characters share a word — being distinct is the entire job",
    String(new Set(Object.values(codes.SPELLING)).size),
    "32"
  );
  equal("the spelling comes back grouped like the code", codes.spell("BCDE2345PTVZ6789").length, 4);
  equal("first group of that code", codes.spell("BCDE2345PTVZ6789")[0].join(" "), "Bravo Charlie Delta Echo");
}

// -------------------------------------------------------------------- §4.1
section("§4.1 — epochs");

const offset = await epoch.epochOffset(R);
check("the offset is inside one epoch", offset >= 0 && offset < epoch.EPOCH_SECONDS);
const t = 1786000000;
const e = epoch.epochNumber(offset, t);
equal("the epoch boundary is where it says", String(epoch.epochNumber(offset, e * epoch.EPOCH_SECONDS + offset)), String(e));
equal("one second earlier is the previous epoch", String(epoch.epochNumber(offset, e * epoch.EPOCH_SECONDS + offset - 1)), String(e - 1));
equal("a client polls three epochs", epoch.pollEpochs(e).join(","), `${e - 1},${e},${e + 1}`);

// -------------------------------------------------------------------- §4.2
section("§4.2 — mailbox derivation");

equal("I writes to i2j", mailboxes.outboundDirection("I"), "i2j");
equal("I reads j2i", mailboxes.inboundDirection("I"), "j2i");
equal("J writes to j2i", mailboxes.outboundDirection("J"), "j2i");
equal("J reads i2j", mailboxes.inboundDirection("J"), "i2j");
await rejects("an unknown role is refused", () => mailboxes.outboundDirection("K"), /expected "I" or "J"/);
await rejects("an unknown direction is refused", () => mailboxes.deriveMailbox(R, 1, "both"), /i2j.*j2i|expected/);
await rejects("a non-integer epoch is refused", () => mailboxes.deriveMailbox(R, 1.5, "i2j"), /non-negative safe integer/);

// ⚠️ The epochs either side of §4.2's divergence point. A `decimal(e)` info and
// the withdrawn `LE64(e)` form agree below 2944 and disagree from it — these two
// derivations differing is what a regression would look like.
const at2943 = await mailboxes.deriveMailbox(R, 2943, "i2j");
const at2944 = await mailboxes.deriveMailbox(R, 2944, "i2j");
check("e=2943 and e=2944 give different mailboxes", hex(at2943.mailboxId) !== hex(at2944.mailboxId));
check("mailbox_id commits to its own key", await mailboxes.verifyMailboxCommitment(at2944.mailboxId, at2944.publicKey));
check(
  "mailbox_id does not commit to another key (§5.1 — this is what stops squatting)",
  !(await mailboxes.verifyMailboxCommitment(at2944.mailboxId, at2943.publicKey))
);

const both = await mailboxes.deriveChannelMailboxes(R, 2900, "I");
check("a channel's two mailboxes differ", hex(both.inbound.mailboxId) !== hex(both.outbound.mailboxId));

// -------------------------------------------------------------------- §5.2
section("§5.2 — request signing refuses what it cannot sign safely");

const mb = await mailboxes.deriveMailbox(R, 2900, "i2j");
const base = {
  tag: signing.TAG_MAILBOX,
  method: "POST",
  path: "/api/mailbox/x/send",
  id: mb.mailboxId,
  timestamp: 1786000000,
  nonce: signing.newNonce(),
};

await rejects("a query string in PATH", () => signing.canonicalRequest({ ...base, path: "/api/x?y=1" }), /query string/);
await rejects("a newline in PATH", () => signing.canonicalRequest({ ...base, path: "/api/x\n/y" }), /newline/);
await rejects("a relative PATH", () => signing.canonicalRequest({ ...base, path: "api/x" }), /absolute path/);
await rejects("a non-ASCII PATH", () => signing.canonicalRequest({ ...base, path: "/api/käyttäjä" }), /non-ASCII/);
await rejects("a lower-case method", () => signing.canonicalRequest({ ...base, method: "post" }), /upper-case/);
await rejects("an unknown tag", () => signing.canonicalRequest({ ...base, tag: "lpm-req-v1" }), /expected lpm-req/);
await rejects("a short nonce", () => signing.canonicalRequest({ ...base, nonce: randomBytes(8) }), /expected 16 bytes/);
await rejects("a non-integer timestamp", () => signing.canonicalRequest({ ...base, timestamp: 1.5 }), /safe integer/);
await rejects("an id of the wrong size", () => signing.canonicalRequest({ ...base, id: randomBytes(15) }), /16-byte/);
await rejects("a body that is not bytes", () => signing.canonicalRequest({ ...base, body: "{}" }), /exact request bytes/);

// The two surfaces sign different strings even for an otherwise identical request.
const asMailbox = await signing.canonicalRequest(base);
const asRoster = await signing.canonicalRequest({ ...base, tag: signing.TAG_ROSTER });
check("the tag names the surface, so the two differ (§5.2)", hex(asMailbox) !== hex(asRoster));

// The empty body hashes SHA256(""), not nothing.
const noBody = await signing.canonicalRequest(base);
const emptyBody = await signing.canonicalRequest({ ...base, body: new Uint8Array(0) });
check("an absent body and an empty body are the same string", hex(noBody) === hex(emptyBody));

equal("a clock 4 minutes fast is diagnosable from the Date header", String(signing.clockSkewFromDate("Wed, 21 Oct 2026 07:28:00 GMT", Math.floor(Date.parse("Wed, 21 Oct 2026 07:32:00 GMT") / 1000))), "240");
equal("no Date header, no diagnosis", String(signing.clockSkewFromDate(undefined, 0)), "null");

// ⭐ 0.8.7: the credential carries the signing key, because §5.1 requires an
// authenticated read of a mailbox the server has no stored key for. A client that
// built one without would work against every mailbox that happens to exist and 401
// against epoch `e+1` — an intermittent authentication failure, which is the exact
// outcome §5.2 spends a page preventing. So it is refused at construction rather
// than discovered at the server.
await rejects(
  "a credential with no key (§5.2, 0.8.7)",
  () => signing.formatAuthorization({ timestamp: 1786000000, nonce: signing.newNonce(), signature: randomBytes(64) }),
  /public key/
);
await rejects(
  "an Authorization header missing key=",
  () => signing.parseAuthorization("LPM-Ed25519 ts=1,nonce=AA,sig=BB"),
  /missing key/
);
{
  const signed = await signing.signRequest(mb.privateKey, { ...base, publicKey: mb.publicKey });
  const parsed = signing.parseAuthorization(signed.authorization);
  equal("and a signed request carries the mailbox's own key", parsed.key, b64uEncode(mb.publicKey));
}

// -------------------------------------------------------------- §6.4 / §6.5
section("§6.4, §6.5 — envelope and padding");

const padded = envelope.pad(ascii("hello"));
equal("a short message pads to the first bucket", String(padded.length), "256");
equal("unpad recovers it", new TextDecoder().decode(envelope.unpad(padded)), "hello");
await rejects("65533 bytes is a file blob, not a message (§6.5)", () => envelope.pad(new Uint8Array(65533)), /65532/);

// ⚠️ §6.5: "The receiver MUST bounds-check true_length against the decrypted
// buffer before using it. The field is attacker-influenced in the malicious-peer
// case."
const hostile = padded.slice();
new DataView(hostile.buffer).setUint32(0, 0xffffff, true);
await rejects("a declared length beyond the buffer", () => envelope.unpad(hostile), /exceeds/);

await rejects("an envelope of the wrong version", () => envelope.parseEnvelope({ ...validEnvelope(), v: 2 }), /unsupported version/);
await rejects("an envelope with an unknown type", () => envelope.parseEnvelope({ ...validEnvelope(), type: "olm" }), /bad type/);
await rejects("an envelope with a negative generation", () => envelope.parseEnvelope({ ...validEnvelope(), generation: -1 }), /bad generation/);
await rejects("an envelope whose body is standard base64 (§6.4)", () => envelope.parseEnvelope({ ...validEnvelope(), body: "a+b/c=" }), /not base64url/);
await rejects("an envelope with an empty body", () => envelope.parseEnvelope({ ...validEnvelope(), body: "" }), /empty body/);
await rejects("an envelope with a short session_id", () => envelope.parseEnvelope({ ...validEnvelope(), session_id: "AAAA" }), /expected 16 bytes/);

function validEnvelope() {
  return envelope.buildEnvelope({
    sessionId: envelope.newSessionId(),
    generation: 1,
    type: "prekey",
    body: ascii("ciphertext"),
  });
}

// -------------------------------------------------------------- §7.2 / §7.4
section("§7.2, §7.4 — the phrase");

equal("the wordlist is 1296 words", String(WORDLIST.length), "1296");
equal(
  "the wordlist is the frozen one",
  hex(await sha256(ascii(WORDLIST.join("\n") + "\n"))),
  WORDLIST_SHA256
);
check("every word is 3-5 letters (§7.4)", WORDLIST.every((w) => w.replace("-", "").length >= 3 && w.length <= 5));
check("the list is sorted and unique", WORDLIST.every((w, k) => k === 0 || WORDLIST[k - 1] < w));

const phrase = passphrase.generatePhrase();
equal("a phrase is 8 words", String(phrase.split(" ").length), "8");
check("every word comes from the list", phrase.split(" ").every((w) => WORDLIST.includes(w)));
check("the phrase is already canonical (§7.2)", passphrase.canonicalText(phrase) === phrase);
equal("the long form is 10 words", String(passphrase.generatePhrase(10).split(" ").length), "10");
await rejects("§7.4 offers two lengths and no others", () => passphrase.generatePhrase(12), /8 or 10 words/);
equal("a candidate set is six phrases", String(passphrase.generateCandidates().length), "6");

check(
  "a phrase typed with odd spacing and case still matches",
  passphrase.phraseMatches(phrase, `  ${phrase.toUpperCase().replace(" ", "  ")}\n`)
);
check("a phrase with a word missing does not", !passphrase.phraseMatches(phrase, phrase.split(" ").slice(1).join(" ")));

// Two different draws must not collide — a wordlist that returned a constant
// would pass every other test in this file.
check("two generated phrases differ", passphrase.generatePhrase() !== passphrase.generatePhrase());

// §7.4's rejection sampling. Not a proof of uniformity — a smoke test that would
// catch a modulo folded over three buckets, which is the bug it warns about.
const counts = [0, 0, 0];
for (let k = 0; k < 30000; k++) counts[randomIndex(3)]++;
check(
  "randomIndex(3) is not visibly biased",
  counts.every((c) => Math.abs(c - 10000) < 1000),
  counts.join("/")
);

await rejects("K_master needs Argon2id, and says so rather than stubbing it", () => passphrase.deriveMaster("x"), /Argon2id is not installed/);
check("Argon2id is not installed yet (ROADMAP step 7)", !passphrase.argon2idAvailable());

// -------------------------------------------------------------------- §7.3
section("§7.3 — the roster blob");

const rosterKey = randomBytes(32);
const small = roster.emptyRoster(1786000000);
const full = {
  ...small,
  channels: Array.from({ length: 20 }, (_, k) => ({
    root: b64uEncode(randomBytes(32)),
    name: `contact ${k}`,
    role: k % 2 ? "I" : "J",
    generation: 1,
    created: 1786000000,
  })),
};

const sealedEmpty = await roster.sealRoster(rosterKey, small);
const sealedFull = await roster.sealRoster(rosterKey, full);
equal(
  "an empty roster and a 20-channel roster are the same size on the wire (§7.3)",
  String(sealedEmpty.blob.length),
  String(sealedFull.blob.length)
);

const reopened = await roster.openRoster(rosterKey, sealedFull.blob);
equal("the roster round-trips", String(reopened.roster.channels.length), "20");
await rejects("a roster under the wrong key does not open", () => roster.openRoster(randomBytes(32), sealedFull.blob), /.*/);

const flipped = sealedFull.blob.slice();
flipped[40] ^= 0x01;
await rejects("a tampered roster does not open", () => roster.openRoster(rosterKey, flipped), /.*/);

check("two seals of the same roster differ (fresh IV, §0.2)", hex(sealedEmpty.blob) !== hex((await roster.sealRoster(rosterKey, small)).blob));
equal("the growth rule is one-way", String(roster.chooseSize(100, roster.ROSTER_SIZE_LARGE)), String(roster.ROSTER_SIZE_LARGE));
await rejects("beyond 64 KiB the client must refuse, not drop tombstones", () => roster.chooseSize(70000, roster.ROSTER_SIZE_LARGE), /refusing further|exceeds/);

// -------------------------------------------------------------------- §0.2
section("§0.2 — AEAD");

const key = randomBytes(32);
const sealed = await seal(key, ascii("plaintext"));
equal("the IV is prepended", String(sealed.length), String(12 + 9 + 16));
equal("it opens", new TextDecoder().decode(await open(key, sealed)), "plaintext");
const bad = sealed.slice();
bad[bad.length - 1] ^= 0x01;
await rejects("a flipped tag does not open", () => open(key, bad), /.*/);
await rejects("a truncated blob is refused before decryption", () => open(key, sealed.slice(0, 20)), /too short/);

// -------------------------------------------------------------------- §9.1
section("§9.1 — proof-of-work");

const challenge = b64uEncode(randomBytes(48));
const solution = await pow.solve(challenge, 10);
check("a solution meets its difficulty", await pow.verify(solution, 10));
check("it does not meet a much higher one", !(await pow.verify(solution, 24)));
equal("the challenge travels back with it", pow.parseSolution(solution).challenge.length, "48");
await rejects("a solution without the separator is refused", () => pow.parseSolution("AAAA"), /separator/);
equal("leading zero bits of 0x00 0x0f…", String(pow.leadingZeroBits(Uint8Array.from([0, 0x0f, 0xff]))), "12");
equal("leading zero bits of 0xff", String(pow.leadingZeroBits(Uint8Array.from([0xff]))), "0");

// ⚠️⚠️ THE SEARCH NO LONGER RUNS ON WEBCRYPTO (2026-08-13), so from here on these
// checks are not about §9.1's arithmetic — they are about whether the private
// hash inside `pow.js` IS SHA-256. `verify()` is WebCrypto, so every `solve`
// below that passes its `verify` is one agreement between the two.
//
// ⚠️ THE CHALLENGE LENGTHS ARE THE POINT, NOT THE DIFFICULTIES. Padding is where
// a hand-written SHA-256 goes wrong, and the length decides the padding:
//
//   47 → 55 bytes  one block, padding fits with room
//   48 → 56 bytes  one block, the last length that fits at all
//   56 → 64 bytes  TWO blocks — §9.1's real shape, and the boundary case where
//                  the message exactly fills a block and the padding is a whole
//                  second one
//   57 → 65 bytes  two blocks, one byte over
//  120 →128 bytes  three blocks: NOT searchable, so this exercises the WebCrypto
//                  fallback inside `solve` rather than the private hash
for (const len of [47, 48, 56, 57, 120]) {
  const c = b64uEncode(randomBytes(len));
  const s = await pow.solve(c, 12);
  check(`a ${len}-byte challenge (${len + 8} bytes hashed) solves and verifies`, await pow.verify(s, 12));
  equal(`…and carries its ${len} bytes back`, pow.parseSolution(s).challenge.length, String(len));
}

// The extremes of the `bits` range, where `Math.clz32` is doing the comparison
// the old code did by walking bytes. 1 bit is satisfied by half of all nonces;
// 32 would take 4 billion, so it is only checked for the range guard.
check("1 bit solves and verifies", await pow.verify(await pow.solve(b64uEncode(randomBytes(56)), 1), 1));
await rejects("0 bits is out of range", () => pow.solve(challenge, 0), /out of range/);
await rejects("33 bits is out of range", () => pow.solve(challenge, 33), /out of range/);

// Exhaustion is a NAMED failure now, not a bare `Error` — round 5's diagnostics
// panel printed `problem  Error` and that told nobody anything. Two attempts at
// 32 bits will not find a solution.
const exhausted = await pow.solve(challenge, 32, { maxAttempts: 2 }).catch((e) => e);
equal("running out of attempts has a reason", exhausted.reason, "pow_exhausted");

done();
