// The JavaScript side of §0.2's X25519/Ed25519 fallback — `client/curve/` is the
// module itself (a Rust crate around the two dalek implementations, D-075).
//
// This file is the only place that loads it and the only place that speaks its
// raw C ABI, so that `x25519.js` and `ed25519.js` see one small interface and
// never a pointer.
//
// ⚠️⚠️ **EVERY OPERATION HERE IS SYNCHRONOUS, AND THAT IS THE SAFETY PROPERTY
// RATHER THAN A STYLE.** The crate has four static buffers and no allocator (see
// its `src/lib.rs`), so two operations in flight at once would overwrite each
// other's inputs. A synchronous function cannot be interleaved by anything in
// JavaScript — there is no point at which another task can run. If these returned
// promises, "write the buffers, call, read the output" would become three
// resumable steps and the third one could read a stranger's signature.
//
// The consequence for anyone writing a different fallback: INITIALISATION may be
// async, OPERATIONS may not. That is also the shape libsodium.js has, so it is
// not a demand this codebase invented.
//
// ⚠️ The private key is written into the module's linear memory, which is a
// `Uint8Array` this file can see. §7.7 already says zeroization is not achievable
// in JavaScript and does not pretend otherwise here — but the crate erases its own
// key buffer on the way out of every operation that reads one, so the window is
// the call rather than the session.

const WASM = "../../curve/dist/lpm_curve.wasm";

let instance = null;
let memory = null;

/**
 * Load the module. Idempotent — the second call returns the first instance.
 *
 * The browser needs no argument. Node has no `fetch` for `file:` URLs, so a test
 * passes the bytes it read off disk; that is the same artefact the browser
 * downloads, which is the rule the other two artefacts state as *the tested bytes
 * are the shipped bytes*.
 *
 * ⚠️ This is deliberately NOT called at boot on a device that does not need it.
 * `ensurePrimitives()` in `index.js` imports this file only after feature
 * detection has said the browser is missing a curve, so the 41 KiB is downloaded
 * by the devices that have no alternative and by nobody else.
 */
export async function initCurve({ wasm } = {}) {
  if (instance) return instance;
  const bytes = wasm ?? (await (await fetch(new URL(WASM, import.meta.url))).arrayBuffer());
  const module = await WebAssembly.compile(bytes);

  // The import object is empty because the module imports nothing, and that is
  // asserted at build time as well (`build.sh`). A module that imports nothing
  // cannot call out, cannot reach the network, and cannot read
  // `crypto.getRandomValues` — the seed for every key on this path is drawn by
  // `random.js`, on the same call the WebCrypto path uses.
  const loaded = await WebAssembly.instantiate(module, {});
  instance = loaded.exports;

  // The view is cached because this module's memory cannot grow: it has four
  // static buffers, no allocator, and nothing that calls `memory.grow`. A
  // detached buffer is the classic WASM bug and the reason it cannot happen here
  // is structural — `client/curve/test/curve.mjs` asserts the memory size is
  // unchanged after a thousand operations rather than leaving that as a comment.
  memory = new Uint8Array(instance.memory.buffer);
  return instance;
}

function required() {
  if (!instance) throw new Error("curve: initCurve() has not been awaited");
  return instance;
}

/** The crate's return codes (`src/lib.rs`). */
const OK = 0;
const ERR_ARGS = -1;
const ERR_SMALL_ORDER = -2;
const ERR_PUBKEY = -3;

/** What a return code means, in words a person could be shown. */
function fail(op, code) {
  const why =
    code === ERR_ARGS
      ? "a length this module does not accept"
      : code === ERR_SMALL_ORDER
        ? "the peer public key has small order (all-zero shared secret)"
        : code === ERR_PUBKEY
          ? "the public key is not a point on the curve"
          : `unknown code ${code}`;
  return new Error(`${op}: ${why}`);
}

/** Copy `bytes` to a buffer the module exported, and return the length written. */
function put(pointer, bytes) {
  memory.set(bytes, pointer);
  return bytes.length;
}

/** Read `length` bytes out of the output buffer. */
function out(length) {
  const start = instance.lpm_out();
  return memory.slice(start, start + length);
}

/**
 * The X25519 half of the interface `x25519.js` installs.
 *
 * Note what is NOT here: `generateKeyPair`. A keypair on this path is
 * `keyPairFromPrivate(randomBytes(32))`, exactly as it is on the WebCrypto path,
 * and that is not a shortcut — a fallback that generated its own keys would be a
 * second source of randomness for the same protocol field, on the devices least
 * able to be checked.
 */
export const x25519Fallback = {
  publicFromPrivate(privateKey) {
    const x = required();
    put(x.lpm_key(), privateKey);
    const code = x.lpm_x25519_public();
    if (code !== OK) throw fail("X25519 public key", code);
    return out(32);
  },

  dh(privateKey, peerPublicKey) {
    const x = required();
    put(x.lpm_key(), privateKey);
    put(x.lpm_key2(), peerPublicKey);
    const code = x.lpm_x25519_dh();
    if (code !== OK) throw fail("X25519 key agreement", code);
    return out(32);
  },
};

/** The Ed25519 half. */
export const ed25519Fallback = {
  publicFromSeed(seed) {
    const x = required();
    put(x.lpm_key(), seed);
    const code = x.lpm_ed25519_public();
    if (code !== OK) throw fail("Ed25519 public key", code);
    return out(32);
  },

  sign(seed, message) {
    const x = required();
    if (message.length > x.lpm_msg_max()) {
      // The limit is read from the module, not written down again here — see
      // MAX_MSG in `src/lib.rs`. A limit copied into two files is a limit that
      // will be raised in one of them.
      throw new RangeError(
        `Ed25519: this fallback signs at most ${x.lpm_msg_max()} bytes and was given ${message.length}`
      );
    }
    put(x.lpm_key(), seed);
    const length = put(x.lpm_msg(), message);
    const code = x.lpm_ed25519_sign(length);
    if (code !== OK) throw fail("Ed25519 signature", code);
    return out(64);
  },

  verify(publicKey, signature, message) {
    const x = required();
    if (message.length > x.lpm_msg_max()) return false;
    put(x.lpm_key(), publicKey);
    put(x.lpm_key2(), signature);
    const length = put(x.lpm_msg(), message);
    // ⚠️ 1 is valid, 0 is INVALID, negative is "could not ask". A caller that
    // treated 0 as success would accept every forgery, so this compares against
    // 1 and nothing else — including the error codes, which are not "valid".
    return x.lpm_ed25519_verify(length) === 1;
  },
};

/**
 * What this build is, for the diagnostic that tells a person which path they are
 * on — and for the one measurement that has to be watchable.
 *
 * `memoryBytes` is reported for the reason `argon2/`'s `lpm_heap_pages` is: the
 * claim that this module's memory never grows is what makes the cached view above
 * safe, and a claim about a running system belongs where a test can read it
 * rather than where a reader can believe it.
 */
export function curveBuildInfo() {
  const x = required();
  return {
    module: "lpm_curve.wasm",
    maxMessage: x.lpm_msg_max(),
    memoryBytes: x.memory.buffer.byteLength,
  };
}
