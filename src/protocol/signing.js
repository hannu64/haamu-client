// PROTOCOL.md §5.2 — request signing. Every mailbox and roster operation carries
// one.

import { b64uEncode } from "../crypto/b64u.js";
import { asciiBytes, decimal, expectLength, utf8Bytes } from "../crypto/bytes.js";
import { sha256 } from "../crypto/hash.js";
import { randomBytes } from "../crypto/random.js";
import * as ed25519 from "../crypto/ed25519.js";

/**
 * §5.2: "TAG is a domain-separation tag, and it MUST carry the surface."
 *
 * A single constant used in both canonical strings separates nothing between
 * them. What actually keeps a mailbox signature from being replayed at the roster
 * is that no key is valid on both — mailbox keys come from HKDF(R, …) and
 * `roster_auth` from HKDF(K_master, …). That is sufficient today and it is not
 * what the tag was said to do; naming the surface costs one line and means the
 * separation no longer depends on a key-scoping accident holding for every future
 * surface.
 */
export const TAG_MAILBOX = "lpm-req-mailbox-v1";
export const TAG_ROSTER = "lpm-req-roster-v1";

/** §5.2 step 1: the server rejects anything more than 60 seconds out. */
export const MAX_CLOCK_SKEW_SECONDS = 60;

export const NONCE_BYTES = 16;

/** A fresh request nonce. */
export function newNonce() {
  return randomBytes(NONCE_BYTES);
}

/**
 * Serialise a JSON body to the exact bytes that will be signed AND sent.
 *
 * ⚠️ Sign these bytes and send these bytes. Signing an object and letting `fetch`
 * serialise it again is the shape of bug §5.2 exists to prevent: two
 * serialisations of one object are usually identical, which means the day they
 * are not is the day authentication starts failing for one user on one request.
 */
export function encodeBody(value) {
  return utf8Bytes(JSON.stringify(value));
}

/**
 * §5.2's canonical string, as its ASCII bytes:
 *
 *   TAG || "\n" || METHOD || "\n" || PATH || "\n" || b64u(id) || "\n" ||
 *   decimal(unix_seconds) || "\n" || b64u(nonce) || "\n" || b64u(SHA256(body))
 *
 * ⚠️⚠️ EVERY FIELD IS ASCII AND THE STRING IS SIGNED AS ITS ASCII BYTES. This is
 * not a stylistic choice — the earlier form wrote the identifier bare and the
 * timestamp as LE64, i.e. raw binary spliced into a string joined with "\n". A
 * browser building it the obvious way UTF-8-expands every byte ≥ 0x80 into two
 * bytes while a Go server writing binary.LittleEndian.PutUint64 does not, so the
 * two sign different byte strings and every request 401s. Not even consistently:
 * one timestamp byte is ≥ 0x80 for half of every 256 seconds, so the failure rate
 * drifts from about half of requests toward all of them, and an intermittent
 * authentication failure that looks like a flaky network is worse than a total one.
 *
 * `asciiBytes()` is what makes that unrepresentable here rather than merely
 * documented: any non-ASCII field throws instead of expanding.
 */
export async function canonicalRequest({ tag, method, path, id, timestamp, nonce, body }) {
  if (tag !== TAG_MAILBOX && tag !== TAG_ROSTER) {
    throw new RangeError(`tag: expected ${TAG_MAILBOX} or ${TAG_ROSTER}, got ${JSON.stringify(tag)}`);
  }
  if (typeof method !== "string" || !/^[A-Z]+$/.test(method)) {
    throw new RangeError(`method: expected an upper-case HTTP method, got ${JSON.stringify(method)}`);
  }
  // §5.2: "PATH is the percent-encoded request path excluding the query string,
  // and MUST NOT contain a newline." Excluding the query string is deliberate: a
  // signed request covers no query parameters, so no endpoint may let one change
  // the meaning of the request.
  if (typeof path !== "string" || !path.startsWith("/") || path.includes("\n") || path.includes("?")) {
    throw new RangeError(
      `path: expected an absolute path with no query string and no newline, got ${JSON.stringify(path)}`
    );
  }
  expectLength(nonce, NONCE_BYTES, "nonce");
  if (!(id instanceof Uint8Array) || id.length !== 16) {
    throw new RangeError("id: expected a 16-byte mailbox_id or roster_id");
  }

  const bodyBytes = body === undefined || body === null ? new Uint8Array(0) : body;
  if (!(bodyBytes instanceof Uint8Array)) {
    throw new TypeError("body: expected the exact request bytes (see encodeBody)");
  }

  const line = [
    tag,
    method,
    path,
    b64uEncode(id),
    decimal(timestamp, "timestamp"),
    b64uEncode(nonce),
    b64uEncode(await sha256(bodyBytes)), // SHA256("") for empty bodies
  ].join("\n");

  return asciiBytes(line, "canonical request");
}

/**
 * Sign a request and return both the `Authorization` header value and the pieces
 * that went into it.
 *
 * `privateKey` is the private half of the keypair for THE MAILBOX NAMED IN THE
 * REQUEST (§4.2) — the direction's key, not a per-party one. A sender signs
 * operations on the peer's inbound mailbox with that mailbox's key, which it
 * derives itself.
 *
 * `request.publicKey` is the matching public half and travels in the credential.
 * See formatAuthorization.
 */
export async function signRequest(privateKey, request) {
  const nonce = request.nonce ?? newNonce();
  const timestamp = request.timestamp;
  const canonical = await canonicalRequest({ ...request, nonce, timestamp });
  const signature = await ed25519.sign(privateKey, canonical);
  return {
    authorization: formatAuthorization({ timestamp, nonce, signature, publicKey: request.publicKey }),
    canonical,
    nonce,
    timestamp,
    signature,
  };
}

/**
 * §5.2: `LPM-Ed25519 ts=<unix>,nonce=<b64u>,sig=<b64u>,key=<b64u>`.
 *
 * ⭐ `key` IS PROTOCOL 0.8.7 AND IT IS NOT OPTIONAL IN PRACTICE. §5.1 requires an
 * authenticated read of a mailbox that does not exist — that is how §4.1 polls
 * epoch `e+1` without registering it, and registering it early is what would start
 * the server's expiry clock two epochs before the mailbox is used and make §5.4's
 * "at least 7 days" false. But the server has no stored key for a mailbox that was
 * never registered, and before 0.8.7 the request had nowhere to put one: a GET has
 * no body, and §5.2's credential had only `ts`, `nonce` and `sig`. The check §5.1
 * demanded had no input channel.
 *
 * It is NOT inside the signature and does not need to be: `mailbox_id` is a
 * commitment to this key (§4.2) and `mailbox_id` is signed, so substituting a
 * different key fails the server's commitment check. Stripping the field provokes a
 * 401 — which dropping the request achieves anyway.
 *
 * The client always sends it, including for mailboxes it knows exist. A client that
 * sent it only when it expected absence would work for epoch `e` and 401 for `e+1`,
 * which is the intermittent failure §5.2 spends a page trying to make impossible.
 */
export function formatAuthorization({ timestamp, nonce, signature, publicKey }) {
  expectLength(publicKey, 32, "public key");
  return (
    `LPM-Ed25519 ts=${decimal(timestamp, "timestamp")}` +
    `,nonce=${b64uEncode(nonce)}` +
    `,sig=${b64uEncode(signature)}` +
    `,key=${b64uEncode(publicKey)}`
  );
}

/**
 * Parse an `Authorization` header. The client never receives one — this exists so
 * the test vectors can be checked from the reading side, which is the side the
 * server implements.
 */
export function parseAuthorization(header) {
  const prefix = "LPM-Ed25519 ";
  if (typeof header !== "string" || !header.startsWith(prefix)) {
    throw new SyntaxError("authorization: not an LPM-Ed25519 credential");
  }
  const fields = {};
  for (const part of header.slice(prefix.length).split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) throw new SyntaxError("authorization: malformed field");
    fields[part.slice(0, eq)] = part.slice(eq + 1);
  }
  for (const k of ["ts", "nonce", "sig", "key"]) {
    if (!(k in fields)) throw new SyntaxError(`authorization: missing ${k}`);
  }
  if (!/^(0|[1-9][0-9]*)$/.test(fields.ts)) throw new SyntaxError("authorization: ts is not decimal");
  return fields;
}

/**
 * Is a 401 explained by this device's clock? (§5.2's warning.)
 *
 * A clock off by more than 60 seconds 401s EVERY signed request: no messages
 * send, no messages arrive, nothing works, and nothing in the product says why —
 * the shape D-016 identifies as most likely to send someone back to an insecure
 * channel. Every HTTP response carries a `Date` header, so the diagnosis is free.
 * Returns the signed difference in seconds, or null if the response had no usable
 * `Date`.
 */
export function clockSkewFromDate(dateHeader, localSeconds) {
  if (!dateHeader) return null;
  const server = Date.parse(dateHeader);
  if (Number.isNaN(server)) return null;
  return localSeconds - Math.floor(server / 1000);
}
