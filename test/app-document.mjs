// The rules `app/app.js` and `app/ended.js` have BECAUSE THEY TOUCH THE DOCUMENT —
// the address bar, the history entry, the tab's title.
//
// ⚠️⚠️ WHY THIS FILE EXISTS AT ALL. These rules had no home. `flow/*.js` never touches
// the document by design, so the flow suites cannot reach them; `copy.mjs` is about
// sentences; the `e2e-*` suites need a server and are exempted in the published tree,
// so a guard placed there would not run for the person who clones the public
// repository and types `./test.sh`. The 2026-08-24 outside review found two defects in
// exactly this gap — §2.1's strip and the ending page's title — and neither had a
// branch any sample reached.
//
// ⭐ EVERY CHECK HERE IS A SOURCE RULE, AND EACH ONE IS WRITTEN AS THE RULE RATHER
// THAN AS THE SHAPE OF THE BUG THAT PROMPTED IT. The same review found `copy.mjs`
// passing while `app.js` printed a raw exception, because that guard's pattern
// matched the four strings that were found when it was written — capitalised, double
// quoted, twelve characters — and not the rule it is labelled with. A guard that
// tests a shape tests the last bug. A guard that tests the rule tests the next one.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { check, equal, section, done } from "./harness.mjs";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

/**
 * Source with comments removed.
 *
 * ⚠️ FOR CODE RULES ONLY. `copy.mjs` deliberately does NOT do this, because a `//`
 * inside a sentence is prose and a regex that does not know the difference deletes
 * the rest of the line. Nothing checked here is prose: `location.href` and
 * `document.title` do not appear in anything a person reads.
 */
const code = (rel) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

// ═══════════════════════════════════════ §2.1 — the invite link and the address bar

section("§2.1 — the link is stripped in the same act as it is read");

{
  const src = code("../app/app.js");

  /**
   * ⚠️⚠️ THE RULE, NOT THE LINE. §2.1 says strip the fragment the moment it is read.
   * Until 2026-08-24 the strip lived in `runJoin`, which does not run until the
   * person has unlocked or CREATED a KEY — eight words to write down and an Argon2
   * to wait through — so `L` stayed in the address bar and the history entry for
   * minutes. Two early returns in `followLink` left it there indefinitely.
   *
   * So the rule is about WHERE THE READ IS, not about where a `replaceState` is:
   * the document's URL may be read in exactly one function, and that function
   * strips. Anything else that wants the link takes it from there.
   */
  const reads = [...src.matchAll(/location\.(href|hash)/g)].map((m) => m[0]);

  // The one function allowed to read it, isolated by brace depth from its opening.
  const start = src.indexOf("function takeLinkFromUrl()");
  check("`takeLinkFromUrl` exists — §2.1's read is a named act", start !== -1);

  let i = src.indexOf("{", start);
  let depth = 0;
  let end = i;
  do {
    if (src[end] === "{") depth++;
    else if (src[end] === "}") depth--;
    end++;
  } while (depth > 0 && end < src.length);
  const allowed = src.slice(start, end);

  const outside = reads.length - [...allowed.matchAll(/location\.(href|hash)/g)].length;
  equal(
    "⭐⭐ `app/app.js` reads the document's URL in ONE place and nowhere else",
    outside,
    0
  );

  check(
    "⭐⭐ and that one place strips before it returns the link",
    /location\.href[\s\S]*history\.replaceState[\s\S]*return link/.test(allowed)
  );

  /**
   * ⚠️ THE OTHER DIRECTION, WHICH IS HOW A RULE LIKE THIS ROTS. A `takeLinkFromUrl`
   * that nothing calls would satisfy every check above. The review found precisely
   * that shape one file over: `copy.product.endedTitle` is defined in both languages
   * and read by nothing, and the copy suites passed because being DEFINED was all
   * they asked. Being called is the half that matters.
   */
  const calls = [...src.matchAll(/takeLinkFromUrl\(\)/g)].length;
  check(`⭐ and it is CALLED — ${calls - 1} site(s) besides its own definition`, calls >= 3);
}

// ═══════════════════════════════════════════ §7.8 — the page the ending lands on

section("the ending page speaks the language the person was just reading (D-159)");

{
  const endedJs = code("../app/ended.js");
  const endedHtml = read("../app/ended.html");
  const copySrc = read("../src/ui/copy.js");
  const fiSrc = read("../src/ui/copy.fi.js");

  /**
   * ⚠️ THE TAB'S TITLE IS COPY, AND IT IS THE ONE PIECE OF THIS PAGE THAT LIVES IN
   * THE HTML. `ended.html` ships `<title>haamu — ended</title>` so the tab says
   * something before the module runs; `copy.product.endedTitle` exists in both
   * languages for what it says afterwards. Nothing joined them until 2026-08-24, so
   * a Finn who ended a session read the panels in Finnish under an English tab.
   */
  check("`product.endedTitle` is defined in English", /endedTitle:/.test(copySrc));
  check("`product.endedTitle` is translated", /"product\.endedTitle"/.test(fiSrc));
  check(
    "⭐⭐ and `ended.js` ASSIGNS it — defined is not the same as used",
    /document\.title\s*=\s*copy\.product\.endedTitle/.test(endedJs)
  );

  /**
   * ⚠️⚠️ A GLOSS THAT EXPLAINS A FINNISH WORD IS A TAUTOLOGY TO A FINN, and
   * `index.html` hides it on `html[lang="fi"]` for exactly that reason. `ended.html`
   * carried the same sentence with no such rule and nobody saw it, because the only
   * way to reach this page is to end a session and mean it.
   */
  const glossed = /class="gloss"/.test(endedHtml);
  check(
    "⭐ any masthead gloss on the ending page is hidden for Finnish, as on `index.html`",
    !glossed || /\[lang="fi"\][^{]*\.gloss|\.gloss[^{]*\[lang="fi"\]/.test(read("../app/ended.css"))
  );
}

done();
