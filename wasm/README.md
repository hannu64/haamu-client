# `lpm-olm-wasm` — the Olm layer

`PROTOCOL.md` §6.1 says *"use vodozemac compiled to WASM"*. **No such binding is
published** — measured 2026-08-08: `vodozemac` and `@matrix-org/vodozemac` are
both absent from npm and the vodozemac repository contains no bindings directory.
So this crate is the binding, and `DECISIONS.md` D-031 accepts owning it.

Its entire surface is six operations — initiate, accept, encrypt, decrypt,
persist, restore — plus two read-only exports. No Matrix concepts, no key
directory, no device lists. That size is the point: `ARCHITECTURE.md` promises
that a person can check what the client does, and a few hundred lines of glue can
be read where a large SDK could only be trusted.

⚠️⚠️ **A plaintext crossing this boundary is `Uint8Array`, in both directions, and
that was a fix rather than a preference.** §6.5 encrypts
`LE32(true_length) || plaintext || zeros` — a byte string, not text: an ordinary
200-byte message begins `C8 00 00 00`. Until 2026-08-11 `encrypt` took a `&str`
and `decrypt` returned a `String`, **and this crate's own suite passed 25 of 25
throughout**, because it only ever encrypted sentences. Measured through the
obvious `TextDecoder`/`TextEncoder` pair, 256 padded bytes came back as 258 and
§6.5's bounds check read a declared length of 12,435,439. A `latin1` reading
survives, which is worse than failing — it turns the string encoding into a
private convention between two builds of this wrapper, exactly the divergence §6.4
warns about for `b64u`. See `PROTOCOL.md` §6.1 and D-050.

## Build

    ./build.sh              # build, verify against the committed SHA256SUMS
    ./build.sh --record     # build, rewrite SHA256SUMS (intentional changes only)
    ./test.sh               # build, then both test suites

Output lands in `dist/` (gitignored — it is derived, and `SHA256SUMS` is what is
committed):

| | raw | gzip | brotli |
|---|---:|---:|---:|
| `lpm_olm_wasm_bg.wasm` | 315 KB | 149 KB | 127 KB |
| `lpm_olm_wasm.js` | 26 KB | 6 KB | 5 KB |
| **over the wire** | | **155 KB** | **132 KB** |

⚠️ **That is 21% smaller than the spike's 167 KB, and it is not an optimisation.**
In the spike this crate was a *member* of a Cargo workspace, and Cargo silently
ignores `[profile.*]` outside the workspace root — so `opt-level = "z"`, LTO and
`strip` had never once taken effect. Here the crate is its own workspace root and
they do. `DEVICE_RESULTS.md`'s 206–211 KB was measured against the old artefact
and should now be read as an upper bound.

## Reproducibility

`ARCHITECTURE.md` §7.1 makes this a release blocker: anyone cloning at a tag must
produce byte-identical output. Five things vary between machines, and `build.sh`
**asserts** rather than assumes each one — a hash recorded by an unknown toolchain
records nothing:

| | pinned by | asserted |
|---|---|---|
| compiler | `rust-toolchain.toml` | `rustc --version` |
| dependencies | `Cargo.lock` + `--locked` | vodozemac's exact version, read back out of the lock |
| bindings generator | `wasm-bindgen = "=0.2.127"` | CLI version must equal the crate version |
| optimiser | binaryen 131 | `wasm-opt --version` |
| absolute paths | `--remap-path-prefix` for both the crate and `$CARGO_HOME` | — |
| the clock | `SOURCE_DATE_EPOCH=0` | — |

**Measured 2026-08-11:** the crate copied to an unrelated path, with a fresh
`target/`, produced both files byte-identical to the committed `SHA256SUMS`.

Only the **web** target is built. wasm-bindgen rewrites the module differently per
target, so a `--target nodejs` build is *different bytes*; the tests would then be
exercising something the client never loads. `test/harness.mjs` drives the web
build from Node by handing it the `.wasm` off disk. **The tested bytes are the
shipped bytes.** The same reasoning is why `prekeyPublicKeys` ships rather than
hiding behind a test-only feature: one artefact, one hash.

## The two suites, and why the second one exists

    node test/e2e.mjs        # does it work
    node test/upgrade.mjs    # is it still doing the same thing as before

`e2e.mjs` is the functional suite: the §6.2 bootstrap across the WASM boundary,
§6.4's envelope, persistence, and every rejection path (all of which must return
an error rather than trap — `panic = "abort"` poisons the instance).

`upgrade.mjs` exists because of D-032. Injecting derived keys goes through
vodozemac's pickle, which is **outside its semver guarantee**, and the dangerous
failure is silent: rename a pickle field and serde ignores the unknown key,
leaving the randomly generated one in place. Nothing errors. Sessions encrypt and
decrypt perfectly — and the channel cannot be recovered on a new device, which
someone discovers weeks later, having lost a conversation.

`account_from_derived` carries three guards against that and they are worth
having, but **every one of them asks this build to check this build**. A change of
*interpretation* — the same 32 bytes read as a different key — moves both sides of
all three at once. Two things here do not move with the library:

- **public keys recomputed by Node's HKDF and X25519** (`test/derive.mjs`), which
  shares no code with vodozemac; and
- **ciphertext and a session pickle frozen before the upgrade**
  (`test/vectors/upgrade.json`).

⚠️⚠️ **Measured, not argued.** With §6.2's HKDF output reversed — a perfect
simulation of a reinterpretation — **`e2e.mjs` passed 25 of 25** and `upgrade.mjs`
failed on the frozen ciphertext, naming both keys. A suite that only ever talks to
itself will certify a completely broken derivation.

⭐ **The byte-boundary change of 2026-08-11 is the worked example of how to move
these vectors and how not to.** The API changed shape, so `upgrade.mjs` could no
longer compare a `String` — and the fix was to decode the bytes in the TEST and
compare the same frozen text. `vectors/upgrade.json` was not touched. Adapting the
reader to a changed API keeps the evidence; re-running the generator would have
replaced it with something that agrees with today's build by construction. The
frozen ciphertext still opened, which is what says the change was shape-only.

**Run `upgrade.mjs` first on every vodozemac bump, and never regenerate the
vectors to make it pass.** Their whole value is that the version before the change
produced them; a regenerated vector agrees with the new build by construction and
tests nothing. `test/gen-vectors.mjs` says the same thing at the top of the file
and refuses to write vectors Node disagrees with.
