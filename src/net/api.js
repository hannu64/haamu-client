// The HTTP surface, as the client sees it — ARCHITECTURE.md §2.
//
// One module, so that every request this product makes passes through one place
// and the properties below are true by construction rather than by review:
//
//   • credentials: "omit" on every request. There is no cookie, no session token
//     and no Authorization header outside §5.2's per-mailbox signature. A cookie
//     would be an ambient identity, and this product's claim is that no such
//     thing exists (PROTOCOL.md §1: "There is no user object").
//   • referrerPolicy: "no-referrer". §2.1 keeps `L` in the URL fragment, which
//     browsers do not transmit — but the path can still leak the origin, and a
//     `Referer` on an API call is one more thing to have to reason about.
//   • cache: "no-store", matching the server's own header. Nothing here is
//     cacheable and a cached pairing offer is a replayed one.
//   • every request has a deadline. A hung fetch in the pairing poll would look
//     to the user exactly like a peer who has not arrived.
//
// ⚠️ NO ORIGIN OTHER THAN THE PAGE'S OWN IS EVER CONTACTED. ARCHITECTURE.md §6
// makes `connect-src 'self'` load-bearing against injected script, and that
// header protects nothing if the application itself starts talking to a second
// host. `baseUrl` exists for tests and for the dev server; it is not a
// third-party door.

/**
 * A refusal from the server, carrying the machine-readable code of §2.
 *
 * `date` is the response's `Date` header, and it is here for one specific
 * diagnosis: §5.2 rejects any signed request whose timestamp is more than 60
 * seconds out, so a device with a wrong clock gets 401 on EVERYTHING — nothing
 * sends, nothing arrives, and nothing says why. D-016 identifies that shape as the
 * one most likely to send somebody back to an insecure channel. Every HTTP
 * response carries a `Date`, so the diagnosis costs a header read.
 */
export class ApiError extends Error {
  constructor(status, code, message, date) {
    super(message || `${status} ${code}`);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.date = date ?? null;
  }
}

/** The network did not answer, or answered with something that is not JSON. */
export class NetworkError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "NetworkError";
    this.cause = cause;
  }
}

const DEFAULT_TIMEOUT_MS = 15000;

/**
 * Build the API client.
 *
 * `fetchImpl` and `now` are injected so the end-to-end test can drive a real
 * server and a unit test can drive neither.
 */
export function createApi({ baseUrl = "", fetchImpl, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const doFetch = fetchImpl || globalThis.fetch;
  if (typeof doFetch !== "function") {
    throw new TypeError("createApi: no fetch implementation available");
  }
  const base = baseUrl.replace(/\/+$/, "");

  /**
   * `bodyBytes` is the exact octets to transmit and takes precedence over `body`.
   *
   * ⚠️ SIGNED REQUESTS MUST USE IT. §5.2 hashes the request body into the string
   * that is signed, so the bytes that were hashed and the bytes that are sent have
   * to be the same object. Handing an OBJECT to a signer and letting `fetch`
   * serialise it a second time is the shape of bug §5.2 exists to prevent: two
   * serialisations of one object are usually identical, which means the day they
   * are not is the day authentication starts failing for one user on one request.
   */
  async function request(method, path, { body, bodyBytes, authorization, signal } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error("timeout")), timeoutMs);
    const onAbort = () => controller.abort(signal.reason);
    if (signal) {
      if (signal.aborted) throw signal.reason ?? new Error("aborted");
      signal.addEventListener("abort", onAbort, { once: true });
    }

    const headers = {};
    let payload;
    if (bodyBytes !== undefined) {
      payload = bodyBytes;
      headers["Content-Type"] = "application/json";
    } else if (body !== undefined) {
      payload = JSON.stringify(body);
      headers["Content-Type"] = "application/json";
    }
    if (authorization) headers.Authorization = authorization;

    let res;
    let text = "";
    try {
      res = await doFetch(base + path, {
        method,
        headers,
        body: payload,
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        redirect: "error",
        signal: controller.signal,
      });
      // ⚠️⚠️ THE BODY IS READ INSIDE THE DEADLINE, AND IT USED NOT TO BE. `clearTimeout`
      // sat in a `finally` that ran the moment `fetch()` RESOLVED — which is when the
      // response HEADERS arrive, not the body. A server that sent valid headers and
      // then stopped writing left `res.text()` awaiting forever with the fifteen-second
      // deadline already cancelled and the caller's abort no longer connected: a
      // mailbox drain stays serialised for the life of the tab and reports nothing,
      // and a pairing poll runs past both its visible-time budget and its expiry.
      // Costs nothing to hold the timer open; costs the whole session not to.
      // Found by the 2026-08-24 outside review.
      if (res.status !== 204) text = await res.text();
    } catch (err) {
      throw new NetworkError(`${method} ${path}: ${err?.message ?? "request failed"}`, err);
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
    }

    const date = res.headers?.get?.("date") ?? null;
    if (res.status === 204) return null;

    let parsed = null;
    if (text !== "") {
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        throw new NetworkError(`${method} ${path}: response is not JSON`, err);
      }
    }
    if (!res.ok) {
      // The code is what the client branches on. A human string would be
      // translated and then compared, which is how error handling silently stops
      // working in a second language.
      throw new ApiError(res.status, parsed?.error ?? "unknown", null, date);
    }
    return parsed;
  }

  return {
    get: (path, opts) => request("GET", path, opts),
    post: (path, body, opts) => request("POST", path, { ...opts, body: body ?? {} }),
    del: (path, opts) => request("DELETE", path, opts),

    /**
     * A §5.2-signed request. `authorization` and `bodyBytes` are produced together
     * by the caller (see `flow/mailbox.js`) and must not be rebuilt here.
     */
    signed: (method, path, opts) => request(method, path, opts),

    /** §9.1: `GET /api/pow` → `{ challenge, bits, expires }`. */
    powChallenge: (opts) => request("GET", "/api/pow", opts),
  };
}
