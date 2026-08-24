/* D-158. Put the Finnish into `ui/copy.js`, or take it out again.
 *
 * ⚠️⚠️ WHY THE COPY IS MUTATED IN PLACE RATHER THAN LOOKED UP. `copy.js` is reached by 282
 * call sites — `copy.pairing.code.keep.kept`, `copy.terms["invite-link"].body[1]` — and the
 * obvious design is a lookup: `t("pairing.code.keep.kept")` everywhere, with a table per
 * language behind it. That is the right shape for a product built with two languages in
 * mind. It is the wrong shape for this one, because it means touching 282 lines of
 * `app.js` to ship a translation, and **every one of those lines is a chance to put the
 * wrong sentence on a screen** in a product where the sentences are warnings. The rule in
 * PROTOCOL.md §0 points the same way: this is not a construction the specification asks
 * for, and the smallest change that does the job is the one to make.
 *
 * ⭐⭐ SO: `import * as copy` GIVES A NAMESPACE WHOSE PROPERTIES ARE READ-ONLY AND WHOSE
 * OBJECTS ARE NOT. `copy.chat = …` is refused by the language itself; `copy.chat.send = …`
 * is an ordinary property write on an ordinary object. Every sentence in `copy.js` lives
 * under one of the twenty-two object exports — checked, not assumed, by `test/copy-fi.mjs`
 * — so every sentence can be replaced without a single call site changing.
 *
 * ⚠️⚠️ AND THE ENGLISH IS KEPT, WHICH IS WHAT MAKES THE SWITCH REVERSIBLE. The first time a
 * path is overwritten its English value is captured here; going back to English writes the
 * captured value, not a re-import. That matters more than it sounds: **the switch must
 * never reload the page.** `K_master` lives in memory and nowhere else, so a reload asks a
 * signed-in person for their eight words again — a language toggle that logs you out is
 * not a language toggle. Everything here is synchronous and in-memory for that reason.
 *
 * ⚠️ THE STRINGS ARE REPLACED, NOT RE-RENDERED. Whoever calls `setLanguage` is responsible
 * for drawing the screen again; this module knows nothing about the document. `app.js`
 * does it in one place, so the two cannot drift.
 */

/**
 * ⚠️⚠️ A STATIC IMPORT, WHICH MEANS EVERY READER FETCHES THE FINNISH — measured rather than
 * assumed, because it is the kind of thing that gets asserted either way. `copy.fi.js` is
 * 44 KB on disk and **14.5 KB over the wire**; Caddy answers `content-encoding: gzip` for
 * this tree, and `copy.js` beside it is 58 KB compressed. So the Finnish is a quarter again
 * on top of the copy a page already fetches, and `haamu.app` sends `cache-control:
 * no-store`, so it is a quarter again on EVERY load.
 *
 * ⭐ A dynamic `import()` inside `setLanguage` would spend nothing on an English reader.
 * It is not what this does, for two reasons and neither is convenience. **The people this
 * round is for are the Finnish ones** — Hannu's friends — so a design that makes them pay a
 * round trip to save the English readers 14.5 KB has the priority backwards. And it would
 * make `setLanguage` async, which puts a new await in the boot path and in the switch: the
 * one place D-154 spent its whole effort keeping free of a flash, and the one place a
 * reload would cost a signed-in person their eight words.
 *
 * ⚠️ Revisit it with a measurement, not with an opinion: three lines here and one `await`
 * in `app.js` is the whole change, and the number to beat is 14.5 KB.
 */
import * as copy from "./copy.js";
import { FI, FI_BUILT } from "./copy.fi.js";

export const EN = "en";
export const FI_LANG = "fi";
export const LANGUAGES = [EN, FI_LANG];

/** Which language the objects in `copy.js` are currently holding. */
let holding = EN;

/** Path → the English value, captured the first time that path is overwritten. */
const english = new Map();

/**
 * Paths in the Finnish that `copy.js` has no slot for.
 *
 * ⚠️⚠️ IT IS A LIST RATHER THAN A THROW, AND THE TWO FAILURE MODES ARE WHY. `test/copy-fi.mjs`
 * fails the build if this is ever non-empty, so in a shipped client it cannot be — but if it
 * somehow were, the choice at runtime is between one English sentence on a Finnish page and a
 * white screen where the application used to be. A language control may not be able to break
 * the product. ⭐ Exported so the check can read it rather than infer it.
 */
export const unmatched = [];

/**
 * The object and key a path names, or `null` if `copy.js` has no such slot.
 *
 * ⚠️ `in` rather than a truthiness test: a path whose value is an empty string is a real
 * slot, and `"1" in someArray` is how an array index is asked about.
 */
function slotFor(path) {
  const parts = path.split(".");
  const key = parts.pop();
  let node = copy;
  for (const part of parts) {
    node = node?.[part];
    if (node === null || typeof node !== "object") return null;
  }
  return node && key in node ? [node, key] : null;
}

/** Every Finnish sentence, plain and built alike, as one list of `[path, value]`. */
const finnish = [...Object.entries(FI), ...Object.entries(FI_BUILT)];

/**
 * Put `copy.js` into one language and return the language it is now in.
 *
 * Calling it with the language already held does nothing at all — not even the walk — so a
 * boot that resolves to English costs one comparison.
 */
export function setLanguage(language) {
  if (!LANGUAGES.includes(language)) throw new TypeError(`copy-language: unknown language ${language}`);
  if (language === holding) return holding;

  unmatched.length = 0;
  for (const [path, value] of finnish) {
    const slot = slotFor(path);
    if (!slot) {
      unmatched.push(path);
      continue;
    }
    const [node, key] = slot;
    if (!english.has(path)) english.set(path, node[key]);
    node[key] = language === FI_LANG ? value : english.get(path);
  }
  holding = language;
  return holding;
}

/** Which language `copy.js` is holding right now. */
export function held() {
  return holding;
}

/**
 * For the tests only: forget everything and go back to English.
 *
 * ⚠️ It exists for `test/copy-fi.mjs`'s reason, which is `theme.js`'s and `lang.js`'s: this
 * module has state, a test file imports it once, and without a way back the first switch
 * decides the answer to every check after it.
 */
export function resetForTests() {
  setLanguage(EN);
  english.clear();
  unmatched.length = 0;
}
