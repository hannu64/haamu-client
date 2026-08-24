// PROTOCOL.md §7.2 (key derivation from the passphrase) and §7.4 (what the
// passphrase is).

import { asciiBytes, concat, expectLength, utf8Bytes } from "../crypto/bytes.js";
import { sha256 } from "../crypto/hash.js";
import { hkdf } from "../crypto/hkdf.js";
import { randomIndex } from "../crypto/random.js";
import * as ed25519 from "../crypto/ed25519.js";
import { WORDLIST } from "./wordlist.js";

const INFO_ROSTER_SALT = "lpm-roster-salt-v1";
const INFO_ROSTER_ID = "lpm-roster-id-v1";
const INFO_ROSTER_KEY = "lpm-roster-key-v1";
const INFO_ROSTER_AUTH = "lpm-roster-auth-v1";
const INFO_LOCAL_KEY = "lpm-local-key-v1";
const INFO_PICKLE_KEY = "lpm-pickle-key-v1";

/**
 * §7.2, measured on six devices and decided in D-034. `m` is in KiB.
 *
 * ⚠️ These parameters and §7.4's entropy floor are ONE JOINT DECISION, never two.
 * §7.2's safety argument names 76.8 bits and rests on it; every bit given up
 * elsewhere is spent from the same budget. Nobody may lower the memory parameter
 * *and* let the phrase get shorter by treating them as separate questions.
 *
 * ⚠️ `p` is a parallelism parameter that the common WASM builds do not actually
 * parallelise, so raising it costs time and buys nothing. Reduce memory before
 * time cost.
 */
export const ARGON2_PARAMS = Object.freeze({ m: 128 * 1024, t: 3, p: 1, outLen: 32 });

/** §7.4: 8 words by default; 10 for the one quiet alternative. */
export const PHRASE_WORDS = 8;
export const PHRASE_WORDS_LONG = 10;

/**
 * §7.4: six candidates per set, at most ten sets in the life of one setup.
 *
 * ⚠️ The cap is what makes 76.8 bits a floor rather than a description. Free
 * regeneration made the worst case log2(candidates ever seen) — a number that
 * fell by a fraction of a bit every time the user pressed a button. Nothing about
 * that was dangerous numerically; it was structurally fatal, because §7.2's
 * safety argument names a figure and a figure that decrements with a button press
 * cannot be bound. **The count MUST survive a reload of the setup flow** or the
 * cap is decorative.
 */
export const CANDIDATES_PER_SET = 6;
export const MAX_CANDIDATE_SETS = 10;

/**
 * §7.2's `canonical()`. NORMATIVE, and it applies identically at generation and
 * at every entry — it is the definition of the input, not a re-entry convenience.
 *
 *   canonical(s) = UTF-8( lowercase( collapse_ws( trim( NFC(s) ) ) ) )
 *
 * ⚠️⚠️ Without this the phrase fails on the day it is created, inside a single
 * implementation, with no attacker: setup hashes the string it is displaying,
 * first unlock goes through the re-entry path, which normalises. Different `P`,
 * different `K_master`, different `roster_id`, and a 404 that the client may
 * render as a new user. The channels are gone.
 *
 * ⚠️ `toLowerCase`, never `toLocaleLowerCase`. In a Turkish locale the latter maps
 * "I" to "ı", so the same phrase typed on two devices would produce two different
 * keys — the platform-dependent failure this function exists to prevent, reached
 * through the function itself.
 */
export function canonical(s) {
  if (typeof s !== "string") throw new TypeError("canonical: expected a string");
  return utf8Bytes(s.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase());
}

/** The canonical phrase as text — for display and comparison, never for hashing. */
export function canonicalText(s) {
  return s.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase();
}

/**
 * §7.2: `salt = SHA256("lpm-roster-salt-v1" || P)`.
 *
 * ⚠️ The deterministic salt is a deliberate trade. A random per-user salt would be
 * unfindable on a new device without an account; the cost is that identical
 * passphrases produce identical `roster_id`s, and that because the salt is a
 * function of the secret it salts, **there is functionally no salt: a guess yields
 * its own salt**. Anyone who obtains the blob *or the identifier* — server
 * compromise, compelled disclosure, a dishonest operator — has a fully offline
 * attack with no rate limit we can impose. At §7.4's generated ~77 bits that is
 * not a concern at any plausible scale. It is a concern the moment either number
 * moves.
 */
export async function rosterSalt(canonicalPassphrase) {
  return sha256(concat(asciiBytes(INFO_ROSTER_SALT), canonicalPassphrase));
}

/**
 * The Argon2id slot.
 *
 * Argon2id is not a WebCrypto algorithm, so it arrives from WASM — and that WASM
 * is not built yet (ROADMAP step 7, "Passphrase flow, Argon2id, roster blob").
 * Everything on either side of it is implemented and tested here: `canonical()`,
 * the salt, and every derivation that follows `K_master`. This is the seam, and
 * it is deliberately a named error rather than a silent stub.
 *
 * The implementation must satisfy: argon2id(passwordBytes, saltBytes, params) →
 * 32 bytes, with ARGON2_PARAMS above. D-034 measured 1.17 s on a decade-old
 * Android at these settings.
 */
let argon2id = null;

export function installArgon2id(fn) {
  argon2id = fn;
}

export function argon2idAvailable() {
  return argon2id !== null;
}

/** §7.2: `K_master = Argon2id(P, salt, m=128MiB, t=3, p=1, out=32)`. */
export async function deriveMaster(passphrase) {
  if (!argon2id) {
    throw new Error(
      "Argon2id is not installed. PROTOCOL.md §7.2 derives K_master with it and there is " +
        "no substitute — installArgon2id() must be called with the WASM implementation first."
    );
  }
  const P = canonical(passphrase);
  const salt = await rosterSalt(P);
  const out = await argon2id(P, salt, ARGON2_PARAMS);
  return expectLength(out, 32, "K_master");
}

/**
 * §7.2:
 *   roster_id   = HKDF(K_master, "lpm-roster-id-v1", 16)
 *   roster_key  = HKDF(K_master, "lpm-roster-key-v1", 32)
 *   roster_auth = Ed25519_keypair_from_seed(HKDF(K_master, "lpm-roster-auth-v1", 32))
 *   local_key   = HKDF(K_master, "lpm-local-key-v1", 32)          ← 0.8.11, see below
 *   pickle_key  = HKDF(K_master, "lpm-pickle-key-v1", 32)         ← 0.8.11, §6.1
 *
 * ⚠️ `roster_id` is one HKDF away from `K_master`, so it CONFIRMS a candidate
 * passphrase without the blob at all — and it is the primary key, present in every
 * index, every backup and every partial dump. The exposure is the column, not just
 * the object. Nothing here can fix that; it is why §7.4's floor is not negotiable.
 *
 * ⚠️⚠️ `local_key` IS NEW, AND IT IS NEW BECAUSE THE SPECIFICATION REQUIRED THE
 * ENCRYPTION WITHOUT EVER NAMING THE KEY. `ARCHITECTURE.md` §4.1 says "IndexedDB,
 * encrypted" of the Olm session state, of stored messages and of outbound delivery
 * state; §7.2 derived exactly three values and none of them is for this. An
 * implementer therefore encrypts under `roster_key` (reusing the key that protects
 * a server-held object for a different plaintext), or generates a random key and
 * stores it beside the ciphertext — which is not encryption at all, and is the
 * answer that looks most like it works. The row that pays for the difference is
 * "device theft, locked": `K_master` is memory-only, so a key derived from it makes
 * the stored ratchet unreadable on a device that is not unlocked, and a key stored
 * next to the data does not. (ROADMAP step 8; the eighth hole, PROTOCOL.md 0.8.11.)
 *
 * The Ghost-mode exception is §7.6's and it is deliberate: Ghost has no
 * `K_master`, so it has no `local_key` and writes nothing this could protect —
 * which is exactly why §7.6 confines it to `sessionStorage` and nowhere else.
 *
 * ⚠️ `pickle_key` is separate from `local_key` for one narrow reason: the Olm
 * pickle is sealed by vodozemac's construction and the record around it by §0.2's
 * AES-GCM, and two constructions under one key share an IV space that nobody
 * analysed together. One HKDF removes the question. It is NOT a second line of
 * defence — both keys fall to the same passphrase and the same unlocked device,
 * and `storage/sessions.js` is the file that says what a pickle key may not be.
 */
export async function deriveRosterKeys(kMaster) {
  expectLength(kMaster, 32, "K_master");
  const [rosterId, rosterKey, authSeed, localKey, pickleKey] = await Promise.all([
    hkdf(kMaster, INFO_ROSTER_ID, 16),
    hkdf(kMaster, INFO_ROSTER_KEY, 32),
    hkdf(kMaster, INFO_ROSTER_AUTH, 32),
    hkdf(kMaster, INFO_LOCAL_KEY, 32),
    hkdf(kMaster, INFO_PICKLE_KEY, 32),
  ]);
  return { rosterId, rosterKey, rosterAuth: await ed25519.keyPairFromSeed(authSeed), localKey, pickleKey };
}

/**
 * §7.4: generate a phrase. All randomness from crypto.getRandomValues, word
 * indices drawn by rejection sampling.
 *
 * The result is "exactly its words joined by single U+0020 and nothing else"
 * (§7.2) — chunking for display is presentation only and MUST NOT reach
 * `canonical()`, and neither may a trailing newline, a non-breaking space, or any
 * separator a layout introduced.
 *
 * Words repeat: the draw is with replacement, which is what makes the entropy
 * exactly `words × log2(1296)`. A "no duplicates" rule would lower it and read as
 * a strengthening.
 */
export function generatePhrase(words = PHRASE_WORDS) {
  if (words !== PHRASE_WORDS && words !== PHRASE_WORDS_LONG) {
    throw new RangeError(`generatePhrase: §7.4 offers ${PHRASE_WORDS} or ${PHRASE_WORDS_LONG} words, not ${words}`);
  }
  const out = [];
  for (let i = 0; i < words; i++) out.push(WORDLIST[randomIndex(WORDLIST.length)]);
  return out.join(" ");
}

/**
 * One set of candidates (§7.4). The caller shows all six, uses the chosen one,
 * and discards the other five **and the index of the choice** — never transmitted,
 * never logged. Choosing 1 of N uniformly generated phrases costs exactly log2(N)
 * bits of min-entropy in the worst case, and that is the 5.91 already deducted.
 */
export function generateCandidates(words = PHRASE_WORDS, count = CANDIDATES_PER_SET) {
  return Array.from({ length: count }, () => generatePhrase(words));
}

/**
 * Is what the user typed the phrase we generated? Compared after `canonical()`,
 * because that is the only form that reaches either hash.
 *
 * §7.4 requires a full retype before the flow continues — a wallet-style spot
 * check of 2 words out of 8 catches a single transcription error only 25% of the
 * time. And a PASTED confirmation confirms nothing: the retype exists to establish
 * that a copy of the phrase exists outside this browser tab, which typing is
 * evidence of and pasting is not. Detecting the paste is the caller's job (a
 * `paste` event on the field); it changes what is said next and blocks nothing.
 */
export function phraseMatches(generated, typed) {
  return canonicalText(generated) === canonicalText(typed);
}
