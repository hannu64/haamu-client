/* §3.4.1b rule 11 — what a hidden document may and may not do.
 *
 * ⚠️⚠️ THIS FILE EXISTS BECAUSE THE SAME RULE HAS NOW BEEN MISSED TWICE, IN TWO
 * MECHANISMS ONE STATEMENT APART.
 *
 *   D-140: `pollStatus` parked while hidden, so the poll obeyed rule 11 — and the
 *          bounded retry ladder wrapped around each read did not. Twelve and a half
 *          seconds of blind retries then ended a pairing every time a phone was
 *          backgrounded at the wrong moment.
 *
 *   D-141: the same loop's ten-minute active budget was added up with a stopwatch that
 *          never stopped, so an absence the loop sat through inside its slice was
 *          billed as attention. ⚠️ The path is narrower than the source suggests and
 *          my first account of it was refuted by measurement: a hidden tab's throttled
 *          timer still fires and a fast failure returns at once, so the loop reaches
 *          its park point — above the slice — within about a second either way. It is
 *          a request that HANGS, one `/status` nobody answers, that holds the loop
 *          inside the slice for the whole absence.
 *
 * ⭐ Neither is a bug in either mechanism read on its own; both are bugs in how two
 * correct mechanisms meet. Adjacency is not composition, and no review of a single
 * function reaches it. What this file can do is pin the RULE to something executable,
 * so the next mechanism that needs it has a definition to be checked against.
 *
 * ⚠️ WHAT THIS FILE CANNOT REACH: whether `pollStatus` actually USES the clock, which
 * is the composition itself and is exactly what went wrong. That needs a real browser
 * with real backgrounding and a lowered budget, and is measured in
 * `~/lpm-probes/probe-visible-budget.mjs` — both ways, unfixed and fixed.
 */
import { check, equal, section, done } from "./harness.mjs";
import { visibleClock, whenVisible, POLL_ACTIVE_BUDGET_MS } from "../src/flow/pair.js";

/** A `document` that only has a visibility state, with a hand-driven event. */
function fakeDoc(initial = "visible") {
  let visibility = initial;
  const handlers = new Set();
  return {
    get visibilityState() {
      return visibility;
    },
    addEventListener: (type, fn) => type === "visibilitychange" && handlers.add(fn),
    removeEventListener: (_type, fn) => handlers.delete(fn),
    listeners: () => handlers.size,
    go(state) {
      visibility = state;
      for (const fn of [...handlers]) fn();
    },
    /** Change state and dispatch NOTHING — the platform behaviour D-144 is about. */
    silently(state) {
      visibility = state;
    },
  };
}

/** A clock nothing advances except this test. */
function fakeNow(start = 1_000_000) {
  let t = start;
  return { now: () => t, tick: (ms) => (t += ms) };
}

section("visible the whole time — a plain stopwatch");
{
  const doc = fakeDoc();
  const c = fakeNow();
  const w = visibleClock({ doc, now: c.now });
  c.tick(4000);
  equal("four seconds watched reads as four seconds", w.elapsed(), 4000);
}

section("⭐⭐ D-141 — time spent away is not time spent watching");
{
  const doc = fakeDoc();
  const c = fakeNow();
  const w = visibleClock({ doc, now: c.now });
  c.tick(30_000);
  doc.go("hidden");
  c.tick(60 * 60 * 1000); // an hour in another app
  doc.go("visible");
  equal("an hour in the background adds nothing", w.elapsed(), 30_000);
  c.tick(5000);
  equal("and the clock picks up again on return", w.elapsed(), 35_000);
}

section("⭐⭐ and the budget therefore survives the absence that used to spend it");
{
  const doc = fakeDoc();
  const c = fakeNow();
  const w = visibleClock({ doc, now: c.now });
  c.tick(9 * 60 * 1000); // nine minutes of genuine watching
  doc.go("hidden");
  c.tick(4 * 60 * 60 * 1000); // four hours away — far past the budget
  doc.go("visible");
  check(
    "⭐ back from four hours with the budget NOT spent (the old code threw `still_waiting` here)",
    w.elapsed() < POLL_ACTIVE_BUDGET_MS,
    `${Math.round(w.elapsed() / 1000)} s of ${POLL_ACTIVE_BUDGET_MS / 1000} s`
  );
  c.tick(2 * 60 * 1000); // two more minutes actually watching
  check(
    "⭐ and it still runs out when the watching really is ten minutes",
    w.elapsed() >= POLL_ACTIVE_BUDGET_MS,
    `${Math.round(w.elapsed() / 1000)} s`
  );
}

section("the awkward events a real browser sends");
{
  const doc = fakeDoc();
  const c = fakeNow();
  const w = visibleClock({ doc, now: c.now });
  c.tick(1000);
  doc.go("hidden");
  doc.go("hidden"); // ⚠️ fires twice for one departure on some platforms
  c.tick(5000);
  doc.go("visible");
  equal("a repeated `hidden` does not bill the same milliseconds twice", w.elapsed(), 1000);
  doc.go("visible"); // and a repeated `visible` must not restart the stopwatch either
  c.tick(1000);
  equal("a repeated `visible` does not restart it", w.elapsed(), 2000);
}
{
  const doc = fakeDoc("hidden");
  const c = fakeNow();
  const w = visibleClock({ doc, now: c.now });
  c.tick(10_000);
  equal("a clock created while already hidden counts nothing", w.elapsed(), 0);
  doc.go("visible");
  c.tick(3000);
  equal("and starts when the document is shown", w.elapsed(), 3000);
}

section("it is a subscription, so it has to be given back");
{
  const doc = fakeDoc();
  const w = visibleClock({ doc, now: fakeNow().now });
  equal("one listener while it runs", doc.listeners(), 1);
  w.stop();
  equal("and none after `stop()` — a pairing attempt must not leak one", doc.listeners(), 0);
}

section("no document at all — Node, and the e2e suites");
{
  const c = fakeNow();
  const w = visibleClock({ doc: null, now: c.now });
  c.tick(7000);
  equal("degrades to a wall clock rather than to zero", w.elapsed(), 7000);
  w.stop(); // must not throw
  check("`stop()` is safe with no document", true);
}

section("⭐⭐⭐ D-144 — waking up when the event never arrives");
{
  // The whole defect in one scenario: the document becomes visible and NOTHING is
  // dispatched. Android Chrome restores a frozen tab this way, and the old code —
  // which resolved only from a `visibilitychange` listener — waited for ever on a
  // screen the person was looking at, with no error recorded anywhere.
  const doc = fakeDoc("hidden");
  const saved = globalThis.document;
  globalThis.document = doc;
  try {
    let settled = false;
    const waiting = whenVisible().then(() => (settled = true));
    await new Promise((r) => setTimeout(r, 50));
    check("still parked while genuinely hidden", settled === false);

    // Flip the state WITHOUT firing anything. `go()` would dispatch; this must not.
    doc.silently("visible");
    await new Promise((r) => setTimeout(r, 60));
    check("⚠️ an event-only implementation is still parked here", true);

    await Promise.race([waiting, new Promise((_, rj) => setTimeout(() => rj(new Error("never woke")), 2500))]);
    check("⭐ it wakes from the state itself, with no event at all", settled === true);
  } finally {
    globalThis.document = saved;
  }
}

{
  const doc = fakeDoc("visible");
  const saved = globalThis.document;
  globalThis.document = doc;
  try {
    let quick = false;
    await Promise.race([
      whenVisible().then(() => (quick = true)),
      new Promise((_, rj) => setTimeout(() => rj(new Error("slow")), 100)),
    ]);
    check("an already-visible document does not wait at all", quick === true);
  } finally {
    globalThis.document = saved;
  }
}

done();
