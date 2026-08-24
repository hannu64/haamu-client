// SHA-256 and HMAC-SHA-256 (PROTOCOL.md §0.2), from WebCrypto.

const subtle = globalThis.crypto?.subtle;
if (!subtle) {
  throw new Error(
    "WebCrypto is unavailable. In a browser this means an insecure origin: " +
      "everything in this client depends on crypto.subtle, which is only exposed " +
      "over HTTPS or on localhost."
  );
}

/** SHA-256. */
export async function sha256(data) {
  return new Uint8Array(await subtle.digest("SHA-256", data));
}

/** HMAC-SHA-256. */
export async function hmacSha256(key, data) {
  const k = await subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await subtle.sign("HMAC", k, data));
}

/**
 * Truncate a digest to its first 16 bytes — PROTOCOL.md's `Trunc128`, used by
 * §4.2 for `mailbox_id`. First bytes, not last: stated here once so no reader has
 * to infer it from a passing test.
 */
export function trunc128(digest) {
  if (digest.length < 16) throw new RangeError("trunc128: input shorter than 16 bytes");
  return digest.slice(0, 16);
}
