# `client/curve/` — §0.2's X25519/Ed25519 fallback

A WASM module with five operations, for browsers whose WebCrypto does not have
these two curves. `PROTOCOL.md` §0.2:

> WebCrypto support for X25519/Ed25519 is now broad but not universal. The client
> MUST feature-detect at startup and fall back to a WASM implementation. This
> fallback is not optional — it is the difference between working and not working
> on a meaningful share of devices.

Nothing loads it on a device that does not need it. `src/crypto/index.js`'s
`ensurePrimitives()` probes first and imports `src/crypto/curve.js` only if the
probe comes back short, so the 41 KiB is paid for by the devices that have no
alternative and by nobody else. A real-browser network log is where that is a fact
rather than an intention.

## Why this is not libsodium.js

§0.2 said "libsodium-WASM fallback" from version 0.2 until 0.8.15. The change is
D-075, and the argument is §6.1's read from the other end.

For the Olm layer, no vodozemac WASM binding existed, so one had to be written, and
the compensating argument was that six operations can be *read* where a large SDK
could only be *trusted*. Here libsodium.js exists — **and that is what disqualifies
it.** It is a prebuilt emscripten artefact from a package registry; reproducing it
from source needs a toolchain this project does not pin; and `ARCHITECTURE.md` §7.1
makes a build that cannot be reproduced a release blocker. Vendoring it would have
put the least verifiable artefact in the product on the one path a review had already
singled out — *"the fallback path voids the whole table"*. It also breaks the other
§7.1 rule: `client/src` has no dependencies and no build step.

## Why it is a separate artefact from the Olm wrapper

`curve25519-dalek` is already linked into `wasm/`, so adding five exports there would
have cost almost nothing in bytes. It is separate for `argon2/`'s reason, one step
sharper: **a WASM instance that traps is poisoned**, every later call into it fails,
and the Olm instance holds every channel's ratchet state for a whole unlocked
session. Ed25519 signs *every* request (§5.2). One instance would make "a signature
failed" and "every conversation on this device is now unusable" the same event.

Duplicating the dalek code costs nothing where it matters, because only devices
without a WebCrypto alternative ever download this.

## What it does not have

- **No key generation.** Every private value on these curves is 32 bytes, drawn from
  the platform CSPRNG (§3.1) or derived (§4.2, §7.2). The JavaScript side draws them
  with the same `randomBytes` the WebCrypto path uses, so both paths have one source
  of randomness instead of two.
- **No imports at all.** A module that imports nothing cannot call out, cannot reach
  the network, and cannot read `crypto.getRandomValues` — which is also why the point
  above is structural rather than a promise. `build.sh` refuses to write `dist/` if
  the module imports anything, and `test/curve.mjs` asserts it again.
- **No allocator.** Four static buffers, reached through `lpm_key`, `lpm_key2`,
  `lpm_msg` and `lpm_out`. `argon2/` leaks its buffers on purpose because it is
  instantiated for one derivation and dropped; this instance lives for the whole
  session and signs every request, so an allocation per signature would be a leak
  that grows with a conversation.
- **No `wasm-bindgen`.** Its glue is a cached ES module and it would put imports in a
  module whose emptiness is a stated property.

⚠️ **The buffers make the module non-reentrant, and JavaScript is what keeps it
safe.** Every operation in `src/crypto/curve.js` is **synchronous** — the sequence
*write the buffers → call → read the output* contains no `await`, and a synchronous
block cannot be interleaved. Initialisation may be async; operations may not. That is
also the shape libsodium.js has, so it is not a demand this codebase invented. The
concurrency check in `test/curve.mjs` is what turns it from a comment into a test: a
sabotage that inserted one `await` between the write and the call failed it.

## Building

    ./build.sh            build, then verify against the committed SHA256SUMS
    ./build.sh --record   build, then WRITE SHA256SUMS (intentional changes only)
    ./test.sh             build, then check that artefact

Five things vary between two machines building identical source, and `build.sh`
asserts four of them: the compiler, the locked dependency graph, `wasm-opt`, the
absolute paths that panic locations embed as string data, and the clock.

**Measured, not declared:** the crate copied to an unrelated path with a fresh
`target/` produced byte-identical output.

## The numbers

| | |
|---|---|
| artefact | 41,506 B raw, **15,607 B brotli** |
| linear memory | 1,088 KiB, and it never grows — asserted after 1000 signatures |
| sign | 0.276 ms |
| X25519 dh | 0.136 ms |

`precomputed-tables` is **off** on both crates, from measurement rather than taste.
It is the whole content of ed25519-dalek's `fast` feature, and both builds produce
identical signatures:

| | brotli | sign | dh |
|---|---|---|---|
| no tables | 15,607 B | 0.276 ms | 0.136 ms |
| with `fast` | 49,717 B | 0.108 ms | 0.137 ms |

34 KiB of extra download to save 0.17 ms per signature, on the one artefact only
slow devices fetch, over the networks that are also slow. A signature is a rounding
error next to the request it authenticates either way.

## What the test is anchored to

⭐⭐ **WebCrypto, on the same inputs.** This is a stronger position than either of the
other two artefacts is in: the Olm wrapper has no second implementation available,
and Argon2id had to reach across three crates to get one. Here the second
implementation is already on the machine.

So every RFC 7748 §6.1 and RFC 8032 §7.1 vector runs **twice**, once per
implementation, through the same `src/crypto/*.js` exports the protocol calls. Then
the two are asked about inputs nobody chose:

- 50 random private keys → the same public key on both
- 50 random handshakes → the same shared secret on both
- a WebCrypto initiator and a WASM joiner → the same §3.3 `dh`
- the same seed → byte-identical Ed25519 signatures, which is an *equality* and not
  "both verify" only because Ed25519 is deterministic (RFC 8032 §5.1.6); a
  randomised signer would pass the weaker check while being a different scheme
- each implementation accepts the other's signature

Both anchors are needed. Agreement with WebCrypto would also be satisfied by two
implementations that are wrong in the same way; published vectors would be satisfied
by a fallback that is self-consistent and disagrees with the browser. A disagreement
here shows up on somebody's phone and nowhere else — two devices in one conversation,
one on each implementation.

⚠️ **The suite can force the fallback on a machine that does not need it**
(`installFallback(impl, { insteadOfWebCrypto: true })`, D-077). Without that, the only
browsers that ever run this code are ones the developer does not own, and the path
would first execute in production on somebody's old phone.

## Two things the tests learned the hard way

⚠️ **A sabotage passed.** The ABI's verify returns 1 for valid, 0 for invalid and a
negative code for "the question could not be asked", and `curve.js` compares against
1. A version written `!== 0` reads correctly, refuses tampered signatures correctly,
and reports a public key that is not a point on the curve as a **valid signature** —
and nothing in the suite noticed, because nothing asked. There is now a frozen
non-point public key and the answer must be `false` on both paths.

⚠️ **The limits are read from the module, never written down twice.** `lpm_msg_max()`
is 8192, and "more than §5.2 can produce" was a claim in a Rust comment that no build
read — so the test builds the longest canonical request the client can construct and
checks it against that number. It is 172 bytes.
