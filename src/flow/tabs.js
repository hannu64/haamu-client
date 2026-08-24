// More than one tab of this app, on one browser — ARCHITECTURE.md §4.2, and
// PROTOCOL.md §7.8 step 3, which is the part with a requirement in it.
//
// §4.2 asks for three things and they are not the same kind of thing:
//
//   • one SSE connection per browser rather than one per tab      — a resource
//   • no two tabs racing on IndexedDB                             — a correctness
//   • an ending in one tab that reaches every other AND IS AWAITED — a promise
//
// ⚠️⚠️ THE MIDDLE ONE IS NOT A TIDINESS PROBLEM AND §4.2 READS AS IF IT WERE
// (PROTOCOL 0.8.12). It sits in the same sentence as the duplicate connection, and
// the remedy offered — "the leader holds the SSE connection" — is a remedy for the
// FIRST one only. The operation that races is `send`, which is not the leader's:
// every tab has a composer, and the person types in whichever tab is in front of
// them. Two sends against one shared session record are a lost update, and the
// update lost is the record of a chain key having been used. What the second send
// then encrypts under is a spent message key. See `storage/sessions.js`.
//
// So the correctness half is NOT solved here. It is solved in `storage/db.js`, by
// a compare-and-swap that needs no lock and no other tab to be reachable, because
// a browser that cannot elect a leader still has to be safe. What this file does is
// make the conflict RARE — one writer at a time, by agreement — and answer the two
// questions the store cannot: which tab holds the connection, and who is still here.
//
// ⚠️ THE THIRD ONE IS WHERE THE HOLE WAS. §7.8 step 3 says to broadcast the ending
// "to every same-origin client and await acknowledgement before continuing", and a
// document cannot enumerate its same-origin siblings. There is no `clients` list in
// a page. So "await acknowledgement" has no termination condition: with no idea how
// many replies to expect, the wait either never ends or ends on a timer — and a
// timer is not an acknowledgement, it is a hope with a delay in front of it, while
// the control above it says "removes it from this browser now".
//
// ⭐ WHAT SUPPLIES ONE IS A LOCK USED AS A PRESENCE REGISTER. Every client holds a
// SHARED lock on one name for as long as its document lives, and `locks.query()`
// reports every holder. That is a census: not a list of who answered, but of who is
// still running. Waiting for it to fall to one is strictly stronger than waiting
// for acknowledgements — a tab that acknowledges and then fails to go away still
// holds its lock, and is still counted, which is the honest answer.
//
// ⚠️⚠️ AND WHERE WEB LOCKS IS ABSENT THERE IS NO CENSUS, SO THE ENDING MUST CLAIM
// LESS. §4.2's own fallback ("allow a second connection and accept the duplication")
// and §7.8 step 3 cannot both be satisfied on such a browser: one permits a client
// this file cannot enumerate, the other requires every client to be awaited. That
// is why `confirmEnded` returns what it managed rather than a boolean, and why
// `ui/copy.js` has two sentences for the ending rather than one.
//
// ⚠️⚠️ THE ENDING IS TWO CALLS, NOT ONE, AND THAT IS 0.8.13. `announceEnd` silences
// the other clients and `confirmEnded` waits for them to be gone, because §7.8's
// ordering put both after the step that CLEARS STORAGE — which clears a database
// that every one of those clients, and this one, is still writing to. Silencing
// belongs before the clear and confirmation after it. `flow/ending.js` is the file
// that puts them in the right places.

import { b64uEncode } from "../crypto/b64u.js";
import { sha256 } from "../crypto/hash.js";

/** How long `endEverywhere` waits for the other clients to disappear. */
export const END_DEADLINE_MS = 3000;

/** How often it re-reads the census while waiting. */
export const END_POLL_MS = 50;

/** Why an ending could not be confirmed. `null` means it was. */
export const NO_CENSUS = "no_census"; // Web Locks absent: who is out there is unknowable
export const NO_CHANNEL = "no_channel"; // BroadcastChannel absent: they cannot even be told
export const TIMED_OUT = "timed_out"; // asked, counted, and somebody is still there

/**
 * The name every lock and channel for one identity is built from.
 *
 * ⚠️ IT IS A HASH OF `roster_id`, NOT `roster_id`, for the reason `flow/roster.js`
 * gives about storage keys and one more that belongs to this file: lock names are
 * enumerable. `navigator.locks.query()` returns every name held on the origin, to
 * any script running on it, so a name is closer to a key than to a value — and
 * `roster_id` is the value §7.2 identifies as confirming a passphrase guess with a
 * single HKDF. Nothing here needs it; a commitment to it does the same job.
 *
 * ⚠️ IT IS PER-IDENTITY AND MUST BE. Two tabs holding two different passphrases are
 * two identities in one browser — `vault.js` already expects that, and skips
 * records it cannot decrypt. A single origin-wide leader would elect one of them
 * and leave the other's conversations with nothing watching them at all.
 */
export async function scopeFor(rosterId) {
  return b64uEncode((await sha256(rosterId)).slice(0, 16));
}

/** The shared lock every client holds for its lifetime. Holders = live clients. */
export const censusName = (scope) => `lpm.${scope}.clients`;

/** The exclusive lock the leader holds. Whoever holds it owns the connections. */
export const writerName = (scope) => `lpm.${scope}.leader`;

/** One channel's critical section, across tabs. */
export const channelName = (scope, channelHash) => `lpm.${scope}.channel.${channelHash}`;

/**
 * Is another client of this identity already DELIVERING? — ARCHITECTURE §4.2.2.
 *
 * ⚠️⚠️ IT ASKS ABOUT THE WRITER LOCK AND NOT ABOUT THE CENSUS, AND THE DIFFERENCE IS
 * THE WHOLE RULE. The census counts documents; this counts the document doing the job.
 * A dormant sibling is a document, and it must not be able to make a third tab dormant
 * too — that is how a browser ends up with three tabs all deferring to each other and
 * nothing delivering at all.
 *
 * ⚠️⚠️ IT MUST BE ASKED **BEFORE** `openTabs`, AND THAT ORDER IS LOAD-BEARING. Since
 * §4.2.1 a visible tab STEALS leadership as it is constructed, so a client that built
 * its tab connection first and asked afterwards would always find the writer lock
 * held — by itself. The question only has an answer while this document is still
 * outside the election.
 *
 * Returns `false` where there is no lock API: §4.2's fallback permits a second client
 * and this must not become the thing that refuses one. ⚠️ The answer is not "there is
 * nobody"; it is "this browser cannot say", resolved in the direction that keeps the
 * app working rather than the direction that sounds careful.
 */
export async function anotherClientIsLive(scope, { locks = globalThis.navigator?.locks ?? null } = {}) {
  if (!locks?.query) return false;
  const state = await locks.query();
  return (state.held ?? []).some((l) => l.name === writerName(scope));
}

/**
 * Join the other tabs.
 *
 * `locks` and `broadcast` are injected so the suite can drive them; in the product
 * they are `navigator.locks` and `BroadcastChannel`. Either may be absent, and the
 * degradation is different for each — see `capabilities` on the returned object.
 *
 *   `onLeader(isLeader)`  this tab may (or may no longer) hold the connections
 *   `onNotice(message)`   another tab said something. The kinds are the app's
 *   `onEnd()`             another tab ended the session; do the same, then close()
 */
export function openTabs({
  scope,
  locks = globalThis.navigator?.locks ?? null,
  broadcast = typeof globalThis.BroadcastChannel === "function"
    ? (name) => new globalThis.BroadcastChannel(name)
    : null,
  doc = globalThis.document ?? null,
  onLeader = () => {},
  onNotice = () => {},
  onEnd = () => {},
  dormant: startDormant = false,
} = {}) {
  if (!scope) throw new RangeError("openTabs: a scope is required — see scopeFor()");

  /**
   * Is this tab in front? ARCHITECTURE §4.2.1 turns on the answer.
   *
   * ⚠️ WITH NO DOCUMENT THE ANSWER IS "NO", AND THAT IS THE HONEST DEFAULT RATHER THAN THE
   * CONVENIENT ONE. Nothing in a browser reaches this branch — a document always exists —
   * so it decides only what the suite sees, and a suite that is told "visible" by default
   * would exercise the stealing path everywhere and the queueing path nowhere. Claiming to
   * be in front when there is no way to know is the kind of comfortable assumption that
   * takes delivery away from a tab that is working.
   */
  const isVisible = () => doc?.visibilityState === "visible";

  let leader = false;
  let closed = false;
  /**
   * ARCHITECTURE §4.2.2: this document has declined to be a client, because another
   * one was already delivering when it opened.
   *
   * ⚠️ IT IS NOT "NOT THE LEADER". A follower contends and may win; a dormant document
   * does not contend at all, and that is the point — it must never end up holding a
   * lock or a store transaction on behalf of an identity another tab is running.
   */
  let dormant = startDormant;
  const holding = []; // resolvers that release this client's long-held locks
  const channel = broadcast ? broadcast(`lpm.${scope}`) : null;

  // ------------------------------------------------------------- the census

  /**
   * Hold a lock for as long as this client lives.
   *
   * The Web Locks callback holds until the promise it returns settles, so the
   * release is a resolver kept in `holding`. A document that is torn down without
   * calling `close()` releases everything anyway — which is the property the census
   * is built on: a crashed tab stops being counted without having to say so.
   */
  function hold(name, mode, granted) {
    if (!locks) return;
    let release;
    const held = new Promise((resolve) => (release = resolve));
    holding.push(release);
    void locks
      .request(name, { mode }, async () => {
        granted?.();
        await held;
      })
      .catch(() => {});
  }

  hold(censusName(scope), "shared");

  // ------------------------------------------------------------- leadership
  //
  // ⚠️⚠️ LEADERSHIP FOLLOWS THE VISIBLE TAB, AND UNTIL 2026-08-17 IT FOLLOWED THE
  // OLDEST SURVIVING DOCUMENT (ARCHITECTURE §4.2.1, D-126). The lock was requested
  // once and queued, which is correct only if a holder that stops working eventually
  // releases. **A frozen document does not** — a Web Lock is released when a document
  // dies, not when it stops executing — and on a phone every tab that is not in front
  // is frozen. So the tab the person was looking at opened nothing, on behalf of a tab
  // that was filling nothing, and messages arrived when they finally switched back.
  //
  // Measured before the fix: 60 seconds with no delivery into an unlocked tab with the
  // conversation open, while the frozen tab held the lock. Nothing was lost — §5.3.3's
  // floor poll collects it all on thaw — but a messenger that looks like it lost
  // messages has lost the argument.

  /** Resolver for the writer lock this tab currently holds, if it holds one. */
  let releaseWriter = null;

  /**
   * Take leadership, displacing whoever has it.
   *
   * ⚠️⚠️ `steal` IS THE WHOLE FIX AND A PLAIN REQUEST CANNOT SUBSTITUTE FOR IT. Queueing
   * waits for the holder to release, and the holder this exists to displace is frozen:
   * it will not release until the browser decides to discard it, which may be never
   * while the person is using the app.
   *
   * ⚠️ THE REJECTION IS NOT SWALLOWED, unlike `hold`'s. When another tab steals this
   * one's lock, this request's promise rejects, and that rejection is the ONLY
   * notification a stolen-from tab gets. Discarding it would leave a document
   * believing it was still delivering — which is D-126's failure with the tabs
   * reversed, and worse, because it would also be holding a connection.
   */
  function takeLeadership({ steal }) {
    if (closed || leader || dormant) return;
    // ⚠️⚠️ NO LOCK API MEANS EVERY TAB LEADS, WHICH IS THIS SECTION'S OWN DOCUMENTED
    // FALLBACK AND WAS NOT IMPLEMENTED. ARCHITECTURE §4.2 ends *"if neither exists, allow
    // a second connection and accept the duplication"* — but `leader` could only ever
    // become true inside a granted lock callback, so on a browser without
    // `navigator.locks` no tab was ever leader and **nothing was ever delivered to any
    // tab.** Found while fixing D-126, and it is the same shape one step further out:
    // delivery was made conditional on winning an election that could not be held.
    //
    // Latent rather than live — Web Locks has been in every current browser for years,
    // and it needs a secure context, which this product always has. iOS Safari before
    // 15.4 is the realistic case. The duplication §4.2 accepts is two connections and two
    // drains, and §5.4.3a's conditional write is what keeps that safe.
    if (!locks) {
      leader = true;
      onLeader(true);
      return;
    }
    let release;
    const held = new Promise((resolve) => (release = resolve));
    releaseWriter = release;
    void locks
      .request(writerName(scope), { mode: "exclusive", steal }, async () => {
        if (closed) return;
        leader = true;
        onLeader(true);
        await held;
      })
      .catch(() => {})
      .finally(() => {
        // Reached both when this tab released on its way out and when another tab
        // stole the lock. Either way this document is no longer delivering, and the
        // app has to be told so it can stop its streams.
        if (releaseWriter !== release) return; // a later request has superseded this one
        releaseWriter = null;
        if (closed || !leader) return;
        leader = false;
        onLeader(false);
      });
  }

  /**
   * ⚠️⚠️ THE FIRST CLAIM STEALS ONLY IF THIS TAB IS IN FRONT, AND MY FIRST VERSION STOLE
   * UNCONDITIONALLY. `test/tabs.mjs` caught it: opening five tabs handed leadership to all
   * five in turn, which is not the rule and is actively harmful — a tab opened in the
   * BACKGROUND (a middle-click, a session restore, a link opened behind the current page)
   * would take delivery away from the visible tab and then be frozen by the phone. **That
   * is D-126 with the tabs reversed**, and it would have been the same silent stall.
   *
   * A hidden tab therefore queues, exactly as every tab did before today: it leads only if
   * nobody else holds it.
   */
  takeLeadership({ steal: isVisible() });

  /**
   * ⚠️⚠️ A HIDDEN TAB DOES NOT STAND DOWN, AND THAT ASYMMETRY IS DELIBERATE
   * (ARCHITECTURE §4.2.1 rule 2). Releasing on hidden would break the case this election
   * has always got right: one tab, in the background, running perfectly well, and the only
   * thing delivering. **Only the arrival of a visible claimant may move leadership.**
   *
   * No debounce, because `visibilitychange` does not fire on focus — two side-by-side
   * desktop windows are both `visible` and neither keeps re-firing — so the churn a
   * debounce would guard against does not exist. Switching tabs costs one lock operation.
   */
  const onVisible = () => {
    if (isVisible()) takeLeadership({ steal: true });
  };
  doc?.addEventListener?.("visibilitychange", onVisible);

  /**
   * How many clients of this identity are live, or `null` if that is unknowable.
   *
   * ⚠️ `null` IS NOT ZERO AND NOT ONE. It means this browser cannot answer the
   * question, and every caller has to say so rather than assume the comfortable
   * value. The one caller that matters is the ending.
   */
  async function census() {
    if (!locks?.query) return null;
    const state = await locks.query();
    return (state.held ?? []).filter((l) => l.name === censusName(scope)).length;
  }

  // ------------------------------------------------------------ the notices

  if (channel) {
    channel.onmessage = (event) => {
      const message = event?.data;
      if (!message || typeof message !== "object") return;
      if (message.kind === "end") {
        // ⚠️ NO REPLY IS SENT AND NONE IS WANTED. The ending tab is watching the
        // census, not a mailbox: what it needs from this one is not a message but
        // its absence, which `close()` produces by releasing the shared lock.
        onEnd(message);
        return;
      }
      onNotice(message);
    };
  }

  // ------------------------------------------------------------- the ending

  /**
   * §7.8 step 3, FIRST HALF: tell every other client to end.
   *
   * ⚠️⚠️ IT IS A SEPARATE CALL FROM THE WAIT, AND THE SEPARATION IS 0.8.13. §7.8
   * put "tell the others" and "await them" in one step, placed AFTER the step that
   * clears storage — so an ending cleared the database while every other client
   * was still draining into it, and while this document's own drain was still in
   * flight. **Silencing has to happen before the clear; only the confirmation has
   * to happen after it.** One call cannot be in two places, so there are two.
   *
   * It returns nothing, and there is nothing useful it could return: a
   * `postMessage` has no delivery report. That is exactly why the wait below
   * counts holders rather than replies.
   */
  function announceEnd() {
    channel?.postMessage({ kind: "end" });
  }

  /**
   * §7.8 step 3, SECOND HALF: wait until nothing else is running.
   *
   * Returns `{ confirmed, remaining, reason }`. **`confirmed` is the only thing
   * that licenses the strong wording** — §7.8's "removes it from this browser now"
   * is a claim about the browser, and a tab this one could neither reach nor count
   * is part of the browser.
   */
  async function confirmEnded({ deadlineMs = END_DEADLINE_MS, now = () => Date.now() } = {}) {
    if (!channel) return { confirmed: false, remaining: null, reason: NO_CHANNEL };
    const start = now();
    for (;;) {
      const live = await census();
      if (live === null) return { confirmed: false, remaining: null, reason: NO_CENSUS };
      // One holder left is this client's own. Nobody else is running.
      if (live <= 1) return { confirmed: true, remaining: 0, reason: null };
      if (now() - start >= deadlineMs) return { confirmed: false, remaining: live - 1, reason: TIMED_OUT };
      await sleep(END_POLL_MS);
    }
  }

  // ---------------------------------------------------------------- the API

  return {
    scope,

    /** What this browser can actually do. The ending's honesty depends on it. */
    capabilities: { locks: Boolean(locks), census: Boolean(locks?.query), broadcast: Boolean(channel) },

    get isLeader() {
      return leader;
    },

    census,
    announceEnd,
    confirmEnded,

    /** ARCHITECTURE §4.2.2: has this document declined to be a client? */
    get isDormant() {
      return dormant;
    },

    /**
     * Stop being a client of this identity — ARCHITECTURE §4.2.2 rule 1.
     *
     * Releases leadership if this tab has it and stops contending for it, so that a
     * document the person is not using cannot end up holding the lock, a connection,
     * or an IndexedDB transaction that the tab in front is waiting behind.
     *
     * ⚠️⚠️ IT IS NOT `close()` AND MUST NOT BECOME IT. This document stays counted in
     * the census, keeps listening on the channel, and clears nothing: §7.8's ending
     * still has to be able to reach it, and it still has to be able to wake. A dormant
     * client is a client that is not working, not a client that has left.
     *
     * ⚠️ The release goes through `releaseWriter`, whose `finally` reports `onLeader(false)`
     * — so the app is told it has stopped delivering by the same path a steal uses, and
     * there is only one place that has to be right.
     */
    standAside() {
      if (closed || dormant) return;
      dormant = true;
      releaseWriter?.();
    },

    /**
     * Become the client for this identity — ARCHITECTURE §4.2.2 rule 2, "use this tab
     * instead".
     *
     * ⚠️ IT STEALS, and for the same reason §4.2.1 does: the holder it is displacing may
     * be a frozen document that will never answer. The person pressing this button is
     * looking at THIS tab, which is the only evidence of intent the browser can offer.
     */
    wake() {
      if (closed || !dormant) return;
      dormant = false;
      takeLeadership({ steal: true });
    },

    /** Say something to every other client of this identity. Kinds are the app's. */
    announce(kind, detail = {}) {
      channel?.postMessage({ kind, ...detail });
    },

    /**
     * Run `fn` with no other tab inside the same channel's critical section.
     *
     * ⚠️ IT IS NOT WHAT MAKES THE WRITE SAFE — `storage/db.js` is. This makes the
     * unsafe interleaving RARE, so that the safe answer to it (start over) is not
     * the normal path. Where Web Locks is absent this is a straight call and the
     * compare-and-swap does all of the work, more slowly and just as correctly.
     *
     * ⚠️ IT IS HELD ACROSS NETWORK I/O, deliberately. §5.4.1's atomic unit runs
     * from the mailbox read to the stored plaintext, so releasing before the fetch
     * would hand the other tab exactly the window this exists to close — and two
     * tabs draining one mailbox in turn is better than both draining it at once.
     */
    withChannel(channelHash, fn) {
      if (!locks) return fn();
      return locks.request(channelName(scope, channelHash), fn);
    },

    /**
     * Leave. Releases the writer lock — handing leadership to whoever is next in
     * the queue — and the census lock, which is what tells an ending tab that this
     * one is gone.
     */
    close() {
      if (closed) return;
      closed = true;
      leader = false;
      if (channel) channel.onmessage = null;
      channel?.close();
      // ⚠️ THE WRITER LOCK IS RELEASED HERE TOO, AND IT IS NOT IN `holding`. It is held
      // by `takeLeadership`, which owns its own resolver so that a steal and a close
      // are distinguishable; forgetting this line would leave an ended document holding
      // leadership for the whole browser until the tab was actually torn down.
      doc?.removeEventListener?.("visibilitychange", onVisible);
      releaseWriter?.();
      releaseWriter = null;
      for (const release of holding.splice(0)) release();
    },
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
