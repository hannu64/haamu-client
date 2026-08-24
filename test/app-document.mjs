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

// ═══════════════════════════════════ §3.5 — the one alarm, and why it cannot be dismissed

section("§3.5 — the tripwire is recorded on the channel, not held on a screen");

{
  const src = code("../app/app.js");
  const html = read("../app/index.html");
  const flowRoster = code("../src/flow/roster.js");
  const flowGhost = code("../src/flow/ghost.js");

  /**
   * ⚠️⚠️ THE RULE IS "RECORDED", NOT "SHOWN", AND UNTIL 0.9.22 ONLY THE SECOND HALF
   * EXISTED. §3.5 has always required a *"prominent, non-dismissable warning naming
   * the channel"*. The client showed one on the pairing screen and then every one of
   * §3.6.2's three answers called `show("tripwire", false)` — so the product's only
   * intrusion alarm was cleared by pressing a button the product itself offers,
   * including *"not yet"*, which §3.6.2 expressly permits. Nothing was written down.
   *
   * So the rule tested here is about WHERE THE EVIDENCE GOES: the act that creates
   * the channel carries it, because a second write is a window in which the channel
   * exists and its alarm does not.
   */
  for (const [what, needle] of [
    ["the roster channel", /addChannel\(\{[^}]*tripwire/],
    ["the Ghost channel", /setChannel\(\{[^}]*tripwire/],
  ]) {
    check(`⭐⭐ ${what} is created carrying §3.5's evidence`, needle.test(src));
  }

  /**
   * ⚠️ AND IT IS THE **VERIFIED** FLAG THAT IS RECORDED. The server raises `tripwire`
   * whenever a second claim arrives and cannot do better — it has no key to check one
   * with. An unverified flag means somebody who watched `pairing_id` go past forged a
   * claim: a nuisance, not an interception. Recording that one would put a permanent
   * alarm on an untouched channel at the choice of anyone who can see a request line,
   * which §3.5 spends a paragraph saying must never happen.
   */
  check(
    "⭐⭐⭐ and what is recorded is the VERIFIED flag, never the bare one",
    /tripwire\s*=\s*Boolean\(result\.tripwire\?\.verified\)/.test(src)
  );

  /**
   * ⚠️⚠️ NON-DISMISSABLE, TESTED AS THE ABSENCE OF EVERY WAY TO DISMISS IT rather than
   * as the presence of today's code. Three separate things would each defeat it, and a
   * check that looked only at the render call would miss two of them.
   */
  /**
   * ⚠️⚠️ TO THE SEMICOLON, NOT TO THE FIRST `)`. This read `[^)]*\)` for one round and
   * a mutation walked straight through it: the argument is `Boolean(entry.tripwire)`,
   * so the first closing parenthesis is INSIDE it, and the pattern stopped there —
   * `&& !verified` appended afterwards was never in the text being checked. The
   * mutation passed, which is the only reason this is right now.
   * ➡️ A pattern that cannot span a nested construct silently checks a prefix.
   */
  const clears = [...src.matchAll(/show\("chat-tripwire"[^;]*;/g)].map((m) => m[0]);
  equal("⚠️ the chat alarm is rendered in exactly one place", clears.length, 1);
  check(
    "⭐⭐ and that place reads the CHANNEL's stored evidence",
    /entry\.tripwire/.test(clears[0] ?? "")
  );
  check(
    "⭐⭐⭐ it is not gated on `verified` — comparing digits does not un-hold a link",
    !/verified/.test(clears[0] ?? "")
  );
  check(
    "⭐⭐ nor on `closed` — how a conversation was OBTAINED outlives the other end leaving",
    !/closed/.test(clears[0] ?? "")
  );

  /**
   * ⚠️ THE STORAGE SIDE OF THE SAME RULE. `setVerified` has no inverse for §3.6.2's
   * reason and `setTripwire` has none for §7.3.1 rule 7's; an assignment of `false`
   * anywhere but the creation default would be an un-marking that survives on one
   * device and is undone by the next merge — worse than not offering it at all.
   */
  /**
   * ⚠️ THE DESTRUCTURING DEFAULT `{ tripwire = false }` IS NOT A CLEARING PATH and an
   * earlier version of this check could not tell the two apart — it read the creation
   * signature as the defect. What is forbidden is writing `false` over a STORED value,
   * which in this codebase can only be a property assignment, a literal in an object
   * being persisted, or a delete. A parameter default has neither a dot nor a colon
   * in front of it, which is what separates them.
   */
  const CLEARS = [
    /\.tripwire\s*=\s*(?:false|0|null|undefined)/g, //   entry.tripwire = false
    /tripwire\s*:\s*(?:false|0|null|undefined)/g, //      { tripwire: false }
    /delete\s+[\w.]*\.tripwire/g, //                     delete c.tripwire
  ];
  for (const [file, src2] of [["flow/roster.js", flowRoster], ["flow/ghost.js", flowGhost]]) {
    const falses = CLEARS.flatMap((re) => [...src2.matchAll(re)].map((m) => m[0]));
    equal(`⭐⭐ \`${file}\` has no path that clears the evidence`, falses.join(" | "), "");
  }

  // ⚠️ AND THE PATTERNS ARE ALIVE. Three regexes that matched nothing anywhere would
  // pass the two checks above on an empty file, which is the way an absence-check rots.
  const canary = "x.tripwire = false; ({ tripwire: null }); delete y.tripwire;";
  equal(
    "⚠️ each clearing pattern still recognises the thing it forbids",
    CLEARS.filter((re) => new RegExp(re.source).test(canary)).length,
    CLEARS.length
  );
  check("and it has a path that sets it", /setTripwire/.test(flowRoster) && /setTripwire/.test(flowGhost));

  /**
   * ⚠️ IT IS AN `alarm`, AND THAT IS A CLAIM ABOUT EVERY OTHER BANNER. `chat-unverified`
   * is deliberately quiet because it appears on every ordinary conversation, and an
   * alarm shown everywhere is an alarm trained away before the day it matters. This one
   * appears only where a second holder of the invite link is a measured fact.
   */
  const el = html.match(/<div id="chat-tripwire"[^>]*>/)?.[0] ?? "";
  check("⭐⭐ the chat alarm exists and is styled as an alarm", /class="[^"]*\balarm\b/.test(el));
  check("⚠️ and it starts hidden, like every other banner", /\bhidden\b/.test(el));
}

// ============================= §7.8 step 2a, and the wiring the flow test cannot see

section("§7.8 step 2a — every ending in `app/app.js` hands the plan across the wipe (D-162)");

{
  /* ⚠️⚠️ THE FLOW SUITE PROVES THE ORDER AND CANNOT PROVE THE WIRING. `test/ending.mjs`
   * passes `prepareStorage` itself, so it goes on passing while `app/app.js` quietly
   * stops passing one — and then step 3 receives no plan, rebuilds it from a key step 2
   * has already zeroed, and deletes nothing. That is the defect D-162 fixed, arriving
   * by the one route the flow test is blind to. The rule is therefore stated where the
   * call sites live: an ending that clears storage must also prepare it.
   */
  const app = read("../app/app.js");
  const CALL = "endings.endSession({";
  const sites = app.split(CALL).slice(1).map((rest) => rest.split("\n  });")[0]);

  // ⭐ The guard on the guard, first: a split that stopped matching would leave an
  // empty list, and `every()` on nothing is true — the check would pass by finding
  // no call sites at all, which is precisely how this file's §2.1 rule once failed.
  equal("⚠️ the ending call sites are found at all, and there are three of them", sites.length, 3);

  equal(
    "⛔⛔ every ending that clears storage also prepares it while the key is still live",
    sites.filter((b) => !/\bprepareStorage\s*:/.test(b)).length,
    0
  );
  check(
    "⭐ and each one hands what it prepared to the clear, rather than dropping it",
    sites.every((b) => /clearStorage\s*:\s*\(?\s*prepared/.test(b)),
    `${sites.length} call sites pass the prepared plan through`
  );
  check(
    "⚠️ `clearFor` spends the prepared plan on the ordinary ending",
    /vault\.endSession\(prepared\)/.test(app),
    "the ordinary branch consumes it"
  );
  check(
    "⚠️ and `planFor` is what builds it, from the vault rather than by hand",
    /async function planFor\b[^]*?vault\.planEnding\(\)/.test(app),
    "planFor delegates to the vault"
  );

  // ⭐ The guard on the guard, second: every pattern above must still recognise the
  // thing it forbids, or a rename turns all four into checks that nothing matches.
  check(
    "⚠️⚠️ each pattern still matches the construct it is written about",
    /\bprepareStorage\s*:/.test("prepareStorage: () => planFor(x, {})") &&
      /clearStorage\s*:\s*\(?\s*prepared/.test("clearStorage: (prepared) => clearFor(x, {})") &&
      !/clearStorage\s*:\s*\(?\s*prepared/.test("clearStorage: () => clearFor(x, {})"),
    "and refuses the pre-D-162 form of the same line"
  );
}

done();
