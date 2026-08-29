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

/**
 * ⛔⛔⛔ D-168 — THE QUEUE EXISTED, THE SENTENCE DID NOT, AND THE DRAIN WAS ON THE WRONG
 * SCREEN.
 *
 * `flow/roster.js` has raised warnings for §7.3.2's mismatch and §7.3.1a's vanishing
 * since they were written, and `#notices` has sat ABOVE the screens since it was built —
 * its own comment in `index.html` says these are *"things that happened to this device,
 * not steps in a flow, and a person must not have to navigate to find them"*. And the one
 * caller of `takeWarnings()` was `openHome()`.
 *
 * ⭐ THAT COST NOTHING UNTIL D-168, because every earlier warning is about a roster the
 * person fetched by pressing something on that very screen. `elsewhere` is not: the roster
 * write that meets another device is §6.3's generation moving, which happens while the
 * person is IN a conversation, sending and receiving. A notice drained only on the list is
 * a notice that waits for the person to stop doing the thing it is about.
 *
 * So the rule tested here is about DRAIN POINTS, not about one function — the same shape
 * as D-167's entrances one section above, found the same way, one day later.
 */
section("⛔⛔ D-168 — the roster's warnings are drained where the person actually is");

{
  const src = code("../app/app.js");

  const drains = [
    ["the conversation list", bodyAfter(src, "async function openHome() {", "\n}\n")],
    ["a message sent", bodyAfter(src, "async function deliver(body) {", "\n}\n")],
    ["a message arriving", bodyAfter(src, "onMessages: async (messages) => {", "\n      },")],
  ];

  for (const [where, body] of drains) {
    // ⭐ The guard on the guard: a rename would leave an empty body and pass by vacancy.
    check(`⚠️ the path for ${where} is found`, body.length > 40, `${body.length} characters`);
    check(`⛔⛔ ${where}: the queue is drained here`, /renderWarnings\(\)/.test(body), where);
  }

  // ⚠️⚠️ AND ON THE ARRIVAL PATH IT IS BEFORE THE EARLY RETURN, which is exactly the
  // "one branch too late" fault this whole file exists for. §7.3.1 rule 3 takes the
  // maximum generation, so a drain that stored NOTHING may still have written the roster
  // and met the other device; a `renderWarnings()` below `if (stored === 0) return` would
  // be silent in precisely that case.
  const arriving = bodyAfter(src, "onMessages: async (messages) => {", "\n      },");
  check(
    "⛔⛔ and it drains before the early return, not after it",
    arriving.indexOf("renderWarnings()") >= 0 &&
      arriving.indexOf("renderWarnings()") < arriving.indexOf("if (stored === 0) return"),
    arriving.trim().split("\n").slice(0, 3).join(" / ")
  );

  // ⚠️ §7.6 HAS NO ROSTER AT ALL, and both new drain points run in Ghost mode. The old
  // single caller could not reach it — `openHome()` is Kept-only — so moving the drain
  // moved this from unreachable to reachable, and `session.roster` is genuinely absent
  // there rather than empty.
  const render = bodyAfter(src, "function renderWarnings() {", "\n}\n");
  check(
    "⚠️⚠️ and `renderWarnings` survives a mode that has no roster",
    /if \(!session\?\.roster\) return;/.test(render),
    render.trim().split("\n")[0]
  );

  // ⛔ The sentence itself is a copy lookup like its four neighbours. `copy.mjs` forbids
  // app.js typing prose at all; what this adds is that the branch EXISTS, since a warning
  // kind with no branch is silently dropped by the `else if` chain — and that it is LOUD.
  //
  // ⚠️⚠️ THE FIRST VERSION OF THIS CHECK ASKED THE WHOLE FUNCTION FOR `alarm: true` AND
  // PASSED WITH THE ALARM REMOVED, because two neighbouring branches carry one. That is
  // D-165's fault class in the instrument written to close it: a guard whose SCOPE is
  // wider than the thing it is guarding is answered by something else. It reads the one
  // line now, and the canary below is what says so.
  const branch = render.split("\n").find((l) => l.includes('w.kind === "elsewhere"')) ?? "";
  check(
    "⛔⛔ 'elsewhere' has a branch, and it says it out loud rather than quietly",
    /copy\.list\.elsewhere/.test(branch) && /alarm: true/.test(branch),
    branch.trim()
  );
  check(
    "⚠️⚠️ and the check reads THAT line — a neighbour's alarm does not answer for it",
    !/alarm: true/.test('else if (w.kind === "elsewhere") notice("elsewhere", copy.list.elsewhere);') &&
      /alarm: true/.test(branch),
    "canary"
  );

  // ⚠️⚠️ AND §4.2.2's DORMANT DOCUMENT STOPS BEING A WITNESS. `probe-elsewhere-tabs.mjs`
  // measured the notice firing on a same-browser takeover, where the sentence would have
  // named a browser and a device for the tab next door — a case §4.2.2 has already handled,
  // with a control. `showDormant()` is the one funnel every path into dormancy goes through,
  // which is why the call belongs there and not at each of them.
  const dormantBody = bodyAfter(src, "async function showDormant() {", "\n}\n");
  check("⚠️ the dormant screen's function is found", dormantBody.includes('only("dormant")'), `${dormantBody.length} characters`);
  check(
    "⛔⛔ a document going dormant forgets its roster baseline",
    /session\?\.roster\) session\.roster\.forgetBaseline\(\)/.test(dormantBody),
    dormantBody.trim().split("\n").find((l) => l.includes("forgetBaseline")) ?? "absent"
  );

  // ⚠️ The canary: every kind `flow/roster.js` pushes has a branch here, so the next one
  // added cannot fall through the chain the way this one would have.
  const raised = [...read("../src/flow/roster.js").matchAll(/warnings\.push\(\{ kind: "([a-z_]+)"/g)].map((m) => m[1]);
  const merged = [...read("../src/protocol/roster.js").matchAll(/warnings\.push\(\{ kind: "([a-z_]+)"/g)].map((m) => m[1]);
  const unhandled = [...new Set([...raised, ...merged])].filter((k) => !render.includes(`"${k}"`));
  equal(
    `⭐⭐ every warning kind either module raises has a sentence (${new Set([...raised, ...merged]).size} kinds)`,
    unhandled.join(", "),
    ""
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

// ═════════════════════════ D-169 — a panel is above the screens, and must still translate

section("⛔⛔ D-169 — every notice can be said again in the other language");

// ⭐⭐ HANNU FOUND IT WITH D-168's OWN PANEL, 2026-08-27: *"the language change did not
// change that warning panel language as long as it was there."* `only()` shows the
// language control only where `RERENDER` can redraw the screen — a control that changed
// half the words would look like it had worked — and `#notices` is not a screen. It sits
// ABOVE them, so it fell outside a promise that was being made on the very screen it was
// sitting on. ➡️ **A GUARANTEE MADE PER CONTAINER DOES NOT COVER WHAT LIVES OUTSIDE THE
// CONTAINER**, and the answer is not a second table to remember: `notice()` takes the
// words as a FUNCTION, so a panel that cannot be re-said is not a panel that can be made.

{
  const src = code("../app/app.js");

  /**
   * Every `notice(...)` call site, and whether its words arrive as a function.
   *
   * ⚠️ THE RULE, NOT THE SHAPE. What matters is that the words are fetched when the
   * panel is painted rather than when the event happened — so this asks for a callable
   * and does not care whether it returns a sentence or a descriptor. `clearNotice` and
   * `paintNotice` carry a capital N and are not call sites of this.
   */
  const sites = (text) => [...text.matchAll(/\bnotice\("([a-z-]+)",\s*([\s\S]{0,8})/g)].map((m) => ({ id: m[1], next: m[2] }));
  const deferred = (site) => /^\(\s*\)\s*=>/.test(site.next);

  const found = sites(src);
  check("⚠️ the call sites are found at all", found.length >= 15, `${found.length} panels`);

  const literal = found.filter((f) => !deferred(f));
  check(
    "⛔⛔ no panel is built from words chosen when the event happened",
    literal.length === 0,
    literal.length ? literal.map((f) => f.id).join(", ") : found.map((f) => f.id).join(", ")
  );

  check(
    "⚠️⚠️ and the detector still recognises what it forbids",
    sites('notice("elsewhere", copy.list.elsewhere, { alarm: true });').filter((f) => !deferred(f)).length === 1,
    "canary — a sentence passed by value fails"
  );

  // The builder is kept, or there is nothing to re-run.
  const put = bodyAfter(src, "function notice(id, build) {", "\n}\n");
  check("a panel put on screen is remembered by id", /liveNotices\.set\(id, build\)/.test(put), "kept for the switch");

  // ⚠️ AND DROPPED WITH THE PANEL. A builder that outlives its panel is re-run by the
  // next language switch, which would put a cleared notice back on the screen.
  const cleared = bodyAfter(src, "const clearNotice = (id) => {", "\n};");
  check("⭐ and forgotten when the panel is cleared", /liveNotices\.delete\(id\)/.test(cleared), "no orphan builders");

  const stopped = bodyAfter(src, "async function stopEverything() {", "\n}\n");
  check(
    "⭐⭐ and the whole map goes when the session does",
    /liveNotices\.clear\(\)/.test(stopped),
    "a panel from an ended session cannot come back"
  );

  // The switch itself.
  const switched = bodyAfter(src, "async function switchTo(choice) {", "\n}\n");
  check("⛔⛔ the language control re-says the panels", /repaintNotices\(\)/.test(switched), "notices follow the language");
  check(
    "⚠️ after `setLanguage`, or it would say them again in the language just left",
    switched.indexOf("setLanguage(") < switched.indexOf("repaintNotices()"),
    "order"
  );
  check(
    "⚠️⚠️ the detector still tells that order apart",
    !(switched.replace("repaintNotices();", "").indexOf("repaintNotices()") >= 0),
    "canary — with the call removed there is nothing to find"
  );

  const repaint = bodyAfter(src, "function repaintNotices() {", "\n}\n");
  check(
    "and it walks the map in the order it was filled",
    /for \(const \[id, build\] of liveNotices\)/.test(repaint) && /paintNotice\(id, build\)/.test(repaint),
    "the column is left as it was"
  );

  // ⚠️ THE ONE CALLER THAT USED TO HAND A FINISHED SENTENCE ACROSS. D-152's rule about
  // `flow/roster.js` — what travels is what happened, and the words are chosen where
  // they are said — reached `app.js` only when this was found.
  const fail = code("../app/app.js");
  check(
    "⭐⭐⭐ and no caller passes a built sentence to a notice-maker",
    !/offerToResume\(\{[^}]*body:/.test(fail),
    "the resume offer carries the reason, not the prose"
  );
}


section("D-172 — the app may not send where the person may not");

/**
 * ⛔⛔ §6.7.1's FOUNDING DEFECT, PERFORMED BY THE APP ITSELF.
 *
 * `reconnectAutomatically()` sends a real message with nobody pressing anything, to
 * rebuild a session on a device that has never held one (§6.3). While a conversation is
 * CLOSED — the peer has left and deleted their side — a message goes into a mailbox
 * nobody will ever drain again, for up to §5.1.1's fourteen days. That is the exact
 * sentence §6.7.1 was written to end, and the product already holds the PERSON to the
 * rule: while closed the composer is hidden AND `disabled`. The guard was on the human
 * and not on the app.
 *
 * ⭐ AND THE RULE WAS ALREADY WRITTEN FORTY LINES AWAY: `showConversationState` computes
 * the banner as `!closed && neverHeldHere(...)`, with a comment saying why. Advice to
 * send cannot work once the other end is gone — and neither can the send.
 *
 * ⚠️⚠️ THIS IS A SOURCE RULE AND IT KNOWS WHAT IT IS. It reads the function's text; it
 * cannot prove the state is REACHABLE, and as of 2026-08-28 nobody has demonstrated
 * that it is — `prune()` only drops superseded sessions, so a live session cannot be
 * emptied out from under a closed marker, and both records live in `CONVERSATION` and
 * are cleared together. It is here because the RULE is right whatever the reachability,
 * and because a migration that failed partway is one way to the state. The instrument
 * that would settle reachability is a two-browser probe, and it has not been run.
 */
{
  // ⚠️ `code()` and not `read()`: comments are stripped, so the words "closed" and
  // "loadClosed" in the comment I just wrote cannot satisfy the check that follows it.
  const src = code("../app/app.js");
  const fn = bodyAfter(src, "async function reconnectAutomatically(entry, hash) {", "\n}\n");
  check("the function still exists to be checked at all", fn.length > 0, `${fn.length} chars`);
  check(
    "⛔⛔ the automatic send consults the closed marker",
    /loadClosed/.test(fn),
    /loadClosed/.test(fn) ? "it asks §6.7.1's marker first" : "⛔ it can send into a mailbox nobody drains"
  );
  const closedAt = fn.indexOf("loadClosed");
  const sendAt = fn.indexOf("deliver(");
  check(
    "⭐ and it consults it BEFORE it sends, which is the whole of the rule",
    closedAt !== -1 && sendAt !== -1 && closedAt < sendAt,
    `loadClosed@${closedAt} deliver@${sendAt}`
  );
  check(
    "⚠️ the banner beside it is still gated the same way, so the two agree",
    /const reconnect = !closed && /.test(bodyAfter(src, "async function showConversationState(entry) {", "\n}\n"))
  );
}

section("D-173 — the control that could not do what it said");

/**
 * ⛔⛔⛔ THREE CONTROLS AWAITED A ROSTER WRITE AND CAUGHT NOTHING.
 *
 * `#delete`, `#sas-wrong` and `#rename` each `await` an HTTP PUT that four ordinary
 * things can refuse — §9.2's limit, a stale `if_match`, a 5xx, no network. Every one
 * of them arrived as an unhandled rejection in a console nobody has open. Measured on
 * 2026-08-28 with the network up and only `PUT /api/roster` refused: the other
 * person's screen said *"This conversation has ended"*, the conversation was still in
 * the list here, and the person who pressed delete was told nothing at all.
 *
 * ⭐ THE ORDER IS HALF THE REPAIR AND THE SENTENCE IS THE OTHER HALF. §6.7.1 rule 1a
 * makes the roster write the commit point, so a refusal now lands before anything has
 * been torn down and before the notice has gone — which is what lets the panel say
 * *"the other person was not told"* and be true.
 *
 * ⚠️ SOURCE RULES, AND THEY KNOW IT. `~/lpm-probes/probe-silent-refusal.mjs` is what
 * measured the behaviour in a real browser; these keep the shape from drifting back.
 */
{
  const src = code("../app/app.js");

  const remove = bodyAfter(src, "async function removeConversation(entry, { tell = true } = {}) {", "\n}\n");
  check("`removeConversation` still exists to be checked at all", remove.length > 0, `${remove.length} chars`);
  const rosterAt = remove.indexOf("removeChannel(rootBytesOf(entry))");
  const tellAt = remove.indexOf("tellThemItEnded(entry)");
  const stopAt = remove.indexOf("live.stop()");
  const forgetAt = remove.indexOf("forgetChannel");
  check(
    "⛔⛔ §6.7.1 rule 1a — the roster write is the FIRST thing, so a refusal changes nothing",
    rosterAt !== -1 && tellAt !== -1 && rosterAt < tellAt,
    `removeChannel@${rosterAt} tellThemItEnded@${tellAt}`
  );
  check(
    "⚠️ and §6.7.1 rule 1 still holds — the notice goes before the teardown that destroys its ratchet",
    tellAt !== -1 && forgetAt !== -1 && tellAt < forgetAt,
    `tellThemItEnded@${tellAt} forgetChannel@${forgetAt}`
  );
  check(
    "⚠️ and delivery still stops before the stores are emptied, which is the older rule",
    stopAt !== -1 && forgetAt !== -1 && stopAt < forgetAt,
    `live.stop@${stopAt} forgetChannel@${forgetAt}`
  );

  // ⚠️ THE HANDLER, NOT THE FILE. `sayNothingChanged` appearing somewhere in `app.js`
  // proves nothing about the control that needed it.
  for (const [control, header] of [
    ["delete", '$("delete").addEventListener("click", async () => {'],
    ["sas-wrong", '$("sas-wrong").addEventListener("click", async () => {'],
    ["rename", '$("rename").addEventListener("click", async () => {'],
  ]) {
    const fn = bodyAfter(src, header, "\n});\n");
    check(`\`#${control}\`'s handler is still found`, fn.length > 0, `${fn.length} chars`);
    // ⚠️ THE DETAIL REPORTS THE WHOLE CONDITION, NOT HALF OF IT. A first version said
    // "guarded" whenever `sayNothingChanged` appeared anywhere in the handler, so a
    // mutation that removed the `catch` and left the call behind failed with the word
    // "guarded" beside it. A detail line that contradicts its own verdict is worse
    // than no detail line.
    const caught = /catch \(err\)/.test(fn), says = /sayNothingChanged\(/.test(fn);
    check(
      `⛔⛔ \`#${control}\` catches what it awaits and says so`,
      caught && says,
      caught && says ? "guarded" : `⛔ catch:${caught} sentence:${says} — an unhandled rejection is all the person gets`
    );
  }

  // ⭐ `#sas-wrong` HAS A SECOND RULE OF ITS OWN. `paired` and `revisiting` used to be
  // nulled BEFORE the removal, so a throw left the verify screen standing with its
  // three answers no longer knowing which conversation they were about.
  const wrong = bodyAfter(src, '$("sas-wrong").addEventListener("click", async () => {', "\n});\n");
  const removeAt = wrong.indexOf("removeConversation(");
  const clearAt = wrong.indexOf("paired = null");
  check(
    "⭐ and `#sas-wrong` does not forget which conversation it is about until the removal has happened",
    removeAt !== -1 && clearAt !== -1 && removeAt < clearAt,
    `removeConversation@${removeAt} paired=null@${clearAt}`
  );

  // ⛔ THE COMPOSER, WHICH IS THE SAME QUESTION AT A DIFFERENT CONTROL (D-163's sweep).
  // `#text` is cleared before the `await`, so a failed send left the sentence nowhere
  // while the line beneath it said "Try again".
  const composer = bodyAfter(src, '$("composer").addEventListener("submit", async (e) => {', "\n});\n");
  const catchBody = bodyAfter(composer, "catch (err) {", "\n  } finally");
  check("the composer's catch is still found", catchBody.length > 0, `${catchBody.length} chars`);
  check(
    '⛔⛔ a send that failed puts the words back in the box it took them from',
    /\$\("text"\)\.value = body/.test(catchBody),
    /\$\("text"\)\.value = body/.test(catchBody) ? "restored" : "⛔ the only copy was the person's memory"
  );
  check(
    "⚠️ and only when the box is still empty, so the next sentence is not overwritten",
    /\$\("text"\)\.value === ""/.test(catchBody)
  );
}

// ═══════════════════════ §3.4.1c — the identity's own link, wired all the way through

/**
 * ⚠️⚠️ THE MACHINERY EXISTED FOR A DAY WITH NOTHING CALLING IT. `flow/roster.js` grew
 * `rememberInvite` and `recogniseLink`, `protocol/pairing.js` grew the memo, both were
 * tested, and the product behaved exactly as the deployed build — because `app.js` never
 * passed either flow a `links`. ⭐ That is a defect a unit test cannot see: every module
 * is correct and the wire between them is missing.
 */
section("§3.4.1c — the roster is actually handed to the two flows that need it");

{
  const src = code("../app/app.js");

  for (const [what, needle] of [
    ["`flow.initiate`", /flow\.initiate\(\{[^}]*links:/],
    ["`flow.join`", /flow\.join\(\{[^}]*links:/],
  ]) {
    check(`⭐⭐⭐ ${what} is given somewhere to look, or none of §3.4.1c runs at all`, needle.test(src));
  }

  // ⚠️ THROUGH `linksFor()` AND NOT `session.roster`. Rule 8 exempts Ghost mode — §7.6
  // has no roster and a ghost client must not report having recognised anything — and a
  // call site reaching for `session.roster` directly would throw there instead.
  check(
    "⭐⭐ and through the one helper that knows Ghost mode has no roster (rule 8)",
    /links: linksFor\(\)/.test(src) && /const linksFor = \(\) => \(isGhost\(\) \? null/.test(src)
  );

  // Rule 6: with the write that creates the channel, never in one of its own — the same
  // requirement, and the same reason, as §3.5's `tripwire` two lines above it.
  check(
    "⭐⭐ the channel is created carrying the memo of the link that made it (rule 6)",
    /addChannel\(\{[^}]*linkMemo/.test(src)
  );

  /**
   * ⛔⛔ RULE 3 SAYS *"rather than reporting a failure"*, AND THE PANEL IS THE REPORT.
   * `own_link` is terminal, so without an arm of its own it inherits "Pairing did not
   * complete" **and the alarm colours this product reserves for telling somebody they
   * are under attack** — shown to a person who opened their own invite link on their own
   * second device. That is the D-174 screen one step milder, and it is not acceptable.
   */
  const titleFn = bodyAfter(src, "function failureTitleFor({ ownLink, paused, waiting }) {", "\n}\n");
  check("the heading chooser is found", titleFn.length > 0, `${titleFn.length} chars`);
  check(
    "⛔⛔ `own_link` gets its own heading rather than the failure one",
    /if \(ownLink\) return copy\.pairing\.ownLinkTitle/.test(titleFn)
  );
  check(
    "⛔⛔ and it is decided FIRST — the terminal arm would otherwise take it",
    titleFn.indexOf("ownLinkTitle") < titleFn.indexOf("failureTitle")
  );
  check(
    "⚠️ and `failWith` actually asks it, rather than keeping a second copy of the rule",
    /text\("failure-title", failureTitleFor\(\{ ownLink, paused, waiting \}\)\)/.test(src)
  );
  check(
    "⛔⛔⛔ and the alarm class is withheld from it — nobody is being attacked",
    /toggle\("alarm", !paused && !ownLink\)/.test(src)
  );

  /**
   * Rule 2: *"SHOULD open the conversation it already has"*. ⚠️ The check is that the
   * open happens BEFORE `failWith` is reached, because `failWith` is a terminus — it
   * paints the panel and returns, and a rule 2 arm placed after it is unreachable code
   * that reads like a fix.
   */
  const joinCatch = bodyAfter(src, "async function runJoin(fragment) {", "\n}\n");
  check("`runJoin` is found", joinCatch.length > 0, `${joinCatch.length} chars`);
  check(
    "⭐⭐ rule 2 opens the conversation the invite link already made",
    /own_channel/.test(joinCatch) && /await openConversation\(already\)/.test(joinCatch)
  );
  check(
    "⚠️ and it does so before `failWith`, which is a terminus and not a step",
    joinCatch.indexOf("own_channel") < joinCatch.indexOf("failWith(err)")
  );
  check(
    "⚠️ with a sentence, because a screen that changes for no stated reason reads as a fault (D-163)",
    /notice\("ownlink"/.test(joinCatch)
  );
}

done();
