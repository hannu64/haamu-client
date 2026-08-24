/* D-139's theme — the guards for the two duplications it introduced.
 *
 * ⚠️⚠️ THIS FILE EXISTS BECAUSE THE FEATURE COULD NOT BE BUILT WITHOUT COPYING TWO
 * THINGS, and a copy that nothing compares is a copy that will differ. Both are
 * silent failures: neither throws, neither logs, and both look from the outside
 * exactly like a person who never set a preference.
 *
 *   1. `THEME_KEY` is in `src/ui/theme.js` and again in `app/theme-boot.js`, which
 *      is a classic render-blocking script and therefore cannot import. A drifted
 *      key means the boot script reads nothing and the page flashes the wrong theme
 *      on every load, for exactly as long as nobody happens to look.
 *
 *   2. `app.css` carries the dark palette twice — once under
 *      `@media (prefers-color-scheme: dark)` and once under `:root[data-theme="dark"]`
 *      — because CSS has no way to write one block that answers both, and this
 *      project has no build step to generate it. A token that is updated in one and
 *      not the other gives two DIFFERENT dark themes, and which one a person sees
 *      depends on whether they used the switch. That is the worst possible way for
 *      a colour to be wrong: it is correct on the tester's screen.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { check, equal, section, done } from "./harness.mjs";
import { THEME_KEY, CHOICES, SYSTEM, LIGHT, DARK } from "../src/ui/theme.js";

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const boot = read("../app/theme-boot.js");
const html = read("../app/index.html");

/**
 * ⚠️⚠️ COMMENTS ARE STRIPPED BEFORE ANYTHING IS SEARCHED FOR, AND THE FIRST VERSION
 * OF THIS FILE DID NOT DO IT — which is how it reported the light palette as the
 * media query's contents. `app.css` explains its own four-block structure in a
 * comment at the top, so the literal text `@media (prefers-color-scheme: dark)`
 * appears there before it appears as a rule; `search` found the prose, and the next
 * `{` after the prose is the LIGHT block's.
 *
 * ⭐ The failure was loud only because the two blocks then had different token
 * counts. Had the comment sat somewhere slightly different, this file would have
 * compared the light palette against itself and passed for ever.
 */
const cssRaw = read("../app/app.css");
const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, "");

section("the key that two files have to agree on");

// ⚠️ THE ASSERTION IS ON THE LITERAL IN THE FILE, NOT ON ANYTHING IMPORTED FROM IT.
// `theme-boot.js` is a classic script — importing it here would either fail or run
// it, and running it is not what is being checked. What is being checked is that a
// person editing one file and not the other is caught.
const bootKey = boot.match(/THEME_KEY\s*=\s*"([^"]+)"/)?.[1];
equal("⭐⭐ `app/theme-boot.js` stores under the same key as `src/ui/theme.js`", bootKey, THEME_KEY);

check(
  "⚠️ and the boot script writes only the attribute `app.css` actually answers",
  /setAttribute\("data-theme",/.test(boot) && !/setAttribute\("data-theme",\s*"system"/.test(boot),
  "data-theme"
);
check(
  "⚠️⚠️ it applies only the two EXPLICIT choices — anything else must mean follow the phone",
  /choice === "light" \|\| choice === "dark"/.test(boot),
  "an unrecognised value stamped on <html> would match no rule and leave the page unpainted"
);
check(
  "⚠️ and it cannot throw on a browser with site data blocked",
  /try\s*\{[\s\S]*localStorage[\s\S]*\}\s*catch/.test(boot)
);

section("the boot script is loaded in a way that can actually beat the first paint");

check(
  "⭐⭐⭐ it is in <head> — after that, the page has already been painted in the wrong theme",
  /<head>[\s\S]*theme-boot\.js[\s\S]*<\/head>/.test(html)
);
check(
  "⚠️⚠️ and it is NOT `type=\"module\"` — a module is deferred, which is the whole fault",
  /<script src="\/app\/theme-boot\.js"><\/script>/.test(html),
  "`type=module` would defer it past the first paint and reintroduce the flash"
);
check(
  "⚠️ it has a `src`, so `script-src 'self'` and the Go CSP guard both permit it",
  !/<script(?![^>]*\bsrc=)[^>]*>/.test(html.replace(/<!--[\s\S]*?-->/g, ""))
);

section("⭐⭐⭐ the dark palette is written twice and the two copies must be identical");

/** Every `--token: value;` inside one CSS block, as a map. */
function tokensIn(block) {
  const out = new Map();
  for (const m of block.matchAll(/(--[a-z-]+)\s*:\s*([^;]+);/g)) out.set(m[1], m[2].trim());
  return out;
}

/** The body of the first block whose selector line matches `pattern`. */
function blockAfter(pattern) {
  const at = css.search(pattern);
  if (at < 0) return null;
  const open = css.indexOf("{", at);
  // ⚠️ BRACE COUNTING, NOT `indexOf("}")`. The media query wraps a `:root` block, so
  // the first closing brace after it is the INNER one — a naive search reads the
  // media copy as empty and this whole section passes by finding nothing.
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  return null;
}

const light = tokensIn(blockAfter(/^:root \{/m) ?? "");
const media = tokensIn(blockAfter(/@media \(prefers-color-scheme: dark\)/) ?? "");
// ⚠️ THERE ARE TWO `:root[data-theme="dark"]` BLOCKS AND THIS MUST FIND THE PALETTE
// ONE. The second exists only to set `color-scheme`, and matching it instead would
// compare a 27-token block against a 1-token block — a failure, but for the wrong
// reason, which is a test that lies about what is broken.
const explicit = tokensIn(blockAfter(/:root\[data-theme="dark"\]\s*\{\s*--/) ?? "");

check("the light palette is defined on a bare `:root`", light.size > 10, `${light.size} tokens`);
check("the media query redefines a dark palette", media.size > 10, `${media.size} tokens`);
check("and so does the explicit `[data-theme=\"dark\"]`", explicit.size > 10, `${explicit.size} tokens`);

equal(
  "⭐⭐⭐ the two dark blocks declare exactly the same tokens",
  [...media.keys()].sort().join(","),
  [...explicit.keys()].sort().join(",")
);

const differing = [...media].filter(([k, v]) => explicit.get(k) !== v).map(([k]) => k);
equal(
  "⭐⭐⭐ …and give every one of them the same value",
  differing.join(" | "),
  "",
  "A token updated in one dark block and not the other means two different dark themes, " +
    "and which one a person sees depends on whether they used the switch."
);

// ⚠️ THE DIRECTION THAT MATTERS. A token defined ONLY in a dark block renders as
// nothing at all in light — `var(--x)` with no fallback is the empty string — and
// the light theme is the one this project's author does not use day to day, so it
// is the one where a hole survives longest.
const orphans = [...media.keys()].filter((k) => !light.has(k));
equal(
  "⚠️⚠️ no colour has its ONLY definition inside a dark block",
  orphans.join(" | "),
  "",
  "Declare it on the bare `:root` first; the dark blocks may only REdeclare."
);

section("the switch has to beat the phone in both directions");

check(
  "⭐⭐ the media query is guarded, so an explicit LIGHT choice wins on a dark phone",
  /@media \(prefers-color-scheme: dark\)\s*\{\s*:root:not\(\[data-theme="light"\]\)/.test(css),
  "an unguarded `:root` inside the media query cannot be overridden by an attribute"
);
check(
  "⚠️ and `color-scheme` is set for BOTH explicit choices, or the browser paints its own furniture dark",
  /:root\[data-theme="light"\]\s*\{\s*color-scheme: light;/.test(css) &&
    /:root\[data-theme="dark"\]\s*\{\s*color-scheme: dark;/.test(css)
);

section("§2.1.2 rule 7 — the theme must not have reached the QR symbol");

const qrRule = css.slice(css.indexOf(".qr {"), css.indexOf("}", css.indexOf(".qr {")));
check(
  "⚠️⚠️ `.qr` still names no colour, on a page that now has a switch as well as a media query",
  !/var\(--|color|background/.test(qrRule),
  "a token here inverts the symbol on a dark page, which is outside ISO/IEC 18004"
);

section("the three choices");

equal("`CHOICES` is exactly the three the menu offers", CHOICES.join(","), [SYSTEM, LIGHT, DARK].join(","));
check(
  "⚠️ and `system` is not a value that ever reaches the DOM",
  !new RegExp(`data-theme="${SYSTEM}"`).test(css) && !new RegExp(`data-theme="${SYSTEM}"`).test(html)
);

done();
