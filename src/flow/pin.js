// The cover PIN — ARCHITECTURE.md §4.3's second tier.
//
// ⚠️⚠️ THE NAME IS DELIBERATE AND IT IS TWO NAMES. On screen this is a **PIN**, in
// both languages, because that is the word every person already owns from a phone
// and a bank card and it needs no explaining. In the documents it is the **cover
// PIN**, because `PROTOCOL.md` §7.5 records a *different* short PIN as a REJECTED
// design — mixing one into `wrap_key`, declined because it "costs exactly the
// convenience §7.5 exists to buy" — and a reader who meets one word for both would
// have to work out which is which every time. ⭐ The distinction is not decorative:
// the rejected PIN WRAPS KEY MATERIAL AT REST and this one wraps nothing at all.
//
// ⚠️⚠️ WHAT THIS IS, SAID BEFORE ANY CODE. It lifts a COVER. §4.3's vocabulary is
// load-bearing and this module may not blur it:
//
//   • A LOCK drops the derived keys and costs an Argon2id derivation from the eight
//     words to lift. It is worth something against somebody holding the device.
//   • A COVER drops nothing. The keys stay in memory, every connection stays up, and
//     a pairing that is waiting for a friend keeps running underneath it.
//
// So a cover with a PIN in front of it defends against **somebody picking up the
// device** — §4.3's own stated threat — and against nothing else. It does not resist
// devtools and it does not resist an XSS foothold, because the plaintext it is
// covering is in the same page. ⛔ **No sentence in this product may call it a lock.**
//
// ⚠️ WHY THE RECORD IS A PLAIN SALTED SHA-256 AND NOT A KDF, which looks like the
// wrong answer until you ask who the attacker is. The record lives in exactly two
// places, and in both of them anybody who can read it already holds more than the PIN
// would give them:
//
//   • Kept mode — `DURABLE`, encrypted under `local_key` (§7.2). Reading it means
//     holding `local_key`, which opens every session pickle and the whole history.
//   • Ghost mode — `sessionStorage`, beside the channel root itself (§7.6). Reading it
//     means reading the root, which IS the conversation.
//
// ➡️ **A KDF here would buy no defence this product does not already have, and it
// would cost the one thing the feature is for.** §7.2's Argon2id is 1.17 s on a
// decade-old Android (D-034); paying that to lift a cover is paying the lock's price
// for the cover's protection, which is the exact trade §4.3 says the second tier
// exists to avoid.
//
// ⭐ THE ONE REAL HARM A HASH DOES ADDRESS IS NOT haamu's, and it is answered in words
// rather than in arithmetic. A person who reuses their bank PIN here would have it
// recovered from the record by anybody who got that far — so `copy.pin` tells them not
// to reuse one. **An honest sentence beats a half-defence**, and a KDF that turns
// seconds into days is a half-defence against an attacker who is already inside.

import { concat, timingSafeEqual, utf8Bytes } from "../crypto/bytes.js";
import { b64uDecode, b64uEncode } from "../crypto/b64u.js";
import { sha256 } from "../crypto/hash.js";
import { randomBytes } from "../crypto/random.js";

/**
 * How many digits, and the person chooses inside the range.
 *
 * ⚠️ FOUR WAS PROPOSED AND HANNU DECLINED IT: *"Four is too short. 6-8 were
 * recommended."* ⭐ And he declined letters for a reason worth keeping, because it is
 * about behaviour rather than entropy: *"then people start to write it down and also
 * typing becomes so slow on mobiles that users again gasp for air."* A secret that is
 * written down is a secret on the same table as the device it covers.
 *
 * ⚠️ SIX IS ALSO §3.6.2's LENGTH AND THAT IS NOT A COLLISION. He weighed it — *"6 is
 * the same as the pairing number but the circumstances are so different I do not
 * believe in mixup"* — and the circumstances are: one is read aloud to a friend once,
 * the other is typed into this device by its owner. They never appear on the same
 * screen. ⛔ The copy still may not call this one "six digits": that phrase is
 * §3.6.2's glossary term and belongs to it.
 */
export const PIN_MIN = 6;
export const PIN_MAX = 8;

/** Why a proposed PIN was refused. Each has its own sentence — no default (D-163). */
export const NOT_DIGITS = "not_digits";
export const TOO_SHORT = "too_short";
export const TOO_LONG = "too_long";
export const ALL_SAME = "all_same";
export const RUN = "run";

/**
 * How many wrong entries before the cover gives up, in the mode that has somewhere
 * to give up TO.
 *
 * ⚠️⚠️ THE TWO MODES ESCALATE TO DIFFERENT THINGS AND ONE OF THEM MUST NOT ESCALATE
 * AT ALL. In Kept mode the fifth wrong entry drops the keys and asks for the KEY —
 * strictly better protection, and the owner has a way back. **In Ghost mode there is
 * no way back**: §7.6 has no phrase and no roster, so an escalation that dropped
 * anything would destroy the conversation on five guesses — D-016's tab loss arriving
 * by a fifth route, this time handed to whoever picked the phone up. So Ghost slows
 * down and never gives up, and `flow/ghost.js`'s ending stays on the screen as the
 * deliberate way out.
 */
export const WRONG_BEFORE_LOCK = 5;

/** After that many, every further attempt waits this long first. Ghost mode only. */
export const SLOW_MS = 5000;

/**
 * Pure: may this be a PIN? Returns null, or the reason it may not be.
 *
 * ⚠️ THE TWO SHAPE RULES ARE COMPUTED RATHER THAN LISTED, AND THAT IS THE WHOLE
 * POLICY. A blocklist needs maintaining, needs translating, and grows until it
 * refuses somebody's real choice; these two refuse exactly what a person standing
 * behind you tries first — every digit the same, and a straight run in either
 * direction. Anything further is guesswork dressed as a rule.
 */
export function validate(pin) {
  if (typeof pin !== "string" || !/^[0-9]*$/.test(pin)) return NOT_DIGITS;
  if (pin.length < PIN_MIN) return TOO_SHORT;
  if (pin.length > PIN_MAX) return TOO_LONG;

  const d = [...pin].map(Number);
  if (d.every((n) => n === d[0])) return ALL_SAME;

  const step = d[1] - d[0];
  if ((step === 1 || step === -1) && d.every((n, i) => i === 0 || n - d[i - 1] === step)) return RUN;

  return null;
}

/**
 * What gets stored. Salted so that two people who choose the same PIN do not carry
 * the same bytes, which is the one property a hash here can still honestly claim.
 */
export async function record(pin) {
  if (validate(pin) !== null) throw new Error("pin: refused by validate");
  const salt = randomBytes(16);
  const hash = await sha256(concat(salt, utf8Bytes(pin)));
  return { v: 1, salt: b64uEncode(salt), hash: b64uEncode(hash) };
}

/**
 * Does this PIN lift that cover?
 *
 * ⚠️ A DAMAGED OR ABSENT RECORD ANSWERS **false**, IT DOES NOT THROW. The caller is a
 * cover screen with somebody standing in front of it, and the difference between "this
 * is the wrong PIN" and "this browser's record is unreadable" is not a difference that
 * screen can act on — while a thrown error there would leave the cover up with no
 * message under it. §7.8's ending and the KEY are both still reachable.
 */
export async function matches(rec, pin) {
  if (!rec || rec.v !== 1 || typeof rec.salt !== "string" || typeof rec.hash !== "string") return false;
  if (typeof pin !== "string" || !/^[0-9]+$/.test(pin)) return false;
  let salt;
  let want;
  try {
    salt = b64uDecode(rec.salt, "pin salt");
    want = b64uDecode(rec.hash, "pin hash");
  } catch {
    return false;
  }
  const got = await sha256(concat(salt, utf8Bytes(pin)));
  return timingSafeEqual(got, want);
}

/** What the field hands back: whatever was typed, with everything but digits gone. */
export function digitsOnly(s) {
  return typeof s === "string" ? s.replace(/[^0-9]/g, "") : "";
}
