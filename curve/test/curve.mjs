// The X25519/Ed25519 fallback, against the artefact `build.sh` just produced.
//
// ⚠️⚠️ **THE CHECK THAT MATTERS IS NOT A ROUND TRIP AND NOT A PUBLISHED VECTOR —
// IT IS THE AGREEMENT SECTION.** A fallback that is self-consistent and passes RFC
// 7748 and RFC 8032 can still disagree with WebCrypto, and if it does, the
// disagreement appears on somebody's phone and nowhere else: two devices in one
// conversation, one on each implementation, deriving different shared secrets from
// the same handshake. Node has both, so this file is the one place in the build
// where the two implementations can be put side by side and asked the same
// questions — every §0.2 vector runs twice, once per path, and then each path is
// asked to accept the other's work.
//
// The published vectors are here too, because agreement with WebCrypto would also
// be satisfied by two implementations that are wrong in the same way. Neither
// check subsumes the other.

import { readFileSync } from "node:fs";
import * as curve from "../../src/crypto/curve.js";
import * as x25519 from "../../src/crypto/x25519.js";
import * as ed25519 from "../../src/crypto/ed25519.js";
import { randomBytes } from "../../src/crypto/random.js";
import { check, equal, rejects, section, done, hex, unhex, ascii } from "../../test/harness.mjs";

const WASM = new URL("../dist/lpm_curve.wasm", import.meta.url);
const bytes = readFileSync(WASM);

await curve.initCurve({ wasm: bytes });

/**
 * Point both algorithms at an implementation and say which one wins.
 *
 * `insteadOfWebCrypto: true` is the whole reason this file can test anything: a
 * machine that HAS X25519 in WebCrypto would otherwise never execute a line of
 * the fallback, which is to say the path would be exercised for the first time on
 * a device belonging to a stranger.
 */
function using(path) {
  const insteadOfWebCrypto = path === "fallback";
  x25519.installFallback(curve.x25519Fallback, { insteadOfWebCrypto });
  ed25519.installFallback(curve.ed25519Fallback, { insteadOfWebCrypto });
}

// ------------------------------------------------------------ the module itself

section("the module — what it can and cannot do");

{
  const mod = new WebAssembly.Module(bytes);
  const imports = WebAssembly.Module.imports(mod);
  const exports = WebAssembly.Module.exports(mod)
    .map((e) => e.name)
    .sort();
  // ⚠️ An empty import list is a security property, not a build detail: a module
  // that imports nothing cannot call out, cannot reach the network and cannot
  // read `crypto.getRandomValues`. It is why there is no key generation in the
  // crate — the seed comes from `random.js`, the same call the WebCrypto path
  // makes, so the two paths share one source of randomness.
  equal("⭐ it imports nothing at all", String(imports.length), "0");
  equal(
    "and exports exactly the ABI, plus its memory",
    exports.join(","),
    "lpm_ed25519_public,lpm_ed25519_sign,lpm_ed25519_verify,lpm_key,lpm_key2," +
      "lpm_msg,lpm_msg_max,lpm_out,lpm_x25519_dh,lpm_x25519_public,memory"
  );

  const info = curve.curveBuildInfo();
  check("§5.2's canonical request has room many times over", info.maxMessage === 8192, `${info.maxMessage} bytes`);
}

// --------------------------------------------------------- the published vectors

const RFC7748 = {
  alicePriv: unhex("77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a"),
  alicePub: "8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a",
  bobPriv: unhex("5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb"),
  bobPub: "de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f",
  shared: "4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742",
};

const RFC8032 = [
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

// Every vector, on both implementations, through the SAME exported functions the
// protocol calls. Running them through `src/crypto/*.js` rather than through the
// WASM exports directly is deliberate: the wrapper is part of what could be wrong.
for (const path of ["webcrypto", "fallback"]) {
  using(path);

  section(`RFC 7748 §6.1 — X25519 on the ${path} path`);
  check("X25519 reports itself available", await x25519.available());
  equal("Alice's public key", (await x25519.keyPairFromPrivate(RFC7748.alicePriv)).publicKey, RFC7748.alicePub);
  equal("Bob's public key", (await x25519.keyPairFromPrivate(RFC7748.bobPriv)).publicKey, RFC7748.bobPub);
  equal("the shared secret, from Alice", await x25519.dh(RFC7748.alicePriv, unhex(RFC7748.bobPub)), RFC7748.shared);
  equal("the shared secret, from Bob", await x25519.dh(RFC7748.bobPriv, unhex(RFC7748.alicePub)), RFC7748.shared);

  section(`RFC 8032 §7.1 — Ed25519 on the ${path} path`);
  check("Ed25519 reports itself available", await ed25519.available());
  for (const t of RFC8032) {
    const msg = unhex(t.msg);
    equal(`${t.name}: public key from the 32-byte seed`, (await ed25519.keyPairFromSeed(unhex(t.seed))).publicKey, t.pub);
    equal(`${t.name}: signature`, await ed25519.sign(unhex(t.seed), msg), t.sig);
    check(`${t.name}: verifies`, await ed25519.verify(unhex(t.pub), unhex(t.sig), msg));
    const tampered = unhex(t.sig);
    tampered[0] ^= 0x01;
    check(`${t.name}: a tampered signature does not`, !(await ed25519.verify(unhex(t.pub), tampered, msg)));
  }
}

// ---------------------------------------------------------------- the agreement

section("⭐⭐ the two implementations, asked the same questions");

// Random inputs rather than the published ones: a vector proves both are right
// about three values somebody else chose, and this proves they are right about
// values nobody chose. Fifty is enough to catch a clamping or endianness
// difference, which is what a disagreement here would actually be.
{
  let publics = 0;
  let secrets = 0;
  for (let i = 0; i < 50; i++) {
    const priv = randomBytes(32);
    const peer = randomBytes(32);

    using("webcrypto");
    const nativePub = (await x25519.keyPairFromPrivate(priv)).publicKey;
    const peerPub = (await x25519.keyPairFromPrivate(peer)).publicKey;
    const nativeShared = await x25519.dh(priv, peerPub);

    using("fallback");
    const wasmPub = (await x25519.keyPairFromPrivate(priv)).publicKey;
    const wasmShared = await x25519.dh(priv, peerPub);

    if (hex(nativePub) === hex(wasmPub)) publics++;
    if (hex(nativeShared) === hex(wasmShared)) secrets++;
  }
  equal("⭐ 50 random private keys give the same public key on both", String(publics), "50");
  equal("⭐⭐ 50 random handshakes give the same shared secret on both", String(secrets), "50");
}

{
  // The direction that matters for §3.3: each side of a pairing may be on a
  // different implementation, and neither knows which.
  const iPriv = randomBytes(32);
  const jPriv = randomBytes(32);
  using("webcrypto");
  const iPub = (await x25519.keyPairFromPrivate(iPriv)).publicKey;
  const initiatorSide = await x25519.dh(iPriv, (await (async () => {
    using("fallback");
    const p = (await x25519.keyPairFromPrivate(jPriv)).publicKey;
    using("webcrypto");
    return p;
  })()));
  using("fallback");
  const joinerSide = await x25519.dh(jPriv, iPub);
  equal(
    "⭐⭐⭐ a WebCrypto initiator and a WASM joiner agree on §3.3's `dh`",
    hex(initiatorSide),
    hex(joinerSide)
  );
}

{
  // §5.2's signature is produced by one device and checked by the server, but a
  // client that cannot check its own must not be able to disagree with the one
  // that made it either.
  const seed = randomBytes(32);
  const message = ascii("lpm-req\nPOST\n/v1/mailbox/AAAA\n1786000000");

  using("webcrypto");
  const nativeKey = await ed25519.keyPairFromSeed(seed);
  const nativeSig = await ed25519.sign(seed, message);

  using("fallback");
  const wasmKey = await ed25519.keyPairFromSeed(seed);
  const wasmSig = await ed25519.sign(seed, message);

  equal("⭐ the same seed gives the same Ed25519 public key on both", hex(nativeKey.publicKey), hex(wasmKey.publicKey));
  // Ed25519 is deterministic (RFC 8032 §5.1.6), so this is an equality and not a
  // "both verify" — a randomised signer would pass the weaker check while being a
  // different scheme from the one §5.2 specifies.
  equal("⭐⭐ and the same signature, byte for byte — Ed25519 is deterministic", hex(nativeSig), hex(wasmSig));
  check("⭐ the fallback accepts WebCrypto's signature", await ed25519.verify(nativeKey.publicKey, nativeSig, message));

  using("webcrypto");
  check("⭐ and WebCrypto accepts the fallback's", await ed25519.verify(wasmKey.publicKey, wasmSig, message));
}

// -------------------------------------------------------- the rules, on BOTH paths

section("D-076 — the checks that used to live downstream of the branch");

for (const path of ["webcrypto", "fallback"]) {
  using(path);

  await rejects(
    `${path}: a 31-byte X25519 private key is refused`,
    () => x25519.keyPairFromPrivate(randomBytes(31)),
    /must be 32 bytes/
  );
  await rejects(
    `${path}: a 33-byte peer public key is refused`,
    () => x25519.dh(randomBytes(32), randomBytes(33)),
    /must be 32 bytes/
  );
  await rejects(
    `${path}: ⭐ a small-order peer key is refused, not silently agreed with`,
    () => x25519.dh(RFC7748.alicePriv, new Uint8Array(32)),
    /small order|agreement failed/
  );
  await rejects(
    `${path}: a 31-byte Ed25519 seed is refused`,
    () => ed25519.sign(randomBytes(31), ascii("x")),
    /must be 32 bytes/
  );
  check(
    `${path}: a 63-byte signature does not verify (and does not reach a 64-byte buffer)`,
    !(await ed25519.verify(randomBytes(32), randomBytes(63), ascii("x")))
  );

  // ⭐⭐ THIS CHECK EXISTS BECAUSE A SABOTAGE PASSED WITHOUT IT. `lpm_ed25519_verify`
  // returns 1 for valid, 0 for invalid and a NEGATIVE code for "the question could
  // not be asked", so the wrapper compares against 1 — and a wrapper written as
  // `!== 0` reads correctly, refuses tampered signatures correctly, and reports a
  // key that is not a point on the curve as a VALID SIGNATURE. Nothing in this file
  // asked that question until the sabotage found the gap.
  //
  // The value below is a 32-byte string that ed25519-dalek cannot decompress
  // (roughly half of them cannot be). Both implementations must answer the same
  // thing about it, and the answer must be "no".
  const notAPoint = unhex("866d5648ffceb83d7af423f7ac183687d2b5dd07f6e900055ec8ae2282380e8d");
  check(
    `${path}: ⭐ a public key that is not a point is FALSE, not an error code read as true`,
    !(await ed25519.verify(notAPoint, randomBytes(64), ascii("x")))
  );
}

// ------------------------------------------------------- the shape of the module

section("the fallback's own limits");

using("fallback");
{
  const max = curve.curveBuildInfo().maxMessage;
  const seed = randomBytes(32);
  const pair = await ed25519.keyPairFromSeed(seed);

  const atLimit = new Uint8Array(max).fill(0x41);
  const sig = await ed25519.sign(seed, atLimit);
  check("a message exactly at the limit signs", sig.length === 64, `${max} bytes`);
  check("and verifies", await ed25519.verify(pair.publicKey, sig, atLimit));

  await rejects(
    "⚠️ one byte over the limit is a named refusal, not a truncated signature",
    () => ed25519.sign(seed, new Uint8Array(max + 1)),
    /signs at most/
  );
  check(
    "and verification of an over-length message is false rather than a throw",
    !(await ed25519.verify(pair.publicKey, sig, new Uint8Array(max + 1)))
  );

  // ⭐⭐ AND THE PART THAT WOULD OTHERWISE BE PROSE WITH AN EXPIRY DATE. "8 KiB is
  // more than the protocol can produce" is a claim about §5.2, made in a Rust
  // comment, that no build checks — so it is checked here, against the longest
  // request the client can actually construct, with the limit read from the
  // module rather than written down a second time.
  const { canonicalRequest, TAG_MAILBOX, NONCE_BYTES } = await import("../../src/protocol/signing.js");
  const longest = await canonicalRequest({
    tag: TAG_MAILBOX,
    method: "DELETE",
    // The longest signed path in the client: `/api/mailbox/<b64u 16 bytes>/<verb>`
    // — see `src/flow/mailbox.js`. `/api/roster/<id>` and `/api/pair/<id>` are
    // shorter, and `/api/pow` is not signed at all.
    path: `/api/mailbox/${"A".repeat(22)}/messages`,
    id: randomBytes(16),
    timestamp: 99999999999,
    nonce: randomBytes(NONCE_BYTES),
    body: randomBytes(4096), // the body is HASHED into the line, so its size does not reach it
  });
  check(
    "⭐⭐ §5.2's longest canonical request fits many times over",
    longest.length * 10 < max,
    `${longest.length} bytes against a ${max}-byte buffer`
  );
}

// -------------------------------------------------- non-reentrancy, and the memory

section("⚠️ the crate's static buffers — what keeps them safe");

using("fallback");
{
  // The hazard: four static buffers, no allocator, so two operations in flight
  // would overwrite each other's inputs. What prevents it is that every fallback
  // operation is SYNCHRONOUS — there is no point inside one at which another can
  // run. This test is what turns that from a comment into a check: `sign()` awaits
  // before it calls, so these twenty really do interleave at the awaits, and every
  // one of them must still return its own answer.
  const seeds = Array.from({ length: 20 }, () => randomBytes(32));
  const message = ascii("the same message, twenty different keys");

  const expected = [];
  for (const seed of seeds) expected.push(hex(await ed25519.sign(seed, message)));

  const concurrent = await Promise.all(seeds.map((seed) => ed25519.sign(seed, message)));
  const wrong = concurrent.filter((sig, i) => hex(sig) !== expected[i]).length;
  equal("⭐⭐ 20 concurrent signatures, each with its own key, all correct", String(wrong), "0");

  // The same question for the two-buffer operation, where a crossed pair would
  // produce a shared secret belonging to somebody else's handshake.
  const pairs = Array.from({ length: 20 }, () => [randomBytes(32), randomBytes(32)]);
  const peers = [];
  for (const [, p] of pairs) peers.push((await x25519.keyPairFromPrivate(p)).publicKey);
  const want = [];
  for (let i = 0; i < pairs.length; i++) want.push(hex(await x25519.dh(pairs[i][0], peers[i])));
  const got = await Promise.all(pairs.map(([priv], i) => x25519.dh(priv, peers[i])));
  equal("⭐⭐ and 20 concurrent handshakes", String(got.filter((s, i) => hex(s) !== want[i]).length), "0");
}

{
  // The cached `Uint8Array` view in `curve.js` is safe only while the memory
  // cannot grow — a grown memory detaches the old buffer and every write after
  // that goes nowhere. It cannot grow here because there is no allocator, which
  // is a claim about a running module and therefore belongs in a measurement.
  const before = curve.curveBuildInfo().memoryBytes;
  const seed = randomBytes(32);
  for (let i = 0; i < 1000; i++) await ed25519.sign(seed, ascii(`message ${i}`));
  const after = curve.curveBuildInfo().memoryBytes;
  equal("⭐ 1000 signatures later the linear memory is the same size", String(after), String(before));
  check("which is why the view may be cached", after > 0, `${(after / 1024).toFixed(0)} KiB, never grown`);
}

// --------------------------------------------------------------- what §0.2 asks

section("§0.2 — detection, and what it installs");

{
  // The interface the app actually calls. On this machine WebCrypto has both, so
  // the honest thing to assert is what that returns — and then that forcing the
  // fallback still leaves a complete client.
  const { ensurePrimitives } = await import("../../src/crypto/index.js");

  const normal = await ensurePrimitives({ wasm: bytes });
  check("a browser with both primitives is complete and loads nothing", normal.complete && normal.fallback === false);

  const forced = await ensurePrimitives({ wasm: bytes, insteadOfWebCrypto: true });
  check("and forcing the fallback is also complete", forced.complete && forced.fallback === true);
  check("with no reason to report", forced.reason === undefined);

  // Whatever the last install left behind, the vectors above already ran on both
  // paths; reset to the honest default so nothing after this file inherits a
  // forced state.
  using("webcrypto");
}

done();
