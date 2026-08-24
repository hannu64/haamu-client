/* D-154 — the interface language: English, Finnish, or whichever one the browser
 * is already asking for.
 *
 * ⚠️ THIS IS PART OF AN INSTRUMENT, NOT POLISH ON ONE. The people who will use
 * haamu next are Hannu's friends, who are Finns, and who read English at maybe
 * 80% comprehension and half speed. Hannu, who has watched them do it: *"the ones
 * that are not fluent go past words they do not understand and just click forward.
 * That is typical human behaviour… My estimate: the feedback without Finnish
 * language may be even 75% less in volume."* Every sentence in this product is a
 * warning, a consequence or a promise — exactly the sentences a non-fluent reader
 * skips. English would not merely reduce that round's feedback, it would change
 * its KIND: complaints about buttons instead of whether the security story lands.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️⚠️ WHY THIS IS ALLOWED TO EXIST, GIVEN §0.
 *
 * `PROTOCOL.md` §0's rule: *"if an implementation appears to need a construction
 * not in this document, that is a signal the spec is wrong — stop and ask, do not
 * invent."* The specification says nothing about language, because the product has
 * only ever had one. But it says nothing about the THEME either, and `ui/theme.js`
 * is already here — a remembered interface preference with all four hard parts
 * already answered: where it is stored, what happens when storage is refused, what
 * Ghost mode does with it, and which of §7.8's two endings takes it.
 *
 * ⭐⭐ So this file is a COPY OF AN EXISTING SHAPE rather than a new construction,
 * and every place it departs from `theme.js` is marked below with the reason. The
 * departures are the part worth reviewing; the rest is deliberately the same file.
 * ────────────────────────────────────────────────────────────────────────────*/

/**
 * ⚠️⚠️ DUPLICATED, ON PURPOSE AND UNDER GUARD, in `app/lang-boot.js` — same
 * bargain, same reason, as `THEME_KEY`. That file is a classic render-blocking
 * script and cannot import.
 *
 * ⭐ The guard is DIFFERENT from the theme's, because the duplication is bigger.
 * `theme-boot.js` copies one string, so `test/theme.mjs` compares two literals.
 * This boot script copies a DECISION — stored choice, then the address, then the
 * browser's own list — and two implementations of a decision can agree on every
 * literal and still disagree on an answer. `test/lang.mjs` therefore runs both
 * against the same 576 situations and compares what they conclude.
 */
export const LANG_KEY = "haamu.lang";

/** The two languages this product exists in. */
export const EN = "en";
export const FI = "fi";

/**
 * The only two strings that may be stored.
 *
 * ⚠️ AND THERE IS NO THIRD CHOICE HERE, WHICH IS THE FIRST DEPARTURE FROM
 * `theme.js`. The theme offers "follow the phone" as a visible third option
 * because a phone's dark mode follows the time of day and a person may genuinely
 * want to be dragged along with it. A language does not change at dusk. Nobody
 * thinks *"I would like to follow my browser"*; they think *English* or *Suomi*.
 *
 * So the absence of a stored value is not a choice a person made, it is the state
 * before they made one — and `resolve()` guesses, from the address first and the
 * browser second. §7.8's thorough ending returns them to it.
 */
export const CHOICES = [EN, FI];

/**
 * The address that means Finnish.
 *
 * ⭐ HANNU ASKED FOR THIS SPECIFICALLY, and the reason is not tidiness: he wants a
 * plain thing he can paste into a message to a friend — *"a link etc choice"* — so
 * that a Finn holding a phone set to English still lands in Finnish. Sniffing
 * `navigator.languages` alone cannot serve him, because the case he is worried
 * about is exactly the one where the browser is wrong about the reader.
 */
export const FI_PATH = "/fi";

/**
 * A choice that lives no longer than this document.
 *
 * ⚠️ IN MEMORY RATHER THAN IN `sessionStorage`, for `theme.js`'s reason: §7.6 puts
 * conversation state there and nothing else.
 *
 * ⚠️⚠️ AND IT IS SET BY THE ORDINARY PATH TOO, WHICH IS THE SECOND DEPARTURE FROM
 * `theme.js`. There, a non-Ghost choice clears `volatile` and lets storage answer
 * every later read. Here that would be a bug, because storage is not the only
 * other input: somebody who presses *English* while standing on `/fi` would be
 * answered by the ADDRESS on the very next read and watch the language change
 * back. A choice made in this document has to outrank the address that opened it,
 * whether or not it was also written down.
 */
let volatileChoice = null;

/**
 * The stored choice, or `null` if none was made.
 *
 * Never throws: a browser with site data blocked throws on `getItem` itself, and
 * the honest answer there is "no choice was made".
 */
export function current() {
  if (volatileChoice) return volatileChoice;
  try {
    const stored = localStorage.getItem(LANG_KEY);
    return CHOICES.includes(stored) ? stored : null;
  } catch {
    return null;
  }
}

/**
 * Is this document being served from the Finnish address?
 *
 * ⚠️ BOTH SPELLINGS. `server/internal/api/client.go` answers `/fi` and `/fi/` with
 * the same page, because a person retyping an address from a message adds a
 * trailing slash about as often as not, and a 404 there is the whole feature
 * failing in the one situation it was built for.
 */
function addressAsksForFinnish(loc = globalThis.location) {
  const path = loc?.pathname;
  return path === FI_PATH || path === `${FI_PATH}/`;
}

/**
 * Does the browser's own list of languages contain Finnish?
 *
 * ⚠️⚠️ `fi` EXACTLY, OR A TAG THAT BEGINS `fi-`. NOT `startsWith("fi")`, which is
 * the obvious line to write and is wrong: **`fil` is Filipino**, a language with
 * some 45 million speakers and no relation to this one. A prefix test would hand
 * every Filipino phone a Finnish interface. BCP 47 subtags are delimited by `-`,
 * so that delimiter is what has to be tested for.
 *
 * ⚠️ `navigator.languages` rather than `navigator.language`, and any position in
 * it counts. A Finn whose phone is set to English but who has kept Finnish second
 * in the list is precisely the reader this whole exercise exists for.
 */
function browserAsksForFinnish(nav = globalThis.navigator) {
  const tags = nav?.languages?.length ? nav.languages : [nav?.language];
  return tags.some((tag) => {
    const t = String(tag ?? "").toLowerCase();
    return t === FI || t.startsWith(`${FI}-`);
  });
}

/**
 * The language this document is actually in — always one of the two, never null.
 *
 * ⚠️⚠️ THE ORDER IS THE DESIGN, so it is written out rather than left to be read
 * off the code:
 *
 *  1. **A choice made in this document.** The most recent thing the person did.
 *  2. **The address.** `/fi` beats a stored choice, and that is deliberate. The
 *     address was typed or tapped just now; the stored choice was made at some
 *     earlier time. It is also what makes the link safe for Hannu to send to
 *     anybody: it works the same way whatever the reader already has stored.
 *     ⚠️ And it does NOT overwrite what they had — see `choose()`. Coming back
 *     through the front door returns them to their own choice.
 *  3. **The stored choice.**
 *  4. **The browser's list.**
 *  5. **English**, which is the language the product is written in.
 */
export function resolve({ location = globalThis.location, navigator = globalThis.navigator } = {}) {
  if (volatileChoice) return volatileChoice;
  if (addressAsksForFinnish(location)) return FI;
  const stored = current();
  if (stored) return stored;
  return browserAsksForFinnish(navigator) ? FI : EN;
}

/**
 * Tell the document what language it is in.
 *
 * ⚠️ `lang` ON THE ROOT ELEMENT IS NOT DECORATION. A screen reader picks its voice
 * and its pronunciation rules from it; a browser decides whether to offer to
 * translate the page; CSS can answer it. `app.css` uses that last one to drop the
 * masthead gloss — *haamu is Finnish for ghost* — which exists to explain the name
 * to somebody who does not speak the language and is a tautology to somebody who
 * does. Hannu ruled it out of the Finnish version entirely.
 */
export function apply(lang) {
  const root = globalThis.document?.documentElement;
  if (!root) return;
  root.setAttribute("lang", lang === FI ? FI : EN);
}

/**
 * Choose, apply, and remember — unless this is Ghost mode, where nothing is
 * written.
 *
 * ⚠️ THE CALLER DECIDES WHETHER THIS IS GHOST MODE, as a parameter rather than an
 * import, because `app.js` owns that fact and importing it back would be a cycle.
 * ⚠️ AND THE APPLY HAPPENS EVEN IF THE WRITE FAILS: a person who has blocked site
 * data still reads the language they asked for, for this session.
 *
 * ⚠️⚠️ THE THIRD DEPARTURE FROM `theme.js`: THIS TOUCHES THE ADDRESS BAR. Choosing
 * English while standing on `/fi` leaves the address saying one thing and the page
 * saying another — and the address is not a passive label, it is an input to
 * `resolve()` and the thing that gets bookmarked. So the `/fi` is dropped at the
 * moment it stops being true. `history.replaceState` rather than a navigation,
 * because a navigation reloads, and a reload throws away `K_master` and asks a
 * signed-in person for their eight words again. §2.1's link-stripping in `app.js`
 * uses the same call for the same reason.
 */
export function choose(choice, { ghost = false } = {}) {
  if (!CHOICES.includes(choice)) throw new TypeError(`lang: unknown choice ${choice}`);
  volatileChoice = choice;
  apply(choice);

  if (choice !== FI && addressAsksForFinnish()) {
    try {
      globalThis.history?.replaceState(null, "", "/");
    } catch {
      // A browser that refuses `replaceState` still gets the language it asked
      // for; the address is merely stale. `volatileChoice` outranks it anyway.
    }
  }

  if (ghost) return;
  try {
    localStorage.setItem(LANG_KEY, choice);
  } catch {
    // Applied but not remembered — the next load guesses again, which is the same
    // outcome as never having chosen. No state is left half-written.
  }
}

/**
 * §7.8's endings.
 *
 * ⚠️ IT DOES NOT RE-RENDER, for `theme.js`'s reason: the thorough ending hands the
 * browser back, and changing the language of the page at that moment would be a
 * visible event with no meaning attached to it. The mark is gone; the next load
 * guesses.
 *
 * ⚠️ THE ORDINARY ENDING DOES NOT CALL THIS, and that is the same reasoning
 * `theme.js` records: a sign-out deliberately leaves §7.3.2's high-water mark, so
 * leaving an interface preference beside it keeps the same promise. Taking it
 * would mean somebody who signs out and back in on their own machine finds the
 * product speaking a different language for no reason they can name.
 */
export function forget() {
  volatileChoice = null;
  try {
    localStorage.removeItem(LANG_KEY);
  } catch {
    // Nothing was stored, so nothing needs removing.
  }
}

/**
 * For `test/lang.mjs` only: put the module back the way it starts.
 *
 * ⚠️ IT EXISTS BECAUSE `volatileChoice` IS MODULE STATE AND A TEST FILE IMPORTS
 * THE MODULE ONCE. Without it, the first `choose()` in the suite silently decides
 * the answer to every check after it — which is a test that passes for a reason
 * nobody chose. It is exported rather than reached through a back door so that
 * the cost of the module state is visible in the module.
 */
export function resetForTests() {
  volatileChoice = null;
}
