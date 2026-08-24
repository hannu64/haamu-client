// The same tiny runner the WASM wrapper uses — every failure reported, not just
// the first — plus the byte helpers the vector files need.
//
// Node's `crypto` global is WebCrypto, the same interface the browser gives, so
// src/ runs here unmodified. Nothing in src/ is stubbed, shimmed or replaced for
// the tests: what is exercised is what ships.

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

export function equal(label, actual, expected) {
  const a = show(actual);
  const b = show(expected);
  check(label, a === b, a === b ? "" : `\n          got      ${a}\n          expected ${b}`);
}

export async function rejects(label, fn, pattern) {
  try {
    await fn();
    check(label, false, "no error was thrown");
  } catch (e) {
    const message = String(e?.message ?? e).split("\n")[0];
    check(label, pattern.test(message), message.slice(0, 78));
  }
}

export function section(title) {
  console.log(`\n${title}`);
}

export function done() {
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

function show(v) {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "bigint" || v === null || v === undefined) return String(v);
  return hex(v);
}

export function hex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function unhex(s) {
  const clean = s.replace(/\s+/g, "");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function ascii(s) {
  return new TextEncoder().encode(s);
}
