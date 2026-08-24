/* D-139 — the theme choice: follow the phone, or override it.
 *
 * ⚠️ THE PRODUCT ANSWERED `prefers-color-scheme: dark` FROM LONG BEFORE THIS FILE,
 * and that is the fault this file fixes rather than the feature it adds. Hannu, who
 * has tested this product on a phone for weeks: *"I use haamu mainly on desktop
 * browser so there I do not have the dark mode. I now checked that in my phone there
 * is dark mode but I had not paid attention to that."* A preference that exists,
 * works, and cannot be found or named is one a person cannot rely on.
 *
 * Three choices, which is WhatsApp's own set: follow the device, light, dark.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️⚠️ WHERE THIS IS ALLOWED TO BE WRITTEN, AND WHY THAT IS NOT OBVIOUS.
 *
 * `PROTOCOL.md` §0's rule: *"if an implementation appears to need a construction not
 * in this document, that is a signal the spec is wrong — stop and ask, do not
 * invent."* The specification says nothing about interface preferences, because the
 * product has never had one. So the reasoning is written down here to be overturned
 * rather than assumed:
 *
 *  1. §7.6's Ghost mode rule is *"everything §7.8 calls CONVERSATION STATE lives in
 *     `sessionStorage` and nowhere else"*. A theme is not conversation state, so
 *     that rule does not reach it — but Ghost mode's PROMISE is that the browser is
 *     left as it was found, and a key that outlives the session breaks the promise
 *     without breaking the rule. **Ghost mode therefore never writes.** It applies a
 *     choice already stored, and a choice made inside it lasts as long as the tab.
 *
 *  2. §7.8's THOROUGH ending clears it; the ordinary one does not. It is not a
 *     secret and it identifies nobody, but it is a durable mark saying *this browser
 *     has used haamu*, and the thorough ending's own control promises to take the
 *     whole origin. ⚠️ The ordinary ending deliberately LEAVES §7.3.2's high-water
 *     mark, so leaving an interface preference beside it keeps the same promise —
 *     and taking it would mean somebody who signs out and back in on their own
 *     machine finds the colours changed for no reason they can name.
 *
 *  3. It is written in the clear, deliberately. The alternative is sealing it under
 *     `local_key` — which would make it unreadable until after the passphrase is
 *     entered, so the gate, the setup wizard and the unlock screen would all paint
 *     in the wrong theme and then jump. A preference that cannot be applied before
 *     the thing it applies to is not a preference.
 * ────────────────────────────────────────────────────────────────────────────*/

/**
 * ⚠️⚠️ DUPLICATED, ON PURPOSE AND UNDER GUARD, in `app/theme-boot.js`.
 * That file is a classic render-blocking script and cannot import — see its header
 * for why it must be one. `test/theme.mjs` asserts the two literals are identical,
 * because a drifted key does not throw: it silently stops finding the preference,
 * which looks exactly like never having set one.
 */
export const THEME_KEY = "haamu.theme";

/** The three choices, and the only three strings that may be stored. */
export const SYSTEM = "system";
export const LIGHT = "light";
export const DARK = "dark";
export const CHOICES = [SYSTEM, LIGHT, DARK];

/**
 * Ghost mode's choice, for as long as the tab lives.
 *
 * ⚠️ IN MEMORY RATHER THAN IN `sessionStorage`, which would have been the obvious
 * place. §7.6 puts conversation state there and nothing else, and a tab that
 * reloads in Ghost mode has already lost the conversation — so a theme surviving
 * that reload would outlive the thing it was chosen for. A module variable dies
 * with the document, which is exactly the lifetime wanted.
 */
let volatile = null;

/**
 * Read the stored choice. Never throws: a browser with site data blocked throws on
 * `getItem` itself, and the honest answer there is "no choice was made".
 */
export function current() {
  if (volatile) return volatile;
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return CHOICES.includes(stored) ? stored : SYSTEM;
  } catch {
    return SYSTEM;
  }
}

/**
 * Paint the document in `choice`.
 *
 * ⚠️ `SYSTEM` REMOVES THE ATTRIBUTE RATHER THAN SETTING IT TO ANYTHING. `app.css`
 * guards its dark media query with `:root:not([data-theme="light"])` and gives the
 * explicit choices their own blocks; an attribute reading `"system"` would match
 * none of them, which is correct only by accident. Removing it is the state the
 * stylesheet is actually written for.
 */
export function apply(choice) {
  const root = globalThis.document?.documentElement;
  if (!root) return;
  if (choice === LIGHT || choice === DARK) root.setAttribute("data-theme", choice);
  else root.removeAttribute("data-theme");
}

/**
 * Choose, paint, and remember — unless this is Ghost mode, where nothing is written.
 *
 * ⚠️ THE CALLER DECIDES WHETHER THIS IS GHOST MODE, and it is a parameter rather
 * than an import because `app.js` owns that fact and importing it back would be a
 * cycle. ⚠️ AND THE PAINT HAPPENS EVEN IF THE WRITE FAILS: a person who has blocked
 * site data still gets the theme they asked for, for this session. Reversing those
 * two lines would make a storage failure look like a dead button.
 */
export function choose(choice, { ghost = false } = {}) {
  if (!CHOICES.includes(choice)) throw new TypeError(`theme: unknown choice ${choice}`);
  apply(choice);
  if (ghost) {
    volatile = choice;
    return;
  }
  volatile = null;
  try {
    if (choice === SYSTEM) localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch {
    // Applied but not remembered. The next load follows the phone again, which is
    // the same outcome as never having chosen — no state is left half-written.
  }
}

/**
 * §7.8's endings. ⚠️ IT DOES NOT REPAINT: "end here" hands the browser back, and
 * yanking the page from dark to light at that moment would be a visible event
 * with no meaning attached to it. The mark is gone; the next load follows the phone.
 */
export function forget() {
  volatile = null;
  try {
    localStorage.removeItem(THEME_KEY);
  } catch {
    // Nothing was stored, so nothing needs removing.
  }
}
