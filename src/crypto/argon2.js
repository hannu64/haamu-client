// Argon2id — PROTOCOL.md §7.2, the JavaScript side of `client/argon2/`.
//
// One function: bytes in, 32 bytes out. `canonical()`, the salt and every
// derivation that follows `K_master` are in `protocol/passphrase.js`, where they
// were already written and tested against frozen vectors; this file is the slot
// that section left open and nothing more.
//
// ⚠️⚠️ A FRESH INSTANCE PER DERIVATION, BECAUSE A TRAP MUST NOT REACH THE
// SESSIONS. §7.2 asks a phone for 128 MiB and the phone may not have it; a WASM
// instance that traps is poisoned, and the Olm instance holds every channel's
// ratchet state for the whole unlocked session. Separate modules make "this device
// could not allocate 128 MiB" a return code instead of a dead conversation.
//
// ⚠️ THE MEMORY REASON FOR DOING THIS IS WRONG AND IS RECORDED BECAUSE IT IS THE
// OBVIOUS ONE. Linear memory grows and never shrinks, so a dropped instance ought
// to give ~130 MB back where a shared one could not. Measured: it does not — RSS
// stays up in V8 either way (`client/argon2/README.md`). What dropping buys is
// REUSE, which is a different property: ten derivations in ten dropped instances
// cost what one costs, and two live instances cost twice.
//
// ⚠️ THE COMPILED MODULE IS CACHED AND THE INSTANCE IS NOT. A
// `WebAssembly.Module` is compiled code and owns no linear memory, so keeping it
// costs nothing and saves the compile on every unlock; a `WebAssembly.Instance`
// owns the heap and is what the paragraph above is about.

/** §7.2's output. Fixed in the crate as well; both would have to change together. */
export const K_MASTER_BYTES = 32;

const WASM = "../../argon2/dist/lpm_argon2.wasm";

/** The crate's return codes (`src/lib.rs`). */
const OK = 0;
const ERR_PARAMS = -1;
const ERR_MEMORY = -2;
const ERR_HASH = -3;
const ERR_ARGS = -4;

/**
 * Argon2id could not produce a key.
 *
 *   unavailable    the module was never loaded — `initArgon2()` was not awaited
 *   memory         §7.2's 128 MiB could not be allocated on this device. A REAL
 *                  OUTCOME on a small phone, not a bug: it is why the crate
 *                  reserves the block array itself instead of letting the library
 *                  abort, because an abort in WASM is a trap and a trap is silence
 *   parameters     the library rejected m/t/p — a code error, not a device one
 *   failed         the hash itself failed. Not reachable for any input §7.2 has
 */
export class Argon2Failure extends Error {
  constructor(reason, message) {
    super(message);
    this.name = "Argon2Failure";
    this.reason = reason;
  }
}

let compiled = null;

/**
 * Compile the module. Idempotent — the second call returns the first module.
 *
 * The browser needs no argument. Node has no `fetch` for `file:` URLs, so a test
 * passes the bytes it read off disk; that is the same artefact the browser
 * downloads, which is `client/argon2/README.md`'s rule that the tested bytes are
 * the shipped bytes.
 */
export async function initArgon2({ wasm } = {}) {
  if (compiled) return compiled;
  if (wasm) {
    compiled = await WebAssembly.compile(wasm);
    return compiled;
  }
  const url = new URL(WASM, import.meta.url).href;
  // compileStreaming where it exists; the fallback is for a server that does not
  // send `application/wasm`, which is a deployment mistake but not a reason to
  // refuse to start.
  try {
    compiled = await WebAssembly.compileStreaming(fetch(url));
  } catch {
    compiled = await WebAssembly.compile(await (await fetch(url)).arrayBuffer());
  }
  return compiled;
}

export function argon2Available() {
  return compiled !== null;
}

/**
 * What the last derivation cost. Diagnostics only — no secret, no input, and
 * nothing derived from one.
 *
 * It is here because §7.2's whole parameter choice is a measurement (D-034, six
 * devices) and the number that decides it on any given device is not knowable in
 * advance. A client that can say "this took 1.2 s and reached 132 MiB" on the
 * device in front of a tester is worth more than a table in a document.
 */
let last = null;
export function lastRun() {
  return last;
}

/**
 * `K_master = Argon2id(password, salt, m, t, p, out=32)`.
 *
 * `password` and `salt` are bytes: §7.2's `canonical()` has already run, and a
 * `String` on this path would be the thing §7.7 forbids.
 *
 * ⚠️ The buffers handed to WASM are overwritten by the crate before it returns,
 * and this function does not keep a copy. What it cannot do is reach the caller's
 * arrays — §7.7's window is real and this does not close it.
 */
export async function argon2id(password, salt, { m, t, p, outLen = K_MASTER_BYTES }) {
  if (!compiled) {
    throw new Argon2Failure("unavailable", "argon2: initArgon2() has not been awaited");
  }
  if (!(password instanceof Uint8Array) || !(salt instanceof Uint8Array)) {
    throw new TypeError("argon2: password and salt must be bytes (§7.7 — not a String)");
  }
  if (outLen !== K_MASTER_BYTES) {
    throw new RangeError(`argon2: §7.2 derives ${K_MASTER_BYTES} bytes, not ${outLen}`);
  }

  const started = perfNow();
  // A fresh instance. Everything below holds a reference to it; when this
  // function returns, nothing does.
  const instance = await WebAssembly.instantiate(compiled, {});
  const { lpm_alloc, lpm_argon2id, lpm_heap_pages, memory } = instance.exports;

  const pwPtr = lpm_alloc(password.length);
  const saltPtr = lpm_alloc(salt.length);
  const outPtr = lpm_alloc(outLen);
  if (pwPtr === 0 || saltPtr === 0 || outPtr === 0) {
    throw new Argon2Failure("memory", "argon2: the module could not allocate its input buffers");
  }
  new Uint8Array(memory.buffer, pwPtr, password.length).set(password);
  new Uint8Array(memory.buffer, saltPtr, salt.length).set(salt);

  const code = lpm_argon2id(pwPtr, password.length, saltPtr, salt.length, m, t, p, outPtr);
  if (code !== OK) throw failureFor(code, m);

  // ⚠️ A FRESH VIEW, AFTER THE CALL. `memory.grow` detaches every existing
  // `ArrayBuffer` view of the heap, and this call grows it by 128 MiB — so a view
  // taken before the call reads as an empty buffer afterwards, silently.
  const key = new Uint8Array(memory.buffer, outPtr, outLen).slice();
  new Uint8Array(memory.buffer, outPtr, outLen).fill(0);

  last = { ms: Math.round(perfNow() - started), heapMiB: Math.round((lpm_heap_pages() * 65536) / 1048576) };
  return key;
}

function failureFor(code, m) {
  switch (code) {
    case ERR_MEMORY:
      return new Argon2Failure(
        "memory",
        `argon2: this device could not allocate the ${Math.round(m / 1024)} MiB §7.2 asks for`
      );
    case ERR_PARAMS:
      return new Argon2Failure("parameters", "argon2: the library rejected these parameters");
    case ERR_ARGS:
      return new Argon2Failure("parameters", "argon2: the inputs were not usable buffers");
    case ERR_HASH:
      return new Argon2Failure("failed", "argon2: the derivation failed");
    default:
      return new Argon2Failure("failed", `argon2: unexpected return code ${code}`);
  }
}

const perfNow = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now());
