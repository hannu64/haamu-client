// Ending a session — PROTOCOL.md §7.8, and §7.7's one deliberate exception.
//
// §7.8 gives six numbered steps and says they MUST be implemented in that order.
// This file is that order, in one place, because an ending scattered across event
// handlers is an ending whose order nobody can check.
//
// ⚠️⚠️ ONE STEP IS IN A DIFFERENT PLACE FROM THE ONE §7.8 GAVE IT, AND THAT IS THE
// TENTH DEFECT (PROTOCOL 0.8.13). §7.8's step 2 clears storage; its step 3 stops
// the SSE connection and tells every other client to stop. **Clearing the database
// before stopping the things that write to it does not survive its own ordering.**
//
// The window is not hypothetical and it does not need a second tab. `flow/live.js`
// may be inside a drain when the ending begins: the mailbox has been fetched over
// the network, and the write that stores the plaintext and the advanced ratchet is
// still to come. Step 2 clears the store; the drain resolves; `flow/message.js`
// writes a session record and the app appends the message rows — into the database
// the ending has just emptied — and step 4 navigates away leaving them there.
// **The ending resurrects part of the conversation it was asked to remove**, in a
// client following §7.8 exactly.
//
// ⭐ THE FIX IS A SPLIT, NOT A SWAP. Only the *silencing* has to precede the clear;
// the *confirmation* — waiting for the other clients to disappear, which takes as
// long as it takes — belongs after it. §7.8 conflated the two into one step, so an
// implementer had to choose between clearing late and confirming early, and both
// choices are wrong. The order below is the one that is not:
//
//   0. mark the document ended, and arm the bfcache defence
//   1. STOP: this document's delivery, and every other client's        ← moved up
//   2. overwrite the key buffers in place, and drop every reference
//   3. clear conversation state (and, in Kept mode, device unlock state)
//   4. CONFIRM: wait until no other client is running                  ← was with 1
//   5. `location.replace()` — never `assign`, never a link
//
// ⚠️ Step 5's `Clear-Site-Data` variant is a SEPARATE control with a separate
// warning (§7.3.2 rule 4, §7.8), because it resets rollback detection. It is passed
// in rather than decided here — see `thorough`.

import * as tabs from "./tabs.js";

/** Where a finished ending lands. §7.8 step 5's variant is the same page, asked to clear. */
export const ENDED_PATH = "/ended";
export const ENDED_PATH_THOROUGH = "/ended?clear=1";

/**
 * Has this document ended? §7.8 step 0.
 *
 * ⚠️ IT IS MODULE STATE ON PURPOSE, not a field on a session object — the session
 * object is one of the things an ending drops, and step 0's whole job is to leave
 * behind something that outlives everything else in the document. A bfcache restore
 * brings the module back with this still set.
 */
let ended = false;
export const hasEnded = () => ended;

/**
 * §7.8 step 0's second half: a document that comes back from the back/forward
 * cache comes back **with its heap intact** — every reference step 2 could only
 * drop is live again on a build that restores it. Measured on one mainstream
 * Chromium build (§7.8, `DEVICE_RESULTS.md` round 2), while Safari/iOS and Samsung
 * Internet rebuilt the document. **Two Chromium builds disagreeing is the finding**,
 * which is why no part of this design may depend on navigation destroying anything.
 *
 * Armed at boot rather than at the ending: a handler registered during the ending
 * is a handler the restored document may or may not have.
 */
export function armBfcacheDefence({ target = globalThis, navigate = defaultNavigate } = {}) {
  target.addEventListener?.("pageshow", (event) => {
    if (!ended || !event?.persisted) return;
    // Nothing to clear that is not already cleared — the value here is repeating
    // step 5, because the restored document is showing the conversation again.
    navigate(ENDED_PATH);
  });
}

/**
 * §7.8 step 2, and §7.7's one deliberate exception.
 *
 * ⚠️⚠️ WHAT THIS REACHES AND WHAT IT DOES NOT. `Uint8Array` buffers are mutable, so
 * `fill(0)` is a real write and not the string case §7.7 forbids claiming. It
 * reaches **nothing else**: a non-extractable `CryptoKey` cannot be zeroed by any
 * means a page has, and the most that can be done is drop the reference. Neither
 * reaches the copies a garbage collector has already made. §7.7: **do not claim
 * memory zeroization anywhere in the product.**
 *
 * ⭐ THE SET IT IS GIVEN MATTERS MORE THAN THE OVERWRITE. See `ARCHITECTURE.md`
 * §4.3 and D-070: dropping `K_master` is not what makes a session unresumable,
 * because `K_master`'s only job is to derive the five values below and it is
 * overwritten immediately after doing so. **These are the keys.**
 */
export function overwriteKeys(keys, depth = 2) {
  let wiped = 0;
  if (!keys || typeof keys !== "object" || depth < 0) return wiped;
  for (const value of Object.values(keys)) {
    if (value instanceof Uint8Array) {
      value.fill(0);
      wiped++;
    } else if (value && typeof value === "object" && !(value instanceof CryptoKey)) {
      // ⚠️ NESTED ON PURPOSE. `roster_auth` is `{ privateKey, publicKey }`, and its
      // `privateKey` IS the Ed25519 seed as raw bytes — §7.7's table says so
      // explicitly, because WebCrypto offers no route from HKDF output to an
      // Ed25519 key without the seed existing in the clear first. A wipe that only
      // walked the top level would leave the one signing key this client holds.
      wiped += overwriteKeys(value, depth - 1);
    }
  }
  return wiped;
}

/**
 * End this session, in §7.8's order with 0.8.13's correction.
 *
 * `stopDelivery()` must stop every stream and drain this document is running and
 * must not resolve before they are stopped — it is step 1, and step 3 clears the
 * store they write to.
 *
 * `clearStorage()` is step 3. It is passed in because §7.8 has two of them: the
 * ordinary ending (`vault.endSession()`, which leaves §7.3.2's high-water mark)
 * and the thorough one (`vault.clearEverything()`, which takes it and MUST warn).
 *
 * Returns what `confirmEnded` returned, so the caller can pick the wording §7.8.1
 * licenses — never the wording it hoped for.
 */
export async function endSession({
  client,
  keys,
  stopDelivery = async () => {},
  clearStorage = async () => {},
  sessionStorage: session = globalThis.sessionStorage,
  navigate = defaultNavigate,
  thorough = false,
  mode = "kept",
  deadlineMs,
} = {}) {
  // 0. Marked first, so that everything below is happening to a document that is
  //    already, as far as the rest of the code is concerned, over.
  ended = true;

  // 1. Silence. This document first — it is the one certain writer — then
  //    everybody else. `announceEnd` does not wait, and must not: waiting is step
  //    4, and putting it here is what §7.8 did.
  await stopDelivery();
  client?.announceEnd();

  // 2. §7.7's exception. Before the storage clear rather than after it, because a
  //    clear that throws must not leave the keys live.
  const wiped = overwriteKeys(keys);

  // 3. `sessionStorage` first (§7.6 — Ghost mode has nothing else), then the rest.
  try {
    session?.clear?.();
  } catch {
    // A browser that refuses `sessionStorage` must not stop the ending. There is
    // nothing to report to the user that they could act on.
  }
  await clearStorage();

  // 4. Now wait. Everything of this device's own is already gone, so the time this
  //    takes is spent with nothing left to lose — which is precisely why it can
  //    afford to be honest about failing.
  const outcome = client
    ? await client.confirmEnded({ deadlineMs })
    : { confirmed: false, remaining: null, reason: tabs.NO_CHANNEL };

  // 5. Replace, never assign and never a link: replacing removed the history entry
  //    — and with it any cached copy of the document — in all three browsers
  //    measured, and it is the only step measured to do so.
  //
  // ⚠️⚠️ THE OUTCOME IS AN ARGUMENT, AND IT HAS TO BE. §7.8.1 makes the ending page's
  // wording depend on what the census established, so the page needs to be told —
  // and it cannot be told through storage, which step 3 has just cleared. It goes
  // in the fragment, which never reaches the server (§2.1's property, used for a
  // second purpose): how many endings this instance confirmed and how many it could
  // not is a statistic about its users that it has no reason to hold.
  //
  // ⚠️ It is passed rather than read from a variable the caller is assigning. A
  // caller writing `const outcome = await endSession({ navigate: () => ...outcome })`
  // is referencing a `const` inside its own initialiser — a TDZ ReferenceError,
  // thrown from inside the ending, at the last step, after the storage is already
  // gone. That is exactly how it was written first, and a real browser is what
  // found it.
  // ⚠️⚠️ AND THE MODE GOES WITH IT, WHICH IT DID NOT UNTIL 0.8.14. The ending page's
  // second sentence is *"you will need your eight words to open it again"* — true of
  // Kept mode and **false of Ghost mode**, which has no words and nothing to reopen.
  // The fragment carried the census outcome and nothing else, so the page said the
  // Kept sentence to everybody: the reassurance that makes ending an easy decision,
  // printed for the one session it cannot be true of. Same shape as D-073 one layer
  // out — a sentence written once for a design with two modes — and my own code did
  // it while the section that warns about it was being edited.
  const path = thorough ? ENDED_PATH_THOROUGH : ENDED_PATH;
  const state = outcome.confirmed ? "confirmed" : "unconfirmed";
  navigate(`${path}#${mode === "ghost" ? `${state}-ghost` : state}`, outcome);

  return { ...outcome, wiped };
}

function defaultNavigate(path) {
  globalThis.location?.replace?.(path);
}
