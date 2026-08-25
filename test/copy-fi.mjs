/* The Finnish against the English it is a translation of.
 *
 * ⚠️⚠️ THIS FILE IS NOT A SECOND COPY OF `test/copy.mjs`, AND THAT IS THE DESIGN. Most of
 * what the English gate checks — that a number came from a constant, that §7.7's claim is
 * not made, that a limit is explained rather than announced — is checked HERE by checking
 * the Finnish against the English, because the English has already been held to it. A
 * translation that agrees with a sentence that satisfies a rule satisfies the rule.
 *
 * ⭐⭐⭐ THE CLEAREST CASE IS D-153'S. The ruling is *a quantity is a digit, in both
 * languages*, and the obvious way to check the Finnish half is a list of Finnish numerals
 * — which is a trap twice over: Finnish numerals inflect, so the list is of *kahden*,
 * *kolmella*, *neljäntoista* rather than of words, and a Finnish STEM IS NOT A WORD, so
 * `yhte-` collects *yhteys* (connection) and *yhteystiedot* (contacts) along with *yhtä*.
 * The first draft of that check reported four sentences for numerals none of them
 * contained. ➡️ **THE NUMBER-AGREEMENT CHECK ALREADY SAYS IT.** If the English renders a
 * digit and the Finnish spells the number out, the Finnish has a number the English does
 * not and the other way round, and they disagree. One rule, no word list, no allowlist,
 * and it inherits every future English ruling about numbers for free.
 *
 * ⚠️ What is left over is what genuinely differs between the two: that Finnish exists at
 * all for everything, that `AVAIN` is the Finnish `KEY` (D-109), that the markup lines up,
 * and that the switch itself is total and reversible.
 */
import * as copy from "../src/ui/copy.js";
import { FI, FI_BUILT } from "../src/ui/copy.fi.js";
import { setLanguage, held, unmatched, resetForTests } from "../src/ui/copy-language.js";
import { SAMPLES, coverage } from "./samples.mjs";
import { plain } from "../src/ui/emphasis.js";
import { check, equal, section, done } from "./harness.mjs";

/**
 * Every English sentence, keyed the way the review sheets key them: `path` for a plain
 * string, `path#args` for one branch of a built one.
 *
 * ⭐ The same keys the Finnish uses, and the same keys twenty-seven rounds of review used,
 * so this file, `copy.fi.js` and the whole translation history read against each other.
 */
function englishByKey() {
  const out = new Map();
  const walk = (value, path) => {
    if (typeof value === "string") out.set(path, value);
    else if (typeof value === "function") {
      const sets = SAMPLES[path];
      if (!sets) return;
      for (const args of sets) out.set(sets.length > 1 ? `${path}#${args.join(",")}` : path, value(...args));
    } else if (value && typeof value === "object") {
      for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k);
    }
  };
  for (const [k, v] of Object.entries(copy)) walk(v, k);
  return out;
}

/** The Finnish rendered over the same samples, keyed the same way. */
function finnishByKey() {
  const out = new Map();
  for (const [path, text] of Object.entries(FI)) out.set(path, text);
  for (const [path, fn] of Object.entries(FI_BUILT)) {
    const sets = SAMPLES[path] ?? [];
    for (const args of sets) out.set(sets.length > 1 ? `${path}#${args.join(",")}` : path, fn(...args));
  }
  return out;
}

resetForTests();
const EN = englishByKey();
const SUOMI = finnishByKey();

// ============================================================ there is a Finnish at all

section("the Finnish exists for everything, and only for what exists");

equal("⭐⭐ every English sentence has a Finnish one", [...EN.keys()].filter((k) => !SUOMI.has(k)).join(", "), "");
equal("⚠️ and no Finnish is left for a sentence that is gone", [...SUOMI.keys()].filter((k) => !EN.has(k)).join(", "), "");
check("there is a translation to check", EN.size > 250, `${EN.size} English keys, ${SUOMI.size} Finnish`);

// ⚠️ The English gate's own coverage check runs there; this asserts the two files agree
// about WHICH sentences are built at runtime, because a Finnish string where the English
// has a function is a sentence that would never see its number.
equal(
  "⚠️⚠️ the same sentences are built at runtime in both languages",
  Object.keys(FI_BUILT).sort().join(", "),
  Object.keys(SAMPLES).sort().join(", ")
);
equal("⚠️ and none of them is also a plain Finnish string", Object.keys(FI_BUILT).filter((p) => p in FI).join(", "), "");

// ⭐ The guard on the guard: `coverage()` is what proves the samples reach every branch, so
// if it ever stopped finding branches these comparisons would pass over a smaller world.
{
  const { unreached, missing } = coverage(copy);
  check(
    "⚠️ every branch is still reachable, so a match here is a match on all of it",
    unreached.length === 0 && missing.length === 0,
    `${unreached.length} unreached, ${missing.length} without samples`
  );
}

// ==================================================== the numbers say the same thing

section("every number in the Finnish is the number in the English");

/**
 * ⭐⭐⭐ THE CHECK THE WHOLE FILE LEANS ON. Every number in `copy.js` is interpolated from
 * the constant it describes; every number in `copy.fi.js` is typed. That is a deliberate
 * asymmetry — a Finn reviewing the translation should read sentences rather than
 * `${plural(days(QUARANTINE_DAYS))}` — and this is what pays for it: **the Finnish cannot
 * drift from the constant, because it cannot drift from the English, which cannot drift
 * from the constant.**
 *
 * ⚠️⚠️ TIME UNITS ARE NORMALISED TO SECONDS FIRST, AND THIS IS NOT A LOOPHOLE. The English
 * says *"It lasts 1 day"* and the Finnish says *"24 h ajan"* — the same constant, and a
 * choice the Finnish reviewers made in round 26 because *päivä* is also the daylight half
 * of one. Comparing digits would fail on a translation that is exactly right. Comparing
 * DURATIONS still fails the moment the constant moves: at two days the English says 2 days
 * and the Finnish still says 24 h, and 172800 ≠ 86400.
 *
 * ⚠️ A number with no unit after it compares as itself, so *"16 merkkiä"* against *"16
 * characters"* is an ordinary equality.
 */
const UNITS = new Map(
  Object.entries({
    day: 86400, days: 86400, hour: 3600, hours: 3600, minute: 60, minutes: 60,
    päivä: 86400, päivää: 86400, päivän: 86400, vuorokausi: 86400, vuorokauden: 86400,
    tunti: 3600, tuntia: 3600, tunnin: 3600, h: 3600,
    minuutti: 60, minuuttia: 60, minuutin: 60,
  })
);

/** Every number in a sentence: as seconds when a time unit follows it, else as itself. */
function quantities(text) {
  const out = [];
  for (const m of text.matchAll(/(\d+)\s*([A-Za-zÀ-ÿ]+)?/g)) {
    const n = Number(m[1]);
    const word = (m[2] ?? "").toLowerCase();
    out.push(UNITS.has(word) ? `${n * UNITS.get(word)}s` : `${n}`);
  }
  return out.sort().join(" ");
}

{
  const disagree = [...EN].filter(([key, en]) => quantities(plain(en)) !== quantities(plain(SUOMI.get(key) ?? "")));
  equal(
    "⭐⭐⭐ D-153 in both languages — no Finnish sentence states a number its English does not",
    disagree.map(([k]) => k).join(", "),
    ""
  );

  // ⭐ The guard on the guard, and it is a MUTATION rather than a count: if `quantities`
  // ever stopped seeing numbers, the check above would pass on 308 empty comparisons.
  check(
    "⚠️ the scanner still reads numbers, and still normalises a day against 24 h",
    quantities("Kept for 7 days") === "604800s" && quantities("24 h ajan") === "86400s" && quantities("16 merkkiä") === "16",
    `${quantities("Kept for 7 days")} · ${quantities("24 h ajan")} · ${quantities("16 merkkiä")}`
  );
}

// ================================================================== D-109 in Finnish

section("AVAIN is the Finnish KEY, and the lowercase noun never reaches a screen");

/**
 * ⚠️⚠️ THE NOUN'S ENDINGS, NEVER A BARE STEM. Finnish *avain* ("key") and *avata* ("to
 * open") share the letters that start them, and the copy is full of legitimate opening:
 * *avaaminen*, *avataksesi*, *avautuu*. A prefix test would report a dozen sentences for a
 * word none of them contains — the same trap as `yhte-` collecting *yhteys*. So this
 * matches the declensions of the noun and nothing else.
 */
const LOWERCASE_AVAIN = /\b(avain|avaimen|avaimesi|avaimeen|avaimella|avaimelle|avaimelta|avaimessa|avaimesta|avainta|avaimet|avaimia|avainten)\b/;

{
  const slips = [...SUOMI].filter(([, text]) => LOWERCASE_AVAIN.test(plain(text)));
  equal("⭐⭐ D-109 — no lowercase `avain` reaches a Finnish screen", slips.map(([k]) => k).join(", "), "");
  equal(
    "⚠️ and no English KEY is left standing in a Finnish sentence",
    [...SUOMI].filter(([, t]) => /\bKEY\b/.test(plain(t))).map(([k]) => k).join(", "),
    ""
  );
  check(
    "⚠️ the pattern still matches the noun and still ignores the verb",
    LOWERCASE_AVAIN.test("palvelimella on avain") && !LOWERCASE_AVAIN.test("avataksesi ne uudelleen"),
    "avain matched, avataksesi not"
  );
  // ⭐ Every Finnish sentence that talks about the KEY says AVAIN in capitals, so there is
  // something for the rule above to be true OF. An empty corpus satisfies it trivially.
  check(
    "⚠️ and the capitalised word is in the Finnish, so the rule has a subject",
    [...SUOMI.values()].filter((t) => /AVAIN/.test(t)).length > 10,
    `${[...SUOMI.values()].filter((t) => /AVAIN/.test(t)).length} Finnish sentences say AVAIN`
  );
}

// ================================================================ the shape lines up

section("the Finnish has the same shape as the English it replaces");

{
  const problems = [];
  const termIds = (s) => [...s.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((m) => m[1]).sort().join(",");
  for (const [key, en] of EN) {
    const fi = SUOMI.get(key) ?? "";
    if (termIds(en) !== termIds(fi)) problems.push(`${key}: term ids`);
    else if ((en.match(/\*\*/g) ?? []).length !== (fi.match(/\*\*/g) ?? []).length) problems.push(`${key}: bold`);
    else if ((en.match(/\n\n/g) ?? []).length !== (fi.match(/\n\n/g) ?? []).length) problems.push(`${key}: paragraphs`);
  }
  equal("⭐ D-110's term links, D-018's emphasis and the paragraph breaks all match", problems.join(", "), "");
}

/**
 * ⚠️⚠️ DERIVED, NOT LISTED — and the list it replaces is why. `build-copy-fi.py` named four
 * paths whose Finnish had to start with a capital, because their English opened on a
 * lowercase number word. D-153 made all four open on a DIGIT, and `"1".isupper()` is false,
 * so all four failed at once with nothing wrong with any of them. ➡️ **A check written when
 * two conditions were equivalent keeps only the one it happened to be phrased in.** The
 * condition that was always meant is below, and it needs no list: wherever the English
 * begins a sentence, the Finnish may not begin mid-one.
 *
 * ⚠️ ONE DIRECTION ONLY. The reverse is legitimately violated: `unlock.placeholder` is
 * *"your KEY"* in English and *"AVAIMESI"* in Finnish, where D-109's capital is the word.
 */
{
  const lower = [...EN].filter(([key, en]) => /^[A-ZÅÄÖ]/.test(en) && /^[a-zåäö]/.test(SUOMI.get(key) ?? "X"));
  equal("⭐ a Finnish sentence does not start lowercase where its English starts a sentence", lower.map(([k]) => k).join(", "), "");
}

/**
 * ⚠️ A sentence identical in both languages is usually one nobody translated. These four
 * are genuine and are exempt BY PATH WITH THE REASON, so a fifth has to be argued for.
 *
 * ⚠️⚠️ THE VALUE IS CHECKED AS WELL AS THE PATH, and that is what stops this list from
 * rotting into a licence. An exemption that names only a path goes on excusing whatever
 * that path grows into — D-152's finding, and D-157 found one still standing. Here, the
 * moment `chat.live` stops saying "live" the exemption stops applying to it.
 */
{
  const IDENTICAL_ON_PURPOSE = {
    "product.name": ["haamu", "the product's own name, which is a Finnish word already"],
    "chat.live": ["live", "the stream indicator — WhatsApp's own word, used in Finnish too"],
    "menu.english": ["English", "D-159 — each language is named in itself, or the option you need is written in the language you cannot read"],
    "menu.finnish": ["Suomi", "D-159 — the same, from the other side"],
  };
  const same = [...EN]
    .filter(([key, en]) => en.trim() === (SUOMI.get(key) ?? "").trim())
    .filter(([key]) => !(key in IDENTICAL_ON_PURPOSE));
  equal("⚠️ nothing is left untranslated except the four that are the same on purpose", same.map(([k]) => k).join(", "), "");

  const wrong = Object.entries(IDENTICAL_ON_PURPOSE).filter(([key, [value]]) => EN.get(key) !== value);
  equal(
    "⚠️⚠️ and every exemption is still the sentence it was written for, by VALUE and not by path",
    wrong.map(([k, [want]]) => `${k}: wanted "${want}", found "${EN.get(k) ?? "nothing"}"`).join(" · "),
    ""
  );
  check(
    "⭐ and each one still says why it is exempt, so a fifth cannot be waved through",
    Object.values(IDENTICAL_ON_PURPOSE).every(([, why]) => why.length > 20),
    `${Object.keys(IDENTICAL_ON_PURPOSE).length} exemptions, each with a reason`
  );
}

/**
 * ⭐⭐ D-163 IN FINNISH, CHECKED AGAINST THE OBJECT AND NOT AGAINST THE VERB.
 *
 * The English rule is *"a sentence promising the list comes back says in the same breath
 * that it is empty"*, and porting it here by its verb would find whatever Finnish sentences
 * happen to contain *palaa* — `feedback_legal_text_drift`'s D-158 class, where a rule ported
 * by its verb lands on a sentence that says something else. So the Finnish is held to the
 * one WORD that carries the fact: *tyhjä*. If the Finnish confirmation stops saying a
 * conversation comes back empty, it has lost the repair whatever else it says.
 *
 * ⚠️ The paragraph-shape check above already guarantees the Finnish has the same number of
 * paragraphs as the English, so this cannot be satisfied by a sentence bolted on the end of
 * a differently-shaped text.
 */
{
  /* ⛔⛔⛔ AND THE FIRST VERSION OF THIS CHECK WAS `/tyhj/i`, WHICH PASSED THE MUTATION.
   *
   * `tyhj-` collects *tyhjä* ("empty") and *tyhjentää* ("to clear") alike, and the fourth
   * paragraph of this very string ends *"saat ne pois tyhjentämällä tämän sivuston
   * tiedot"*. So the rule read the sentence about clearing browser data and reported that
   * the sentence about an empty conversation was present. Deleting the empty-conversation
   * sentence outright did not fail the build.
   *
   * ⭐⭐ THIS IS D-158's OWN LESSON — *a Finnish stem is not a word* — arriving inside the
   * check whose comment cites D-158. ➡️ **Citing a rule is not applying it.** The thing
   * that caught it was not the reasoning; it was deleting the sentence and watching the
   * suite stay green.
   *
   * ⚠️ `\b` is no use here: JavaScript's word boundary is ASCII, so `ä` is already a
   * non-word character and `\btyhjä\b` would match inside longer words. The guard is an
   * explicit "not followed by another Finnish letter".
   */
  const EMPTY_FI = /tyhjä(?![a-zåäö])/i;
  check(
    "⚠️⚠️ the pattern matches the ADJECTIVE and not the verb that clears a browser",
    EMPTY_FI.test("jokainen keskustelu siinä on tyhjä.") && !EMPTY_FI.test("saat ne pois tyhjentämällä tämän sivuston tiedot"),
    "tyhjä matched, tyhjentämällä not"
  );

  const fi = SUOMI.get("ending.confirm") ?? "";
  check("⭐⭐ the Finnish ending says the conversation comes back EMPTY (D-163)", EMPTY_FI.test(fi), fi);
  check(
    "⚠️ and it names the messages, which is what the English control now names",
    /viesti/i.test(fi) && /viesti/i.test(SUOMI.get("ending.control") ?? ""),
    `${SUOMI.get("ending.control")}  ‖  ${fi.slice(0, 60)}…`
  );
  check(
    "⚠️ the lock's Finnish note promises the opposite, in the same two words",
    /ei poisteta/i.test(SUOMI.get("lock.controlNote") ?? "") && /viesti/i.test(SUOMI.get("lock.controlNote") ?? ""),
    SUOMI.get("lock.controlNote")
  );
}

// ============================================== the claims the specification forbids

section("§7.7, §7.8, §6.6 and §11 forbid the same claims in Finnish");

/**
 * ⚠️⚠️ THE SPECIFICATION'S LIMITS ARE ABOUT WHAT MAY BE CLAIMED, NOT ABOUT ENGLISH. A
 * Finnish sentence promising that deletion is guaranteed is exactly as false as an English
 * one, and `test/copy.mjs`'s patterns cannot see it — they are English words. These are the
 * ones that translate; each carries the section that forbids it.
 *
 * ⭐ Deliberately not a translation of the whole English list. D-112's register rule cannot
 * be expressed as a pattern in either language, and inventing Finnish patterns for rules
 * nobody has broken in Finnish would be a list that looks like protection and is not.
 */
const KIELLETYT = [
  // ⚠️⚠️ THE OBJECT IS IN THE PATTERN, AND THE FIRST DRAFT'S WAS NOT. `nollata` on its own
  // fired on `terms.key.body.3` — *"eikä mitään tapaa nollata sitä"*, which translates the
  // English *"and no way to reset it"*, because **nollata is Finnish for both "zero" and
  // "reset"**. That is the third stem collision in this one file (`avain`/`avata`,
  // `yhte-`/`yhteys`), and they are the same lesson: ➡️ **a Finnish word that translates one
  // English word in one sentence translates a different one in the next**, so a pattern
  // ported from English by its verb finds sentences that say something else entirely.
  [/(muistin?|muistia) nollat|nollat\w* (muistin?|muistia)/i, "§7.7 — muistin nollaamista ei saa väittää"],
  [/ei jälkeäkään|ilman jälkeä|kaikki jäljet/i, "§7.3.1a — poistopäivä jää AVAIMEN taakse pysyvästi"],
  [/(täysin|kokonaan) (poistettu|poistuu|tuhottu|hävitetty)/i, "§7.8 — vain 'poistuu tästä selaimesta' on tosi"],
  [/pysyvästi (tuhottu|hävitetty)/i, "§7.8 — mikään ei ole nähnyt selaimen vapauttavan sitä muistia"],
  // ⚠️ NOT `takaa`, which is also the postposition "from behind" — *AVAIMESI takaa* is on
  // half the screens in this product. Only the unambiguous forms.
  [/taattu|takuu|takaamme/i, "§6.6 — poisto on paras yritys, ei takuu"],
  [/sotilastason|pankkitason|murtamaton|100 ?%/i, "§11 — uhkamalli on lista siitä mitä tämä EI suojaa"],
  [/anonyymi|jäljittämät/i, "§7.3.3 — `roster_id` on pysyvä tunniste jokaisessa luku- ja kirjoituspyynnössä"],
];

for (const [pattern, why] of KIELLETYT) {
  const hits = [...SUOMI].filter(([, t]) => pattern.test(plain(t)));
  equal(`⚠️ ${why}`, hits.map(([k]) => k).join(", "), "");
}

check(
  "⭐ the forbidden patterns still match Finnish, so an empty result means clean",
  KIELLETYT.some(([re]) => re.test("poisto on taattu")) &&
    KIELLETYT.some(([re]) => re.test("sotilastason salaus")) &&
    KIELLETYT.some(([re]) => re.test("muistin nollataan lopuksi")) &&
    // ⭐ and the two sentences the patterns must NOT find: a real one from this product,
    // and the postposition the guarantee pattern used to collide with.
    !KIELLETYT.some(([re]) => re.test("eikä mitään tapaa nollata sitä")) &&
    !KIELLETYT.some(([re]) => re.test("keskustelusi ovat AVAIMESI takana")),
  `${KIELLETYT.length} patterns`
);

// ================================================================== the switch itself

section("D-158 — putting the Finnish in, and taking it out again");

{
  check("`copy.js` starts in English", held() === "en" && copy.chat.send === "Send", `held ${held()}, send "${copy.chat.send}"`);

  setLanguage("fi");
  check("⭐⭐ after the switch every path is the Finnish one", held() === "fi" && unmatched.length === 0, `${unmatched.length} unmatched`);

  const stillEnglish = [...SUOMI].filter(([key]) => {
    const [path] = key.split("#");
    const value = path.split(".").reduce((node, part) => node?.[part], copy);
    if (typeof value === "function") {
      const args = SAMPLES[path]?.[0] ?? [];
      return value(...args) !== SUOMI.get(SAMPLES[path]?.length > 1 ? `${path}#${args.join(",")}` : path);
    }
    return value !== SUOMI.get(key);
  });
  equal("⭐⭐⭐ and nothing anywhere in `copy.js` is still the English", stillEnglish.map(([k]) => k).join(", "), "");

  // ⚠️⚠️ THE ONE THAT MATTERS FOR THE PERSON HOLDING THE PHONE. The switch may not reload:
  // `K_master` is in memory and nowhere else, so a reload asks a signed-in person for their
  // eight words again. Which means going back to English cannot re-import anything — it has
  // to restore what was captured. This is that, checked on the deepest shapes there are.
  setLanguage("en");
  check(
    "⭐⭐⭐ and going back restores the English exactly — a string, an array member, a built sentence",
    copy.chat.send === "Send" &&
      copy.terms["invite-link"].body[1].startsWith("One person can open it") &&
      copy.deletion.suspect(3) === "3 conversations were deleted from another device.",
    `${copy.chat.send} · ${copy.deletion.suspect(3)}`
  );
  check("and it says so", held() === "en", held());

  // ⭐ Twice each way, because a switch that only works once is a switch that has captured
  // the Finnish as though it were the English.
  setLanguage("fi");
  setLanguage("en");
  setLanguage("fi");
  const roundTrip = copy.chat.send;
  setLanguage("en");
  check("⚠️ and it survives being switched three times", roundTrip === "Lähetä" && copy.chat.send === "Send", `${roundTrip} → ${copy.chat.send}`);

  let refused = false;
  try {
    setLanguage("sv");
  } catch {
    refused = true;
  }
  check("⚠️ a language this product is not in is refused, not half-applied", refused && held() === "en", `held ${held()}`);
}

done();
