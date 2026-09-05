// The cover PIN — ARCHITECTURE.md §4.3's second tier, and the rules it refuses.
//
// ⚠️⚠️ WHAT THIS FILE DOES NOT CLAIM. Nothing here is a proof that the PIN protects
// anything, because it does not: §4.3's cover keeps every key in memory and every
// connection up, so a PIN in front of it stops somebody who picked the device up and
// stops nobody who opens devtools. `src/flow/pin.js` says so at length. What is worth
// guarding is narrower and entirely reachable — that the refusals are the refusals the
// design chose, that a record round-trips, and that a damaged one answers `false`
// instead of throwing at a screen with a person standing in front of it.

import * as pin from "../src/flow/pin.js";
import { check, equal, section, done } from "./harness.mjs";

section("§4.3 — how many digits, and who decided");

equal("the shortest PIN is 6 digits", pin.PIN_MIN, 6);
equal("the longest is 8", pin.PIN_MAX, 8);

// ⚠️ FOUR WAS PROPOSED AND DECLINED, AND THE RANGE IS A RANGE ON PURPOSE — the person
// chooses inside it. A test that pinned one length would pass while the field stopped
// accepting the other two.
for (const p of ["482913", "4829137", "48291374"])
  equal(`${p.length} digits is a PIN`, pin.validate(p), null);

equal("five digits is not", pin.validate("48291"), pin.TOO_SHORT);
equal("nine digits is not", pin.validate("482913745"), pin.TOO_LONG);

section("§4.3 — the two refusals, which are computed and not listed");

// ⚠️ THE POLICY IS TWO COMPUTED SHAPES RATHER THAN A BLOCKLIST. A list needs
// maintaining and translating and eventually refuses somebody's real choice; these two
// refuse what a person standing behind you tries first.
equal("every digit the same is refused", pin.validate("111111"), pin.ALL_SAME);
equal("and at eight digits too", pin.validate("00000000"), pin.ALL_SAME);
equal("a run upwards is refused", pin.validate("123456"), pin.RUN);
equal("a run downwards is refused too", pin.validate("87654321"), pin.RUN);

// ⭐ AND THE NEAR MISSES ARE ACCEPTED, which is what stops the rule growing into a
// judgement about which numbers are "good". One digit off a run is a PIN.
equal("a run with one digit changed is a PIN", pin.validate("123457"), null);
equal("a repeated pair is a PIN", pin.validate("112233"), null);
equal("a run that steps by two is a PIN", pin.validate("135791"), null);

section("§4.3 — anything that is not digits");

for (const bad of ["abcdef", "12 34 56", "1234-56", "١٢٣٤٥٦"])
  equal(`refused: ${JSON.stringify(bad)}`, pin.validate(bad), pin.NOT_DIGITS);

// ⭐ AN EMPTY FIELD IS SHORT RATHER THAN WRONG, and that is the sentence a person who
// has typed nothing yet should meet. "That is not a number" is true of "" and reads as
// an accusation about something they have not done.
equal("an empty field is too short, not wrong", pin.validate(""), pin.TOO_SHORT);

// ⚠️ NOT A STRING IS NOT A CRASH. The field hands back whatever the document has, and
// a screen with somebody in front of it may not throw.
for (const bad of [null, undefined, 482913, ["4", "8"], {}])
  equal(`refused without throwing: ${String(bad)}`, pin.validate(bad), pin.NOT_DIGITS);

section("§4.3 — the record");

{
  const rec = await pin.record("482913");
  check("it round-trips", await pin.matches(rec, "482913"));
  check("a wrong PIN does not lift it", !(await pin.matches(rec, "482914")));
  check("nor a prefix of the right one", !(await pin.matches(rec, "48291")));
  check("nor the right one with a digit added", !(await pin.matches(rec, "4829130")));

  // ⭐ SALTED, WHICH IS THE ONE PROPERTY A HASH HERE CAN STILL HONESTLY CLAIM: two
  // people who choose the same PIN do not carry the same bytes.
  const other = await pin.record("482913");
  check("two records of the same PIN differ", rec.hash !== other.hash && rec.salt !== other.salt);
  check("and each still lifts its own cover", await pin.matches(other, "482913"));
}

{
  // ⚠️⚠️ A DAMAGED RECORD ANSWERS false RATHER THAN THROWING, and the reason is the
  // screen rather than the code: the difference between "wrong PIN" and "this browser's
  // record is unreadable" is not a difference a cover screen can act on, and a thrown
  // error there leaves the cover up with no sentence under it. The KEY and §7.8's
  // ending are both still reachable from that screen.
  const damaged = [
    null,
    undefined,
    {},
    { v: 2, salt: "AAAA", hash: "AAAA" },
    { v: 1, salt: "not base64url!!", hash: "AAAA" },
    { v: 1, salt: "AAAA", hash: 7 },
  ];
  for (const rec of damaged)
    check(`unreadable record answers false: ${JSON.stringify(rec)}`, !(await pin.matches(rec, "482913")));
}

{
  // ⚠️ A PIN THE RULES REFUSE MUST NOT REACH THE STORE. Validation lives at the screen,
  // and a second caller arriving later would otherwise write one the screen would have
  // refused — the class `flow/roster.js` calls a rule with one door.
  let threw = false;
  try {
    await pin.record("123456");
  } catch {
    threw = true;
  }
  check("a refused PIN cannot be recorded", threw);
}

section("§4.3 — what happens after a wrong one");

equal("five wrong entries is the limit", pin.WRONG_BEFORE_LOCK, 5);
check("and the slow-down is measured in seconds, not minutes", pin.SLOW_MS >= 1000 && pin.SLOW_MS <= 30000);

// ⚠️ `digitsOnly` IS THE FIELD'S OWN GUARD. The boxes are numeric, but a paste is not.
equal("a pasted PIN keeps only its digits", pin.digitsOnly(" 48-29 13 "), "482913");
equal("and a paste with no digits is empty", pin.digitsOnly("hello"), "");
equal("and a non-string is empty", pin.digitsOnly(null), "");

done();
