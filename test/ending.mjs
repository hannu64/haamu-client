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

  await endings.endSession({ client: null, keys: {}, sessionStorage: null, navigate: () => {} });
  check("the document is marked ended", endings.hasEnded());

  handlers.pageshow({ persisted: false });
  equal("an ordinary load of the ended page does not re-navigate", String(navigated.length), "0");

  handlers.pageshow({ persisted: true });
  equal(
    "⭐⭐⭐ but a BFCACHE restore of an ended document leaves again, with no user action",
    navigated.join(","),
    endings.ENDED_PATH
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
    `${lock.IDLE_MS / 60000} minutes without use locks it`,
    lock.dueToLock({ lastActivity: t0, hiddenSince: null, now: t0 + lock.IDLE_MS }),
    lock.IDLE
  );
  equal(
    `and ${lock.BLUR_MS / 1000} seconds in the background locks it sooner`,
    lock.dueToLock({ lastActivity: t0, hiddenSince: t0, now: t0 + lock.BLUR_MS }),
    lock.BLURRED
  );
  check("⚠️ the blur threshold is the shorter of the two, or it would never fire", lock.BLUR_MS < lock.IDLE_MS);
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

done();
