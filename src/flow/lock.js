// The idle lock — ARCHITECTURE.md §4.3, and §11's "device theft, unlocked" row.
//
// ⚠️ BE HONEST ABOUT WHAT THIS IS. While the keys are in memory a lock is a UI
// overlay: it does not resist devtools, and it does not resist an XSS foothold,
// which §11 names as the weakest link in the whole design. **It defends against
// somebody picking up an unlocked device, and nothing else.** What makes it more
// than a screensaver is that locking DROPS THE KEYS, so a locked session cannot be
// resumed without the passphrase — and that only works if the right keys go.
//
// ⚠️⚠️ §4.3 NAMED THE WRONG SECRET, AND THAT IS THE ELEVENTH DEFECT (0.8.13,
// D-070). It says: *"`K_master` is dropped from memory on lock, so a locked session
// cannot be resumed without re-authenticating."* But §7.2 makes `K_master` a
// **derivation input** — it yields `roster_id`, `roster_key`, `roster_auth`,
// `local_key` and `pickle_key`, and `flow/roster.js` overwrites it with zeros the
// instant those exist, at UNLOCK. So the action §4.3 specifies has already been
// performed, permanently, before the lock is ever reached; obeying that sentence
// changes nothing at all.
//
// And the property it claims is false while the five derived values live: they
// open the roster, every channel root, every session pickle and the whole local
// history, and none of them needs `K_master` again. ➡️ **A rule whose action is
// already unconditionally true cannot be what delivers the property beside it** —
// the test that finds this is simply *"what changes when this is obeyed?"*
//
// So the lock drops the DERIVED set (`flow/ending.js`'s `overwriteKeys`), and
// unlocking pays Argon2id again. That is the honest cost of the honest mechanism.

/**
 * §4.3, and both numbers changed on 2026-08-13 (D-082).
 *
 * ⚠️⚠️ THE BLUR THRESHOLD WAS 60 SECONDS AND IT WAS WRONG FOR THIS PRODUCT'S OWN
 * CENTRAL FLOW. §3's entire design is that a person creates a link **and then
 * leaves this app to send it** — that is what "link-paired" means. Switching to a
 * messaging app, finding the right thread, pasting, and coming back is routinely
 * over a minute on a phone, so the rule locked people out **in the middle of the
 * one flow every user has to complete**, and lifting the lock costs a 128 MiB
 * Argon2id derivation.
 *
 * ⭐ The threshold had been reasoned about honestly, against the wrong question.
 * *"How long before an unattended device is a risk?"* is a good question and 60
 * seconds is a defensible answer to it. Nobody asked *"how long does this
 * product's own primary task take?"* — and a timeout is the intersection of the
 * two, not the minimum of one.
 *
 * ⚠️ THESE ARE TESTING-PERIOD VALUES AND `ARCHITECTURE.md` §4.3 RECORDS THEM AS
 * SUCH. The end state is two-tier: a short window behind a quick re-entry code,
 * with the phrase required only after a long one. Until that exists, one tier does
 * both jobs. `ui/copy.js` interpolates both numbers, so the sentences follow by
 * construction; the *reason* they are what they are has no such mechanism and
 * lives in §4.3.
 *
 * ⚠️⚠️ BOTH ARE 24 HOURS FOR THE FRIEND TEST, AND THEY ARE EQUAL ON PURPOSE (D-190,
 * 2026-09-02). D-082 moved the blur threshold once already, for this exact reason and
 * one step short: five minutes is longer than pasting a link takes, and shorter than
 * the rest of what a tester does — put the phone down, answer something else, come
 * back after lunch. Every one of those cost a 128 MiB Argon2id derivation, and a round
 * spent retyping eight words measures the lock rather than the product.
 *
 * ⭐ 24 hours is not an arbitrary round number here: §6.6 deletes a message at 24 hours,
 * so this is exactly as long as anything it protects can live. A device that remembered
 * the phrase longer would be holding a key to an empty store.
 *
 * ⛔ WHAT THIS COSTS, SAID PLAINLY. §4.3's lock defends against somebody picking up an
 * unlocked device, and for the length of the test that defence is withdrawn: a phone
 * left on a table with this in a background tab opens on a touch for a day. That is a
 * deliberate trade for a tester round among friends and it is NOT the shipping value —
 * see §4.3, which carries the same sentence and the way back.
 */
export const IDLE_MS = 24 * 60 * 60 * 1000;

/**
 * §4.3: the tab-blur threshold. It was 60 seconds until D-082 and 5 minutes until D-190.
 *
 * ⭐ IT IS THE ONE THAT ACTUALLY BIT, which is why raising the idle threshold alone
 * would have changed nothing a tester notices. §3's central flow leaves this app to
 * send the link, and a phone that leaves this app makes the document hidden — so the
 * rule that fires on a tester is this one, on the path D-082 already identified.
 */
export const BLUR_MS = 24 * 60 * 60 * 1000;

/**
 * §4.3's SHORT window — the one the cover answers, and the reason the two above may
 * stay where D-190 put them.
 *
 * ⚠️⚠️ THESE ARE D-082's NUMBERS COMING BACK, AND THAT IS THE POINT OF THE WHOLE
 * SECOND TIER. Thirty minutes and five minutes were reasoned correctly against *"how
 * long before an unattended device is a risk?"* and abandoned twice, both times for the
 * same reason and never because the answer was wrong: **lifting the gate cost a 128 MiB
 * Argon2id derivation and the eight words**, so a threshold short enough to be worth
 * anything was a threshold that punished the product's own central flow. D-190 took
 * them to 24 hours and recorded exactly what that costs — *"a phone left on a table
 * with this in a background tab opens on a touch for a day."*
 *
 * ⭐ **A COVER CHANGES THE PRICE, NOT THE ARGUMENT.** Lifting this costs 6 to 8 digits,
 * so the short window is affordable again and the defence D-190 withdrew comes back —
 * while the KEY is still asked for no more often than it was.
 *
 * ⚠️ FIVE MINUTES IS CHOSEN AGAINST A MEASUREMENT AND NOT AGAINST A FEELING. §3's
 * central flow leaves this app to send the invite link, and D-082 measured that round
 * trip at *"routinely more than sixty seconds"* on a phone and well under five minutes.
 * So this fires when somebody puts the phone down and not when they paste a link.
 * ⛔ Two minutes was offered and declined for that reason: it lands in the middle of
 * the one flow every single user has to complete.
 *
 * ⚠️ THE INVARIANT IS THAT NEITHER OF THESE MAY EXCEED ITS TIER ABOVE. A cover window
 * longer than the lock window is unreachable — the lock always concludes first — which
 * is the same shape as §4.3's rule that blur may never be the longer of the two.
 * `test/ending.mjs` refuses the ordering rather than trusting it.
 */
export const COVER_IDLE_MS = 30 * 60 * 1000;
export const COVER_BLUR_MS = 5 * 60 * 1000;

/**
 * How often the timer looks, when nothing else has happened.
 *
 * ⚠️ IT IS A BACKSTOP, NOT THE MECHANISM. A hidden tab's timers are throttled to
 * roughly one a minute, which is exactly the state the blur rule is about — so a
 * design that waited for this tick would lock late by up to a minute, on the one
 * path that matters. What actually closes it is that the lock is re-evaluated on
 * `visibilitychange`: **the moment that matters is the device being picked up, and
 * that is an event, not an elapsed time.**
 */
export const CHECK_MS = 15 * 1000;

export const IDLE = "idle";
export const BLURRED = "blurred";

/**
 * D-163 — the person asked.
 *
 * ⚠️ `dueToLock` NEVER RETURNS THIS AND MUST NOT. The two above are conclusions this
 * module draws from a clock; this one is an argument the interface passes in, and
 * keeping it out of the pure function is what stops a future condition being added
 * here and locking somebody "because they asked" when they did not.
 *
 * ⭐ It exists at all because the reason is what `app.js` puts on the lock screen, and
 * *"locked after 24 hours without use"* under a button pressed one second ago is a
 * false sentence — see `copy.lock.manual`.
 */
export const MANUAL = "manual";

/**
 * §4.3's second tier gave up — the fifth wrong PIN.
 *
 * ⚠️ LIKE `MANUAL`, `dueToLock` NEVER RETURNS IT AND MUST NOT. It is not a conclusion
 * from a clock; it is what the cover screen reports after counting, and keeping it out
 * of the pure function is what stops a future condition being added there and locking
 * somebody "because of wrong PINs" who never typed one.
 *
 * ⭐ AND IT IS A SEPARATE REASON RATHER THAN `MANUAL` BECAUSE OF WHO READS IT. A person
 * who mistyped their own PIN needs to know the next step; a person who did NOT do this
 * is being told their device was in somebody else's hands, and `manual`'s sentence —
 * about a button they pressed — would hide that.
 */
export const WRONG_PIN = "wrong_pin";

/**
 * Pure: should this session be locked, and why?
 *
 * `hiddenSince` is null when the tab is visible. Returns null, or the reason —
 * which the caller shows, because "you were away" and "the app was in the
 * background" are different things to have happened to somebody.
 */
export function dueToLock({ lastActivity, hiddenSince, now }, { idleMs = IDLE_MS, blurMs = BLUR_MS } = {}) {
  if (hiddenSince !== null && hiddenSince !== undefined && now - hiddenSince >= blurMs) return BLURRED;
  if (now - lastActivity >= idleMs) return IDLE;
  return null;
}

/**
 * The same question at the shorter window: should this session be COVERED, and why?
 *
 * ⚠️ IT IS A NAME RATHER THAN A MECHANISM, AND THE NAME IS THE POINT. One predicate
 * serves both tiers because the arithmetic is identical; what differs is what the
 * caller then DOES, and §4.3 spends a page insisting those two things are not the same
 * thing. A call site reading `dueToLock(state, coverThresholds)` would be correct and
 * would quietly teach the next reader that a cover is a short lock. It is not: a lock
 * drops the keys and this drops nothing.
 */
export function dueToCover(state, { idleMs = COVER_IDLE_MS, blurMs = COVER_BLUR_MS } = {}) {
  return dueToLock(state, { idleMs, blurMs });
}

/**
 * Watch both tiers. Calls `onCover(reason)` at the short window and `onLock(reason)`
 * at the long one.
 *
 * ⚠️ ONLY ONE OF THEM IS ONCE. Locking tears down the session, so `onLock` fires a
 * single time and `stop()` is idempotent for the same reason — a second call would run
 * against a session that is already gone. **Covering tears down nothing**, so this
 * keeps watching straight through it: the 24-hour lock still arrives on a session that
 * has been sitting behind its cover all day, which is the whole reason the long tier
 * is still here.
 *
 * ⚠️⚠️ WHILE COVERED, TAPPING IS NOT USE. `touch()` returns early, so activity on a
 * covered screen does not push the lock away — and that closes a hole rather than
 * merely being tidy: without it, somebody trying PINs on a phone they picked up would
 * hold off the one gate that would have dropped the keys. The interface calls
 * `uncovered()` when the right PIN arrives, and that is the moment the person counts
 * as present again.
 *
 * ⚠️ THE COVER TIER IS INERT WITHOUT `onCover`, WHICH IS FOR THE TESTS AND FOR NOTHING
 * ELSE. `app.js` always passes both. A caller that wants to exercise the long window
 * alone should not have to sit through the short one first.
 */
export function watchIdleness({
  onLock,
  onCover,
  target = globalThis,
  doc = globalThis.document,
  now = () => Date.now(),
  idleMs = IDLE_MS,
  blurMs = BLUR_MS,
  coverIdleMs = COVER_IDLE_MS,
  coverBlurMs = COVER_BLUR_MS,
  checkMs = CHECK_MS,
} = {}) {
  let lastActivity = now();
  let hiddenSince = doc?.visibilityState === "hidden" ? now() : null;
  let stopped = false;
  let covered = false;

  const evaluate = () => {
    if (stopped) return;
    const state = { lastActivity, hiddenSince, now: now() };

    // ⚠️ THE LONG TIER IS ASKED FIRST AND THE ORDER IS NORMATIVE. Its thresholds are
    // never shorter than the cover's, so whenever both are due the person has been away
    // long enough for the stronger answer, and covering a session that was owed a lock
    // would leave the keys in memory behind a gate that costs six digits.
    // ⚠️⚠️ AND IT IS ASKED ONLY WHERE THERE IS SOMETHING TO LOCK TO. §7.6's Ghost mode
    // has no phrase and no roster, so dropping the derived set there is not a lock but
    // a silent ending on a timer (D-073) — it arms the cover tier alone, and says so at
    // its own call site. ⛔ **An absent `onLock` is therefore a DELIBERATE statement and
    // never a default**: the Kept path passes one every time it arms this, and a change
    // that dropped it would remove the only gate that takes the keys out of memory.
    const lock = onLock ? dueToLock(state, { idleMs, blurMs }) : null;
    if (lock) {
      stop();
      onLock(lock);
      return;
    }

    if (covered || !onCover) return;
    const cover = dueToCover(state, { idleMs: coverIdleMs, blurMs: coverBlurMs });
    if (!cover) return;
    covered = true;
    onCover(cover);
  };

  const touch = () => {
    if (stopped || covered) return;
    lastActivity = now();
  };

  const onVisibility = () => {
    if (doc?.visibilityState === "hidden") {
      // ⚠️ ALREADY-HIDDEN STAYS AT ITS FIRST INSTANT. A tab that is hidden, covered and
      // then hidden again must keep the moment it first went away, or a phone woken
      // once an hour would reset the clock the long tier is counting.
      if (hiddenSince === null) hiddenSince = now();
      return;
    }
    // ⭐ COMING BACK IS THE EVENT THAT MATTERS. Whether the tab was hidden for
    // seventy seconds or seven hours, this is the instant a person is looking at
    // the screen again, and it is where the blur rules have to be decided — before
    // the conversation is repainted, not on the next throttled tick.
    const wasHidden = hiddenSince;
    hiddenSince = null;
    if (wasHidden === null) return;
    const away = now() - wasHidden;
    if (onLock && away >= blurMs) {
      stop();
      onLock(BLURRED);
      return;
    }
    if (!covered && onCover && away >= coverBlurMs) {
      covered = true;
      onCover(BLURRED);
      return;
    }
    touch();
  };

  const activity = ["pointerdown", "keydown", "touchstart", "focus"];
  for (const type of activity) target.addEventListener?.(type, touch, { passive: true });
  doc?.addEventListener?.("visibilitychange", onVisibility);
  const timer = setInterval(evaluate, checkMs);

  function stop() {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    for (const type of activity) target.removeEventListener?.(type, touch);
    doc?.removeEventListener?.("visibilitychange", onVisibility);
  }

  /** The right PIN arrived: the person is here, and the clocks start again from now. */
  function uncovered() {
    if (stopped) return;
    covered = false;
    hiddenSince = doc?.visibilityState === "hidden" ? now() : null;
    lastActivity = now();
  }

  return {
    stop,
    touch,
    evaluate,
    uncovered,
    get stopped() { return stopped; },
    get covered() { return covered; },
  };
}
