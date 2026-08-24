// The primitive layer. PROTOCOL.md §0.2 is the list; ARCHITECTURE.md §4 says this
// is "the only place primitives appear; no crypto elsewhere", and that is a
// design constraint rather than a preference — the audience for this product
// includes people who will read it with the specification open beside them.

export * from "./bytes.js";
export * from "./b64u.js";
export * from "./hash.js";
export * from "./hkdf.js";
export * from "./random.js";
export { seal, open, IV_LENGTH, TAG_LENGTH } from "./aead.js";
export { MissingPrimitiveError } from "./okp.js";

import * as x25519 from "./x25519.js";
import * as ed25519 from "./ed25519.js";
export { x25519, ed25519 };

/**
 * Startup feature detection (PROTOCOL.md §0.2).
 *
 * Call this once, before anything else, and act on the result: the two curve
 * algorithms are the ones with uneven support, and a client that discovers a
 * missing primitive at the moment a user presses "pair" has already failed.
 *
 * Argon2id is not probed here because it is not a WebCrypto algorithm — it comes
 * from WASM either way. See protocol/passphrase.js.
 */
export async function detectPrimitives() {
  const [x, e] = await Promise.all([x25519.available(), ed25519.available()]);
  return { x25519: x, ed25519: e, complete: x && e };
}

/**
 * Detect, and install §0.2's WASM fallback if this browser needs it (D-075).
 *
 * This is the function §0.2 asks for. Call it once at startup and act on the
 * result: "The client MUST feature-detect at startup and fall back to a WASM
 * implementation. This fallback is not optional — it is the difference between
 * working and not working on a meaningful share of devices."
 *
 * ⚠️ **The import is inside the branch, and that placement is most of the
 * point.** `crypto/curve.js` pulls a 41 KiB module that a browser with X25519 in
 * WebCrypto will never execute, so it is fetched by the devices that have no
 * alternative and by nobody else. A static import at the top of this file would
 * put it on every first load in the product.
 *
 * Returns the detection result with two additions:
 *
 *   fallback   whether the WASM implementation was installed
 *   reason     when `complete` is false, why — and this is a thing to SHOW
 *              someone, because the alternative is a device that fails at the
 *              moment its owner presses "pair", which is what §0.2 says has
 *              already failed
 *
 * `insteadOfWebCrypto` forces the fallback onto a device that does not need it.
 * It is how this path gets exercised at all; see `x25519.js`.
 */
export async function ensurePrimitives({ wasm, insteadOfWebCrypto = false } = {}) {
  const detected = await detectPrimitives();
  if (detected.complete && !insteadOfWebCrypto) return { ...detected, fallback: false };

  try {
    const curve = await import("./curve.js");
    await curve.initCurve({ wasm });
    x25519.installFallback(curve.x25519Fallback, { insteadOfWebCrypto });
    ed25519.installFallback(curve.ed25519Fallback, { insteadOfWebCrypto });
  } catch (err) {
    // The fallback could not be loaded, which on a browser that needs it is the
    // end of the road — but a REPORTED end, at startup, rather than a handshake
    // that dies halfway. WASM is not universal either (some hardened enterprise
    // and kiosk configurations refuse it), and neither is the network at the
    // moment the module is asked for.
    return {
      ...detected,
      fallback: false,
      reason: `the fallback for ${missingNames(detected)} could not be loaded (${err.message})`,
    };
  }

  const after = await detectPrimitives();
  return {
    ...after,
    fallback: true,
    ...(after.complete ? {} : { reason: `${missingNames(after)} is unavailable even with the fallback` }),
  };
}

function missingNames(detected) {
  const missing = [];
  if (!detected.x25519) missing.push("X25519");
  if (!detected.ed25519) missing.push("Ed25519");
  return missing.join(" and ") || "a primitive";
}
