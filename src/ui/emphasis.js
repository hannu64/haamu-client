// The one piece of markup this product has, and the reason it is a module.
//
// ⭐ Round 4 of first use (2026-08-13) asked for three fragments of the opening
// explanation in bold. Everything this client displays goes through `textContent`
// — deliberately, and by §12's rule — so there was no way to emphasise a phrase
// inside a sentence at all.
//
// ⚠️⚠️ `innerHTML` IS NOT AN OPTION AND THAT IS MEASURED, NOT ASSUMED. This site
// enforces Trusted Types. Written the obvious way — `el.innerHTML += "<strong>…"`
// — and run in Chrome against the real headers on 2026-08-13, the browser says:
//
//     Failed to set the 'innerHTML' property on 'Element':
//     This document requires 'TrustedHTML' assignment.
//
// and the boot block that renders the gate dies with it, so the page shows
// NOTHING. Not a degraded paragraph — no gate at all. ⭐ The same assignment is
// refused for the empty string too, which is how the deployed site broke on
// 2026-08-12 after I wrote in a message that the empty case was carved out of the
// spec. It is not. So emphasis is built the only way that survives the policy:
// real element nodes, one `<strong>` per marked run, each carrying a plain text
// child.
//
// ⭐⭐ THE SECOND MARK ARRIVED WITH THE TESTER ROUND (D-110), AND IT IS WHY THIS FILE
// IS NOW A SMALL PARSER RATHER THAN A `String.split`.
//
// Half the testers said the front page was too much to read; exactly as many wanted
// every word of it kept. Those are two audiences, not a disagreement, and the only
// thing that serves both exactly is two layers — a surface written for somebody who
// has never heard of any of this, and the technical answer one tap away on the word
// it belongs to. So a string may now carry `[displayed text](term-id)`, and `term-id`
// names an entry in `copy.terms`.
//
// There are exactly two marks and they may nest one level, bold outside:
//
//     **bold**                     → a <strong> element node
//     [text](term-id)              → a <button> that discloses copy.terms[term-id]
//     **bold with a [term](id)**   → both, which product.what needs
//
// ⚠️ NESTING IS ONE LEVEL AND TERMS MAY NOT CONTAIN TERMS. `copy.terms` bodies are
// checked for markers by `test/copy.mjs` — a marker the renderer does not consume
// reaches a person as literal brackets, which is the same class of failure as a
// stray `**`.
//
// There is no escaping and no other mark. `ui/copy.js` is the only module allowed to
// contain either one.

/** A `**bold**` run. Non-greedy, so two runs in one sentence do not merge. */
const BOLD = /\*\*(.+?)\*\*/g;

/**
 * A `[text](term-id)` run. The id is deliberately narrow — lower case, digits and
 * hyphens — so that an ordinary parenthesis after an ordinary bracket cannot be
 * mistaken for a marker by a sentence nobody was thinking about.
 */
const TERM = /\[(.+?)\]\(([a-z][a-z0-9-]*)\)/g;

/** Term runs inside one already-classified stretch of text. */
function withTerms(text, strong, out) {
  let last = 0;
  for (const m of text.matchAll(TERM)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), strong, term: null });
    out.push({ text: m[1], strong, term: m[2] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), strong, term: null });
}

/**
 * Split a sentence into its runs, in order, losing no character that a person is
 * meant to read.
 *
 * @param {string} sentence
 * @returns {{ text: string, strong: boolean, term: string | null }[]}
 */
export function segments(sentence) {
  const s = String(sentence);
  const out = [];
  let last = 0;
  for (const m of s.matchAll(BOLD)) {
    if (m.index > last) withTerms(s.slice(last, m.index), false, out);
    withTerms(m[1], true, out);
    last = m.index + m[0].length;
  }
  if (last < s.length) withTerms(s.slice(last), false, out);
  return out.filter((run) => run.text !== "");
}

/** The sentence as a person would read it aloud — every marker removed. */
export function plain(sentence) {
  return segments(sentence)
    .map((run) => run.text)
    .join("");
}

/** Every term id this sentence asks for, in order. */
export function markedTerms(sentence) {
  return segments(sentence)
    .filter((run) => run.term)
    .map((run) => run.term);
}

/** True when every `**` opened is closed. An odd count is a copy defect. */
export function hasBalancedEmphasis(sentence) {
  return String(sentence).split("**").length % 2 === 1;
}

/**
 * ⚠️ THE CHECK THAT CATCHES A MARKER THE PARSER DID NOT UNDERSTAND. A malformed
 * term — a capital in the id, a space, a missing bracket — is not an error here; it
 * simply fails to match, and the raw characters travel all the way to `textContent`
 * and are shown to a person. `](` cannot occur in this product's prose for any other
 * reason, and a surviving `**` means an unbalanced pair, so their presence in the
 * PLAIN rendering is exactly the failure.
 *
 * ⭐ It is written against the OUTPUT rather than the input on purpose: asserting
 * that the source looks well-formed tests my regex against my own reading of it,
 * where asserting that nothing marker-shaped survives tests what a person receives.
 */
export function hasUnconsumedMarks(sentence) {
  const rendered = plain(sentence);
  return rendered.includes("](") || rendered.includes("**");
}
