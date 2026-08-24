// The SSE client — PROTOCOL.md §5.3, ARCHITECTURE.md §4.4.
//
// This module is the transport and nothing else: it opens one connection, reports
// what happened to it, and knows when to try again. It does not mint the token
// (that is a §5.2-signed mailbox call, so it lives in `flow/mailbox.js`), it does
// not drain, and it does not know what a message is. `flow/live.js` joins the two.
//
// ⚠️⚠️ THE CONNECTION IS CLOSED BY HAND ON EVERY FAILURE, AND `EventSource`'s OWN
// RECONNECT IS NEVER USED. §5.3 is explicit: auto-reconnect goes back to THE SAME
// URL carrying THE SAME already-spent token, so "single-use" and automatic
// reconnection cannot both hold. An implementation that leaves it alone either
// 401-loops for ever against a dead URL or is forced to tolerate token reuse, which
// turns a 30-second capability into a multi-use bearer credential in a URL.
//
// ⚠️⚠️ THE BACKOFF RESETS ON A HEALTHY CONNECTION, NEVER ON A SUCCESSFUL ONE, and
// this is the rule that keeps the whole scheme inside its rate limit. Reset on
// `open` and a network that accepts connections and drops them two seconds later
// mints a token every few seconds for ever — the client would be indistinguishable
// from an attack on the endpoint §9.2 singles out. See `Backoff.settle`.
//
// ⚠️ A STREAM THAT FAILS COSTS LIVE DELIVERY AND NOTHING ELSE. §5.3's stream is a
// notification; §5.4.1's drain is the delivery. Every refusal here — a rate-limited
// mint, a full ceiling, a browser with no `EventSource` at all — degrades to
// polling, and a caller that treats one as fatal has misread the design.

/**
 * The server's heartbeat interval, mirrored from `server/internal/api/stream.go`.
 * It is here to derive the watchdog below and for no other purpose; the client
 * never assumes a beat arrives on time, only that three in a row do not go missing.
 */
export const SERVER_BEAT_MS = 15_000;

/**
 * How long a silent connection is tolerated.
 *
 * ⚠️ THIS IS WHY THE SERVER'S KEEP-ALIVE IS AN EVENT RATHER THAN AN SSE COMMENT.
 * The conventional keep-alive is a `:` comment, which `EventSource` never surfaces
 * to any handler — it stops proxies and NATs reaping an idle connection and tells
 * the client nothing at all. On the mobile networks §5.3 and §9.2 both single out,
 * the failure that matters is a socket that is open, quiet and black-holed, and
 * without an observable beat this timer could not exist: "connected and nobody is
 * talking" and "connected to nothing" would look identical.
 */
export const WATCHDOG_MS = 3 * SERVER_BEAT_MS;

/** ARCHITECTURE.md §4.4: "exponential backoff (1 s → 30 s, jittered)". */
export const BACKOFF_MIN_MS = 1_000;
export const BACKOFF_MAX_MS = 30_000;

/**
 * How long a connection must last to count as healthy.
 *
 * ⚠️ IT MUST NOT BE LESS THAN `BACKOFF_MAX_MS`. If a connection shorter than the
 * longest backoff could reset the sequence, a flapping network would ratchet the
 * delay back to one second every time and the sustained mint rate would be bounded
 * by the round trip rather than by the backoff.
 */
export const HEALTHY_MS = BACKOFF_MAX_MS;

/**
 * Jitter, as a fraction of the computed delay. The lower bound is what fixes the
 * worst sustained mint rate, so it is not decoration:
 *
 *   3600 s/hour ÷ (30 s × 0.75) = 160 mints/hour, against the server's 240.
 *
 * A symmetric jitter around the delay would average the same and allow 240 exactly
 * at the bottom of its range, which is the limit rather than a margin.
 */
export const JITTER_MIN = 0.75;
export const JITTER_MAX = 1.25;

/** Why a connection ended. Each is a different thing for the caller to do. */
export const ENDED_BYE = "bye"; // the server's lifetime expired: reconnect at once
export const ENDED_ERROR = "error"; // the transport failed
export const ENDED_SILENT = "silent"; // open, but nothing arrived: the watchdog fired
export const ENDED_ABORTED = "aborted"; // the caller stopped it

/** This browser cannot stream at all. Not fatal — see the header. */
export class StreamUnsupported extends Error {
  constructor(message) {
    super(message);
    this.name = "StreamUnsupported";
    this.reason = "stream_unsupported";
  }
}

/**
 * ARCHITECTURE.md §4.4's backoff, as a small object so that the policy can be
 * tested without a network, a clock or a browser.
 */
export class Backoff {
  #attempt = 0;
  #min;
  #max;
  #healthy;
  #random;

  constructor({ minMs = BACKOFF_MIN_MS, maxMs = BACKOFF_MAX_MS, healthyMs = HEALTHY_MS, random = Math.random } = {}) {
    this.#min = minMs;
    this.#max = maxMs;
    this.#healthy = healthyMs;
    this.#random = random;
  }

  get attempt() {
    return this.#attempt;
  }

  /** The delay before the next attempt, in milliseconds. Advances the sequence. */
  next() {
    const ceiling = Math.min(this.#max, this.#min * 2 ** this.#attempt);
    this.#attempt += 1;
    return Math.round(ceiling * (JITTER_MIN + (JITTER_MAX - JITTER_MIN) * this.#random()));
  }

  /**
   * A connection has ended after `livedMs` of being READY.
   *
   * ⚠️ THE ARGUMENT IS TIME SPENT HEALTHY, NOT WHETHER THE CONNECTION SUCCEEDED.
   * See the file header: this single line is what stops a connect-then-drop loop
   * from becoming an unbounded token-minting loop.
   */
  settle(livedMs) {
    if (livedMs >= this.#healthy) this.#attempt = 0;
  }
}

/**
 * §5.3's stream URL.
 *
 * ⚠️ THE TOKEN IS A SECRET IN A URL, which the rest of this design goes out of its
 * way to avoid — §2.1 puts the pairing secret in the fragment precisely because a
 * path is logged, proxied and shoulder-surfed. `EventSource` cannot set a header,
 * so §5.3 accepts it knowingly and pays for it with a 30-second, single-use token
 * that is redeemed milliseconds after it is minted. Nothing here may log this
 * string, and it must never be put in an error message.
 */
export function streamUrl(mailboxId, token) {
  return `/api/mailbox/${mailboxId}/stream?token=${encodeURIComponent(token)}`;
}

/**
 * Run ONE connection to completion.
 *
 * Resolves `{ reason, ready, livedMs }` — never rejects on a transport failure,
 * because a failed stream is an expected state of this design rather than an error.
 * `onWake` is called for each `wake` event and must not throw.
 *
 * `eventSource` and `now` are injected so that the policy can be driven without a
 * browser. ⚠️ A test double is not a substitute for the real thing here: whether
 * `close()` inside the error handler really cancels the browser's own retry is a
 * fact about browsers, and it is checked in `client/app` against Chrome.
 */
export function runOnce({
  mailboxId,
  token,
  onWake,
  onReady,
  eventSource,
  watchdogMs = WATCHDOG_MS,
  now = () => Date.now(),
  signal,
} = {}) {
  const Impl = eventSource ?? globalThis.EventSource;
  if (typeof Impl !== "function") {
    return Promise.reject(new StreamUnsupported("this browser cannot open an event stream"));
  }

  return new Promise((resolve) => {
    const es = new Impl(streamUrl(mailboxId, token));
    let readyAt = null;
    let timer = null;
    let done = false;

    const finish = (reason) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      // ⚠️ ALWAYS, AND ESPECIALLY ON `error`. See the file header: this is what
      // stops the browser reconnecting to the same URL with the spent token.
      try {
        es.close();
      } catch {
        // A double close, or a double-closed double. Nothing to do about it.
      }
      resolve({ reason, ready: readyAt !== null, livedMs: readyAt === null ? 0 : now() - readyAt });
    };

    const onAbort = () => finish(ENDED_ABORTED);
    const pet = () => {
      clearTimeout(timer);
      timer = setTimeout(() => finish(ENDED_SILENT), watchdogMs);
    };

    // The watchdog runs from the moment the object exists, so a connection that
    // never produces `ready` — a buffering intermediary, a captive portal serving
    // its own page — is abandoned on the same timer as one that goes quiet.
    pet();

    es.addEventListener("ready", () => {
      readyAt = now();
      pet();
      onReady?.();
    });
    es.addEventListener("beat", pet);
    es.addEventListener("wake", () => {
      pet();
      onWake?.();
    });
    es.addEventListener("bye", () => finish(ENDED_BYE));
    es.addEventListener("error", () => finish(ENDED_ERROR));

    if (signal) {
      if (signal.aborted) finish(ENDED_ABORTED);
      else signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}
