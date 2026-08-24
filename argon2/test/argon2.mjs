// The Argon2id module, against the artefact `build.sh` just produced.
//
// ⚠️ THE INTERESTING CHECK IS THE FIRST ONE AND IT IS NOT A ROUND TRIP. A crate
// that hashes and then verifies its own hash proves only that it is consistent
// with itself. The values below were measured through a DIFFERENT crate
// (`spike/devtest`, built with wasm-bindgen) on six real devices and cross-checked
// against a native run, and `DEVICE_RESULTS.md` records them as the evidence that
// open item 2 was closed on a correct computation. If this build disagrees with
// them, either this module is wrong or that measurement measured something else —
// and `K_master` is the one value in the system that may never drift, because a
// different one is a lost roster and every channel with it.

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import * as argon2 from "../../src/crypto/argon2.js";
import { check, equal, section, done, hex } from "../../test/harness.mjs";

const WASM = new URL("../dist/lpm_argon2.wasm", import.meta.url);
const bytes = readFileSync(WASM);

const PHRASE = "stove punch ivy claw mule zip rope fern";
const P = new TextEncoder().encode(PHRASE);
const SALT = new Uint8Array(
  createHash("sha256").update(Buffer.concat([Buffer.from("lpm-roster-salt-v1", "ascii"), Buffer.from(P)])).digest()
);

await argon2.initArgon2({ wasm: bytes });

// ------------------------------------------------------------ the module itself

section("the module — what it can and cannot do");

{
  const mod = new WebAssembly.Module(bytes);
  const imports = WebAssembly.Module.imports(mod);
  const exports = WebAssembly.Module.exports(mod).map((e) => e.name).sort();
  // ⚠️ An empty import list is a security property, not a build detail: a module
  // that imports nothing cannot call out, cannot reach the network and cannot read
  // `crypto.getRandomValues`. It is a pure function of the bytes handed to it.
  equal("⭐ it imports nothing at all", String(imports.length), "0");
  equal(
    "and exports exactly the ABI, plus its memory",
    exports.join(","),
    "lpm_alloc,lpm_argon2id,lpm_heap_pages,memory"
  );
}

// ------------------------------------------------------- the values that matter

section("§7.2 — the ladder measured on six devices (DEVICE_RESULTS.md, open item 2)");

// The prefixes DEVICE_RESULTS.md records for 256 / 128 / 64 / 32 MiB.
const LADDER = [
  [256, "810797df"],
  [128, "7519fd7d"],
  [64, "8bc7780b"],
  [32, "282e246c"],
];

for (const [mib, prefix] of LADDER) {
  const key = await argon2.argon2id(P, SALT, { m: mib * 1024, t: 3, p: 1 });
  const run = argon2.lastRun();
  equal(`${String(mib).padStart(3)} MiB → the measured K_master`, hex(key).slice(0, 8), prefix);
  if (mib === 128) {
    // §7.2's chosen rung. The timing is reported rather than asserted: this is a
    // build machine, and D-034's numbers came from phones.
    check("§7.2's own rung is 32 bytes", key.length === 32, `${run.ms} ms, heap ${run.heapMiB} MiB here`);
  }
}

section("§7.2 — the inputs are bytes, and canonical() has already run");

{
  // The one failure this module must never have: `canonical()` output and a raw
  // string producing different keys would be invisible until the day somebody
  // unlocked on a second device. The JS boundary refuses the string outright.
  let threw = false;
  try {
    await argon2.argon2id(PHRASE, SALT, { m: 32 * 1024, t: 3, p: 1 });
  } catch (e) {
    threw = e instanceof TypeError;
  }
  check("a String password is refused rather than encoded here (§7.7)", threw);
}

section("§7.2 — a refusal is a code, not a poisoned instance");

{
  // §7.2 fixes p=1, and the note in that section says raising it costs time and
  // buys nothing because the common WASM builds do not parallelise it. What must
  // not happen is that it is silently ignored: this build's library rejects it.
  let reason = null;
  try {
    await argon2.argon2id(P, SALT, { m: 32 * 1024, t: 3, p: 0 });
  } catch (e) {
    reason = e.reason;
  }
  equal("an impossible parameter is a named failure", reason, "parameters");

  // ⚠️ THE POINT OF THE CODE-NOT-TRAP RULE: the module still works afterwards. A
  // trap would poison the instance, and if this function lived in the Olm module
  // that would be every channel's ratchet state.
  const after = await argon2.argon2id(P, SALT, { m: 32 * 1024, t: 3, p: 1 });
  equal("and the next derivation is unaffected", hex(after).slice(0, 8), "282e246c");
}

section("§7.7's exception on the paths that FAIL, which is where it was missing");

/**
 * ⚠️⚠️ THE TWO FAILURES A CALLER CAN PROVOKE WERE THE TWO THAT KEPT THE PASSPHRASE.
 * `lpm_argon2id` wiped its inputs on the way out, and the wipe sat below a parameter
 * check and a fallible allocation that both returned above it — so on the low-memory
 * device the `try_reserve_exact` path exists to serve, the phrase JavaScript had just
 * copied in stayed in linear memory until the engine reclaimed it. Found by the
 * outside review of 2026-08-24 and fixed with a `Drop` guard.
 *
 * ⭐ THIS TEST GOES THROUGH THE RAW ABI AND READS THE MEMORY ITSELF. The wrapper in
 * `src/crypto/argon2.js` cannot see this: it throws on a non-zero code and drops the
 * instance, which is exactly the behaviour that made the bytes invisible. The only
 * way to check a buffer was overwritten is to look at the buffer.
 */
{
  const raw = async () => {
    const inst = await WebAssembly.instantiate(new WebAssembly.Module(bytes), {});
    return inst.exports;
  };

  const cases = [
    // §7.2 fixes p=1; p=0 is rejected by `Params::new` — the first early return.
    ["an impossible parameter", { m: 32 * 1024, t: 3, p: 0 }],
    // Beyond anything wasm32 can reserve — the `try_reserve_exact` return, and the
    // one that happens on a real device rather than only on a wrong call.
    ["a heap this device cannot give", { m: 3 * 1024 * 1024, t: 3, p: 1 }],
  ];

  for (const [what, { m, t, p }] of cases) {
    const ex = await raw();
    const pwPtr = ex.lpm_alloc(P.length);
    const saPtr = ex.lpm_alloc(SALT.length);
    const outPtr = ex.lpm_alloc(32);
    // ⚠️ The views are taken AFTER every allocation: a `lpm_alloc` that grows the
    // heap detaches the old ArrayBuffer, and a stale view reads zeroes for the wrong
    // reason — which would pass this test while proving nothing.
    new Uint8Array(ex.memory.buffer).set(P, pwPtr);
    new Uint8Array(ex.memory.buffer).set(SALT, saPtr);

    // The bytes really are there before the call, so a pass below is a wipe and not
    // an argument that never arrived.
    const before = new Uint8Array(ex.memory.buffer, pwPtr, P.length);
    check(`⚠️ ${what}: the phrase is in linear memory before the call`, before.some((b) => b !== 0));

    const rc = ex.lpm_argon2id(pwPtr, P.length, saPtr, SALT.length, m, t, p, outPtr);
    check(`⚠️ ${what}: refused with a code, not a trap`, rc !== 0, `rc=${rc}`);

    const pwAfter = new Uint8Array(ex.memory.buffer, pwPtr, P.length);
    const saAfter = new Uint8Array(ex.memory.buffer, saPtr, SALT.length);
    check(
      `⭐⭐⭐ ${what}: and the phrase is gone from linear memory anyway`,
      pwAfter.every((b) => b === 0)
    );
    check(`⭐⭐ ${what}: and so is the salt`, saAfter.every((b) => b === 0));
  }
}

section("the instance — one derivation costs what ten do");

{
  // The measurement behind `README.md`'s table, as an assertion rather than a
  // paragraph: the cost is per LIVE instance, so dropping between derivations is
  // what keeps ten unlocks from costing ten heaps. It does not return memory to
  // the operating system, and README.md says so.
  const before = process.memoryUsage().rss;
  for (let i = 0; i < 5; i++) await argon2.argon2id(P, SALT, { m: 128 * 1024, t: 3, p: 1 });
  const after = process.memoryUsage().rss;
  const grownMiB = Math.round((after - before) / 1048576);
  check(
    "five derivations at 128 MiB do not cost five heaps",
    grownMiB < 5 * 128,
    `resident memory grew ${grownMiB} MiB across five; five unshared heaps would be ${5 * 128} MiB`
  );
}

done();
