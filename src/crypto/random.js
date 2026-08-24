// Randomness. `crypto.getRandomValues` and nothing else (PROTOCOL.md §0.2).

/** n random bytes from the platform CSPRNG. */
export function randomBytes(n) {
  if (!Number.isSafeInteger(n) || n <= 0 || n > 65536) {
    throw new RangeError(`randomBytes: ${n} out of range`);
  }
  // getRandomValues caps at 65536 bytes per call; nothing here asks for more.
  return crypto.getRandomValues(new Uint8Array(n));
}

/**
 * A uniform integer in [0, n) by REJECTION SAMPLING, never modulo.
 *
 * ⚠️ PROTOCOL.md §7.4 requires this by name and states a consequence that is not
 * the usual one. 1296 does not divide 2^16, so modulo would bias the low indices —
 * and because `roster_id` is deterministic in the phrase, a weak or biased draw
 * does not merely weaken one user's key: **two users can land on the same roster
 * and silently union their channel lists, including each other's roots.**
 *
 * The rejection bound is the largest multiple of n that fits the drawn width, so
 * every accepted value maps to exactly one index. At n = 1296 the draw is 16 bits,
 * the bound is 64800, and 1.1% of draws are discarded.
 */
export function randomIndex(n) {
  if (!Number.isSafeInteger(n) || n < 1 || n > 0x1000000) {
    throw new RangeError(`randomIndex: ${n} out of range`);
  }
  if (n === 1) return 0;

  const width = n <= 0x100 ? 1 : n <= 0x10000 ? 2 : 3;
  const span = 2 ** (width * 8);
  const bound = span - (span % n); // largest multiple of n that fits

  for (;;) {
    const bytes = randomBytes(width);
    let v = 0;
    for (let i = 0; i < width; i++) v = (v << 8) | bytes[i];
    if (v < bound) return v % n;
    // Rejected. Redraw — never fold the value back in, which is the bias this
    // function exists to avoid.
  }
}
