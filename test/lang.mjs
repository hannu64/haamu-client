/* D-154's interface language — the guard for the duplication it introduced.
 *
 * ⚠️⚠️ THE DUPLICATION IS BIGGER THAN THE THEME'S, AND THAT CHANGES WHAT A GUARD
 * HAS TO BE. `app/theme-boot.js` copies one string out of `src/ui/theme.js`, so
 * `test/theme.mjs` compares two literals and is done. `app/lang-boot.js` copies a
 * **decision**: four inputs — a choice made in this document, the address, the
 * stored choice, the browser's own list — in a deliberate order, with a delimiter
 * test inside one of them. Two implementations of a decision can agree on every
 * literal in both files and still disagree on an answer.
 *
 * ➡️ So this file does not compare text. It RUNS BOTH against the same matrix of
 * situations and fails if they ever conclude differently. `app/lang-boot.js` is a
 * classic script, which is exactly why it can be run here: it has no imports, so
 * wrapping its source in a function with the four globals as parameters is enough
 * to execute it with a made-up browser around it.
 *
 * ⚠️ WHAT THIS CANNOT SHOW, said plainly rather than left to be assumed: that the
 * boot script beats the first paint. That is a property of where the `<script>`
 * tag sits, and it is checked as markup at the foot of this file — not observed.
 *
 * ⭐ ONE SITUATION IS DELIBERATELY ABSENT FROM THE MATRIX: a document with no
 * `navigator` at all. `src/ui/lang.js` survives it (`nav?.languages`) and the boot
 * script does not, so including it would report a disagreement about a browser
 * that does not exist. The optional chaining in the module is there for Node, not
 * for a browser, and the two files are only required to agree about browsers.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { check, equal, section, done } from "./harness.mjs";
import * as lang from "../src/ui/lang.js";

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");
const boot = read("../app/lang-boot.js");
const html = read("../app/index.html");
const css = read("../app/app.css");
const appjs = read("../app/app.js");
const ended = read("../app/ended.js");

/* ── the two implementations, each behind one call ───────────────────────── */

/**
 * Run `app/lang-boot.js` inside a made-up browser and return what it stamped.
 *
 * ⚠️ THE FOUR NAMES ARE PARAMETERS, WHICH IS WHAT MAKES THIS HONEST. The boot
 * script reads `location`, `localStorage`, `navigator` and `document` as free
 * variables; as parameters they shadow anything Node happens to define under the
 * same names, so the script cannot accidentally be answered by the real
 * environment instead of by the situation being tested.
 */
function bootAnswer({ store, location, navigator }) {
  const root = {
    lang: null,
    setAttribute(name, value) {
      if (name === "lang") this.lang = value;
    },
  };
  // eslint-disable-next-line no-new-func
  new Function("localStorage", "location", "navigator", "document", boot)(store, location, navigator, {
    documentElement: root,
  });
  return root.lang;
}

/**
 * Ask `src/ui/lang.js` the same question.
 *
 * ⚠️ `resetForTests()` FIRST, EVERY TIME. `volatileChoice` is module state and this
 * file imports the module once; without the reset the first `choose()` below would
 * silently decide the answer to every case after it.
 */
function moduleAnswer({ store, location, navigator }) {
  lang.resetForTests();
  globalThis.localStorage = store;
  return lang.resolve({ location, navigator });
}

/* ── the matrix ──────────────────────────────────────────────────────────── */

const throwing = {
  getItem() {
    // A browser with cookies and site data blocked throws on `getItem` itself
    // rather than returning null. Both files have to survive it.
    throw new DOMException("The operation is insecure.", "SecurityError");
  },
  setItem() {
    throw new DOMException("The operation is insecure.", "SecurityError");
  },
  removeItem() {},
};

const fixed = (value) => ({ getItem: () => value, setItem() {}, removeItem() {} });

const STORES = [
  ["nothing stored", fixed(null)],
  ["stored en", fixed("en")],
  ["stored fi", fixed("fi")],
  ["stored garbage", fixed("sv")],
  // ⚠️ Wrong case is garbage, not Finnish. Both files compare exactly; if one of
  // them ever grows a `toLowerCase()` here and the other does not, this catches it.
  ["stored FI", fixed("FI")],
  ["stored empty string", fixed("")],
  ["storage throws", throwing],
  ["no storage object at all", undefined],
];

const PATHS = ["/", "/fi", "/fi/", "/c", "/ended", "/fi/x", "/finland", "/FI"];

const NAVIGATORS = [
  ["no languages", { languages: [], language: undefined }],
  ["en-US", { languages: ["en-US", "en"], language: "en-US" }],
  ["fi", { languages: ["fi"], language: "fi" }],
  ["fi-FI", { languages: ["fi-FI", "en"], language: "fi-FI" }],
  // ⚠️⚠️ THE TRAP, AND IT IS IN THE MATRIX BECAUSE IT IS THE LINE BOTH FILES WOULD
  // OTHERWISE HAVE WRITTEN. `fil` is Filipino — some 45 million speakers, no
  // relation to Finnish — and `startsWith("fi")` hands every one of those phones
  // a Finnish interface.
  ["fil-PH (Filipino)", { languages: ["fil-PH"], language: "fil-PH" }],
  ["sv-FI then fi-FI", { languages: ["sv-FI", "fi-FI"], language: "sv-FI" }],
  ["languages absent, language fi-FI", { languages: undefined, language: "fi-FI" }],
  ["languages absent, language en", { languages: undefined, language: "en" }],
  ["FI-fi (odd case)", { languages: ["FI-fi"], language: "FI-fi" }],
];

const CASES = STORES.length * PATHS.length * NAVIGATORS.length;

section("⭐⭐⭐ the boot script and the module decide the same thing, or the page lies about its language");

const disagreements = [];
for (const [storeName, store] of STORES) {
  for (const path of PATHS) {
    for (const [navName, navigator] of NAVIGATORS) {
      const situation = { store, location: { pathname: path }, navigator };
      const fromBoot = bootAnswer(situation);
      const fromModule = moduleAnswer(situation);
      if (fromBoot !== fromModule) {
        disagreements.push(`${path} · ${storeName} · ${navName} → boot ${fromBoot}, module ${fromModule}`);
      }
    }
  }
}

equal(
  `⭐⭐⭐ all ${CASES} situations get the same answer from both files`,
  disagreements.slice(0, 6).join("\n          "),
  ""
);
check(`  (${CASES} situations: ${STORES.length} stores × ${PATHS.length} addresses × ${NAVIGATORS.length} browsers)`, true);

// ⚠️ THE GUARD ON THE GUARD. An empty disagreement list means "they agree" only if
// the matrix ran. A typo that emptied one of the three lists would leave this file
// reporting agreement about nothing at all — the D-153 failure exactly, where a
// check passed for years on a property nobody had chosen.
check("⚠️ …and the matrix is not empty", CASES > 100, `${CASES} situations`);

// ⚠️ AND THE NUMBER IN THE PROSE IS THE NUMBER THE CODE COMPUTES. Both source files
// tell a reader how many situations this runs; a count written into a comment is a
// copy of a decision made somewhere else, which is the whole reason `test/copy.mjs`
// exists. Here the copies are in code comments rather than in shipped English, and
// they rot the same way.
const claimed = (src) => src.match(/same (\d+) situations/)?.[1];
equal("⚠️ `src/ui/lang.js` states the real size of that matrix", claimed(read("../src/ui/lang.js")), String(CASES));
equal("⚠️ `app/lang-boot.js` states the real size of that matrix", claimed(boot), String(CASES));

section("the order of the four inputs, named one at a time");

const ask = (path, stored, tags) =>
  moduleAnswer({
    store: fixed(stored),
    location: { pathname: path },
    navigator: { languages: tags, language: tags[0] },
  });

equal("English is what a browser that asks for nothing gets", ask("/", null, ["en-US"]), "en");
equal("⭐ a Finnish browser gets Finnish without anybody choosing", ask("/", null, ["fi-FI"]), "fi");
equal("⭐⭐ `/fi` gets Finnish on an English phone — the case the browser cannot serve", ask("/fi", null, ["en-US"]), "fi");
equal("⚠️ and `/fi/` does too, because that is how addresses get retyped", ask("/fi/", null, ["en-US"]), "fi");
equal("a stored choice beats the browser", ask("/", "en", ["fi-FI"]), "en");
equal(
  "⭐⭐ …but the address beats the stored choice: it is the more recent act",
  ask("/fi", "en", ["en-US"]),
  "fi"
);
equal("⚠️⚠️ `fil-PH` is Filipino and must not get a Finnish page", ask("/", null, ["fil-PH"]), "en");
equal("`/finland` is not the Finnish address", ask("/finland", null, ["en-US"]), "en");
equal("neither is `/FI`", ask("/FI", null, ["en-US"]), "en");

section("choosing: what is remembered, what is not, and what happens to the address");

/** A `localStorage` that really stores, so `choose()` can be watched writing. */
function spyStore() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

/** A document and a history that record what was done to them. */
function browser(path = "/") {
  const root = { attrs: {}, setAttribute(n, v) { this.attrs[n] = v; } };
  const loc = { pathname: path };
  globalThis.document = { documentElement: root };
  globalThis.location = loc;
  globalThis.history = {
    replaceState(_state, _title, url) {
      loc.pathname = url;
    },
  };
  return { root, loc };
}

{
  lang.resetForTests();
  const store = spyStore();
  globalThis.localStorage = store;
  const { root } = browser("/");
  lang.choose(lang.FI);
  equal("choosing Finnish stamps the document", root.attrs.lang, "fi");
  equal("…and writes it down", store.getItem(lang.LANG_KEY), "fi");
}

{
  lang.resetForTests();
  const store = spyStore();
  globalThis.localStorage = store;
  browser("/");
  lang.choose(lang.FI, { ghost: true });
  equal(
    "⭐⭐ §7.6 — Ghost mode applies the choice and writes NOTHING",
    store.getItem(lang.LANG_KEY),
    null
  );
  equal("…and it still holds for this document", lang.resolve({ location: { pathname: "/" }, navigator: { languages: ["en"] } }), "fi");
}

{
  lang.resetForTests();
  globalThis.localStorage = spyStore();
  const { loc } = browser("/fi");
  lang.choose(lang.EN);
  equal(
    "⭐⭐⭐ choosing English on `/fi` drops the `/fi` — the address is an input, not a label",
    loc.pathname,
    "/"
  );
  equal(
    "⚠️ …and the choice outranks the address even before that lands",
    lang.resolve({ location: { pathname: "/fi" }, navigator: { languages: ["fi"] } }),
    "en"
  );
}

{
  lang.resetForTests();
  globalThis.localStorage = spyStore();
  const { loc } = browser("/fi");
  lang.choose(lang.FI);
  equal("choosing Finnish on `/fi` leaves the address alone — it agrees", loc.pathname, "/fi");
}

{
  lang.resetForTests();
  globalThis.localStorage = throwing;
  const { root } = browser("/");
  lang.choose(lang.FI);
  equal(
    "⚠️⚠️ a browser that refuses storage still gets the language it asked for",
    root.attrs.lang,
    "fi"
  );
}

{
  lang.resetForTests();
  const store = spyStore();
  store.setItem(lang.LANG_KEY, "fi");
  globalThis.localStorage = store;
  lang.forget();
  equal("§7.8's thorough ending takes the mark", store.getItem(lang.LANG_KEY), null);
  equal(
    "…and the next read guesses again",
    lang.resolve({ location: { pathname: "/" }, navigator: { languages: ["en-GB"] } }),
    "en"
  );
}

{
  lang.resetForTests();
  globalThis.localStorage = spyStore();
  browser("/");
  let threw = false;
  try {
    lang.choose("sv");
  } catch {
    threw = true;
  }
  check("⚠️ an unknown choice throws rather than being stored", threw);
}

section("the two choices, and no third");

equal("`CHOICES` is exactly the two the switch offers", lang.CHOICES.join(","), "en,fi");
check(
  "⭐ there is no `follow the browser` value that could reach the DOM",
  !lang.CHOICES.includes("browser") && !/lang="(browser|system)"/.test(html),
  "a language does not change at dusk; the theme's third choice has no counterpart here"
);

section("⚠️ the boot script must stay a classic script that cannot import");

check("it declares no import", !/^\s*import\s/m.test(boot));
check("…and no export", !/^\s*export\s/m.test(boot));
check(
  "⚠️ it is an IIFE, so it leaks no name into the page's global scope",
  /^\(function \(\) \{/m.test(boot) && /\}\)\(\);\s*$/.test(boot)
);
check("⚠️ and it cannot throw on a browser with site data blocked", /try\s*\{[\s\S]*localStorage[\s\S]*\}\s*catch/.test(boot));

const bootKey = boot.match(/LANG_KEY\s*=\s*"([^"]+)"/)?.[1];
equal("⭐⭐ it stores under the same key as `src/ui/lang.js`", bootKey, lang.LANG_KEY);

// ⚠️ RENDER-BLOCKING MEANS EVERY BYTE IS PAID BY EVERYBODY, including the people
// who only ever read English. `theme-boot.js`'s header sets the rule; this is the
// only place it can be enforced. The figure is code, not prose: it is what the two
// existing boot scripts weigh, rounded to something a person can hold in mind.
const bootCode = boot.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").trim();
check(
  "⚠️⚠️ …and it stays tiny — it blocks the first paint for every visitor",
  bootCode.length < 1200,
  `${bootCode.length} bytes of code`
);

section("⭐ the wiring is all-or-nothing");

/*
 * ⚠️⚠️ THIS SECTION WAS WRITTEN WHEN NONE OF THE THREE WERE TRUE, BECAUSE A PASSING
 * SUITE MUST NOT READ AS "SHIPPED". The boot script existed and nothing loaded it,
 * because `src/ui/copy.js` had no Finnish in it — and a page that stamps `lang="fi"`
 * while every sentence on it is English is worse than a page that admits it is
 * English: it tells a screen reader to read English aloud in Finnish, and it makes a
 * browser offer to translate a page already in the reader's language.
 *
 * ⭐ ALL THREE ARE TRUE SINCE D-159, AND THE CHECK DID NOT HAVE TO BE REWRITTEN TO SAY
 * SO, which is the whole reason it was phrased this way. It never asked "is it wired";
 * it asks "are the three halves in the same state", and that question is the one worth
 * asking in both directions. Removing any one of them now fails here rather than in
 * front of a reader.
 */
const loaded = /lang-boot\.js/.test(html);
const glossRule = /html\[lang="fi"\][\s\S]{0,80}\.gloss|\.gloss[\s\S]{0,80}html\[lang="fi"\]/.test(css);

/*
 * ⭐⭐ A THIRD HALF, SINCE D-158. The Finnish sentences and the switch that puts them into
 * `copy.js` now exist, and nothing calls it — so there is one more state the three parts
 * can be in disagreement about. Adding it here rather than writing a note is the same
 * bargain the section is built on: **the thing that remembers has to be the thing that
 * fails.** All three false today; all three true when D-154 finishes; any one alone is a
 * page in the wrong language, or a page whose sentences are Finnish and whose `<html lang>`
 * says English.
 */
/**
 * ⚠️⚠️ IT LOOKS FOR AN INVOCATION AT BOOT, AND IT TOOK TWO GOES TO GET THERE. Both of
 * the wrong versions were written on 2026-08-24 and both were caught within the hour,
 * by the only method that catches them: comment the call out, run the check, see what
 * it says.
 *
 *  1. `/setLanguage\(/.test(src)` — satisfied by the IMPORT LINE, and by a call with
 *     `//` in front of it. **D-154's finding in a brand-new check of my own.**
 *  2. The same thing with comments and imports excluded — still passed, because
 *     `switchTo()` calls `setLanguage` too. The file went on containing an invocation
 *     while the one that matters had gone. ➡️ **A check that asks whether a call exists
 *     cannot tell you whether the call that MATTERS exists.**
 *
 * ⭐ So it anchors on column zero. The boot call is at module top level in both files
 * and every other call in the product is inside a function, indented — the indentation
 * IS the difference between "this document is put into its language as it opens" and
 * "something, somewhere, can change the language". Precise, and load-bearing: if the
 * boot call is ever wrapped in an `if`, this fails and asks to be re-read.
 *
 * ➡️ **ALWAYS WRITE THE MUTATION AND WATCH IT FAIL.**
 */
const invokes = (src) => /^setLanguage\(/m.test(src);
const applied = /copy-language\.js/.test(appjs) && invokes(appjs);

equal(
  "⭐ the boot script, the CSS rule and the call that translates the copy are in one state",
  `boot ${loaded} · css ${glossRule} · applied ${applied}`,
  `boot ${loaded} · css ${loaded} · applied ${loaded}`
);

/*
 * ⚠️⚠️ A FOURTH HALF, AND IT IS THE ONE NOBODY WOULD MISS. `app/ended.html` is §7.8
 * step 4's landing page: nothing links to it from anywhere a reviewer looks, because
 * the only way to reach it is to end a session and mean it. A Finn who read the whole
 * product in Finnish and then ended it would have been told in English what had just
 * happened to their conversations — and no screenshot, no walkthrough and no round of
 * feedback would ever have shown it. ➡️ **A page you can only reach by destroying
 * something is a page nobody reviews.** So the suite reaches it instead.
 */
const endedApplied = /copy-language\.js/.test(ended) && invokes(ended);
equal(
  "⭐⭐ §7.8's ending page speaks the language the person was just reading",
  `ended ${endedApplied}`,
  `ended ${loaded}`
);

if (loaded) {
  check(
    "⭐⭐⭐ it is in <head> — after that, the page has already been painted",
    /<head>[\s\S]*lang-boot\.js[\s\S]*<\/head>/.test(html)
  );
  check(
    '⚠️⚠️ and it is NOT `type="module"` — a module is deferred, which is the whole fault',
    /<script src="\/app\/lang-boot\.js"><\/script>/.test(html)
  );
}

/* ── D-159: every screen answers for what the language control does there ──── */

section("⭐⭐ D-159 — the language control has an answer for every screen");

/*
 * ⚠️⚠️ THIS IS D-156'S FINDING ONE LAYER OUT. That one was about a BRANCH no sample
 * argument reached, so a sentence shipped that no reviewer had ever seen. This is
 * about a SCREEN: `paintCopy()` owns a hundred and twenty sentences, but seventy-three
 * element ids are written elsewhere, when a screen is entered or an event lands. A
 * switch that repainted only the static block would leave those seventy-three in the
 * language the reader has just said they cannot read — and leave them looking finished.
 *
 * ➡️ So `RERENDER` in `app.js` carries one entry per screen: a function that redraws
 * it, or `null` meaning the control is not offered while it shows. **A screen missing
 * from the table would have no home to be reviewed in**, so the two lists are compared
 * here and a new screen cannot be added without somebody answering for it.
 */
/** The two lists, read out of `app/app.js` as text — neither is exported. */
const between = (open, close) => {
  const i = appjs.indexOf(open);
  if (i < 0) return null;
  const j = appjs.indexOf(close, i);
  return j < 0 ? null : appjs.slice(i + open.length, j);
};
const screensSrc = between("const SCREENS = [", "\n];");
const rerenderSrc = between("const RERENDER = {", "\n};");

const screens = screensSrc === null ? null : [...screensSrc.matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
const rerender = rerenderSrc === null ? null : [...rerenderSrc.matchAll(/^  ([a-z]+):/gm)].map((m) => m[1]);

check("both lists are found at all — otherwise everything below is vacuous", Boolean(screens?.length && rerender?.length), `${screens?.length} screens, ${rerender?.length} entries`);
equal(
  "⭐⭐⭐ every screen says what the language control does there — none missing, none invented",
  `missing ${screens.filter((s) => !rerender.includes(s)).join(",") || "none"} · extra ${rerender.filter((s) => !screens.includes(s)).join(",") || "none"}`,
  "missing none · extra none"
);

/*
 * ⚠️ AND EVERY `null` CARRIES ITS REASON. An exemption with no reason beside it is the
 * shape that rots: the next reader cannot tell a decision from an oversight, and D-152
 * cost a round to exactly that. The reason is a comment above the entry, so this asks
 * only that there IS one — a human reads whether it is a good one.
 */
{
  const lines = rerenderSrc.split("\n");
  const notOffered = [];
  const unexplained = [];
  lines.forEach((line, i) => {
    const m = line.match(/^  ([a-z]+): null,$/);
    if (!m) return;
    notOffered.push(m[1]);
    // The reason is the run of `//` lines directly above the entry, with nothing between.
    let j = i - 1;
    let said = false;
    while (j >= 0 && /^\s*\/\//.test(lines[j])) {
      said = said || lines[j].replace(/^\s*\/\/\s*/, "").length > 20;
      j--;
    }
    if (!said) unexplained.push(m[1]);
  });
  equal("⚠️ every screen the control is NOT offered on says why, right above itself", unexplained.join(", "), "");
  check("⚠️ …and there are some, so an empty answer above is not an empty list", notOffered.length > 0, `${notOffered.length} of ${screens.length} screens cannot switch: ${notOffered.join(", ")}`);
}

/*
 * ⚠️⚠️ THE TWO MODULES EACH NAME THE SAME TWO LANGUAGES, INDEPENDENTLY. `ui/lang.js`
 * decides WHICH language and `ui/copy-language.js` holds the sentences, and neither
 * imports the other — deliberately, because they are answerable for different things.
 * The cost of that is two spellings of `"fi"` in one product. `copy-language.js` throws
 * on a language it does not know, so a drift would be a crash at boot rather than a
 * silent half-switch; this makes it a failing check here instead.
 */
const langsInCopy = appjs.includes("copy-language.js")
  ? (await import("../src/ui/copy-language.js")).LANGUAGES
  : null;
equal("⭐⭐ `copy-language.js` and `lang.js` name the same two languages", (langsInCopy ?? []).join(","), lang.CHOICES.join(","));

/*
 * ⚠️ THE ONE THING THE CONTROL MAY NEVER DO. `K_master` is in memory and nowhere else,
 * so a reload signs out whoever is signed in — a menu item that asks a person for their
 * eight words is not a language control, it is a sign-out with the wrong label.
 */
{
  const at = appjs.indexOf("async function switchTo(choice) {");
  check("the switch exists to be checked", at > 0);
  const body = appjs.slice(at, appjs.indexOf("\n}", at));
  check(
    "⭐⭐⭐ it never reloads — `K_master` is memory-only, and a reload asks for the eight words",
    !/location\.reload|location\.href\s*=|location\.assign|location\.replace/.test(body),
    body.split("\n").filter((l) => /location/.test(l)).join(" ⏎ ") || "no navigation of any kind"
  );
}

done();
