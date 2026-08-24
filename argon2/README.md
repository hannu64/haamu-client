# `lpm-argon2-wasm` — Argon2id for §7.2

```
K_master = Argon2id(P, salt, m=128MiB, t=3, p=1, out=32)
```

One function. `canonical()`, `salt = SHA256("lpm-roster-salt-v1" || P)` and every
derivation that follows `K_master` live in `client/src/protocol/passphrase.js`,
which was written and frozen against test vectors in an earlier step. This crate
is the slot §7.2 left open, and it takes bytes and returns bytes.

## Why it is not part of the Olm wrapper

**A trap here must not reach the sessions.** §7.2 asks a device for 128 MiB and
some devices will not have it. A WASM instance that traps is poisoned — every
later call into it fails — and the Olm instance holds every channel's ratchet
state for the whole unlocked session. Two modules make *"this phone could not
allocate 128 MiB"* a return code rather than a dead conversation. The devpanel
reached the same conclusion when it measured open item 2 and gave every rung of
the ladder its own worker.

Two smaller reasons: the module **imports nothing**, so it cannot call out, reach
the network or read `crypto.getRandomValues` — a property `test/argon2.mjs`
asserts rather than assumes — and the two artefacts have independent pins and
independent reproducibility hashes, so a change to one is not a rebuild of the
other.

⚠️ **The memory argument is NOT one of the reasons, and it is written down here
because it is the obvious one to reach for.** WASM linear memory grows and never
shrinks, so a dropped instance *ought* to return ~130 MB where a module that must
stay alive could not. Measured (Node 20 / V8, `--expose-gc`, RSS in MB):

| | baseline | after one derivation | after a 120 MB JS allocation |
|---|---:|---:|---:|
| instance dropped, GC forced | 41 | 174 | 294 |
| instance kept alive | 41 | 174 | 294 |

Identical. V8 does not return the pages to the operating system, and does not
reuse them for ordinary JavaScript allocations either. What dropping the instance
*does* buy is reuse by the next WASM instance, which is a different property and
is real:

| | RSS |
|---|---:|
| ten derivations, ten instances, each dropped | 174 MB |
| two instances alive at once | 302 MB (129.2 MiB each) |

So the cost is **per live instance**, and one derivation costs the same as ten.
⚠️ Unmeasured: whether a mobile browser under memory pressure behaves as V8 does
here. The arrangement chosen cannot be worse than the alternative, which is why it
is the one in the tree, but the benefit is unproven and must not be claimed. The
devpanel is where that would be answered on real devices.

## The ABI

Three exports over exported linear memory, no imports:

```
lpm_alloc(len) -> ptr          reserve a buffer to write into (leaked; see lib.rs)
lpm_argon2id(pw, pw_len, salt, salt_len, m_kib, t, p, out) -> i32
lpm_heap_pages() -> i32        64 KiB pages this instance has reached
```

`lpm_argon2id` returns `0` on success and a negative code otherwise: `-1`
parameters, `-2` the 128 MiB could not be allocated, `-3` the hash failed, `-4`
the arguments did not describe usable buffers. On any failure the output buffer is
untouched, so a caller that ignores the code cannot mistake a half-written buffer
for a key.

⚠️ **The block array is reserved with `try_reserve_exact` rather than left to the
library.** `Argon2::hash_password_into` allocates internally and aborts if it
cannot, and an abort in WASM is a trap. On the low-end phones §7.2's parameters
were chosen *for*, failing to allocate is a likely and reportable outcome.

## Building

```
./build.sh            build, then verify against the committed SHA256SUMS
./build.sh --record   build, then WRITE SHA256SUMS (intentional changes only)
./test.sh             build reproducibly, then run the checks against that artefact
```

Same discipline as `client/wasm/`: pinned compiler, `--locked` dependencies,
pinned `wasm-opt`, `--remap-path-prefix` for absolute paths and a fixed
`SOURCE_DATE_EPOCH`. `ARCHITECTURE.md` §7.1 makes an irreproducible build a
release blocker, and this artefact is the one that turns a person's phrase into
every key they own.

## What the tests check

`test/argon2.mjs`, against the built artefact:

- ⭐ **The four rungs of the open-item-2 ladder reproduce the values measured on
  six real devices** — `810797df` / `7519fd7d` / `8bc7780b` / `282e246c` for
  256 / 128 / 64 / 32 MiB on the phrase `stove punch ivy claw mule zip rope fern`.
  That measurement was made through a *different* crate (`spike/devtest`, built
  with `wasm-bindgen`) and cross-checked against a native run, so agreement here
  is agreement across three implementations, not a round trip.
- the module declares **no imports**;
- a failure is a code and not a trap — the instance still answers afterwards;
- `p > 1` is rejected rather than silently ignored (§7.2 fixes `p=1`, and the
  common WASM builds do not parallelise it).
