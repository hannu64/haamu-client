// Every sentence the product says to a person, in one place.
//
// ⚠️⚠️ THIS FILE EXISTS BECAUSE PROSE THAT DESCRIBES A CONSTANT IS NOT CHECKED BY
// ANYTHING. A number in a sentence — "24 hours", "seven days", "eight words" —
// is a copy of a decision made somewhere else, and nothing in a build notices when
// the decision moves and the sentence does not. PROTOCOL.md has already paid for
// this once: §8's placeholder copy said files were kept for 7 days when retention
// was 7 to 14, which told the reader their file left the server sooner than it did
// — the dangerous direction.
//
// So every number here is INTERPOLATED FROM THE CONSTANT rather than typed, and
// `test/copy.mjs` reads this module against those constants. A sentence that
// cannot be built from a constant is a sentence somebody has to check by hand, and
// there are a few — they are marked.
//
// ⚠️ THE SECOND RULE IS ABOUT WHAT MAY BE CLAIMED, and it is not a style question.
// §7.7 forbids claiming memory zeroization. §7.8 permits "removes it from this
// browser now" and forbids anything stronger. §7.3.1a forbids telling a user that
// deleting a conversation removes every trace of it. §6.6 requires that deletion
// be described as best-effort. Each of those is a sentence somebody would
// otherwise write in good faith, and the reason they are wrong is in the section,
// not here — so each one below carries its citation.
//
// ⚠️⚠️ THE THIRD RULE ARRIVED WITH THE TESTER ROUND AND IT IS ABOUT REGISTER (D-112).
// The rule above says what may not be CLAIMED. This one says what may not be
// SOUNDED LIKE, and it exists because two sentences that satisfied every other rule
// in this file failed anyway:
//
//     "That is metadata. This design cannot hide it."
//     "Nothing says anything is wrong, and it is encrypted either way."
//
// Both are true. Both were written to be exact about a limit. Both were defended in
// the decision log. A tester's verdict on the first was *"my friends asked whether
// an AI wrote that — and they start to wonder what the design should be hiding"*,
// and on the second, *"do not use this, confused everyone."*
//
// ➡️ THE CONSTRUCTION IS THE DEFECT, NOT THE TWO INSTANCES: an abstract subject
// ("this design", "nothing") asserting what something IS NOT. Written that way, a
// sentence guarding against an overclaim reads as a confession, and manufactures the
// suspicion it exists to prevent. **A LIMIT MUST BE EXPLAINED, NOT ANNOUNCED** —
// state what IS the case and why, and let the limit follow from it. "It is what any
// server has to know to deliver a message at all" carries the identical fact and
// leaves a reader informed rather than uneasy.
//
// ⚠️ Nothing in a build can catch this. Every check in `test/copy.mjs` compares a
// string to a constant or to a pattern; none of them can hear a voice. It is the
// neighbour of D-107's class and it is why the tester round existed.
//
// ⚠️⚠️ THE FOURTH RULE IS THE WORD "KEY" (D-109), AND IT IS A COLLISION, NOT A
// PREFERENCE. The product's word for the user's eight words is **KEY**, in capitals,
// because the testers understood it and did not distinguish password, passphrase and
// key from one another at all. But this is a cryptographic product, where "key"
// already means something — and a person who reads "the server holds one public key"
// beside "the server never gets the key" can only conclude that it holds theirs.
//
// So: **`KEY` in capitals is the user's eight words and nothing else, ever**, and the
// bare lowercase word is swept out of user-facing copy entirely rather than merely
// kept at a distance from it. `test/copy.mjs` fails on "passphrase", on the bare word
// "phrase", and on a loose lowercase "key". ⭐ Code identifiers are deliberately NOT
// renamed — `PHRASE_WORDS`, `protocol/passphrase.js`, the `phrase` export below —
// because D-001's lesson runs both ways: the name baked into the construction is not
// the name on the screen and does not have to be.

import { MESSAGE_TTL_S } from "../storage/vault.js";
import { QUARANTINE_DAYS } from "../flow/quarantine.js";
import { CANDIDATES_PER_SET, MAX_CANDIDATE_SETS, PHRASE_WORDS, PHRASE_WORDS_LONG } from "../protocol/passphrase.js";
import { PAIRING_TTL_SECONDS } from "../protocol/pairing.js";
import { CODE_CHARS } from "../protocol/code.js";
import { EPOCH_SECONDS } from "../protocol/epoch.js";
import { BLUR_MS, IDLE_MS } from "../flow/lock.js";

const hours = (seconds) => Math.round(seconds / 3600);
const minutes = (seconds) => Math.round(seconds / 60);
const days = (seconds) => Math.round(seconds / 86400);

/**
 * §5.1.1: the server deletes an uncollected message at `created_at + 2 ×
 * EPOCH_SECONDS`. It is arithmetic on §4.1's epoch and not a number of its own,
 * which is exactly why it is computed here rather than typed — the sentence that
 * says "fourteen days" to a user is the one thing that would keep saying it if
 * the epoch moved.
 */
const MAILBOX_LIFE_S = 2 * EPOCH_SECONDS;

/**
 * ⚠️ SEPARATE FROM `minutes` BECAUSE THE UNITS DIFFER AND NOTHING ELSE WOULD SAY
 * SO. §4.3's thresholds are milliseconds — they are compared against `Date.now()`
 * — while §3's and §6's are seconds. Passing one to the other's helper produced
 * "Locked after 10000 minutes without use", which `test/copy.mjs` caught on the
 * first run. That is the check earning its keep on a mistake nobody would find by
 * reading, and the reason the two helpers are not one clever one.
 */
const minutesFromMs = (ms) => Math.round(ms / 60000);

/**
 * A quantity reaches a person as a DIGIT. (D-153)
 *
 * ⚠️⚠️ A LOOKUP TABLE OF NUMBER WORDS STOOD HERE UNTIL 2026-08-23, and why it went is
 * worth more than what it did. It held 0–16, 20, 30, 45 and 60 — every value some
 * constant in this build happened to land on — and anything else fell through to a
 * digit. That was defended as failing visibly, and for a CONSTANT it was: a threshold
 * somebody edits deliberately either has a word or obviously does not.
 *
 * ⭐⭐ IT WAS NEVER TRUE OF A COUNT. `list.unexplained` takes however many conversations
 * are actually missing, `list.noHistory` however many a device holds. So *"Sixteen
 * conversations are missing"* and *"17 conversations are missing"* were one sentence in
 * two forms, and which form a person met was decided by the size of their own number —
 * nobody chose it, and no review could see it, because both forms are correct English
 * and only one of them was ever on a screen anybody looked at.
 *
 * Hannu ruled it out, asked how Finnish should spell numbers: *"I strongly recommend
 * using numbers instead of words to describe amounts. That would be understandable and
 * faster readable to everyone."* ⭐ It is also the larger half of what made the Finnish
 * hard — a Finnish numeral INFLECTS (*kahden*, *kolmella*), so the table would have had
 * to carry cases rather than words, in a language where getting the case wrong is not a
 * style slip but a different sentence.
 *
 * ⚠️ A DIGIT IN A SENTENCE IS STILL NOT ALWAYS A QUANTITY, and the copy gate still
 * refuses one that no constant put there. `pairing.code_malformed` is the standing
 * exception and it names a GLYPH, not an amount. See `test/copy.mjs`.
 *
 * ⚠️ WHAT WENT WITH IT: `caps`, added the day before by D-152 to capitalise four
 * warnings that opened on a lowercase number word. All four now open on a digit, so the
 * defect stays fixed and the helper has no work left. D-152's real finding — the clock
 * sentence living outside the copy gate — is untouched by this.
 */

/** "1 minute" / "5 minutes" — the noun follows the number, the number stays a digit. */
export const plural = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/**
 * A duration in the unit a person would actually say it in — "10 minutes",
 * "1 day".
 *
 * ⚠️⚠️ IT EXISTS BECAUSE D-136 BROKE THE OLD WORDING. Every sentence about the
 * invite link said `plural(minutes(PAIRING_TTL_SECONDS), "minute")`, which was right
 * at 600 seconds and became *"1440 minutes"* at 86400. ⭐ THE UNIT IS THE FIX, NOT THE
 * NOTATION: "1440 minutes" is a true sentence that no person reads as a day, and
 * D-153's digits do not improve it. Choosing the unit is what makes it readable.
 *
 * ⚠️ Exact divisions only. A duration that is not a whole number of days or hours
 * falls through to minutes, because "about a day" is a different promise from the
 * one the constant makes, and this string appears where the promise matters.
 */
export const span = (seconds) => {
  if (seconds % 86400 === 0) return plural(days(seconds), "day");
  if (seconds % 3600 === 0) return plural(hours(seconds), "hour");
  return plural(minutes(seconds), "minute");
};

// ------------------------------------------------------------- what this is

/**
 * §D-083. The masthead and the answer to *"what on earth is this?"*
 *
 * ⚠️⚠️ THE MASTHEAD SAID `lpm` UNTIL 2026-08-13, WHICH IS THE ONE THING D-001
 * FORBIDS. `lpm` is the protocol namespace token: it is baked into every HKDF
 * `info` string on every device, it is permanent, and it names the CONSTRUCTION.
 * The product is `haamu`. D-012 predicted the drift in exactly these words —
 * *"the placeholder people see is the thing that becomes the name by accident"* —
 * and then it happened anyway, because the interface was built in a step whose
 * subject was something else.
 *
 * ⭐ The four paragraphs below are what a person can repeat to a friend, which is
 * what Hannu asked for and is a harder test than being accurate. Each one is a
 * fact about the product rather than a promise about it, and the one thing they
 * deliberately do NOT say is "nothing is stored centrally" — §7.3's roster blob
 * is stored centrally, permanently, and encrypted, and `server` below says so.
 */
export const product = {
  name: "haamu",
  gloss: "haamu is Finnish for ghost",

  /**
   * §7.8's landing page names itself in the browser tab, and that is a sentence a
   * person reads. ⭐ The copy gate found it on its first run — the title element is
   * exactly the kind of place prose hides, because nobody thinks of a tab label as
   * copy until they see the wrong word in it.
   */
  endedTitle: "haamu — ended",

  /**
   * ⭐ THE ONLY STRINGS IN THIS MODULE THAT CARRY EMPHASIS, AND THE MARKUP IS `**`.
   *
   * Round 4 (2026-08-13) asked for three fragments in bold. These paragraphs are the
   * first thing anybody reads and they are read at a glance, so the marks are here
   * rather than in the renderer: `ui/emphasis.js` splits on `**` and `app.js` builds
   * the `<strong>` as a DOM node. ⚠️ It cannot be done with `innerHTML` — that is a
   * Trusted Types sink and this site enforces them (D-103, measured: the page does
   * not degrade, the gate never renders at all).
   *
   * ⚠️ Nothing else in this module may use `**`. `test/copy.mjs` asserts that,
   * because a marker in a string that reaches `textContent` is displayed to a
   * person as two asterisks.
   *
   * ⭐⭐ REWRITTEN FOR THE TESTER ROUND (D-110), AND THE BRIEF WAS AN EXACT TIE. Half
   * the testers said this was too much to read *"for somebody who just needs the app
   * but does not understand the technicals"*; exactly as many wanted every word of it
   * kept. Averaging those two would have produced a page still too long for the first
   * half and now missing things for the second. **The tie is only resolvable on two
   * layers**: these sentences are written for a person who has never heard of any of
   * this, and every technical answer they spend to stay short is one tap away in
   * `terms` below, on the word it belongs to.
   *
   * ⚠️⚠️ "link-paired messenger" IS GONE AND MUST NOT COME BACK (D-111). It opened the
   * first paragraph a first-time reader ever met, it was Hannu's own coinage, I
   * adopted it without testing it on anybody, and *"several testers did not understand
   * that."* Deleting it also retires D-102's single registered exception to the
   * invite-link rule — the check that PERMITTED it goes with the string it permitted,
   * which tightens the rule to no exceptions (D-107).
   *
   * ⚠️ The word count is interpolated from `PHRASE_WORDS` and rendered as a DIGIT.
   * ⭐⭐ THIS PARAGRAPH IS WHERE THAT WAS FIRST DECIDED, in round 6, and for months it
   * was the ONLY place it applied — the phrase note two screens away still said *"Ten
   * words"*. The reasoning given here was general (*"scanned, not read, and '8' survives
   * a glance where 'eight' does not"*) and the change was not. D-153 finished it. D-064's
   * requirement is that the number cannot drift from the constant, not which glyphs it
   * wears; a house rule about the glyphs is a separate thing and now exists.
   */
  // ⭐⭐ AND THE EMPHASIS IS SHORT ON PURPOSE — READ THE FOUR BOLD RUNS ON THEIR OWN:
  //
  //     secure messenger · 8 words · opened only once · cannot read it
  //
  // That is the product, in four fragments, for somebody who is not going to read
  // the paragraphs.
  //
  // ⚠️⚠️ THE RETENTION SENTENCE IS D-148's SECOND PASS AND IT EXISTS BECAUSE OF WHAT
  // THE FIRST ONE CREATED. Round 24 shortened this paragraph to *"Old conversations are
  // saved behind your KEY"* — true of the CONVERSATION and, standing alone, read as a
  // promise about its MESSAGES, which are gone in a day. Hannu then asked *"it does not
  // state anywhere how long the messages are saved?"* — and he was right: `chat.ttl` says
  // it INSIDE a conversation, which is after the decision, and no wizard screen said it
  // at all. ⭐ The wrong reading was the reassuring one, which is the dangerous direction.
  //
  // ⚠️ `${span(MESSAGE_TTL_S)}` AND NOT "a day", which is the whole subject of this file:
  // the same constant `chat.ttl` spells as hours. A typed "a day" is a sentence that keeps
  // saying it after §5 moves.
  //
  // ⚠️ TWO RESIDUALS, DELIBERATELY NOT ON THE GATE. The delete happens on THIS device and
  // is actioned at the next open, and the other person's copy runs on its own clock —
  // both are in `chat.ttl` where a person can act on them. A gate that carried them would
  // be the paragraph this round was cutting. ⚠️ The first draft of this rewrite bolded whole clauses and put
  // roughly HALF the opening screen in 600 weight, which is emphasis that marks
  // nothing — the same failure as D-104's item 5, where a filled bubble on every
  // message made the loudest thing on the screen the half the reader already knew.
  // Found by looking at a screenshot of the rendered page, which is the only
  // instrument that shows how much of a screen a rule covers.
  what: [
    "haamu is a **secure messenger**. There are **no accounts, no user names and no passwords**. " +
      "It never asks for your phone number or your email address.",

    `Instead you get **${PHRASE_WORDS} words** that are the secret [KEY](key) to your conversations. ` +
      "The KEY is your identity, and it never leaves this device. Write it down somewhere safe, " +
      "because it is the only way back to your conversations and contacts. We do not have it, and " +
      "we cannot help you if you lose it.",

    "To start a new conversation you send an [invite link](invite-link) that can be " +
      `**opened only once**. Old conversations are saved behind your KEY. The messages ` +
      `auto-delete after ${span(MESSAGE_TTL_S)}.`,

    "Once the conversation has started, only you and your friend can read it. " +
      "The [server](server) **cannot read it**.",
  ],
};

// ------------------------------------------------- D-110 — the layer underneath

/**
 * ⭐⭐ THE SECOND LAYER, AND IT EXISTS BECAUSE THE ROUND SPLIT EXACTLY IN HALF.
 *
 * Half the testers wanted less to read; exactly as many wanted the information kept.
 * Those are not opposed requests, they are two audiences, and both are served in full
 * by putting them on different layers. A word marked `[like this](term-id)` in any
 * string above becomes a button; pressing it opens the matching entry here,
 * **underneath the paragraph it sits in**.
 *
 * ⚠️⚠️ IT IS NOT A HOVER TOOLTIP, AND THAT IS MECHANICAL RATHER THAN AESTHETIC. This
 * is a messenger: the majority device has no pointer, and a panel revealed by hovering
 * is a panel half the users can never open at all. So these are tap targets, they
 * expand in the flow rather than floating over it, and the reader never loses their
 * place on a small screen.
 *
 * ⚠️ WHAT BELONGS HERE, so it does not silt up into a junk drawer: the sentence that
 * is true and unreadable — the precision the surface spent to stay short. **If a fact
 * belongs on the surface, putting it here is hiding it. If a fact needs three clauses,
 * putting it on the surface is the defect this layer exists to fix.**
 *
 * ⚠️ Entries may not nest — no `[term](id)` inside a body — because the renderer walks
 * one level and a marker it does not consume reaches a person as literal brackets.
 * `test/copy.mjs` checks that, that every marked term has an entry, and that every
 * entry is reachable from some marked string.
 *
 * ⭐ THE ONE PLACE THE LOWERCASE WORD "key" IS ALLOWED (D-109). Everywhere else it is
 * swept out, because it collides with the product's name for the user's eight words.
 * Here the reader has asked for the technical answer, so the entry can afford to draw
 * the distinction explicitly instead of avoiding it — which is better than silence,
 * since this is precisely the reader who will meet the word elsewhere.
 */
export const terms = {
  key: {
    label: "KEY",
    title: "Your KEY",
    // ⚠️ HANNU CUT THIS FROM FIVE PARAGRAPHS TO FOUR ON REVIEW, AND THE CUT IS RIGHT
    // FOR A REASON WORTH KEEPING. The paragraph that went explained Argon2id — *"a
    // deliberately slow calculation … about a second on an old phone … that second is
    // what makes guessing expensive"*. It is true, and it belongs on the screen where
    // somebody is WAITING that second, which is `unlock.why`. Here it answered a
    // question nobody had opened this panel to ask. ⭐ The general form: a body in
    // this layer holds the footnote its own surface sentence owes, and not everything
    // true about the subject.
    body: [
      `It is ${PHRASE_WORDS} short words, picked at random on this device the moment you set up. ` +
        "They lock your conversations and contacts.",

      // ⚠️⚠️ THE HONEST FOOTNOTE TO "it never leaves this device", AND THE SURFACE
      // SENTENCE IS WHY IT IS OWED. §7.2 derives `roster_id = HKDF(K_master, …)` and
      // sends it — so the words themselves never travel, and a number computed from
      // them does. Left unsaid, the surface sentence invites a reader to conclude
      // that nothing derived from it travels either, which is not true.
      "The words themselves never leave this device. One number worked out from them does travel: " +
        "it is what the server files your conversation list under, so that your other devices can " +
        "find it. That number cannot be turned back into your words.",

      // ⭐ The collision, addressed rather than dodged — this is the one reader who
      // will meet the word "key" in its cryptographic sense and wonder (D-109).
      "KEY in capitals always means these words of yours.",

      "There is no account behind it, no email address, and no way to reset it. If it is lost, " +
        "your conversations cannot be opened by anybody, including us.",
    ],
  },

  /**
   * §7.4's retype, explained where it is challenged rather than beside the field.
   *
   * ⭐ THE ONLY THING THAT MAKES THIS STEP MEAN ANYTHING IS THE KEY NOT BEING ON THE
   * SCREEN (D-084 — a first user found that defect from a button label). Both routes
   * back to it clear the field, so a person who looks again types it again: the same
   * test taken twice, not a different and easier one.
   */
  // ⭐⭐ ROUND 7, ITEM 4 — HANNU'S TEXT, AND IT IS SHORTER THAN MINE BY HALF. Three
  // paragraphs of mechanism became two of plain reason. What his version does that mine
  // did not: it says what is AT STAKE ("we cannot help you if you lose it") instead of
  // what the step is EVIDENCE OF, and it tells the reader where to put the KEY. Mine
  // explained the design to somebody who only wanted to know why they were being asked.
  //
  // ⚠️ One sentence of mine is gone on purpose and is flagged for him: *"The field
  // clears when you do"*. It warned a person that going back to look empties what they
  // had typed. Nothing else says so, so the emptied field is now a small surprise —
  // his call whether that is worth a clause.
  retype: {
    label: "somewhere safe",
    title: "Why type it again",
    body: [
      "Type the KEY again here, because we want to be sure you have written it down. We cannot " +
        "help you if you lose it.",

      "You can go back and look at it, and write it down or copy it to a safe place. A password " +
        "manager is a good place for the KEY.",
    ],
  },

  "invite-link": {
    label: "invite link",
    title: "The invite link",
    body: [
      "It is a web address with a secret on the end of it. The secret is the part after the # , " +
        "and browsers never send that part to the server — so the invite link can travel through " +
        "the server without the server learning what is in it.",

      `One person can open it, once. It lasts ${span(PAIRING_TTL_SECONDS)}. Opening ` +
        "it is what sets the conversation up. Once opened it works no more.",

      // ⚠️ D-150 turned the pointer into the instruction. "it is what the six digits are for"
      // names the remedy without saying what to do with it; `terms["six-digits"]` says what to
      // do, and a reader on this page may never open that one. The two now give the same
      // instruction in the same words — "by some other route" — and `test/copy.mjs` holds
      // them to it, because one instruction with two homes is how they drift apart.
      "Whoever opens it first is who you end up talking to. An invite link cannot check the " +
        "person for you. So ask your friend by some other route what their six digits are.",

      "Send it however you normally talk to that person.",

      // §2.2, and the disclosure layer is where it is introduced rather than on the
      // front page: the person who needs it discovers the need mid-flow, and the
      // person who is merely curious looks here (D-117).
      `If a link cannot reach your friend at all, there is a spoken version — ${CODE_CHARS} ` +
        "characters you can read out over the phone or send in a text message. The button for it " +
        "is on the screen where the invite link is shown.",
    ],
  },

  server: {
    label: "server",
    title: "What the server holds",
    body: [
      "Messages are scrambled on your device before they go anywhere, and unscrambled on your " +
        "friend's. In between, the server holds a mailbox — a generated id number — one public " +
        "value left over from setting the conversation up, and the scrambled message itself.",

      // ⭐ HANNU'S REPLACEMENT, AND IT IS STRONGER THAN MINE. I had written *"that is
      // not a promise about how carefully it is run"* — D-112's construction again,
      // a negative about ourselves. His version names the threat the reader is
      // actually imagining and answers it with the same fact.
      "Nothing that could unscramble it ever reaches the server. If somebody stole the server, " +
        "there is simply nothing there to read the message with.",

      // ⚠️⚠️ "${days(MAILBOX_LIFE_S)} DAYS LATER" WAS THE WRONG REFERENCE POINT, AND
      // IT READ AS A PROMISE ABOUT THE MESSAGE. §5.1.1's clock runs from the MAILBOX's
      // creation, not the message's, so a message sent late in a mailbox's life gets
      // nearer §5.4's floor than its ceiling — a reader who came back on the eighth day
      // expecting the number they were shown would find it gone. The floor is the number
      // that is true of every message, so it is the one this sentence leads with.
      `A message is deleted the moment your friend's device has collected it and said so. Anything ` +
        `never collected is held for at least ${days(EPOCH_SECONDS)} days, and goes when the ` +
        `mailbox is recycled — ${days(MAILBOX_LIFE_S)} days after that mailbox was made.`,

      "Your conversation list is kept on the server too, so your other devices can find it. It is " +
        "encrypted under your KEY and filed under a number — no phone, no name, no email address — " +
        "and the server cannot read that either.",
    ],
  },

  mailbox: {
    label: "mailbox",
    title: "The mailbox",
    body: [
      "A generated id number: it is not worked out from your name, your phone number, your email " +
        "address, or anything else of yours. It is a place to put a message, and it means nothing " +
        "on its own.",

      `Each conversation moves to a new mailbox every ${days(EPOCH_SECONDS)} days, so one ` +
        "number does not follow a conversation around for its whole life.",
    ],
  },

  metadata: {
    label: "metadata",
    title: "What metadata means here",
    body: [
      "Metadata means that something was said — not what was said. In this case: that some mailbox " +
        "(an id number) received an encrypted message of a certain size, at a certain time.",

      // ⚠️⚠️ D-112, AND HANNU'S EDIT MADE IT BETTER AGAIN. My version explained why the
      // limit exists; his adds what stands BEHIND it, which is the half a worried
      // reader is actually after. ⚠️ His draft ended *"scrambled with a key that only
      // the user holds"* — which is not true and is the collision D-109 exists for:
      // messages are opened by §6's ratchet keys on the two devices, not by the KEY.
      // Corrected to say what is true, which is also what reassures.
      "A server has to know where to put a message and when it arrived, or it cannot deliver it. " +
        "But the delivery address is a generated number that keeps changing, and the message " +
        "itself is scrambled with something only your device and your friend's ever hold.",

      "What is not in it: no readable text, no name, no email address, no phone number. Somebody " +
        "reading everything the server holds learns that a numbered mailbox was busy on Tuesday.",

      // ⭐ ROUND 7, ITEM 2 — AND THE ANSWER WAS NOWHERE ON THE PAGE. He asked how long
      // the metadata is kept and when it goes. Every number was in PROTOCOL.md §5.1.1 and
      // §5.4, `terms.server` says the message half of it, and this panel — the one a
      // worried reader opens — said what metadata IS and never how long it lasts.
      // ➡️ Round 4's shape again (D-083): the reader's next question is not answered by
      // the section that raised it.
      //
      // ⚠️ THE CLAIM IS DELIBERATELY ABOUT THE DATABASE AND NOT ABOUT THE WHOLE MACHINE.
      // A sentence like "nothing keeps a history of what arrived when" would be a claim
      // about the operational logs too, and on 2026-08-17 that claim was false: the web
      // server in front of this one was recording a client IP address beside a mailbox id
      // every time a stream broke. Do not widen this paragraph until that is fixed and
      // measured. See ARCHITECTURE.md §3.2.
      `How long: the record of a message is deleted together with the message — the moment your ` +
        `friend's device collects it, or ${days(MAILBOX_LIFE_S)} days after the mailbox was ` +
        `made, whichever comes first. The mailbox number goes at the same time.`,
    ],
  },

  "six-digits": {
    label: "six digits",
    title: "Why six digits",
    body: [
      // §3.6.2 and D-081: the digits match at both ends of EVERY completed handshake,
      // including one with an attacker, so "they must match" teaches the wrong test.
      // ⚠️ Hannu's edit drops my *"so this is not a check that two screens agree"* —
      // a negative clause explaining what the thing is NOT before saying what it is,
      // which is D-112's shape one more time. "Always" carries the same warning.
      "Both ends of any finished conversation always show the same six digits. This is a check " +
        "that the person holding the other screen is the friend you meant to reach.",

      // ⚠️ Opened from §3.6.2's screen, so the same rule binds it: the kind may be
      // unknown here, and the joiner sent nothing. "the invitation travelled" is
      // true of both roles and of both of §2's secrets. See `pairing.sasWhat`.
      "Ask your friend by some other route: by voice, in person, or anywhere you are sure of. " +
        "Not through the same place the invitation travelled.",

      // ⚠️⚠️ ROUND 7, ITEM 6 — A SENTENCE REMOVED HERE, AND IT MUST NOT COME BACK.
      // It read *"The digits are the check that cannot be talked around."* True about the
      // cryptography and wrong about the reader: it makes the DIGITS the thing to be
      // satisfied about, when the thing to be satisfied about is the PERSON holding them.
      // ➡️ This is D-081 arriving a third time, now in praise rather than instruction —
      // *"they must match"* taught the wrong test, and so does *"this is the check"*.
      // The paragraph ends on the weakness of the alternative and stops; the instruction
      // was already given in the two paragraphs above, which is exactly Hannu's reason.
      "Asking questions here that only your friend could answer is worth something, and it is " +
        "weaker than it feels — somebody who knows your friend can answer those too.",
    ],
  },
};

// ----------------------------------------------------- what the server holds

/**
 * §5.1.1, §5.4.1, §7.3, §7.6 — the four sentences Hannu asked for four times.
 *
 * ⚠️⚠️ THE GHOST GATE DESCRIBED THE BROWSER IN FORENSIC DETAIL AND THE SERVER NOT
 * AT ALL, and that was the shape of feedback items 3, 4, 5 and 7. Four paragraphs
 * about disk, tabs and erasure; nothing about the question a person actually asks
 * — *what reaches the server, can it read it, when does it go.* Every sentence
 * needed to answer that already existed in PROTOCOL.md and none of it had ever
 * been said to a user.
 *
 * ⚠️ `metadata` is not an afterthought and must not be dropped as one. Three
 * cheerful sentences followed by nothing would be the product overclaiming by
 * omission, which is the failure mode `feedback_legal_text_drift` keeps finding.
 */
export const server = {
  // ⭐ Round 4: "a mailbox (a generated id number)". A "mailbox number" is a thing a
  // person can imagine being derived from something of theirs; naming it as
  // generated is what makes the sentence reassuring rather than merely accurate.
  //
  // ⚠️ "one public value", NOT "one public key" (D-109). The thing is a public key
  // and that is the accurate word, but this sentence sits four lines from one that
  // says the server never gets your KEY, and a reader who meets both can only
  // conclude that it holds theirs. The precise word is available to whoever opens
  // `terms.server`, which is the reader it is precise FOR.
  // ⭐ D-150 COUNTED THE THREE THINGS. Hannu read this sentence and still had to ask what the
  // server holds — three items in a row of commas and dashes read as prose, and prose is
  // skimmed. Naming the count first is what stops the skim; the three items are unchanged.
  //
  // ⚠️ HE ASKED FOR "1) … 2) … 3) …" AND THE COPY GATE REFUSED IT. `test/copy.mjs` forbids a
  // digit no constant put there, and it does not know a list marker from a quantity — which
  // is the right way round for a check whose job is to catch a typed "24 hours". Semicolons
  // separate the three as cleanly and "three things" does the work the numbers were for.
  cannotRead:
    "Messages go to the server encrypted. It holds 3 things: a [mailbox](mailbox), which is " +
    "a generated id number; one public value; and the scrambled message. Nothing that could open " +
    "it ever reaches the server, so it cannot read your conversation.",

  // §5.4.1: deletion on acknowledged retrieval. §5.1.1: the unconditional expiry.
  // ⭐ Round 4: "the receiver's device", not "the other person's device" — this
  // sentence is read by both ends and only one of them is "the other person".
  // ⚠️ "and said so" moved to `terms.server`: it is §5.4.1's acknowledgement and it
  // is the kind of clause the tester round said to spend somewhere else.
  // ⚠️ See `terms.server.body[2]`: the same correction, and the same reason. §5.4's
  // promise is a FLOOR — "at least 7 days" — and the ceiling belongs to the mailbox.
  whenItGoes:
    "A message is deleted from the server the moment the receiver's device has collected it. " +
    `Anything never collected is held for at least ${days(EPOCH_SECONDS)} days, and goes when the ` +
    `mailbox is recycled — ${days(MAILBOX_LIFE_S)} days after that mailbox was made.`,

  // §7.3: the roster is stored server-side, permanently, as ciphertext under a
  // number. It is the one thing this product does keep centrally and the copy
  // says so rather than letting "nothing is stored" be inferred.
  list:
    "Your list of conversations is kept on the server too, encrypted under your KEY and filed " +
    "under a number. No phone, no name, no email address — and the server cannot read that either.",

  /**
   * ⚠️ §7.3.3 and §11. It is not zero, and pretending otherwise is the claim this
   * product cannot afford to make.
   *
   * ⚠️⚠️ AND IT IS THE SENTENCE THE TESTER ROUND CAUGHT (D-112). It used to end
   * *"That is metadata. This design cannot hide it."* — which discharged the
   * obligation and failed the reader: *"my friends asked whether an AI wrote that,
   * and they start to wonder what the design should be hiding."* An abstract subject
   * announcing a negative reads as a confession, so a sentence written to prevent an
   * overclaim manufactured a suspicion instead.
   *
   * ➡️ Every fact in it survives; the construction does not. The limit is now
   * EXPLAINED and universal — any server, here or anywhere — which is both truer and
   * the thing that stops a reader wondering what is special about ours.
   */
  metadata:
    "The server can see that some mailbox — a generated id number — received an encrypted message " +
    "of some size, at some time. That is [metadata](metadata): no readable text, no name, no email " +
    "address. Any server that delivers a message has to know that much.",

  // §7.6, one line further than `ghost.what` goes.
  ghostAdds:
    "In this mode nothing is written to that list at all, so the server holds nothing tying this " +
    "conversation to any identity of yours.",
};

// ------------------------------------------------------------------ the phrase

export const phrase = {
  // ⚠️⚠️ `intro` WAS HERE AND IS GONE (round 5 item 1). It read *"Your conversations
  // are locked with a passphrase of eight words. It is generated here, on this
  // device, and it is the only way back to them"* — and it sat directly beneath
  // `product.what`, whose second paragraph states the same three facts in the same
  // order. The last thing a first-time reader met before choosing was the paragraph
  // they had just finished, restated in shorter words.
  //
  // ➡️ **IT WAS NOT WRITTEN AS A DUPLICATE; IT BECAME ONE.** It predates
  // `product.what`, which round 4 rewrote into the four opening paragraphs (D-083).
  // **Adding a better explanation above an older one does not retire the older
  // one**, and nothing in a build can notice that two strings say the same thing —
  // only somebody reading the screen top to bottom for the first time can, which is
  // exactly who was reading it.

  // §7.4: "the product asks everyone to write the phrase down and keep it
  // somewhere safe". Memorability is explicitly not a design goal (D-020) — 42%
  // correct recall among testers who memorised, against 88% among those who wrote
  // it down — and unlike a disk passphrase this secret has no redundant copy.
  writeItDown: "Write it down and keep it somewhere safe. A password manager is ideal.",

  // ⭐ ROUND 7, ITEM 3 — Hannu's wording, plus three words I would like him to rule on.
  // He asked for *"choose the one easiest for you"*; mine was "the one you can copy out
  // most accurately", which is stilted. ⚠️ But "easiest for you" leaves the criterion
  // open, and the one a person reaches for unprompted is easiest to REMEMBER — which is
  // the measured failure this step exists to prevent (D-020: 42% recall among testers
  // who memorised, 88% among those who wrote it down). "to write down" names the act
  // the next screen tests, in his register rather than mine.
  //
  // ⭐ D-149 CUT THE FIRST HALF. *"Pick one. They are all equally good — "* was the
  // reassurance that no candidate is weaker than another, and two readers found it
  // obvious from the screen: six equal boxes, one instruction. ⚠️ It also made the
  // sentence say the same verb twice, "pick" then "choose". What is left is the only
  // part that carries a CRITERION, which is the part D-020 exists for.
  choose: "Choose the one that is easiest for you to write down.",

  use: "Use this one",
  more: `Show ${CANDIDATES_PER_SET} more`,

  // §7.4: the escape hatch from the cap is a STRONGER phrase, not a weaker one,
  // and it is offered in the register §7.6 uses for Ghost mode — present it, do
  // not explain it. No dialogue, no entropy explanation, no default change.
  longer: "I want a longer KEY",

  setsLeft: (left) =>
    left > 0 ? `${left} more ${left === 1 ? "set" : "sets"} available` : "no more sets — pick one of these",

  // The cap is arithmetic (§7.2's floor), and saying so plainly is better than a
  // silent disabled button. It does not explain entropy.
  //
  // ⭐⭐ D-150 — HANNU'S SHORTENING FIXED A SECOND DEFECT HE WAS NOT AIMING AT. The
  // sentence opened on `spell(MAX_CANDIDATE_SETS)`, so it reached the screen as
  // *"ten sets of six is as many as this offers"* — a standalone sentence starting
  // with a lowercase word. Moving the number out of first position closes it, and
  // the numbers are still the constants. ➡️ Four more strings opened lowercase for the
  // same reason; D-152 capitalised them the next day and D-153 turned their numbers into
  // digits, so there is no lowercase word left at the front of any of them.
  //
  // ⚠️ "they are all good" REPLACES "they are not worse than the ones before them",
  // and the two are the same claim — the second says it by denying its opposite,
  // which is D-112's shape.
  capReached:
    `Pick one of these ${MAX_CANDIDATE_SETS} sets of ${CANDIDATES_PER_SET} — ` +
    "they are all good.",

  /**
   * ⚠️⚠️ THE RETYPE STEP IS NOW A SEPARATE SCREEN, AND THE REASON IS D-084 — A
   * SECURITY DEFECT THE FIRST USER FOUND FROM A BUTTON LABEL.
   *
   * The phrase used to be rendered on the same panel as the field, directly above
   * the sentence below. **While it is on screen the retype is evidence of
   * nothing**: it can be read off a word at a time, or selected and copied, and
   * `.phrase { user-select: all }` made selecting the whole thing one click. §7.4's
   * entire purpose for this step is to establish that the phrase exists somewhere
   * other than this tab, and the layout defeated the mechanism while every line of
   * code implementing it was correct.
   *
   * ➡️ **A test of knowledge must not be conducted with the answer visible**, and
   * nothing that reads source can see that it was — which is why this note is
   * here, beside the sentence that was making the claim.
   */
  written: "I have written it down",

  // ⭐ THE TESTER ROUND SHORTENED THIS TO ONE LINE (D-110). Hannu's own wording,
  // with the paragraph that used to sit under it moved to `terms.retype` — this is
  // a screen with one job and a field waiting for an answer, which is the last place
  // a person wants three sentences of justification.
  confirm: "Now type it back here, to make sure you have it [somewhere safe](retype).",

  placeholder: "Type the KEY",

  showPhraseAgain: "Show the KEY again",
  showChoicesAgain: "Show the choices again",
  thisIsIt: "This is my KEY",

  wrong: "That is not the same KEY. Check what you wrote down and try again.",

  // §7.4, and it must not scold: pasting is NOT a security risk and must not be
  // presented as one. The dialogue asks the user to confirm something the software
  // cannot check — that a copy exists outside this tab.
  pasted: {
    title: "You pasted the KEY.",
    body:
      "So please make very sure it is properly saved wherever you pasted it from. " +
      "If you lose this KEY, nobody — not even us — can open your conversations again.",
    ok: "OK",
  },

  longPhraseNote: `${PHRASE_WORDS_LONG} words. The same in every other way.`,
};

// --------------------------------------------------- the gate, and getting about

/**
 * ⚠️⚠️ THIS SECTION EXISTS BECAUSE EIGHTEEN SENTENCES WENT AROUND THIS FILE, AND
 * THE FIRST USER TRIPPED OVER EXACTLY THOSE. This module's first line says *"every
 * sentence the product says to a person, in one place"*, and it stopped being true
 * at build step 8 — the step that BUILT the interface, which is the step most
 * likely to write prose. Sixteen observations arrived, and they sorted perfectly by
 * that line: **every complaint that text reads badly, is not understandable, or is
 * the wrong word points at a string that escaped this file.** The ones inside it
 * drew a different complaint — *true, but it does not tell me enough* — which is a
 * milder defect and a different fix.
 *
 * ➡️ **A central copy file is not a filing convention, it is a review gate.** Its
 * value is measurable in exactly this way, and nothing failed when eighteen
 * sentences walked past it.
 */
export const nav = {
  // The gate's two real choices.
  //
  // ⚠️ "Set up" ALONE SAID NOTHING ABOUT WHAT WAS BEING SET UP (feedback 14). It sat
  // beside "I already have a phrase", so the pair only made sense read together and
  // in order — which is not how anybody reads a screen.
  setUp: "Set up a new KEY",
  haveOne: "I already have a KEY",

  /**
   * §3, arriving with somebody's link (feedback 3).
   *
   * ⚠️⚠️ THE THREE CONTROLS ARE THE SAME THREE, AND THE LABELS ARE NOT. A person who
   * followed a link is not deciding "do I want an identity" — they are deciding how
   * to open the conversation in front of them, and the labels above answer a
   * question they were not asking. Hannu wrote all three out himself and the third
   * one is the finding: **Ghost mode was not visible as a way to open a link at
   * all**, because its label described a way to start one.
   */
  arrived: {
    setUp: "Open it, and set up a new KEY to keep it under",
    haveOne: "Open it, and keep it under the KEY I have",
    ghost: "Open it in Ghost mode — nothing is kept",
  },

  // ⚠️⚠️ `noReset` IS GONE, AND IT IS NOT A DROPPED FACT (D-110). It read *"There is
  // no account, no email address and no way to reset the passphrase"* and it earned
  // its place on the gate for a good reason — §7.2's consequence is the one thing
  // about this product that surprises people afterwards, so it belongs where the
  // choice is made and not in a help page.
  //
  // ⭐ It is deleted because `product.what` now carries it: *"We do not have it, and
  // we cannot help you if you lose it."* That is the same fact in the same place, in
  // words a person feels rather than parses — and Hannu spotted the duplication
  // himself while rewriting the page around it (*"leave this sentence away, the info
  // was already there"*), which is D-107's class caught by a reader for the second
  // round running. **A fact absorbed into a better sentence has not been dropped;
  // a fact absorbed into nothing has.** The gate's checks were pointed at the
  // surviving paragraph rather than deleted with the string.

  open: "Open",
  cancel: "Cancel",

  // ⚠️ FOUR BUTTONS SAID "Back" AND WENT TO THREE DIFFERENT PLACES. A label that
  // names the destination is checkable by the person reading it; "Back" is only
  // checkable by pressing it.
  toStart: "Back to the start",
  toConversations: "Conversations",

  // The chat's own controls (feedback 14: a conversation has no name until one is
  // given, so "Rename" describes something that has not happened).
  giveName: "Give name",
  rename: "Change the name",
  // ⚠️ It is the label of a browser `prompt()`, above an empty box. D-150 made it the
  // instruction it always was — a question there reads as a question about the box.
  namePrompt: "Name this conversation!",

  // ⚠️ "Delete" ON ITS OWN NAMED NO OBJECT (feedback 9), on a screen that also
  // carried an ending. It deletes this conversation, on every device — which the
  // confirmation says, and which the label now at least points at.
  delete: "Delete this conversation",

  // ⚠️ "Check for changes" NAMED NEITHER THE SOURCE NOR THE OBJECT, and round 3's
  // feedback called it "a mystery". It is §7.3.3 case 5: ask the server for the
  // conversation list again, so that anything done on ANOTHER DEVICE OF YOURS —
  // added, renamed, deleted, or wiped by §7.3.1a — arrives here. It is not about
  // the other person: what they do arrives through §6.7.1's notice, inside the
  // conversation. Hannu's own suggestion, "check for removed mailboxes", is the
  // half of it that matters most and is still too narrow — and "mailbox" is a word
  // this product never says to anybody.
  checkForChanges: "Check my other devices for changes",

  /**
   * ⭐⭐ D-151 — THE CONTROL HAD NO SUCCESS STATE, AND HANNU FOUND IT BY NOT FINDING ONE.
   * *"I have forgotten what is the purpose of this: nav.checkForChanges. I have never
   * noticed anything happening from pressing that?"* Pressing it fetched the roster, merged
   * it, and redrew a list that in the ordinary case is identical — so **the only reply the
   * control has ever had is its refusal** (`roster.failure.access_rule`, on a second press
   * inside the hour). A control whose one visible answer is an error teaches the person
   * holding it that it is broken, and eighteen months of copy work never looked at it
   * because there was no string to look at. ➡️ **A missing sentence has no home to be
   * reviewed in.**
   *
   * ⚠️ TWO ANSWERS, BECAUSE THERE ARE TWO OUTCOMES AND THE SILENT ONE IS THE COMMON ONE.
   * The first answers the button in the button's own words; the second is for the case
   * where the list on the screen has just changed underneath the person's eyes.
   *
   * ⚠️ These and `roster.failure.access_rule` are three replies from one control and they
   * share one slot on the screen (`#check-note`). That also stops a check that FAILS from
   * writing over §7.3.2's weak-freshness notice in `#home-note` — a rollback warning, on
   * the same screen as the button, replaced by whatever the network did.
   *
   * ⚠️⚠️ THE REFUSAL CANNOT PRODUCE THAT COLLISION, AND THE FIRST DRAFT OF THIS NOTE SAID
   * IT COULD. §7.3.3's once-an-hour is enforced CLIENT-SIDE, per device (`lastUserCheck` in
   * `flow/roster.js`), so a browser new enough to be showing that notice has never checked
   * and cannot be refused. The probe written to demonstrate the collision proved the
   * opposite and had to be rewritten to abort the request instead. ➡️ **A mechanism I had
   * not read is a mechanism I was describing from its name.**
   */
  checked: "No changes on your other devices.",
  checkedChanged: "Your conversation list has been updated.",
};

// ------------------------------------------------ D-139 — the app bar and its menu

/**
 * The app bar's controls, and the appearance menu behind the third one.
 *
 * ⚠️⚠️ EVERY STRING HERE IS AN `aria-label` OR A MENU ITEM, AND THE FIRST THREE ARE
 * THE ONLY NAMES THOSE BUTTONS HAVE. The bar's controls are glyphs — an arrow, three
 * dots, a plus, a paper plane — because that is what a phone app's bar holds and
 * because `test/copy.mjs` filters text nodes on `/[A-Za-z]/`, so a glyph is not a
 * sentence it can gate. A glyph with no accessible name is a control that a screen
 * reader announces as "button", which is the same as not labelling it at all.
 *
 * ⚠️ `back` NAMES ITS DESTINATION, for the reason four other labels in `nav` do: a
 * label that names where it goes is checkable by the person reading it, and "Back"
 * is only checkable by pressing it. It is deliberately the same words as
 * `nav.toConversations`, because it is the same journey.
 */
export const menu = {
  back: "Conversations",
  more: "More",

  /**
   * ⚠️ "Appearance", NOT "Theme". `terms` in this file already teaches a handful of
   * words a person must learn to use the product safely — the invite link, the
   * six digits, the mailbox. A setting that changes nothing but the colours must
   * not spend a person's attention on a fourth word, and "theme" is jargon dressed
   * as plain English: it is the name of the mechanism, not of what it does.
   */
  appearance: "Appearance",

  /**
   * WhatsApp's own three, in WhatsApp's own words, and the wording of the first is
   * the one that matters.
   *
   * ⚠️ "System default" RATHER THAN "Automatic". Hannu had used this product on a
   * phone for weeks without noticing it already went dark there — *"I had not paid
   * attention to that even though I tested a lot"* — so this menu's real job is to
   * make a person understand that a setting they never made was already in force.
   * "Automatic" says a decision is being made and does not say by whom. "System
   * default" names the thing that is deciding, which is what turns an invisible
   * behaviour into one somebody can predict.
   */
  system: "System default",
  light: "Light",
  dark: "Dark",

  /**
   * D-159's language control, in the same menu as the colours and for the same
   * reason: it is a preference about the interface rather than a step in anything.
   *
   * ⚠️ "Language", NOT "Interface language". The qualifier answers a question nobody
   * asks — nothing else in this product has a language a person could confuse it
   * with — and `appearance`'s note above is the rule it follows: a setting that
   * changes nothing but how the product reads must not spend a person's attention.
   */
  language: "Language",

  /**
   * ⚠️⚠️ THE TWO OPTIONS ARE THE ONLY STRINGS IN THIS FILE THAT ARE THE SAME IN BOTH
   * LANGUAGES, AND THAT IS THE DESIGN RATHER THAN AN UNFINISHED TRANSLATION.
   *
   * A person reaching for this control is, by definition, somebody who cannot read
   * the language currently on the screen — that is the whole reason they are looking
   * for it. Translating the options would write the one word they need in the one
   * language they cannot read: a Finn on an English page would hunt for "Suomi" and
   * find "Finnish", and an English speaker whose phone put the product into Finnish
   * would hunt for "English" and find "Englanti".
   *
   * ⭐ So each language is named IN ITSELF, which is what every language picker worth
   * using does. `test/copy-fi.mjs` exempts these two by path with this reason beside
   * them, so a third identical string still has to be argued for.
   */
  english: "English",
  finnish: "Suomi",
};

// -------------------------------------------- §2.1 — a link, pasted rather than opened

/**
 * ⭐⭐ FEEDBACK 7 AND 11, WHICH ARE THE SAME HOLE SEEN FROM TWO SIDES.
 *
 * A link is opened by navigating to it, and this client read `location.hash` **once,
 * at boot**. Pasting a link into the address bar of a tab already showing
 * `/c` is a same-document navigation — the browser fires `hashchange` and does not
 * reload — so the app never looked, and nothing happened. Opening a new tab worked,
 * which is exactly what made it look like a mystery rather than a bug.
 *
 * ⭐ The listener fixes that. This panel answers the other half: *"no place to click
 * to get to a neutral page where the user can paste an invite link"* — and it turns
 * out to be the better route for a second reason nobody asked for. **Typing a link
 * into the address bar puts the secret into the browser's own history and omnibox
 * suggestions**, where §2.1's `history.replaceState` cannot reach it. A field on the
 * page does not.
 *
 * ⚠️ IT MUST CHECK THE ORIGIN, and that check is not cosmetic. `parseLink` accepts
 * any string with a fragment, so a link belonging to a different deployment would be
 * turned into a `pairing_id` and claimed **against this server** — telling this
 * server about somebody else's pairing. Navigation cannot do that; a paste field
 * can, which is the price of having one.
 */
export const openLink = {
  // ⚠️ §2.2's code arrives through THIS field and not a second one. A person is
  // handed one thing by one friend and needs one place to put it; two fields would
  // make them classify it first, and the two are told apart by their shape at a
  // glance — `linkProblem` does exactly that and needs no help from the user.
  control: "Open an invite link or code somebody sent you",
  title: "Open an invite link or code",

  // ⚠️ D-150 split the second half off. One sentence carried two unrelated facts —
  // what pasting DOES and what pasting AVOIDS — joined by "and", which is the join a
  // reader stops reading at.
  what:
    "Paste the whole invite link, including the part after the # . It opens exactly as clicking it " +
    "would. Pasting it here keeps it out of this browser's address history.",

  // §2.2, on the same screen, as its own sentence rather than a clause on the one
  // above — the two arrive from different people through different channels.
  // ⭐ D-149 — AND THE NEW SENTENCE IS TRUE OF MORE THAN IT USED TO CLAIM, WHICH WAS
  // CHECKED BEFORE IT WAS WRITTEN. `normalise()` upper-cases and then keeps only what is
  // in `CODE_ALPHABET`, so spaces, dashes and every other stray character are dropped —
  // verified by running it on spaced, hyphenated, lower-cased and punctuated inputs, all
  // sixteen characters out. Saying "spaces" is not a promise the code did not already
  // keep; it is a promise it kept silently.
  orCode:
    `Or type the ${CODE_CHARS}-character code your friend read out to you. ` +
    "Dashes, spaces or capitals do not matter.",

  placeholder: "Invite link or code",
  open: "Open it",

  // ⚠️ The count is in the message because it is the whole diagnosis: a code that is
  // short is short by a specific number of characters, and "check it again" without
  // that is advice the person had already thought of.
  codeShort: (n) =>
    `That is ${n} of the ${CODE_CHARS} characters a code has. Ask your friend to read it ` +
    "out again — a character may have been missed, or heard as an I, an L or a 1, which no code " +
    "contains.",
  codeLong: (n) =>
    `That is ${n} characters and a code has ${CODE_CHARS}. Check that only the one code is ` +
    "in the box.",

  // §3 gives one document one pairing session at a time, so a link arriving while
  // another is being set up has nowhere to go, and saying so beats overwriting the
  // one already running.
  busy: "This tab is already setting up a conversation. Finish or cancel that one first.",

  // The three ways a pasted string is not a link this app can use.
  notALink: "That does not look like an invite link. Paste the whole thing, from https onwards.",
  wrongSite: "That invite link is for a different site, so it cannot be opened here.",
  noSecret:
    "That invite link is missing the part after the # , which is the secret in it. " +
    "Something along the way cut it off — ask for a new one.",
};

// ------------------------------------------------------------------- unlocking

export const unlock = {
  ask: "Type your KEY.",

  // §7.2 asks for 128 MiB and D-034 measured 1.17 s on a decade-old Android; §7.5
  // records that without PRF this runs on EVERY unlock. A screen that looks frozen
  // for a second is a screen people press again.
  // ⭐ D-149 CUT "on purpose". It was defending the wait against being read as a
  // fault, and `why` beside it already names Argon2id and the 128 MiB. A screen that
  // has to insist a delay is deliberate has raised the doubt it is answering.
  working: "Opening — this takes a moment.",

  // §7.2's parameters, said once, on the screen where the wait happens. The 128
  // is the constant this sentence is about and `test/copy.mjs` allows it by name.
  //
  // ⚠️⚠️ IT CARRIED BOTH OF THIS ROUND'S DEFECTS AT ONCE. It read *"The key is worked
  // out from your passphrase"* — D-109's collision, in the one sentence where the two
  // senses of the word stood next to each other — and it ended *"it is the design
  // rather than a slow moment"*, which is D-112's construction exactly: an abstract
  // subject announcing what something is NOT, on a screen where the person is
  // waiting and wants to know why. ⭐ The repair was the same fact told forwards —
  // say what the second BUYS, and "not a fault" follows without being claimed.
  //
  // ⭐⭐ D-148 CUT THAT REPAIR (round 24, and the first review this product has had
  // with TWO readers). The clause was *"and that second is what makes guessing your KEY
  // expensive for anybody who tries"* — true, and one clause more than the screen needs:
  // `working` above already says the wait is deliberate, and the mechanism is named in
  // this same sentence for anybody who wants it. ⚠️ What must never come back is
  // D-112's CONSTRUCTION. The missing payoff is a length decision and may be revisited;
  // an abstract subject announcing what something is NOT may not.
  why:
    "Your KEY is put through Argon2id at 128 MiB to open your conversations. On an old phone that " +
    "takes about a second, every time you sign in.",

  placeholder: "your KEY",

  // ⚠️ §7.2's 404 is the one that matters: a mistyped phrase and a genuinely new
  // identity are the same answer from the server, so this says "try again" and the
  // client never quietly creates anything.
  // ⚠️⚠️ D-150 — "identity" IS GONE FROM BOTH, AND THE FINNISH IS WHY. *henkilöllisyys*
  // is what a passport has: it names a known person. Hannu's reading of his own
  // translation was that a KEY *having an identity* invites the thought that somebody
  // could learn whose it is — on the one screen where a person has just failed to get
  // in and is most open to that thought. The English carried the same freight more
  // quietly. ⭐ Neither sentence needed the noun: what a person can act on is whether
  // the KEY is there.
  //
  // ⚠️ "cannot be found" AND NOT "does not exist", which was his first draft. The
  // client saw a 404 for one derived id; that justifies not finding it and does not
  // justify a claim about the whole world. §7.2's point stands either way — a mistyped
  // KEY and a genuinely new one are the same answer from the server, so this says
  // "try again" and the client never quietly creates anything.
  notFound:
    "That KEY cannot be found. Check what you wrote down and try again — " +
    "this does not create a new one.",

  // ⚠️ Reached only from a CREATE that found one already there (`flow/roster.js`), so
  // it is not an oracle a typist can query: the KEY is generated, never entered.
  exists: "That KEY already exists. Open it instead of setting up a new one.",

  // ⚠️ "the key derivation" WAS D-109's COLLISION IN ITS PUREST FORM: a sentence
  // about §7.2's Argon2id, using the product's word for the user's eight words to
  // mean something else entirely, on a screen the user reached by typing them.
  // ⚠️ D-150 dropped the figure. "128 MiB" was TYPED here — the one number in this
  // file that was not read from a constant, in the sentence a person meets when their
  // phone has just refused. `unlock.why` still states the cost, from `unlock.why`'s own
  // wording, for the reader who wants it. Hannu: "may not be technically 100% but the
  // average user would understand."
  memory: "This device does not have enough memory or power to open your KEY.",

  rateLimited: "Too many attempts from this network. Wait an hour and try again.",

  // ⚠️ THE LAST RESORT, AND IT WAS TYPED INTO `app/app.js` UNTIL THE COPY GATE
  // FOUND IT. It is shown when nothing else matched, which makes it the sentence
  // most likely to reach somebody on a device nobody here has ever seen.
  unknown: "Something went wrong, and this device could not say what.",

  // §7.3.2 rule 2. The blob authenticated and is OLD — the downgrade-to-re-pair
  // primitive, which presents as "the app forgot my chat" and sends the user to
  // re-pair over whatever channel they used the first time.
  stale:
    "The server offered an older conversation list than this device has already seen. " +
    "That should not happen. Nothing has been changed here; try again later, and do not re-pair " +
    "anything over a channel you are not sure of.",
};

/**
 * Every reason `flow/roster.js` can raise, as a sentence.
 *
 * ⚠️⚠️ D-088 AGAIN, ONE DAY LATER, IN THE MODULE I DID NOT LOOK AT. Yesterday the
 * §9.2 rate limiter printed *"429 rate_limited"* at a person because
 * `pairing.failure` was keyed by a reason the error did not carry, and the fix was
 * a table plus a test that reads the reasons out of `flow/pair.js`. **Closing the
 * class in one module is not closing the class.** `RosterFailure` raises nine
 * reasons; six had no sentence at all and fell through to `err.message`, which is
 * written for whoever reads the source.
 *
 * ⭐ AND ONE OF THE SIX IS REACHED BY PRESSING A BUTTON TWICE. §7.3.3 case 5 allows
 * one check an hour, so a second press threw `access_rule` and the home screen
 * printed **"§7.3.3 allows one check for changes per hour"** — a specification
 * citation, at a user, for doing the most ordinary thing there is with a control
 * whose label did not say what it did. The label and the sentence are one defect
 * seen twice: a mystery button is a button people press again.
 */
export const roster = {
  failure: {
    // §7.3.3 case 5's own interval. The sentence has to say why the answer is "not
    // yet" rather than "no", and that nothing is being missed by waiting.
    // ⚠️ D-150 — "once an hour is all this asks of the server" DEFENDED THE PRODUCT WHERE
    // THE READER WANTED THE RULE, and "Nothing is being missed:" announced a reassurance
    // the following clause then earned. Both went; what is left is the rule, the limit and
    // the thing that happens anyway.
    //
    // ⚠️⚠️ "once an hour" IS TYPED AND `USER_CHECK_INTERVAL_S` IS THE CONSTANT. There is no
    // reading of `span()` that produces a grammatical "once an hour", and inventing a
    // helper for one sentence is the clever-helper this file warns against — so the binding
    // is a CHECK instead of an interpolation, and `test/copy.mjs` fails if the constant
    // moves off 3600.
    access_rule:
      "You have already checked in the last hour. You can check once an hour. A change made on " +
      "another device also arrives on its own the next time you add, rename or delete a " +
      "conversation here.",

    not_found: unlock.notFound,
    identity_exists: unlock.exists,
    rate_limited: unlock.rateLimited,
    stale: unlock.stale,

    // ⚠️ THE ONE ENTRY THAT IS A FUNCTION, BECAUSE §5.2's SENTENCE CARRIES A
    // MEASUREMENT. It is in the table rather than beside it: a reason handled by a
    // special case in `app.js` is a reason the check below cannot see, and the
    // whole point of the table is that nothing is handled anywhere else. The
    // indirection is what keeps it out of `clockSkew`'s temporal dead zone — it is
    // declared at the foot of this file.
    //
    // ⭐⭐ AND SINCE D-157 THIS IS THE ONLY WAY TO REACH THAT SENTENCE. `clockSkew` used
    // to be exported as well, and `app.js` called it directly from the chat view while
    // the unlock and list screens came through here — **two paths to one sentence, which
    // is two homes for one sentence** (D-149), and D-152 fixed that shape in the review
    // instrument while leaving it standing in the module. The Finnish is what made it
    // load-bearing: an export the language override cannot see is an English sentence on
    // a Finnish page, and the only reason it had not already caused one is that nobody
    // had a second language to lose it in.
    clock_skew: (seconds) => clockSkew(seconds),

    // §7.3.1's compare-and-swap gave up. Two devices writing at once is the
    // ordinary cause and waiting is the whole remedy.
    conflict:
      "Another device of yours was changing the list at the same time. Nothing was changed here — " +
      "wait a moment and try again.",

    // §7.3's 64 KiB ceiling, and §7.3.1a forbids making room by dropping
    // tombstones — so the only honest advice is the one that works.
    // ⚠️⚠️ D-150 — "the record of what was deleted stays in IT" POINTED AT THE LIST, and the
    // list is the screen, and the screen shows nothing. Same repair as `deletion.trace` and
    // `panic.keeps`, and it matters most here: the reason this ceiling can be reached after
    // deleting is that the tombstones are still spending the bytes. Hannu's own version put
    // an empty conversation in that slot — true of a few hundred bytes, and not the thing
    // that cannot be got back.
    roster_full:
      "Your conversation list is full. Delete a conversation you no longer need to make room for a " +
      "new one — the list has a fixed size, and every deletion leaves its record behind your KEY.",

    // §9.3. Nothing the person did is wrong and nothing of theirs was lost.
    storage_full:
      "The server is full and is not taking anything new just now. Nothing was lost — try again later.",

    // ⚠️ THE ONE THAT IS NOT ORDINARY. §7.2: the identifier exists under a
    // different key, and §5.2's clock check has already been ruled out. It says
    // "nothing was changed" because that is the fact the person needs, and it does
    // not speculate about why, because this client cannot know.
    unauthorized:
      "The server would not accept this device's signature, and the clock does not explain it. " +
      "Nothing was changed.",

    server_state:
      "The server would not take this. Nothing was changed — try again in a moment.",
  },
};

// ------------------------------------------------------------------- the list

export const list = {
  title: "Conversations",

  empty: "No conversations yet.",

  // ⚠️ FEEDBACK 8: with exactly one conversation in the list, *"Start a
  // conversation"* reads as an instruction about the one that is already there.
  // The word that removes the ambiguity is "new", and it costs nothing.
  start: "Start a new conversation",

  /**
   * What a conversation is called before anybody names it (feedback 14).
   *
   * ⚠️ IT IS PRESENTATION AND NOT DATA. Channels used to be created as
   * `Paired 13/08/2026`, which made "Rename" the only honest label there could
   * ever be — and a placeholder written into the roster is indistinguishable from
   * a name somebody chose, travels to their other devices, and takes §7.3.1 rule
   * 4's merge with it. The date comes from `created`, which the roster carries
   * anyway.
   */
  unnamed: "No name yet",
  unnamedOn: (when) => `No name yet · started ${when}`,

  /** Which side of the pairing this device was. */
  roleI: "you started it",
  roleJ: "you joined",

  // §7.3.1 rule 2's conflict, which was an inline sentence in `app/app.js`.
  roleConflict: "2 devices disagreed about which side of a conversation this is.",

  // §7.3.2: a device unlocking with no local history has no high-water mark, which
  // is exactly where the rollback aims. It cannot be closed, so the client shows
  // what the blob asserts about ITSELF — and §7.3.2 requires this be recorded as
  // weak. The sentence is deliberately flat: it reports, it does not reassure.
  noHistory: (writtenAt, channels) =>
    `This device has not seen this list before. It says it was last saved on ${writtenAt}, ` +
    `with ${channels} ${channels === 1 ? "conversation" : "conversations"}.`,

  // §7.3.2 rule 3, in the same register as §3.5's tripwire. Not a refusal — the
  // blob is authentic; what is wrong is the server's account of it.
  versionMismatch:
    "The server's version of your conversation list does not match the list itself. " +
    "The list is genuine. Treat anything the server says about it with suspicion.",

  // §7.3.1 rule 4 (0.8.10): when two devices' clocks are equal nothing
  // discriminates, and a rename that disappeared silently is worse than one that
  // announced itself.
  nameUnresolved: (kept) =>
    `2 devices renamed a conversation at the same moment. This one is still called “${kept}”.`,

  // ⚠️ §7.3.1a: a channel gone with no tombstone cannot be produced by §7.3.1's
  // rules from an honest server.
  unexplained: (n) =>
    `${n} ${n === 1 ? "conversation is" : "conversations are"} missing from the list the server sent, ` +
    "and nothing in it explains why. Do not re-pair anything until you know more.",

  localOnly: "on this device only",
};

// -------------------------------------------------------------- §7.3.1a deletion

export const deletion = {
  // §7.3.1a: deleting one conversation is permanent, with no undo — ordinary use,
  // and the cost of a mistake is re-pairing one channel. Saying that plainly is
  // what makes the confirmation meaningful.
  confirmOne: (name) =>
    `Delete “${name}” everywhere?\n\n` +
    "This removes it from every device you have, and it cannot be undone. " +
    "The other person keeps their copy.",

  // ⚠️ §7.3.1a FORBIDS the obvious sentence here. The roster keeps deletions
  // forever and `root_hash` is a 128-bit commitment that outlives the thing it
  // records, so an adversary holding a candidate root seized from the other
  // party's device can confirm the channel once existed. "The product must not
  // tell a user that deleting a conversation removes every trace of it."
  // ⭐ D-149's SECOND PASS TOOK THE TWIN. `panic.keeps` lost the same sentence hours
  // earlier and this one was left standing because it is on a screen the contact sheet
  // never showed — two screens making one disclosure two different ways, which is the
  // drift this project spends most of its comments on. Hannu ruled on the sentence, not
  // on the screen. ⚠️ §7.3.1a is still satisfied by what REMAINS: it states what the list
  // keeps, which is the thing the section forbids denying.
  // ⚠️⚠️ D-150 — HANNU WENT LOOKING FOR IT ON THE SCREEN AND IT IS NOT THERE. *"I have not
  // noticed that a deleted conversation would remain in the list with some remark?"* He is
  // right: `openHome()` draws `roster.channels()`, and a tombstone is not a channel. The
  // record is real — a day plus a 128-bit `root_hash`, kept for good, merged to every device
  // — and it is drawn nowhere. So the sentence was true of the data and false of the word it
  // used for it, and "your list" is the word a reader spends on the screen in front of them.
  //
  // ⭐ THE REPAIR NAMES WHERE IT IS RATHER THAN DENYING WHERE IT IS NOT. "behind your KEY" is
  // already this product's phrase for the roster (`ending.thoroughConfirm`), it makes no
  // claim about any screen, and it needs no permanence clause — D-149 cut that twice.
  // §7.3.1a is satisfied: this states what is kept, which is the thing the section forbids
  // denying. **They are a trio now — `panic.keeps` and `roster.failure.roster_full` say the
  // same thing in the same words, and none may change alone.**
  //
  // ⚠️⚠️ D-151 — AND THAT REPAIR TRADED ONE FALSE IMPLICATION FOR ANOTHER. Round 26 moved the
  // record off the screen it is not on. Hannu read the result and found the next one: *"it
  // means that the user could later check with the KEY when any conversation was deleted. But
  // I do not think that is possible."* He is right — nothing ever reads a tombstone back out.
  // So "behind your KEY" said WHERE truthfully and said RETRIEVABLE BY YOU by accident, which
  // is the same defect one layer down. ➡️ **The second reading of a repaired sentence is a
  // different sentence**, and the reading that finds the next fault is the one taken by
  // somebody who has already accepted the repair.
  //
  // ⭐ THE WORDING IS HIS, WITH ONE PHRASE CHANGED. He wrote *"it is not shown to anybody"*;
  // this says "on any screen". "Not shown to anybody" is the reassuring reading and it is the
  // one §7.3.1a forbids — a roster that is compelled open shows every one of these to whoever
  // holds it, which is the entire reason the section requires the disclosure. What is true is
  // that nothing DRAWS it, and that is also the exact answer to the question he asked.
  trace:
    "The date of the deleted conversation is saved behind your KEY. " +
    "It is not shown on any screen.",

  /**
   * §7.3.1a's quarantine notice.
   *
   * ⭐⭐⭐ IT SAID *"1 conversations were deleted from another device"* UNTIL D-156, on what
   * is almost certainly its commonest reading. `renderQuarantine` in `app/app.js` passes
   * `pending.length`, and one conversation deleted from one other device is the ordinary
   * shape of this event — so the branch nobody had ever rendered was the branch nearly
   * everybody sees. ➡️ **A BRANCH NO SAMPLE ARGUMENT REACHES HAS NO HOME TO BE REVIEWED
   * IN.** The review sheet rendered this path once, at n = 3, and the Finnish translators
   * were shown that one form; six other sentences in this file were hidden the same way.
   * `test/samples.mjs` now renders every branch and refuses a literal no sample can reach.
   */
  suspect: (n) => `${n} ${n === 1 ? "conversation was" : "conversations were"} deleted from another device.`,

  // ⚠️⚠️ AND THIS IS THE SENTENCE THE EIGHTH HOLE MADE NECESSARY. §7.3.1a offers an
  // undo; §7.3.1 rule 1 drops every channel whose root hashes to a merged
  // tombstone; §7.3.1a forbids a tombstone from ever expiring. The entry can
  // therefore never go back into the roster, and an interface that said "restore"
  // without saying where would be promising the thing the rules forbid.
  undoIsLocal:
    "Keeping one puts it back on this device only. It will not return on your other devices, " +
    "and it will be gone if this browser's data is cleared.",

  quarantineWindow: `Kept for ${QUARANTINE_DAYS} days, then dropped.`,

  keep: "Keep on this device",
  agree: "Yes, delete",

  // §7.3.1a: a raised `purged_at` purges immediately and irreversibly, with no
  // quarantine, and shows a plain notice. This is the case the action exists for.
  purged: "Everything was deleted from another device. This device has been cleared.",
};

// -------------------------------------------------------------------- the chat

export const chat = {
  // §6.6, and every qualifier in it is required. Deletion is client-enforced and
  // best-effort (§6.6 says the copy must not claim otherwise), the timer starts at
  // FIRST RECEIPT rather than at `sent_at`, the two copies expire on their own
  // clocks — and `vault.js` records why "the next time you open this" is in the
  // sentence: `first_seen` is inside the ciphertext, so nothing expires while the
  // app is closed.
  ttl:
    `Messages disappear from this device ${hours(MESSAGE_TTL_S)} hours after you receive them, ` +
    "the next time you open this. Your copy and their copy go on their own clocks.",

  placeholder: "Message",
  send: "Send",

  /** Ghost mode has no list and no name, so the heading needs something to be. */
  thisOne: "This conversation",

  // §5.4.2's distinct local states, in words rather than codes.
  unsupported: "A message arrived from a newer version of this app than the one you are running.",
  undecryptable: "A message arrived that this device cannot read; it was sent before this device was restored.",
  // ⚠️⚠️ D-130. This read "on a conversation that has since been restarted", and the
  // person it was shown to had restarted nothing — he had opened the app in a
  // different browser, which is §6.3's device migration reached by an act nobody
  // would call one. A notice naming an event the reader did not cause sends them
  // looking for the event. This names what is true of the message itself, which is
  // the same sentence in every case the refusal covers.
  // ⭐⭐ HANNU'S REWRITE, 2026-08-18, and the choice between his two candidates has a REASON
  // rather than a preference. He offered "one or more messages have been lost" and this one;
  // **this line is drawn once PER MESSAGE** — he counted eight of them — so a plural sentence
  // would say "one or more" eight times over about eight single messages. Singular is what is
  // true of the line it is written on.
  //
  // ⚠️ "ASK YOUR FRIEND TO RESEND" IS ACTIONABLE, WHICH THE OLD SENTENCE WAS NOT. A resend is
  // encrypted to the session that exists NOW, so it arrives — but only once the conversation has
  // been re-established, which is why the banner above tells the person to send first. The two
  // strings are one instruction in two places and must not drift apart.
  staleSession:
    "A message is lost. It arrived before this conversation was re-established — please ask your " +
    "friend to resend.",
  // ⚠️⚠️ §6.7.2, ADDED 2026-08-24, AND IT IS THE ONE LINE IN THIS FILE THAT NAMES THE
  // SERVER AS THE ACTOR. Every other refusal above describes a state — a version, a
  // restore, a re-established conversation — and none of them accuses anybody. This
  // one can only be reached by an envelope being rewritten in transit, and nothing but
  // the server is in that position. Saying so is not alarmism: the whole product is
  // built on not trusting it, so the one time that distrust is VINDICATED is exactly
  // when the person should be told plainly. `list.versionMismatch` sets the register.
  //
  // ⭐ AND THE SECOND SENTENCE IS LOAD-BEARING. "Altered" without "stayed encrypted"
  // reads as "somebody read my message", which is the opposite of what happened — the
  // alteration is visible precisely BECAUSE the encryption held.
  tampered:
    "A message arrived whose delivery labels had been changed on the way. What was inside stayed " +
    "encrypted and no one else could read it — but this device does not act on a message the " +
    "server has altered. Please ask your friend to send it again.",
  unreadable: (reason) => `A message arrived that could not be read (${reason}).`,

  // ── D-130: this browser holds the conversation but has never held its keys ──
  //
  // ⚠️ THE ACTION LEADS. What the person needs is one sentence long and they can
  // act on it; the explanation is underneath for whoever wants it. An opening line
  // that described the problem first would be D-112's banner again — true, abstract,
  // and leaving the reader with nothing to do.
  // ⚠️ TWO HOUSE RULES BIT THE FIRST DRAFT OF THIS AND BOTH TESTS CAUGHT IT: D-109
  // keeps the lowercase word "key" off the surface, because KEY in capitals is the
  // person's own words and the collision is the whole reason that rule exists — so
  // this says what the thing DOES ("what opens their messages") rather than naming
  // it. And D-016b bans the singular "they", which a Finnish reader hears as a
  // group. Possessive "their" is house style and stays.
  // ⭐⭐ THE FIRST TWO SENTENCES ARE HANNU'S OWN, WORD FOR WORD (2026-08-18, after meeting this
  // banner in the field). Mine said "Send a message to reconnect this conversation" and then
  // explained the cost in terms of what "cannot be read here" — abstract, passive, and about the
  // device rather than about the person. His names the person and the order of events: **send
  // first, or you receive nothing.** ⚠️ The same defect as `feedback_legal_text_drift`'s worst
  // member: a sentence that is true and tested and still does not tell somebody what to do.
  reconnect: {
    what: "Please send a message to reconnect this conversation.",
    cost: "Before you send a new message you cannot receive messages from your friend.",

    // ⚠️⚠️ THIS ONE IS SENT, NOT SHOWN — the automatic first message (Hannu, 2026-08-18).
    // It is an ORDINARY message and needs no new payload kind, which is why his design is
    // cheaper than the §6.7 one I had queued: sending anything at all is what builds the
    // session, so the content only has to explain itself to the person who receives it.
    //
    // ⚠️ IT MUST READ AS SOMETHING A PERSON WOULD ACCEPT SEEING IN THEIR OWN SENT LOG,
    // because that is where it lands — on both screens, as a message from the sender.
    // "Reconnecting old conversation." says what happened and claims nothing else.
    sent: "Reconnecting old conversation.",
    // ⚠️⚠️ THE LAST SENTENCE IS GONE, ON THE THIRD ASKING (D-151). It read *"Your friend's
    // screen shows nothing about this, so the messages will look sent."* He dropped it in
    // round 25 and D-148's note kept it on the grounds that he had not complained about it.
    // He dropped it again in round 26; that one went back to him as a question, and he kept
    // it. He met it a third time in Finnish and asked for it out: *"I do not think they tell
    // anything the user really has to know. And even I feel those are difficult to fully
    // grasp how that can be."*
    //
    // ⭐⭐ THE ARGUMENT FOR KEEPING IT WAS THAT IT IS THE ONE FACT THE READER CANNOT DISCOVER
    // FOR THEMSELVES. That was true and it was not sufficient: **a fact nobody can hold is
    // not disclosed by being printed.** The person who could not follow it wrote the two
    // sentences above it and is the most careful reader this product has. Nothing in §5 or
    // §6 requires it, and `cost` above carries the only part of it anybody can act on.
    // ➡️ Twice was evidence. **Three askings is not evidence any more, it is the answer** —
    // and the round that changed its mind was the round that changed the instrument.
    //
    // ⚠️ "they" SURVIVES THE CUT and D-016b's allowlist entry still holds: *"the browser
    // where they first arrived"* is the old messages, read and ruled in round 26.
    why:
      "Your KEY brings your conversations back to every browser you type it in, but it does not " +
      "open the messages. Old messages open only in the browser where they first arrived.",
    /**
     * On the list, where somebody arriving in a new browser lands first.
     *
     * ⚠️⚠️ THIS BRANCH SPELLED ITS NUMBER UNTIL D-155, THREE DAYS AFTER D-153 RULED THAT A
     * QUANTITY IS A DIGIT — and it is worth saying why the sweep that changed 32 sentences
     * walked past this one. **D-153 searched for `spell(`**, the helper that had been doing
     * the spelling, and repaired every call site it found. This sentence never called it: the
     * plural branch below already interpolated `${n}`, and the singular one was a word
     * somebody had typed in D-130. ➡️ **A SWEEP FOR THE MECHANISM IS NOT A SWEEP FOR THE
     * RULE** — deleting the helper is what made the rule true everywhere the helper had been,
     * and nowhere else. It is D-153's own finding one turn further out: that round learned
     * that a check can pass on a property nobody chose, and this is a fix that landed on a
     * population nobody chose either.
     *
     * ⚠️ Both branches now read the digit off `n`, so neither can be typed wrong, and
     * `test/copy.mjs` refuses a number word in any sentence built from a count.
     */
    some: (n) =>
      n === 1
        ? `${n} conversation cannot receive until you send a message in it.`
        : `${n} conversations cannot receive until you send a message in each.`,
  },

  // ⚠️ "Polling" IS NOT AN ERROR and saying so would be a lie about the design:
  // §5.3's stream is a notification and §5.4.1's drain is the delivery.
  live: "live",
  connecting: "connecting…",
  polling: "checking",

  localOnly:
    "This conversation is on this device only. It is not in your list, so it will not appear on " +
    "your other devices and it will not survive this browser's data being cleared.",

  // ⚠️ §4.2: one browser holds one connection, in whichever tab won the election.
  // A tab without it is NOT waiting and NOT degraded — the tab that has it is
  // writing to the same storage this one reads. Saying "disconnected" would be
  // false, and saying nothing would leave a person watching a status that never
  // becomes "live" and concluding the app is broken.
  //
  // ⚠️⚠️ THAT PARAGRAPH WAS TRUE OF A LEADER THAT IS RUNNING, AND A PHONE FREEZES EVERY TAB
  // THAT IS NOT IN FRONT (D-126, 2026-08-17). A frozen document keeps its Web Lock, so this
  // line sat on a screen that was receiving nothing, saying that another tab had it in hand
  // — and the person's conclusion was the one the paragraph above was written to prevent,
  // arrived at correctly. **It is the comment, not the string, that was the defect**: it
  // states so confidently that a follower is fine that nobody went to check whether the
  // leader was alive.
  //
  // ⭐ The string stays, and ARCHITECTURE §4.2.1 is what makes it true: leadership now
  // follows the visible tab, so a tab showing this is either hidden — nobody is reading it —
  // or has been visible for the few milliseconds a lock takes to change hands.
  otherTab: "another tab",

  // ⚠️⚠️ ARCHITECTURE §4.2.3 — AND THE DIFFERENCE FROM THE LINE ABOVE IS THE WHOLE REASON
  // THESE EXIST. `otherTab` means another tab is doing the work and this one is fine.
  // These two mean another connection is holding the local storage and **nothing can be
  // written down here until it lets go** — measured 2026-08-18 as forty seconds in which
  // the message had already been fetched, this status read "live", and not one other pixel
  // on the screen differed from a conversation with nothing to deliver.
  //
  // ⚠️ TWO STRINGS BECAUSE THERE ARE TWO TRUE SENTENCES AND THE CLIENT CAN TELL THEM
  // APART. The census says whether another client of this identity is running: where it
  // does, naming the tab tells a person what to close; where it does not, claiming one
  // would be exactly the kind of invention this project keeps having to take back out.
  //
  // ⚠️ NEITHER IS PHRASED AS A FAULT. Chrome force-aborts the stuck transaction after
  // about a minute and everything resumes, so this is a delay with a cause, not a break.
  storeHeld: "waiting for another tab",
  storeBusy: "storage is busy",

  // ⚠️ 0.8.12: reached only after `flow/message.js` has run out of restarts, which
  // means another tab of this browser is writing to this conversation without
  // pause. Nothing was sent — so the sentence has to say that, and say what to do.
  busyElsewhere: "Not sent: another tab of this browser is using this conversation. Try again.",

  // ⚠️⚠️ EVERY OTHER SEND FAILURE, AND UNTIL 2026-08-24 THERE WAS NO SENTENCE FOR IT
  // AT ALL — `app.js` printed `not sent: ${err.message}` straight into the
  // conversation, so a person who went offline read `Failed to fetch` in a red
  // bubble, in English, in the middle of the Finnish interface. Feedback 13 had
  // already reported that exact shape on the PAIRING path and it was fixed there and
  // only there.
  //
  // ⚠️ IT DOES NOT SAY WHAT REACHED THE SERVER, and that restraint is the point.
  // §6.5 persists before it transmits, so a throw here can land on either side of the
  // network — "nothing was sent" would be a new false claim of exactly the kind this
  // sentence exists to replace. `busyElsewhere` above may say it because its one
  // cause is a write that provably never landed.
  notSent: "Could not send. Try again.",
};

// ----------------------------------------------------- §4.2, §7.8 — the other tabs

export const tabs = {
  // ⚠️ IndexedDB's `blocked`. One tab is holding an older version of the database
  // open and this one cannot start until it lets go. Nothing in the app can close
  // another tab, so this is the one case where the honest instruction is to a person.
  blocked:
    "Another tab of this app is open and is holding an older version of your local storage. " +
    "Close the other tabs and reload this one.",

  // IndexedDB's `versionchange`, from the other side: a newer version of the app is
  // trying to upgrade the storage and cannot while this tab holds it open.
  upgraded:
    "A newer version of this app was opened in another tab, and it needs this one to let go of " +
    "your local storage. Reload to carry on.",

  // §7.8 step 3, at the receiving end. ⚠️ The noun follows `ending.control`: in Kept
  // mode nothing was ended, this browser was emptied (feedback 5).
  endedElsewhere: "Another tab of this browser forgot the KEY, so this one has too.",

  // ⚠️⚠️ THE TWO ENDINGS, AND THE DIFFERENCE BETWEEN THEM IS NOT PRESENTATIONAL.
  // §7.8 permits "removes it from this browser now" — a claim about the BROWSER,
  // not about this document. It is true only when every other client has been
  // reached and confirmed gone, which needs the Web Locks census in `flow/tabs.js`.
  // Where that is unavailable, §4.2 still permits a second client this app cannot
  // enumerate, so the claim cannot be made and the wording must not make it.
  endConfirmed: "Done. Your conversations have been removed from every tab of this browser.",

  endUnconfirmed:
    "Ended in this tab. This browser could not confirm that every other tab of this app has done " +
    "the same — if any are open, close them.",

  // -------------------------------------------- ARCHITECTURE §4.2.2, one live client
  //
  // ⚠️⚠️ THE FIRST SENTENCE DOES NOT SAY "YOU OPENED A SECOND TAB", and that is a
  // decision the copy gate should keep. The person who reaches this screen most often
  // got here by pointing a camera at a QR code; they did not knowingly open a tab, the
  // browser did it on their behalf, and telling them what they did wrong would be false.
  //
  // ⚠️ AND IT NEVER SAYS ANYTHING IS WRONG. Nothing is: every conversation is present,
  // and one of these documents is delivering normally. D-119 applies directly — a limit
  // must be EXPLAINED, not ANNOUNCED — and this is not even a limit, it is an
  // arrangement.
  //
  // ⚠️⚠️ D-148 NAMED THE TAB, AND THAT IS NOT THE SENTENCE THE RULE ABOVE FORBIDS.
  // "You already have this open somewhere else in this browser" was vague on purpose and
  // was vague in the wrong direction: two readers could not tell WHERE to look, and the
  // control underneath had been saying "tab" since it was written. Naming the tab tells a
  // person where to go; telling them they opened it would be the false part, and this
  // still does not. ⭐ The dropped half — *"Nothing is missing, and nothing has been left
  // behind here"* — was reassurance against a worry the shorter sentence does not raise.
  dormantTitle: "This is already open",

  dormantBody: [
    "This is already open in another tab in this browser. All messages are arriving there.",
    "Only one place can run it at a time. If you can find the other tab, carry on there — " +
      "otherwise move it here.",
  ],

  // ⛔ THERE WAS A SECOND WORDING HERE FOR THE QR CASE AND IT IS GONE (D-128). It read
  // *"the invitation you just opened has been passed to it. Look there to carry on"* —
  // true of the design as written, and the design was wrong: two documents each held a
  // link that works once. An invitation now takes over the tab it arrived in, so this
  // screen is never the answer to a scan and must never acquire a sentence claiming it is.
  //
  // ⭐ The removal is the point. A wording for a case that can no longer occur is prose
  // waiting to be believed by whoever restores the branch it belonged to.

  // ⚠️ THE LABEL NAMES WHICH DOCUMENT IT ACTS ON. "Use this one" would be ambiguous on a
  // screen that has just told the reader there are two.
  //
  // ⚠️⚠️ AND D-148 NAMED WHAT MOVES, AND DEMOTED THE CONTROL TO A LINK. As a filled
  // button it was the loudest thing on a screen whose advice is *go and find the other
  // tab* — so it invited the press that skips the advice, which is the outcome the screen
  // exists to avoid. It is `.linkish` now: the same treatment as every other "or do this
  // instead" in the product. ⭐ "Move it" also left "it" to be guessed on a screen whose
  // subject changes twice; the noun is the conversation.
  useHere: "Move the conversation to this tab",

  // ⚠️ It reassures without naming a cause. The cause is that a phone stops a tab it is
  // not showing, and a stopped tab can hold storage the running one needs — true,
  // unfixable from here, and of no use whatever to the person reading it.
  dormantWhy: "Nothing is lost either way. Every tab of this browser reads the same stored copy.",
};

// -------------------------------------------------- §7.8 — the ending, as a control

/**
 * ⚠️⚠️⚠️ THE LABEL SAID *"End this conversation on this device"* AND IT DID NOT MEAN
 * A CONVERSATION — feedback 5 and 10, and it is the most serious of the fourteen.
 *
 * The control sits on the CONVERSATION LIST, where no conversation is selected. The
 * first user pressed it expecting to end one, and *"all conversations disappeared"*.
 * Nothing was lost — §7.8's ordinary ending clears this browser and the list comes
 * back with the phrase — but he could not have known that from the label, and the
 * confirmation he had to read to find out opened with the same wrong noun.
 *
 * ⭐ THE WORDING CAME STRAIGHT OUT OF §7.8, WHICH IS WHY NOTHING CAUGHT IT. The
 * section opens *"a client MUST offer a control that ends the current conversation
 * on this device"* — true in **Ghost mode**, where the session holds exactly one
 * conversation and ending it is ending them both. §7.8 was written from that mode's
 * shape and then applied to Kept mode, where "the session" is the whole identity.
 * This is feedback 16's shape again one layer up: **a rule written for one of two
 * cases and then obeyed in both.** PROTOCOL 0.9.1 says so in §7.8 itself.
 *
 * ➡️ So the control names what a person loses, which in Kept mode is the phrase's
 * hold on this browser — and never a conversation, because none is ended.
 */
export const ending = {
  control: "Forget my KEY on this browser",

  /** The one link on §7.8's landing page. It named the protocol until D-083. */
  openAgain: `Open ${product.name} again`,

  // ⚠️⚠️ §7.8 STATES THE PERMITTED WORDING AND FORBIDS ANYTHING STRONGER. Steps 0–5
  // make the session unreachable to the user and to any script; **unreachable is
  // not erased** — nothing in this design observed the browser freeing that memory,
  // and §7.7 forbids claiming zeroization. The second sentence is not a hedge added
  // for comfort: it is the difference between a true claim and a false one.
  // ⚠️ THE FIRST CLAUSE IS §7.8's PERMITTED WORDING AND THE SUBJECT IS THE ONE
  // THING THAT CHANGED. "Removes it from this browser now" still says exactly what
  // was measured; what it removes is this browser's copy of everything, not a
  // conversation. ⭐ The second paragraph is feedback 5's other half — he noticed
  // that nobody was told, and he was right to: nothing ended, so there is nothing
  // to tell anybody about.
  // ⚠️⚠️ THE THIRD PARAGRAPH IS D-133 AND IT IS THE `feedback_legal_text_drift` CLASS.
  // "They come back on this one when you type the KEY" is TRUE of the conversation list,
  // which §7.3 holds on the server — and FALSE of the messages, because `ENDING_CLEARS`
  // takes `MESSAGES`, and until 2026-08-18 it was false of being able to RECEIVE as well,
  // because that store also holds every Olm session. The receiving half is now true again
  // (a conversation reconnects itself when it is opened); the history never comes back and
  // nothing can make it, so the sentence has to say so. Found because Hannu forgot a KEY,
  // typed it back, and reported what he saw.
  confirm:
    "Forget your KEY here — removes your conversations from this browser now.\n\n" +
    "No conversation is ended and nobody is told anything. They stay open for the other people, they " +
    "stay on your other devices, and they come back on this one when you type the KEY.\n\n" +
    "Conversations come back, but without messages.\n\n" +
    "Your browser has written traces to this device. This does not reach them — to remove them, " +
    "clear this site's data in your browser settings.",

  // §7.8: the phrase is what comes back, and the control says so because step 2
  // clears the device unlock state too.
  needsPhrase: `You will need your ${PHRASE_WORDS} words to open them again.`,

  thoroughControl: "Forget my KEY, and clear this site's data",

  // ⚠️⚠️ §7.8 step 5 AND §7.3.2 rule 4. `Clear-Site-Data` takes the whole origin —
  // which includes §7.3.2's high-water mark, the one piece the ordinary ending
  // deliberately leaves. ⭐ **The most thorough ending manufactures the precondition
  // for the roster rollback**, and the control MUST say so. It also takes any OTHER
  // identity open in this browser, which the ordinary ending does not.
  //
  // ⚠️ D-150 SHORTENED IT AND KEPT THE MIDDLE FACT IN ONE CLAUSE. Hannu's version dropped
  // the high-water-mark sentence entirely. That is not a wording cut: it is the disclosure
  // this control exists to make, because the most thorough ending is the one that
  // manufactures §7.3.2's rollback precondition. Shortening a true sentence is safe;
  // deleting the only true sentence about a security downgrade is not.
  thoroughConfirm:
    "This clears everything this site has stored in this browser, not only this conversation.\n\n" +
    "It also resets the check that would notice an out-of-date conversation list. Your list itself " +
    "is safe under your KEY and comes back when you type it.",
};

// ------------------------------------------------------ §4.3 — the idle lock

export const lock = {
  // ⚠️ §4.3, and it must not be sold as more than it is: while the keys are in
  // memory a lock is a UI overlay that does not resist devtools or an XSS
  // foothold (§11). What it defends against is somebody picking up the device.
  idle: `Locked after ${minutesFromMs(IDLE_MS)} minutes without use. Type your KEY to carry on.`,

  // ⚠️ THE PLURAL IS COMPUTED, because D-082 moved this threshold from one minute
  // to five and the hardcoded "minute" would have survived the change silently —
  // the exact class `test/copy.mjs` exists for, one grammatical step down.
  blurred: `Locked because this was in the background for more than ${plural(minutesFromMs(BLUR_MS), "minute")}. Type your KEY to carry on.`,

  // ⚠️ It costs a full key derivation, and saying so beforehand is better than a
  // screen that looks frozen — §7.2 asks for 128 MiB of Argon2id on every unlock
  // while PRF is unavailable, measured at 1.17 s on a decade-old Android.
  // ⚠️ D-150 cut the explanation. It is not lost — `unlock.why` is where the Argon2id
  // cost is explained, and this line sits under a lock, not under a first sign-in. It
  // now matches `unlock.working`, which D-149 shortened to the same shape.
  cost: "Opening again takes a moment.",

  // ⚠️⚠️ §4.3 IN GHOST MODE IS NOT THE SAME PROPERTY UNDER THE SAME NAME (0.8.14,
  // D-073). §4.3 requires a lock after ten idle minutes and says unlocking "requires
  // the PRF touch, or the passphrase where PRF is unavailable" — and §7.6's first
  // sentence removes both. Obeying it literally would drop keys that cannot be
  // re-derived, which is not a lock but a silent ending, arriving on a timer, in the
  // one mode with nothing to recover from. So this mode gets a COVER instead, and
  // the wording must keep the two apart: a Kept lock costs an Argon2id to lift, and
  // a cover costs a click. Claiming the first while doing the second is exactly the
  // kind of sentence §7.6 says has to be exact.
  coveredIdle: `Covered after ${minutesFromMs(IDLE_MS)} minutes without use.`,

  coveredBlurred: `Covered because this was in the background for more than ${plural(minutesFromMs(BLUR_MS), "minute")}.`,

  // ⚠⚠ D-148 REMOVED THE LAST SENTENCE, AND THE REASON IS THE BEST KIND — IT IS ABOUT
  // WHO IS HOLDING THE DEVICE. It read *"If the device is not in your hands, end the
  // conversation."* Hannu: *"How can the user read that if the device is not in the
  // user's hands?"* The advice is addressed to somebody who by its own premise is not
  // looking at the screen, and the person who IS looking at it is whoever took the phone.
  // ⭐ The class is older than this instance: an instruction is read at a moment, and a
  // sentence whose condition excludes that moment reaches nobody.
  // ⭐ D-149 REPLACED THE TRAILING CLAUSE. *"so there is nothing to ask for"* described
  // the MECHANISM — no phrase exists, so no prompt can be shown — and left the reader to
  // work out the consequence. His version names the consequence and drops the mechanism:
  // what is missing is not a prompt, it is the protection.
  coveredWhat:
    "This only hides it. Anybody using this device can show it again — there is no KEY in this " +
    "mode to protect the conversation.",

  show: "Show the conversation",
};

// ------------------------------------------------------------ §7.6 Ghost mode

export const ghost = {
  /**
   * ⭐⭐ IT HAS A NAME NOW, AND THE NAME IS THE PRODUCT'S (feedback 6). The mode was
   * described everywhere and called nothing anywhere: the gate offered *"talk
   * without setting up a phrase"*, this screen was headed *"one conversation, in
   * this tab"*, and a person who used it had no word for what they had used. Hannu
   * asked for the word, and it is the one the product is already named after —
   * `haamu` is Finnish for ghost, so **Ghost mode is the one piece of branding here
   * that a user can work out for themselves.**
   */
  title: "Ghost mode",
  duplicatedTitle: "This tab is a copy",

  // §7.6's own register, which §7.4 cites for the longer-phrase link: present it,
  // do not explain it, do not default to it. ⚠️ D-016b inverted the documents'
  // assumption and the label has to carry that: Ghost is the expert's deliberate
  // act, not the beginner's starting point — "for a first-timer Ghost is not a
  // privacy feature at all, it is just the state in which they lose everything".
  /*
    ⚠️⚠️⚠️ THE FOUR SENTENCES BELOW ALL SAID "DIES WITH THE TAB", WHICH §7.6 NAMES AS
    ONE OF THE TWO CLAIMS IT FORBIDS — and the comment on `what` had been quoting that
    prohibition, correctly, for months, three lines away from three sentences making it.

    §7.6, exactly: *"Ghost mode's guarantee is 'nothing is written to the roster and
    nothing is recoverable on another device'. It is NOT 'nothing is written to disk',
    and it is NOT 'dies with the tab'."* Measured in the same section: Firefox persists
    `sessionStorage` for session restore, and it **survives a full browser restart**
    whenever restore applies — "continue where you left off", crash recovery, an
    OS-level app restore.

    ⚠️ AND THE HARM RUNS THE OTHER WAY FROM THE USUAL OVERCLAIM. Most false promises
    make a person feel safer than they are; this one makes them WALK AWAY. Somebody
    told the conversation is gone closes the laptop and leaves it — and the next person
    to open that browser gets the root, the messages and the ratchet. Found by the
    2026-08-24 outside review.

    ⭐ SO THE REPAIR IS NOT "SAY LESS". The loss is real and D-016 measured five testers
    out of five losing the tab, so the warning has to stay; what changes is that losing
    it is now the EXPECTATION rather than the guarantee, and the only guarantee offered
    is the one §7.6 actually gives. The measurement that makes "usually" the right word
    is §7.6's own: the restore is **not realised on Android or iOS**, so on a phone it
    really is gone and on a desktop it may not be.
  */
  offer: "Ghost mode — no KEY, and losing this tab usually loses the conversation",

  /**
   * ⚠️⚠️ ONE LINE UNDER THE LINK, AND §7.6's EXACTNESS RULE BINDS IT HARDEST HERE.
   * Hannu's own draft was *"everything disappears when you closed the browser"* —
   * which is the claim §7.6 explicitly forbids, and the copy has to do the thing
   * he was asking for without making it. What is true is that the conversation
   * becomes unreachable; what is not true is that anything is erased, and
   * `notErased` two screens later is where that gets its full sentence.
   */
  offerWhat:
    "A Ghost conversation is never added to your contacts and never reaches your other devices. " +
    "Closing the tab almost always loses it — but it is not erased, so end it deliberately.",

  // ⚠️⚠️ §7.6 STATES ITS GUARANTEE EXACTLY AND FORBIDS THE TWO SENTENCES EVERYBODY
  // WRITES INSTEAD. It is "nothing is written to the roster and nothing is
  // recoverable on another device". It is NOT "nothing is written to disk" — a
  // `sessionStorage` area is a file — and it is NOT "dies with the tab", which
  // earlier versions of the section claimed and which is false.
  // ⚠️ AND THE SECOND HALF WAS AN OVERCLAIM OF ITS OWN (review C#5). It said *"there is
  // nothing on the server tying it to you"*, which is a statement about the whole server
  // and not about the roster. §7.6 removes the LIST ENTRY; §5.1 leaves the mailbox, the
  // timing and the address exactly as they are in every other mode, and `server.what`
  // already says so at length. A mode that removes one link is not a mode that removes
  // them all, and the last sentence now points at the paragraph that has the rest.
  what:
    "This conversation stays in this browser tab. It is never added to a conversation list, so " +
    "the server holds no record of it beside your other conversations, and there is no way to " +
    "open it on another device. What the server can see of any conversation, it can still see " +
    "of this one.",

  // ⚠️ THE COST IS STATED BEFORE THE CHOICE, not after it. Phase 0.5 measured five
  // testers out of five losing the browser tab (D-016), and Ghost mode is that
  // failure with no recovery at all — §7.6's own note says the tab comes back
  // "looking exactly as though the conversation should still be there, and it is
  // gone", and that the client owes this user an explanation rather than a blank.
  cost:
    "If this tab closes, expect the conversation to be gone: there is no KEY, and no copy on " +
    "any other device. A browser that reopens your tabs can sometimes bring it back on this " +
    "device, so ending it deliberately is the only way to be sure.",

  // ⚠️ §7.6, and §7.8's "unreachable is not erased" one level down. The bytes reach
  // the disk like any others; process death removes them logically — a tombstone in
  // a log-structured store — and physical recovery stays possible for an unbounded
  // window. §7.7 forbids claiming anything stronger.
  // ⚠️ D-112, and this one is subtler than the other two. *"This is not erasure"* is
  // an abstract subject asserting a negative, and it opened the paragraph — so a
  // reader met the denial before they had been told what the thing IS. Reversed, the
  // same two facts arrive as an explanation and the limit falls out of them.
  // ⚠️⚠️ ROUND 7, ITEM 1 — AND IT IS THE D-112 FIX THAT FAILED. *"I do not know if I
  // understand this myself"*, about a sentence written three days earlier to repair a
  // register defect. The repair worked and cost something nothing measures: the
  // subject of that sentence was a nine-word headless clause (*"What a browser writes
  // while a tab is open"*), and a reader has to hold all nine before the verb arrives.
  // ➡️ D-112 moved the abstraction out of the STANCE and into the SYNTAX. See D-119.
  //
  // Hannu's rewrite, with one fact restored. His middle sentence was *"The webpage
  // cannot prevent that"* — true, and a different claim from the one this paragraph
  // rests on: not being able to STOP the write is why bytes exist, not being able to
  // REACH BACK for them is why the only remaining guarantee is "impossible to open".
  // Both are said now, in his register and his order.
  //
  // ⚠️ Singular "conversation": §7.6 gives this mode one root and one role, and
  // `linkElsewhere` below exists because a second one has nowhere to live.
  //
  // ⚠️⚠️ D-148 SHORTENED IT AGAIN, AND IT IS HIS ORIGINAL SENTENCE COMING BACK. The
  // "cannot reach back afterwards" clause was restored above because it is the fact that
  // makes "impossible to open" the only remaining guarantee. Two readers found the
  // paragraph long and the clause did not survive a second reading. ⭐ It is SUPPORT, not
  // a claim-limiter: nothing here claims erasure with it gone, so §7.6 is satisfied
  // either way and the loss is explanatory, not legal.
  //
  // ⚠️⚠️⚠️ THE LAST SENTENCE IS HIS AND THE NOUN IS NOT. He wrote *"Empty your
  // browser cache"*, and the cache is the one store this is not about: on Chrome
  // "Cached images and files" is a different checkbox from "Cookies and site data", and
  // clearing it leaves every byte this paragraph is about exactly where it was. An
  // instruction that names the wrong control is worse than no instruction on the one
  // screen whose subject is *you cannot make this go away*. So it names site data, which
  // is the control that removes what the browser wrote. ⚠️ It still does not promise the
  // bytes are gone — "not scrubbed off your device" above is what stops it.
  // ⚠️⚠️ "IT IS IMPOSSIBLE TO OPEN" WAS THE SAME FORBIDDEN CLAIM IN ITS STRONGEST FORM,
  // and it sat in the paragraph whose whole subject is *you cannot make this go away*.
  // The sentence that replaces it says the one thing a person can act on: a browser that
  // reopens tabs can reopen this, so end it on purpose.
  notErased:
    "When this tab is open, the browser writes on your device. That cannot be prevented. The " +
    "conversation is not scrubbed off your device when the tab goes, and a browser that reopens " +
    "your tabs can sometimes open it again here. If you want it gone: end it deliberately, then " +
    "clear this site's data in your browser settings.",

  start: "Create an invite link",

  // §7.6 puts everything this mode has in `sessionStorage`, so a browser that
  // refuses it cannot run the mode — and the honest thing is to say which of the two
  // choices on the gate still works, rather than to fail quietly on a dead link.
  noStore:
    "This browser will not let this page keep anything, even for one tab, so there is nowhere " +
    "for the conversation to live. Setting up a KEY works instead.",

  // §7.6 describes one root and one role. A second conversation would need a list
  // to hold it, and a list in `sessionStorage` is the roster machinery this mode
  // exists without — so a link arriving in a tab that already has a conversation is
  // told where it can go rather than silently ignored or silently obeyed.
  // ⚠️ D-150 states the rule instead of describing this tab's predicament. Hannu read the
  // old sentence and had to ask whether a second tab could hold a second conversation. It
  // can — `sessionStorage` is per tab, so the limit is one per TAB and never one per
  // browser, and the sentence now says which.
  linkElsewhere:
    "Only one Ghost conversation per browser tab. " +
    "Open the invite link in a new tab, or end this one first.",

  // The one control on the Ghost chat: with no list to delete from, deleting this
  // conversation and ending the session are the same act, so there is one button.
  //
  // ⚠️⚠️ D-149 PUT THE SECOND VERB IN THE LABEL, AND THE COMMENT ABOVE IS THE REASON IT
  // WAS OWED. "End" is what the ACT is called and "delete" is what it DOES, and only this
  // file knew they were the same thing — a reader could take "end" for closing or leaving.
  // ⭐ "delete" and not Hannu's "clear": `notErased` on this same mode's terms screen says
  // the conversation is NOT scrubbed off the device, and "clear" is the word that reads as
  // scrubbing. "Delete" is what the rest of the product calls removing a conversation, and
  // it is exactly as strong as §7.8 permits — no stronger.
  end: "End and delete this conversation",

  // ⚠️ §7.8's PERMITTED WORDING, IN THE MODE WITH NOTHING TO COME BACK TO. The Kept
  // control's second half — "you will need your eight words to open it again" — is
  // the reassurance that makes ending an easy decision there. Here there is nothing
  // to type, and leaving the sentence out rather than replacing it would let a
  // person carry the Kept-mode assumption into the one press that cannot be undone.
  // ⚠️ THE FIRST LINE ECHOES THE BUTTON AND MUST KEEP DOING SO (D-149). A confirmation
  // whose opening words differ from the control that opened it makes a person wonder
  // whether they pressed the thing they meant to.
  endConfirm:
    "End and delete this conversation — removes it from this browser now.\n\n" +
    "There is no KEY and no copy anywhere else, so nothing can reopen it. " +
    "The other person keeps their own copy of what you sent.",

  // ⚠️⚠️ THE ENDING PAGE'S SECOND SENTENCE, AND IT IS WHY THE FRAGMENT NOW CARRIES
  // THE MODE. `ending.needsPhrase` — "you will need your eight words to open it
  // again" — is the reassurance that makes ending easy in Kept mode, and until 0.8.14
  // the shared ending page printed it after a Ghost ending too. There are no words
  // and there is nothing to reopen, so it was the one sentence that could not be
  // true, on the one page §7.8 constrains most tightly.
  endedNothingToReopen: "There was no KEY for this one, so there is nothing to open it with.",

  // ⚠️⚠️ §7.6's DUPLICATED TAB, AND THE SECOND DOCUMENT IS THE ONE READING THIS.
  // "Duplicate tab" hands the new document a COPY of `sessionStorage`, and a copy is
  // not a conflict: both would hold the same Olm session, advance it independently,
  // and store to two areas that never meet. That is §5.4.3a's message-key reuse with
  // nothing shared to detect it — the conditional write that closes this in Kept mode
  // has no record in common to compare against and cannot see it at all.
  //
  // ⚠️⚠️ D-148 DELETED `duplicatedWhy` OUTRIGHT. It explained the MECHANISM —
  // *"Duplicating a tab copies what the conversation is stored in, and the two copies
  // cannot be kept in step"* — and the two readers' verdict was that it is *"too
  // complicated and not needed"*. ⭐ The screen has exactly one thing for a person to do
  // and the mechanism does not change it. The property the explanation carried (WHICH tab
  // works) is not lost: it moved into the sentence below, next to the control, which is
  // where D-120 says the answer to a worry belongs.
  duplicated:
    "This tab is a copy of another tab that has this conversation open. Only one tab can work " +
    "properly — please press “Remove this copy” and use the working tab.",

  // ⚠️ IT REMOVES THIS COPY ONLY, and the sentence has to say so — the person is
  // looking at a screen that just told them another tab is in charge, and a control
  // that ended both would take away the conversation they are still using.
  duplicatedEnd: "Remove this copy",
  duplicatedEndNote: "This clears the copy in this tab. The other tab is not affected.",

  // ⚠️ Where Web Locks is absent this whole check is impossible — §7.6 records it as
  // a residual rather than solving it, "because pretending otherwise would be worse
  // than the gap". Nothing is shown to the user in that case, and this is the note
  // that says why nothing is shown: there is no honest thing to show.
  noCensus:
    "This browser cannot tell whether another tab has the same conversation open. If you have " +
    "duplicated this tab, close the duplicate.",
};

// -------------------------------------------- §7.3.1a — the panic action

export const panic = {
  control: "Delete every conversation, everywhere",

  placeholder: "your KEY",

  // §7.3.1a: "The initiating device MUST require the passphrase to be retyped
  // before it writes." On a browser that has never been used it is typed once,
  // which is the same evidence; the field is the same either way.
  ask: "Type your KEY to confirm. This cannot be undone.",

  // ⚠️⚠️ THE SENTENCE THIS FEATURE LIVES OR DIES BY. A person reaching for this
  // has lost a device and is thinking of "erase my phone". It is not that: the
  // deletion travels **in the conversation list**, so it reaches a device when that
  // device next asks the server for the list. §7.3.3 permits that on five occasions
  // and deliberately NOT on launch, so a device that is only READ may never ask.
  // Promising a remote wipe here would be the most consequential false claim in
  // the product.
  reach:
    "This deletes your conversation list itself, so every device of yours that asks the server for " +
    "it afterwards will drop them. A device that is switched off, offline, or simply carrying on with " +
    "conversations it already had may never ask — and until it does, it still shows what it had.",

  // §7.3.1a forbids the obvious sentence. Tombstones never expire, and `root_hash`
  // is a commitment that outlives what it records.
  //
  // ⭐ D-149 CUT *"That part cannot be removed."* §7.3.1a's requirement is discharged by
  // the sentence that REMAINS — it states what the list keeps, which is the thing the
  // section forbids denying. The cut clause added permanence to a fact already stated in
  // the present tense. ✅ `deletion.trace` lost the identical sentence in the same round,
  // so the two disclosures still match. **They are a pair: neither may gain the sentence
  // back on its own.**
  // ⚠️⚠️ D-150 — see `deletion.trace`. Plural, same words, same reason.
  // ⚠️⚠️ D-151 — see `deletion.trace` again. Hannu asked the same question of this one and
  // asked it harder, because the panic screen deletes many: *"the user would want to check
  // the deleted dates but I have not noticed that they can be found anywhere?"* They cannot.
  // Plural, same words, same reason — a third round of that, and the pair has now moved
  // together three times.
  keeps:
    "The dates of the deleted conversations are saved behind your KEY. " +
    "They are not shown on any screen.",

  // ⚠️ And the other side keeps theirs — the same limit the single-conversation
  // deletion has, and the one people are most likely to assume away in a panic.
  // ⭐ THE FIRST CLAUSE CHANGED WHEN THE NOTICE WAS ADDED. They are now told; what
  // they keep is unchanged, and the two facts have to sit in one sentence, because
  // a person who read only the first would think the copies went with it.
  //
  // ⭐⭐ D-148 CUT THE CLAUSE AND KEPT THE FACT, WHICH IS THE ONLY REASON IT IS SAFE.
  // *"and they keep their own copies of them"* said the same thing as *"this does not
  // delete anything on their devices"* one sentence later, so the paragraph made its
  // point twice and the shorter one is the one a person in a panic will read. ⚠️ The
  // rule above still stands: the notice and the limit must both be here. Delete the
  // SECOND sentence and this becomes the promise the rule was written against.
  // ⭐ "reach" → "stop": what a deletion cannot do to a message already in flight is
  // stop it, and "reach" was the vaguer verb.
  // ⚠️ §6.7.1 rule 2 again, at scale. "are told" was a promise about fifty bounded
  // best-effort sends at once; each one can fail on its own and none is acknowledged.
  otherSide:
    "A closing notice is sent to each person you were talking to. This does not " +
    "delete anything on their devices, and it does not stop anything already on its way to them.",

  // ⚠️⚠️ FEEDBACK 4 (round 3), AND THE LABEL WAS THE WHOLE DEFECT. Hannu pressed
  // *"I need to delete everything"*, and afterwards his passphrase still opened the
  // app — so he reported that the action had not done what it said. It had done
  // exactly what §7.3.1a specifies: **it deletes every conversation, not the
  // identity**, and it cannot delete the identity, because §7.3.1a's tombstones and
  // `purged_at` are what carry the deletion to the other devices — destroying the
  // list would leave them with a 404 and every channel root they already had.
  // ➡️ So the sentence is owed, and the gate label was a promise the action never
  // made. Same shape as D-087: one control, two labels, and the one written in the
  // user's own emotional register was the one that was not true.
  //
  // ⭐ D-148 CUT THE TRAILING CLAUSE — *"which is what lets the other people be told
  // that theirs have ended"*. It is true and it is an answer to a question nobody on this
  // screen is asking: it explains why the identity CANNOT be deleted, to a person who has
  // just been reassured that it is not. `otherSide` above already promises the notice.
  survives:
    "Your KEY keeps working afterwards, and opens an empty list. This deletes conversations, " +
    "not your KEY.",

  done: "Your conversations have been deleted from the list. This device has been cleared.",

  // §6.7.1, from here. ⚠️ SENT, NEVER SEEN — the same rule as the single deletion.
  // ⚠️ BOTH NUMBERS ARE COMPUTED AND SO IS THE GRAMMAR (D-082). "the other person"
  // stays singular because it is singular per conversation, which is what makes
  // this read correctly at one conversation and at fifty.
  // ⚠️ §6.7.1 rule 2. The count is of notices this device SENT — the only number it
  // can know. ⭐ "the other person" stays singular because it is singular per
  // conversation, which is what makes this read correctly at one and at fifty (D-082).
  told: (n, of) =>
    `${plural(of, "conversation")} deleted, and a closing notice was sent to the other person in ${n} of them.`,

  // ⚠️ IT MUST NOT CLAIM NON-DELIVERY EITHER. It said *"nothing reached them"*, and a
  // send that fails locally cannot tell "never arrived" from "arrived, answer lost" —
  // the same ignorance that forbids the promise in the other direction.
  toldNone:
    "The conversations were deleted. No closing notice could be sent, and their copies " +
    "are still open on their devices.",

  // §7.3.1a: reachable from a device the user has never used before, with the
  // passphrase alone — the scenario is a device that is gone.
  // ⚠️ IT NO LONGER SAYS "everything". See `survives` above.
  fromGate: "I need to delete every conversation",
};

// ----------------------------------------------------------------- §3 pairing

/**
 * §0.2's startup feature detection, on the one device in a hundred where it comes
 * back short.
 *
 * ⚠️ THE POINT OF SAYING THIS AT ALL IS *WHEN* IT IS SAID. §0.2: "The client MUST
 * feature-detect at startup." A client that discovers a missing primitive at the
 * moment somebody presses "pair" has already failed — they have written to a
 * friend, sent a link, and are watching a screen that will never finish. This
 * sentence is the difference between that and a browser that says so before
 * anything is asked of it.
 *
 * ⚠️ It does not name X25519 or Ed25519. The person reading it cannot act on the
 * name, and the one who can is a tester — so the algorithm goes in the detail
 * line under the message, where `reason:` already lives for pairing failures.
 */
export const primitives = {
  missing:
    "This browser cannot do one of the kinds of cryptography this app is built on, " +
    "and the stand-in for it could not be loaded.",

  // ⚠️ The second sentence is a fact about what just happened, not reassurance:
  // this halt is at boot, before an unlock, so it has touched nothing. It says so
  // because "the app refused to start" reads like "the app deleted itself" to
  // somebody whose conversations are on this device.
  what:
    "Updating this browser, or opening the page in a different one, is usually enough. " +
    "Nothing has been sent, and nothing already on this device has been changed.",
};

export const pairing = {
  // §2.1, D-018: the invite link goes to ONE person, once. Phase 0.5 measured
  // people trying to reuse it, which is why this is the first sentence and not a
  // note.
  // ⚠️⚠️ D-153 SPLIT THIS SENTENCE AND THE SPLIT IS THE DECISION, not a rewrite. It read
  // *"works once, for one person, for one day"* — a triple, and the best-tested sentence
  // in the product. Making the duration a digit left *"for one person, for 1 day"*: one
  // fact written two ways inside one breath, and the notation decided by which half came
  // from a constant. ⭐ Hannu was shown all three ways out and chose the one that removes
  // the collision instead of ruling on it — the person and the day now say themselves in
  // separate sentences, so neither form has to win. The two facts testers got wrong —
  // ONCE, and ONE PERSON — still lead.
  linkIsOnce:
    "This invite link works once, and only for the person you send it to. " +
    `It lasts ${span(PAIRING_TTL_SECONDS)}. Send it however you normally talk to that person.`,

  /**
   * ⚠️⚠️ FEEDBACK 12, AND THE ANSWER TO IT IS *NO* — SO THE PRODUCT HAS TO SAY SO
   * BEFORE IT HAPPENS. He asked what a person does if they close the page while a
   * link they created is out there. Nothing: §3 keeps `i_priv` and `L` in this
   * document and in `sessionStorage`, which survives a RELOAD and does not survive
   * the tab closing. The other half of the key agreement is gone, and the friend who
   * opens the link waits until §3's session runs out. ⚠️ SUPERSEDED IN KEPT MODE by
   * §3.4.1b — the record survives the tab and the next unlock offers to carry on. The
   * answer below is still exactly right for Ghost, which writes nothing durable.
   *
   * ⚠️⚠️ THE PARAGRAPH THAT STOOD HERE JUSTIFIED THAT "NO" WITH A FALSE PREMISE, AND
   * ROUND 4 ASKING THE SAME QUESTION AGAIN IS WHAT MADE ME READ IT (D-100). It said
   * storing the pairing key durably *"would put a live key on disk in a product whose
   * §7.6 mode exists precisely so that nothing is written"* — but §3.4.1 already
   * measured and stated the opposite in as many words: **`sessionStorage` is
   * persisted, so `L` reaches disk today.** The difference between the two stores is
   * not disk, it is LIFETIME. Its second reason was wrong in a different way: §3.3
   * requires the key discarded the moment pairing completes, and a durable record
   * deleted at that same moment satisfies it exactly.
   *
   * ⭐ So the honest answer is that resumable pairing is POSSIBLE and was never
   * costed. What it actually costs is written up in `ROADMAP.md` (Phase 2) and
   * `DECISIONS.md` D-100; the short of it is that §3's commitment (§3.6.1) means a
   * longer-lived link does NOT make pairing asynchronous — both devices must still
   * be online after the claim — so the feature is "resume", not "a link that lasts
   * a day", and until it is built this sentence is the fix.
   */
  /**
   * ⚠️⚠️ THIS SENTENCE BECAME FALSE THE MORNING §3.4.1b SHIPPED, AND NOTHING IN THE
   * BUILD NOTICED. It said *"close it and the invite link cannot be finished, and you
   * will both need a new one"* — which was true for as long as the pairing lived in
   * `sessionStorage`, and stopped being true the moment a Kept-mode record survived
   * the tab. The comment above it even said *"until it is built this sentence is the
   * fix"*. It was built; the sentence stayed. ➡️ A feature does not update the prose
   * that describes it, and prose stating what the product CANNOT do is the kind with
   * an expiry date.
   *
   * ⚠️ IT IS TWO SENTENCES BECAUSE IT IS TWO MODES, and §3.4.1b rule 2 is why: Ghost
   * writes nothing durable, so a Ghost pairing really is tab-bound and the old
   * warning is still exactly right there. Kept resumes. One string could only be
   * wrong for one of them.
   */
  keepOpen: {
    // ⭐ D-149 — "openable" IS GONE FROM BOTH PLACES IT STOOD. It is a word nobody says,
    // in the paragraph a person reads while waiting. ⚠️ The second one was not in his
    // batch; leaving it would have kept the odd word in the same paragraph it was cut
    // from, which reads worse than either version.
    kept:
      `The invite link works for ${span(PAIRING_TTL_SECONDS)}. If you change your mind, or ` +
      "it went somewhere you did not mean it to go, cancel it. If you close this browser before your " +
      "friend opens it, the invite link still works for the rest of that time — next time you " +
      "type your KEY you can carry on with it, or cancel it then.",
    ghost:
      "Keep this tab open until your friend has opened it. In Ghost mode this tab is holding your half " +
      "of the pairing — close it and the invite link cannot be finished, and you will both need a new one.",
  },

  /**
   * §3.4.1b, when the in-flight record could not be written.
   *
   * ⚠️ ROLE-NEUTRAL ON PURPOSE. It is shown to an initiator watching a link, an
   * initiator watching a code, and a joiner waiting for the reveal — three screens
   * whose other sentences are deliberately different, because §2.2's copy may not
   * say "link" and §2.1's may not say "code". Naming neither keeps one string honest
   * on all three; the thing it has to say is about the TAB, which is the same in
   * every case.
   *
   * ⚠️ IT DESCRIBES THE BROWSER'S REFUSAL, NOT A FAULT. A person on a locked-down
   * or private-mode browser has not done anything wrong and nothing is broken —
   * there is one capability missing and one thing to do about it.
   */
  notDurable:
    "This browser would not let this page save your half of the pairing. Keep this tab open " +
    "until the pairing finishes — if it closes, you will both need to start again.",

  waiting: "Waiting for your friend to open it…",

  /**
   * §9.1's proof-of-work, and the two joiner steps.
   *
   * ⚠️ THESE WERE WRITTEN INLINE IN `app/app.js` AND ONE OF THEM SAID *"Doing the
   * work the server asks for"*, which is a true description of §9.1 and tells a
   * person nothing they can use. A progress step is not the place to explain the
   * mechanism; it is the place to say what the wait is FOR.
   */
  step: {
    preparing: "Preparing the invite link…",
    finishing: "Finishing",
    checking: "Checking the invite link",
    claiming: "Opening it",
    waitingOther: "Waiting for the other person",
    done: "Done",
  },

  /**
   * §3.4.1's abandonment record, found in `sessionStorage` at boot.
   *
   * ⚠️⚠️ THE OLD SENTENCE WAS WRITTEN FOR ONE OF THE TWO ROLES AND SHOWN TO BOTH.
   * It said *"A pairing link created in this tab was never finished"* — and
   * `flow/pair.js` writes this record for the JOINER too, who created nothing and
   * merely opened somebody else's link. Feedback 16 is that sentence arriving at a
   * person it was not about, which is why it read as nonsense to them.
   */
  inflight: {
    made:
      "An invite link you made in this tab was never opened by anybody. It keeps working until it " +
      "runs out, and then it stops on its own.",
    opened:
      "You opened somebody's invite link in this tab and the pairing never finished. Nothing was " +
      "set up, and that link cannot be used again.",
    cancel: "Cancel that invite link",
    forget: "Clear this",
  },

  /**
   * §3.4.1b rule 7's offer, and it is NOT `inflight` above however similar it looks.
   *
   * ⚠️⚠️ THE TWO SAY OPPOSITE THINGS AND THE DIFFERENCE IS WHICH STORE FOUND THE
   * RECORD. `inflight` is Ghost's, and Ghost cannot resume (rule 2) — so it reports
   * something that is over and offers only to tidy it away. This one comes from the
   * sealed `conversation` record, which the pairing CAN be carried on from, so it
   * must not tell somebody that nothing was set up when the thing is still live.
   * Reusing one sentence for both would put "that link cannot be used again" above a
   * button that uses it again.
   *
   * ⚠️ "Carry on" RATHER THAN "Resume". The record, the section and the argument are
   * all called resumption; the person is being asked whether to keep going with
   * something interrupted, which is what the button has to say.
   */
  resume: {
    made:
      "An invite link you made is still waiting for somebody to open it, and this browser closed " +
      "before that happened. You can carry on from where it stopped.",
    opened:
      "You opened somebody's invite link and this browser closed before the pairing finished. You " +
      "can carry on from where it stopped.",

    // ⚠️⚠️ THE TWO ABOVE NAME A CAUSE — "this browser closed" — AND FEEDBACK 16
    // CAUGHT THEM SAYING IT TO SOMEBODY WHOSE BROWSER HAD NOT CLOSED. They were
    // written for the unlock screen, where closing is what happened; §3.4.1b rule 11
    // gave them a second caller on 2026-08-20, and a person watching a link screen
    // for eleven minutes was told the browser had closed underneath it.
    //
    // ⭐⭐⭐ THE SENTENCE DID NOT CHANGE. WHAT CHANGED IS WHO REACHES IT — D-135's
    // finding exactly, committed inside the change that recorded D-135's finding.
    // ➡️ A sentence that explains WHY is a sentence with an audience, and a new
    // caller is a new audience.
    //
    // ⚠️ So these two explain nothing about a cause and say only what is true in
    // both situations: the invite link is good, this device can still finish.
    interruptedMade:
      "The invite link you made is still good, and this browser still has what it needs to finish. " +
      "You can carry on from where it stopped.",
    interruptedOpened:
      "The invite link you opened is still good, and this browser still has what it needs to " +
      "finish. You can carry on from where it stopped.",

    go: "Carry on",
  },

  // ⚠️ THE JOINER ARRIVES AT THE GATE HOLDING A LINK AND UNTIL NOW IT SAID NOTHING
  // ABOUT THAT. §3's session lives a day (D-136); the first thing this person saw was
  // a choice between setting up a phrase and typing one they have never had, with
  // no indication that either would lead back to the link they clicked. It is also
  // the one moment Ghost mode is obviously the right answer, which is why the
  // sentence belongs here rather than in a note further down.
  arrived:
    "Somebody sent you an invite link to a conversation. Choose how to open it — either way works.",

  // ⚠️⚠️ THE SAME SENTENCE FOR §2.2's CODE, AND IT IS NOT A DUPLICATE. The gate told
  // somebody who had just typed in a code that they had been sent an invite LINK —
  // found by driving two browsers through the whole flow, and unfindable any other
  // way, because the string is perfectly correct wherever it was looked at. ⭐ D-018
  // cuts both ways: naming one thing consistently is only worth anything if it is
  // the thing in front of the reader.
  arrivedCode:
    "Somebody sent you a code for a conversation. Choose how to open it — either way works.",

  /**
   * §3.6.2 — and the previous sentence here was teaching the wrong test (D-081).
   *
   * It said *"Read these six digits to each other. They must match."* ⚠️⚠️ **The
   * digits are equal at the two ends of every completed handshake, including a
   * handshake with an attacker** — that is arithmetic, not evidence. So a sentence
   * that stops at "they must match" describes a comparison between two SCREENS,
   * and the comparison that matters is between one screen and one PERSON.
   *
   * ⭐ Hannu asked the question that found this on his first evening with the
   * product: *"is it so that in any case the six digits are the same for both
   * participants, and that is not what should be checked?"* Yes. That is exactly
   * it, and the specification had never said what a user was being asked to do.
   */
  /**
   * ⚠️⚠️ AND IT NAMED THE WRONG PERSON AND THE WRONG THING AT ONCE, WHICH A
   * SCREENSHOT OF THE LIVE SITE IS WHAT SHOWED.
   *
   * It read *"Read these six digits to the person you sent the invite link to."*
   *
   *   — **The joiner never sent anything.** They received it. This has been shown to
   *     both roles since the screen was written, which is feedback 16's defect
   *     exactly: a sentence written for one role and displayed to both.
   *   — **Half the pairings no longer involve a link at all.** §2.2's code arrived
   *     today, and this screen told the person who read one out loud that they had
   *     sent an invite link.
   *
   * ⚠️⚠️ IT CANNOT BE FIXED BY BRANCHING, AND THAT IS THE INTERESTING PART. This
   * screen is reached twice — once straight after pairing, where the kind is known,
   * and once from inside a conversation whenever the person is finally able to ask
   * (D-081's whole point). On the second route **nothing on the device records which
   * of §2's two secrets built the channel**, and storing it would be a schema change
   * to answer a question about wording. ➡️ So the sentence has to be true of both,
   * and naming the other person as *your friend* — the product's word for them
   * everywhere else — makes it true of both roles at the same time.
   */
  sas: "Read these six digits to your friend.",

  /**
   * ⭐⭐ HANNU'S OWN REWRITE FROM THE TESTER ROUND, AND IT FIXES AN AMBIGUITY HE WAS
   * NOT AIMING AT.
   *
   * The sentence here used to end *"If somebody else opened your invite link, that
   * person has no digits at all."* The intended antecedent of "that person" is **the
   * friend you meant to reach** — they were beaten to the link and got nothing. But
   * the nearest noun phrase is "somebody else", so a reader moving at ordinary speed
   * takes it to mean the impostor has no digits, **which is the opposite of the
   * truth**: whoever completes the handshake sees digits, and that is exactly why
   * matching digits prove nothing on their own.
   *
   * ⚠️ `sasHow` and `laterNote` were folded into `terms["six-digits"]` in the same
   * pass (D-110) — three paragraphs of correct advice on a screen whose job is to ask
   * one question and take one answer. Their checks moved with the content rather than
   * being deleted alongside it (D-107).
   */
  /**
   * ⚠️ "the invitation" IS THE ONE NEW WORD IN THIS PASS AND IT IS DELIBERATE. The
   * product has two ways in now — §2.1's **invite link** and §2.2's **code** — and
   * this screen cannot know which one built the channel it is asking about. A
   * superordinate is therefore required rather than merely convenient, and it is not
   * a second name for the invite link any more than "conversation" is a second name
   * for Ghost mode: it names the CATEGORY the two belong to. ⚠️ It may be used only
   * where the kind is genuinely unknown; everywhere the kind IS known, the thing is
   * called by its own name.
   */
  //
  // ⭐⭐ D-148 RAISED THE VOICE AND REMOVED THE NOTE UNDER IT, AND THE TWO GO TOGETHER.
  // This is the one screen in the product where a person is being asked to catch an
  // attacker, and *"Make sure"* is the register of a checklist. ALL CAPS is used once,
  // on the word the whole screen turns on. ⚠️ D-109's rule is about the WORD "key" and
  // is untouched: KEY stays the user's eight words and nothing else.
  //
  // ⚠️⚠️ `sasMismatch` IS GONE — *"If they do not match, stop. Do not carry on in
  // this conversation."* It was a sentence telling a person to do what the button beside
  // it does. Three answers are on the screen and one of them IS "they do not match"; a
  // note instructing the reader to stop, above a control that stops, is prose competing
  // with its own mechanism. ⚠️ `pairing.wrongConfirm` is what says what stopping means
  // and it is unchanged — if that ever goes, this note has to come back.
  sasWhat:
    "The person at the other end of this conversation has these same [six digits](six-digits). " +
    "Make ABSOLUTELY sure that person is your friend, and not somebody who stole the invitation " +
    "on the way!",

  copy: "Copy invite link",
  copied: "Copied",

  // The clipboard was refused — some browsers do, and some configurations do.
  copyManually: "Select it and copy",

  /**
   * §2.1.2's QR symbol — the tester round's third feature (D-114).
   *
   * ⭐ THE LABEL NAMES THE SITUATION, NOT THE MECHANISM, exactly as `toCode` does. A
   * person who is standing next to their friend knows that they are; they do not know
   * what a QR code is for, and half of them do not know the words. "My friend is here
   * with me" is checkable by the person reading it — which is the same test that
   * replaced four buttons reading "Back".
   *
   * ⚠️ IT IS ALSO THE HONEST SCOPE OF THE FEATURE. D-114 records that this does NOT
   * answer what the testers reported — a friend at the other end of a telephone — and a
   * label promising anything more general would quietly claim it did.
   */
  toQr: "My friend is here with me",

  qr: {
    hide: "Hide the square",

    /**
     * ⭐ "The same invite link" is the load-bearing phrase. Everything the person has
     * already been told about the link — once, one person, one day — stays true, and
     * saying so is cheaper and more accurate than repeating those three facts in a
     * second voice where they could drift apart. (§2.2's code needed its own copy of
     * them precisely because it is NOT the same secret.)
     */
    what:
      "Point your friend's camera at this. It is the same invite link, so it opens on " +
      "their phone, and it still works only once.",

    /**
     * The one caveat a person can act on, next to the control that acts on it.
     *
     * ⚠️⚠️ THIS IS WRITTEN AS AN EXPLANATION AND NOT AS AN ANNOUNCEMENT, which is
     * D-112's rule. The tempting sentence here is a confession — *"a web page cannot
     * control who photographs your screen"* — and it is true, useless, and alarming.
     * ⭐ The worry it raises is answered on the same screen, by the button beside it;
     * D-120 is the defect of raising one and answering it two panels away.
     *
     * ⚠️⚠️⚠️ THE SENTENCE THAT STOOD HERE FIRST ENDED *"the six digits on the next
     * screen will not match"*, AND THAT IS FALSE IN THE DANGEROUS DIRECTION (D-125).
     * Somebody who photographs this screen and opens the link pairs with THIS device, so
     * their digits match ours perfectly — the person left holding nothing is the friend.
     * `test/copy.mjs` already carries the removed twin of that sentence in a comment,
     * from the round that deleted *"that person has no digits at all"* for the same
     * ambiguity. The true signal is simpler and needs no digits: the link works once, so
     * a stranger opening it first LOCKS THE FRIEND OUT, and the friend saying "it does
     * not work" is the thing that tells you.
     */
    room:
      "It is on your screen, so keep it turned towards your friend, and hide it again " +
      "once their phone has opened it. The invite link works once: if somebody else " +
      "opens it first, your friend will not be able to.",
  },

  /**
   * §2.2's spoken code — the tester round's first new feature.
   *
   * ⚠️⚠️ THE REQUEST WAS NOT FOR A CONVENIENCE. *"Sending invite link can be
   * difficult for some persons: they do not have WhatsApp or have the wrong email on
   * that device. The invite-link-code with 16 char is needed for phone contacts."*
   * The population is people for whom no link travels at all, so this is a delivery
   * channel and the wording may not present it as a shortcut for the impatient.
   *
   * ⚠️ It is reached from BENEATH the invite link rather than instead of it (D-117),
   * because the person finds out that a link will not reach their friend only after
   * they have already made one.
   */
  // ⚠️ "this invite link", not "a link" — D-018's rule, and the copy gate caught the
  // shorter version on the first run. The product names the thing "invite link"
  // everywhere, and a control that drops the adjective is a second name for it.
  //
  // ⭐ D-151 NAMED THE OUTCOME AS WELL AS THE SITUATION, and it is the one place where the
  // rule two comments up gives way. *"My friend cannot open this invite link"* is checkable
  // by the reader and says nothing about what pressing it does — which is fine on `toQr`,
  // where the picture explains itself, and not fine here, where the thing on the other side
  // is a construction the product has never mentioned. Hannu's own words: *"show a code I
  // can read or send"* — and both verbs are exact, because `code.isOnce` on the next screen
  // says *"Read it out to your friend, or send it in a text message."*
  //
  // ⚠️ His line was *"My friend cannot open invite link, show a code I can read or send."*
  // The article is back (D-018 names the thing "the invite link", never bare) and the comma
  // splice is a dash. Nothing else of his was touched.
  toCode: "My friend cannot open this invite link — show a code I can read or send",

  code: {
    // The same three facts as `linkIsOnce`, because they are the same three facts.
    // ⭐ "Or send it in a text message" is not padding: a phone number is exactly the
    // contact the reporting testers had, and a code fits an SMS where a URL is
    // mangled or unclickable.
    isOnce:
      "This code works once, and only for the person you read it to. " +
      `It lasts ${span(PAIRING_TTL_SECONDS)}. Read it out to your friend, or send it in a text message.`,

    /**
     * §2.2b, and it is a REQUIREMENT rather than a nicety (D-113).
     *
     * ⚠️⚠️ §2.2 has been titled "voice-readable" since the day it was written, and its
     * alphabet excludes the characters a person misreads off a SCREEN. Ten of the
     * characters it kept — `B C D E G P T V Z 3` — are the ones an English telephone
     * line turns into each other. The section had never once been aimed at the ear.
     *
     * ⚠️ The spelling words are English and that is a known residual, recorded in
     * §2.2b with its costed remedy. Two Finnish speakers will not say "yankee". This
     * sentence therefore says what the words are FOR rather than naming the alphabet,
     * so that a locale swap needs no new sentence.
     */
    spelling:
      "Under the code is a word for each character. Say the words rather than the letters — a B " +
      "and a P sound the same down a telephone, and the words do not.",

    // Feedback 12's answer, one screen along. The initiator's half of §3 lives in
    // this document and nowhere else, and the code is spent either way.
    /** The same two modes as `keepOpen`, for the same reason. */
    keep: {
      kept:
        `This code works for ${span(PAIRING_TTL_SECONDS)}. If you change your mind, or you read it out ` +
        "to the wrong person, cancel it. If you close this browser before your friend types it in, the " +
        "code still works for the rest of that time — next time you type your KEY you can carry on " +
        "with it, or cancel it then.",
      ghost:
        "Keep this tab open until your friend has typed the code in. In Ghost mode this tab is holding " +
        "your half of the pairing — close it and the code cannot be finished, and you will both need a new one.",
    },

    copy: "Copy code",

    /**
     * §3.4.1's DELETE happened on the way here, and somebody may already have sent
     * the link it deleted.
     *
     * ⚠️ IT IS A PERMANENT LINE ON THIS SCREEN RATHER THAN A PASSING NOTICE, because
     * it is true of every code this product can produce: the only route to one is
     * through the invite link screen (D-117). ⚠️ A later direct route to a code — or
     * resumable pairing, which is queued — makes it false, and the line must move to
     * the switch itself on the day either lands.
     */
    replacedLink: "The invite link is cancelled. This code opens the conversation now.",

    step: "Preparing the code…",
  },

  // §2.1's fragment, which never reaches the server. It was written into the HTML.
  fragmentNote: "The secret is the part after the # . Browsers never send that part to the server.",

  cancel: "Cancel",

  /**
   * §3.6.2's three answers. Only one of them is a stored state — "not yet" is the
   * absence of one, and "this is not my friend" is a deletion.
   */
  answer: {
    // ⚠️⚠️ D-149 — THE BUTTON WAS ANSWERING THE WRONG QUESTION. *"We compared them and
    // they are the same"* reports on the DIGITS, and matching digits are not the finding:
    // whoever completes the handshake sees digits that match, including somebody who stole
    // the invitation (D-125). The thing the person has to be sure of is WHO is at the other
    // end, and `sasWhat` above now asks for exactly that in capitals — so the answer has to
    // be an answer to THAT question, in the user's own voice.
    verified: "Absolutely sure — it is my friend.",
    later: "Not yet — I will ask my friend later",
    // ⚠️ SAME TWO DEFECTS AS `sas` ABOVE, IN THE ONE CONTROL ON THIS SCREEN THAT
    // DELETES A CONVERSATION. It read "the person I sent the invite link to": untrue
    // for the joiner, who sent nothing, and untrue for anybody who read out a code.
    // What the button MEANS is neither of those — it means the person on the other
    // end is not who this was for, however the invitation reached them.
    wrong: "This is not the person I meant to reach",
  },

  // ⚠️ `laterNote` MOVED TO `terms["six-digits"]` AND WAS NOT DELETED. It must not
  // sell "later" as fine and must not scold anybody for choosing it: chatting and
  // asking questions only the real friend could answer is a reasonable thing to do
  // and is genuinely weaker, because somebody who knows your friend can answer those.
  // Both halves of that survive, one layer down, where a person who chose "later" can
  // reach them without the screen arguing back at everybody who did not.

  // §7.3.1a's deletion, reached from the pairing screen. §3.6 is why the advice is
  // to use a different channel: whatever carried the invitation is what to doubt.
  //
  // ⚠️ Reached from the same screen as `sas` and under the same constraint — the
  // kind may be unknown by the time somebody presses it — so "the invitation" here
  // is the superordinate documented at `sasWhat`, not a loose synonym.
  wrongConfirm:
    "Delete this conversation?\n\n" +
    "This removes it here. The invitation is spent either way — if you still want to reach your " +
    "friend, start again and send the new one a different way.",

  tripwireTitle: "Somebody else opened this invite link",
  failureTitle: "Pairing did not complete",

  // ⚠️⚠️ §3.4.1b RULE 11 ARRIVES ON THE FAILURE PANEL AND IS NOT A FAILURE, so it
  // may not wear `failureTitle`. "Pairing did not complete" over a sentence saying
  // the invite link still works is the product contradicting itself in the two
  // places a person reads first — and D-133 is what that costs when the heading is
  // the half they believe.
  //
  // ⚠️ IT SAYS "STILL WAITING", NOT "STOPPED" or "TIMED OUT". Nothing has run out:
  // the link is good, the record is on the device, and the only thing that ended is
  // this page's watching. A title that announces an ending would need the sentence
  // underneath to take it back.
  pausedTitle: "Still waiting for your friend",

  // ⚠️⚠️ §3.4.1b RULE 10 CREATED A CLASS OF OUTCOME THAT HAD NO SCREEN: interrupted,
  // record kept, still finishable. Feedback 16 found it wearing `failureTitle` — a
  // dropped connection announced as "Pairing did not complete", in an alarm panel,
  // over a pairing that was completely recoverable and which Hannu then recovered.
  // ⭐ The record said "keep this, it is not over" and the screen said the opposite,
  // because the two were classifying the same error by different rules.
  //
  // ⚠️ NOT "Still waiting for your friend" — that is `pausedTitle`, and it is about
  // NOBODY ARRIVING. This one is about the attempt breaking, which is a different
  // fact and a different worry.
  interruptedTitle: "The pairing was interrupted",

  failureUnknown: "Something went wrong before the pairing completed.",

  // Shown when an interrupted pairing has no sentence of its own. ⚠️ It may not say
  // "went wrong" like `failureUnknown` does: nothing is wrong, something stopped.
  interruptedUnknown:
    "The pairing stopped before it finished. The invite link is still good and this browser still " +
    "has what it needs, so you can carry on.",

  // §3.5. ⚠️ Only a VERIFIED tripwire is an alarm: the server sets its flag
  // whenever a second claim arrives and has no key to check one with, so an
  // unverified flag means somebody forged a claim — a nuisance, not an
  // interception.
  /**
   * ⚠️⚠️ IT SAID *"The pairing itself is sound"* UNTIL 0.9.22, AND THAT SENTENCE WAS
   * A COIN-FLIP STATED AS A FACT — quite possibly the inversion of the truth.
   *
   * A verified tripwire means the refused claim's MAC checked out against a key
   * derived from `L` (§3.5, `readTripwire`), so **two different parties holding the
   * invite link both claimed it**, and the session went to whichever reached the
   * compare-and-set first. Nothing in the evidence says which. If the interceptor
   * won the race — and an interceptor is watching for the link while a friend is
   * merely reading a message — the pairing is with the interceptor, and this string
   * was telling the user it was fine.
   *
   * ⭐ AND THE ALARM IS NEVER A FALSE ONE, which is what makes saying so affordable:
   * `writeRetrying` reads back the `J_pub` only this device could have produced
   * before ever re-sending a claim (§3.4.1b rule 10, §3.6.1), so an honest party's
   * own retry cannot present as a second holder. The uncertainty is about WHO won,
   * not about whether anything happened.
   */
  tripwire:
    "Somebody else tried to open this invite link. The conversation went to whoever answered " +
    "first, and nothing here can tell you whether that was your friend. Compare the six digits " +
    "before you trust this conversation, and delete it if they do not match.",

  failure: {
    link_malformed:
      "This invite link is incomplete — the part after the # is missing. Ask for a new one.",

    // ⚠️ ITS OWN SENTENCE RATHER THAN `link_malformed`'s, because the two people are
    // not in the same situation. The one holding a broken link can ask for another
    // one; the one holding a code heard it and can ask for it again character by
    // character, which is a smaller and much likelier fix.
    //
    // ⚠️⚠️ THE SECOND SENTENCE IS A CLAIM ABOUT `CODE_ALPHABET` AND `test/copy.mjs`
    // CHECKS IT AGAINST THE CONSTANT. That is D-115's whole lesson: the parenthesis
    // in §2.2 that said "32 chars" beside 31 of them was exactly this kind of
    // sentence, and it survived three reviews because nobody counts a courtesy.
    code_malformed:
      `A code is ${CODE_CHARS} characters. Check it against what your friend read out — a ` +
      "code never contains the letters I or L, or the digit 1, so anything like that is something " +
      "else. Typing a zero where you heard Oscar is fine.",
    // ⚠️ THESE TWO ARE THE HARDEST CASES OF D-109'S SWEEP, AND THE SWEEP IMPROVED
    // THEM. Both were about §3.6.1's commitment and both said "key" — meaning the
    // other person's public key, on the two screens in the product where a user is
    // being told they may be under attack. That is the worst possible place for a
    // word that also names their own eight. Neither sentence needed the noun: what
    // a person can act on is that the SERVER SENT SOMETHING THIS LINK DID NOT
    // PROMISE, which is what they now say.
    offer_unverified:
      "What the server is offering does not match this invite link. Do not continue: this is either " +
      "a corrupted invite link, or a server putting something of its own in the way.",
    // ⚠️⚠️ D-150 SIMPLIFIED THE MIDDLE SENTENCE AND DELIBERATELY DID NOT WEAKEN IT.
    // Hannu asked for "something is mixing up" in place of *"This is an attempted
    // substitution"*. This is the one screen in the product that tells a person they
    // are being attacked, and "mixing up" reads as a glitch. ⭐ The register he wanted
    // is available without the retreat: "interfering" is a plain word and still names
    // an agent doing something to them. His own Finnish said as much — *jokin sotkee
    // kutsua* — so the subject stays impersonal and the danger stays explicit.
    commitment_mismatch:
      "The server sent something this invite link did not promise. Something is interfering with " +
      "this invitation. Do not retry — ask for a new one over a different channel.",
    already_claimed:
      "Somebody else opened this invite link before you, and that person holds the secret in it. " +
      "Treat the invite link as compromised and start again.",
    claim_forged:
      "This invite link was taken by something that could not prove it came from the link. Nothing " +
      "was intercepted, but the link is spent — create a new one.",
    // ⚠️ IT IS SHOWN TO BOTH ROLES, so it may not say which of them was waited for.
    // "Before the other person arrived" is true for the initiator and false for the
    // joiner, who arrived and was left waiting — feedback 16's shape, one screen along.
    // ⚠️ NOT `The ${span(...)} ran out` — D-136 made that read "The one day ran
    // out", which is not a sentence anybody says. The duration belongs where the
    // promise is made, not where it is reported broken; here the person needs the
    // SUBJECT, because by now they may not remember which link this was.
    expired: "The invite link ran out before the pairing finished.",
    not_found: "There is no pairing session at this invite link any more.",

    // ⚠️⚠️ THIS ONE IS NOT A FAILURE, AND IT SITS IN A TABLE WHERE EVERY NEIGHBOUR IS.
    // §3.4.1b rule 11 stops the watching after ten minutes; the invite link is good
    // for the rest of its day and the record is still on this device. The person has
    // lost nothing, so the sentence leads with what still works and asks only that
    // they come back.
    //
    // ⚠️ IT MUST NOT NAME A DURATION FOR THE WATCHING. "We stopped after ten minutes"
    // invites the obvious question, and the honest answer is about request volume —
    // which is our problem and not theirs. ⭐ Nor may it name the link's own
    // remaining lifetime: this screen cannot know how much of the day is left, and a
    // sentence that guesses is the D-133 shape (copy promising what the state does
    // not hold).
    // ⚠️ IT USED TO END *"unlock again when your friend is ready, and you will be
    // offered the chance to carry on"* — written when the offer only ever appeared at
    // unlock. It now appears beside this sentence, so directing the person to lock and
    // come back sends them the long way round to a button they are looking at.
    // ⚠️ AND IT MAY NOT SAY WHERE THE BUTTON IS. Notices render above the screen on a
    // desktop and wherever the layout puts them on a phone; "below" would be a claim
    // about pixels that this file cannot make.
    still_waiting:
      "Nobody has opened this invite link yet, so this page has stopped waiting. The invite link " +
      "itself is still good, and you can carry on whenever your friend is ready.",

    // ⚠️⚠️ FEEDBACK 16, AND IT IS THE THIRD TIME THIS TABLE HAS BEEN CAUGHT MISSING A
    // CASE. A lost network throws `NetworkError`, which carried NO `reason` at all —
    // so the lookup missed, `failureUnknown` answered, and a recoverable interruption
    // was reported as *"Something went wrong before the pairing completed."* Hannu
    // took the network away for sixteen seconds, was told the pairing had failed, and
    // then recovered it anyway. ⭐ Feedback 13 was the same table missing `429`.
    // ➡️ A lookup keyed by an error reason fails silently on the reason nobody thought
    // of, and the errors nobody thinks of are the ones the NETWORK raises.
    offline:
      "The connection dropped before the pairing finished. Nothing is lost — the invite link is " +
      "still good and this browser still has what it needs, so you can carry on once you are back " +
      "online.",

    // ⚠️⚠️ FEEDBACK 13: THIS CASE HAD NO SENTENCE AND THE RAW CODE REACHED A PERSON.
    // `failWith` falls back to `err.message` when the reason is not listed here, and
    // §9.2's refusal arrived on screen as *"429 rate_limited"*. The limiter working
    // is good news; a person seeing an HTTP status is not. ⭐ The general lesson is
    // that a lookup table keyed by an error reason **fails silently on the reason
    // nobody thought of**, and the fallback is where that shows up.
    rate_limited:
      "Too many attempts from this network in the last hour. This is the spam limit, not a fault — " +
      "wait a while and try again.",

    // ⚠️ AND ITS NEIGHBOUR, WHICH HAD THE SAME HOLE AND NOBODY HAD HIT IT YET.
    // `flow/pair.js` has mapped a 409 to `server_state` since it was written and
    // no sentence was ever written for it, so it would have printed
    // *"server refused: <code>"*. Found by listing the reasons the flow can
    // produce against the keys here — which `test/copy.mjs` now does, so the next
    // one cannot be added silently.
    server_state:
      "The server would not take this step of the pairing. Nothing was set up — start again with a " +
      "new invite link.",
  },
};

// ------------------------------------------- §3.6.2 — the state, inside the chat

/**
 * What a conversation says about itself, for as long as nobody has compared the
 * six digits.
 *
 * ⚠️⚠️ IT MAY NOT CALL AN UNVERIFIED CHANNEL INSECURE, AND THAT IS THE HARD PART.
 * The channel is end-to-end encrypted, it is not known to be intercepted, and the
 * overwhelmingly likely truth is that it is exactly who the user thinks. What is
 * unproven is one specific thing — that the other end is the person they meant —
 * so the sentence has to be about that thing and nothing wider. A banner that
 * shouted "not secure" at every ordinary conversation would be trained away
 * inside a week, and then it would be worth nothing on the day it mattered.
 *
 * ⚠️ And the other direction: `verified` records a HUMAN JUDGEMENT — somebody
 * compared six digits with somebody they believe is their friend, over a channel
 * they chose. **No sentence here may upgrade that into a cryptographic
 * conclusion.**
 */
export const verification = {
  unverified: "The [six digits](six-digits) have not been compared for this conversation.",

  /**
   * ⚠️⚠️ `unverifiedWhat` IS DELETED ON THE TESTER ROUND'S EXPLICIT INSTRUCTION, AND
   * IT IS THE SECOND HALF OF D-112.
   *
   * It read: *"Nothing says anything is wrong, and it is encrypted either way. What
   * has not been checked is who is at the other end."* Hannu's verdict was four words
   * — ***"Do not use this, confused everyone."***
   *
   * Every clause of it was true and each was there for a reason: the channel must not
   * be called insecure, the encryption holds either way, and the one unproven thing
   * has to be named precisely. ⭐ But it opens with an abstract subject asserting a
   * negative — the same construction as *"This design cannot hide it"* — and a person
   * who reads "nothing says anything is wrong" on a security screen does not come away
   * reassured. They come away asking what would have to say it.
   *
   * ➡️ Neither obligation is dropped. `unverified` above still refuses to call the
   * conversation insecure, and `terms["six-digits"]` states positively what the check
   * is for and what it is worth. **The two tests that guarded this string moved onto
   * those two, which is where its job went** (D-107).
   */

  /**
   * §3.5's warning where it actually has to live: on the conversation, for as long
   * as the conversation exists.
   *
   * ⚠️⚠️ THIS IS THE ONE ALARM IN THE PRODUCT AND IT IS WHY EVERY OTHER BANNER IS
   * QUIET. `unverified` above deliberately refuses to shout, because it appears on
   * every ordinary conversation; this appears only where a second holder of the
   * invite link is a measured fact, and it does not go away.
   *
   * ⚠️ IT MUST NOT SAY THE CONVERSATION IS COMPROMISED, and it must not say it is
   * fine. Both are claims about who won a race this device did not witness. What it
   * says is what happened and what the person can do about it — the six digits are
   * the answer, and they are recomputable at any time (§3.6.2), so the instruction
   * is always actionable.
   *
   * ⚠️ IT MUST NOT STOP AT "COMPARE THE DIGITS" EITHER. A comparison that MATCHES
   * settles who is at the far end; it does not un-hold the link. That is why the
   * last sentence is here and why the banner is not gated on `verified`.
   */
  tripwireTitle: "Somebody else opened this conversation's invite link",

  tripwire:
    "Somebody besides your friend had this invite link and tried to use it. The conversation " +
    "went to whoever answered first, and nothing here can tell you whether this is your friend.\n\n" +
    "Compare the [six digits](six-digits) with your friend out loud. If they match, this is " +
    "your friend. If they do not, delete this conversation and pair again with a new invite " +
    "link, sent a different way.\n\n" +
    "This notice stays until the conversation is deleted. Comparing the digits does not remove " +
    "it: it tells you who is at the far end, not that nobody else ever held the invite link.",

  check: "Compare the six digits",

  // §3.6.2: the SAS derives from the channel root, so it can be shown again at any
  // time — which is the whole reason "later" is a usable answer rather than a
  // polite way of saying never.
  checkLater:
    "These are the same six digits as when this conversation started. Read them to your friend " +
    "and compare.",

  matched: "They are the same",
  notNow: "Not now",

  // ⚠️ ONE SHORT LINE, BECAUSE IT SITS ON EVERY VERIFIED CONVERSATION FOREVER. It
  // reports what happened and claims nothing beyond it.
  verified: "Six digits compared.",
};

// ------------------------------------------------- §6.7.1 — the closing notice

/**
 * The only message this product ever sends by itself.
 *
 * ⚠️⚠️ IT EXISTS BECAUSE THE FIRST PERSON TO USE THIS PRODUCT ENDED A CONVERSATION
 * AND THE OTHER BROWSER WENT ON SENDING, successfully, with no error and no sign
 * of anything — into a mailbox nobody would ever drain again (D-079). §7.8's
 * ending was local and §7.3.1a said *"the other person keeps their copy."* Both
 * true, both silent.
 *
 * ⚠️ THE SENDER'S SENTENCE SAYS **SENT**, NEVER **SEEN**. §6.7.1 makes this one
 * bounded attempt that must never delay the removal, so a copy promising delivery
 * would be promising the one thing the design deliberately does not do.
 */
export const closing = {
  // Appended to the deletion confirmation, before anything is removed.
  /**
   * ⚠️⚠️ §6.7.1 RULE 2: *"the copy MUST NOT promise it was delivered."* This said
   * *"The other person will be told"* until 0.9.22, which is a promise about a
   * bounded best-effort send — one attempt, no retry, no acknowledgement, and a
   * server that can simply drop it. What the product actually does is TRY.
   */
  willTell: "We will try once to send the other person a notice that this conversation has ended.",

  // ⚠️ FEEDBACK 1. "They have been told." — told WHAT? The sentence was written
  // beside the code that sends the notice, where the subject is obvious, and read
  // on a screen where the last thing that happened was a deletion. A notice that
  // reports an outcome has to carry the outcome with it.
  /**
   * ⚠️⚠️ THE SEND RESOLVING MEANS THE SERVER ACCEPTED THE CIPHERTEXT, NOT THAT
   * ANYBODY READ IT. It said *"The other person has been told"* until 0.9.22 — the
   * receiver may be offline until the mailbox expires, or a hostile server may
   * simply withhold it, and the sender would have been relying on a warning that
   * never happened. ⭐ Feedback 1's requirement survives the correction: the
   * sentence still says WHAT the notice says, which is the part a person wants.
   */
  sent: "A closing notice was sent, saying that you ended the conversation.",

  // ⚠️ IT DID NOT GO, AND SAYING SO IS THE POINT. Nothing about the deletion
  // changes — the conversation is gone from here either way — and a person who
  // may need to warn somebody by other means has to know which of the two
  // happened.
  notSent:
    "The conversation has been deleted here, but the other person could not be told — nothing " +
    "got through. Their copy is still open on their device.",

  // The receiving end.
  theyLeft: "This conversation has ended.",

  theyLeftWhat:
    "The other person ended it, and their copy of it is gone. Nothing more can be sent here.",

  // Hannu's own wording for feedback 10, and it matches the design: §3's links are
  // single-use and the channel is being removed at the far end, so there is
  // nothing left to invite anybody through.
  startAnother: "Start a new conversation if you want to carry on.",

  // ⚠️ WHAT ARRIVED IS AN ANNOUNCEMENT AND NEVER A DELETION (§6.7.1 rule 6). The
  // receiver's history is the receiver's, and the sentence has to say so — a
  // person who assumed their own copy had just been wiped would behave very
  // differently in the next few minutes.
  yoursIsYours: "What you have here is still yours. Delete it when you want to.",
};

// ------------------------------------------- D-085 — what a tester reads out

/**
 * The diagnostics line.
 *
 * ⚠️⚠️ IT IS DELIBERATELY NOT SENT ANYWHERE, and that is a design decision rather
 * than a missing feature. A product whose claim is that the server learns nothing
 * does not acquire a telemetry channel to answer a performance question. The
 * person holding the device reads the numbers and types them to us, which is
 * slower and is the only version of this consistent with the rest.
 *
 * It exists because feedback 13 — Opera about a second, Chrome nearly ten —
 * **is not diagnosed and must not be guessed at.** `crypto/argon2.js` has recorded
 * the derivation's cost since it was written and nothing ever showed it.
 */
export const diagnostics = {
  label: "Timings on this device",

  note: "Nothing here is sent anywhere. It is on screen so you can read it out.",

  show: "Show timings",
  hide: "Hide timings",

  /**
   * D-085's build line, WHICH WAS TYPED IN `app/app.js` UNTIL 2026-08-24.
   *
   * ⚠️⚠️ FOUR ENGLISH SENTENCES, AND ONE OF THEM HANNU READ ON HIS OWN DEVICE —
   * `askServedBuild`'s header quotes him reading *"build 9b61457b8a287bd1, asking the
   * server"* off a screen. They were user-facing the whole time and never reached this
   * file, so the Finnish interface showed them in English. Found by widening
   * `test/copy.mjs`'s app.js check from the SHAPE of the strings it once caught to the
   * RULE it is labelled with: the old pattern wanted a double quote, a capital and
   * twelve characters, and these are template literals starting with an interpolation.
   *
   * ⭐ This is D-152 again — the same fault the comment below it records, in a fifth
   * place. Sentences do not stay in one file because a rule says so; they stay because
   * something checks, and a check that tests a shape tests the last bug.
   */
  // ⚠️ THE ROW VALUES A PERSON READS OUT. The field labels beside them (`build`,
  // `boot`, `key`, …) are names of measurements and stay in `app.js`; these two are
  // phrases, and were English in the Finnish interface for the same reason the build
  // line was — nothing checked, because the check tested a shape.
  notDerived: "not derived yet",
  proofAt: (ms, bits) => `${ms} ms at ${bits} bits`,

  build: {
    asking: (id) => `${id}, asking the server`,
    failed: (id) => `${id}, could not reach the server to compare`,
    current: (id) => `${id}, the current build`,
    stale: (id, served) => `${id} — OLD. The server has ${served}. Reload this page.`,
  },
};

/**
 * §5.2's one error that carries a diagnosis, and D-152 closed the last hole in D-083.
 *
 * ⚠️⚠️ IT USED TO TAKE THE SENTENCE AND ONLY ADD TO IT. *"this device's clock is about
 * three minutes ahead of the server, which stops it connecting"* was built inside
 * `flow/roster.js` AND, byte for byte, inside `flow/mailbox.js` — **the only English a
 * person could read that did not live in this file, written twice, where the two copies
 * could drift with nothing to notice.** It had never appeared on any review sheet in
 * either language, because every instrument this project has reads THIS module.
 *
 * ⭐⭐ AND THE TWO COPIES HAD ALREADY PRODUCED TWO SENTENCES. `describeIdentity` passed
 * the message through here, so the unlock and list screens got a capital and the advice;
 * the chat view printed `failure.message` raw, so the SAME failure, inside a conversation,
 * read *"this device's clock is about three minutes ahead of the server, which stops it
 * connecting"* — lowercase, and with **no advice at all**. One sentence with two homes,
 * found by going to look at the second one. Both call sites now come here.
 *
 * ⚠️ THE FLOW MODULES CARRY THE NUMBER AND NOT ONE WORD MORE. `failure.skew` is the
 * measured offset in seconds; every word of what a person reads is below.
 *
 * ⭐⭐⭐ THIS COMMENT ARGUED ITSELF OUT OF EXISTENCE IN ONE DAY, AND THE ARGUMENT IS WORTH
 * KEEPING. D-152 wrote here that the offset must be a digit because it is MEASURED: the
 * old `WORD` table was sparse, so *"about three minutes"* and *"about 17 minutes"* would
 * come out of one sentence depending on the reading, and **half words and half digits,
 * unpredictably, is worse than either**. It concluded: a declared number is spelled, a
 * measured number is a digit — and it applied that to this one sentence.
 *
 * ➡️ EVERY WORD OF IT WAS TRUE OF `list.unexplained` TOO, which counts whatever is
 * actually missing. The reasoning was general and the change was scoped to the sentence in
 * front of me, which is the same failure round 6 made on the gate paragraph. Hannu ruled
 * the words out altogether the next day (D-153) and the distinction is gone: every
 * quantity is a digit, so nothing here is special any more.
 *
 * ⚠️⚠️ AND IT REPEATED A FALSE CLAIM. It said *"nothing loosens: the stray-digit check
 * scans LITERAL strings"* — the check did no such thing, and finding that out is what
 * D-153 is actually about. The check now reads the source. ⭐ A sentence copied from a
 * check's own comment inherits whatever that comment got wrong.
 *
 * ⚠️ Hours above an hour, minutes below, because "about 1440 minutes" is what the old
 * version said to a phone with the wrong date.
 */
const offset = (seconds) => {
  const s = Math.abs(seconds);
  const [n, unit] = s >= 3600 ? [Math.round(s / 3600), "hour"] : [Math.round(s / 60), "minute"];
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
};

// ⚠️ NOT EXPORTED SINCE D-157 — `roster.failure.clock_skew` above is the one path in.
const clockSkew = (seconds) =>
  `This device's clock is about ${offset(seconds)} ${seconds > 0 ? "ahead of" : "behind"} the ` +
  "server, which stops it connecting. Set this device's clock to the right time — the network " +
  "time setting is enough — and try again.";
