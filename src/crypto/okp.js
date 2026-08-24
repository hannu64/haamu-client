// Shared plumbing for the two Curve25519 algorithms (PROTOCOL.md §0.2).
//
// Both are "OKP" keys in WebCrypto terms, both take a 32-byte private seed, and
// neither has a raw private-key import format — so both need the same eight bytes
// of DER around the seed and the same JWK trick to read the public half back out.

const subtle = globalThis.crypto.subtle;

/**
 * PKCS#8 prefix for a 32-byte Curve25519 private key.
 *
 *   30 2e                          SEQUENCE (46 bytes)
 *     02 01 00                       version 0
 *     30 05                          SEQUENCE (5 bytes)
 *       06 03 2b 65 6e|70              OID 1.3.101.110 (X25519) / .112 (Ed25519)
 *     04 22                          OCTET STRING (34 bytes)
 *       04 20                          nested OCTET STRING (32 bytes)
 *                                        <the seed>
 *
 * WebCrypto has no "raw" import for a private OKP key, so this is not an
 * optimisation or a shortcut — it is the only door.
 */
const PKCS8_PREFIX = {
  X25519: Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x6e, 0x04, 0x22, 0x04, 0x20]),
  Ed25519: Uint8Array.from([0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20]),
};

/**
 * An operation whose primitive is missing and has no fallback installed.
 *
 * ⚠️ This message said "and it is not built yet" until step 12, which was true when
 * it was written and false the moment `client/curve/` shipped. It is the shape
 * `feedback_legal_text_drift` names: **prose about what the code does NOT do is a
 * claim with an expiry date**, and this one would have sent a person to a README to
 * read that the fix they needed did not exist.
 *
 * Reaching this now means one of two things, and neither is "unimplemented":
 * `ensurePrimitives()` was never called at startup, or it was called and could not
 * load the module — in which case §0.2 requires the client to have stopped and said
 * so before reaching any operation.
 */
export class MissingPrimitiveError extends Error {
  constructor(alg) {
    super(
      `${alg} is not available in this browser's WebCrypto and no fallback is installed. ` +
        `PROTOCOL.md §0.2 requires the client to call ensurePrimitives() at startup ` +
        `and to stop if it comes back short — see client/curve/README.md.`
    );
    this.name = "MissingPrimitiveError";
    this.algorithm = alg;
  }
}

/**
 * `value` is exactly `length` bytes, or this throws.
 *
 * ⚠️⚠️ **THIS EXISTS BECAUSE EVERY LENGTH CHECK IN THIS LAYER USED TO SIT ON THE
 * WEBCRYPTO SIDE OF THE FALLBACK BRANCH.** `toPkcs8` below refuses a key that is
 * not 32 bytes, `importPublic` refuses a public key that is not 32 bytes, and
 * §3.3's all-zero check refuses a small-order peer — and all three were reached
 * only by code that had already decided *not* to use the fallback. The functions
 * read as validated, the tests passed, and the validation covered one of the two
 * paths. On the other one a 31-byte key reached a module that reads 32.
 *
 * The shape is worth naming, because it is not one of the thirteen before it:
 * **a rule written inside the function it guards, downstream of a branch that
 * returns.** Nothing in the function's text says which callers reach it, and the
 * fallback branch was the first line. See D-076.
 *
 * The fix is not "check in the fallback as well" — that is a second place to
 * forget, and there will be a third. A check belongs BEFORE the branch, where
 * there is only one of it.
 */
export function requireBytes(alg, what, value, length) {
  if (!(value instanceof Uint8Array) || value.length !== length) {
    throw new RangeError(`${alg}: ${what} must be ${length} bytes`);
  }
  return value;
}

/** Wrap a 32-byte seed as PKCS#8 for `alg`. */
export function toPkcs8(alg, seed) {
  if (!(seed instanceof Uint8Array) || seed.length !== 32) {
    throw new RangeError(`${alg}: private key must be 32 bytes`);
  }
  const prefix = PKCS8_PREFIX[alg];
  const out = new Uint8Array(prefix.length + 32);
  out.set(prefix, 0);
  out.set(seed, prefix.length);
  return out;
}

/**
 * Import a private key and return it together with its public half.
 *
 * The public half comes from the JWK export's `x`, because WebCrypto offers no
 * "give me the public key of this private key" call. The key is imported
 * extractable for exactly that reason and for no other.
 */
export async function importPrivate(alg, seed, usages) {
  const key = await subtle.importKey("pkcs8", toPkcs8(alg, seed), alg, true, usages);
  const jwk = await subtle.exportKey("jwk", key);
  return { key, publicKey: b64uToBytes(jwk.x) };
}

/** Import a 32-byte public key. */
export async function importPublic(alg, pub, usages) {
  if (!(pub instanceof Uint8Array) || pub.length !== 32) {
    throw new RangeError(`${alg}: public key must be 32 bytes`);
  }
  return subtle.importKey("raw", pub, alg, true, usages);
}

/**
 * Is `alg` usable here?
 *
 * PROTOCOL.md §0.2: "The client MUST feature-detect at startup and fall back to a
 * WASM implementation. This fallback is not optional — it is the difference
 * between working and not working on a meaningful share of devices."
 *
 * Detection is a real key generation rather than a capability string. A browser
 * that lists the algorithm and then throws on use is not a hypothetical: the
 * device panel measured a phone that advertised `extension:prf: true` and
 * returned nothing (DEVICE_RESULTS.md).
 */
export async function probe(alg) {
  try {
    const usages = alg === "Ed25519" ? ["sign", "verify"] : ["deriveBits"];
    const pair = await subtle.generateKey(alg, true, usages);
    const jwk = await subtle.exportKey("jwk", pair.privateKey);
    return typeof jwk.x === "string" && typeof jwk.d === "string";
  } catch {
    return false;
  }
}

// JWK carries base64url. This is the one place b64u decoding happens outside
// b64u.js, and it is deliberate: importing it here would make the primitive layer
// depend on the encoding layer for a value WebCrypto itself produced.
function b64uToBytes(s) {
  const padded = s.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
