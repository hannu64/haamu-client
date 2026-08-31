/* The sample arguments every sentence-building function is rendered with — and the
 * check that they reach all of it.
 *
 * ⚠️⚠️ THIS FILE EXISTS BECAUSE THE REVIEW COUNTED PATHS AND A READER MEETS BRANCHES.
 * The Finnish translation closed at *"298 of 298 strings"*, and that was a true
 * statement about the wrong population. `copy.js` has thirteen sentences assembled at
 * runtime, several of them with a singular form, a plural form, or an entirely separate
 * sentence for zero — and the sheet the translators worked from rendered each PATH once,
 * with one sample argument. So *"no more sets — pick one of these"*, *"1 conversation is
 * missing from the list"* and the whole *behind*-the-server half of the clock warning
 * were never on any sheet, were never translated, and were reported missing by nothing,
 * because the completeness check compared path names.
 *
 * ➡️ **A BRANCH NO SAMPLE ARGUMENT REACHES HAS NO HOME TO BE REVIEWED IN** — which is
 * D-151's finding about a missing sentence, one level down: there the sentence did not
 * exist, here it exists and is unreachable by the instrument.
 *
 * ⭐ Two consumers, one table, on purpose. `test/copy.mjs` renders every prose rule over
 * these — so the forbidden-claims scan, D-016b's "they" allowlist and D-155's spelled-
 * quantity check now see the *behind* branch too, which none of them ever had. And
 * `extract-copy-en.mjs` builds the bilingual review sheet from the same table, so what a
 * translator is shown and what the gate checks cannot drift apart.
 *
 * ⚠️ A FUNCTION WITH NO ENTRY IS AN ERROR, never a silent omission, and an entry for a
 * path that no longer exists is an error too. Both are what `coverage()` returns.
 */

/**
 * By path, the argument lists to render with. Every branch of every function must be
 * reached by at least one of them — `coverage()` is what enforces that, so adding a
 * ternary to a sentence without adding a sample here fails the build.
 */
export const SAMPLES = {
  // ⚠️ D-085's build line. Two stamps that DIFFER, because `stale` renders both and a
  // sample that passed the same value twice would draw a sentence nobody can ever see.
  "diagnostics.proofAt": [[820, 20]],
  "diagnostics.build.asking": [["9b61457b8a287bd1"]],
  "diagnostics.build.failed": [["9b61457b8a287bd1"]],
  "diagnostics.build.current": [["9b61457b8a287bd1"]],
  "diagnostics.build.stale": [["9b61457b8a287bd1", "d3cbcfdaee75cd15"]],

  "chat.unreadable": [["a reason"]],
  "chat.reconnect.some": [[1], [3]],
  "deletion.confirmOne": [["Maija"]],
  "deletion.suspect": [[1], [3]],
  // ⛔⛔⛔ D-164 — THESE TWO WERE `"Pixel 6"`, AND BOTH CALL SITES PASS A DATE.
  // `app.js` renders them with `new Date(…).toLocaleDateString()`. The sheet the
  // translators worked from was built from THIS table, so twenty-seven rounds of
  // review — and every prose rule in `copy.mjs` — read *"No name yet · started
  // Pixel 6"*, which is not a sentence this product can produce.
  //
  // ⭐⭐⭐ AND THE FINNISH WAS THEN CORRECT FOR WHAT IT WAS SHOWN. A translator
  // reading *"started Pixel 6"* has to add a preposition to make it grammatical,
  // and the right one for a device is *laitteella* — so the list said *"started
  // WITH THE DEVICE 25.8.2026"* on a live screen for as long as the sentence has
  // existed. The English was right, the Finnish was right for the sample, and the
  // sample was wrong.
  //
  // ➡️ **THIS FILE'S OWN HEADER SAYS A BRANCH NO SAMPLE REACHES HAS NO HOME TO BE
  // REVIEWED IN. THE NEXT DEFECT IN IS A SAMPLE OF THE WRONG KIND: the sentence is
  // reviewable, everybody reviews it, and what they review is a fiction.** A sample
  // argument is not an example — it is a claim about what the call site passes.
  // ⭐ D-184 — the second slot is a CLOCK TIME, and `test/copy.mjs` enforces its shape the
  // way it enforces the date's. Finnish separates hours from minutes with a period, English
  // with a colon, so both are sampled: a reviewer must see the sentence each language builds.
  "list.unnamedOn": [
    ["25.8.2026", "9.05"],
    ["25/08/2026", "14:32"],
  ],
  "list.noHistory": [
    ["25.8.2026", 1],
    ["25.8.2026", 4],
  ],
  "list.nameUnresolved": [["Maija"]],
  "list.unexplained": [[1], [2]],
  "openLink.codeShort": [[9]],
  "openLink.codeLong": [[31]],
  "panic.told": [
    [1, 1],
    [3, 5],
  ],
  "phrase.setsLeft": [[0], [1], [4]],
  // ⚠️ Four, and each one is a corner the sheet had never shown: behind as well as ahead,
  // hours as well as minutes, and the singular unit. §7.3's skew is a measurement, so all
  // four are ordinary readings rather than edge cases.
  "roster.failure.clock_skew": [[200], [-200], [7200], [60]],
};

/**
 * The grammar helpers. They are exported so the checks can read them; they say nothing on
 * their own, and rendering them as sentences would put "1 minute" in the corpus as though
 * a person had read it somewhere.
 */
export const HELPERS = new Set(["span", "plural"]);

/**
 * ⚠️⚠️ EMPTY SINCE D-157, AND KEPT RATHER THAN DELETED. `clockSkew` used to be exported as
 * well as reachable through `roster.failure.clock_skew`, so walking the module found the same
 * sentence twice and this set was the workaround. D-157 made it private — **two paths for one
 * sentence is two homes for one sentence**, and a workaround that hides a duplicate is not a
 * fix for it. The set stays because the next alias is likelier than none, and an empty one is
 * an invitation to look at why rather than to add to it.
 */
export const ALIASES = new Set();

/**
 * Every static piece of text a function can put on a screen, read off its own source.
 *
 * ⭐ A BRANCH IS A DIFFERENT STRING LITERAL, which is what makes this work without a
 * coverage tool: render the function with every sample, and if one of its literals appears
 * in none of the results, no sample reaches it. Template literals are split on their
 * `${…}` holes so that each static chunk is checked separately.
 *
 * ⚠️ DOUBLE QUOTES ONLY. An apostrophe inside a template — *"This device's clock"* — makes
 * a single-quote scanner invent a literal that spans half the sentence, and then report it
 * unreached forever. The codebase is double-quoted throughout; a single-quoted string here
 * would be missed rather than mis-parsed, which is the safe direction.
 *
 * ⚠️ Chunks of three characters or fewer are dropped: they are the joins between holes
 * (`" "`, `" of "`) and are matched by everything.
 */
export function literalsOf(fn) {
  const src = fn.toString();
  const out = [];
  for (const m of src.matchAll(/`((?:[^`\\]|\\.)*)`/g)) for (const chunk of m[1].split(/\$\{[^{}]*\}/)) out.push(chunk);
  for (const m of src.matchAll(/"((?:[^"\\]|\\.)*)"/g)) out.push(m[1]);
  return out.map((s) => s.replace(/\\n/g, "\n").trim()).filter((s) => s.length > 3);
}

/**
 * Walk the module and render every sentence.
 *
 * Returns `{ rendered, missing, stale, unreached }`:
 *   · `rendered` — `[path, text, args]` for every branch of every function
 *   · `missing`  — function paths with no entry in `SAMPLES`
 *   · `stale`    — entries in `SAMPLES` for a path that is gone
 *   · `unreached`— `[path, literal]` for text no sample argument can produce
 */
export function coverage(copy) {
  const rendered = [];
  const missing = [];
  const unreached = [];
  const seen = new Set();

  const walk = (value, path) => {
    if (typeof value === "function") {
      if (HELPERS.has(path) || ALIASES.has(path)) return;
      seen.add(path);
      const sets = SAMPLES[path];
      if (!sets) {
        missing.push(path);
        return;
      }
      const out = [];
      for (const args of sets) {
        const text = value(...args);
        if (typeof text === "string") {
          out.push(text);
          rendered.push([path, text, args]);
        }
      }
      for (const literal of literalsOf(value)) {
        if (!out.some((text) => text.includes(literal))) unreached.push([path, literal]);
      }
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k);
    }
  };
  for (const [k, v] of Object.entries(copy)) walk(v, k);

  return { rendered, missing, stale: Object.keys(SAMPLES).filter((p) => !seen.has(p)), unreached };
}
