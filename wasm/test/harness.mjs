// Load the wrapper the way the client will, from the bytes the client will get.
//
// ⚠️ This deliberately drives the **web** build, not a `--target nodejs` build.
// wasm-bindgen rewrites the module differently per target, so a nodejs artefact
// is different bytes from the one the browser downloads — and a test that
// exercises different bytes from the ones you ship proves less than it looks
// like it does. `build.sh` therefore emits only `web`, and this file feeds it
// the `.wasm` from disk instead of `fetch`.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
export const DIST = join(here, "..", "dist");

export async function load() {
  const mod = await import(join(DIST, "lpm_olm_wasm.js"));
  await mod.default({ module_or_path: readFileSync(join(DIST, "lpm_olm_wasm_bg.wasm")) });
  return mod;
}

// ⚠️ The wrapper's plaintext boundary is BYTES in both directions (§6.5 encrypts
// a padded byte string, which is not valid UTF-8). These two exist so that a test
// which happens to be about text says so explicitly, at the call site, rather than
// letting a string quietly stand in for a buffer.
export const bytes = (s) => new TextEncoder().encode(s);
export const text = (b) => new TextDecoder().decode(b);

// --- the tiniest test runner that reports every failure, not just the first ---
let pass = 0;
let fail = 0;

export function check(label, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ok    ${label}${detail ? "  " + detail : ""}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? "  " + detail : ""}`);
  }
}

export function rejects(label, fn, pattern) {
  try {
    fn();
    check(label, false, "no error was thrown");
  } catch (e) {
    const message = String(e?.message ?? e).split("\n")[0];
    check(label, pattern.test(message), message.slice(0, 70));
  }
}

export function done() {
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
