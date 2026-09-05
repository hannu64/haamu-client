// Ending a session, and locking it — PROTOCOL.md §7.8, §7.7 and ARCHITECTURE.md §4.3.
//
// ⚠️⚠️ THE ORDER IS THE SUBJECT, not the individual steps. Each step of §7.8 is
// easy to check and none of them is where the defect was: the ending cleared the
// database while the things that write to it were still running, because §7.8 put
// "stop them" in a later step than "clear it". A test that ran the steps and
// asserted the end state would pass on the broken order — so the checks below
// RECORD THE SEQUENCE and assert on that.

import * as endings from "../src/flow/ending.js";
import * as lock from "../src/flow/lock.js";
import * as tabs from "../src/flow/tabs.js";
import * as db from "../src/storage/db.js";
import * as vault from "../src/storage/vault.js";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { check, equal, section, done } from "./harness.mjs";

// ⚠️ THIS SECTION RUNS FIRST, AND THAT IS NOT ARBITRARY. §7.8 step 0's "the
// document has ended" is MODULE state, because it has to outlive the session
// object, the keys and every store — a bfcache restore brings the document back
// with all of those gone and this still set. The consequence is that a document
// can only end once, which is correct for the product and means the checks below
// have to be made before anything else in this file ends anything. There is
// deliberately no reset hatch: a test-only way to un-end a document is a
// production code path that says an ended document can carry on.

// ======================================================= §7.8 step 0, the bfcache

section("§7.8 step 0 — the document that comes back with its heap intact");

{
  const handlers = {};
  const navigated = [];
  const target = { addEventListener: (type, fn) => (handlers[type] = fn) };
  endings.armBfcacheDefence({ target, navigate: (p) => navigated.push(p) });

  check("a pageshow handler is registered at boot, not at the ending", typeof handlers.pageshow === "function");

  // Before any ending: a restore is just an ordinary restore.
  handlers.pageshow({ persisted: true });
  equal("⭐ a restore of a document that never ended does nothing", String(navigated.length), "0");

  /**
   * ⚠️⚠️ THIS BLOCK USED TO ASSERT THE DEFECT. It ended a session, fired a restore, and
   * required the handler to navigate to `ENDED_PATH` — the bare path, with no
   * fragment. Step 5 puts the MODE and the census OUTCOME in that fragment precisely
   * because step 3 has cleared every store that could carry them, so a restore that
   * drops it lands a **Ghost** ending on the **Kept** page: *"you will need your eight
   * words to open it again"*, shown to somebody who has no words and nothing to
   * reopen. The guard and the code agreed with each other and both disagreed with
   * §7.8. ➡️ The destination a restore repeats is the destination the ending CHOSE.
   */
  const keys = { session: new Uint8Array([7, 7, 7, 7]) };
  let cleared = 0;
  await endings.endSession({
    client: null,
    keys,
    sessionStorage: null,
    clearStorage: async () => { cleared++; },
    navigate: (p) => navigated.push(p),
  });
  check("the document is marked ended", endings.hasEnded());
  equal("the ending itself navigated once", String(navigated.length), "1");
  const destination = navigated[0];

  handlers.pageshow({ persisted: false });
  equal("an ordinary load of the ended page does not re-navigate", String(navigated.length), "1");

  /**
   * ⭐⭐⭐ THE HEAP IS BACK, AND THAT IS THE WHOLE PREMISE. A restored document brings
   * its buffers with it on at least one mainstream Chromium build, so the bytes step 2
   * overwrote can be live again. Refilling the buffer here is what a restore looks
   * like from this module's side, and a defence that only re-navigates would leave it
   * full.
   */
  keys.session.fill(9);
  handlers.pageshow({ persisted: true });

  equal(
    "⭐⭐⭐ a BFCACHE restore leaves again, with no user action",
    String(navigated.length),
    "2"
  );
  equal(
    "⭐⭐⭐ and it repeats the destination the ENDING chose, fragment and all",
    navigated[1],
    destination
  );
  check(
    "⚠️ the destination carries §7.8.1's census outcome, which no store could have held",
    /#(un)?confirmed/.test(destination),
    destination
  );
  equal(
    "⭐⭐ and step 2 is repeated on the restored heap, not assumed to have stuck",
    keys.session.join(""),
    "0000"
  );
  // ⚠️ A TURN OF THE MICROTASK QUEUE FIRST, AND THAT IS THE DESIGN SPEAKING. The
  // repeat deliberately does not await the storage clear: a `pageshow` handler that
  // waits is a handler running while the restored document is already interactive,
  // and step 5 must not queue behind step 3. So the call is made and the answer is
  // not waited for — which is exactly what this line has to model.
  await Promise.resolve();
  await Promise.resolve();
  check("⚠️ and step 3 is repeated too", cleared >= 2, `clearStorage ran ${cleared}×`);
}

{
  /**
   * ⭐⭐ THE TWO VARIANTS THE OLD HANDLER ERASED, TESTED AS THEMSELVES. `?clear=1` is
   * §7.8 step 5's Clear-Site-Data variant and `-ghost` is 0.8.14's mode — a restore
   * that dropped either one landed the person on a page making a promise about their
   * session that was false for it.
   */
  const handlers = {};
  const navigated = [];
  const target = { addEventListener: (type, fn) => (handlers[type] = fn) };
  endings.armBfcacheDefence({ target, navigate: (p) => navigated.push(p) });

  await endings.endSession({
    client: null,
    keys: {},
    sessionStorage: null,
    navigate: (p) => navigated.push(p),
    thorough: true,
    mode: "ghost",
  });
  const destination = navigated[0];
  check("⚠️ a thorough Ghost ending goes to the clearing variant, marked ghost", 
    destination.includes("clear=1") && destination.includes("-ghost"), destination);

  handlers.pageshow({ persisted: true });
  equal("⭐⭐⭐ and a restore of it goes to exactly the same place", navigated[1], destination);
  check(
    "⚠️ which is NOT the bare path the handler used to guess",
    navigated[1] !== endings.ENDED_PATH,
    navigated[1]
  );
}

// ============================================================ §7.8's ordering

section("§7.8 — the order, which is the part that was wrong");

{
  const trace = [];
  const client = {
    announceEnd: () => trace.push("announce"),
    confirmEnded: async () => {
      trace.push("confirm");
      return { confirmed: true, remaining: 0, reason: null };
    },
  };

  const outcome = await endings.endSession({
    client,
    keys: { localKey: new Uint8Array(32).fill(7) },
    stopDelivery: async () => trace.push("stop"),
    clearStorage: async () => trace.push("clear"),
    sessionStorage: { clear: () => trace.push("sessionStorage") },
    navigate: (path) => trace.push(`navigate:${path}`),
  });

  equal(
    "⭐⭐⭐ delivery stops BEFORE the store is cleared, and the wait comes after it",
    trace.join(" → "),
    `stop → announce → sessionStorage → clear → confirm → navigate:${endings.ENDED_PATH}#confirmed`
  );

  // ⚠️ THE TWO ASSERTIONS THAT MATTER, STATED SEPARATELY so that a future reorder
  // fails with the reason attached rather than as one long string mismatch.
  check("⭐⭐ nothing that writes is still running when the clear happens", trace.indexOf("stop") < trace.indexOf("clear"));
  check("⭐⭐ and the other tabs were told before it too", trace.indexOf("announce") < trace.indexOf("clear"));
  check(
    "⭐ while the WAIT — the slow part — is after it, which is what §7.8 conflated",
    trace.indexOf("clear") < trace.indexOf("confirm")
  );
  check("§7.6: sessionStorage goes first of the stores", trace.indexOf("sessionStorage") < trace.indexOf("clear"));
  check("and the navigation is last", trace[trace.length - 1].startsWith("navigate"));
  check("the outcome comes back for the caller to word the claim from", outcome.confirmed === true);
  equal("with the number of buffers actually overwritten", String(outcome.wiped), "1");
}

{
  // §7.8 step 5's variant is a different destination, because the header that
  // makes it thorough can only be set by the server.
  const trace = [];
  await endings.endSession({
    client: { announceEnd: () => {}, confirmEnded: async () => ({ confirmed: false, remaining: 1, reason: tabs.TIMED_OUT }) },
    keys: {},
    clearStorage: async () => trace.push("clear"),
    sessionStorage: null,
    navigate: (path) => trace.push(path),
    thorough: true,
  });
  // ⚠️ And the fragment says what the census found — "unconfirmed" here, because
  // this block's client reports a tab that would not go away. §7.8.1: the strong
  // wording is licensed by the measurement, not by the button.
  equal(
    "⭐ the thorough ending lands on the page that carries Clear-Site-Data",
    trace[1],
    `${endings.ENDED_PATH_THOROUGH}#unconfirmed`
  );
  check("and the ordinary one does not", endings.ENDED_PATH !== endings.ENDED_PATH_THOROUGH);
}

{
  // ⚠️⚠️ THE MODE TRAVELS IN THE FRAGMENT TOO, AND 0.8.14 IS WHY. The ending page's
  // second sentence is `ending.needsPhrase` — *"you will need your eight words to
  // open it again"* — which is Kept mode's reassurance and is **false** of a Ghost
  // session: there are no words and there is nothing to reopen. The fragment carried
  // the census outcome and nothing else, so the shared page printed the Kept sentence
  // after every ending. Same shape as D-073 one layer out: a sentence written once
  // for a design that has two modes.
  const confirming = () => ({
    announceEnd: () => {},
    confirmEnded: async () => ({ confirmed: true, remaining: 0, reason: null }),
  });

  const ghost = [];
  await endings.endSession({
    client: confirming(),
    keys: {},
    clearStorage: async () => {},
    sessionStorage: null,
    navigate: (path) => ghost.push(path),
    mode: "ghost",
  });
  equal(
    "⭐⭐ a Ghost ending says so in the fragment, so the page can pick the true sentence",
    ghost[0],
    `${endings.ENDED_PATH}#confirmed-ghost`
  );

  const kept = [];
  await endings.endSession({
    client: confirming(),
    keys: {},
    clearStorage: async () => {},
    sessionStorage: null,
    navigate: (path) => kept.push(path),
  });
  equal("and a Kept ending is unchanged, which is what keeps the page's default right", kept[0], `${endings.ENDED_PATH}#confirmed`);

  // The page splits the fragment on "-", so neither token may contain one.
  check("neither token carries the separator the page parses on", !/-/.test("confirmed") && !/-/.test("unconfirmed"));
}

{
  // A client that cannot be told is not a reason to skip the local work.
  const trace = [];
  const outcome = await endings.endSession({
    client: null,
    keys: {},
    stopDelivery: async () => trace.push("stop"),
    clearStorage: async () => trace.push("clear"),
    sessionStorage: null,
    navigate: () => trace.push("navigate"),
  });
  equal("with no tab client the ending still runs", trace.join(","), "stop,clear,navigate");
  check("⚠️ and reports that it confirmed nothing", !outcome.confirmed && outcome.reason === tabs.NO_CHANNEL);
}

{
  // ⚠️ A browser that refuses `sessionStorage` (some private modes throw on
  // access) must not be able to stop an ending half-way through.
  const trace = [];
  await endings.endSession({
    client: null,
    keys: {},
    clearStorage: async () => trace.push("clear"),
    sessionStorage: {
      clear() {
        throw new Error("SecurityError");
      },
    },
    navigate: () => trace.push("navigate"),
  });
  equal("⭐ a sessionStorage that throws does not abort the ending", trace.join(","), "clear,navigate");
}

// ================================================== §7.7's one exception

// ============================ §7.8 step 1, in the file that actually calls it

/*
  ⚠️⚠️ EVERYTHING ELSE IN THIS FILE TESTS `flow/ending.js`, AND THE 2026-08-24 DEFECT
  WAS NOT IN `flow/ending.js`. §7.8 step 1 is `stopDelivery()`, and the client's
  implementation of it lived in `app/app.js` — which no suite here can import,
  because it touches the document from its first line. So the order was proved,
  correctly, over a `stopDelivery` that in production returned before it had stopped
  anything.

  ⭐ `stopEverything()` WAS `async`, EVERY CALLER AWAITED IT, AND ITS OWN HEADER SAID
  *"it has to be awaitable, because step 3 clears the database these streams write
  into"*. Inside, it called `live.stop()` without `await`, against a `stop()` that
  only called `abort()`. Four things agreeing that the wait mattered, and no wait.
  ➡️ **A CHECK THAT ASKS WHETHER SOMETHING IS `async` CANNOT TELL YOU WHETHER IT
  AWAITS ANYTHING.**

  So this is a SOURCE rule, and it is written as the rule rather than as the bug: a
  `stop()` whose result is dropped must be dropped ON PURPOSE, spelled `void`. Then
  every site is a decision somebody made, and a bare call is the one shape that
  cannot happen by accident. `syncStreams` is the site that legitimately does not
  wait, and it says so.
*/
section("§7.8 step 1 — every `live.stop()` in `app/app.js` is a decision");

{
  const src = readFileSync(fileURLToPath(new URL("../app/app.js", import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  // ⚠️ THE UNIT IS THE LINE, and that is the rule rather than a convenience for the
  // regex: the decision about waiting has to be READABLE BESIDE THE CALL. One site
  // hands its promise to `Promise.all` on the same line, which is a decision a
  // reader can see; a bare call on a line with neither word is the one shape that
  // means nobody chose.
  const lines = src.split("\n").filter((l) => /\.live\.stop\(\)/.test(l));
  check("there are stop sites to check at all", lines.length >= 3, `${lines.length} sites`);

  const undecided = lines.filter((l) => !/\b(await|void)\b/.test(l));
  equal("⭐⭐ none of them drops the promise silently", String(undecided.length), "0",
    undecided.join(" | "));

  // ⚠️ AND BOTH ANSWERS MUST STILL BE IN USE. A rule satisfied by making every site
  // `void` would pass the line above and reintroduce the defect everywhere — that is
  // D-161's lesson, that widening a guard on some axes moves the hole rather than
  // closing it. So the guard asserts the mixture, not just the absence.
  check("⭐ at least one site waits", lines.some((l) => /\bawait\b/.test(l)));
  check("⭐ and at least one deliberately does not", lines.some((l) => /\bvoid\b/.test(l)));
}

section("§7.7 — the overwrite, and exactly what it reaches");

{
  const localKey = new Uint8Array(32).fill(0xaa);
  const pickleKey = new Uint8Array(32).fill(0xbb);
  const seed = new Uint8Array(32).fill(0xcc);
  const keys = {
    rosterId: new Uint8Array(16).fill(0xdd),
    localKey,
    pickleKey,
    rosterAuth: { privateKey: seed, publicKey: new Uint8Array(32).fill(0xee) },
  };

  const wiped = endings.overwriteKeys(keys);
  equal("every byte buffer is overwritten", String(wiped), "5");
  check("the local key is zeroed in place", localKey.every((b) => b === 0));
  check("and the pickle key", pickleKey.every((b) => b === 0));

  // ⚠️⚠️ THE NESTED ONE IS THE POINT. §7.7's table says `roster_auth` is NOT a
  // non-extractable CryptoKey — WebCrypto offers no route from HKDF output to an
  // Ed25519 key without the seed existing as raw bytes — so the one signing key
  // this client holds lives one level down, where a top-level sweep misses it.
  check("⭐⭐ and the Ed25519 SEED, which is nested one level down", seed.every((b) => b === 0), "roster_auth.privateKey");
}

{
  // ⚠️ It reaches `Uint8Array` and nothing else, and §7.7 says so: a
  // non-extractable CryptoKey cannot be zeroed by any means a page has.
  const notBytes = { note: "a string", n: 42, flag: true };
  equal("⚠️ strings and numbers are not reached, and §7.7 forbids pretending", String(endings.overwriteKeys(notBytes)), "0");
  equal("nor is a missing key set", String(endings.overwriteKeys(null)), "0");
}

// ===================================================== §4.3 the idle lock

section("§4.3 — when a session locks, and why the reason is shown");

{
  const t0 = 1_000_000;
  equal(
    "nothing happens before either threshold",
    String(lock.dueToLock({ lastActivity: t0, hiddenSince: null, now: t0 + 1000 })),
    "null"
  );
  equal(
    `${lock.IDLE_MS / 3600000} hours without use locks it`,
    lock.dueToLock({ lastActivity: t0, hiddenSince: null, now: t0 + lock.IDLE_MS }),
    lock.IDLE
  );
  equal(
    `and ${lock.BLUR_MS / 3600000} hours in the background locks it too`,
    lock.dueToLock({ lastActivity: t0, hiddenSince: t0, now: t0 + lock.BLUR_MS }),
    lock.BLURRED
  );
  // ⚠️ THE INVARIANT IS "NEVER THE LONGER", AND IT WAS WRITTEN AS "STRICTLY SHORTER"
  // UNTIL D-190 SET BOTH TO 24 HOURS. The reason attached to it — *or it would never
  // fire* — is only true of the `>` case: `dueToLock` tests blur FIRST, and a hidden tab
  // is by construction also an idle one, so at equality BLURRED still wins the tie and is
  // still returned. Longer is what makes it unreachable, because then the idle rule
  // always concludes first. ⭐ So this is the guard stating the property it always meant,
  // not a guard relaxed to admit a change: reachability itself is asserted directly by
  // the two cases above, which return IDLE and BLURRED at these very values.
  check("⚠️ the blur threshold is never the longer of the two, or it could never fire", lock.BLUR_MS <= lock.IDLE_MS);
  equal(
    "⭐ being in the background is not enough on its own",
    String(lock.dueToLock({ lastActivity: t0, hiddenSince: t0, now: t0 + lock.BLUR_MS - 1 })),
    "null"
  );
  equal(
    "and the reason distinguishes them, because they are different things to have happened",
    `${lock.IDLE}/${lock.BLURRED}`,
    "idle/blurred"
  );
}

/**
 * ⭐⭐ D-163's third reason, and the property that keeps it out of the pure function.
 *
 * `IDLE` and `BLURRED` are conclusions this module DRAWS from a clock. `MANUAL` is an
 * argument the interface PASSES IN, and the day `dueToLock` can return it is the day
 * somebody is told they asked for a lock they did not ask for. So it is asserted as an
 * absence — over the whole grid of inputs that produce a reason at all, rather than at
 * one point, because a single sample proves nothing about a function with two thresholds.
 */
{
  const t0 = 1_000_000;
  const grid = [];
  for (const hidden of [null, t0, t0 - 10 * 60_000])
    for (const dt of [0, 1000, lock.BLUR_MS, lock.BLUR_MS + 1, lock.IDLE_MS, lock.IDLE_MS * 3])
      grid.push(lock.dueToLock({ lastActivity: t0, hiddenSince: hidden, now: t0 + dt }));

  check("⚠️ the three reasons are three different values", new Set([lock.IDLE, lock.BLURRED, lock.MANUAL]).size === 3);
  equal(
    "⛔ `dueToLock` never returns MANUAL — a clock cannot conclude that a person asked",
    grid.filter((r) => r === lock.MANUAL).length,
    0,
    `${grid.length} clock states tried`
  );
  // ⚠️ THE CANARY. The grid above proves nothing if the grid never produces a reason at
  // all — an `undefined` in every slot would pass the check it is written to fail.
  check(
    "⚠️ and the grid does reach the reasons a clock CAN conclude, or it proves nothing",
    grid.includes(lock.IDLE) && grid.includes(lock.BLURRED),
    `${grid.filter(Boolean).length} of ${grid.length} states locked`
  );
}

{
  // ⭐⭐ THE PATH THAT MATTERS IS THE DEVICE BEING PICKED UP, and that is an EVENT.
  // A hidden tab's timers are throttled to about one a minute — exactly the state
  // the blur rule is about — so a design that waited for the tick would unlock the
  // conversation on screen and lock it up to a minute later.
  let visibility = "visible";
  const handlers = {};
  const locked = [];
  let clock = 5_000_000;
  const doc = {
    get visibilityState() {
      return visibility;
    },
    addEventListener: (type, fn) => (handlers[type] = fn),
    removeEventListener: () => {},
  };
  const watcher = lock.watchIdleness({
    onLock: (reason) => locked.push(reason),
    target: { addEventListener: () => {}, removeEventListener: () => {} },
    doc,
    now: () => clock,
    checkMs: 1e9, // the timer must not be what fires
  });

  visibility = "hidden";
  handlers.visibilitychange();
  clock += lock.BLUR_MS + 1;
  visibility = "visible";
  handlers.visibilitychange();

  equal("⭐⭐⭐ coming back after a long absence locks on the spot, not on the next tick", locked.join(","), lock.BLURRED);
  check("and the watcher stops itself, so it cannot lock a session twice", watcher.stopped);
}

{
  // Coming back quickly is not a lock, and it counts as activity.
  let visibility = "visible";
  const handlers = {};
  const locked = [];
  let clock = 9_000_000;
  const doc = {
    get visibilityState() {
      return visibility;
    },
    addEventListener: (type, fn) => (handlers[type] = fn),
    removeEventListener: () => {},
  };
  const watcher = lock.watchIdleness({
    onLock: (reason) => locked.push(reason),
    target: { addEventListener: () => {}, removeEventListener: () => {} },
    doc,
    now: () => clock,
    checkMs: 1e9,
  });

  visibility = "hidden";
  handlers.visibilitychange();
  clock += 5000;
  visibility = "visible";
  handlers.visibilitychange();
  equal("a short glance elsewhere is not a lock", locked.join(","), "");

  // ⭐ And returning counted as activity, so the idle clock restarted with it.
  clock += lock.IDLE_MS - 1;
  watcher.evaluate();
  equal("⭐ and returning restarted the idle clock rather than leaving it running", locked.join(","), "");
  clock += 2;
  watcher.evaluate();
  equal("which then expires on its own schedule", locked.join(","), lock.IDLE);
  watcher.stop();
}

// ================================== §4.3's SECOND TIER — the cover, and its ordering

section("§4.3 — two tiers, and the invariant between them");

// ⚠️⚠️ A TIER LONGER THAN THE TIER ABOVE IT IS A TIER THAT NEVER FIRES. §4.3 already
// records this shape once, for blur against idle — *"at longer it becomes unreachable,
// because the idle rule always concludes first"* — and adding a second pair of numbers
// makes it four ways to get wrong instead of one. These are the four.
check("the cover's idle window is never longer than the lock's", lock.COVER_IDLE_MS <= lock.IDLE_MS);
check("the cover's blur window is never longer than the lock's", lock.COVER_BLUR_MS <= lock.BLUR_MS);
check("blur is never the longer of the two inside the cover tier", lock.COVER_BLUR_MS <= lock.COVER_IDLE_MS);
check("⚠️ and the cover actually fires first, or the second tier is decoration", lock.COVER_BLUR_MS < lock.BLUR_MS);

{
  const t0 = 4_000_000;
  const away = { lastActivity: t0, hiddenSince: t0, now: t0 + lock.COVER_BLUR_MS };
  equal("the short window covers", lock.dueToCover(away), lock.BLURRED);
  equal("⭐ and the same moment does not lock — that is the whole feature", String(lock.dueToLock(away)), "null");
}

{
  // ⭐⭐ THE SESSION THAT SAT BEHIND ITS COVER ALL DAY STILL LOCKS. Covering tears
  // nothing down, so a watcher that stopped itself at the short window would leave the
  // derived keys in memory for as long as the tab lived, behind a gate that costs six
  // digits. That is the failure this whole tier could most easily have introduced.
  const covered = [];
  const locked = [];
  let clock = 7_000_000;
  const watcher = lock.watchIdleness({
    onCover: (reason) => covered.push(reason),
    onLock: (reason) => locked.push(reason),
    target: { addEventListener: () => {}, removeEventListener: () => {} },
    doc: { visibilityState: "visible", addEventListener: () => {}, removeEventListener: () => {} },
    now: () => clock,
    checkMs: 1e9,
  });

  clock += lock.COVER_IDLE_MS;
  watcher.evaluate();
  equal("the short window covers it", covered.join(","), lock.IDLE);
  check("and the watcher is still running", !watcher.stopped);

  // ⚠️ TAPPING AT A COVERED SCREEN IS NOT USE, and this is a hole rather than a nicety:
  // without it, somebody trying PINs on a phone they picked up would hold off the one
  // gate that drops the keys.
  clock += lock.IDLE_MS - lock.COVER_IDLE_MS - 1000;
  watcher.touch();
  watcher.evaluate();
  equal("a covered screen that is being tapped does not restart the lock clock", locked.join(","), "");

  clock += 2000;
  watcher.evaluate();
  equal("⭐ so the long window still arrives", locked.join(","), lock.IDLE);
  check("and NOW the watcher stops", watcher.stopped);
  equal("and it covered exactly once on the way", String(covered.length), "1");
}

{
  // The right PIN arrived: both clocks start again from that moment.
  const covered = [];
  const locked = [];
  let clock = 11_000_000;
  const watcher = lock.watchIdleness({
    onCover: (reason) => covered.push(reason),
    onLock: (reason) => locked.push(reason),
    target: { addEventListener: () => {}, removeEventListener: () => {} },
    doc: { visibilityState: "visible", addEventListener: () => {}, removeEventListener: () => {} },
    now: () => clock,
    checkMs: 1e9,
  });

  clock += lock.COVER_IDLE_MS;
  watcher.evaluate();
  check("covered", watcher.covered);

  watcher.uncovered();
  check("lifting the cover clears the flag", !watcher.covered);

  clock += lock.COVER_IDLE_MS - 1;
  watcher.evaluate();
  equal("and the short clock restarted with it", String(covered.length), "1");
  clock += 2;
  watcher.evaluate();
  equal("⭐ then covers again on its own schedule", String(covered.length), "2");
  watcher.stop();
}

{
  // ⭐ COMING BACK IS STILL THE EVENT THAT MATTERS, and now it has two answers.
  let visibility = "visible";
  const handlers = {};
  const covered = [];
  const locked = [];
  let clock = 13_000_000;
  const doc = {
    get visibilityState() {
      return visibility;
    },
    addEventListener: (type, fn) => (handlers[type] = fn),
    removeEventListener: () => {},
  };
  const watcher = lock.watchIdleness({
    onCover: (reason) => covered.push(reason),
    onLock: (reason) => locked.push(reason),
    target: { addEventListener: () => {}, removeEventListener: () => {} },
    doc,
    now: () => clock,
    checkMs: 1e9,
  });

  visibility = "hidden";
  handlers.visibilitychange();
  clock += lock.COVER_BLUR_MS + 1;
  visibility = "visible";
  handlers.visibilitychange();
  equal("an absence past the short window covers on return", covered.join(","), lock.BLURRED);
  equal("and does not lock", locked.join(","), "");
  check("and the watcher is still running", !watcher.stopped);

  // ⚠️ AND A LONG ABSENCE TAKES THE STRONGER ANSWER, not both. The long tier is asked
  // first for exactly this: a session owed a lock must not be handed a cover instead.
  watcher.uncovered();
  visibility = "hidden";
  handlers.visibilitychange();
  clock += lock.BLUR_MS + 1;
  visibility = "visible";
  handlers.visibilitychange();
  equal("⭐⭐ an absence past the long window locks and does not cover", locked.join(","), lock.BLURRED);
  equal("the cover was not raised on the way past", String(covered.length), "1");
}

{
  // ⚠️⚠️ AND WITHOUT `onLock` THERE IS NO LONG TIER AT ALL — which is §7.6's Ghost mode,
  // where dropping the derived set is not a lock but a silent ending on a timer (D-073).
  // ⭐ THE PROPERTY THAT MATTERS HERE IS THAT IT NEVER STOPS. A watcher that stopped at
  // the long window would cover a Ghost conversation once and then never again for the
  // life of the tab, and nothing on the screen would say so.
  const covered = [];
  let clock = 19_000_000;
  const watcher = lock.watchIdleness({
    onCover: (reason) => covered.push(reason),
    target: { addEventListener: () => {}, removeEventListener: () => {} },
    doc: { visibilityState: "visible", addEventListener: () => {}, removeEventListener: () => {} },
    now: () => clock,
    checkMs: 1e9,
  });

  clock += lock.COVER_IDLE_MS;
  watcher.evaluate();
  clock += lock.IDLE_MS * 3;
  watcher.evaluate();
  check("⭐⭐ a cover-only watcher never stops, however long the session sits", !watcher.stopped);
  equal("and it covered once rather than locking", String(covered.length), "1");

  watcher.uncovered();
  clock += lock.COVER_IDLE_MS;
  watcher.evaluate();
  equal("⭐ and it can still cover again afterwards", String(covered.length), "2");
  watcher.stop();
}

{
  // ⚠️ WITHOUT `onCover` THE SHORT TIER IS INERT, which is for the tests above this one
  // and for nothing else — `app.js` always passes both. A caller exercising the long
  // window alone should not have to sit through the short one first.
  const locked = [];
  let clock = 17_000_000;
  const watcher = lock.watchIdleness({
    onLock: (reason) => locked.push(reason),
    target: { addEventListener: () => {}, removeEventListener: () => {} },
    doc: { visibilityState: "visible", addEventListener: () => {}, removeEventListener: () => {} },
    now: () => clock,
    checkMs: 1e9,
  });
  clock += lock.COVER_IDLE_MS + 1;
  watcher.evaluate();
  check("no cover callback, no covering", !watcher.covered);
  clock += lock.IDLE_MS;
  watcher.evaluate();
  equal("and the long window is untouched by any of it", locked.join(","), lock.IDLE);
}

// ================================== §7.8 step 2a, the plan and the key it needs

section("§7.8 step 2a — the plan is built before the key that builds it is destroyed");

{
  /* ⛔⛔ THE ONLY CHECK IN THIS FILE THAT ASSERTS AN END STATE, AND IT IS HERE
   * BECAUSE THIS FILE'S OWN HEADER IS HALF THE STORY. Recording the sequence
   * proves the steps happen in §7.8's order. It cannot prove that a step still
   * HAS what it needs when its turn arrives — and that is exactly what went
   * wrong (D-162): the order was right, every recorded step fired in its place,
   * and the ordinary ending deleted nothing. Step 3 selects this identity's rows
   * by opening them; step 2 had already filled `local_key` with zeros. No
   * sequence assertion can see that. Only the rows can.
   *
   * ⚠️ The wiring below is `app/app.js`'s wiring, deliberately: `prepareStorage`
   * is the vault's plan and `clearStorage` executes it. A test that inlined the
   * deletion instead would pass while the application still handed step 3 a dead
   * key.
   */
  const keys = { localKey: randomBytes(32) };
  const handle = db.memoryDatabase();
  const v = vault.openVault({ db: handle, localKey: keys.localKey });
  await v.conversation.set("roster", { generation: 1 });
  await v.conversation.set("channel:abc", { name: "a friend" });

  let result = null;
  await endings.endSession({
    client: null,
    keys,
    mode: "kept",
    sessionStorage: { clear() {} },
    navigate: () => {},
    prepareStorage: () => v.planEnding(),
    clearStorage: async (prepared) => {
      result = await v.endSession(prepared);
    },
  });

  equal(
    "⛔⛔ the ordinary ending REMOVES this identity's records, and not merely reports that it did",
    (await handle.list("conversation", undefined)).length,
    0
  );
  equal("⭐ and the count is the rows it found, not an empty plan read as success", result.deleted, 2);
  equal("⚠️ nothing of another identity's was counted as left behind", result.left, 0);
  check(
    "⚠️⚠️ and §7.7's overwrite still happened — the repair is not bought by keeping the key alive",
    keys.localKey.every((b) => b === 0),
    "local_key is all zero once the ending returns"
  );
}

done();
