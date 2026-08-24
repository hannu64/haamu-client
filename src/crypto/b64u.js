// base64url, no padding — PROTOCOL.md §0.1's `b64u(x)`.

const ALPHABET = /^[A-Za-z0-9_-]*$/;

/** Encode bytes as base64url without padding. */
export function b64uEncode(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError("b64uEncode: expected a Uint8Array");
  // btoa takes a "binary string": one code unit per byte. Built in chunks
  // because String.fromCharCode(...spread) blows the argument limit on a
  // 64 KiB roster blob.
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/**
 * Decode base64url without padding. STRICT, and deliberately so.
 *
 * Rejected: the standard alphabet (`+`, `/`), any padding, whitespace, and any
 * encoding that is not the canonical one for its bytes (a tail with non-zero
 * unused bits re-encodes differently, so the round-trip check below catches it).
 *
 * ⚠️ PROTOCOL.md §6.4 is why this is not lenient. vodozemac's own base64 uses the
 * **standard** alphabet, so a wrapper that passed its output straight into an
 * envelope would emit a message this protocol does not describe — and a
 * same-build round-trip test is structurally incapable of noticing, because it
 * decodes exactly what it encoded. A decoder that accepts both alphabets keeps
 * that mistake invisible inside one implementation while breaking every other
 * one. This is the check that fails loudly instead.
 */
export function b64uDecode(s, what = "value") {
  if (typeof s !== "string") throw new TypeError(`${what}: expected a base64url string`);
  if (!ALPHABET.test(s)) {
    throw new SyntaxError(
      `${what}: not base64url — only A-Z a-z 0-9 - _ are permitted, with no padding`
    );
  }
  if (s.length % 4 === 1) throw new SyntaxError(`${what}: impossible base64url length`);

  const padded = s.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (s.length % 4)) % 4);
  let binary;
  try {
    binary = atob(padded);
  } catch {
    throw new SyntaxError(`${what}: not base64url`);
  }
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);

  if (b64uEncode(out) !== s) {
    throw new SyntaxError(`${what}: non-canonical base64url (unused trailing bits are not zero)`);
  }
  return out;
}

/** Decode and require an exact byte length. Every fixed-size field uses this. */
export function b64uDecodeExact(s, len, what = "value") {
  const bytes = b64uDecode(s, what);
  if (bytes.length !== len) {
    throw new RangeError(`${what}: expected ${len} bytes, got ${bytes.length}`);
  }
  return bytes;
}
