// More than one tab — ARCHITECTURE.md §4.2 and PROTOCOL.md §7.8 step 3.
//
// No browser. Web Locks and BroadcastChannel are modelled here, which is honest
// about what this suite can and cannot show: it checks the POLICY built on those
// APIs — who leads, who is counted, what an ending may claim — and it cannot check
// that Chrome's lock manager behaves like the model. That second question is one
// browser-only assertion (`test/browser-tabs.mjs`), and it is a much smaller
// question than the one answered here.
//
// ⚠️ The model is deliberately strict where the real API is: an exclusive lock
// blocks everything on that name, a shared lock blocks only exclusives, a grant is
// held until the callback's promise settles, and a released lock is granted to
// whoever was waiting. Anything looser would let a test pass that a browser fails.

import * as tabs from "../src/flow/tabs.js";
import { randomBytes } from "../src/crypto/random.js";
import { b64uEncode } from "../src/crypto/b64u.js";
import { check, equal, section, done } from "./harness.mjs";

// =========================================================== the browser, modelled

function lockManager() {
  const held = [];
  const waiting = [];

  const conflicts = (req) =>
    req.mode === "shared"
      ? held.some((h) => h.name === req.name && h.mode === "exclusive")
      : held.some((h) => h.name === req.name);

  function pump() {
    for (let i = 0; i < waiting.length; ) {
      if (conflicts(waiting[i])) i++;
      else grant(waiting.splice(i, 1)[0]);
    }
  }

  function grant(req) {
    const record = { name: req.name, mode: req.mode, clientId: req.clientId, req };
    held.push(record);
    Promise.resolve()
      .then(req.cb)
      .then(req.settle, req.fail)
      .finally(() => {
        const at = held.indexOf(record);
        if (at !== -1) held.splice(at, 1); // a stolen record is already gone
        pump();
      });
  }

  /**
   * `steal: true` — modelled from 2026-08-17, because ARCHITECTURE §4.2.1 depends on it.
   *
   * ⚠️⚠️ THE MODEL IGNORED THIS OPTION UNTIL NOW, WHICH WOULD HAVE MADE EVERY TEST OF THE
   * NEW RULE MEANINGLESS. An unknown option fell through to a plain request, and a plain
   * request QUEUES — which is precisely the behaviour D-126 exists to replace. The tests
   * below would all have passed while exercising the defect.
   *
   * The spec's order is the part worth being careful about: every current holder of that
   * name is released first **and its `request()` promise rejects**, then the stealing
   * request is granted ahead of anything already waiting. That rejection is the only
   * notification a displaced document gets, and `flow/tabs.js` is built on receiving it.
   */
  function steal(req) {
    for (const record of held.filter((h) => h.name === req.name)) {
      held.splice(held.indexOf(record), 1);
      record.req.fail(Object.assign(new Error("lock stolen"), { name: "AbortError" }));
    }
    grant(req);
  }

  return {
    /** One document's view of the manager. `clientId` is the browser's, not ours. */
    forClient(clientId) {
      return {
        request(name, options, callback) {
          const cb = typeof options === "function" ? options : callback;
          const mode = typeof options === "function" ? "exclusive" : (options?.mode ?? "exclusive");
          const stealing = typeof options === "object" && options?.steal === true;
          return new Promise((settle, fail) => {
            const req = { name, mode, clientId, cb, settle, fail };
            if (stealing) steal(req);
            else if (conflicts(req)) waiting.push(req);
            else grant(req);
          });
        },
        async query() {
          return {
            held: held.map((h) => ({ ...h })),
            pending: waiting.map((w) => ({ name: w.name, mode: w.mode, clientId: w.clientId })),
          };
        },
      };
    },
    get names() {
      return held.map((h) => h.name);
    },
  };
}

function broadcastBus() {
  const byName = new Map();
  return (name) => {
    const port = { name, onmessage: null, closed: false };
    const peers = byName.get(name) ?? [];
    peers.push(port);
    byName.set(name, peers);
    port.postMessage = (data) => {
      // Real BroadcastChannel never delivers to the object that posted.
      for (const p of byName.get(name) ?? []) {
        if (p !== port && !p.closed) queueMicrotask(() => p.onmessage?.({ data }));
      }
    };
    port.close = () => {
      port.closed = true;
      byName.set(name, (byName.get(name) ?? []).filter((p) => p !== port));
    };
    return port;
  };
}

const settle = () => new Promise((r) => setTimeout(r, 5));

// ==================================================================== the scope

section("the scope — per identity, and never the identifier itself");

{
  const rosterId = randomBytes(32);
  const scope = await tabs.scopeFor(rosterId);
  equal("it is deterministic", scope, await tabs.scopeFor(rosterId));
  check("a different identity gets a different scope", scope !== (await tabs.scopeFor(randomBytes(32))));

  // ⚠️ Lock names are ENUMERABLE — `navigator.locks.query()` returns every name
  // held on the origin, to any script running on it. `roster_id` is the value §7.2
  // identifies as confirming a passphrase guess with one HKDF, so it may not be
  // one of them. A commitment to it does the same job.
  check(
    "⭐ and the identifier does not appear in any name built from it",
    ![tabs.censusName(scope), tabs.writerName(scope), tabs.channelName(scope, "x")].some((n) =>
      n.includes(b64uEncode(rosterId))
    ),
    tabs.writerName(scope)
  );
}

// ================================================================== the election

section("§4.2 — one leader per identity, and the next one when it goes");

{
  const locks = lockManager();
  const broadcast = broadcastBus();
  const scope = "s1";
  const led = [];
  const open = (id) =>
    tabs.openTabs({ scope, locks: locks.forClient(id), broadcast, onLeader: () => led.push(id) });

  const a = open("a");
  const b = open("b");
  const c = open("c");
  await settle();

  equal("⭐ exactly one tab leads", String(led.length), "1");
  equal("and it is the first one that asked", led[0], "a");
  check("the others know they do not", !b.isLeader && !c.isLeader);

  a.close();
  await settle();
  equal("⭐⭐ when the leader goes, the next one is promoted with no election message", led.join(","), "a,b");
  check("and it knows it", b.isLeader);

  b.close();
  c.close();
  await settle();
}

// ================================================ §4.2.1 — leadership follows the front tab

section("§4.2.1 — a frozen leader keeps its lock, so the visible tab takes it (D-126)");

/**
 * A document whose visibility this suite drives.
 *
 * ⭐ THIS IS THE WHOLE REASON `doc` IS INJECTED. The defect being guarded here is a
 * property of a tab that has STOPPED RUNNING while still holding a lock, and there is no
 * way to arrange that from inside the thing that stopped. A fake document lets the test
 * say "this one is in front now" without a browser — and `scratchpad/browser-frozen-leader.mjs`
 * does the other half, freezing a real tab with `Page.setWebLifecycleState` and measuring
 * whether a message arrives.
 */
function fakeDoc(visibilityState = "visible") {
  const listeners = [];
  return {
    visibilityState,
    addEventListener: (type, fn) => type === "visibilitychange" && listeners.push(fn),
    removeEventListener: (type, fn) => {
      const at = listeners.indexOf(fn);
      if (type === "visibilitychange" && at !== -1) listeners.splice(at, 1);
    },
    /** Bring this tab to the front, as a person switching to it does. */
    show() {
      this.visibilityState = "visible";
      for (const fn of [...listeners]) fn();
    },
    hide() {
      this.visibilityState = "hidden";
      for (const fn of [...listeners]) fn();
    },
  };
}

{
  const locks = lockManager();
  const broadcast = broadcastBus();
  const scope = "vis1";
  const events = [];
  const docA = fakeDoc("visible");
  const docB = fakeDoc("hidden");

  const a = tabs.openTabs({
    scope, locks: locks.forClient("a"), broadcast, doc: docA,
    onLeader: (is) => events.push(`a:${is}`),
  });
  const b = tabs.openTabs({
    scope, locks: locks.forClient("b"), broadcast, doc: docB,
    onLeader: (is) => events.push(`b:${is}`),
  });
  await settle();

  equal("the visible tab leads and the hidden one waits", events.join(","), "a:true");
  check("and the hidden tab knows it is not leading", !b.isLeader);

  // ⚠️⚠️ THE CASE HANNU HIT. Tab `a` is still holding the lock and is no longer running —
  // a frozen document releases nothing — so `b` must TAKE it rather than wait for it. In
  // the model that is indistinguishable from `a` being alive and hidden, which is the
  // point: `b` cannot tell, and must not have to.
  docB.show();
  await settle();

  check("⭐⭐⭐ the tab brought to the front takes leadership from a tab that cannot release it", b.isLeader);
  check("⚠️⚠️ and the displaced tab is TOLD, which is how it stops delivering", events.includes("a:false"), events.join(","));
  equal("the order is take-then-lose, not lose-then-take", events.join(","), "a:true,b:true,a:false");
  equal("exactly one tab holds the leader lock afterwards",
    String(locks.names.filter((n) => n === tabs.writerName(scope)).length), "1");

  // ⚠️ RULE 2, AND IT IS THE ASYMMETRY THAT IS EASY TO GET WRONG. Hiding must NOT stand a
  // tab down: one tab, backgrounded, still running, is the only thing delivering — and this
  // election has always been right about that case. Only a visible CLAIMANT may move it.
  const before = events.length;
  docB.hide();
  await settle();
  check("⚠️⚠️ a tab going to the background keeps leadership — nothing else is running to take it",
    b.isLeader && events.length === before, events.slice(before).join(",") || "no change");

  a.close();
  b.close();
  await settle();
}

{
  // A visible tab that is already leading must not churn: `visibilitychange` fires on more
  // than the transition that matters, and a steal per event would be a lock operation per
  // notification for no benefit.
  const locks = lockManager();
  const broadcast = broadcastBus();
  const doc = fakeDoc("visible");
  const events = [];
  const t = tabs.openTabs({
    scope: "vis2", locks: locks.forClient("solo"), broadcast, doc,
    onLeader: (is) => events.push(`t:${is}`),
  });
  await settle();
  doc.show();
  doc.show();
  await settle();
  equal("the leader does not re-take a lock it already holds", events.join(","), "t:true");
  t.close();
  await settle();
}

{
  // ⚠️⚠️ THE FALLBACK §4.2 HAS ALWAYS DOCUMENTED AND NOBODY HAD IMPLEMENTED: with no lock
  // API, `leader` could never become true, so NO tab delivered anything at all. Latent —
  // Web Locks is everywhere current — but the failure was total rather than degraded.
  const broadcast = broadcastBus();
  const events = [];
  const doc = fakeDoc("visible");
  const a = tabs.openTabs({ scope: "nolocks", locks: null, broadcast, doc, onLeader: (is) => events.push(`a:${is}`) });
  const b = tabs.openTabs({ scope: "nolocks", locks: null, broadcast, doc: fakeDoc("hidden"), onLeader: (is) => events.push(`b:${is}`) });
  await settle();
  check("⚠️⚠️ with no lock API every tab leads — §4.2's 'accept the duplication', not 'deliver nothing'",
    a.isLeader && b.isLeader, events.join(","));
  a.close();
  b.close();
}

{
  // ⚠️ Two identities in one browser are two of everything. A single origin-wide
  // leader would elect one of them and leave the other's conversations with
  // nothing watching them — and `vault.js` already expects two identities to share
  // a database, so this is a real arrangement rather than a hypothetical.
  const locks = lockManager();
  const broadcast = broadcastBus();
  const led = [];
  const x = tabs.openTabs({ scope: "identity-x", locks: locks.forClient("x"), broadcast, onLeader: () => led.push("x") });
  const y = tabs.openTabs({ scope: "identity-y", locks: locks.forClient("y"), broadcast, onLeader: () => led.push("y") });
  await settle();
  equal("⭐ two identities in one browser lead independently", led.sort().join(","), "x,y");
  x.close();
  y.close();
}

// ==================================================================== the census

section("§7.8 step 3 — who is still here, which is what makes the wait terminate");

{
  const locks = lockManager();
  const broadcast = broadcastBus();
  const scope = "s2";
  const open = (id) => tabs.openTabs({ scope, locks: locks.forClient(id), broadcast });

  const a = open("a");
  const b = open("b");
  const c = open("c");
  await settle();

  equal("three tabs, three holders", String(await a.census()), "3");
  c.close();
  await settle();
  equal("⭐ a tab that closes stops being counted, without saying anything", String(await a.census()), "2");
  b.close();
  await settle();
  equal("down to this one", String(await a.census()), "1");
  a.close();
}

section("§7.8 step 3 — the ending, and what it may claim");

{
  const locks = lockManager();
  const broadcast = broadcastBus();
  const scope = "s3";
  const clients = [];
  const open = (id, obey = true) => {
    const t = tabs.openTabs({
      scope,
      locks: locks.forClient(id),
      broadcast,
      onEnd: () => obey && t.close(),
    });
    clients.push(t);
    return t;
  };

  const a = open("a");
  open("b");
  open("c");
  await settle();

  a.announceEnd();
  const result = await a.confirmEnded();
  check("⭐⭐ the ending is CONFIRMED when the other tabs are gone", result.confirmed, JSON.stringify(result));
  equal("with nobody left", String(result.remaining), "0");
  a.close();
}

{
  // ⚠️⚠️ THE CASE THE CENSUS EXISTS FOR. This tab receives the end command and
  // does not go away — it hung, or its teardown threw. An acknowledgement protocol
  // would have been told "done" and believed it; the census counts what is
  // RUNNING, so the ending reports honestly that somebody is still there.
  const locks = lockManager();
  const broadcast = broadcastBus();
  const scope = "s4";
  let heard = 0;
  const a = tabs.openTabs({ scope, locks: locks.forClient("a"), broadcast });
  const stubborn = tabs.openTabs({
    scope,
    locks: locks.forClient("stubborn"),
    broadcast,
    onEnd: () => heard++,
  });
  await settle();

  a.announceEnd();
  const result = await a.confirmEnded({ deadlineMs: 60 });
  equal("the other tab did hear the command", String(heard), "1");
  check("⭐⭐ and the ending still refuses to say it is confirmed", !result.confirmed, JSON.stringify(result));
  equal("naming what is left", `${result.reason}/${result.remaining}`, `${tabs.TIMED_OUT}/1`);
  a.close();
  stubborn.close();
}

{
  // ⚠️⚠️ §4.2's own fallback permits a client this file cannot enumerate, and §7.8
  // step 3 requires every client to be awaited. On a browser with no Web Locks
  // those two cannot both hold, and the one that gives is the CLAIM — which is why
  // this returns a reason rather than a boolean, and why `ui/copy.js` carries two
  // sentences for the ending instead of one.
  const broadcast = broadcastBus();
  const a = tabs.openTabs({ scope: "s5", locks: null, broadcast });
  const b = tabs.openTabs({ scope: "s5", locks: null, broadcast, onEnd: () => b.close() });
  await settle();

  check("with no Web Locks there is no census", !a.capabilities.census);
  a.announceEnd();
  const result = await a.confirmEnded();
  check("⭐⭐ so the ending is NOT confirmed, however well it went", !result.confirmed, JSON.stringify(result));
  equal("and it says why", result.reason, tabs.NO_CENSUS);
  equal("⚠️ “how many are left” is unknown, which is not zero", String(result.remaining), "null");
  a.close();
}

{
  const locks = lockManager();
  const a = tabs.openTabs({ scope: "s6", locks: locks.forClient("a"), broadcast: null });
  a.announceEnd();
  const result = await a.confirmEnded();
  equal("⭐ with no channel at all the other tabs cannot even be told", result.reason, tabs.NO_CHANNEL);
  check("and that is reported, not skipped over", !result.confirmed);
  a.close();
}

// ================================================================== the notices

section("the notice channel — hints between tabs, never the record");

{
  const locks = lockManager();
  const broadcast = broadcastBus();
  const scope = "s7";
  const heardByB = [];
  const heardByA = [];
  const endsAtB = [];
  const a = tabs.openTabs({ scope, locks: locks.forClient("a"), broadcast, onNotice: (m) => heardByA.push(m.kind) });
  const b = tabs.openTabs({
    scope,
    locks: locks.forClient("b"),
    broadcast,
    onNotice: (m) => heardByB.push(m.kind),
    onEnd: () => endsAtB.push(1),
  });
  await settle();

  a.announce("messages", { channel: "abc" });
  await settle();
  equal("a notice reaches the other tab", heardByB.join(","), "messages");
  equal("⭐ and not the tab that sent it — it already knows", heardByA.join(","), "");

  a.announce("end");
  await settle();
  equal("⚠️ “end” is not an app notice — tabs.js owns it", heardByB.join(","), "messages");
  equal("and it arrives as the ending it is", String(endsAtB.length), "1");

  a.close();
  b.close();
}

// =========================================================== the critical section

section("§6 — one tab at a time inside a channel's critical section");

{
  const locks = lockManager();
  const broadcast = broadcastBus();
  const scope = "s8";
  const a = tabs.openTabs({ scope, locks: locks.forClient("a"), broadcast });
  const b = tabs.openTabs({ scope, locks: locks.forClient("b"), broadcast });

  // The shape of the thing being protected: read, pause, write back. Two of these
  // interleaved is the lost update that `storage/db.js` refuses and this avoids.
  let shared = 0;
  const trace = [];
  const readModifyWrite = (who) => async () => {
    trace.push(`${who}:in`);
    const seen = shared;
    await settle();
    shared = seen + 1;
    trace.push(`${who}:out`);
  };

  await Promise.all([a.withChannel("chan", readModifyWrite("a")), b.withChannel("chan", readModifyWrite("b"))]);
  equal("⭐ both updates landed", String(shared), "2");
  equal("because they did not overlap", trace.join(" "), "a:in a:out b:in b:out");

  // Two DIFFERENT channels have nothing to say to each other and must not wait.
  shared = 0;
  const order = [];
  await Promise.all([
    a.withChannel("one", async () => {
      order.push("one:in");
      await settle();
      order.push("one:out");
    }),
    b.withChannel("two", async () => {
      order.push("two:in");
      await settle();
      order.push("two:out");
    }),
  ]);
  equal("⭐ separate channels run at the same time", order.join(" "), "one:in two:in one:out two:out");

  a.close();
  b.close();
}

{
  // ⚠️ WITHOUT WEB LOCKS THE GUARD IS A STRAIGHT CALL, AND THAT IS CORRECT. What
  // makes concurrent writes safe is `storage/db.js`'s conditional write; this only
  // makes them rare. A client that refused to run without a lock would refuse to
  // run at all on a browser where nothing was ever going to conflict.
  const a = tabs.openTabs({ scope: "s9", locks: null, broadcast: null });
  equal("it still runs the work", String(await a.withChannel("chan", async () => 42)), "42");
  check("and says plainly that it is not guarding anything", !a.capabilities.locks);
  a.close();
}

// ============================================ §4.2.2 — one live client per identity

section("§4.2.2 — a second tab declines to be a second client (D-127)");

{
  // ⭐ THE QUESTION IS ABOUT THE WRITER LOCK, NOT ABOUT THE CENSUS, and these four
  // checks are what that distinction buys. A census counts documents; this counts the
  // one doing the work.
  const locks = lockManager();
  const scope = "d1";

  check(
    "with nobody delivering, a new tab is free to be the client",
    (await tabs.anotherClientIsLive(scope, { locks: locks.forClient("probe") })) === false
  );

  const live = tabs.openTabs({ scope, locks: locks.forClient("live"), broadcast: null, doc: fakeDoc("visible") });
  await settle();
  check(
    "⭐ once a tab is delivering, the next one to open can tell",
    (await tabs.anotherClientIsLive(scope, { locks: locks.forClient("probe") })) === true
  );

  // ⚠️ THIS ONE IS NOT DISCRIMINATING ON ITS OWN AND IS NAMED SO THAT IT DOES NOT CLAIM
  // TO BE. With a live tab present the answer is `true` whichever lock the question asks
  // about, so this only says that adding a dormant sibling does not disturb it. The check
  // BELOW is the one that separates the two readings, and it is where the weight sits —
  // a test whose name promises more than its arrangement can distinguish is how D-123
  // survived six passing decodes.
  const asleep = tabs.openTabs({
    scope, locks: locks.forClient("asleep"), broadcast: null, doc: fakeDoc("visible"), dormant: true,
  });
  await settle();
  check(
    "a dormant sibling opening alongside does not disturb the answer",
    (await tabs.anotherClientIsLive(scope, { locks: locks.forClient("probe") })) === true
  );

  // ⚠️⚠️ THE CHECK THAT STOPS THE RULE EATING ITSELF, and the only arrangement in which
  // "counts documents" and "counts the document doing the work" give different answers.
  // If dormancy were decided by the census, a second tab would go dormant, a third would
  // see TWO documents and go dormant too, and a browser could end up with several tabs
  // all deferring to each other while nothing delivered anything at all.
  live.close();
  await settle();
  check(
    "⚠️⚠️ with ONLY a dormant tab left, the next tab is free to be the client",
    (await tabs.anotherClientIsLive(scope, { locks: locks.forClient("probe") })) === false
  );
  asleep.close();
}

{
  // Rule 1: a tab that opened dormant takes no leadership however visible it is.
  const locks = lockManager();
  const events = [];
  const doc = fakeDoc("visible");
  const a = tabs.openTabs({
    scope: "d2", locks: locks.forClient("a"), broadcast: null, doc, dormant: true,
    onLeader: (is) => events.push(`a:${is}`),
  });
  await settle();
  check("a dormant tab does not lead, even though it is in front", events.length === 0);
  check("and it says so", a.isDormant === true);

  // ⚠️⚠️ THE SABOTAGE THIS GUARDS AGAINST IS §4.2.1 ITSELF. That rule steals leadership
  // whenever a tab becomes visible, and a dormant tab that answered `visibilitychange`
  // would take the lock away from the tab that is actually running — every single time
  // the person glanced at it. The two rules meet here, and this is where the meeting is
  // checked.
  doc.hide();
  doc.show();
  await settle();
  check("⚠️⚠️ and it does NOT steal leadership when the person looks at it", events.length === 0);

  // Rule 2: it leads when the person asks for it, and not before.
  a.wake();
  await settle();
  equal("⭐ `wake()` makes it the client", events.join(" "), "a:true");
  check("and it stops calling itself dormant", a.isDormant === false);
  a.close();
}

{
  // Rule 2, receiving end: the tab that WAS the client steps back.
  const locks = lockManager();
  const events = [];
  const a = tabs.openTabs({
    scope: "d3", locks: locks.forClient("a"), broadcast: null, doc: fakeDoc("visible"),
    onLeader: (is) => events.push(`a:${is}`),
  });
  await settle();
  equal("the live tab leads", events.join(" "), "a:true");

  a.standAside();
  await settle();
  equal("⭐ `standAside()` gives up leadership and reports it", events.join(" "), "a:true a:false");
  check("and it now calls itself dormant", a.isDormant === true);

  // ⚠️⚠️ DORMANCY IS NOT THE ENDING, AND THIS IS THE CHECK THAT STOPS IT BECOMING ONE.
  // §7.8's ending counts live documents through the shared census lock and waits for the
  // count to fall to one. A dormant document that dropped out of that count would let an
  // ending in another tab report "removed from every tab of this browser" while this one
  // still held an unlocked identity in memory.
  check("⚠️⚠️ a dormant document is STILL COUNTED by the census the ending waits on", (await a.census()) === 1);

  a.wake();
  await settle();
  equal("it can take the job back — dormancy is a stance, not a one-way door", events.join(" "), "a:true a:false a:true");
  a.close();
}

{
  // ⚠️ §4.2.2 rule 5. Where there is no lock API the question cannot be answered, and it
  // is answered in the direction that keeps the app WORKING rather than the direction
  // that sounds careful. A client that stood aside here would be a browser on which the
  // app delivers nothing at all — which is the exact latent defect D-126's fix turned up
  // one function above this one.
  check(
    "with no lock API at all, a tab is never told to stand aside",
    (await tabs.anotherClientIsLive("d4", { locks: null })) === false
  );
}

done();
