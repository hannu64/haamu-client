// PROTOCOL.md §5.3's transport policy, with no server, no browser and no clock.
//
// What is testable here is exactly what a running system cannot show you on
// demand: a network that accepts connections and drops them two seconds later, a
// socket that is open and black-holed, an epoch boundary that arrives once a week.
// Each of those is a pure function over a number in this file and a scenario
// nobody can arrange in `e2e-stream.mjs`.
//
// ⚠️ ONE THING HERE IS A CLAIM ABOUT BROWSERS AND NOT ABOUT THIS CODE: that
// `close()` inside the `error` handler really does cancel `EventSource`'s own
// retry. The fake below records the call; only Chrome can confirm the consequence,
// which is what `client/demo` under puppeteer is for.

import * as stream from "../src/net/stream.js";
import * as live from "../src/flow/live.js";
import * as messageFlow from "../src/flow/message.js";
import * as sessionStore from "../src/storage/sessions.js";
import { ROLE_JOINER } from "../src/protocol/pairing.js";
import * as olm from "../src/crypto/olm.js";
import { readFileSync } from "node:fs";
import { EPOCH_SECONDS, epochNumber, nextBoundary } from "../src/protocol/epoch.js";
import { check, equal, section, rejects, done } from "./harness.mjs";

// A minimal `EventSource`: it records what it was asked to do and lets a test push
// events at it. Nothing in src/ is stubbed — this stands in for the BROWSER.
class FakeEventSource {
  constructor(url) {
    this.url = url;
    this.closed = 0;
    this.listeners = new Map();
  }
  addEventListener(name, fn) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(fn);
  }
  close() {
    this.closed += 1;
  }
  emit(name) {
    for (const fn of this.listeners.get(name) ?? []) fn({ type: name });
  }
}

let last = null;
const Fake = function (url) {
  last = new FakeEventSource(url);
  return last;
};

const tick = () => new Promise((r) => setTimeout(r, 0));

// --------------------------------------------------------- §5.3, the backoff

section("ARCHITECTURE.md §4.4 — the backoff, and what resets it");

{
  // random() = 0.5 puts the jitter at exactly 1.0, so the sequence is readable.
  const b = new stream.Backoff({ random: () => 0.5 });
  const seq = [b.next(), b.next(), b.next(), b.next(), b.next(), b.next(), b.next()];
  equal("1 s → 30 s, doubling and then capped", seq.join(","), "1000,2000,4000,8000,16000,30000,30000");
}

{
  // ⚠️⚠️ THE RULE THE WHOLE RATE LIMIT RESTS ON. A connection that came up and died
  // two seconds later has proved nothing about the network, and treating it as a
  // success is what turns a flapping connection into an unbounded minting loop.
  const b = new stream.Backoff({ random: () => 0.5 });
  b.next();
  b.next();
  b.next();
  b.settle(2_000);
  equal("a connection that lived two seconds does NOT reset the backoff", String(b.next()), "8000");
  b.settle(stream.HEALTHY_MS);
  equal("one that lived long enough does", String(b.next()), "1000");
}

{
  // ⭐⭐ The arithmetic the server's limit is set from, checked rather than asserted
  // in a comment. Worst case: the jitter is at its floor on every attempt, and no
  // connection ever lasts long enough to reset anything.
  const worst = new stream.Backoff({ random: () => 0 });
  for (let i = 0; i < 10; i++) worst.next(); // ratchet to the cap
  const delay = worst.next();
  const perHour = 3_600_000 / delay;
  check("the worst sustained mint rate is inside the server's 240/hour", perHour < 240, `${perHour.toFixed(0)}/hour`);

  // And the jitter floor is what makes that true: a symmetric jitter would reach
  // exactly the limit at the bottom of its range, which is not a margin.
  check("because the jitter never goes below 0.75", stream.JITTER_MIN === 0.75);
  check("and a healthy connection is defined as at least one full backoff", stream.HEALTHY_MS >= stream.BACKOFF_MAX_MS);
}

section("§5.3 — the stream URL");

{
  const url = stream.streamUrl("AAAA", "tok+en/with=chars");
  equal("the token is escaped, not spliced", url, "/api/mailbox/AAAA/stream?token=tok%2Ben%2Fwith%3Dchars");
}

// ------------------------------------------------------ §5.3, one connection

section("§5.3 — one connection, from ready to gone");

{
  let woken = 0;
  const run = stream.runOnce({
    mailboxId: "M",
    token: "t",
    eventSource: Fake,
    onWake: () => woken++,
    now: () => 1000,
  });
  await tick();
  last.emit("ready");
  last.emit("wake");
  last.emit("wake");
  last.emit("bye");
  const result = await run;
  equal("a clean end is reported as such", result.reason, stream.ENDED_BYE);
  equal("both wakes reached the caller", String(woken), "2");
  equal("and the connection was closed by hand", String(last.closed), "1");
}

{
  // ⚠️ §5.3: "The client MUST close the EventSource and mint a fresh token on any
  // error event. It MUST NOT rely on the built-in reconnect." Auto-reconnect goes
  // back to the same URL with the same spent token, so leaving it alone means
  // either a permanent 401 loop or tolerating reuse of a bearer credential.
  const run = stream.runOnce({ mailboxId: "M", token: "t", eventSource: Fake, now: () => 1000 });
  await tick();
  last.emit("error");
  const result = await run;
  equal("an error ends the connection", result.reason, stream.ENDED_ERROR);
  check("and close() was called, which is what cancels the browser's own retry", last.closed === 1);
  equal("a connection that never became ready lived zero", String(result.livedMs), "0");
  check("and it is not reported as ready", result.ready === false);
}

{
  // ⚠️ The watchdog, which exists only because the server's keep-alive is an EVENT.
  // An SSE comment would keep the NATs awake and leave this timer with nothing to
  // observe: "connected and quiet" and "connected to nothing" would be one state.
  const run = stream.runOnce({ mailboxId: "M", token: "t", eventSource: Fake, watchdogMs: 20, now: () => 0 });
  await tick();
  last.emit("ready");
  const result = await run;
  equal("a silent connection is abandoned", result.reason, stream.ENDED_SILENT);
  check("and closed", last.closed === 1);
}

{
  let clock = 0;
  const run = stream.runOnce({
    mailboxId: "M",
    token: "t",
    eventSource: Fake,
    watchdogMs: 60,
    now: () => clock,
  });
  await tick();
  clock = 100;
  last.emit("ready");
  // Three beats inside the watchdog: each one has to reset it, or a healthy quiet
  // conversation would be dropped every 45 seconds.
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 30));
    last.emit("beat");
  }
  clock = 400;
  last.emit("bye");
  const result = await run;
  equal("beats keep a quiet connection alive", result.reason, stream.ENDED_BYE);
  equal("and the healthy time is measured from READY, not from the constructor", String(result.livedMs), "300");
}

{
  const ac = new AbortController();
  const run = stream.runOnce({ mailboxId: "M", token: "t", eventSource: Fake, now: () => 0 });
  const aborted = stream.runOnce({ mailboxId: "M", token: "t", eventSource: Fake, signal: ac.signal, now: () => 0 });
  await tick();
  ac.abort();
  equal("an abort is a distinct, non-failure ending", (await aborted).reason, stream.ENDED_ABORTED);
  last.emit("bye");
  await run;
}

await rejects(
  "a browser with no EventSource says so rather than failing silently",
  () => stream.runOnce({ mailboxId: "M", token: "t", eventSource: undefined }),
  /cannot open an event stream/
);

// ------------------------------------------------- §4.1 and §5.3 together

section("§4.1 vs §5.3 — one stream for three mailboxes");

{
  // The boundary arithmetic the live loop schedules around. §4.1's offset makes it
  // per channel, which is what stops every channel rolling over at once.
  const offset = 12_345;
  const at = offset + 5 * EPOCH_SECONDS;
  equal("the boundary is where the epoch number changes", String(nextBoundary(offset, at - 1)), String(at));
  equal("and crossing it advances the epoch", String(epochNumber(offset, at) - epochNumber(offset, at - 1)), "1");

  equal("just before a boundary, the distance is small", String(live.secondsFromBoundary(offset, at - 10)), "10");
  equal("just after it, so is it", String(live.secondsFromBoundary(offset, at + 10)), "10");
  equal(
    "mid-epoch it is half a week",
    String(live.secondsFromBoundary(offset, at + EPOCH_SECONDS / 2)),
    String(EPOCH_SECONDS / 2)
  );

  // ⚠️⚠️ ONE STREAM, NOT THREE (D-054). The stream is opened on `e`; the only
  // moment a peer writes anywhere else is the ±120 s that §5.2's clock bound allows
  // around a boundary, once per channel per WEEK. What covers it is a faster poll
  // in that window, not two more permanent connections per channel — the number
  // open item 6 exists to measure.
  equal("mid-epoch the floor poll is slow", String(live.pollIntervalMs(live.LIVE, EPOCH_SECONDS / 2)), String(live.FLOOR_POLL_MS));
  equal("near a boundary it quickens", String(live.pollIntervalMs(live.LIVE, 30)), String(live.BOUNDARY_POLL_MS));
  equal("on the other side of it, too", String(live.pollIntervalMs(live.LIVE, -30)), String(live.BOUNDARY_POLL_MS));
  check(
    "and the window is wider than two devices can disagree",
    live.BOUNDARY_WINDOW_S > 120,
    `${live.BOUNDARY_WINDOW_S} s > 2 × §5.2's 60 s`
  );

  // With no stream, the poll IS the delivery.
  equal("without a stream it is the degraded rate", String(live.pollIntervalMs(live.POLLING, 999)), String(live.DEGRADED_POLL_MS));
  equal("and while connecting, the same", String(live.pollIntervalMs(live.CONNECTING, 999)), String(live.DEGRADED_POLL_MS));
  check(
    "which stays inside §9.2's per-mailbox budget",
    (3 * 3_600_000) / live.DEGRADED_POLL_MS < 3600,
    `${((3 * 3_600_000) / live.DEGRADED_POLL_MS).toFixed(0)} signed reads/hour for three epochs`
  );
}

section("§5.4.2 — two triggers, one drain");

{
  // ⚠️⚠️ Step 6 gives the drain a second trigger, and `flow/message.js`'s receive is
  // load → decrypt → save over one record. Two at once fetch the same ciphertext
  // twice, and the second decrypt fails against a ratchet the first advanced — a
  // message reported unreadable because this device asked for it twice.
  let running = 0;
  let overlap = 0;
  let runs = 0;
  const run = live.serialiser(async () => {
    runs++;
    running++;
    if (running > 1) overlap++;
    await new Promise((r) => setTimeout(r, 5));
    running--;
  });

  const first = run();
  await tick();
  // Three more triggers arrive while the first is still going: a wake, a poll, and
  // another wake.
  await Promise.all([run(), run(), run(), first]);
  equal("never two at once", String(overlap), "0");
  equal("and three triggers during one drain are one more drain, not three", String(runs), "2");

  // A failure must not wedge it: the next trigger still runs.
  let boom = true;
  const flaky = live.serialiser(async () => {
    if (boom) {
      boom = false;
      throw new Error("network");
    }
  });
  await flaky().catch(() => {});
  let ok = true;
  await flaky().catch(() => {
    ok = false;
  });
  check("a failed drain does not wedge the next one", ok);
}

// ======================================= §7.8 step 1 — asking a drain to stop is
//                                         not the same as it having stopped

/*
  ⚠️⚠️ `idle()` EXISTS BECAUSE `run()` DELIBERATELY LIES TO ITS CALLER, and that lie
  is the right one. A trigger arriving during a drain is COALESCED — it returns at
  once, because three wakes during one drain are one more drain, not three (the
  section above). So `await run()` tells a caller nothing about the drain that is
  actually in the store right now.

  §7.8 step 1 needs the opposite question. The 2026-08-24 outside review found the
  consequence: a wake starts a drain via `void drainNow()`, the mailbox answers, and
  while the plaintext is being written the person ends the session — `stop()` called
  `abort()` and returned, step 3 emptied the database, and the drain that was already
  past its abort checks wrote the conversation back in. It reappeared at the next
  unlock.

  ➡️ **A FUNCTION THAT RETURNS EARLY BY DESIGN CANNOT ALSO BE THE ANSWER TO "IS IT
  FINISHED?"** — the two need separate handles, and the second one had never been
  written.
*/
section("§7.8 step 1 — `idle()` waits for the drain that is actually running");

{
  let finished = 0;
  let release;
  const held = new Promise((r) => (release = r));
  const run = live.serialiser(async () => {
    await held;
    finished++;
  });

  void run(); // ⚠️ the wake path: nobody holds this promise, which is the whole case
  await tick();

  let idled = false;
  const waiting = run.idle().then(() => (idled = true));
  await tick();
  check("⭐⭐ idle() does NOT resolve while a drain is in the store", !idled);
  equal("and nothing has finished yet", String(finished), "0");

  release();
  await waiting;
  check("it resolves once the drain has finished", idled);
  equal("and the drain really did finish", String(finished), "1");

  // ⚠️ THE COALESCED RUN COUNTS TOO. A trigger that arrived mid-drain has not
  // started when `stop()` is called, and it writes to the same store.
  let release2;
  const held2 = new Promise((r) => (release2 = r));
  let done2 = 0;
  const run2 = live.serialiser(async () => {
    await held2;
    done2++;
  });
  void run2();
  await tick();
  void run2(); // coalesced into a second pass
  let idled2 = false;
  const waiting2 = run2.idle().then(() => (idled2 = true));
  release2();
  await waiting2;
  check("⭐⭐ idle() also covers the run that was coalesced into the current one", idled2);
  equal("both passes ran", String(done2), "2");

  // ⚠️ AND IT NEVER REJECTS. A drain that failed is a drain that finished, and an
  // ending must not be abandoned half-done because the network went away.
  const boom = live.serialiser(async () => {
    throw new Error("network");
  });
  void boom().catch(() => {});
  let survived = false;
  await boom.idle().then(() => (survived = true), () => {});
  check("⭐ idle() resolves rather than rejecting when the drain failed", survived);
}

/*
  ⚠️⚠️ AND THE SAME QUESTION ASKED OF THE THING THE ENDING ACTUALLY CALLS. The block
  above proves the mechanism; this one proves it is WIRED. That distinction is the
  one the 2026-08-24 review kept finding — four times in one pass, a check asking
  whether something exists rather than whether it is used — and `app/app.js`'s
  `stopEverything` was a live example: its own header said *"it has to be awaitable,
  because step 3 clears the database these streams write into"*, it was declared
  `async`, every caller awaited it, and inside it called `stop()` without `await`
  against a `stop()` that returned instantly.

  ⭐ The fake below is only the TRANSPORT. Epoch derivation, request signing, the
  serialiser and the loops are the real ones, so a `stop()` that stopped awaiting any
  one of them fails here.
*/
section("§7.8 step 1 — `startLive().stop()` does not resolve until the drain has");

{
  let release;
  const held = new Promise((r) => (release = r));
  let reached;
  // ⚠️ A PROMISE, NOT A COUNT OF TICKS. `drainChannel` polls three epochs (§4.1) and
  // each mailbox is an HKDF away, so "the drain has reached the mailbox" is a good
  // many microtasks after `startLive` returns — and a test that guessed the number
  // would pass while the drain had not started, which is a test of nothing.
  const atTheMailbox = new Promise((r) => (reached = r));
  let drains = 0;

  // ⚠️ THE REAL WASM, AND IT IS NOT OPTIONAL HERE. `messageFlow.receive` loads the
  // Olm wrapper before it touches the network, so a run without it never reaches the
  // mailbox at all — the drain fails early, `stop()` returns quickly, and the check
  // below passes while testing nothing. Measured while writing it: exactly that.
  await olm.initOlm({ wasm: readFileSync(new URL("../wasm/dist/lpm_olm_wasm_bg.wasm", import.meta.url)) });

  const api = {
    signed: async (method, path) => {
      if (method === "GET" && path.endsWith("/messages")) {
        drains++;
        reached();
        await held; // the mailbox does not answer until this test says so
        return { messages: [] };
      }
      // Everything else — register, stream token — is refused, which puts the
      // stream loop on the poll path and is exactly what a browser with no
      // EventSource does. §5.3 says that is allowed to happen.
      const err = new Error("unavailable");
      err.reason = "unavailable";
      throw err;
    },
  };

  const channel = messageFlow.openChannel({

    scope: "test",
    api,
    backend: sessionStore.memoryBackend(),
    pickleKey: sessionStore.randomPickleKey(),
    channelRoot: new Uint8Array(32).fill(0x3c),
    role: ROLE_JOINER,
  });

  const running = live.startLive(channel);
  await atTheMailbox;
  equal("a drain is in flight", String(drains), "1");

  let stopped = false;
  const promise = running.stop();
  check("⭐ stop() returns something awaitable at all — it used to return undefined",
    typeof promise?.then === "function");
  const stopping = promise.then(() => (stopped = true));
  for (let i = 0; i < 20; i++) await tick();
  check("⭐⭐⭐ stop() has NOT resolved while the drain is still in the store", !stopped,
    "this is the whole of B#2: `abort()` and return is a request, not a stop");

  release();
  await stopping;
  check("and it resolves once the drain is finished", stopped);
}

/*
  ⚠️⚠️⚠️ AND NOW THE DRAIN NOBODY IS AWAITING, WHICH IS THE ONE B#2 IS ACTUALLY
  ABOUT — AND WHICH THE BLOCK ABOVE CANNOT SEE.

  Up there the blocked drain was started by `streamLoop` with `await drainNow()`, so
  the loop itself is parked on it: a `stop()` that awaited only the loops would pass
  that test while doing nothing about `idle()`. **Measured, on 2026-08-24, by
  mutating exactly that** — `Promise.allSettled([...loops])` alone kept all 45 checks
  green.

  ➡️ **WIDENING SOME AXES OF A GUARD MOVES THE HOLE; IT DOES NOT CLOSE IT.** The same
  lesson as D-161's copy guard, met again in the same week, in a different file. The
  axis that mattered here is WHO STARTED THE DRAIN.

  §5.3's wake path starts one with `void drainNow()` — nobody holds that promise, by
  design, because a wake must not block the stream it arrived on. That is the drain
  that was writing to the database while §7.8 step 3 emptied it. So this block gets
  the stream genuinely connected, fires a real `wake` through the fake EventSource,
  and stops while the loops are parked inside `runOnce` rather than inside the drain.
*/
section("§7.8 step 1 — and the wake-path drain, which no loop is holding");

{
  let release;
  const held = new Promise((r) => (release = r));
  let blocking = false;
  let reachedBlocked;
  const atTheBlockedDrain = new Promise((r) => (reachedBlocked = r));

  const api = {
    signed: async (method, path) => {
      if (method === "GET" && path.endsWith("/messages")) {
        if (!blocking) return { messages: [] }; // the opening drain passes straight through
        reachedBlocked();
        await held;
        return { messages: [] };
      }
      if (path.endsWith("/register")) return {};
      if (path.endsWith("/stream-token")) return { token: "t" };
      return {};
    },
  };

  const channel = messageFlow.openChannel({

    scope: "test",
    api,
    backend: sessionStore.memoryBackend(),
    pickleKey: sessionStore.randomPickleKey(),
    channelRoot: new Uint8Array(32).fill(0x7d),
    role: ROLE_JOINER,
  });

  last = null;
  const running = live.startLive(channel, { eventSource: Fake });

  // Wait for the connection to be opened at all, then hand it the `ready` a real
  // server sends. That is what puts `streamLoop` inside `runOnce` instead of inside
  // a drain — which is the whole precondition of this block.
  for (let i = 0; i < 500 && last === null; i++) await tick();
  check("the stream was opened", last !== null);
  last.emit("ready");
  for (let i = 0; i < 50 && running.state !== live.LIVE; i++) await tick();
  equal("the stream is live, so no loop is sitting on a drain", running.state, live.LIVE);

  blocking = true;
  last.emit("wake"); // §5.3's wake → `void drainNow()`; nobody holds this promise
  await atTheBlockedDrain;

  let stopped = false;
  const stopping = running.stop().then(() => (stopped = true));
  for (let i = 0; i < 50; i++) await tick();
  check("⭐⭐⭐ stop() STILL waits — for a drain no loop is holding", !stopped,
    "awaiting the loops alone passes the block above and fails here");

  release();
  await stopping;
  check("and it resolves once that drain is finished too", stopped);
}

done();
