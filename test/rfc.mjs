// The primitives, against PUBLISHED test vectors.
//
// ⭐ This file exists because of what the WASM wrapper's upgrade suite measured
// on 2026-08-11: with §6.2's HKDF output reversed, the 25-check functional suite
// passed 25 of 25. A suite that only ever talks to itself will certify a
// completely broken derivation. So the primitive layer is checked against numbers
// this project did not produce and cannot move — RFC 4648, RFC 4231, RFC 5869,
// RFC 7748 and RFC 8032, quoted with the section they came from.
//
// The lpm-specific derivations have no published vectors, because no other
// implementation exists yet. They are anchored differently, in derive.mjs.

import { b64uEncode, b64uDecode } from "../src/crypto/b64u.js";
import { sha256, hmacSha256 } from "../src/crypto/hash.js";
import { hkdf, hkdfWithSalt } from "../src/crypto/hkdf.js";
import * as x25519 from "../src/crypto/x25519.js";
import * as ed25519 from "../src/crypto/ed25519.js";
import { check, equal, rejects, section, done, unhex, ascii } from "./harness.mjs";

// ---------------------------------------------------------------- RFC 4648 §10
section("base64url — RFC 4648 §10, adapted to the URL alphabet without padding");

for (const [text, want] of [
  ["", ""],
  ["f", "Zg"],
  ["fo", "Zm8"],
  ["foo", "Zm9v"],
  ["foob", "Zm9vYg"],
  ["fooba", "Zm9vYmE"],
  ["foobar", "Zm9vYmFy"],
]) {
  equal(`b64u(${JSON.stringify(text)})`, b64uEncode(ascii(text)), want);
  if (want !== "") equal(`round trip ${JSON.stringify(text)}`, b64uDecode(want), ascii(text));
}

// The whole point of the URL alphabet: the two characters that differ.
equal("b64u uses - and _ where base64 uses + and /", b64uEncode(unhex("fbff")), "-_8");

await rejects("decode refuses the standard alphabet", () => b64uDecode("+_8"), /not base64url/);
await rejects("decode refuses padding", () => b64uDecode("Zg=="), /not base64url/);
await rejects("decode refuses whitespace", () => b64uDecode("Zm9v YmFy"), /not base64url/);
await rejects("decode refuses an impossible length", () => b64uDecode("Zm9vY"), /impossible/);
// "Zh" and "Zg" decode to the same byte; only one of them is canonical.
await rejects("decode refuses non-canonical trailing bits", () => b64uDecode("Zh"), /non-canonical/);

// ------------------------------------------------------------------- SHA-256
section("SHA-256 — NIST FIPS 180-4 examples");

equal(
  'SHA256("")',
  await sha256(ascii("")),
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
);
equal(
  'SHA256("abc")',
  await sha256(ascii("abc")),
  "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
);

// ------------------------------------------------------------- RFC 4231 §4.3
section("HMAC-SHA-256 — RFC 4231 test case 2");

equal(
  'HMAC("Jefe", "what do ya want for nothing?")',
  await hmacSha256(ascii("Jefe"), ascii("what do ya want for nothing?")),
  "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
);

// -------------------------------------------------------- RFC 5869 A.1 / A.3
section("HKDF-SHA-256 — RFC 5869 appendix A");

const IKM = unhex("0b".repeat(22));

equal(
  "A.1 basic test case, with a salt",
  await hkdfWithSalt(IKM, unhex("000102030405060708090a0b0c"), unhex("f0f1f2f3f4f5f6f7f8f9"), 42),
  "3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865"
);

// ⭐ A.3 is THE vector for this protocol: PROTOCOL.md §0.1 specifies HKDF with an
// empty salt everywhere, and this is the published answer for that case. RFC 5869
// defines an absent salt as HashLen zero bytes; WebCrypto is handed a zero-length
// salt. Agreeing with this number is what shows the two are the same thing.
equal(
  "A.3 zero-length salt and info — the shape §0.1 specifies",
  await hkdf(IKM, new Uint8Array(0), 42),
  "8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8"
);

await rejects(
  "hkdf refuses a non-ASCII info",
  () => hkdf(IKM, "lpm-café-v1", 32),
  /non-ASCII|§5\.2/
);

// -------------------------------------------------------------- RFC 7748 §6.1
section("X25519 — RFC 7748 §6.1");

const alicePriv = unhex("77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a");
const alicePub = "8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a";
const bobPriv = unhex("5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb");
const bobPub = "de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f";
const shared = "4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742";

check("X25519 is available in this runtime", await x25519.available());
equal("Alice's public key", (await x25519.keyPairFromPrivate(alicePriv)).publicKey, alicePub);
equal("Bob's public key", (await x25519.keyPairFromPrivate(bobPriv)).publicKey, bobPub);
equal("the shared secret, from Alice", await x25519.dh(alicePriv, unhex(bobPub)), shared);
equal("the shared secret, from Bob", await x25519.dh(bobPriv, unhex(alicePub)), shared);

// RFC 7748 §6.1's all-zero check. Nine is the base point's u-coordinate; the
// small-order point below is the canonical order-1 element.
await rejects(
  "a small-order peer key is refused, not silently agreed with",
  () => x25519.dh(alicePriv, new Uint8Array(32)),
  /small order|agreement failed/
);

// -------------------------------------------------------------- RFC 8032 §7.1
section("Ed25519 — RFC 8032 §7.1");

const ED = [
  {
    name: "TEST 1 (empty message)",
    seed: "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
    pub: "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
    msg: "",
    sig: "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
  },
  {
    name: "TEST 2 (one byte)",
    seed: "4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb",
    pub: "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c",
    msg: "72",
    sig: "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00",
  },
  {
    name: "TEST 3 (two bytes)",
    seed: "c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7",
    pub: "fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025",
    msg: "af82",
    sig: "6291d657deec24024827e69c3abe01a30ce548a284743a445e3680d7db5ac3ac18ff9b538d16f290ae67f760984dc6594a7c15e9716ed28dc027beceea1ec40a",
  },
];

check("Ed25519 is available in this runtime", await ed25519.available());
for (const t of ED) {
  const msg = unhex(t.msg);
  const pair = await ed25519.keyPairFromSeed(unhex(t.seed));
  equal(`${t.name}: public key from the 32-byte seed`, pair.publicKey, t.pub);
  equal(`${t.name}: signature`, await ed25519.sign(unhex(t.seed), msg), t.sig);
  check(`${t.name}: verifies`, await ed25519.verify(unhex(t.pub), unhex(t.sig), msg));
  const tampered = unhex(t.sig);
  tampered[0] ^= 0x01;
  check(`${t.name}: a tampered signature does not verify`, !(await ed25519.verify(unhex(t.pub), tampered, msg)));
}

done();
