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

// ═══════════════════════════ §4.3 — the lock, as a control that keeps what it locks

section("§4.3 — the lock is reachable, and locking still deletes nothing (D-163)");

{
  /* ⚠️⚠️ THE MECHANISM WAS NEVER THE PROBLEM. `lockNow` has always dropped the derived
   * keys and touched no store — it was specified, implemented, tested and honestly
   * worded, and it could only be reached by leaving the tab alone for 30 minutes. So
   * every guard in this suite was satisfied while the product offered a person exactly
   * two ways to put their KEY away, both of which delete their messages.
   *
   * ⭐ THE CLASS IS "A MECHANISM WITH NO CONTROL", and it is invisible to a review that
   * reads code: an absent button has no string to check, no branch to cover and no line
   * to read. It is D-151's missing sentence one level up — **the defect is the absence**
   * — and the only place it can be caught is a rule that asks whether the thing is
   * REACHABLE, which is a question about the document.
   */
  const html = read("../app/index.html");
  const app = read("../app/app.js");
  const appCode = code("../app/app.js");

  const home = html.split('<section id="home"')[1]?.split("</section>")[0] ?? "";
  check("⚠️ the home section is found at all, or nothing below means anything", home.length > 500, `${home.length} characters`);

  check(
    "⭐⭐⭐ §4.3's lock has a control, and it is on the screen the endings are on",
    /id="lock-now"/.test(home) && /id="lock-note"/.test(home),
    "both the button and its note are inside #home"
  );

  // ⚠️ Kept mode only, and it is the PLACEMENT that guarantees it rather than a check in
  // the handler: Ghost mode has no list, so `#home` never appears in it. The day this
  // button moves to a screen Ghost can reach, `lockNow` starts covering with a sentence
  // about idleness that nobody's clock produced.
  check(
    "⚠️⚠️ and it is inside `#home` rather than loose in the document, which is what keeps it out of Ghost mode",
    html.includes('id="lock-now"') && home.includes('id="lock-now"'),
    "the only occurrence is the one inside #home"
  );

  check(
    "⭐ it is wired to the lock, and it says the person asked",
    /\$\("lock-now"\)\.addEventListener\([^]*?lockNow\(lockFlow\.MANUAL\)/.test(appCode),
    "lock-now → lockNow(lockFlow.MANUAL)"
  );

  check(
    "⚠️ and both its sentences come from `ui/copy.js`, like every other sentence on the screen",
    /text\("lock-now", copy\.lock\.control\)/.test(appCode) && /text\("lock-note", copy\.lock\.controlNote\)/.test(appCode),
    "label and note are painted from copy"
  );

  /* ⛔⛔⛔ THE PROPERTY THE CONTROL PROMISES, ASSERTED AGAINST THE CODE THAT KEEPS IT.
   *
   * `copy.lock.controlNote` says *"Nothing is deleted. Your messages stay on this browser
   * and open again when you type your KEY."* That is true because `lockNow` drops keys and
   * closes handles and never reaches a store — and it is one line away from being false.
   * A future ending-shaped refactor that routed the lock through `clearFor` would leave the
   * note on screen, still rendered, still reviewed, and lying.
   *
   * ⚠️ `db.close()` is deliberately NOT forbidden. Closing a database is not clearing one,
   * and a pattern that could not tell them apart would ban the correct line.
   */
  const CLEARS = /endSession|clearEverything|clearFor\(|endHere\(|deleteAll|\.clear\(/;
  const body = app.split("async function lockNow(reason) {")[1]?.split("\n}")[0] ?? "";
  check("⚠️ `lockNow`'s body is found, and it is the whole function", body.includes('only("enter")'), `${body.length} characters`);
  equal(
    "⛔⛔⛔ locking clears no store — this is the whole difference between a lock and an ending",
    (body.match(CLEARS) ?? []).join(""),
    "",
    "`copy.lock.controlNote` promises nothing is deleted. If a lock ever clears a store, " +
      "that sentence becomes a lie on a screen nobody re-reads. See D-163."
  );

  // ⭐ The guard on the guard: the pattern has to still recognise a clear, or the check
  // above is an absence that passes because it can no longer match anything.
  check(
    "⚠️⚠️ and the pattern still recognises a clear where one really happens",
    CLEARS.test(app.split("async function clearFor(")[1]?.split("\n}")[0] ?? "") && !CLEARS.test("locked.db.close();"),
    "`clearFor` matches; `db.close()` correctly does not"
  );
}

// ═══════════════ D-164 — the other end of the sample contract: what is really passed

section("the two sentences that print a date are really given one (D-164)");

{
  /* ⛔⛔ THE SAMPLE TABLE CLAIMS `list.unnamedOn` AND `list.noHistory` ARE HANDED A DATE, and
   * `test/copy.mjs` now enforces that the samples ARE dates. That is one end of a contract
   * with two ends: a sample table is a claim about the CALL SITE, and a claim about a call
   * site is worth nothing unless the call site is read.
   *
   * ⭐ The defect it closes is not hypothetical — it is the one that happened backwards.
   * `SAMPLES` said "Pixel 6", the call site said `toLocaleDateString()`, and for as long as
   * both stood apart the Finnish translated a device name that no user has ever been shown.
   * Either end alone would have gone on being self-consistent.
   */
  const app = code("../app/app.js");
  // ⚠️ `[^)]*` CANNOT SPAN A NESTED PAREN, and both call sites contain one —
  // `new Date((entry.created ?? 0) * 1000)`. A pattern written with it matches nothing here
  // and passes the day somebody deletes the call. `[\s\S]{0,80}?` is lazy and paren-blind,
  // which is what this needs; the canary below is what proves it did not become permissive.
  const CALLS = [
    ["list.unnamedOn", /copy\.list\.unnamedOn\(\s*new Date\([\s\S]{0,80}?\.toLocaleDateString\(\)/],
    ["list.noHistory", /const when = new Date\([\s\S]{0,80}?\.toLocaleDateString\(\);[\s\S]{0,200}?copy\.list\.noHistory\(when,/],
  ];
  for (const [path, pattern] of CALLS)
    check(
      `⭐⭐ \`${path}\` is rendered with a formatted date, which is what its sample must be`,
      pattern.test(app),
      pattern.source.slice(0, 60)
    );

  // ⚠️ The guard on the guard: a pattern this specific rots into a check that matches
  // nothing the moment somebody reformats the line, and then it passes forever.
  check(
    "⚠️⚠️ and the patterns still refuse a call site that passes something else",
    !CALLS[0][1].test("copy.list.unnamedOn(entry.deviceName)") &&
      !CALLS[1][1].test("const when = entry.device; text('home-note', copy.list.noHistory(when, 2));"),
    "a device-shaped argument is not accepted at either call site"
  );
}

// ═══════════════ the 2026-08-24 outside review, second pass — slices B and C (D-165)
//
// ⭐⭐ FIVE OF THESE SEVEN FIXES WERE A RULE ALREADY WRITTEN IN A COMMENT AND APPLIED
// ONE BRANCH, ONE FUNCTION OR ONE SCREEN TOO LATE. `paste-go` carried the words *"out
// of the field before anything else happens"* below the return that skipped it;
// `stopEverything` cleared six references and not the map holding every channel root;
// one `failcode` in seventeen put a browser's own prose on screen. ➡️ **A rule that
// lives in a comment is enforced only where somebody remembered it.** So each one
// leaves here as an executable rule instead.

/** Everything between a header and the first terminator at column 0. */
const bodyAfter = (src, header, terminator) => {
  const i = src.indexOf(header);
  if (i < 0) return "";
  const rest = src.slice(i + header.length);
  const j = rest.indexOf(terminator);
  return j < 0 ? "" : rest.slice(0, j);
};

/**
 * ⛔⛔⛔ D-167 — §3.6.2's SCREEN IS REACHED TWICE AND ONLY ONE ENTRANCE CARRIED THE ALARM.
 *
 * `succeed()` showed §3.5's panel inline after pairing. `verify-now` — the same screen,
 * reached from inside a conversation, which is where somebody who answered *"not yet"*
 * finally decides — showed the digits and no alarm. Hannu walked that path on 2026-08-26
 * with a conversation whose invitation a second party had demonstrably held, chose "yes",
 * and was shown nothing.
 *
 * ⭐ The rule was written TWO LINES BELOW the branch that ignored it: `showSas`'s own
 * comment says the screen *"is reached twice: right after pairing, and again from inside
 * a conversation whenever the person is finally able to ask."*
 *
 * So the rule tested here is about ENTRANCES, not about one function: every path onto
 * that screen decides the alarm from a value, through the one helper — which is also why
 * a bare `show("tripwire")` may not come back. Showing without ever hiding would leave a
 * verified alarm standing over the NEXT pairing, and §3.5 says a false alarm is the worst
 * outcome available.
 */
section("⛔⛔ D-167 — both entrances to §3.6.2's screen decide §3.5's alarm");

{
  const src = code("../app/app.js");
  const entrances = [
    ["after pairing", bodyAfter(src, "async function succeed(result) {", "\n}\n")],
    ["from inside the conversation", bodyAfter(src, '$("verify-now").addEventListener("click", async () => {', "\n});")],
  ];

  for (const [where, body] of entrances) {
    // ⭐ The guard on the guard: a rename would leave an empty body and pass by vacancy.
    check(
      `⚠️ the entrance ${where} is found, and it is the one that shows the digits`,
      body.includes("showSas(") && body.includes('only("verify")'),
      `${body.length} characters`
    );
    check(`⛔⛔ ${where}: the alarm is decided from a value`, /showPairingTripwire\(/.test(body), where);
  }

  // ⚠️ AND IT IS THE CHANNEL'S FLAG ON THE SECOND ENTRANCE, not a pairing result — there
  // is no result on that path. §7.3.1 rule 7 carried the flag there, possibly from another
  // device, and reading it back off the entry is the point of having recorded it.
  const revisit = bodyAfter(src, '$("verify-now").addEventListener("click", async () => {', "\n});");
  check(
    "⭐⭐ and the second entrance reads it off the CHANNEL, which is where rule 7 put it",
    /showPairingTripwire\(Boolean\(openEntry\.tripwire\)\)/.test(revisit),
    revisit.trim().split("\n").pop()
  );

  // ⛔ A show with no value is the shape that cannot hide: it made the alarm sticky for
  // the rest of the session, which is a FALSE alarm on the next, clean pairing.
  const bare = [...src.matchAll(/show\("tripwire"\s*\)/g)];
  equal("⛔⛔ no `show(\"tripwire\")` without a value — showing must be able to hide", bare.length, 0);
  check(
    "⚠️ the detector tells a bare show from one with a value",
    /show\("tripwire"\s*\)/.test('show("tripwire");') && !/show\("tripwire"\s*\)/.test('show("tripwire", on);'),
    "canary"
  );
}

section("§3.6.2 — the three answers are offered only once there is something to answer about (C #2)");

{
  const src = code("../app/app.js");
  const body = bodyAfter(src, "async function succeed(result) {", "\n}\n");

  // ⭐ The guard on the guard first: a rename would otherwise leave every index at -1
  // and the comparisons below true by vacancy.
  check(
    "⚠️ `succeed` is found and is the function that shows the digits",
    body.includes("showSas(result.sas)") && body.includes('only("verify")'),
    `${body.length} characters of body`
  );

  /**
   * ⛔⛔ THE RULE: `paired` IS ASSIGNED BEFORE THE SCREEN IS OFFERED. All three of
   * §3.6.2's answers begin `const entry = paired ?? revisiting; if (!entry) return
   * backToStart()`, so a decision screen shown before the write resolves is a screen
   * whose every button is a no-op — including *"this is not the person"*, which then
   * deletes nothing while the write lands the attacker's channel in the roster.
   */
  const decides = body.indexOf('only("verify")');
  check(
    "⛔⛔ the channel is persisted and `paired` assigned before the digits are offered",
    body.lastIndexOf("paired = ") < decides,
    "the last `paired =` precedes the screen change"
  );
  check(
    "⚠️ and that holds for the roster write itself, not merely the assignment",
    body.indexOf("addChannel") < decides && body.indexOf("setChannel") < decides,
    "both modes write before the screen"
  );

  // ⭐ And the guard still refuses the order it was written about.
  const before = `clearPairingSurface(); showSas(x); only("verify"); await addChannel(); paired = { };`;
  check(
    "⚠️⚠️ the rule still catches the pre-D-165 ordering",
    !(before.lastIndexOf("paired = ") < before.indexOf('only("verify")')),
    "a screen-first `succeed` fails this check"
  );
}

section("§7.8 step 2 — a lock drops the references that carry a channel root (C #3)");

{
  const src = code("../app/app.js");
  const body = bodyAfter(src, "async function stopEverything() {", "\n}\n");

  check(
    "⚠️ `stopEverything` is found and is the one that stops the streams",
    body.includes("streams.clear()"),
    `${body.length} characters of body`
  );

  /**
   * ⛔ THE ENDING NAVIGATES AND THE LOCK DOES NOT. `endHere` calls `location.replace`,
   * so a new document takes the heap with it; `lockNow` keeps this one alive behind the
   * enter screen. Anything still referenced there is still on the device — and `hashed`
   * holds one roster entry per conversation, each carrying its channel root, while
   * `paired` holds the raw `rootBytes` of a channel whose digits were never answered.
   */
  for (const name of ["hashed.clear()", "paired = null", "revisiting = null"]) {
    check(`⛔ it drops \`${name.split(/[ .]/)[0]}\``, body.includes(name), name);
  }

  // ⭐ The other direction: these must be things that really do hold a root, or the
  // rule is three arbitrary names. `hashed` is filled from roster entries; `paired`
  // from `rootBytes` itself.
  check(
    "⚠️ `hashed` really is filled with roster entries, and `paired` with raw root bytes",
    /hashed\.set\([^;]*entry\)/.test(src) && /paired = \{ \.\.\.entry, rootBytes:/.test(src),
    "both named bindings carry channel roots"
  );

  const before = `streams.clear(); elsewhere.clear(); seen.clear(); const stopped = session;`;
  check(
    "⚠️⚠️ the rule still catches the pre-D-165 body",
    !before.includes("hashed.clear()"),
    "a `stopEverything` without the map fails this check"
  );
}

section("§6.7.1 rule 8 — only a message that was READ clears the closing marker (C #4)");

{
  const src = code("../app/app.js");

  /**
   * ⛔ RULE 8 SAYS *"A LATER MESSAGE FROM THAT PEER"*. An item with no payload is one
   * this device refused — a stale generation, a replay, a tampered envelope — and a
   * refusal is not evidence the peer sent anything. Unguarded, a hostile server
   * un-closes a closed conversation by requeueing an old ciphertext under a fresh
   * `msg_id`, and the person types into a mailbox nobody will ever drain again.
   */
  check(
    "⛔⛔ the marker is cleared only for a message that produced a payload",
    /if \(m\.payload\) closes = false;/.test(src),
    "the assignment is guarded"
  );
  equal(
    "⚠️ and there is no unguarded `closes = false` anywhere in the file",
    (src.match(/^\s*closes = false;/gm) ?? []).length,
    0
  );
  check(
    "⚠️⚠️ the detector still recognises the unguarded form it forbids",
    /^\s*closes = false;/m.test("    closes = false;\n"),
    "a bare assignment on its own line is what fails"
  );
}

section("§2.1.1 — the pasted field is cleared as soon as it is read, not once accepted (C #7)");

{
  const src = code("../app/app.js");
  const body = bodyAfter(src, '$("paste-go").addEventListener("click", async () => {', "\n});");

  check(
    "⚠️ the handler is found and is the one that reads the field",
    body.includes('$("paste-link").value.trim()'),
    `${body.length} characters of body`
  );

  /**
   * ⛔ §2.1.1: *"It MUST clear the field as soon as the value is read."* The clear used
   * to sit below the rejection's `return`, so the one case the same section spends its
   * other bullet on — a valid link belonging to a DIFFERENT deployment — left a real
   * `L` in a live `<input>` for the life of the document.
   */
  check(
    "⛔⛔ the field is cleared before the rejection can return",
    body.indexOf('$("paste-link").value = ""') < body.indexOf('text("paste-note"'),
    "clear, then report"
  );

  /**
   * ⭐ THE ONE EXCEPTION IS DELIBERATE AND IS THE ONLY ONE. A code SHORTER than §2.2's
   * sixteen characters cannot be a complete secret and is the only case where the person
   * is mid-typing — losing it means asking a friend on a telephone to read sixteen
   * characters out again. Everything else goes, including a code that is too long.
   */
  check(
    "⚠️ and `keep` is granted to the short code alone",
    /no\(copy\.openLink\.codeShort\(chars\), true\)/.test(src) &&
      (src.match(/, true\)/g) ?? []).length === 1,
    "exactly one `keep`"
  );

  const before = `const typed = v.trim(); const problem = f(typed); if (problem) { text("paste-note", p); return; } $("paste-link").value = "";`;
  check(
    "⚠️⚠️ the rule still catches the pre-D-165 order",
    !(before.indexOf('$("paste-link").value = ""') < before.indexOf('text("paste-note"')),
    "a clear-after-return handler fails this check"
  );
}

section("§12 — no exception reaches the screen as its own message (C #11)");

{
  const src = code("../app/app.js");

  /**
   * ⚠️⚠️ SEVENTEEN CALL SITES AND ONE OF THEM WAS DIFFERENT. `failWith` had its
   * fallback-to-`err.message` removed for feedback 13 — *"429 rate_limited"*, on screen,
   * under "Pairing did not complete" — and this sweep missed the Ghost failure path,
   * which went on printing a browser's own `DOMException` prose in English underneath a
   * Finnish sentence. The rule is about the DETAIL LINE, which is the one place an
   * exception is allowed anywhere near a person, and only through `detailOf`.
   */
  const args = [...src.matchAll(/text\("failcode",\s*([^;]*?)\);/g)].map((m) => m[1]);
  check("⚠️ the `failcode` call sites are found at all", args.length >= 3, `${args.length} sites`);

  // ⭐ `detailOf` IS THE ONE DOOR AND IT IS PUNCHED OUT BEFORE THE SCAN. It renders a
  // reason code or an HTTP status and nothing else — a bounded string of ours — so an
  // exception passing through it is not an exception reaching the screen. Anything
  // else mentioning `err` is.
  const reaches = (a) => /\berr\b|String\(/.test(a.replace(/detailOf\([^()]*\)/g, "·"));
  equal("⛔⛔ no exception reaches the screen except through `detailOf`", args.filter(reaches).length, 0);
  check(
    "⚠️⚠️ the detector still tells the two apart",
    reaches("err?.message ?? String(err)") && !reaches("detailOf(err)"),
    "refuses the pre-D-165 argument, admits the sanctioned one"
  );
}

done();
