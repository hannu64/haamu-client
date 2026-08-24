// The prose, against the constants it describes and the claims it may not make.
//
// ⚠️⚠️ THIS SUITE EXISTS BECAUSE NOTHING ELSE IN A BUILD READS ENGLISH. A number
// in a sentence is a copy of a decision made in another file, and a sentence is
// the one artefact that keeps saying the old thing after the decision moves.
// PROTOCOL.md has already paid for it once: §8's copy said files were kept for 7
// days when retention was 7 to 14 — it told the reader their file left the server
// SOONER than it did, which is the dangerous direction.
//
// Two kinds of check, and the second is the one worth having:
//
//   1. every number in the copy is the constant, computed rather than typed;
//   2. no sentence makes a claim the specification forbids. §7.7 forbids claiming
//      memory zeroization. §7.8 permits "removes it from this browser now" and
//      nothing stronger. §7.3.1a forbids telling a user that deleting a
//      conversation removes every trace of it. §6.6 requires deletion to be
//      described as best-effort. Each of those is a sentence somebody would
//      otherwise write in perfectly good faith.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import * as copy from "../src/ui/copy.js";
import { MESSAGE_TTL_S } from "../src/storage/vault.js";
import { QUARANTINE_DAYS } from "../src/flow/quarantine.js";
import { MAX_CANDIDATE_SETS, PHRASE_WORDS, PHRASE_WORDS_LONG } from "../src/protocol/passphrase.js";
import { PAIRING_TTL_SECONDS } from "../src/protocol/pairing.js";
import { CODE_ALPHABET, CODE_CHARS, SPELLING, normalise } from "../src/protocol/code.js";
import { EPOCH_SECONDS } from "../src/protocol/epoch.js";
import { BLUR_MS, IDLE_MS } from "../src/flow/lock.js";
import { USER_CHECK_INTERVAL_S } from "../src/flow/roster.js";
import { segments, plain, hasBalancedEmphasis, markedTerms, hasUnconsumedMarks } from "../src/ui/emphasis.js";
import { check, equal, section, done } from "./harness.mjs";
import { coverage } from "./samples.mjs";

/**
 * Every sentence the module can produce. Functions are called with a sample
 * argument, because a template that is only checked when it is rendered is not
 * checked at all.
 *
 * ⚠️⚠️ IT RETURNS WHAT A PERSON READS, NOT WHAT THE SOURCE SAYS, AND ROUND 6 IS WHY.
 * D-110 added `[text](term-id)` markers, so a source string can now read
 * `these same [six digits](six-digits)` where the reader sees `these same six
 * digits`. **Every check in this file that spans a marked word would have started
 * failing against prose that is perfectly correct** — and worse, a rule written to
 * forbid a word could be satisfied by a source in which the word only *looks*
 * absent, or tripped by a term id that no reader ever sees. (Both happened on the
 * first run: `product.what.1` was reported for the lowercase word "key", which
 * appears nowhere in it except as the id inside `[KEY](key)`.)
 *
 * ➡️ So the walker renders. `everySource()` below keeps the raw strings for the two
 * checks that are ABOUT the markup, and nothing else should reach for it.
 *
 * ⭐ THE THIRD ELEMENT IS `"typed"` OR `"built"`, and D-155 added it because one rule
 * needs the distinction. A number word in a fixed sentence is usually the determiner Hannu
 * ruled stays — *"only one tab"*, *"a new one"*. A number word in a sentence assembled from
 * a COUNT is a count by construction, whatever it looks like. Every other check here reads
 * `[path, text]` and is unaffected.
 */
const covered = coverage(copy);
const { rendered } = covered;

function everySentence() {
  const out = [];
  const walk = (value, path) => {
    if (typeof value === "string") out.push([path, plain(value), "typed"]);
    else if (typeof value === "function") {
      // ⚠️⚠️ THE SAMPLES ARE NOT LOCAL ANY MORE, AND THAT IS D-156. They used to be six
      // generic argument lists tried against every function, which reached most singular
      // branches by luck and reached the clock warning's *behind* half never. `SAMPLES` in
      // `test/samples.mjs` names the arguments per path, `coverage()` refuses a literal none
      // of them can produce, and `extract-copy-en.mjs` builds the translators' sheet from
      // the same table — so what a reviewer is shown and what these rules run over are the
      // same set of sentences.
      for (const [, text] of rendered.filter(([p]) => p === path)) out.push([path, plain(text), "built"]);
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`);
    }
  };
  for (const [k, v] of Object.entries(copy)) walk(v, k);
  return out;
}

const all = everySentence();

/**
 * The same strings with their markup intact — for the checks that are ABOUT the
 * markup, and for nothing else. Reaching for this to test prose is how a rule ends
 * up satisfied by a term id instead of by a sentence.
 */
/**
 * Every string literal in a source file, with its `${…}` interpolations removed, so that
 * what comes back is what a person TYPED. Comments are skipped as it walks rather than
 * stripped beforehand — a `//` inside a sentence is prose, not a comment, and a regex
 * that does not know the difference would quietly delete the rest of the line.
 *
 * Returns `[line, digit, text]` for every run of digits that survived.
 */
function typedStrings(fileUrl) {
  const src = readFileSync(fileURLToPath(fileUrl), "utf8");
  const strings = [];
  let i = 0;
  let line = 1;

  const readString = (quote) => {
    let out = "";
    const startLine = line;
    while (i < src.length) {
      const c = src[i];
      if (c === "\n") line++;
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === quote) {
        i++;
        break;
      }
      // An interpolation is CODE. Recurse so that a sentence inside a ternary is still
      // read as prose, while `n === 1` and `slice(0, 16)` are not.
      if (quote === "`" && c === "$" && src[i + 1] === "{") {
        i += 2;
        let depth = 1;
        while (i < src.length && depth > 0) {
          const d = src[i];
          if (d === "\n") line++;
          if (d === "{") depth++;
          else if (d === "}") depth--;
          else if (d === '"' || d === "'" || d === "`") {
            i++;
            readString(d);
            continue;
          }
          i++;
        }
        continue;
      }
      out += c;
      i++;
    }
    strings.push([startLine, out]);
  };

  while (i < src.length) {
    const c = src[i];
    if (c === "\n") {
      line++;
      i++;
    } else if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === "/" && src[i + 1] === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] === "\n") line++;
        i++;
      }
      i += 2;
    } else if (c === '"' || c === "'" || c === "`") {
      i++;
      readString(c);
    } else {
      i++;
    }
  }

  return strings;
}

/**
 * Every run of digits a person TYPED, as `[line, digit, text]`.
 *
 * ⭐ It reads `typedStrings` rather than scanning again, and that sharing is the
 * point: this project has now been bitten twice by two scanners that were supposed
 * to read the same source and did not agree about what a string is.
 */
function typedDigits(fileUrl) {
  const strings = typedStrings(fileUrl);
  typedDigits.lastCount = strings.length;
  // ⚠️ `\b` ON BOTH SIDES. Without it the scan reports the 2 in "Argon2id", which is
  // part of a proper noun — the same reason the old rendered-value scan used them.
  return strings.flatMap(([ln, text]) => (text.match(/\b\d+\b/g) ?? []).map((n) => [ln, n, text]));
}

function everySource() {
  const out = [];
  const walk = (value, path) => {
    if (typeof value === "string") out.push([path, value]);
    else if (value && typeof value === "object" && typeof value !== "function") {
      for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`);
    }
  };
  for (const [k, v] of Object.entries(copy)) walk(v, k);
  return out;
}

/** The sentences a person typed, as opposed to the ones a template produced. */
const literals = everySource();

/** What the reader gets from one string, for the checks that name a key directly. */
const read = (s) => plain(s);

// ================================================== the numbers are the constants

section("the numbers in the prose are the constants");

check("there is prose to check", all.length > 30, `${all.length} sentences`);

// ============================================ every branch is a sentence somebody reads

section("every branch of every built sentence is reachable, and reviewed");

/**
 * ⭐⭐⭐ D-156 — THE COMPLETENESS CHECK COUNTED PATHS AND A READER MEETS BRANCHES.
 *
 * The Finnish closed at *"298 of 298 strings"*, and it was a true statement about the wrong
 * population: the sheet rendered each of the thirteen runtime-built paths ONCE, with one
 * sample argument, so a singular form or a zero form was simply not on it. Seven sentences
 * were invisible that way — including *"no more sets — pick one of these"*, which is not a
 * variant of anything but its own sentence, and the whole *behind*-the-server half of the
 * clock warning.
 *
 * ⚠️⚠️ AND ONE OF THEM WAS WRONG IN ENGLISH ON ITS COMMONEST READING. `deletion.suspect`
 * said *"1 conversations were deleted from another device"*, and `renderQuarantine` passes
 * `pending.length` — one conversation deleted from one other device being the ordinary
 * shape of that event. **The branch nobody had rendered was the branch nearly everybody
 * sees**, and it had been reviewed by twenty-seven rounds of two languages.
 */
equal(
  "⭐⭐⭐ no sentence a function can produce is unreachable by its sample arguments",
  covered.unreached.map(([p, lit]) => `${p}: ${JSON.stringify(lit.slice(0, 40))}`).join(", "),
  ""
);
equal("⚠️ every built sentence has sample arguments", covered.missing.join(", "), "");
equal("⚠️ and no sample arguments are left over for a path that is gone", covered.stale.join(", "), "");

// ⭐ The guard on the guard. `literalsOf` reads a function's own source; if it ever returns
// nothing — a syntax it cannot walk, a rename — the check above passes on an empty list.
check(
  "⚠️ the branch scanner is still reading source, so an empty result means covered",
  rendered.length > 20,
  `${rendered.length} branches rendered from ${Object.keys(copy).length} top-level exports`
);

{
  const ttl = copy.chat.ttl;
  check(`§6.6's window is ${MESSAGE_TTL_S / 3600} hours and the sentence says so`, ttl.includes(`${MESSAGE_TTL_S / 3600} hours`), ttl);

  // ⚠️ The qualifiers are not style. §6.6 says the timer starts at FIRST RECEIPT
  // and that deletion is client-enforced and best-effort — and `vault.js` records
  // why "the next time you open this" belongs in the sentence: `first_seen` is
  // inside the ciphertext, so nothing expires while the app is closed. Without
  // that clause the sentence promises a deletion that does not happen.
  check("⭐⭐ and it says when — after you receive them, not after they were sent", /after you receive them/.test(ttl));
  check("⭐⭐ and that nothing expires while the app is closed", /next time you open/.test(ttl));
  check("and that the two copies are on different clocks", /their own clocks/.test(ttl));
}

check(
  `§7.3.1a's window is ${QUARANTINE_DAYS} days`,
  copy.deletion.quarantineWindow.includes(String(QUARANTINE_DAYS)),
  copy.deletion.quarantineWindow
);

// ⚠️ THE UNIT IS NO LONGER MINUTES AND THIS CHECK IS WHY THAT WAS SAFE TO CHANGE.
// It read `spell(PAIRING_TTL_SECONDS / 60)` and failed the moment D-136 moved the
// constant to 86400 — the sentence said "one day" and the assertion wanted "1440".
// It now goes through `span`, which is the same function the copy uses, so the two
// cannot disagree about the unit while still disagreeing about the number.
check(
  `§3's link lives ${copy.span(PAIRING_TTL_SECONDS)}`,
  copy.pairing.linkIsOnce.includes(copy.span(PAIRING_TTL_SECONDS)),
  copy.pairing.linkIsOnce
);
// ⚠️⚠️ THIS CHECK USED TO ASSERT THE OPPOSITE, and both versions were right on the day
// they were written. It read `!/\d/` — the duration must be SPELLED — because `spell` had
// no word past sixty and a digit appearing here meant the unit had drifted past what the
// lookup table could say. D-153 deleted the table, so a digit no longer signals anything
// and its absence would. What the check is actually for never changed: the sentence must
// show the number, in the unit `span` chose. See D-153 in `src/ui/copy.js`.
check(
  "⭐ and the duration reaches the reader as a digit (D-153)",
  /\d/.test(copy.span(PAIRING_TTL_SECONDS)),
  copy.span(PAIRING_TTL_SECONDS)
);
// ⚠️ D-153 SPLIT THE SENTENCE THIS CHECK WAS READING, and the check moved with the fact
// rather than with the words. What testers got wrong is ONCE and ONE PERSON, and both must
// still lead — they are now the first clause rather than a comma list. ⭐ The duration was
// never part of what this asserts; it is checked against the constant three lines above.
check(
  "and the sentence leads with the two things testers got wrong — once, and only that person",
  /^This invite link works once, and only for the person you send it to\./.test(copy.pairing.linkIsOnce),
  copy.pairing.linkIsOnce
);

// ⚠️ THIS CHECK MOVED IN ROUND 5 AND DID NOT DISAPPEAR WITH THE STRING IT USED TO
// READ. It guards D-064 — the word count on the gate is interpolated from
// `PHRASE_WORDS` and never typed — and `phrase.intro` was merely where that number
// happened to be. It is now read from the paragraph that says it today. **When a
// string is deleted, its checks belong on whatever inherited its job**; deleting
// them with it is how a rule quietly stops being enforced.
// ⚠️ ROUND 6 CHANGED THE GLYPHS AND NOT THE RULE. The paragraph now renders the
// count as a DIGIT — these four are scanned rather than read, and "8" survives a
// glance where "eight" does not — so the check reads `PHRASE_WORDS` directly instead
// of through `spell()`. What D-064 requires is that the number cannot drift from the
// constant, which either form satisfies; requiring one spelling would have been the
// check testing my typography rather than the decision.
check(
  `§7.4's phrase is ${PHRASE_WORDS} words, on the gate`,
  copy.product.what.some((p) => new RegExp(`\\b${PHRASE_WORDS} words\\b`).test(read(p))),
  read(copy.product.what[1])
);
// ⚠️ THIS ASSERTION HAS NOW BEEN REWRITTEN TWICE IN TWO DAYS BY TWO DECISIONS THAT
// DISAGREED, and the second undid the first. D-152 capitalised the sentence, so the check
// grew a `caps(spell(n))`; D-153 made the number a digit, so there is no letter left to
// capitalise. ⭐ It still binds the same fact it bound before either of them — the number
// on this line is `PHRASE_WORDS_LONG` and cannot be typed — which is why it survived both.
check(
  `and the longer one is ${PHRASE_WORDS_LONG}, opening the sentence as a digit`,
  copy.phrase.longPhraseNote.startsWith(`${PHRASE_WORDS_LONG} `),
  copy.phrase.longPhraseNote
);
check(`§7.4's cap is ${MAX_CANDIDATE_SETS} sets`, copy.phrase.capReached.includes(String(MAX_CANDIDATE_SETS)), copy.phrase.capReached);

{
  /**
   * ⭐⭐⭐ THE ONE THAT WOULD HAVE CAUGHT THE §8 DRIFT: a digit somebody TYPED into a
   * sentence, as opposed to one a constant put there.
   *
   * ⚠️⚠️ IT USED TO SCAN THE EVALUATED MODULE AND IT WAS NOT MAKING THAT DISTINCTION.
   * `literals` walks the module after it has run, where a template literal has already
   * become an ordinary string — so `lock.idle` arrived here as finished prose with no
   * record of where its number came from. The check passed anyway, for a reason nobody
   * wrote down: every interpolated number was a WORD, so no digit reached the scan. It
   * was the spelling doing the discriminating, not the check. ⭐ D-153 turned the words
   * into digits and 22 sentences failed at once — which is the check telling the truth
   * about itself for the first time.
   *
   * ⭐⭐ SO IT NOW READS THE SOURCE. A digit a constant put there appears in the RENDERED
   * string and not in the SOURCE; a digit somebody typed appears in both. That is the
   * actual rule, tested directly, and it no longer depends on how numbers are spelled —
   * which is what let one notation change break a check about something else entirely.
   */
  const typed = typedDigits(new URL("../src/ui/copy.js", import.meta.url));

  // ⚠️ `128` is §7.2's bit count inside a term, and `MESSAGE_TTL_S / 3600` is written out
  // where the sentence needs the arithmetic rather than the constant.
  const allowed = new Set([String(MESSAGE_TTL_S / 3600), "128"]);

  // ⚠️⚠️ ONE DIGIT IS EXEMPT AND IT IS NOT A QUANTITY. `code_malformed` tells somebody who
  // mistyped a spoken code that "the digit 1" never appears in one — a claim about
  // `CODE_ALPHABET`, not a count, so it is typed on purpose and must stay typed. Allowing
  // "1" globally would be a real loosening; it is exempt by the sentence it lives in, and
  // the section below checks the claim against the constant. ⭐ D-115 is exactly what an
  // unchecked assertion about an alphabet costs.
  // ⚠️ MATCHED ON THE FRAGMENT, NOT THE SENTENCE. `codeShort` is built from two adjoining
  // string literals and the split falls between "no code " and "contains" — so a pattern
  // written for the whole sentence misses the half the digit is actually in. The scanner
  // reads what was typed, and what was typed is two pieces.
  const namedCharacter = /the digit 1\b|an L or a 1\b/;

  /**
   * ⚠️⚠️ A FIXED COUNT IN A FIXED SENTENCE, exempt BY THE SENTENCE and not by the digit.
   *
   * These three are typed on purpose and there is no constant they could drift from: the
   * situation IS two devices, and the list that follows "3 things" is in the same sentence
   * and can be counted by eye. ⭐ Matching the surrounding words rather than the number
   * makes the exemption rot on its own — reword the sentence and the digit is stray again,
   * which is what went wrong with the clock sentence when its exemption outlived its
   * subject (D-152). Allowing "2" and "3" globally would have hidden the next real one.
   */
  const fixedCount = [
    /^2 devices disagreed about which side/,
    /^2 devices renamed a conversation at the same moment/,
    /It holds 3 things: a \[mailbox\]/,
  ];

  const stray = typed.filter(
    ([, n, text]) => !allowed.has(n) && !namedCharacter.test(text) && !fixedCount.some((re) => re.test(text))
  );
  equal(
    "⭐⭐⭐ no digit is TYPED into a sentence that a constant did not put there (read from the source)",
    stray.map(([line, n]) => `copy.js:${line}:${n}`).join(", "),
    ""
  );

  // ⭐ The guard on the guard. If the scanner ever stops finding string literals at all —
  // a rename, a syntax it cannot walk — the check above passes on an empty list and says
  // nothing. This is what tells us it is still looking at prose.
  check(
    "⚠️ and the source scanner is still reading this file, so an empty result means clean",
    typedDigits.lastCount > 200,
    `${typedDigits.lastCount} string literals read from copy.js`
  );
}

{
  /**
   * ⭐⭐⭐ D-155 — THE OTHER HALF OF D-153'S RULE, WHICH NOTHING HAD BEEN CHECKING.
   *
   * D-153 ruled that a quantity is a digit. The scan above enforces one direction of that:
   * no digit a constant did not put there. ⚠️⚠️ **NOTHING ENFORCED THE OTHER DIRECTION** —
   * a quantity SPELLED OUT is exactly what the ruling forbids, and it would sail through
   * every check in this file. The proof is that one did: `chat.reconnect.some` said *"One
   * conversation cannot receive"* for three days after the sweep, because the sweep searched
   * for the `spell(` helper and that branch had never called it. ➡️ **A SWEEP FOR THE
   * MECHANISM IS NOT A SWEEP FOR THE RULE.**
   *
   * ⚠️ IT IS TWO CHECKS AND NOT ONE, because "one" behaves differently from every other
   * number word. In a fixed sentence it is almost always the determiner — *"only one tab"*,
   * *"pick one of these"*, *"a new one"* — which Hannu's ruling explicitly leaves alone, and
   * demanding an exemption for each of the forty of them would be an allowlist longer than
   * the rule. In a sentence BUILT from a count there is no such ambiguity: the number is the
   * subject of the sentence by construction.
   */
  const NUMBER_WORDS =
    /\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|hundred)\b/i;

  /**
   * ⚠️ THE ONE EXEMPTION, AND IT IS A NAME RATHER THAN A COUNT. Hannu ruled that the
   * verification check is called **six digits** and stays spelled — *"six digits"* is what
   * the button says and what a person says out loud. ⭐ Exempted as the PHRASE, so a future
   * "six days" is still caught; exempting the word would have opened the whole numeral.
   */
  const theName = /six digits/gi;

  const spelled = all.filter(([, text]) => NUMBER_WORDS.test(text.replace(theName, "")));
  equal(
    "⭐⭐⭐ no sentence SPELLS a quantity — D-153's rule, in the direction nothing was checking",
    [...new Set(spelled.map(([p]) => p))].join(", "),
    ""
  );

  /**
   * ⚠️⚠️ AND "one" ON TOP, IN BUILT SENTENCES ONLY. This is the check that catches the
   * defect above; the three exemptions are the fixed halves of built sentences, and each is
   * matched on its surrounding words so that rewording the sentence makes it stray again —
   * the same discipline the `fixedCount` list above records, for the same reason (D-152).
   */
  const determiner = [/only the one code is in the box/, /pick one of these/, /This one is still called/];
  const spelledOne = all.filter(
    ([, text, kind]) => kind === "built" && /\bone\b/i.test(text) && !determiner.some((re) => re.test(text))
  );
  equal(
    "⭐⭐ and a sentence built from a count does not spell it \"one\" either",
    [...new Set(spelledOne.map(([p]) => p))].join(", "),
    ""
  );

  // ⭐ The guard on the guard, twice over. A word list that matches nothing, or a corpus
  // with no built sentences left in it, would make both checks above pass by saying nothing.
  check(
    "⚠️ the word list still matches a number word, and there are built sentences to scan",
    NUMBER_WORDS.test("It lasts seven days") && all.filter(([, , k]) => k === "built").length > 20,
    `${all.filter(([, , k]) => k === "built").length} built sentences`
  );
}

// ======================================================= the claims it may not make

section("the claims the specification forbids");

// Each pattern carries the section that forbids it. A hit is not a style note —
// it is the product telling somebody something that is not true.
const FORBIDDEN = [
  [/zeroi[sz]/i, "§7.7 — memory zeroization is not achievable in JavaScript and claiming it is dishonest"],
  [/every trace|no trace|without a trace/i, "§7.3.1a — the roster records forever that a conversation was deleted, and on which day"],
  [/completely (deleted|removed|erased|gone)/i, "§7.8 — 'unreachable is not erased'; the wording may not promise more than removal from this browser"],
  [/permanently (erased|destroyed)/i, "§7.8 — nothing here observed the browser freeing that memory"],
  [/guaranteed|guarantee/i, "§6.6 — deletion is client-enforced and best-effort, and the copy must not claim otherwise"],
  [/military|bank[- ]grade|unbreakable|100%/i, "§11 — the threat model is a list of things this does NOT protect against"],
  [/anonymous|untraceable/i, "§7.3.3 — `roster_id` is a permanent per-user identifier presented on every read and write"],
  // ⚠️⚠️ §7.6 NAMES THE TWO SENTENCES ITS OWN EARLIER VERSIONS PRINTED, and both are
  // false: `sessionStorage` IS written to disk — Chrome keeps a Session Storage
  // database, Firefox writes session-restore files — and the guarantee is scoped to
  // "nothing written to the roster and nothing recoverable on another device".
  // "This is the feature the highest-risk user is most likely to reach for, so the
  // claim has to be exact."
  [
    /dies with the tab|nothing is (written|saved|stored) to disk|never touches (the |your )?disk/i,
    "§7.6 — Ghost mode's claim is about the roster and other devices, NOT about the disk and NOT about the tab",
  ],
];

for (const [pattern, why] of FORBIDDEN) {
  const hits = all.filter(([, s]) => pattern.test(s));
  equal(why.split(" — ")[0] + " forbids " + pattern.source, hits.map(([p]) => p).join(", "), "", why);
}

// ======================================================== the sentences that must exist

section("the qualifiers that are load-bearing");

check(
  "⭐⭐ §7.3.1a's residual is stated — deletion leaves a dated record of itself",
  /behind your KEY/.test(copy.deletion.trace) && /\bdate\b/.test(copy.deletion.trace),
  copy.deletion.trace
);

/**
 * ⭐⭐ D-149 — THE TWO DISCLOSURES ARE A PAIR AND THIS IS WHAT KEEPS THEM ONE.
 * §7.3.1a's residual has to be stated on BOTH screens that delete: the single-conversation
 * confirmation (`deletion.trace`) and the panic confirmation (`panic.keeps`). Both used to
 * end *"That part cannot be removed."* and both lost it in the same round — but they lost it
 * HOURS APART, because only one of the two was on the contact sheet Hannu reviewed.
 *
 * ⚠️ For those hours the product made one disclosure in two different registers, and nothing
 * could fail. ➡️ **A sentence that appears on two screens is one sentence with two homes.**
 * This check ties them together: the same residual, stated, and neither may take the removed
 * clause back on its own.
 *
 * ⚠️⚠️ D-150 FOUND A THIRD HOME, AND IT IS WHY THE PAIR IS NOW A TRIO. `roster_full` ended
 * *"and the record of what was deleted stays in it"* — the same disclosure, on a screen the
 * other two do not touch, and it was not in this check. It said "it" meaning the list.
 *
 * ⭐⭐⭐ AND ALL THREE WERE POINTING AT THE WRONG THING. They said the LIST records the
 * deletion. Hannu went and looked: *"I have not noticed that a deleted conversation would
 * remain in the list with some remark?"* `openHome()` draws `roster.channels()`, and a
 * tombstone is not a channel — the record is real, permanent and merged to every device, and
 * it is drawn on no screen at all. ➡️ **A disclosure can be true of the data and false of the
 * word it uses for it**, and the word this one used was the reader's word for the screen in
 * front of them. All three now name where the record is rather than a screen it is not on.
 */
check(
  "⭐⭐ D-149 — and the panic screen states the same residual, in the plural",
  /behind your KEY/.test(copy.panic.keeps) && /\bdates\b/.test(copy.panic.keeps),
  copy.panic.keeps
);
check(
  "⭐⭐⭐ D-150 — and `roster_full`, the third home, which is where the residual costs something",
  /leaves its record behind your KEY/.test(copy.roster.failure.roster_full),
  copy.roster.failure.roster_full
);
check(
  "⚠️⚠️ D-150 — and not one of the three tells a reader to look for it in the list",
  ![copy.deletion.trace, copy.panic.keeps].some((s) => /\byour list\b|\bthe list\b/i.test(s)),
  `${copy.deletion.trace}  ‖  ${copy.panic.keeps}`
);
check(
  "⚠️ neither of them claims the record itself can be got rid of, and neither may regain it",
  !/cannot be removed|can be removed/i.test(`${copy.deletion.trace} ${copy.panic.keeps}`),
  `${copy.deletion.trace}  ‖  ${copy.panic.keeps}`
);

/**
 * ⭐⭐⭐ D-151 — THE THIRD READING OF THE SAME TWO SENTENCES, AND THE FAULT MOVED AGAIN.
 * Round 26 took the record off the screen it is not on. Hannu read the repair and found what
 * the repair now implied: *"it means that the user could later check with the KEY when any
 * conversation was deleted. But I do not think that is possible."* It is not — nothing reads
 * a tombstone back out. So the sentence said WHERE truthfully and said RETRIEVABLE by
 * accident. ➡️ **The second reading of a repaired sentence is a different sentence.**
 *
 * ⚠️⚠️ AND THE REPAIR HE PROPOSED WAS ONE PHRASE FROM BEING THE FORBIDDEN ONE. His words
 * were *"it is not shown to anybody"* — which a reader takes as *nobody can ever see it*,
 * and §7.3.1a exists because that is false: a roster compelled open shows every one of these
 * to whoever holds it. "On any screen" is true, is narrower, and is the actual answer to the
 * question he asked. **This check is what keeps the wider claim out**, in either language and
 * in whatever future round shortens these again.
 */
check(
  "⭐⭐⭐ D-151 — both say the record is not DRAWN, and neither says it cannot be SEEN",
  [copy.deletion.trace, copy.panic.keeps].every(
    (s) => /not shown on any screen/.test(s) && !/\b(anybody|anyone|nobody|no one)\b/i.test(s)
  ),
  `${copy.deletion.trace}  ‖  ${copy.panic.keeps}`
);

check(
  "⭐⭐⭐ §7.3.1a's undo says where it puts the conversation back, because it is not the roster",
  /this device only/.test(copy.deletion.undoIsLocal) && /other devices/.test(copy.deletion.undoIsLocal),
  copy.deletion.undoIsLocal
);

check(
  "and a local-only conversation says the same in the chat view",
  /this device only/.test(copy.chat.localOnly) && /cleared/.test(copy.chat.localOnly)
);

check(
  "⭐ §7.2's 404 is a retry and says it creates nothing",
  /does not create a new one/.test(copy.unlock.notFound),
  copy.unlock.notFound
);

check(
  "§7.4's paste dialogue asks rather than scolds",
  !/(risk|dangerous|unsafe|never paste)/i.test(copy.phrase.pasted.body),
  copy.phrase.pasted.body
);

// ================================================ §3.6.2 — what the digits prove

// ⚠️⚠️ THE OLD CHECK HERE ASSERTED THE DEFECT. It required the SAS copy to say
// "read these to each other" and "they must match", which is a description of a
// comparison between two SCREENS — and the digits are equal at both ends of every
// completed handshake, INCLUDING one with an attacker. The first user asked the
// question that found it (D-081): *"is it so that in any case the six digits are
// the same for both participants, and that is not what should be checked?"*
//
// ⭐ Worth keeping as a lesson about tests: this one passed for as long as the copy
// was wrong, because it was written from the same misunderstanding.

section("§3.6.2 — the six digits, and what comparing them proves");

check(
  "⭐⭐ the ask names WHO holds the other six digits, not just that they match",
  // ⚠️ Matched loosely across the noun on purpose. What this check is FOR is that a
  // PERSON is named; round 4's rename to "invite link" broke it while leaving the
  // property it guards entirely intact, which is a test failing for a reason that
  // has nothing to do with what it was written to catch.
  //
  // ⚠️⚠️ AND IT HAPPENED A SECOND TIME, THE OTHER WAY ROUND. The sentence became
  // *"Read these six digits to your friend"* because *"the person you sent the invite
  // link to"* was false for every joiner and for everybody who used a code — and this
  // check, written around the old noun phrase, failed on a strictly better sentence.
  // ➡️ **A check pinned to the words rather than to the property fails on the fix.**
  // It now asserts the property: somebody is named, and it is not the screens.
  /your friend/.test(read(copy.pairing.sas)) && !/match/i.test(read(copy.pairing.sas)),
  copy.pairing.sas
);

// ⚠️⚠️ FOUR OF THE CHECKS BELOW MOVED IN ROUND 6 AND NONE OF THEM WAS DELETED
// (D-107). `sasHow`, `laterNote` and `verification.unverifiedWhat` are gone from the
// surface — the first two folded into `terms["six-digits"]` because three paragraphs
// of guidance do not belong on a screen that asks one question, and the third deleted
// outright on the tester round's instruction (*"do not use this, confused everyone"*,
// D-112). **The properties they guarded did not go anywhere**, so each check now
// reads whichever string inherited its job. Deleting a check alongside the string it
// happened to be pointed at is how a rule quietly stops being enforced.
const sixDigits = copy.terms["six-digits"].body.join(" ");

check(
  "⭐⭐⭐ and it says out loud that both ends always show the same digits",
  /same six digits/.test(read(copy.pairing.sasWhat)) && /same six digits/.test(sixDigits),
  read(copy.pairing.sasWhat)
);

check(
  // ⚠️ Second half re-pointed for the same reason as the check above: the threat is
  // still named, it is simply no longer named as a LINK, because half the pairings
  // this screen now covers were never built from one.
  "⭐⭐ and the surface names the test: is this person your friend, not do the screens agree",
  /is your friend/.test(read(copy.pairing.sasWhat)) && /stole the invitation/.test(read(copy.pairing.sasWhat)),
  read(copy.pairing.sasWhat)
);

// ⚠️ THE OLD FORM OF THIS CHECK READ `/no digits at all/` AND IT GUARDED AN AMBIGUOUS
// SENTENCE. *"If somebody else opened your invite link, that person has no digits at
// all"* means the FRIEND — beaten to the link, left with nothing — but the nearest
// noun phrase is "somebody else", so an ordinary reader takes it to mean the impostor
// has none, which is the opposite of the truth and would teach them to trust matching
// digits. Hannu's rewrite removed it without aiming at it. The property worth keeping
// is the positive one: the check is about a PERSON, and it is stated as such above.
// ⚠️⚠️⚠️ ROUND 7, ITEM 6 — D-081 ARRIVED A THIRD TIME AND NOTHING WAS WATCHING FOR IT.
// The paragraph ended *"The digits are the check that cannot be talked around"*, and
// Hannu's objection is the same one that removed *"they must match"* and rewrote *"the
// person you sent the link to"*: **it makes the reader satisfy themselves about the
// DIGITS, when the thing to be satisfied about is the PERSON holding them.** True about
// the cryptography, wrong about the human, and it read as praise rather than as an
// instruction — which is how it survived two rounds of aiming at exactly this defect.
//
// The property, stated so it cannot come back in other words: on this surface, anything
// called a check names who it is about. The non-vacuity clause matters — if the sentence
// that DOES state the test disappeared, `every` on an empty list would pass happily.
const sasSurface = [read(copy.pairing.sas), read(copy.pairing.sasWhat), sixDigits].join(" ");
const callsItACheck = sasSurface.split(/(?<=[.!?])\s+/).filter((s) => /\bcheck\b/i.test(s));

check(
  "⭐⭐⭐ every sentence here that calls something a check names the PERSON it is about (D-081, three times now)",
  callsItACheck.length > 0 && callsItACheck.every((s) => /person|friend/i.test(s)),
  callsItACheck.join(" ⏐ ") || "(no sentence on this surface calls anything a check)"
);

check(
  "§3.6 permits any channel the attacker does not control, so the copy must not imply a phone call only",
  /in person/.test(sixDigits) && /voice/.test(sixDigits),
  sixDigits
);

check(
  "⭐⭐ an unverified conversation is NOT called insecure — §3.6.2 rule 4",
  !/(insecure|unsafe|not secure|unencrypted|danger)/i.test(`${read(copy.verification.unverified)} ${sixDigits}`),
  `${read(copy.verification.unverified)} ${sixDigits}`
);

check(
  "⭐⭐ and the one specific unproven thing is still named, one layer down",
  /the friend you meant to reach/.test(sixDigits),
  sixDigits
);

// ⚠️⚠️ D-112, AS A CHECK RATHER THAN AS A NOTE. The deleted string opened *"Nothing
// says anything is wrong"* — an abstract subject asserting a negative, which is the
// construction the tester round found. It cannot be caught in general (nothing in a
// build can hear a voice) but it CAN be refused where it has already done damage, so
// the two known instances are named and may not come back.
check(
  "⭐⭐⭐ D-112 — the two sentences the testers rejected may not return, in any string",
  !all.some(([, s]) => /nothing says anything is wrong/i.test(s) || /this design cannot hide it/i.test(s)),
  all.filter(([, s]) => /nothing says anything is wrong|this design cannot hide it/i.test(s)).map(([p]) => p).join(", ")
);

check(
  "⚠️ and `verified` reports what a person did — it may not be upgraded into a cryptographic claim",
  !/(secure|safe|proven|confirmed identity|authenticated)/i.test(copy.verification.verified),
  copy.verification.verified
);

check(
  "⭐ 'not yet' is offered honestly: weaker, and not scolded — D-081",
  /somebody who knows your friend can answer those/.test(sixDigits),
  sixDigits
);

// ============================================ §6.7.1 — the closing notice

// ⚠️⚠️ THE COPY MAY SAY **SENT** AND MUST NOT SAY **SEEN**. §6.7.1 makes this one
// bounded attempt that never delays the removal, so a sentence promising delivery
// would promise the one thing the design deliberately does not do — and there is a
// separate sentence for the attempt that failed, because a person who may need to
// warn somebody by other means has to know which of the two happened.

section("§6.7.1 — the closing notice, and what it may claim");

check(
  "⭐⭐ the failed attempt is reported as a failure, not swallowed",
  /could not be told/.test(copy.closing.notSent) && /still open on their device/.test(copy.closing.notSent),
  copy.closing.notSent
);

check(
  "⚠️ and the deletion happened anyway, which the same sentence says",
  /deleted here/.test(copy.closing.notSent),
  copy.closing.notSent
);

/**
 * ⭐⭐⭐ §6.7.1 RULE 2, WRITTEN FROM THE RULE — AND THE OLD CHECK IS WHY THAT MATTERS.
 *
 * The rule is one sentence: *"One bounded attempt, and a failure MUST NOT block or
 * delay the removal … the copy MUST NOT promise it was delivered."* The check that
 * stood here read `!/(seen|read it|received|delivered|arrived)/` over two strings —
 * a **vocabulary**, not the rule — and directly underneath it `closing.sent` said
 * ***"The other person has been told"***, which promises delivery in words the list
 * did not contain. It passed for as long as it existed. The outside review of
 * 2026-08-24 found four such sentences, and two more guards further down this file
 * were REQUIRING two of them.
 *
 * ⚠️ SO IT IS THE WHOLE FAMILY, NOT TWO STRINGS. Every sentence the product says
 * about a closing notice is scanned: both closing sentences, both panic reports, and
 * the confirmation. A new one is caught by being in the family, not by being added
 * to a list.
 *
 * ⚠️⚠️ AND IT FORBIDS THE CLAIM IN BOTH DIRECTIONS. A send that fails locally cannot
 * tell "never arrived" from "arrived, answer lost", so *"nothing reached them"* is
 * exactly as unsupported as *"they have been told"* — it was in `panic.toldNone`,
 * and no reviewer had ever called it a delivery claim because it reads as modesty.
 */
{
  const CLAIMS_DELIVERY = [
    /\b(has|have|had|was|were|is|are)\s+(been\s+)?(told|informed|notified)\b/i,
    /\bwill\s+be\s+(told|informed|notified)\b/i,
    /\b(seen|read it|received|delivered|arrived|got it)\b/i,
    /\breached\b/i,
    /\bthey (know|knew)\b/i,
  ];
  const family = [
    ["closing.willTell", copy.closing.willTell],
    ["closing.sent", copy.closing.sent],
    ["panic.otherSide", copy.panic.otherSide],
    ["panic.told", copy.panic.told(3, 5)],
    ["panic.toldNone", copy.panic.toldNone],
  ];
  const guilty = family.filter(([, t]) => CLAIMS_DELIVERY.some((re) => re.test(t))).map(([k]) => k);
  equal(
    "⭐⭐⭐ §6.7.1 rule 2 — no closing sentence claims the notice was delivered",
    guilty.join(", "),
    ""
  );

  /**
   * ⚠️⚠️ THE CANARY IS THE FIVE STRINGS THAT SHIPPED, and it is the only thing that
   * proves this guard is stronger than the one it replaced rather than merely
   * differently worded. Each was live in the product on 2026-08-24; each must be
   * caught. A guard for a defect that cannot reproduce the defect is a guess.
   */
  const SHIPPED = [
    "The other person will be told that this conversation has ended.",
    "The other person has been told that you ended the conversation.",
    "The people you were talking to are told that these conversations have ended.",
    "5 conversations deleted, and the other person was told in 3 of them.",
    "Nobody could be told — nothing reached them, and their copies are still open.",
  ];
  const missed = SHIPPED.filter((t) => !CLAIMS_DELIVERY.some((re) => re.test(t)));
  equal(
    `⚠️ and it catches all ${SHIPPED.length} of the sentences this rule was written against`,
    missed.join(" | "),
    ""
  );
}

check(
  "⭐⭐⭐ §6.7.1 rule 6 — the receiver is told their own copy is untouched",
  /still yours/.test(copy.closing.yoursIsYours),
  copy.closing.yoursIsYours
);

check(
  "and the next step is a new conversation, because §3's links are single-use",
  /new conversation/.test(copy.closing.startAnother),
  copy.closing.startAnother
);

check(
  "§7.3.2's weak notice reports rather than reassures",
  /has not seen this list before/.test(copy.list.noHistory("some day", 3)),
  copy.list.noHistory("some day", 3)
);

// ============================================== §7.8 step 3 — the ending's two claims

// ⚠️⚠️ THE STRONG WORDING IS LICENSED BY A MEASUREMENT, NOT BY THE ACTION. §7.8
// permits "removes it from this browser now", and that is a claim about the
// BROWSER — true only when every other client has been reached and confirmed gone.
// `flow/tabs.js` can establish that where Web Locks exists and cannot where it does
// not, and §4.2's own fallback permits a client that cannot be enumerated at all.
// So there are two sentences, and the difference between them is what the section
// is about.

check(
  "⭐⭐⭐ the confirmed ending is the only one that speaks for the browser",
  /every tab of this browser/.test(copy.tabs.endConfirmed),
  copy.tabs.endConfirmed
);

check(
  "⭐⭐⭐ and the unconfirmed one claims this tab and no more",
  /this tab/.test(copy.tabs.endUnconfirmed) && /could not confirm/.test(copy.tabs.endUnconfirmed),
  copy.tabs.endUnconfirmed
);

check(
  "⚠️ and it does not say the conversation was removed from the browser, which is the claim it cannot make",
  !/(removed|gone|cleared) from (every|this browser|all)/i.test(copy.tabs.endUnconfirmed),
  copy.tabs.endUnconfirmed
);

check(
  "⚠️ and neither promises erasure — §7.8: unreachable is not erased",
  ![copy.tabs.endConfirmed, copy.tabs.endUnconfirmed].some((s) => /erase|wipe|destroy/i.test(s))
);

check(
  "⭐ §4.2's follower is described as another tab, never as an error",
  /another tab/.test(copy.chat.otherTab) && !/(offline|disconnected|failed|error)/i.test(copy.chat.otherTab),
  copy.chat.otherTab
);

check(
  "⭐ and a refused send says nothing was sent, because nothing was",
  /Not sent/.test(copy.chat.busyElsewhere) && /again/.test(copy.chat.busyElsewhere),
  copy.chat.busyElsewhere
);

// ================================================= §7.6 — Ghost mode's exact claim

// ⚠️⚠️ §7.6 SPENDS A PARAGRAPH ON THIS AND GIVES ITS OWN REASON: "this is the
// feature the highest-risk user is most likely to reach for, so the claim has to be
// exact." What the mode promises is that nothing is written to the roster and
// nothing is recoverable on another device. The two sentences it does NOT promise
// are barred by the FORBIDDEN table above; these are the ones it MUST make.

section("§7.6 — what Ghost mode may and must say");

check(
  "⭐⭐ the offer states the guarantee: no list, and no other device",
  /list/.test(copy.ghost.what) && /another device/.test(copy.ghost.what),
  copy.ghost.what
);

check(
  "⭐⭐ and the cost is stated in the same breath — D-016's failure with no recovery",
  /gone/.test(copy.ghost.cost) && /no KEY/.test(copy.ghost.cost),
  copy.ghost.cost
);

/*
  ⚠️⚠️⚠️ THE NEXT THREE CHECKS ARE THE ONES THAT KEPT THE FORBIDDEN CLAIM IN PLACE,
  AND THAT IS THE FINDING RATHER THAN A CONSEQUENCE OF IT.

  §7.6: *"Ghost mode's guarantee is 'nothing is written to the roster and nothing is
  recoverable on another device'. It is NOT 'nothing is written to disk', and it is
  NOT 'dies with the tab'."* Until 2026-08-24 the check below **required**
  `/impossible to open/` — the second forbidden sentence, in its strongest form, made
  mandatory by the guard whose stated subject is that exact prohibition. Four
  sentences of Ghost copy said it, one test insisted on it, and the section they all
  cite forbids it.

  ➡️ **A GUARD AND THE THING IT GUARDS CAN AGREE WITH EACH OTHER AND BOTH DISAGREE
  WITH THE SPECIFICATION.** Nothing inside the pair can see it: the copy passes, the
  test passes, and the only witness is the document neither of them re-reads. An
  outside reviewer with §7.6 and no history found it in one pass.

  ⭐ AND THE HARM RAN THE OTHER WAY FROM THE USUAL OVERCLAIM. A person told the
  conversation is impossible to open closes the laptop and walks away; Firefox's
  session restore brings the tab back — measured in §7.6, surviving a full browser
  restart — and hands the next person the root, the messages and the ratchet.
*/

/**
 * Does this sentence CLAIM the conversation cannot be opened again? §7.6 forbids it
 * of every sentence about the tab going away.
 *
 * ⚠️ IT IS NOT APPLIED TO `endConfirm`, AND THE EXCEPTION IS THE WHOLE POINT OF THE
 * REPAIRED COPY. §7.8's ending clears `sessionStorage` itself (`flow/ending.js` step
 * 3), so after the deliberate ending the claim is TRUE — and the new sentences send
 * the reader there precisely because it is the one act that earns it.
 */
const claimsUnopenable = (text) =>
  /(impossible to open|cannot be opened|can never be opened|nothing can (bring|reopen)|gone for good|lost for good|for good —|loses it for good)/i.test(
    text
  );

/**
 * Does it CLAIM erasure — as opposed to denying it?
 *
 * ⚠️⚠️ CLAUSE BY CLAUSE, BECAUSE A WORD LIST CANNOT SEE A NEGATION. The check this
 * replaces read `!/(erase|erased|wiped|deleted|disappear)/i`, so the true sentence
 * *"it is not erased"* failed it exactly as hard as the false one it was written to
 * catch. ➡️ **A PATTERN THAT DOES NOT NOTICE A NEGATION FORBIDS THE HONEST SENTENCE
 * TOO** — met twice in one day on 2026-08-24, here and in `!isGhost()`.
 */
const claimsErasure = (text) =>
  text
    .split(/[.;—:]/)
    .some((clause) => /\b(erase[sd]?|wipe[sd]?|scrubbed|shredded|destroyed|disappears?)\b/i.test(clause) &&
      !/\b(not|never|no|without)\b/i.test(clause));

const TAB_LOSS = {
  offer: copy.ghost.offer,
  offerWhat: copy.ghost.offerWhat,
  what: copy.ghost.what,
  cost: copy.ghost.cost,
  notErased: copy.ghost.notErased,
};

for (const [name, text] of Object.entries(TAB_LOSS)) {
  check(`⛔⛔ \`ghost.${name}\` does not say the conversation becomes impossible to open (§7.6)`,
    !claimsUnopenable(text), text.slice(0, 90) + "…");
  check(`⛔ \`ghost.${name}\` does not claim erasure either`, !claimsErasure(text));
}

// ⚠️ AND THE FACT THAT REPLACES IT MUST BE PRESENT SOMEWHERE, or the copy has simply
// gone quiet about the thing a person can act on. §7.6's measured residual is that a
// browser which restores sessions can bring the conversation back on THIS device.
check(
  "⭐⭐⭐ and the copy says what §7.6 measured instead: a restoring browser can bring it back",
  [copy.ghost.cost, copy.ghost.notErased].every((t) => /(reopen|reopens|restore|open it again)/i.test(t)),
  copy.ghost.cost
);

// ⚠️ THE LOSS IS STILL WARNED ABOUT. D-016 measured five testers out of five losing
// the tab, so a repair that removed the warning along with the overclaim would be a
// different defect with better paperwork.
check(
  "⭐⭐ while the cost is still stated plainly — the warning was never the problem",
  /(usually|almost always|expect)/i.test(`${copy.ghost.offer} ${copy.ghost.offerWhat} ${copy.ghost.cost}`),
  copy.ghost.offer
);

check(
  "⭐⭐⭐ and it puts the leftover bytes on the person's own device, because that is §7.6's residual",
  // ⚠️ D-112 REVERSED THIS SENTENCE AND THE CHECK FOLLOWED THE PROPERTY, NOT THE
  // WORDS. It used to require the literal "not erasure" — an abstract subject
  // announcing a negative, met before the reader had been told what the thing IS.
  //
  // ⚠️⚠️ AND THEN ROUND 7 REWROTE THE SENTENCE AND THIS CHECK FAILED ANYWAY (D-119).
  // The comment above says the check follows the property, and one of its clauses was
  // still a word: `/disk/`. Hannu's rewrite says "your device" — the same residual, in
  // the noun a phone user actually thinks in. So the WORD moved and the property did
  // not. ➡️ A NOTE CLAIMING A CHECK IS PROPERTY-SHAPED IS NOT A CHECK THAT IT IS, and
  // this one was three-quarters true, which is the hardest kind to notice.
  //
  // Re-pointed, not relaxed (D-107): it now requires BOTH halves of §7.6's honest pair
  // — the bytes stay, and unreachability is all that is claimed — where it used to
  // accept either half on its own.
  // ⚠️ THE THIRD CLAUSE USED TO BE `/impossible to open/` — see the block above. It is
  // replaced by the fact §7.6 actually measured, not deleted: a sentence that dropped
  // the false claim and said nothing in its place would leave the reader with no
  // reason to use the ending control.
  /disk|your device/.test(copy.ghost.notErased) &&
    /not scrubbed|rather than scrubbed/.test(copy.ghost.notErased) &&
    /(reopen|open it again)/i.test(copy.ghost.notErased) &&
    !claimsErasure(copy.ghost.notErased),
  copy.ghost.notErased
);

check(
  "§7.8's permitted wording, and the Kept reassurance is REPLACED rather than dropped",
  /removes it from this browser now/.test(copy.ghost.endConfirm) && /nothing can reopen it/.test(copy.ghost.endConfirm),
  copy.ghost.endConfirm
);

// ⚠️⚠️ THE ENDING PAGE IS SHARED AND ITS SECOND SENTENCE IS NOT. `ending.needsPhrase`
// is Kept mode's reassurance; a Ghost session lands on the same page with no phrase
// and nothing to reopen, so the two sentences must say opposite things and the
// fragment must carry which one applies (0.8.14, `flow/ending.js`).
check(
  "⭐⭐⭐ the Ghost ending page does not promise a phrase, because there is none",
  !/phrase to|your .* words|type/i.test(copy.ghost.endedNothingToReopen) && /nothing to open it with/.test(copy.ghost.endedNothingToReopen),
  copy.ghost.endedNothingToReopen
);
check(
  "while the Kept one still names the words, which is the point of having two",
  /words/.test(copy.ending.needsPhrase),
  copy.ending.needsPhrase
);

// ⚠️⚠️ RE-POINTED, NOT DELETED (D-107, D-148). `ghost.duplicatedWhy` is gone — the
// two readers of round 24 called the mechanism *"too complicated and not needed"* — but
// the PROPERTY it carried is not a wording preference: a person on this screen has to be
// told which of the two tabs works, or the screen is an accusation with no exit. That
// sentence now lives in `ghost.duplicated`, and so does this check.
check(
  "⭐ §7.6's duplicated tab is told which tab works, not that something went wrong",
  /working tab/.test(copy.ghost.duplicated) && !/went wrong|error|failed/i.test(copy.ghost.duplicated),
  copy.ghost.duplicated
);

check(
  "⭐⭐ and removing the copy says it does not reach the tab that has the conversation",
  /not affected/.test(copy.ghost.duplicatedEndNote),
  copy.ghost.duplicatedEndNote
);

// ============================================ §4.3 — a cover is not a lock (D-073)

// ⚠️⚠️ THE TWO WORDS CARRY A REAL DIFFERENCE AND THE COPY IS THE ONLY PLACE IT IS
// VISIBLE. Lifting a Kept lock costs an Argon2id derivation from a phrase only the
// user has; lifting this costs a click, because §7.6 leaves nothing to ask for.
// Calling both "locked" would be the strongest false claim in the product's copy.

section("§4.3 — Ghost mode's cover, which is not a lock");

for (const [name, sentence] of [["idle", copy.lock.coveredIdle], ["blurred", copy.lock.coveredBlurred]]) {
  check(
    `the ${name} cover does not call itself a lock`,
    !/lock/i.test(sentence) && /Covered/.test(sentence),
    sentence
  );
}

check(
  "⭐⭐⭐ and it says out loud that anybody can lift it",
  /Anybody using this device can show it again/.test(copy.lock.coveredWhat),
  copy.lock.coveredWhat
);

// ⚠️⚠️⚠️ DELETED, NOT RE-POINTED, AND THAT IS THE UNUSUAL CASE (D-148). The check
// read *"and points at the ending, which is the control that actually does something"*,
// over `/end the conversation/i` in `lock.coveredWhat`. The sentence it guarded was *"If
// the device is not in your hands, end the conversation."* Hannu: *"How can the user read
// that if the device is not in the user's hands?"*
//
// ⭐ So the check was enforcing an instruction that by its own condition reaches nobody —
// whoever is reading it is holding the device, and if they are not, the reader is whoever
// took it. There is no property left to move: this is a test that was WRONG to pass, and
// D-107's "move the check with the content" does not apply when the content should never
// have been there. ⚠️ The check above it — that the cover says out loud anybody can lift
// it — is the one that carries §4.3's honesty, and it is untouched.

check(
  "⚠️ while the Kept lock still says the passphrase is what comes back",
  /Type your KEY/.test(copy.lock.idle) && /Type your KEY/.test(copy.lock.blurred)
);

{
  // The two thresholds are §4.3's, in milliseconds, and `copy.js` has a separate
  // helper for them precisely because passing them to the seconds one produced
  // "Locked after 10000 minutes without use" on this suite's first run.
  const idle = copy.lock.coveredIdle;
  const blurred = copy.lock.coveredBlurred;
  check(`§4.3's idle threshold is ${IDLE_MS / 60000} minutes`, idle.includes(String(IDLE_MS / 60000)), idle);
  check(`§4.3's blur threshold is ${BLUR_MS / 60000} minute`, blurred.includes(String(BLUR_MS / 60000)), blurred);
}

// ==================================================== §0.2's one sentence to a person

section("§0.2 — what the primitive check may say when it fails");

{
  const shown = `${copy.primitives.missing} ${copy.primitives.what}`;

  // ⚠️ The failure is at BOOT, before an unlock, so it has touched nothing. But
  // "this app cannot start" reads like "this app deleted itself" to somebody whose
  // conversations live on this device, and the halt screen is the only place that
  // can say otherwise.
  check(
    "⭐⭐ it says nothing on this device was changed",
    /nothing already on this device has been changed/i.test(shown),
    shown
  );

  check(
    "⭐ and it says what to do, because 'this browser is too old' is actionable",
    /updating this browser|different one/i.test(shown),
    copy.primitives.what
  );

  // The names belong in the detail line under the message (`failcode`), which is
  // where `reason:` already lives for pairing failures. A person cannot act on
  // "X25519"; a tester reporting the device can.
  check(
    "⚠️ and it does not name an algorithm at a person who cannot act on one",
    !/x25519|ed25519|webcrypto|wasm/i.test(shown),
    shown
  );

  // It is a halt, not an ending. Nothing was cleared, so nothing may be implied.
  check(
    "⚠️ and does not describe itself as an ending or a wipe",
    !/deleted|erased|wiped|cleared/i.test(shown),
    shown
  );
}

// ============================ THE GATE ITSELF — no sentence may live in the HTML

/**
 * ⚠️⚠️⚠️ THIS SECTION IS THE POINT OF THE WHOLE FILE, AND IT DID NOT EXIST UNTIL
 * 2026-08-13.
 *
 * `ui/copy.js` opens with *"every sentence the product says to a person, in one
 * place."* **It stopped being true at build step 8** — the step that built the
 * interface, which is the step most likely to write prose — and eighteen
 * user-facing strings went straight into `app/index.html` instead. Nothing failed.
 * Nothing could: this suite read the module and never looked at the page.
 *
 * ⭐ Then the first person outside this project spent an evening with the live
 * site and sent sixteen observations, and they sorted **perfectly** by that line.
 * Every complaint that text *reads badly, is not understandable, is the wrong
 * word* pointed at one of the eighteen escapees. Every complaint about a string
 * inside `copy.js` was a different and milder one — *true, but it does not tell me
 * enough.*
 *
 * ➡️ **A central copy file is not a filing convention, it is a review gate, and a
 * gate has to be enforced rather than offered.** So this reads the shipped HTML,
 * pulls out every text node and every `placeholder`, and fails on anything this
 * module did not produce.
 */

section("the copy gate — nothing user-facing may be written into the HTML");

const appDir = fileURLToPath(new URL("../app/", import.meta.url));
const pages = ["index.html", "ended.html"].map((name) => [name, readFileSync(appDir + name, "utf8")]);

/** Everything `ui/copy.js` can produce, as a set of exact strings. */
const produced = new Set(all.map(([, s]) => s.trim()).filter(Boolean));

/**
 * The masthead is the ONE exception, and it is checked rather than allowed.
 *
 * ⚠️ It is static text on purpose — it is the thing that should still be on
 * screen if the module fails to load — so it cannot come from `copy.js` at
 * runtime. What closes the loop is asserting the two are the same.
 */
for (const [name, html] of pages) {
  check(
    `${name} — the masthead is the product name (D-083), not the protocol token`,
    html.includes(`<h1 class="wordmark">${copy.product.name}</h1>`),
    copy.product.name
  );

  /**
   * ⚠️⚠️ THE GLOSS IS `index.html`'s ALONE, AND ASKING BOTH PAGES FOR IT WAS THE BUG.
   * It explains the name to a first-time reader, and `app.css` hides it on
   * `html[lang="fi"]` because it is a tautology to a Finn. This loop required it on
   * `ended.html` too — a page reachable only by ending a session, with no
   * render-blocking language boot to make the Finnish rule apply before first paint.
   * So the check that was supposed to protect the masthead was holding an English
   * sentence in place on the one page where it was both useless and wrong. Found by
   * the 2026-08-24 outside review.
   *
   * ⭐ Stated as a rule about WHERE, not as an exemption for a filename: the gloss
   * belongs where somebody meets the product for the first time, and there is
   * exactly one such page.
   */
  const introduces = name === "index.html";
  check(
    `${name} — ${introduces ? "explains the name to a first-time reader" : "does not re-explain the name on the way out"}`,
    html.includes(`<p class="gloss">${copy.product.gloss}</p>`) === introduces
  );
  check(`${name} — and \`lpm\` is not shown to anybody as a heading or a title`, !/<title>[^<]*\blpm\b|<h1[^>]*>\s*lpm\s*</i.test(html));
}

/**
 * ⚠️ THE EXTRACTION IS DELIBERATELY CRUDE AND DELIBERATELY OVER-EAGER. A parser
 * that "knows" which elements are user-facing is a parser with an opinion about
 * where prose is allowed, and the escape it has to catch is prose turning up
 * somewhere nobody expected. Comments and `<script>`/`<style>` bodies are removed
 * because they are not shown; everything else between tags counts.
 */
function visibleText(html) {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");
  return [...stripped.matchAll(/>([^<>]+)</g)]
    .map((m) => m[1].replace(/\s+/g, " ").trim())
    .filter((s) => /[A-Za-z]/.test(s));
}

/** Attributes a person reads. `placeholder` is the one this interface uses. */
function visibleAttributes(html) {
  return [...html.matchAll(/\bplaceholder="([^"]*)"/g)].map((m) => m[1].trim()).filter(Boolean);
}

for (const [name, html] of pages) {
  const strays = [...visibleText(html), ...visibleAttributes(html)].filter(
    (s) => !produced.has(s) && s !== copy.product.name && s !== copy.product.gloss
  );
  equal(
    `⭐⭐⭐ ${name} says nothing that \`ui/copy.js\` did not write`,
    strays.join(" | "),
    "",
    "Move the sentence into `ui/copy.js` and set it with `text(id, …)` at boot. " +
      "See D-083 and the header of `src/ui/copy.js` — this is the check that did not exist " +
      "while eighteen strings walked past the gate."
  );
}

// ⭐ And the same rule one level in: the modules that draw the interface must not
// type a sentence either. `app.js` had four of them (a progress step, a prompt, a
// notice and two list labels), which is how "the copy is all in one file" stayed
// approximately true while being false.
{
  /**
   * ⚠️⚠️ THIS CHECK USED TO TEST A SHAPE AND IS NOW WRITTEN AS THE RULE, and the
   * difference was five sentences. It read
   *
   *     matchAll(/"([A-Z][^"\\]{12,})"/g)
   *
   * — a DOUBLE quote, a leading CAPITAL, at least TWELVE characters — which is the
   * shape of the four strings that were found when it was written, and not the shape
   * of the rule it is labelled with. `` `not sent: ${err.message}` `` walked past it
   * for three independent reasons at once, and so did D-085's four build-line
   * sentences, which start with an interpolation. Any one of the three would have
   * been enough to hide them. The 2026-08-24 outside review found the first; widening
   * this to the rule found the other four the same minute.
   *
   * ⭐ So: EVERY string literal, whatever its quotes, wherever its capitals, however
   * short — and "is it prose?" asked of the words rather than of the punctuation.
   * `typedStrings` walks the source rather than stripping comments beforehand, which
   * is what stops an apostrophe in a comment from being read as an opening quote.
   */
  /**
   * ⚠️⚠️ TWO WORDS, NOT THREE, AND THE THIRD IS WHAT LET THE BUG THROUGH TWICE.
   * `` `not sent: ${err.message}` `` reduces to `"not sent: "` once the interpolation
   * is blanked — TWO words. The first widening of this check kept a three-word
   * threshold, and the mutation test put the exact reported string back and PASSED.
   * Widening three axes and leaving a fourth is not widening; it is moving where the
   * hole is. Written down because it happened here, one screen below a comment
   * warning about exactly this.
   */
  const prose = (text) =>
    text
      .trim()
      .split(/\s+/)
      .filter((w) => w.length >= 2 && /^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'’,.:;!?-]*$/.test(w)).length >= 2;

  /**
   * ⚠️ THE ONE EXCLUSION, AND IT IS A CATEGORY RATHER THAN A LIST OF FILENAMES OR
   * LINE NUMBERS. An `Error` message is not interface prose: nothing renders it, and
   * `app.js` explicitly shows `primitives.reason` in `#failcode` while the throw
   * beside it carries the developer's half. Excluding by CONSTRUCT means a new throw
   * is covered and a new sentence is not, which an allowlist could not promise.
   */
  const thrown = (src, line) => /\b(new [A-Za-z]*Error|throw)\b/.test(src.split("\n")[line - 1] ?? "");

  /**
   * ⚠️ NOT PROSE, AND EACH IS A CONSTRUCT RATHER THAN A LINE NUMBER. A class list is
   * CSS; a `b64uDecode` label names the field for the decode error that quotes it.
   * Neither is a sentence anybody reads on a screen.
   */
  const machine = (src, line) => {
    const l = src.split("\n")[line - 1] ?? "";
    return /\bclassName\b|\bclassList\b/.test(l) || /\bb64uDecode(Exact)?\(/.test(l);
  };

  /**
   * ⚠️⚠️ THE DIAGNOSTICS READOUT IS ENGLISH BY DECISION, AND THIS IS THAT DECISION
   * WRITTEN DOWN RATHER THAN A HOLE. D-085's panel is a fixed-width technical
   * readout whose FIELD LABELS — `build`, `boot`, `key`, `link`, `proof`, `problem`,
   * `curve`, `screen`, `browser` — are English and typed in `app.js`. Translating the
   * values beside them while the labels stayed English would produce a half-Finnish
   * table, which is worse for the tester reading it out than a consistently English
   * one. The panel's SENTENCES are a different matter and did move: the build line
   * tells a person to reload the page, and `diagnostics.notDerived` / `proofAt` are
   * phrases rather than measurements — all of them are in `copy.js` and translated.
   *
   * ⚠️ Scoped to the two functions that BUILD the readout, so a sentence typed
   * anywhere else in `app.js` is still caught. If the panel should become Finnish,
   * this exclusion is the one place to delete.
   */
  const readout = (src, line) => {
    const l = src.split("\n")[line - 1] ?? "";
    // A value WRITTEN into the `measurements` record, which nothing but the readout
    // renders. Written at the moment it is measured and read a screen away, so the
    // enclosing-function test below cannot see it.
    if (/\bmeasurements\.\w+ = \{/.test(l)) return true;
    const before = src.split("\n").slice(0, line).join("\n");
    const fn = before.lastIndexOf("function ");
    return /^function (renderDiagnostics|describeProblem)\b/.test(before.slice(fn, fn + 40));
  };

  let excluded = 0;
  for (const name of ["app.js", "ended.js"]) {
    const src = readFileSync(appDir + name, "utf8");
    const sentences = typedStrings(new URL(`../app/${name}`, import.meta.url))
      .filter(([line, text]) => {
        if (!prose(text) || produced.has(text.trim())) return false;
        if (thrown(src, line) || machine(src, line) || readout(src, line)) {
          excluded++;
          return false;
        }
        return true;
      })
      .map(([line, text]) => `${name}:${line} ${text.trim().slice(0, 56)}`);
    equal(`⭐⭐ and \`app/${name}\` does not type a sentence of its own`, sentences.join(" | "), "");
  }

  /**
   * ⚠️⚠️ AND THE OTHER DIRECTION, WHICH IS HOW AN EXCLUSION ROTS INTO A BLANKET. If
   * the throw-shaped strings ever stop existing, or the pattern stops matching them,
   * this drops to zero and the exclusion is silently covering nothing — or, worse,
   * has been widened to cover everything. Either way it should be looked at rather
   * than trusted.
   */
  check(
    "⚠️ the three exclusions still match something, and still only a little",
    excluded >= 3 && excluded <= 20,
    `${excluded} excluded as throws, class lists, decode labels or the diagnostics readout`
  );
}

// ================================== §4.3's thresholds, which moved on 2026-08-13

// ⚠️ D-082. The blur threshold was 60 seconds and it locked people out in the
// middle of §3's own flow — create a link, LEAVE THIS APP to send it, come back.
// The plural is computed for the same reason the number is: "one minute" would
// have survived the change to five silently.

section("§4.3 — the thresholds, and the sentences that carry them");

{
  const blurred = copy.lock.blurred;
  check(
    `⭐ the blur sentence agrees with the constant, plural and all (${BLUR_MS / 60000})`,
    blurred.includes(copy.plural(BLUR_MS / 60000, "minute")),
    blurred
  );
  check(`§4.3's idle threshold is ${IDLE_MS / 60000} minutes`, copy.lock.idle.includes(String(IDLE_MS / 60000)), copy.lock.idle);
}

// ============================ §5.1.1 and §5.4.1 — what the server holds, said out loud

// ⚠️ FEEDBACK 3, 4, 5 AND 7 WERE ONE HOLE FOUND FROM FOUR DIRECTIONS: the product
// described the BROWSER in forensic detail and the server not at all. These four
// sentences are the answer, and `metadata` is the one that must never be dropped
// as an afterthought — three reassuring sentences with nothing after them would be
// the product overclaiming by omission.

section("what the server holds, in sentences a person asked for");

check(
  "⭐⭐ it says the server cannot read it, and WHY — nothing that could open it reaches there",
  // ⚠️ IT USED TO REQUIRE THE WORD "key" AND D-109 SWEPT THAT WORD OFF THE SURFACE.
  // The property is unchanged and is the important half: the sentence may not stop
  // at "cannot read", it has to say what makes that true. A check written against
  // the old noun would now fail on prose that states the same fact more clearly.
  /cannot read your conversation/.test(read(copy.server.cannotRead)) &&
    /Nothing that could open it ever reaches/.test(read(copy.server.cannotRead)),
  read(copy.server.cannotRead)
);

check(
  `⭐ §5.4.1's deletion-on-collection and §5.1.1's ${(2 * EPOCH_SECONDS) / 86400}-day expiry are both stated`,
  /collected it/.test(copy.server.whenItGoes) && copy.server.whenItGoes.includes(String((2 * EPOCH_SECONDS) / 86400)),
  copy.server.whenItGoes
);

/**
 * ⭐⭐⭐ §5.4's PROMISE IS A FLOOR, AND THE COPY USED TO QUOTE THE CEILING.
 *
 * Both sentences said the uncollected message goes *"when the mailbox is recycled,
 * 14 days later"* — and §5.1.1's clock starts at the MAILBOX's creation, not the
 * message's. A message sent late in a mailbox's life gets nearer §5.4's *"at least
 * 7 days"* than the 14 it was shown, so a person who came back on the eighth day
 * expecting the number in front of them would find the message gone. The sentence
 * was defensible read carefully and wrong read normally, which is the worse of the
 * two failures for copy.
 *
 * ⚠️ THE CHECK IS THE FLOOR AND THE REFERENCE POINT, NOT THE WORDING. Any sentence
 * quoting the ceiling must say what it is measured from; the number a person can
 * rely on is the floor, so the floor has to be present at all.
 */
{
  const floor = String(EPOCH_SECONDS / 86400);
  const ceiling = String((2 * EPOCH_SECONDS) / 86400);
  const retention = [
    ["server.whenItGoes", copy.server.whenItGoes],
    ["terms.server.body[2]", read(copy.terms.server.body[2])],
  ];
  for (const [path, text] of retention) {
    check(
      `⭐⭐ \`${path}\` gives the ${floor}-day floor §5.4 actually promises`,
      new RegExp(`at least ${floor} days`).test(text),
      text
    );
    // ⚠️ The ceiling may still appear — it is true and it is useful — but never as a
    // bare "N days later", which attaches it to the message the reader is thinking about.
    check(
      `⚠️ and its ${ceiling}-day figure names what it is measured from`,
      !text.includes(ceiling) || /mailbox was made|mailbox was created/.test(text),
      text
    );
  }
}

// ⚠️ ROUND 4 CUT *"and it is not nothing"* AND THIS CHECK USED TO REQUIRE THOSE
// WORDS. The requirement is not the phrase — it is that the paragraph does not
// stop at the fact. It must name the metadata AND say that this design does not
// remove it, in whatever words; a check written against one wording turns a copy
// improvement into a failing suite and teaches people to edit the test.
check(
  "⭐⭐⭐ and the limit is stated in the same breath — the metadata paragraph does not stop at the fact",
  // ⚠️ AND ROUND 6 CHANGED IT AGAIN, FOR THE OPPOSITE REASON (D-112). "This design
  // cannot hide it" satisfied this check and failed its readers — *"my friends asked
  // whether an AI wrote that, and they start to wonder what the design should be
  // hiding."* So the obligation is now stated as what it always was: the paragraph
  // must say that the metadata cannot be removed AND why, and it may not do it by
  // announcing a negative about ourselves.
  /metadata/.test(read(copy.server.metadata)) &&
    /has to know that much/.test(read(copy.server.metadata)) &&
    !/this design cannot hide/i.test(read(copy.server.metadata)),
  read(copy.server.metadata)
);

// ⭐⭐ ROUND 7, ITEM 2 — HE HAD TO ASK. *"How long is that metadata kept on the server
// and when deleted?"* Every number was in PROTOCOL.md §5.1.1 and §5.4, the screen above
// states them for MESSAGES, and the panel a worried reader opens to find out what
// metadata even means answered neither question. ➡️ The paragraph that raises a worry
// has to carry the answer to the question it raises; a reader does not go looking two
// panels over. Nothing in a build can notice a missing answer, so this check is what
// notices from now on.
//
// ⚠️ The number is not transcribed anywhere — both strings interpolate MAILBOX_LIFE_S —
// so this asserts the two panels agree with each other AND with the constant.
const metadataTerm = copy.terms.metadata.body.join(" ");

check(
  `⭐⭐ the metadata panel says WHEN it goes: on collection, and at the ${(2 * EPOCH_SECONDS) / 86400}-day floor`,
  /deleted/.test(metadataTerm) &&
    /collects it/.test(metadataTerm) &&
    metadataTerm.includes(String((2 * EPOCH_SECONDS) / 86400)),
  metadataTerm
);

check(
  // ⚠️⚠️ THIS CHECK EXISTS TO STOP A TRUE SENTENCE FROM BEING WIDENED INTO A FALSE ONE.
  // The honest claim is about the database, which deletes on collection or at the floor.
  // A claim about the whole machine — "nothing keeps a history of what arrived when" —
  // was false on the day this was written: the web server in front of the app was
  // logging a client IP address beside a mailbox id every time a stream broke, retained
  // for weeks. Widening this paragraph is allowed only after that is fixed AND measured,
  // and this check is here so the widening cannot happen by accident in between.
  "⚠️⚠️ and it does NOT claim the whole machine keeps no history — that is a log claim, not a database one",
  !/(nothing|no record|nowhere).{0,40}(history|kept anywhere|anywhere else)/i.test(metadataTerm),
  metadataTerm
);

check(
  "⚠️ §7.3's roster IS kept centrally and the copy says so rather than letting 'nothing is stored' be inferred",
  /kept on the server/.test(copy.server.list) && /cannot read that either/.test(copy.server.list),
  copy.server.list
);

// ============================================ D-083 — the answer to "what is this?"

section("the four sentences a person can repeat to a friend");

check("there are four of them and they are short", copy.product.what.length === 4);

// ⚠️⚠️ THE CHECK MOVED AND THE FACT DID NOT LEAVE THE PRODUCT (D-107). Phase 0.5
// measured people trying to reuse an invite link, so "one person, once" has been the
// lead fact ever since. Round 6 shortened this paragraph to *"an invite link that can
// be opened only once"* and put the full statement one layer down.
//
// ⭐ THAT IS THE RIGHT PLACE FOR IT, AND THE REASON IS WHEN EACH IS READ. This
// paragraph is met BEFORE anybody has a link; `pairing.linkIsOnce` is read while
// holding one, which is where the misunderstanding actually happens — and that
// string still opens *"This invite link works once, for one person"*, checked above.
check(
  "⭐ the opening still says an invite link is single-use, and the full fact is one tap away",
  copy.product.what.some((p) => /opened only once/.test(read(p))) &&
    /One person can open it, once/.test(copy.terms["invite-link"].body.join(" ")),
  copy.product.what.map(read).join(" ")
);

check(
  "⚠️ and none of them claims nothing is stored centrally, because §7.3's roster is",
  !/nothing is stored|no central|nothing central/i.test(copy.product.what.join(" ")),
  copy.product.what.join(" ")
);

/**
 * ⭐⭐⭐ D-148, AND IT IS THE GATE'S FIRST RETENTION PROMISE. Round 24 shortened this
 * paragraph to *"Old conversations are saved behind your KEY"*, and Hannu read the result
 * back the way a stranger would: *"I did not notice that it states anywhere how long the
 * messages are saved."* He was right — `chat.ttl` says it INSIDE a conversation, which is
 * after the decision, and the shortened sentence was true of the conversation and read as
 * a promise about its messages.
 *
 * ⚠️ So the number is checked in BOTH units, because that is the failure this file is for:
 * the gate says it in days and `chat.ttl` says it in hours, and they are one constant. A
 * change to `MESSAGE_TTL_S` that reached only one of them would leave two true-looking
 * sentences disagreeing, on screens a person meets ten minutes apart.
 */
{
  const gate = copy.product.what.map(read).join(" ");
  check(
    "⭐⭐ the gate says how long messages last, and says it from the constant",
    new RegExp(`auto-delete after ${copy.span(MESSAGE_TTL_S)}\\.`).test(gate),
    gate
  );
  check(
    "⚠️ and `chat.ttl` says the same constant in hours, so the two cannot drift apart",
    new RegExp(`\\b${Math.round(MESSAGE_TTL_S / 3600)} hours\\b`).test(read(copy.chat.ttl)),
    read(copy.chat.ttl)
  );
}

// ================ every failure the flow can raise has a sentence (feedback 13)

/**
 * ⚠️⚠️⚠️ THIS IS THE CHECK THAT WOULD HAVE CAUGHT **"429 rate_limited"** BEFORE A
 * PERSON DID.
 *
 * `app.js` picks the sentence with `copy.pairing.failure[err.reason]`. A lookup
 * table keyed by an error code **fails silently on the code nobody thought of** —
 * there is no compiler, no type and no test standing between a new `PairFailure`
 * reason and a screen with the exception's own message on it. §9.2's limiter
 * refused a burst of clicks exactly as designed, and the product reported it as a
 * crash with an HTTP status in it.
 *
 * ⭐ So the reasons are read out of `flow/pair.js` — the source of truth is the
 * code that RAISES them, never a list kept beside the copy, because a list beside
 * the copy drifts in precisely the way this test exists to stop. Writing it found a
 * second gap immediately: `server_state` had been raised since the module was
 * written and had never had a sentence.
 */
section("§3 — every failure reason the pairing flow can raise has a sentence");

/**
 * Read every reason `Class` is constructed with, anywhere in `file`.
 *
 * ⚠️⚠️ THE `\s*` IS THE WHOLE POINT AND IT WAS NOT THERE YESTERDAY. This test was
 * written against `new PairFailure("reason"` on one line, which is the shape
 * prettier produces when the message is short. Five of the thirteen constructions
 * in `flow/pair.js` wrap — the reason sits on its own line — and the test could not
 * see any of them. **A test written to catch "the reason nobody thought of" had a
 * blind spot of exactly that shape: the reason whose message was long.** All five
 * happened to have copy, so nothing was broken; what was broken was the guarantee.
 *
 * ⭐ WHICH IS WHY IT ALSO COUNTS. `total` comes from a pattern that cannot miss a
 * construction, and the caller asserts the two numbers agree — so a formatting
 * change, or a reason built from a variable, fails the suite instead of quietly
 * shrinking what it covers.
 *
 * ⚠️⚠️ AND ON 2026-08-16 IT FAILED ON A COMMENT. Adding `code_malformed` came with a
 * note explaining why the two reasons are two constructions rather than one ternary
 * — and the note quotes the construction, so `total` counted a sentence about the
 * code as a line of it. **A scanner that reads source text cannot tell a claim from
 * the thing it is about.** Whole-line comments are dropped below, which can only
 * lower `total` and can never hide a real construction: no line of code begins with
 * `//` or `*`. ⭐ Note the direction the residual fails in — prose in a TRAILING
 * comment would over-count and stop the suite, which is loud, and loud is the side
 * a tripwire should err on.
 */
function withoutComments(src) {
  return src
    .split("\n")
    .map((line) => {
      const t = line.trimStart();
      return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") ? "" : line;
    })
    .join("\n");
}

function reasonsRaisedIn(file, Class) {
  const src = withoutComments(readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8"));
  const named = [...src.matchAll(new RegExp(`new ${Class}\\(\\s*"([a-z_]+)"`, "g"))].map((m) => m[1]);
  const total = [...src.matchAll(new RegExp(`new ${Class}\\(`, "g"))].length;
  return { reasons: [...new Set(named)].sort(), seen: named.length, total };
}

{
  const { reasons: unique, seen, total } = reasonsRaisedIn("../src/flow/pair.js", "PairFailure");

  check("the reasons were found in the module rather than assumed", unique.length >= 5, unique.join(", "));
  equal(
    "⭐⭐ and the reader saw every construction in it, not only the ones that fit on a line",
    `${seen} of ${total}`,
    `${total} of ${total}`,
    "A `new PairFailure(` whose reason this reader cannot see is a reason the check below cannot " +
      "check. Widen `reasonsRaisedIn` rather than reformatting the module to suit it."
  );

  const missing = unique.filter((reason) => typeof copy.pairing.failure[reason] !== "string");
  equal(
    "⭐⭐⭐ every reason `flow/pair.js` can raise has copy, so nothing falls through to `err.message`",
    missing.join(", "),
    "",
    "Add a sentence to `pairing.failure` for each. `app.js` no longer prints the exception, so a " +
      "missing one now shows the generic sentence rather than a stack-shaped string — which is " +
      "better, and is still not what the person needed to read."
  );

  const leaky = Object.values(copy.pairing.failure).find((s) => /\b[45]\d\d\b|\b[a-z]+_[a-z]+\b/.test(s));
  check("⚠️ and none of those sentences shows an HTTP status or a machine code", !leaky, leaky ?? "none");
}

/**
 * ⚠️⚠️⚠️ THE SAME CHECK, ON THE MODULE I DID NOT LOOK AT WHEN I WROTE THE FIRST ONE.
 *
 * Yesterday's fix closed the class in `flow/pair.js` and stopped there, and
 * `flow/roster.js` raises nine reasons of which **six had no sentence**. One of the
 * six is `access_rule`, which is what §7.3.3's once-an-hour rule throws when
 * somebody presses "check" twice — so the home screen printed *"§7.3.3 allows one
 * check for changes per hour"* at a user for doing the most ordinary thing there
 * is with a button.
 *
 * ➡️ **CLOSING A CLASS IN ONE MODULE IS NOT CLOSING THE CLASS.** The generalisation
 * is cheap where the specific fix was not, and it is the step I skipped.
 */
section("§7.3 — every failure reason the roster flow can raise has a sentence");

{
  const { reasons: unique, seen, total } = reasonsRaisedIn("../src/flow/roster.js", "RosterFailure");

  check("the reasons were found in the module rather than assumed", unique.length >= 9, unique.join(", "));
  equal(
    "⭐⭐ and the reader saw every construction in it",
    `${seen} of ${total}`,
    `${total} of ${total}`
  );

  // §5.2's entry is a function because its sentence carries a measurement; the rest
  // are strings. Both count as handled, and nothing else does.
  const written = (reason) => ["string", "function"].includes(typeof copy.roster.failure[reason]);
  const missing = unique.filter((reason) => !written(reason));
  equal(
    "⭐⭐⭐ every reason `flow/roster.js` can raise has copy, so `describeIdentity` never reaches its default",
    missing.join(", "),
    "",
    "Add a sentence to `roster.failure` for each. Until 2026-08-13 these fell through to " +
      "`err.message`, and those messages cite section numbers."
  );

  const skew = copy.roster.failure.clock_skew(200);
  check(
    "⚠️ and §5.2's measurement comes back as a finished sentence with something to do about it",
    /^This device/.test(skew) && /clock/.test(skew) && skew.endsWith("try again."),
    skew
  );
}

/**
 * ⭐⭐⭐ D-152 — THE LAST HOLE IN D-083, AND IT WAS TWO HOLES.
 *
 * §5.2's sentence was built inside `flow/roster.js` and, byte for byte, inside
 * `flow/mailbox.js`: **the only English a person could read that did not live in
 * `ui/copy.js`, written twice.** Nothing could have caught a drift between the two copies,
 * and nothing had ever reviewed either — no sheet, no term page, no translation, because
 * every instrument this project owns reads that one module. ➡️ **A gate with one exception
 * has no way to tell you the exception moved.**
 *
 * ⚠️⚠️ AND THE TWO COPIES HAD ALREADY PRODUCED TWO SENTENCES ON TWO SCREENS. The unlock and
 * list screens went through `describeIdentity`, which handed the text to `clockSkew` and got
 * back a capital and the advice. The chat view printed `failure.message` raw — the same
 * failure, lowercase, **with no advice at all**. Hannu ruled that both should say the one
 * thing. This is what holds it: the flow modules carry a NUMBER and copy owns every word.
 */
{
  const source = (f) => withoutComments(readFileSync(fileURLToPath(new URL(f, import.meta.url)), "utf8"));
  const prose = /clock is |which stops it connecting|ahead of the server|behind the server/i;
  const leaky = ["../src/flow/roster.js", "../src/flow/mailbox.js", "../app/app.js"].filter((f) =>
    prose.test(source(f))
  );
  equal(
    "⭐⭐⭐ D-152 — no module outside `ui/copy.js` writes §5.2's sentence any anywhere",
    leaky.join(", "),
    "",
    "The offset travels as `failure.skew`, a number. Any prose about it belongs in `ui/copy.js`."
  );
  check(
    "⚠️⚠️ D-152 — and `app.js` no longer prints a failure's own text in the chat view",
    !/line\(failure\.message/.test(source("../app/app.js")),
    "`line(failure.message, \"bad\")` was the second, shorter, adviceless sentence"
  );
  check(
    "⚠️⚠️ D-152 — and every `clock_skew` failure is built WITH the number the sentence needs",
    ["../src/flow/roster.js", "../src/flow/mailbox.js"].every((f) =>
      /new \w+Failure\("clock_skew",[^)]*, err, skew\)/.test(source(f))
    ),
    "a `clock_skew` raised without its fourth argument would reach a person as \"about NaN minutes\""
  );
  // ⭐⭐ D-157 — THE TWO SCREENS NO LONGER GET AN IDENTICAL SENTENCE, THEY GET THE SAME ONE.
  // This used to compare `copy.roster.failure.clock_skew(200)` against `copy.clockSkew(200)`,
  // which is a check that two exports agree — and the reason there were two was that `app.js`
  // called one from the chat view and the other from the unlock and list screens. **Two paths
  // to one sentence is two homes for one sentence**, and D-152 fixed exactly that shape in the
  // review instrument while leaving it standing here. `clockSkew` is private now, so what is
  // left to assert is that no caller can find another way in.
  check(
    "⭐⭐ D-157 — one path to §5.2's sentence: nothing outside `copy.js` names `clockSkew`",
    !/\bcopy\.clockSkew\b/.test(readFileSync(fileURLToPath(new URL("../app/app.js", import.meta.url)), "utf8")) &&
      copy.clockSkew === undefined,
    `copy.clockSkew is ${copy.clockSkew === undefined ? "not exported" : "still exported"}`
  );
  check(
    "⚠️ D-152 — the MEASURED offset is a digit at every reading, not a word at some of them",
    [61, 200, 1020, 3599, 3600, 7300].every((n) => /\babout \d+ (minute|hour)s?\b/.test(copy.roster.failure.clock_skew(n))),
    [61, 1020, 7300].map((n) => copy.roster.failure.clock_skew(n).split(", which")[0]).join("  ‖  ")
  );
  check(
    "⚠️ and it turns to hours above an hour, so a wrong DATE does not read as 1440 minutes",
    /about 24 hours behind/.test(copy.roster.failure.clock_skew(-86400)) && /about 1 minute ahead/.test(copy.roster.failure.clock_skew(61)),
    `${copy.roster.failure.clock_skew(-86400).split(", which")[0]}  ‖  ${copy.roster.failure.clock_skew(61).split(", which")[0]}`
  );
}

/**
 * ⭐⭐⭐ D-153 — A QUANTITY REACHES A PERSON AS A DIGIT, AND THIS IS THE ROT GUARD.
 *
 * ⚠️⚠️ THIS BLOCK REPLACES D-152'S, ONE DAY OLD, AND THE STORY OF WHY IS THE POINT.
 * D-152 found four sentences that opened on a lowercase number word — the quarantine
 * notice read *"three conversations were deleted from another device."* — and capitalised
 * them. Hannu then ruled the number words out altogether: *"I strongly recommend using
 * numbers instead of words to describe amounts."* All four now open on a digit, so the
 * defect D-152 found is still fixed and the fix it chose has nothing left to do.
 *
 * ⭐⭐ HE HAD ALREADY RULED THIS ONCE, IN ROUND 6, FOR ONE SCREEN. The gate paragraph was
 * changed then to render its word count as a digit — see the D-064 check above, which
 * records the reasoning — and nothing carried it to the rest. So for months the product
 * said "8 words" on the opening page and *"Ten words"* in the phrase note: one kind of
 * fact, two notations, decided by which round happened to touch which screen. A ruling
 * applied where it was made and nowhere else is a ruling that has not been applied.
 *
 * ⭐ AND THE OLD TABLE WAS ALREADY BROKEN FOR COUNTS. It knew 0–16, 20, 30, 45, 60 and
 * fell through to a digit for the rest, so `list.unexplained` said *"Sixteen conversations
 * are missing"* at 16 and *"17 conversations are missing"* at 17. Both correct English;
 * one sentence; two forms; chosen by the reader's own number rather than by anybody.
 *
 * These are the sentences that carry a quantity. Each is rendered at a value the deleted
 * table HAD a word for, so a helper that started spelling again would be caught here.
 */
{
  const counted = [
    ["deletion.suspect", copy.deletion.suspect(3)],
    ["deletion.quarantineWindow", copy.deletion.quarantineWindow],
    ["list.unexplained", copy.list.unexplained(2)],
    ["list.noHistory", copy.list.noHistory(Date.now() / 1000, 4)],
    ["panic.told", copy.panic.told(3, 5)],
    ["phrase.longPhraseNote", copy.phrase.longPhraseNote],
    ["phrase.setsLeft", copy.phrase.setsLeft(4)],
    ["phrase.more", copy.phrase.more],
    ["phrase.capReached", copy.phrase.capReached],
    ["lock.idle", copy.lock.idle],
    ["lock.coveredIdle", copy.lock.coveredIdle],
    ["ending.needsPhrase", copy.ending.needsPhrase],
    ["span(1800)", copy.span(1800)],
    ["span(86400)", copy.span(86400)],
  ];
  const wordless = counted.filter(([, s]) => !/\d/.test(s));
  equal(
    "⭐⭐⭐ D-153 — every sentence that carries a quantity shows it as a digit",
    wordless.map(([p]) => p).join(", "),
    ""
  );
  // ⚠️ Scanned over THESE sentences only. "one" is an ordinary English word elsewhere —
  // *"works once, for one person"*, *"pick one of these"* — and a global ban would be a
  // check about vocabulary rather than about notation.
  // ⚠️ "one" IS NOT IN THIS LIST AND THAT IS DELIBERATE. It is the one number word that is
  // also an ordinary English determiner — *"Pick one of these 10 sets"*, *"works once, for
  // one person"* — so banning it would be a check about vocabulary rather than notation,
  // and it would fail on prose that is correct. The digit check above already catches a
  // sentence whose quantity went back to being a word, because then no digit is left.
  const WORDED = /\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|twenty|thirty|forty-five|sixty)\b/i;
  const spelling = counted.filter(([, s]) => WORDED.test(s));
  equal(
    "⚠️ and none of them spells one out beside it",
    spelling.map(([p]) => p).join(", "),
    ""
  );
  // ⚠️ D-152's four opened on a lowercase WORD, which read as the tail of another
  // sentence. A digit is not a lowercase letter, so the warning still starts visibly —
  // but the capital/fragment distinction D-152 drew has dissolved and is not re-asserted
  // here. ⭐ What survives is the thing that was actually wrong: these must not open small.
  const openers = counted
    .filter(([p]) => /suspect|unexplained|told|longPhraseNote|setsLeft/.test(p))
    .filter(([, s]) => !/^\d/.test(s));
  equal(
    "⭐⭐ and the five that OPEN on their number open on the digit itself, never on a small letter",
    openers.map(([p]) => p).join(", "),
    ""
  );

  const sentences = Object.values(copy.roster.failure).filter((v) => typeof v === "string");
  const leaky = sentences.find((s) => /\b[45]\d\d\b|§|\b[a-z]+_[a-z]+\b/.test(s));
  check(
    "⚠️ and none of those sentences shows a status, a section number or a machine code",
    !leaky,
    leaky ?? "none"
  );
}

// ====================== the second round of first-use findings, 2026-08-13

section("what the fourteen new observations changed");

check(
  "⭐⭐⭐ feedback 5 and 10 — §7.8's control on the LIST does not call itself a conversation",
  !/conversation/i.test(copy.ending.control) && !/conversation/i.test(copy.ending.thoroughControl),
  `${copy.ending.control} · ${copy.ending.thoroughControl}`
);

check(
  "⚠️ and its confirmation opens by saying nothing is ended and nobody is told",
  /No conversation is ended and nobody is told/.test(copy.ending.confirm),
  copy.ending.confirm
);

check(
  "⚠️ while §7.6's control still does end a conversation, because there it is the only one",
  /conversation/i.test(copy.ghost.end),
  copy.ghost.end
);

/**
 * ⭐⭐ D-149 — THE LABEL CARRIES BOTH VERBS, AND ITS CONFIRMATION OPENS WITH THE SAME
 * WORDS. `ghost.end` used to say only "End", and only this file knew that ending and
 * deleting are the same act in a mode with no list to delete from — a reader could take
 * "end" for closing or for leaving. ⚠️ The second half is the one that rots: a
 * confirmation whose opening words differ from the control that opened it makes a person
 * wonder whether they pressed what they meant to, and nothing else would ever fail.
 */
check(
  "⭐⭐ D-149 — §7.6's one control says it DELETES, not just that it ends",
  /\bdelete\b/i.test(copy.ghost.end),
  copy.ghost.end
);
check(
  "⚠️ and the confirmation opens with the button's own words, so the two cannot drift",
  copy.ghost.endConfirm.startsWith(copy.ghost.end),
  `${copy.ghost.end}  ‖  ${copy.ghost.endConfirm.split("\n")[0]}`
);
check(
  "⛔ and neither of them claims the bytes are scrubbed, which §7.6's own terms deny",
  !/scrub|wipe|erase|shred/i.test(`${copy.ghost.end} ${copy.ghost.endConfirm}`),
  copy.ghost.endConfirm
);

// ⚠️ RE-POINTED (§6.7.1 rule 2, 0.9.22). Feedback 1 asked that the sentence say WHAT
// the notice says, and that requirement is untouched by the correction above — what
// changed is that it no longer also claims the notice arrived. The check follows the
// property, not the words: the sentence still names what was said.
check(
  "⭐ feedback 1 — the closing notice says what the other person was told",
  /ended the conversation/.test(copy.closing.sent),
  copy.closing.sent
);

check(
  "⭐ feedback 6 — Ghost mode is called Ghost mode, on the offer and on the screen",
  /Ghost mode/.test(copy.ghost.offer) && /Ghost mode/.test(copy.ghost.title),
  `${copy.ghost.offer} · ${copy.ghost.title}`
);

check(
  "⚠️⚠️ and the line under it does not claim erasure, which §7.6 forbids and Hannu's draft did",
  // ⚠️ NEGATION-AWARE SINCE 2026-08-24 — see `claimsErasure`. The word list this
  // replaces failed the honest sentence *"it is not erased"* just as hard as the
  // false one.
  !claimsErasure(copy.ghost.offerWhat),
  copy.ghost.offerWhat
);

check(
  "⭐ feedback 8 — 'start a conversation' says which one, for the person who has exactly one",
  /new/.test(copy.list.start),
  copy.list.start
);

check(
  "⭐ feedback 14 — 'Set up' says what is being set up",
  copy.nav.setUp !== "Set up" && /KEY/.test(copy.nav.setUp),
  copy.nav.setUp
);

check(
  "⭐⭐ feedback 3 — arriving with a link re-labels all three choices, Ghost mode included",
  ["setUp", "haveOne", "ghost"].every((k) => /^Open it/.test(copy.nav.arrived[k])),
  Object.values(copy.nav.arrived).join(" · ")
);

// ⚠️⚠️ FEEDBACK 12's SENTENCE WAS TRUE UNTIL §3.4.1b SHIPPED AND THEN NOBODY NOTICED.
// It said the tab must stay open or the link cannot be finished. Kept mode resumes
// now, so that is false there and still exactly right in Ghost, which writes nothing
// durable (§3.4.1b rule 2). ⭐ THE CHECK IS THEREFORE PER MODE, and the Kept half
// asserts the OPPOSITE of what this assertion used to demand.
check(
  "⭐⭐ Ghost still says the tab has to stay open, because Ghost still cannot resume",
  /Keep this tab open/.test(copy.pairing.keepOpen.ghost) && /new one/.test(copy.pairing.keepOpen.ghost),
  copy.pairing.keepOpen.ghost
);
check(
  "⭐⭐⭐ and Kept no longer claims closing the browser loses the pairing",
  !/Keep this tab open/.test(copy.pairing.keepOpen.kept) && /carry on/.test(copy.pairing.keepOpen.kept),
  copy.pairing.keepOpen.kept
);
check(
  "⭐⭐ Kept tells the creator how long the link stays openable, and to cancel it if it went astray",
  copy.pairing.keepOpen.kept.includes(copy.span(PAIRING_TTL_SECONDS)) && /cancel it/.test(copy.pairing.keepOpen.kept),
  copy.pairing.keepOpen.kept
);
check(
  "⭐ the spoken code says the same two things, because it is the same two modes",
  /Keep this tab open/.test(copy.pairing.code.keep.ghost) &&
    copy.pairing.code.keep.kept.includes(copy.span(PAIRING_TTL_SECONDS)) &&
    /cancel it/.test(copy.pairing.code.keep.kept),
  `${copy.pairing.code.keep.ghost} | ${copy.pairing.code.keep.kept}`
);

check(
  "⚠️ feedback 16's shape again: the expiry sentence names neither role, because both see it",
  !/other person/.test(copy.pairing.failure.expired),
  copy.pairing.failure.expired
);

check(
  "⭐⭐ feedback 7 and 11 — the paste route refuses a link for another site",
  /different site/.test(copy.openLink.wrongSite),
  copy.openLink.wrongSite
);

check(
  "⚠️ and it says why pasting here beats the address bar, since that is not obvious",
  /address history/.test(copy.openLink.what),
  copy.openLink.what
);

// ====================== the third round of first-use findings, 2026-08-13

section("what the third round changed");

/**
 * ⭐⭐ ONE WORD, DECIDED TWICE, ENFORCED HERE — AND THE SECOND DECISION REVERSED THE
 * FIRST THREE DAYS LATER (D-109).
 *
 * D-098 chose **passphrase** on 2026-08-13, from the dictionary: *"a passphrase is a
 * specialized security credential made of multiple words, while a phrase is simply a
 * group of words used in everyday language"*. That reasoning was sound and the
 * tester round overruled it, because it answered a question its readers do not have:
 * ⭐⭐ **none of the testers distinguished password, passphrase and key from one
 * another at all.** There is no accurate choice when the category does not exist for
 * the reader, so the product stops competing on accuracy and names the thing: `KEY`.
 *
 * ⚠️ THE CHECK IS INVERTED RATHER THAN DELETED, AND IT GREW A THIRD CLAUSE. "KEY"
 * collides with cryptography's own word in a cryptographic product — a reader who
 * meets *"the server holds one public key"* beside *"the server never gets the key"*
 * can only conclude that it holds theirs — so the bare lowercase word is swept out
 * of the surface entirely, not merely kept at a distance from it.
 *
 * ⭐ `terms.*.body` IS THE ONE EXEMPTION, AND IT IS A REAL DISTINCTION RATHER THAN A
 * CONVENIENCE. The surface is written for somebody who has never heard of any of
 * this; a term body is read only by somebody who tapped a word to ask. That reader
 * is exactly the one who will meet "key" in its cryptographic sense elsewhere, so
 * the body can afford to draw the distinction explicitly — which `terms.key` does —
 * and silence would serve them worse than the word does.
 */
{
  const surface = all.filter(([p]) => !/^terms\..*\.body/.test(p));

  const bare = surface.filter(([, s]) => /\bphrase\b/i.test(s) || /passphrase/i.test(s));
  equal(
    "⭐⭐ the product says 'KEY' and never 'passphrase' or the bare word 'phrase'",
    bare.map(([p]) => p).join(", "),
    "",
    "D-109, 2026-08-16: the testers understood KEY and separated none of the three words. " +
      "The product's word is KEY, in capitals, everywhere on the surface."
  );

  // ⚠️ `\bkey\b` WITH THE CASE FLAG OFF, SO IT CANNOT MATCH "KEY". That is the whole
  // mechanism: capitals are what keep the product's name for the eight words apart
  // from cryptography's word for everything else, and a lowercase "key" on the
  // surface is the collision arriving.
  const lower = surface.filter(([, s]) => /\bkeys?\b/.test(s));
  equal(
    "⭐⭐ and the lowercase word 'key' never reaches the surface — D-109's collision",
    lower.map(([p]) => p).join(", "),
    "",
    "KEY in capitals is the user's eight words and nothing else. Where a sentence needs the " +
      "cryptographic sense, either say what the thing DOES ('nothing that could open it') or put " +
      "it in a term body, where the reader has asked for the technical answer."
  );

  check(
    "⭐ and the term body that DOES use it addresses the collision head-on",
    /KEY in capitals always means these words of yours/.test(copy.terms.key.body.join(" ")),
    copy.terms.key.body.join(" ")
  );
}

/**
 * ⭐⭐⭐ D-016b's RULE, ENFORCED AT LAST — AND IT TOOK A THIRD SIGHTING TO GET HERE.
 *
 * Phase 0.5, round 2: *"Keep this page open until they arrive"* sounded to Hannu's
 * testers like waiting for a **group**. English writers reach for the singular
 * "they" to dodge he/she; Finnish has `hän`, so a Finnish reader with good English
 * has no reason to expect it and hears a plural. The rule was written down in
 * 2026-08-05 and never given a test.
 *
 * ⚠️⚠️ SO IT CAME BACK, IN THE SAME SCREEN, IN THE SAME CONSTRUCTION. Round 6:
 * *"Keep this tab open until **they** have opened it."* Hannu caught it again, with
 * the same reasoning — *"foreign users would think who all the multiple persons
 * 'they' are"* — and the sweep it triggered found two more that nobody had reported:
 * **`closing.sent` opened with a bare "They have been told"**, which is what you read
 * the instant after deleting one conversation with one person.
 *
 * ➡️ **A RULE WITHOUT A TEST IS A RULE THAT HOLDS UNTIL THE NEXT SENTENCE**, which is
 * D-098's lesson in a second place. An allowlist rather than a pattern, because
 * "they" is perfectly good English for a plural and this product has twenty
 * legitimate uses — the check cannot judge number, so it demands that a human has.
 * A new string containing the word fails until somebody reads it and either fixes it
 * or lists it here with what the pronoun stands for.
 *
 * ⚠️ Reusable beyond this project: privsend, seku and privis are all English-first
 * with Finnish readers and none of them has been swept.
 */
{
  const PLURAL = new Map([
    ["chat.ttl", "messages"],
    // D-150: "the browser where they first arrived" — the old messages. Read and ruled.
    ["chat.reconnect.why", "old messages"],
    ["ending.confirm", "conversations"],
    ["ending.needsPhrase", "conversations"],
    // D-151: "They are not shown on any screen" — the deletion dates. Read and ruled.
    ["panic.keeps", "the dates the conversations were deleted"],
    ["panic.reach", "conversations"],
    ["panic.told", "conversations"],
    ["panic.otherSide", "the other people — genuinely plural, one per conversation"],
    ["phrase.capReached", "candidate phrases"],
    ["tabs.endUnconfirmed", "tabs"],
    ["terms.key.body.0", "the words"],
    ["terms.key.body.1", "the words"],
    ["terms.server.body.0", "messages"],
    ["verification.checkLater", "digits"],
    ["verification.matched", "digits"],
    // §3.5's alarm, 2026-08-24. Both are "the six digits" — read and ruled. ⚠️ The
    // sentence names them immediately before the pronoun in each case, which is the
    // condition D-016b's rule actually cares about: a Finnish reader hearing a plural
    // is right, because it IS one.
    ["pairing.tripwire", "the six digits"],
    ["verification.tripwire", "the six digits"],
  ]);

  const used = all.filter(([, s]) => /\b(they|them)\b/i.test(s));
  const unlisted = [...new Set(used.filter(([p]) => !PLURAL.has(p)).map(([p]) => p))];

  check(
    `⭐⭐⭐ D-016b — ${used.length} sentences use "they" or "them" and every one is a reviewed PLURAL`,
    used.length > 0 && unlisted.length === 0,
    unlisted.length
      ? `${unlisted.join(", ")}\n  → name the person ("your friend", "the other person") or, if it really is ` +
        "plural, add the path above with what the pronoun stands for."
      : ""
  );

  // ⚠️ AND THE OTHER DIRECTION, WHICH IS HOW AN ALLOWLIST ROTS. A path listed here
  // whose string no longer contains the word is a permission left lying around for
  // whatever gets written at that key next.
  const stale = [...PLURAL.keys()].filter((p) => !used.some(([q]) => q === p));
  check(
    "⚠️ and no path is allowed that no longer uses one",
    stale.length === 0,
    stale.join(", ")
  );
}

/**
 * ⚠️⚠️ D-150 — THE ONE SENTENCE WHOSE NUMBER IS PROSE, TIED DOWN HERE INSTEAD.
 * `access_rule` says "once an hour". §7.3.3's interval is `USER_CHECK_INTERVAL_S` in
 * `flow/roster.js`, and there is no reading of `span()` that yields a grammatical
 * "once an hour" — inventing a helper for one sentence is the clever helper `copy.js`
 * warns against. So the binding is a check: move the constant off 3600 and this fails,
 * which is the property interpolation was buying.
 */
check(
  "⭐⭐ D-150 — `access_rule`'s hour is the constant's hour",
  USER_CHECK_INTERVAL_S === 3600 && /\bonce an hour\b/.test(copy.roster.failure.access_rule),
  `${USER_CHECK_INTERVAL_S}s  ‖  ${copy.roster.failure.access_rule}`
);
check(
  "⚠️ and it states the rule rather than defending the budget it protects",
  !/asks of the server|nothing is being missed/i.test(copy.roster.failure.access_rule),
  copy.roster.failure.access_rule
);

/**
 * ⭐⭐ D-151 — AND THE REFUSAL USED TO BE THE ONLY THING THE CONTROL EVER SAID.
 * §7.3.3 case 5 is a button; `access_rule` above is what it says on a second press inside
 * the hour. Until this round there was nothing at all for the ordinary case, so the control
 * answered a person only when it was declining them: *"I have never noticed anything
 * happening from pressing that?"* ➡️ **A missing sentence has no home to be reviewed in** —
 * eighteen rounds of copy review never reached this one, because a review reads strings and
 * this defect was the absence of a string.
 *
 * Three replies from one control, and this asserts all three exist and are three different
 * sentences. That they share one slot beneath the button is `app.js`'s business, and it is
 * probed rather than checked here — `lpm-probes/probe-check-note{,-fresh}.mjs`.
 */
check(
  "⭐⭐ D-151 — §7.3.3 case 5 answers when it succeeds, not only when it refuses",
  new Set([copy.nav.checked, copy.nav.checkedChanged, copy.roster.failure.access_rule]).size === 3 &&
    /\bno changes\b/i.test(copy.nav.checked),
  `${copy.nav.checked}  ‖  ${copy.nav.checkedChanged}`
);

/**
 * ⚠️ D-150 — ONE INSTRUCTION, TWO TERM PAGES. `terms["invite-link"]` used to point at the
 * six digits without saying what to do; it now gives the instruction, which `terms["six-digits"]`
 * already gave. A reader lands on one or the other, never both at once, so the duplication is
 * right — but two homes is how a sentence drifts, so they must say it the same way.
 */
check(
  "⭐⭐ D-150 — both term pages send the reader down the same other route, in the same words",
  ["invite-link", "six-digits"].every((t) =>
    copy.terms[t].body.some((b) => /by some other route/.test(read(b)))
  ),
  `${read(copy.terms["invite-link"].body[2])}\n  ‖  ${read(copy.terms["six-digits"].body[1])}`
);

check(
  "⭐ feedback 2 — the check control says whose changes it is checking for",
  /other devices/.test(copy.nav.checkForChanges),
  copy.nav.checkForChanges
);

/**
 * ⭐⭐ FEEDBACK 4, AND THE LABEL WAS THE DEFECT. §7.3.1a deletes every conversation
 * and **cannot** delete the identity — the tombstones and `purged_at` in the list
 * are what carry the deletion to the other devices. The gate said "everything", so
 * a passphrase that still worked afterwards read as the action having failed.
 */
check(
  "⭐⭐ feedback 4 — the panic action does not promise to delete 'everything'",
  !/everything/i.test(copy.panic.fromGate) && /conversation/i.test(copy.panic.fromGate),
  copy.panic.fromGate
);

check(
  "⚠️ and it says out loud that the passphrase survives it, which is what he had to find out by doing",
  /keeps working/.test(copy.panic.survives) && /empty list/.test(copy.panic.survives),
  copy.panic.survives
);

/**
 * ⭐⭐⭐ FEEDBACK 5. §6.7.1's notice existed for the single deletion and not for the
 * one that deletes fifty at once — D-079's own defect, at scale, in the section
 * next door. The two sentences below are the promise and the report, and they are
 * separate: `otherSide` is on the confirmation, before anything happens, and it is
 * the only one both paths through the action can show.
 */
/**
 * ⚠️⚠️ THIS GUARD REQUIRED THE SENTENCE §6.7.1 FORBIDS. Its label said the quiet part
 * out loud — *"promises the other people are told"* — and rule 2 says the copy MUST
 * NOT promise it was delivered. Feedback 5's actual request was that the bulk deletion
 * send the notice AT ALL, which the single deletion did and it did not; that is what is
 * checked now. The promise was never the requirement, only the shape it was first
 * written in. ➡️ Write the guard from the spec, with the spec open.
 */
check(
  "⭐⭐⭐ feedback 5 — the panic confirmation says a closing notice goes to each person",
  /closing notice/.test(copy.panic.otherSide) && /each person/.test(copy.panic.otherSide),
  copy.panic.otherSide
);

// ⚠️ RE-POINTED (D-148). The clause *"and they keep their own copies of them"* was cut
// as a duplicate of the sentence after it; the FACT it asserted is what this check is for
// and that sentence still carries it. The check follows the property, not the words.
check(
  "⚠️ and it still says their copies survive, because the notice does not delete anything",
  /does not delete anything on their devices/.test(copy.panic.otherSide),
  copy.panic.otherSide
);

check(
  "⚠️ the count is of notices SENT, and the sentence for none of them going says so",
  /could be sent/.test(copy.panic.toldNone) && /still open/.test(copy.panic.toldNone),
  copy.panic.toldNone
);

/**
 * ⚠️⚠️ FEEDBACK 5's OTHER HALF, WHICH IS A "NO" AND HAS TO STAY ONE. Hannu asked
 * that §7.8's ending send the same notice. It must not: it ends nothing. The
 * conversations stay in the roster, stay on the other devices, and come back on
 * this one when the passphrase is typed — so a notice would tell the other person
 * that a conversation they can still use is over, and be false the moment he
 * signed in again. This check is what stops it being added by a later reading of
 * the same request.
 */
check(
  "⭐⭐⭐ and §7.8's ending still promises the opposite, because it ends nothing",
  /nobody is told anything/.test(copy.ending.confirm) && !/told that/.test(copy.ending.confirm),
  copy.ending.confirm
);

// ==================================================== what the fourth round changed

/**
 * 2026-08-13. Two of the five items were questions rather than defects (D-100 and
 * D-101, both design, neither built); the three below are the copy, and one of them
 * introduced the first markup this product has ever had.
 */
section("what the fourth round changed");

/**
 * ⚠️⚠️ THE EMPHASIS MARKER IS A DISPLAY BUG EVERYWHERE EXCEPT ONE ARRAY. `**` is
 * split into `<strong>` nodes by `app.js` for `product.what` and by nothing else,
 * so the same two characters in any other sentence reach a person's screen as two
 * asterisks. That is the whole risk of adding a marker convention to a module
 * whose other four hundred strings go straight to `textContent`, and it is the
 * kind of thing that ships in the sentence added six weeks from now.
 */
// ⚠️⚠️⚠️ AND ROUND 6 ALMOST TURNED THIS CHECK INTO A COMMENT. It read
// `everySentence()`, which now returns the RENDERED string — where `**` has already
// been consumed — so it counted **zero** emphasised sentences and passed by finding
// nothing to object to. It printed *"0 sentences carry emphasis and every one of
// them is in product.what"*, which is true, vacuous, and would have gone on being
// green for as long as the markup was broken.
//
// ➡️ **A TEST THAT HAS NOT BEEN SHOWN TO FAIL IS A COMMENT**, and this project has
// now paid for that lesson six times. Caught here only because the count is printed
// in the check's own name — so the number went to zero in front of me. ⭐ Worth
// keeping as a habit: **put the population size in the label of any check that
// filters a set**, because a filter over an empty set is indistinguishable from a
// filter that found nothing wrong.
{
  const marked = everySource().filter(([, s]) => s.includes("**"));
  const stray = marked.filter(([path]) => !path.startsWith("product.what"));

  check(
    `⭐⭐ ${marked.length} sentences carry emphasis and every one of them is in product.what`,
    marked.length > 0 && stray.length === 0,
    stray.map(([path]) => path).join(", ")
  );

  check(
    "⚠️ every marker that opens is closed — an odd one leaves the rest of the sentence bold",
    copy.product.what.every(hasBalancedEmphasis),
    copy.product.what.find((p) => !hasBalancedEmphasis(p))
  );

  // ⚠️ IT NOW ASKS ONLY ABOUT THE RUNS THAT BECOME ELEMENTS, AND ROUND 6 IS WHY.
  // The check used to require that NO run trims to empty, which was right when the
  // only marker was `**`. With two markers, an ordinary single space can fall
  // between them — `[server](server) **cannot read it**` produces a plain run of
  // exactly one space, and that space is REQUIRED: dropping it would print
  // "servercannot read it". The defect being guarded against was always an empty
  // `<strong>`, so the filter is what the check was for and the earlier form merely
  // happened to coincide with it.
  check(
    "⚠️ and no run that becomes an element is empty, which would put an empty <strong> in the page",
    copy.product.what.every((p) =>
      segments(p).filter((run) => run.strong || run.term).every((run) => run.text.trim() !== "")
    ),
    copy.product.what.join(" ")
  );
}

/**
 * ⭐ Round 4, item 4. The three fragments he named, checked as the EMPHASISED runs
 * rather than as substrings of the paragraph — a check that the words are present
 * would pass just as well with the markers deleted, which is precisely the change
 * it exists to catch.
 */
{
  const bold = copy.product.what
    .flatMap((p) => segments(p))
    .filter((run) => run.strong)
    .map((run) => run.text);

  // ⚠️ ROUND 6 REWROTE ALL FOUR PARAGRAPHS, SO THE THREE FRAGMENTS THESE CHECKS WERE
  // POINTED AT NO LONGER EXIST — but the PROPERTY does, and it is the one worth
  // keeping: the opening explanation carries emphasis on the facts a person is meant
  // to leave with, and it is real markup rather than words that happen to be present.
  // The paragraphs are now four rather than three, because "the server cannot read
  // it" earned its own.
  const joined = bold.join(" | ");

  check(
    "⭐ every paragraph of the opening carries emphasis, and there are five runs across four",
    copy.product.what.every((p) => segments(p).some((run) => run.strong)) && bold.length === 5,
    joined
  );

  /**
   * ⭐⭐ EACH RUN IS ANCHORED WITH `^` AND `$`, AND THAT IS THE WHOLE POINT OF THESE
   * FOUR CHECKS NOW.
   *
   * The first draft of round 6 bolded whole clauses — *"secure messenger. There are
   * no accounts"*, *"8 words that are the secret KEY to your conversations"* — and
   * put roughly HALF the opening screen in 600 weight. Every substring check passed.
   * Emphasis covering half a screen marks nothing, which is D-104's item 5 exactly:
   * a filled bubble on every message spent the loudest element on the page on the
   * half the reader already knew. It was visible only in a screenshot of the
   * rendered page, because "how much of this screen is bold" is not a property any
   * string comparison has.
   *
   * ➡️ Read alone, the four runs are now **"secure messenger · 8 words · opened only
   * once · cannot read it"** — the product, for somebody who will not read the
   * paragraphs. Anchoring is what stops them growing back into sentences.
   */
  check(
    "⭐ 1 — what it is",
    /^secure messenger$/.test(bold[0] ?? ""),
    bold[0]
  );

  // ⚠️ ADDED ON HANNU'S REVIEW OF THE DEPLOYED PAGE. He asked for the second sentence
  // of paragraph 1 in bold as well — the three absences are the product's single
  // most distinguishing fact, and they were the one thing in the summary a skimmer
  // could not see. It is the only paragraph with two runs, deliberately.
  check(
    "⭐ 1b — and the three absences, which are what the product IS",
    /^no accounts, no user names and no passwords$/.test(bold[1] ?? ""),
    bold[1]
  );

  // ⚠️ THE WORD COUNT IS READ FROM THE CONSTANT, NOT TYPED (D-064). This paragraph is
  // where that number now lives, and the check moved onto it when `phrase.intro` was
  // deleted in round 5 — so it is checked twice over: once for the digit, once for
  // the bold run that carries it.
  check(
    "⭐ 2 — the KEY, with the word count interpolated from PHRASE_WORDS",
    new RegExp(`^${PHRASE_WORDS} words$`).test(bold[2] ?? ""),
    bold[2]
  );

  check(
    "⭐ 3 — the thing Phase 0.5 measured people getting wrong about an invite link",
    /^opened only once$/.test(bold[3] ?? ""),
    bold[3]
  );

  check(
    "⭐ 4 — and the server, which round 6 promoted out of a subclause",
    /^cannot read it$/.test(bold[4] ?? ""),
    bold[4]
  );
}

// ⚠️ ROUND 4's *"carries them BUT cannot read them"* CHECK IS GONE WITH ITS SENTENCE.
// The paragraph it read was replaced wholesale in round 6 by *"Once the conversation
// has started, only you and your friend can read it. The server cannot read it."*
// The property that check was written for — the opening explanation states plainly
// that the server cannot read the messages — is asserted as bold run 4 above, which
// is where the job went (D-107).

/**
 * ⭐⭐ ITEM 3 — ONE NAME FOR THE ONE THING. It was "a link" in twenty-one sentences
 * and "the link" in the next clause of half of them, and a person who has never
 * seen the product cannot tell which of those is the noun and which is a pronoun.
 *
 * The rule this checks is not "never write link" — English needs the second
 * mention — it is that **every string that introduces it calls it an invite link**,
 * so the name is established before the pronoun is used. A string mentioning a link
 * with no "invite" anywhere in it is a first mention that got missed.
 */
// ⭐⭐ ROUND 6 REMOVED THE ONE EXCEPTION AND THEREFORE THE ONE CARVE-OUT HERE. The
// filter used to skip `product.what` entirely, because paragraph 1 said *"haamu is a
// link-paired messenger"* and the word was an adjective there rather than a noun.
// D-111 retired that phrase — *"several testers did not understand that"* — so the
// opening paragraphs are now subject to the same rule as everything else, which is
// strictly stronger and is only visible if you notice the filter shrinking.
{
  const linky = everySentence().filter(([, s]) => /\blinks?\b/i.test(s));
  const unnamed = linky.filter(([, s]) => !/invite link/i.test(s));

  check(
    `⭐⭐ ${linky.length} sentences mention a link and every one of them names it`,
    unnamed.length === 0,
    unnamed.map(([path, s]) => `${path}: ${s}`).join("\n")
  );

  check(
    "⭐ the controls a person clicks say it too",
    /invite link/i.test(copy.pairing.copy) &&
      /invite link/i.test(copy.ghost.start) &&
      /invite link/i.test(copy.openLink.control),
    [copy.pairing.copy, copy.ghost.start, copy.openLink.control].join(" | ")
  );

  // ⚠️⚠️ THE EXCEPTION IS NOW A PROHIBITION, WHICH IS THE OPPOSITE OF DELETING THE
  // CHECK. D-102 registered *"haamu is a link-paired messenger"* as the single
  // permitted non-noun use, checked by name so that a later sweep could not quietly
  // turn it into a noun. The testers invalidated the phrase itself (D-111), so the
  // check that PERMITTED it becomes the check that refuses it — and the rule above
  // now has no exceptions at all. ⭐ Deleting this instead would have left the door
  // it was holding shut standing open.
  check(
    "⚠️ and 'link-paired messenger' does not come back — the testers did not understand it",
    !all.some(([, s]) => /link-paired/i.test(s)),
    all.filter(([, s]) => /link-paired/i.test(s)).map(([p]) => p).join(", ")
  );
}

/**
 * ⭐⭐ D-110's SECOND LAYER, CHECKED AS A CLOSED SET.
 *
 * A marked term with no entry loses an explanation; an entry nothing marks is copy
 * nobody can ever reach. Neither shows up at runtime as an error — the first renders
 * the word without its button, the second renders nothing at all — so both are
 * exactly the kind of silent gap this suite exists for.
 *
 * ⚠️ AND THE THIRD CHECK IS THE ONE THAT ACTUALLY BITES. A malformed marker is not a
 * parse error, it is a non-match: the raw `[text](Term Id)` travels to `textContent`
 * and a person reads the brackets. `hasUnconsumedMarks` asserts against the PLAIN
 * RENDERING rather than against the source, so it tests what a reader receives
 * instead of testing my regex against my own reading of it.
 */
section("D-110 — the disclosure layer is a closed set");

{
  // ⚠️ `everySource()`, not `all` — these are the checks that are about the markup,
  // and `all` has already had the markup rendered away.
  const source = everySource();

  const marked = new Map();
  for (const [path, s] of source) {
    for (const id of markedTerms(s)) {
      if (!marked.has(id)) marked.set(id, path);
    }
  }

  const missing = [...marked].filter(([id]) => !copy.terms[id]);
  check(
    "⭐ every marked term has an entry",
    missing.length === 0,
    missing.map(([id, path]) => `${id} (marked in ${path})`).join(", ")
  );

  const orphans = Object.keys(copy.terms).filter((id) => !marked.has(id));
  check(
    `⭐ every one of the ${Object.keys(copy.terms).length} entries is reachable from a marked word`,
    orphans.length === 0,
    orphans.join(", ")
  );

  const stray = source.filter(([, s]) => hasUnconsumedMarks(s));
  check(
    "⭐⭐ no marker survives into what a person reads — checked on the rendering, not the source",
    stray.length === 0,
    stray.map(([p, s]) => `${p}: ${s}`).join("\n")
  );

  // ⚠️ ONE LEVEL ONLY. The renderer walks a body as plain text, so a marker inside
  // one is displayed as literal brackets — the same failure as a stray `**`, which
  // this file has asserted against since D-103.
  const nested = Object.entries(copy.terms).filter(
    ([, entry]) => entry.body.some((line) => markedTerms(line).length > 0 || line.includes("**"))
  );
  check(
    "⚠️ and no entry contains a marker of its own — the renderer walks one level",
    nested.length === 0,
    nested.map(([id]) => id).join(", ")
  );

  check(
    "every entry has a title and at least one paragraph",
    Object.values(copy.terms).every((e) => e.title && e.label && e.body.length > 0),
    Object.entries(copy.terms).map(([id, e]) => `${id}: ${e.body.length}`).join(", ")
  );

  // ⭐ THE LAYER HAS A JOB AND THIS IS IT (D-110). The surface exists to be short and
  // the body exists to be complete, so a body that is no longer than the sentence
  // that opens it has not moved any complexity anywhere — it has just added a click.
  const thin = Object.entries(copy.terms).filter(([, e]) => e.body.join(" ").length < 200);
  check(
    "⭐ and every entry says more than the sentence that opens it, or it is only a click",
    thin.length === 0,
    thin.map(([id, e]) => `${id}: ${e.body.join(" ").length} chars`).join(", ")
  );
}

// ⭐ Item 4's other two: the mailbox number is GENERATED (a number a person might
// otherwise assume was derived from something of theirs), and the message is
// deleted when the RECEIVER has collected it — a sentence both ends read, where
// only one of them is "the other person".
check(
  "⭐ the mailbox is named as a generated id in both sentences that mention it",
  /generated id number/.test(read(copy.server.cannotRead)) && /generated id number/.test(read(copy.server.metadata)),
  `${read(copy.server.cannotRead)}\n${read(copy.server.metadata)}`
);

check(
  "⭐ and deletion is described from the receiver's side, not 'the other person's'",
  /receiver's device/.test(copy.server.whenItGoes) && !/other person's device/.test(copy.server.whenItGoes),
  copy.server.whenItGoes
);

// ============================== §2.2's spoken code, and the claims its copy makes

/**
 * ⚠️⚠️ THIS SECTION EXISTS BECAUSE OF D-115, AND D-115 IS NOT A COPY DEFECT — IT IS
 * THIS FILE'S RULE ONE SECTION EARLIER THAN THIS FILE HAS EVER LOOKED.
 *
 * PROTOCOL.md §2.2 carried the parenthesis *"(32 chars; 0/O/1/I/L excluded)"* beside
 * an alphabet of **31** characters, from 2026-08-05 until the day somebody tried to
 * write the constant. Three careful readings and two outside triages went past it,
 * because a parenthesis that states a property of the list beside it reads as a
 * courtesy to the reader rather than as an assertion — and **nothing counts a
 * courtesy**.
 *
 * ➡️ The general form is this file's own thesis moved one layer down: prose that
 * describes a constant is unchecked, and *a specification is prose*. So every
 * sentence the product says about the alphabet is checked against the alphabet here,
 * and the alphabet is checked against the arithmetic §2.2a rests on.
 */
section("§2.2's alphabet — the claims, against the constant (D-115)");

check(
  `⭐⭐ the alphabet is ${CODE_ALPHABET.length} characters, and §2.2 says 32`,
  CODE_ALPHABET.length === 32,
  CODE_ALPHABET
);
check(
  "⭐ which is a power of two, so 16 characters is exactly 80 bits",
  Number.isInteger(Math.log2(CODE_ALPHABET.length)) && CODE_CHARS * Math.log2(CODE_ALPHABET.length) === 80,
  `${CODE_CHARS} × log2(${CODE_ALPHABET.length}) = ${CODE_CHARS * Math.log2(CODE_ALPHABET.length)} bits`
);
check(
  "⚠️ no character appears in it twice — a duplicate would silently cost entropy",
  new Set(CODE_ALPHABET).size === CODE_ALPHABET.length,
  `${new Set(CODE_ALPHABET).size} distinct of ${CODE_ALPHABET.length}`
);
{
  // §2.2's exclusion set, as the specification states it since 0.9.6.
  const excluded = ["0", "1", "I", "L"];
  equal(
    "⚠️ and the four excluded characters really are excluded",
    excluded.filter((c) => CODE_ALPHABET.includes(c)).join(", "),
    ""
  );
  check(
    "⚠️⚠️ `0` is excluded, which is the whole licence for the one-way 0 → O fold",
    !CODE_ALPHABET.includes("0") && CODE_ALPHABET.includes("O") && normalise("0") === "O",
    `normalise("0") = ${normalise("0")}`
  );
}
{
  // §2.2b: a spelling for each character, and for no character that is not there.
  const spelled = Object.keys(SPELLING);
  const missing = [...CODE_ALPHABET].filter((c) => !SPELLING[c]);
  const extra = spelled.filter((c) => !CODE_ALPHABET.includes(c));
  equal(`⭐⭐ §2.2b — every one of the ${CODE_ALPHABET.length} characters has a spelling word`, missing.join(", "), "");
  equal("⚠️ and no spelling word exists for a character the alphabet does not contain", extra.join(", "), "");
  check(
    "⚠️ no two characters share a spelling word — the point of them is to be distinct",
    new Set(Object.values(SPELLING)).size === spelled.length,
    `${new Set(Object.values(SPELLING)).size} distinct of ${spelled.length}`
  );
}

section("§2.2's copy — every claim it makes about the alphabet");

{
  // ⭐ THE SENTENCE THIS CHECK EXISTS FOR. `code_malformed` names three characters a
  // code never contains, to somebody who has just mistyped one — and it is exactly
  // the shape of the parenthesis that was wrong in §2.2 for eleven days.
  const named = ["I", "L", "1"];
  const sentence = read(copy.pairing.failure.code_malformed);
  equal(
    `⭐⭐ the ${named.length} characters it tells a person a code never contains really are absent`,
    named.filter((c) => CODE_ALPHABET.includes(c)).join(", "),
    ""
  );
  check(
    "⚠️ and it names each of them, so the check cannot pass on a sentence that stopped saying it",
    /letters I or L/.test(sentence) && /digit 1/.test(sentence),
    sentence
  );
  check(
    "⚠️⚠️ it also says a typed zero is fine, which is only true while the fold exists",
    /zero/.test(sentence) && normalise("0") === "O",
    sentence
  );
}

check(
  `⭐ the length is ${CODE_CHARS} in the copy and in the constant`,
  read(copy.openLink.orCode).includes(`${String(CODE_CHARS)}-character`) &&
    read(copy.pairing.failure.code_malformed).includes(`${String(CODE_CHARS)} characters`),
  read(copy.openLink.orCode)
);

{
  // The two counting messages are templates, so the count comes from the caller —
  // what is checked is that they SAY the target, and that they differ from each
  // other. A short code and a long one are not the same mistake.
  const short = read(copy.openLink.codeShort(9));
  const long = read(copy.openLink.codeLong(31));
  check(
    "⭐ the short-code message says both what was typed and what is wanted",
    short.includes("9") && short.includes(String(CODE_CHARS)),
    short
  );
  check("⚠️ and the long one is a different sentence, not the same one reworded", short !== long, long);
}

check(
  "⚠️ §2.2b's spelling is explained as a thing to SAY, not as a decoration",
  /Say the words/.test(read(copy.pairing.code.spelling)),
  read(copy.pairing.code.spelling)
);

check(
  "⚠️⚠️ D-117 — the code screen says the invite link it replaced is dead (D-148: 'cancelled')",
  /cancelled/.test(read(copy.pairing.code.replacedLink)) &&
    /invite link/.test(read(copy.pairing.code.replacedLink)),
  read(copy.pairing.code.replacedLink)
);

// ================================================ §2.1.2 — the QR panel (D-114, D-125)

section("§2.1.2 — the QR symbol's two lines");

const qrWhat = read(copy.pairing.qr.what);
const qrRoom = read(copy.pairing.qr.room);

check(
  "⭐ the control names the SITUATION, not the technology — the same test `toCode` passes",
  !/\b(QR|barcode|scan|camera|square)\b/i.test(read(copy.pairing.toQr)),
  read(copy.pairing.toQr)
);

// ⭐ THIS IS THE CHECK THAT KEEPS THE PANEL FROM GROWING A SECOND COPY OF THE LINK'S
// FACTS. "The same invite link" inherits once / one person / ten minutes from
// `linkIsOnce` by reference. Restating them here would be two sentences that can drift,
// which is the whole subject of this suite — and §2.2's code needed its own copy of them
// only because it genuinely is NOT the same secret.
check(
  "⭐⭐ the panel says it is the SAME invite link rather than restating its terms",
  /same invite link/.test(qrWhat) && !/minutes/.test(`${qrWhat} ${qrRoom}`),
  qrWhat
);

check(
  "⚠️ and it still says the once, because that is the fact a person acts on",
  /only once/.test(qrWhat),
  qrWhat
);

// ⚠️⚠️ D-125, AND THE SENTENCE THIS FORBIDS WAS WRITTEN HERE FIRST. The draft ended *"the
// six digits on the next screen will not match"*, which is false in the dangerous
// direction: somebody who photographs this screen and opens the link pairs with THIS
// device, so their digits match ours exactly — the person left with nothing is the
// friend. It is the twin of *"that person has no digits at all"*, deleted from another
// panel in round 7 for the same ambiguity, and it was written anyway a few hundred lines
// below the comment recording that deletion.
//
// ⭐ The property is a prohibition rather than a required phrase, because the defect is a
// CLAIM ABOUT MATCHING made anywhere on this panel: there is no single wording to
// require, and every wording that promises a mismatch is wrong.
/**
 * ⭐⭐⭐ D-149 — THE ANSWER BUTTON WAS ANSWERING THE WRONG QUESTION, AND D-125 IS WHY IT
 * MATTERS. "We compared them and they are the same" reports on the DIGITS, and matching
 * digits are not the finding: whoever completes the handshake sees digits that match,
 * including somebody who stole the invitation. The person has to be sure WHO is at the
 * other end. `sasWhat` asks for exactly that in capitals; the answer now answers it.
 *
 * ⚠️ The check is shaped as a REFUSAL rather than a match, because there are many good
 * ways to say "it is my friend" and only one bad one: reporting that two numbers agree.
 */
check(
  "⭐⭐⭐ D-149 — the confirming answer is about the PERSON, not about the digits agreeing",
  /friend|person/i.test(copy.pairing.answer.verified) &&
    !/same|match|compared/i.test(copy.pairing.answer.verified),
  copy.pairing.answer.verified
);

check(
  "⚠️⚠️⚠️ D-125 — this panel promises nothing about the digits matching or not matching",
  !/digits/i.test(`${qrWhat} ${qrRoom}`),
  `${qrWhat} ${qrRoom}`
);

// D-112's rule, aimed at the construction rather than at a word: an abstract subject
// asserting a negative. *"A web page cannot stop somebody photographing your screen"* is
// true, useless and alarming, and it is the sentence this panel most invites.
check(
  "⚠️⚠️ D-112 — the caveat is an explanation, not an announcement of a limit",
  !/(cannot|can not|unable to|no way to|impossible)/i.test(qrRoom),
  qrRoom
);

check(
  "⭐ and the caveat is actionable in the same breath: what to do with the screen",
  /hide it again/.test(qrRoom) && /towards your friend/.test(qrRoom),
  qrRoom
);

check(
  "⚠️ nothing on this panel asks the person for a camera permission (§2.1.2 rule 2)",
  !/(allow|permission|enable)/i.test(`${qrWhat} ${qrRoom}`),
  `${qrWhat} ${qrRoom}`
);

/**
 * ⭐⭐ THE GATE MUST NAME WHAT THE PERSON WAS ACTUALLY SENT, and for one round it did
 * not: somebody who had just typed in a spoken code was told *"Somebody sent you an
 * invite LINK"*. Found by driving two browsers all the way through the flow, and
 * findable no other way — the string is correct everywhere it was ever looked at,
 * and every check in this file passed on it.
 *
 * ➡️ D-018 cuts both ways. Naming one thing consistently is worth nothing if it is
 * not the thing in front of the reader.
 */
{
  const link = read(copy.pairing.arrived);
  const code = read(copy.pairing.arrivedCode);
  check("⭐⭐ the arrival sentence has a version for each of §2's two secrets", link !== code, code);
  check("the link one names the invite link", /invite link/.test(link) && !/\bcode\b/.test(link), link);
  check("⚠️ and the code one does NOT say link", /\bcode\b/.test(code) && !/link/i.test(code), code);
  check(
    "both offer the same three ways in, so the choice underneath is unchanged",
    /Choose how to open it/.test(link) && /Choose how to open it/.test(code)
  );
}

/**
 * ⚠️⚠️ §3.6.2's SCREEN MAY NOT NAME EITHER OF §2's TWO SECRETS, and the reason is
 * structural rather than stylistic. It is reached twice — straight after pairing,
 * where the kind is known, and again from inside a conversation whenever the person
 * is finally able to ask (D-081). **Nothing on the device records which secret built
 * the channel**, so on the second route the screen cannot know, and storing it would
 * be a schema change to settle a question about wording.
 *
 * ⚠️ It was wrong in THREE strings at once — *"the person you sent the invite link
 * to"* — and wrong along two axes: untrue for anybody who used a code, and untrue
 * for **every joiner ever**, who sent nothing. Found on a screenshot of the live
 * site, after 155 copy checks had passed on it, because each sentence is perfectly
 * correct read on its own.
 */
{
  const screen = {
    "pairing.sas": copy.pairing.sas,
    "pairing.sasWhat": copy.pairing.sasWhat,
    "pairing.answer.verified": copy.pairing.answer.verified,
    "pairing.answer.later": copy.pairing.answer.later,
    "pairing.answer.wrong": copy.pairing.answer.wrong,
    "pairing.wrongConfirm": copy.pairing.wrongConfirm,
    ...Object.fromEntries(copy.terms["six-digits"].body.map((b, k) => [`terms.six-digits.body[${k}]`, b])),
  };
  const named = Object.entries(screen).filter(([, s]) => /invite link|\bcode\b/i.test(read(s)));
  equal(
    `⭐⭐ none of the ${Object.keys(screen).length} strings on §3.6.2's screen names a link or a code`,
    named.map(([path]) => path).join(", "),
    ""
  );
  // ⚠️ AND THE OTHER AXIS, WHICH IS OLDER THAN THE CODE. "you sent" is false for the
  // joiner on a screen both roles see — feedback 16's defect, still live until today.
  const sent = Object.entries(screen).filter(([, s]) => /you sent|I sent/.test(read(s)));
  equal("⚠️ nor tells the joiner they sent something, on a screen both roles see", sent.map(([p]) => p).join(", "), "");
}

done();
