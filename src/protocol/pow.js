// PROTOCOL.md §9.1 — proof-of-work, the client side.
//
// ⚠️⚠️ READ §9.1 BEFORE RELYING ON THIS. Proof-of-work does NOT stop an attacker.
// 20 bits is ~10^6 SHA-256 evaluations; a commodity GPU solves roughly 10,000
// challenges a second and ASICs are three orders faster again, so the
// attacker-to-defender asymmetry is four to seven orders of magnitude and the
// `bits` knob cannot close it. It is retained for the friction it adds to casual
// and browser-based abuse, and for nothing else. What actually bounds the damage
// is the storage ceiling of §9.3.

import { b64uDecode, b64uEncode } from "../crypto/b64u.js";
import { concat } from "../crypto/bytes.js";
import { sha256 } from "../crypto/hash.js";

/** §9.1 caps the nonce server-side; 8 bytes of counter is ample. */
const NONCE_BYTES = 8;

/**
 * How long the solver may hold the thread between yields.
 *
 * ⚠️⚠️ IT IS A DURATION AND NOT AN ATTEMPT COUNT, AND THAT CHANGED ON 2026-08-13.
 * It used to yield every 16384 attempts, which is a fixed amount of WORK and
 * therefore a wildly variable amount of TIME: the same constant is 6 ms of one
 * machine and seconds of another, so the slow device — the one that needed the
 * yields — got them least often, and the fast device paid for 64 timers it did
 * not need. A timer is not free either: browsers clamp a nested `setTimeout(0)`
 * to 4 ms, and a background tab clamps it to a whole second.
 *
 * ➡️ **A BUDGET IN ATTEMPTS SPENDS A DIFFERENT AMOUNT OF TIME ON EVERY DEVICE.
 * If what you are protecting is a person's ability to interact, count time.**
 */
const YIELD_EVERY_MS = 60;

/** Count leading zero bits of a digest. */
export function leadingZeroBits(digest) {
  let n = 0;
  for (const b of digest) {
    if (b === 0) {
      n += 8;
      continue;
    }
    return n + Math.clz32(b) - 24;
  }
  return n;
}

// ───────────────────────────── the search hash ──────────────────────────────
//
// ⚠️⚠️⚠️ THIS IS NOT A CRYPTOGRAPHIC PRIMITIVE OF THIS PRODUCT AND MUST NEVER
// BECOME ONE. It is deliberately un-exported, deliberately in `pow.js` rather
// than in `crypto/hash.js`, and deliberately unable to return a digest — it
// returns one 32-bit word, because counting up to 32 leading zeros is all §9.1
// ever asks. Nothing can import it and nothing can derive a key with it. Every
// real hash in this client is `crypto/hash.js`, which is WebCrypto.
//
// ⭐ WHY IT EXISTS — MEASURED IN CHROME 148 IN THIS CONTAINER, TWO WAYS.
//
// The hash alone, in a loop: `await crypto.subtle.digest` manages 396,040 H/s
// where this code manages 2,842,928 H/s. **About 86% of what the old solver
// spent went on the CALL and not on the hash** — one WebCrypto entry and one
// promise, a million times over. (Batching 256 digests behind one `await` is
// WORSE, at 275,482 H/s: the cost is the crossing, not the waiting.)
//
// End to end, 250 solves each at 14 bits and scaled to §9.1's 20, including
// both agreement checks, the yields and the final verify:
//
//     before   mean 3.52 s   median 2.25 s
//     after    mean 0.75 s   median 0.49 s
//
// (Both medians sit at ~0.66 of their mean, which is what a geometric variable
// does — ln 2 ≈ 0.69. The distribution did not change shape, only its scale.)
//
// ➡️ The 86% is the point, and it is not a micro-optimisation. Per-call overhead
// across an engine boundary is precisely the quantity that differs between
// browsers by an order of magnitude, where the arithmetic of SHA-256 does not.
// Round 5 reported `link 30329 ms` from Firefox 153 against a Chrome mean near
// two seconds, and a 20× spread cannot come from a compression function. There
// is no Firefox in this container, so that ratio is EXPLAINED HERE AND NOT
// MEASURED — what is measured is that the old shape's cost was overwhelmingly
// made of the term that varies by engine, and this one has almost none of it.
//
// ⚠️ IT IS CHECKED AGAINST WEBCRYPTO TWICE PER SOLVE — once before the search
// starts and once on the answer (`solve`, below). A search hash that is wrong is
// a hang, not a hazard: it would simply never find a solution, and the server
// verifies with its own SHA-256 regardless. The checks turn that hang into a
// named error in microseconds.

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/**
 * A searcher over `challenge || nonce`, with the padding laid out once.
 *
 * §9.1's challenge is 56 bytes and the nonce is 8, so the padded message is
 * exactly two blocks — but nothing here assumes that. `searchable` says whether
 * this message fits the layout; when it does not, `solve` uses WebCrypto and is
 * merely slow, which is what it was before.
 */
function makeSearcher(messageLen) {
  // SHA-256 padding: the message, one 0x80 byte, zeros, then a 64-bit bit-count.
  const blocks = Math.ceil((messageLen + 9) / 64);
  const buf = new Uint8Array(blocks * 64);
  const view = new DataView(buf.buffer);
  buf[messageLen] = 0x80;
  view.setUint32(blocks * 64 - 8, Math.floor((messageLen * 8) / 0x100000000), false);
  view.setUint32(blocks * 64 - 4, (messageLen * 8) >>> 0, false);

  const W = new Uint32Array(64);

  /**
   * The first word of `SHA256(buf's message)`, which is the only word that can
   * hold up to 32 leading zeros.
   */
  function firstWord() {
    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
    let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

    for (let block = 0; block < blocks; block++) {
      const at = block * 64;
      for (let i = 0; i < 16; i++) W[i] = view.getUint32(at + i * 4, false);
      for (let i = 16; i < 64; i++) {
        const x = W[i - 15];
        const y = W[i - 2];
        const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
        const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
      }
      let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
      for (let i = 0; i < 64; i++) {
        const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        const t1 = (h + S1 + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
        const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0;
        d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
      h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
    }
    return h0 >>> 0;
  }

  return {
    // A message long enough to need a third block is not something §9.1 can
    // produce; rather than carry untested padding cases, say so and let the
    // caller fall back to the primitive.
    searchable: blocks <= 2,
    /** Write the fixed prefix once. */
    setPrefix: (bytes) => buf.set(bytes, 0),
    /** Write the varying tail — the nonce — before each attempt. */
    setTail: (bytes, at) => buf.set(bytes, at),
    firstWord,
  };
}

/**
 * Solve a challenge: find `nonce` such that `SHA256(challenge || nonce)` has at
 * least `bits` leading zero bits.
 *
 * `challenge` is the b64u string exactly as `GET /api/pow` returned it — the
 * client MUST send it back, because §9.1's challenge is stateless and the server
 * stored nothing it could look up.
 *
 * The counter runs big-endian so that the first nonces are short-lived-looking
 * fixed-width values rather than an obvious little-endian count; nothing depends
 * on it, and the server treats the nonce as opaque bytes.
 *
 * ⚠️ This is CPU-bound and blocks whatever thread it runs on. At §9.1's 20 bits
 * that is a mean of 2^20 hashes, and the SEARCH runs on the private hash above
 * rather than on WebCrypto — see the block comment there for the measurement
 * that motivated it. The answer, and only the answer, is checked with the real
 * primitive before this function will return it.
 *
 * ⚠️ THE COST IS A GEOMETRIC RANDOM VARIABLE AND ITS TAIL IS UNBOUNDED. Half of
 * all solves finish inside the mean and a few per cent take four times it, on
 * every device, forever. A number somebody reads out after a slow wait is a
 * sample from the tail, not a measurement of the typical case.
 *
 * In the client this still belongs in a Worker; the loop is written as a plain
 * synchronous search with an explicit yield so that the Worker would be the only
 * thing that ever needs to know about threads. `onProgress` exists so a long
 * solve can be cancelled or shown.
 */
export async function solve(challenge, bits, { onProgress, signal, maxAttempts = 1 << 26 } = {}) {
  if (!Number.isSafeInteger(bits) || bits < 1 || bits > 32) {
    throw new RangeError(`pow: bits ${bits} out of range`);
  }
  const challengeBytes = b64uDecode(challenge, "pow challenge");
  const nonce = new Uint8Array(NONCE_BYTES);
  const view = new DataView(nonce.buffer);

  const searcher = makeSearcher(challengeBytes.length + NONCE_BYTES);
  searcher.setPrefix(challengeBytes);

  // ⚠️ AGREEMENT BEFORE THE SEARCH, NOT ONLY AFTER IT. A search hash that
  // disagrees with SHA-256 does not produce a wrong answer — it produces NO
  // answer, and the symptom is a tab that spins for 2^26 attempts and then
  // reports something unrelated. One WebCrypto digest here turns that into a
  // sentence, and one digest is nothing against a million.
  let fast = searcher.searchable;
  if (fast) {
    searcher.setTail(nonce, challengeBytes.length);
    const reference = await sha256(concat(challengeBytes, nonce));
    const refWord = ((reference[0] << 24) | (reference[1] << 16) | (reference[2] << 8) | reference[3]) >>> 0;
    if (searcher.firstWord() !== refWord) {
      const err = new Error("pow: the search hash disagrees with SHA-256");
      err.reason = "pow_hash_mismatch";
      throw err;
    }
  }

  let lastYieldAt = performance.now();
  for (let counter = 0; counter < maxAttempts; counter++) {
    view.setUint32(4, counter, false);

    let hit;
    if (fast) {
      searcher.setTail(nonce, challengeBytes.length);
      // `bits` is 1..32 and `clz32` counts within one word, so the first word is
      // the whole question.
      hit = Math.clz32(searcher.firstWord()) >= bits;
    } else {
      hit = leadingZeroBits(await sha256(concat(challengeBytes, nonce))) >= bits;
    }

    if (hit) {
      const solution = formatSolution(challengeBytes, nonce);
      // The real primitive has the last word. Anything the server would reject
      // is rejected here first, where the failure has a name and a stack.
      if (!(await verify(solution, bits))) {
        const err = new Error("pow: solution failed its own check");
        err.reason = "pow_self_check";
        throw err;
      }
      return solution;
    }

    // Yield on ELAPSED TIME (see YIELD_EVERY_MS). The check is masked so that
    // reading the clock is not itself part of the inner loop's cost.
    if ((counter & 0x3ff) === 0x3ff && performance.now() - lastYieldAt >= YIELD_EVERY_MS) {
      if (signal?.aborted) {
        const err = new Error("pow: cancelled");
        err.reason = "pow_cancelled";
        throw err;
      }
      onProgress?.(counter);
      // Yield, so a solve on the main thread cannot freeze a tab outright.
      await new Promise((r) => setTimeout(r, 0));
      lastYieldAt = performance.now();
    }
  }
  const err = new Error(`pow: no solution found in ${maxAttempts} attempts at ${bits} bits`);
  err.reason = "pow_exhausted";
  throw err;
}

/**
 * §9.1: `pow = b64u(challenge) "." b64u(nonce)`.
 *
 * ⚠️ This encoding was MISSING from the specification until the server was
 * written (2026-08-11, §9.1 in 0.8.4). §5.1 and §7.3 both wrote `"pow": "<solution>"`
 * as though it were defined, and a client that sent only the nonce would have been
 * unverifiable rather than wrong. The Go server's `pow.FormatSolution` builds the
 * same string; `test/vectors.mjs` and the server's own vector test check that the
 * two agree.
 */
export function formatSolution(challengeBytes, nonceBytes) {
  return `${b64uEncode(challengeBytes)}.${b64uEncode(nonceBytes)}`;
}

/** Split a solution back into its parts. For tests and for the server's shape. */
export function parseSolution(solution) {
  const dot = solution.indexOf(".");
  if (dot < 0) throw new SyntaxError("pow: solution has no separator");
  return {
    challenge: b64uDecode(solution.slice(0, dot), "pow challenge"),
    nonce: b64uDecode(solution.slice(dot + 1), "pow nonce"),
  };
}

/** Check a solution locally — the server's condition, so a bug is caught here. */
export async function verify(solution, bits) {
  const { challenge, nonce } = parseSolution(solution);
  return leadingZeroBits(await sha256(concat(challenge, nonce))) >= bits;
}
