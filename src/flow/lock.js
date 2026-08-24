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
 */
export const IDLE_MS = 30 * 60 * 1000;

/** §4.3: the tab-blur threshold. See above — it was 60 seconds until D-082. */
export const BLUR_MS = 5 * 60 * 1000;

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
 * Watch for both conditions and call `onLock(reason)` once.
 *
 * ⚠️ ONCE. Locking tears down the session; a second call would run against a
 * session that is already gone. `stop()` is idempotent for the same reason.
 */
export function watchIdleness({
  onLock,
  target = globalThis,
  doc = globalThis.document,
  now = () => Date.now(),
  idleMs = IDLE_MS,
  blurMs = BLUR_MS,
  checkMs = CHECK_MS,
} = {}) {
  let lastActivity = now();
  let hiddenSince = doc?.visibilityState === "hidden" ? now() : null;
  let stopped = false;

  const evaluate = () => {
    if (stopped) return;
    const reason = dueToLock({ lastActivity, hiddenSince, now: now() }, { idleMs, blurMs });
    if (!reason) return;
    stop();
    onLock?.(reason);
  };

  const touch = () => {
    if (stopped) return;
    lastActivity = now();
  };

  const onVisibility = () => {
    if (doc?.visibilityState === "hidden") {
      hiddenSince = now();
      return;
    }
    // ⭐ COMING BACK IS THE EVENT THAT MATTERS. Whether the tab was hidden for
    // seventy seconds or seven hours, this is the instant a person is looking at
    // the screen again, and it is where the blur rule has to be decided — before
    // the conversation is repainted, not on the next throttled tick.
    const wasHidden = hiddenSince;
    hiddenSince = null;
    if (wasHidden !== null && now() - wasHidden >= blurMs) {
      stop();
      onLock?.(BLURRED);
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

  return { stop, touch, evaluate, get stopped() { return stopped; } };
}
