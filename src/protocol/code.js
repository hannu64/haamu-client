// PROTOCOL.md §2.2 — the voice-readable variant of §2.1's link, and §2.2c's
// construction that turns sixteen spoken characters into a sixteen-byte `L`.
//
// This file exists because of one tester sentence: *"sending invite link can be
// difficult for some persons: they do not have WhatsApp or have the wrong email on
// that device."* The population it serves is the one with no channel that carries a
// URL, and the only channel they have left is a voice on a telephone.
//
// ⚠️⚠️ TWO THINGS IN §2.2 WERE FALSE UNTIL THIS FILE WAS WRITTEN, AND BOTH WERE
// FOUND BY WRITING IT (D-115, D-116). The alphabet was 31 characters under a
// parenthesis reading "(32 chars)", and the document never said how sixteen
// characters become the sixteen bytes every function in §3 consumes. Neither had
// survived three careful readings by being subtle; they survived by never having
// been built. The tests below are aimed at exactly that class.

import { asciiBytes } from "../crypto/bytes.js";
import { randomIndex } from "../crypto/random.js";

/**
 * §2.2's alphabet, 0.9.6. THIRTY-TWO characters; `0 1 I L` are excluded.
 *
 * ⚠️⚠️ IT WAS `ABCDEFGHJKMNPQRSTUVWXYZ23456789` UNTIL 2026-08-16 AND THAT IS 31,
 * not the 32 the specification printed beside it (D-115). Sixteen characters of it
 * carry 79.27 bits rather than 80, which costs nothing — but **31 is not a power of
 * two**, so every round number §2.2 and §2.2a are written in was unreachable from
 * the alphabet they described.
 *
 * `O` is back because `0` is gone: with the digit excluded there is nothing left for
 * the letter to be confused with, and `normalise` folds a typed `0` to it for the
 * person who heard "oscar" and reached for the key next to the 9.
 *
 * ⚠️ Nobody may add `0`, `1`, `I` or `L` to this string. Each of them re-creates the
 * misreading the exclusion exists to prevent, and `0` additionally collides with the
 * one-way fold below — two distinct codes would become one.
 */
export const CODE_ALPHABET = "ABCDEFGHJKMNOPQRSTUVWXYZ23456789";

/** §2.2: `XXXX-XXXX-XXXX-XXXX`. Sixteen characters, in groups of four. */
export const CODE_CHARS = 16;
export const CODE_GROUP = 4;

/** The characters `normalise` maps away, and what it maps them to. §2.2c. */
const FOLD = new Map([["0", "O"]]);

/**
 * §2.2's entropy, stated where it can be checked rather than in a comment.
 *
 * ⚠️ THIS IS 80 BITS ONLY WHILE THE ALPHABET IS 32 CHARACTERS. §2.2a's whole table —
 * and with it the claim that the ten-minute lifetime is no longer load-bearing —
 * rests on this figure, so it is computed from the alphabet rather than typed in.
 * D-115 is what typing it in looks like a year later.
 */
export const CODE_BITS = CODE_CHARS * Math.log2(CODE_ALPHABET.length);

/**
 * §2.2c: `normalise(s)` — uppercase, drop everything outside the alphabet, fold
 * `0 → O`. NORMATIVE, and all three rules are required.
 *
 * ⚠️⚠️ THIS IS THE SAME CLASS OF FUNCTION AS §7.2's `canonical()` AND FAILS THE SAME
 * WAY: two clients that normalise differently derive different `pairing_id`s from
 * the same spoken code, so the pairing is simply not found — on both screens, with
 * nothing on either to say why. It is not a convenience for re-entry; it is the
 * definition of the input.
 *
 * ⚠️ `toUpperCase`, never `toLocaleUpperCase`. In a Turkish locale the latter maps
 * "i" to "İ", which is outside the alphabet and would be deleted rather than
 * rejected — a code that works everywhere except on one person's phone.
 *
 * Deleting unknown characters rather than rejecting them is deliberate: a person
 * reading a code down a telephone line says "dash" or does not, adds spaces or does
 * not, and none of that is an error worth a screen. A character that is neither in
 * the alphabet nor foldable — `1`, `I`, `L`, a letter from another script — is
 * dropped here and caught by the length check in `parse`, which is the check that
 * can actually say something useful.
 */
export function normalise(s) {
  if (typeof s !== "string") throw new TypeError("code: expected a string");
  let out = "";
  for (const raw of s.toUpperCase()) {
    const c = FOLD.get(raw) ?? raw;
    if (CODE_ALPHABET.includes(c)) out += c;
  }
  return out;
}

/**
 * `XXXX-XXXX-XXXX-XXXX`. Display only — never hashed.
 *
 * ⚠️ IT NORMALISES FIRST, AND THAT IS NOT DEFENSIVENESS FOR ITS OWN SAKE. Without
 * it, formatting an already-formatted code re-groups the dashes as characters and
 * produces `KOMP--3XQ-R-BH-TW-9-FDN` — which is what the frozen vector caught on the
 * first run, from a generator that passed in the dashed form. A display function
 * that silently mangles its own output is a trap for every later caller, and there
 * is no case where `format(format(x))` should differ from `format(x)`.
 */
export function format(code) {
  const normalised = normalise(code);
  const groups = [];
  for (let i = 0; i < normalised.length; i += CODE_GROUP) groups.push(normalised.slice(i, i + CODE_GROUP));
  return groups.join("-");
}

/**
 * A fresh code: sixteen characters drawn uniformly from the alphabet.
 *
 * ⚠️ `randomIndex` REJECTION-SAMPLES, and that matters here even though 32 divides
 * 256 and a mask would be unbiased today. The uniformity of this draw must not be a
 * property of the alphabet's current length — that is precisely the coupling D-115
 * was made of. Change the alphabet and this stays correct.
 */
export function newCode() {
  let out = "";
  for (let i = 0; i < CODE_CHARS; i++) out += CODE_ALPHABET[randomIndex(CODE_ALPHABET.length)];
  return out;
}

/**
 * §2.2c: `L = ASCII(normalise(s))`. The characters ARE the secret.
 *
 * ⚠️⚠️ THE DOCUMENT DID NOT SAY THIS UNTIL 0.9.6 AND THE OTHER READING WAS EQUALLY
 * AVAILABLE (D-116) — pack the sixteen characters into ten bytes at five bits each.
 * Same entropy, same grinding cost, and a different `pairing_id` from the same
 * spoken code, forever. This one was chosen because `L` stays 16 bytes: every
 * `expectLength(L, 16)` in §3 is untouched and no codec enters the security path.
 *
 * The 80 bits here are not the 128 of §2.1 and are not meant to be. §2.2a costs the
 * difference: at this length the ten-minute lifetime stops being what protects the
 * secret, which is the entire reason the length is sixteen and not twelve.
 */
export function secret(code) {
  const normalised = parse(code);
  return asciiBytes(normalised, "L from a spoken code");
}

/**
 * A typed or spoken code, checked. Returns the normalised sixteen characters.
 *
 * The two failures are distinguished because the useful thing to say differs: too
 * few characters means one was lost or is not in the alphabet, too many means two
 * codes or a stray line. Both are counted after normalisation, so dashes and spaces
 * never reach the arithmetic.
 */
export function parse(s) {
  const normalised = normalise(s);
  if (normalised.length !== CODE_CHARS) {
    throw new SyntaxError(
      `code: expected ${CODE_CHARS} characters from the code alphabet, found ${normalised.length}`
    );
  }
  return normalised;
}

/** Is this string plausibly a code rather than a link? Used to route one field. */
export function looksLikeCode(s) {
  if (typeof s !== "string") return false;
  if (s.includes("#") || s.includes("://")) return false;
  return normalise(s).length === CODE_CHARS;
}

/**
 * §2.2b: the spelling a person reads out instead of the character.
 *
 * ⚠️⚠️ THIS TABLE IS NOT A GARNISH — §2.2b MAKES IT A REQUIREMENT, and the finding
 * behind it (D-113) is that this section has been called "voice-readable" since the
 * day it was written while its alphabet was chosen for an eye. Ten of these
 * characters are the English E-set — `B C D E G P T V Z 3` — which a telephone line
 * turns into each other. A misheard code is SAFE: it derives a `pairing_id` that
 * does not exist and nothing leaks. It costs only the one thing this variant exists
 * to provide, to the only people who need it.
 *
 * NATO/ICAO, and digits are spoken as themselves (not "niner"/"tree"), because the
 * radio forms are unfamiliar to the person this helps and the digits are not in the
 * E-set anyway once `0` and `1` are gone.
 *
 * ⚠️ The reference spelling is ENGLISH and that is a known residual, recorded in
 * §2.2b with its costed remedy: an ear-safe 22-character alphabet at 18 characters
 * for the same 80 bits, which needs no spelling words in any language. Two Finnish
 * speakers will not say "yankee". A client MAY substitute its own locale's alphabet
 * — this is presentation and touches neither the wire format nor the entropy.
 */
export const SPELLING = Object.freeze({
  A: "Alfa",
  B: "Bravo",
  C: "Charlie",
  D: "Delta",
  E: "Echo",
  F: "Foxtrot",
  G: "Golf",
  H: "Hotel",
  J: "Juliett",
  K: "Kilo",
  M: "Mike",
  N: "November",
  O: "Oscar",
  P: "Papa",
  Q: "Quebec",
  R: "Romeo",
  S: "Sierra",
  T: "Tango",
  U: "Uniform",
  V: "Victor",
  W: "Whiskey",
  X: "X-ray",
  Y: "Yankee",
  Z: "Zulu",
  2: "Two",
  3: "Three",
  4: "Four",
  5: "Five",
  6: "Six",
  7: "Seven",
  8: "Eight",
  9: "Nine",
});

/**
 * The code as groups of spelled-out characters, matching the printed grouping.
 *
 * Grouped rather than flat so the reader's eye can hold their place: sixteen words
 * in one line is a wall, and the person saying them is also watching a screen and
 * listening to somebody repeat them back.
 */
export function spell(code) {
  const normalised = parse(code);
  const groups = [];
  for (let i = 0; i < normalised.length; i += CODE_GROUP) {
    groups.push([...normalised.slice(i, i + CODE_GROUP)].map((c) => SPELLING[c]));
  }
  return groups;
}
