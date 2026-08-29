// The roster against the live server — PROTOCOL.md §7.2, §7.3, ROADMAP step 7.
//
// `protocol/passphrase.js` derives the keys and `protocol/roster.js` seals,
// merges and judges freshness; all of that is pure and anchored to vectors. This
// file holds what those two cannot: WHEN the server is allowed to hear from this
// identity at all, and what happens when two devices write.
//
//   §7.3.3  five occasions, and no others
//   §7.3.1  compare-and-swap, 409, merge, retry
//   §7.3.2  the freshness high-water mark, and the mismatch warning
//   §7.2    "set up a new identity" and "enter an existing phrase" are DIFFERENT
//
// ⚠️⚠️ `roster_id` IS A PERMANENT JOIN KEY AND THIS FILE IS WHERE THAT IS EITHER
// RESPECTED OR NOT (§7.3.3). It is presented on every roster read and write, from
// every device, for as long as the identity exists — and a client cannot poll any
// mailbox before decrypting the roster, so an honest-but-logging server sees, on
// one connection: *roster_id X fetched the roster, then polled mailboxes M₁…Mₙ*.
// Next epoch every mailbox identifier rotates, and the next roster read re-links
// the entire new set. §4 spends its design effort rotating those identifiers and
// §9.1 turns down a cheaper proof-of-work specifically to protect cross-epoch
// unlinkability; this identifier is what all of it hangs from.
//
// **The mitigation is behavioural and it is the whole of the gain**: the roster is
// cached locally, and `roster_id` is touched NEVER on launch and NEVER on a
// schedule. The difference between "every launch" and "a handful of times ever" is
// the difference between a daily behavioural signal and a rare one, and it costs
// nothing. `touch()` below makes that rule executable rather than documentary: a
// reason that is not one of §7.3.3's five is refused here, not reviewed later.
//
// ⚠️ THE LOCAL CACHE HOLDS CIPHERTEXT, NEVER PLAINTEXT. The decrypted channel
// roots exist only in the unlocked session. An earlier draft of §7.3.3 said the
// client "caches the decrypted roster locally", which implemented literally puts
// every `R` on disk in the clear — a stolen locked device or a copied browser
// profile then yields the full §6.2 consequences of root compromise WITHOUT the
// passphrase, bypassing §11's locked-device row entirely.

import { b64uDecode, b64uEncode } from "../crypto/b64u.js";
import { CONVERSATION, DURABLE } from "../storage/db.js";
import { identityDigest } from "../storage/vault.js";
import * as epochs from "../protocol/epoch.js";
import * as passphrase from "../protocol/passphrase.js";
import * as rosters from "../protocol/roster.js";
import * as signing from "../protocol/signing.js";
import * as pow from "../protocol/pow.js";
import { PAIRING_TTL_SECONDS } from "../protocol/pairing.js";
import { sha256 } from "../crypto/hash.js";

/**
 * A roster operation that did not complete.
 *
 *   not_found       no roster under this identifier. ⚠️ ON AN UNLOCK THIS MEANS
 *                   THE PHRASE IS WRONG, and §7.2 requires it to be rendered as a
 *                   retry — never as a successful new setup. The natural
 *                   implementation creates a roster here, and the user sees an
 *                   empty app, owns two identities, and is told nothing
 *   identity_exists a create found one already there. The mirror of the above:
 *                   the phrase is right and this was the wrong intention
 *   stale           §7.3.2: the server served a roster older than one this device
 *                   has already seen. Refused
 *   conflict        §7.3.1's compare-and-swap kept failing. Another device is
 *                   writing, or the server is refusing every version
 *   roster_full     §7.3's 64 KiB ceiling. No more channels, and tombstones may
 *                   not be dropped to make room (§7.3.1a)
 *   access_rule     a caller asked to touch `roster_id` for a reason §7.3.3 does
 *                   not list, or asked to check for changes more than hourly
 *   clock_skew      §5.2, as everywhere: this device's clock is more than 60
 *                   seconds out, so every signed request fails
 *   unauthorized    a 401 the clock does not explain. For a roster this is the
 *                   stored-key check: the identifier exists under another key
 *   rate_limited    §9.2. On a MISS this is the anti-guessing bucket, shared with
 *                   everyone behind this address
 *   storage_full    §9.3: the server is at its ceiling and refuses new writes
 *   server_state    anything else the server refused
 */
export class RosterFailure extends Error {
  constructor(reason, message, cause, skew) {
    super(message);
    this.name = "RosterFailure";
    this.reason = reason;
    this.cause = cause;
    // ⚠️⚠️ D-152 — §5.2's OFFSET IS A NUMBER HERE AND A SENTENCE IN `ui/copy.js`.
    // This used to build the English itself, and `flow/mailbox.js` built the same
    // English again, byte for byte — the only prose in the product outside the copy
    // gate, in two copies. `skew` is the measured offset in seconds and nothing else.
    if (skew !== undefined) this.skew = skew;
  }
}

/**
 * §7.3.3's five occasions, spelled out so that a caller has to name one.
 *
 * ⚠️ CASE 5 IS NOT OPTIONAL AND IS NOT A CONVENIENCE. §7.3.1's merge machinery
 * presupposes that devices read each other's writes, and cases 1–4 alone mean a
 * device that never adds or removes a channel never learns of any change made
 * anywhere else — including a deletion, which is the one change that most needs
 * to arrive. Either multi-device state converges or the access rule is wrong.
 */
export const SETUP = "setup"; // 1. the first read or the first write
export const CHANNEL_CHANGE = "channel_change"; // 2. a channel added or removed
export const GENERATION_CHANGE = "generation_change"; // 3. §6.3's counter rose
export const CONFLICT_REFETCH = "conflict_refetch"; // 4. the 409 refetch
export const USER_CHECK = "user_check"; // 5. "check for changes made elsewhere"
// 6 and 7, added 0.9.31 with §3.4.1c (D-174). ⚠️ BOTH ARE DISCLOSED WIDENINGS of the
// access rule, in the same terms case 3 was — and both are USER-INITIATED, which is
// the property every other case here shares. Neither is on launch and neither is on a
// schedule, so §7.3.3's actual promise is untouched. Polling remains forbidden.
export const INVITE_CREATED = "invite_created"; // 6. a link was made (§3.4.1c rule 5)
export const LINK_OPENED = "link_opened"; // 7. a link this device cannot place was opened

const OCCASIONS = new Set([
  SETUP,
  CHANNEL_CHANGE,
  GENERATION_CHANGE,
  CONFLICT_REFETCH,
  USER_CHECK,
  INVITE_CREATED,
  LINK_OPENED,
]);

/** §7.3.3 case 5: "rate-limited to at most one per hour". */
export const USER_CHECK_INTERVAL_S = 3600;

/** §7.3.1: how many times a 409 is worth merging and retrying before giving up. */
export const MAX_CAS_ATTEMPTS = 4;

/**
 * Derive everything a passphrase yields (§7.2). No network, no storage.
 *
 * ⚠️ This is the expensive call in the product — Argon2id at 128 MiB, measured at
 * 1.17 s on a decade-old Android (D-034) — and where WebAuthn PRF is unavailable
 * it runs on EVERY unlock, not once per device (§7.5). Callers should say so on
 * screen before starting it rather than appear to have frozen.
 */
export async function identity(phrase) {
  const kMaster = await passphrase.deriveMaster(phrase);
  const keys = await passphrase.deriveRosterKeys(kMaster);
  // `K_master` has done its work. §7.7 is honest about what this is worth in
  // JavaScript — the garbage-collected copies persist — but the buffer we hold is
  // a `Uint8Array`, and overwriting it is a real write.
  kMaster.fill(0);
  return keys;
}

/**
 * Open the roster for an identity. Nothing here touches the network.
 *
 * `storage` holds the fetched CIPHERTEXT and the outer counter that came with it.
 * `durable` holds §7.3.2's high-water mark. Both speak `storage/vault.js`'s
 * interface — `get`, `set`, `delete`, values JSON-able, everything async.
 *
 * ⚠️⚠️ `durable` IS REQUIRED AND HAS NO DEFAULT, WHICH IS §7.8's RULE IN THE
 * SIGNATURE. The ordinary ending clears conversation state and MUST leave the
 * high-water mark, because a client with nothing local to compare against is
 * exactly the precondition §7.3.2's rollback attack needs — and a defaulted
 * `durable = storage` would mean an app that never thought about it clears both
 * and manufactures that precondition every time somebody presses "end".
 *
 * `onDisappeared({ kind, removed })` is §7.3.1a: it fires when adopting a roster
 * takes channels away from this device, and the three kinds decide what may be
 * done about it — `purged` immediately and irreversibly, `deletion` permanently
 * with no undo, `suspect` into the 7-day quarantine. It is awaited before the
 * fetch returns, because a client that rendered the new list first would have
 * shown the user their conversations gone before deciding whether to keep them.
 */
export function openRoster({
  api,
  keys,
  storage,
  durable,
  unixSeconds = () => epochs.nowSeconds(),
  onDisappeared = async () => {},
}) {
  if (!durable) {
    throw new RangeError(
      "openRoster: `durable` is required — §7.3.2's high-water mark must survive §7.8's ordinary ending, " +
        "so it cannot live in the store that ending clears"
    );
  }
  const key = storageKeyPromise(keys.rosterId);
  let roster = null; // the decrypted roster, only while unlocked
  let outer = null; // the server's compare-and-swap counter as last seen
  let size = rosters.ROSTER_SIZE; // §7.3's one-way growth
  let lastUserCheck = 0;
  let lastFreshness = null;
  // ⚠️⚠️ D-168 — IS `roster.version` EVIDENCE ABOUT WHO WROTE? It is, for as long as this
  // document has been a client without interruption: every rise it caused is here, so a
  // rise it did not cause came from somewhere else. A document that STOPPED being a client
  // — §4.2.2's `dormant`, which touches nothing and so cannot refresh — slept through an
  // interval it has no evidence about, and the honest answer for the first read after it
  // wakes is to say nothing. Measured, not reasoned: `~/lpm-probes/probe-elsewhere-tabs.mjs`
  // fired the notice on a same-browser takeover, where the sentence would have named a
  // browser and a device for what was a tab — and §4.2.2 had already handled that case
  // properly, with a control.
  //
  // ⚠️ THIS FLAG IS NOT THE BASELINE, IT IS PERMISSION TO USE ONE. Round 2 gave `adopt()`
  // a second baseline that outlives the session — §7.3.2's high-water mark, on disk — so
  // "no baseline in memory" and "no evidence at all" stopped being the same state. A
  // dormant document is still the second one, and this is what says so: it slept through
  // an interval, and no number on disk covers an interval it did not watch.
  let baselineTrusted = true;
  const warnings = [];

  /**
   * §7.3.3's access rule, as code.
   *
   * Every network call in this file goes through here, and the reason is a value
   * rather than a comment. Case 5 additionally carries its own interval, because
   * "rate-limited to at most one per hour" is a rule about a button somebody can
   * press repeatedly.
   */
  function touch(reason) {
    if (!OCCASIONS.has(reason)) {
      throw new RosterFailure(
        "access_rule",
        `§7.3.3 lists five occasions for touching roster_id and ${JSON.stringify(reason)} is not one of them`
      );
    }
    if (reason === USER_CHECK) {
      const now = unixSeconds();
      if (now - lastUserCheck < USER_CHECK_INTERVAL_S) {
        throw new RosterFailure("access_rule", "§7.3.3 allows one check for changes per hour");
      }
      lastUserCheck = now;
    }
  }

  // ------------------------------------------------------------ the network

  async function call(method, value, reason) {
    touch(reason);
    const path = `/api/roster/${b64uEncode(keys.rosterId)}`;
    const bodyBytes = value === undefined ? undefined : signing.encodeBody(value);
    const { authorization } = await signing.signRequest(keys.rosterAuth.privateKey, {
      tag: signing.TAG_ROSTER,
      method,
      path,
      id: keys.rosterId,
      timestamp: epochs.nowSeconds(),
      nonce: signing.newNonce(),
      body: bodyBytes,
      publicKey: keys.rosterAuth.publicKey,
    });
    try {
      return await api.signed(method, path, { bodyBytes, authorization });
    } catch (err) {
      throw describeFailure(err);
    }
  }

  /** Fetch, decrypt, judge freshness, and adopt. */
  async function fetch(reason) {
    const res = await call("GET", undefined, reason);
    return adopt(b64uDecode(res.blob, "roster blob"), res.version);
  }

  async function adopt(blob, outerVersion) {
    const opened = await rosters.openRoster(keys.rosterKey, blob);
    const hwm = await highWaterMark();
    const state = rosters.freshness({ inner: opened.roster.version, outer: outerVersion, highWaterMark: hwm });
    lastFreshness = state;

    if (state.state === "stale") {
      // §7.3.2 rule 2. The blob is authentic and OLD, which is the
      // downgrade-to-re-pair primitive: a channel silently disappears, it looks
      // like "the app forgot my chat", and the user re-pairs over whatever channel
      // they used the first time — which in the scenario §3.6 exists for may be
      // the one the attacker controls.
      throw new RosterFailure(
        "stale",
        `the server returned an older roster (version ${state.inner}) than this device has already seen ` +
          `(${state.highWaterMark})`
      );
    }
    if (state.state === "mismatch") {
      // §7.3.2 rule 3: surfaced in the same register as §3.5's tripwire, and NOT
      // a refusal — the blob authenticated, so the content is genuine; what is
      // wrong is the server's account of it.
      warnings.push({ kind: "version_mismatch", inner: state.inner, outer: state.outer });
    }

    // ⚠️⚠️ D-168 — THE ONE THING THIS CLIENT CAN OBSERVE ABOUT A SECOND HOLDER OF THE
    // KEY, and it is observed HERE because this is the only number in the system that
    // another device raises and this one can check. §7.3.1's compare-and-swap is the
    // usual way it is met — a 409, whose refetch comes back through this function — but
    // the same evidence arrives on any read: §7.3.3 case 5's "check for changes" reaches
    // it without writing anything, and so does the fetch that follows a channel change.
    //
    // ⚠️ IT IS THE INNER VERSION AND IT HAS TO BE. The outer counter is the SERVER's, and
    // a server that wanted this notice to appear could raise it for nothing; the inner one
    // lives inside the sealed blob, so raising it needs `rosterKey`, which comes from the
    // KEY. §7.3.2's mismatch warning is what covers the two disagreeing, and it is raised
    // above — this is a different question about a different number.
    //
    // ⚠️⚠️ AND EVERY WORD `ui/copy.js` SPENDS ON IT IS BOUNDED BY WHAT THIS LINE KNOWS.
    // It is an EVENT and never a presence: it fires when the other device WRITES, so a
    // second device that has only ever read is invisible to it, and it is always AFTER the
    // fact. Silence here is therefore not evidence of a single device — a hostile server
    // can simply keep serving the old blob. It cannot usefully FAKE one, because the blob
    // is authenticated and §7.3.2's high-water mark refuses a roster older than one already
    // seen; withholding is the whole of what it can do.
    //
    // ⭐ THAT IS WHY NOTHING IN THIS PRODUCT SAYS "no other device is using this KEY".
    // D-045 puts concurrent multi-device out of scope and §7.3.1 cannot enforce it; a
    // client saying what it saw is all that is left, and a client claiming the absence of
    // what it cannot see would be the one thing worse than saying nothing.
    // ⚠️⚠️ D-168 ROUND 2 — THE BASELINE SURVIVES THE LOCK, BECAUSE §7.3.2's HIGH-WATER
    // MARK DOES. `roster` is memory, so it is `null` on the first read of every session,
    // and the first read of a session is exactly the read most likely to be carrying
    // another device's work: the person locked this device, the other one wrote while
    // nobody was looking, and this one comes back and fetches. Comparing against memory
    // alone, that read is the one read that can never say anything — which is what Hannu
    // measured on 2026-08-27: *"the panel came only in the first try and stayed until I
    // removed the key but did not come anymore."* Removing the KEY is §7.8's ordinary
    // ending; it clears the cached blob and the baseline went with it.
    //
    // ⭐ THE NUMBER WAS ALREADY ON THIS DEVICE'S DISK, IN THE ONE STORE THAT ENDING DOES
    // NOT CLEAR. `hwm` is the highest inner version this device has ever adopted, and
    // §7.3.2 keeps it in `DURABLE` precisely so that locking cannot erase what this device
    // has seen. Every version this device itself produced went through `remember()` on the
    // way (see `write()`'s success path), so `hwm` is an upper bound on this device's own
    // work — and a fetched version above it is a version this device did not make.
    //
    // ⚠️ IT IS THE SAME CLAIM, NOT A WIDER ONE. Memory and the high-water mark answer the
    // same question — "is this higher than anything I have seen?" — over different spans,
    // and the sentence in `ui/copy.js` is bounded by that question either way. Nothing
    // here fetches: §7.3.3's five occasions are untouched, which is what keeps this a
    // comparison and not the polling D-168 ruled out permanently.
    //
    // ⚠️⚠️ AND THE FALSE POSITIVE THAT COMES WITH IT IS CLOSED BELOW, NOT ACCEPTED. It was
    // written down here as *"a crash window and not a routine one"* for about an hour, and
    // Hannu's device answered that: he met it on a browser holding a KEY nobody else held.
    // ➡️ **A WINDOW IS NOT RARE BECAUSE IT IS SMALL — IT IS RARE OR NOT ACCORDING TO WHAT
    // ELSE HAPPENS IN IT**, and what happens in this one is a phone freezing a background
    // tab (§4.2.3, measured) and a response that does not come back.
    //
    // ⚠️⚠️ AND THE SECOND CLAUSE OF THE RULE, WHICH THE CLIENT COULD NOT CHECK UNTIL NOW.
    // *"…rise above the highest it has adopted, WITHOUT HAVING RAISED IT"* — and "raised
    // it" is not the same as "recorded it". The mark below is written AFTER the server
    // accepts a write, because §7.3.2 rule 2 forbids recording a version this device has
    // not decrypted; a device killed in that window has raised a version it never wrote
    // down, and every later read finds it and calls it somebody else's.
    //
    // ⭐⭐ NOT A NARROW WINDOW ON THIS PRODUCT. ARCHITECTURE §4.2.3's measured hazard is
    // precisely a store operation caught in flight when a phone freezes a background tab,
    // and a lost response does it just as well. Hannu hit it on a browser holding a KEY
    // NOBODY ELSE HELD (2026-08-27) — the alarm named another browser and another device
    // for his own interrupted write.
    //
    // ⚠️ IT IS THE BLOB AND NOT THE NUMBER, and it has to be. Comparing version numbers
    // would suppress a REAL second device whose write happens to carry the number this
    // device also attempted — a false silence, which D-168 rules is the worse of the two
    // errors. Two devices cannot produce the same sealed bytes: `sealRoster` picks a fresh
    // nonce, so "these are the bytes I sent" is an exact answer and never an approximate
    // one. What is stored is a SHA-256 prefix of them, never the blob.
    const baseline = roster ? roster.version : hwm;

    // ⭐⭐⭐⭐⭐ WHICH BASELINE ANSWERED DECIDES WHICH SENTENCE IS TRUE, AND THE TERNARY
    // ABOVE ALREADY KNOWS. `roster` is memory, so a baseline taken from it means this
    // document was open and reading across the whole span: the other place wrote while the
    // person was sitting here, seconds ago, and a present tense is a fair reading of that.
    // `hwm` is on disk with NO CLOCK BESIDE IT — "the highest version this device has EVER
    // adopted" — so a baseline taken from it spans everything since this browser last
    // looked, which may be days.
    //
    // ⚠️⚠️ `ui/copy.js` HAD THIS RIGHT IN A COMMENT AND WRONG IN THE SENTENCE UNDER IT.
    // *"The evidence is an event and not a presence"*, it says, and then hedges with
    // *"while that lasts"* — which bounds the CONSEQUENCE and leaves *"your KEY is in
    // use"*, a present tense, unbounded. Hannu met the difference on 2026-08-29: a write
    // his own second browser made 48 hours earlier, reported as something happening now,
    // carrying advice he could not act on because he was already following it.
    //
    // ⚠️ THE SEVERITY IS NOT WHAT WAS WRONG. Both spans stay alarms: an unexplained write
    // is not less serious for being two days old — if anything the person is further from
    // being able to explain it. Only the claim narrows.
    const span = roster ? "watched" : "away";

    if (baseline !== null && baselineTrusted && opened.roster.version > baseline && !(await isOurAttempt(blob))) {
      warnings.push({ kind: "elsewhere", version: opened.roster.version, span });
    }

    // §7.3.1a, and it is asked HERE because this is the only place a device sees
    // another device's deletions. The merge below runs on a 409, which is a write
    // this device chose to make; a channel disappearing is something that happened
    // to it, and the difference is the whole of §7.3.1a's three answers.
    const change = await rosters.whatDisappeared(roster, opened.roster);

    if (change.vanished?.length) {
      // No tombstone explains these, and §7.3.1's rules cannot produce it from an
      // honest server. §7.3.2's rollback is refused above when the high-water mark
      // catches it; this is what is left when it cannot.
      warnings.push({ kind: "unexplained_removal", count: change.vanished.length });
    }

    // ⚠️⚠️ BEFORE `remember()`, AND THAT ORDER IS THE WHOLE VALUE OF THE
    // QUARANTINE. §5.4.3 states the rule for messages — persist before you
    // acknowledge — and this is the same rule about a different object: cache the
    // roster that no longer has these channels, crash, and the device comes back
    // with the deletion adopted, the entries never held, and no undo and no notice
    // for the case §7.3.1a says is "almost certainly a bug". Holding first costs a
    // duplicate hold if the crash lands the other way, and `hold()` is written to
    // make that harmless.
    if (change.kind !== "none") await onDisappeared(change);

    roster = opened.roster;
    outer = outerVersion;
    size = opened.size;
    // D-168: whatever this device did or did not see before, it has just read the current
    // roster, so from here the comparison above is evidence again.
    baselineTrusted = true;
    await remember(blob, outerVersion, opened.roster.version);
    return roster;
  }

  // ------------------------------------------------------------ the storage

  async function remember(blob, outerVersion, innerVersion) {
    const k = await key;
    await storage.set(`${k}.blob`, { blob: b64uEncode(blob), outer: outerVersion });
    // §7.3.2 rule 2: the high-water mark is written only after the blob decrypts.
    const previous = await highWaterMark();
    if (previous === null || innerVersion > previous) await durable.set(`${k}.hwm`, innerVersion);
  }

  /**
   * The bytes this device last SENT, so that meeting them again is not a discovery.
   *
   * ⚠️⚠️ IT GOES IN `DURABLE` AND IT HAS TO. §7.8's ordinary ending clears the cached
   * roster, and the read that follows one is exactly the read this answers — the person
   * removed their KEY, typed it back, and the first fetch is the whole of what the device
   * knows. A record in `CONVERSATION` would be swept away by the act that needs it.
   *
   * ⚠️ WRITTEN BEFORE THE `PUT` AND NEVER AFTER. After is where §7.3.2's mark lives and
   * why it cannot answer this: the point is to survive the gap between the server
   * accepting the write and this device hearing that it did.
   *
   * ⚠️ A PREFIX, NOT THE BLOB. This is a note to ourselves about our own ciphertext; the
   * ciphertext itself already has a home in `CONVERSATION` under `local_key`, and there is
   * no reason for a second copy of it to sit in the store the ending may not clear.
   */
  async function recordAttempt(blob) {
    await durable.set(`${await key}.sent`, await fingerprint(blob));
  }

  async function isOurAttempt(blob) {
    const sent = readable(await durable.attempt(`${await key}.sent`), "sent");
    return typeof sent === "string" && sent === (await fingerprint(blob));
  }

  async function highWaterMark() {
    const n = readable(await durable.attempt(`${await key}.hwm`), "hwm");
    return Number.isSafeInteger(n) && n >= 0 ? n : null;
  }

  /**
   * ⛔⛔ A RECORD IN `DURABLE` THAT WILL NOT OPEN IS NOT AN ABSENT RECORD, AND THE
   * WHOLE OF §7.3.2 TURNS ON THE DIFFERENCE (D-170).
   *
   * "A device unlocking with no local history has no high-water mark, which is
   * exactly where the attack aims" — the section says so itself. So a client that
   * met an unreadable mark and read it as *no mark* would not be recovering from a
   * damaged record; it would be **manufacturing the one precondition the rollback
   * attack needs**, quietly, on the unlock path, every time.
   *
   * ⚠️ FAILING CLOSED IS THEREFORE RIGHT AND WAS ALREADY WHAT HAPPENED. What was
   * wrong is that it arrived as a bare `OperationError` from WebCrypto and reached
   * the person as *"Something went wrong, and this device could not say what"* — a
   * sentence that is correct for a user and a dead end for the report. It now has a
   * reason, so `ui/copy.js` can say which thing is damaged and `app.js` can offer
   * the one way out, and `which` reaches the diagnostics row so the NEXT occurrence
   * arrives as evidence rather than as a mystery.
   *
   * ⚠️ THE ROSTER CACHE IS DELIBERATELY NOT ROUTED THROUGH HERE. It is a copy of
   * something the server still holds; treating it as absent costs one fetch and no
   * safety, and `load()` below says so at the one place that decides it.
   */
  function readable(record, which) {
    if (record.found && !record.ours) {
      const failure = new RosterFailure(
        "record_unreadable",
        `§7.3.2: this device's ${which} record will not open under its own local_key, and a mark ` +
          `that cannot be read may not be treated as a mark that is absent`
      );
      // ⚠️ WHICH RECORD, ON THE DIAGNOSTICS ROW AND NOT IN THE SENTENCE (D-085,
      // D-170). Hannu's Firefox reading said `OperationError ×1` and there was no
      // way to get from it to a record; the panel is what a tester reads out, and
      // two more characters on it is the difference between a report and a mystery.
      failure.which = which;
      throw failure;
    }
    return record.value;
  }

  // -------------------------------------------------------------- the writes

  /**
   * §7.3.1's compare-and-swap, with the 409 loop.
   *
   * `mutate(roster)` returns the roster it wants written. It runs again after
   * every merge, against the merged state — so it must be a function of what it
   * is given and must not close over an earlier copy. That is what makes a retry
   * correct rather than a second chance to write stale data.
   */
  async function write(mutate, reason) {
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
      // ⚠️ `mutate` MAY BE ASYNC, and one of them has to be: §7.3.1a's panic wipe
      // tombstones every channel, and a tombstone is a `root_hash` — which is a
      // SHA-256, which is a promise in WebCrypto. Awaiting a plain value is free,
      // so the sync callers below are unaffected.
      const next = rosters.pruneInvites(
        await mutate(structuredClone(current())),
        unixSeconds(),
        PAIRING_TTL_SECONDS
      );
      next.version = current().version + 1;
      next.written_at = unixSeconds();

      let sealed;
      try {
        sealed = await rosters.sealRoster(keys.rosterKey, next, { currentSize: size });
      } catch (err) {
        // §7.3: at the 64 KiB limit the client refuses further channel additions
        // and says so. Dropping old tombstones to make room is not permitted.
        throw new RosterFailure("roster_full", err.message, err);
      }

      // ⚠️ BEFORE THE REQUEST LEAVES, because the whole failure this closes is the
      // request arriving and the answer not coming back.
      await recordAttempt(sealed.blob);

      try {
        const res = await call("PUT", { if_match: outer, blob: b64uEncode(sealed.blob) }, reason);
        roster = next;
        outer = res.version;
        size = sealed.size;
        // D-168: a PUT only succeeds when `if_match` was current, so this device's own
        // version is the server's — the baseline is established by the write itself.
        baselineTrusted = true;
        await remember(sealed.blob, res.version, next.version);
        return roster;
      } catch (err) {
        if (err?.reason !== "conflict") throw err;
        // Somebody else wrote. §7.3.1: re-fetch, merge, retry — and the merge is
        // ours to do because the server cannot read either blob.
        const theirs = await fetch(CONFLICT_REFETCH);
        const merged = await rosters.mergeRosters(next, theirs);
        warnings.push(...merged.warnings);
        roster = merged.roster;
        reason = CONFLICT_REFETCH;
      }
    }
    throw new RosterFailure("conflict", `the roster changed under ${MAX_CAS_ATTEMPTS} attempts to write it`);
  }

  function current() {
    if (!roster) throw new RosterFailure("access_rule", "the roster is not open: call create() or load() first");
    return roster;
  }

  // ---------------------------------------------------------------- the API

  // ⚠️ NAMED RATHER THAN RETURNED ANONYMOUSLY: `this` inside an object literal is
  // whatever the call site happened to keep, and a method that works until somebody
  // destructures it is a defect with a delay on it. Nothing inside reaches through it
  // today — `recogniseLink` did until it was corrected to call `fetch` directly — and
  // the shape stays because the next method to need a sibling should not have to decide
  // this again.
  const self = {
    rosterId: keys.rosterId,

    /** The decrypted roster, or null while locked. */
    get roster() {
      return roster;
    },
    get outerVersion() {
      return outer;
    },
    get freshness() {
      return lastFreshness;
    },
    /**
     * §3.5-register things the interface should say. Drained by the caller.
     *
     *   version_mismatch    §7.3.2 rule 3: the server's counter and the blob's disagree
     *   unexplained_removal §7.3.1a: channels gone with no tombstone to explain them
     *   role_conflict       §7.3.1 rule 2, from `protocol/roster.js`'s merge
     *   name_unresolved     §7.3.1 rule 4, from the same merge
     *   memo_conflict       §7.3.1 rule 8, from the same merge (§3.4.1c, 0.9.31)
     *   elsewhere           D-168: the sealed version rose without this device raising it,
     *                       carrying `span` — `watched` if this document read across the
     *                       whole span, `away` if the baseline came from the clockless mark
     *
     * ⚠️ DRAINING IS THE CALLER'S JOB AND WHERE IT DRAINS IS A DECISION. `app.js` did
     * it on the conversation list alone until D-168, which is the one screen the person
     * is NOT on while the thing `elsewhere` reports is doing its damage.
     */
    takeWarnings() {
      return warnings.splice(0, warnings.length);
    },

    /**
     * D-168 — this document has stopped being a client, so it stops being a witness.
     *
     * ⚠️ ARCHITECTURE §4.2.2's `dormant` document writes nothing and touches `roster_id`
     * not at all, so it cannot keep its copy of the version current. Waking with a stale
     * one and calling the difference "another device" would name a browser and a device
     * for what was, in the case §4.2.2 exists for, the tab next door — and §4.2.2 has
     * already told the person about that one, with a control. The next read is silent and
     * re-establishes the baseline; a genuine second device is caught by the one after it.
     */
    forgetBaseline() {
      baselineTrusted = false;
    },

    /**
     * §7.3.3 case 1, the "set up a new identity" intention.
     *
     * ⚠️ IT IS A DIFFERENT CALL FROM `load()` AND THAT IS §7.2's RULE, not an API
     * style. A mistyped phrase yields a different `K_master`, a different
     * `roster_id` and a 404 — the same response as genuine first use. A client
     * that resolved the ambiguity by creating leaves the user with an empty app,
     * two identities, and no error.
     */
    async create() {
      const fresh = rosters.emptyRoster(unixSeconds());
      const sealed = await rosters.sealRoster(keys.rosterKey, fresh, { currentSize: rosters.ROSTER_SIZE });
      const body = { pow: "", blob: b64uEncode(sealed.blob) };
      // ⚠️ THE SAME NOTE AS `write()`'s, AND IT IS HERE BECAUSE THE RULE IS ABOUT SENDING
      // A BLOB AND NOT ABOUT WHICH METHOD SENDS IT. A create whose response is lost is
      // safe today only because a device with no high-water mark claims nothing — which is
      // an accident of another rule, not this one being obeyed. D-165: a rule kept only
      // where somebody remembered it is not kept.
      await recordAttempt(sealed.blob);
      try {
        // §5.1's two-round-trip dance, as everywhere: ask, and pay only when the
        // server says what it wants. Here the server always wants it, because a
        // create is never idempotent — but the client asking first keeps one shape
        // for every creation path.
        await call("POST", body, SETUP);
      } catch (err) {
        if (err?.cause?.code !== "pow_required") throw err;
        const challenge = await api.powChallenge();
        body.pow = await pow.solve(challenge.challenge, challenge.bits);
        await call("POST", body, SETUP);
      }
      roster = fresh;
      outer = 1;
      size = sealed.size;
      baselineTrusted = true; // D-168: this device made version 1.
      await remember(sealed.blob, 1, fresh.version);
      return roster;
    },

    /**
     * Open the roster. The cache first, the network only if asked (§7.3.3).
     *
     * ⚠️ `network: false` IS THE DEFAULT AND IT IS THE PRIVACY PROPERTY. A launch
     * that fetched would make `roster_id` a daily signal; §7.3.3 permits five
     * occasions and "the app started" is not one of them. A device with a cached
     * blob opens offline, which it must be able to do anyway.
     */
    async load({ network = false, reason = SETUP } = {}) {
      const k = await key;
      // ⚠️⚠️ A CACHED BLOB THAT WILL NOT OPEN IS TREATED AS NO CACHED BLOB, AND THIS IS
      // THE ONE RECORD IN THIS FILE THAT MAY BE (D-170). It is a local copy of
      // something the server still holds, so "absent" is a state this device knows
      // how to be in — it is the state every new device starts in — and the caller
      // above already answers `null` by fetching. §7.3.2's mark is NOT like this and
      // is not treated like it: see `readable()`.
      //
      // ⭐ IT ALSO HEALS. `remember()` writes this record on the next successful
      // fetch, over the row that would not open, so the damage costs one fetch once
      // rather than a fetch on every launch forever.
      const cached = await storage.attempt(`${k}.blob`);
      if (cached.ours && cached.value) {
        return adopt(b64uDecode(cached.value.blob, "cached roster"), Number(cached.value.outer ?? 0));
      }
      if (!network) return null;
      return fetch(reason);
    },

    /**
     * §7.3.3 case 5, and the interface must say plainly that it is a moment the
     * server sees this user. That honesty is the section's own requirement.
     */
    async check() {
      return fetch(USER_CHECK);
    },

    /** Every channel this identity holds, as the interface wants them. */
    channels() {
      return current().channels.map((c) => ({ ...c, rootBytes: b64uDecode(c.root, "channel root") }));
    },

    channel(rootBytes) {
      const root = b64uEncode(rootBytes);
      return current().channels.find((c) => c.root === root) ?? null;
    },

    /**
     * §7.3.3 case 2. `role` is immutable once written (§7.3.1 rule 2).
     *
     * ⚠️ `tripwire` IS TAKEN HERE RATHER THAN SET AFTERWARDS, because §3.5 says
     * *"before or with the roster write that creates the channel"*. A second write
     * would leave a window in which the channel exists and its alarm does not —
     * small, but exactly long enough to be the window a failed write falls into,
     * and it would spend a second §7.3.3 case 2 write on the server for one fact.
     */
    async addChannel({ root, name, role, tripwire = false, linkMemo = null }) {
      const encoded = b64uEncode(root);
      const memo = linkMemo ? b64uEncode(linkMemo) : undefined;
      return write((r) => {
        if (r.channels.some((c) => c.root === encoded)) return r;
        r.channels.push({
          root: encoded,
          name: name ?? "",
          role,
          generation: 0,
          created: unixSeconds(),
          // §3.6.2 rule 1: every channel begins unverified, and a client MUST NOT
          // present one as verified because the pairing succeeded — pairing
          // succeeding is what both of §3.6's attacks look like.
          verified: false,
          // §3.5, carried in from the pairing that produced the evidence — never
          // set later, and never cleared at all.
          tripwire: Boolean(tripwire),
          // §3.4.1c rule 6: written WITH the roster write that creates the channel,
          // never in one of its own. ⚠️ `undefined` and not `null` when there is
          // none — §7.3.1 rule 8 says absent must read as ABSENT, and a null would
          // be a memo that matches nothing while claiming to be known.
          ...(memo ? { link_memo: memo } : {}),
        });
        return r;
      }, CHANNEL_CHANGE);
    },

    /**
     * §3.4.1c rule 5: the invite memo, written BEFORE the offer is published.
     *
     * ⛔⛔ IT IS THE CREATION'S COMMIT POINT, exactly as §6.7.1 rule 1a is the
     * removal's (D-173). A link that exists and is not recorded here is one the
     * maker's own other devices cannot recognise — and that is the state D-174
     * measured, where a second device claimed its owner's own offer, paired the
     * person with themselves, spent the link, and left the friend it was sent to
     * tripping §3.5's alarm at its own owner. **A refusal here MUST abandon the
     * creation**; the caller does not get to publish an offer it could not record.
     */
    async rememberInvite(linkMemo) {
      const memo = b64uEncode(linkMemo);
      return write((r) => {
        const invites = r.invites ?? [];
        if (!invites.some((i) => i.memo === memo)) invites.push({ memo, created: unixSeconds() });
        r.invites = invites;
        return r;
      }, INVITE_CREATED);
    },

    /**
     * §3.4.1c rule 1: is this link one this identity is already a party to?
     *
     * Returns `{ kind: "channel", root }`, `{ kind: "invite" }`, or `null`.
     *
     * ⚠️⚠️ `null` MEANS "LEARNED NOTHING" AND MUST NOT BE READ AS "NOT MINE". It is
     * also the ordinary answer for a first-time joiner, and §3.4.1c rule 4 requires
     * the two stay indistinguishable — the caller falls through to §3.4.1b rule 7 and
     * §3.5 exactly as before.
     *
     * ⚠️ ONE NETWORK READ, AND ONLY WHEN THE CACHED ANSWER IS "NOTHING" (case 7). A
     * link made on the other device AFTER this one unlocked is not in the cached copy,
     * which is the whole case this exists for; a link that already matches needs no
     * read at all. It is bounded by the act — a link the person has just followed —
     * and it is not a schedule.
     */
    async recogniseLink(linkMemo, { network = true } = {}) {
      const memo = b64uEncode(linkMemo);
      // ⚠️ THE EXPIRY IS CHECKED WHERE THE ANSWER IS GIVEN, not only where the blob is
      // pruned. §3.4.1c rule 7 removes an invite entry once it is older than §1's session
      // TTL, and `pruneInvites` only runs on a WRITE — a device that has not written
      // since would otherwise still recognise a link that has been dead for weeks and
      // send its owner to another device to finish something that cannot be finished.
      // A CHANNEL memo has no expiry and must not get one: the conversation outlives
      // the link that made it, which is exactly the distinction rule 7 draws.
      const alive = (i) => i.created + PAIRING_TTL_SECONDS > unixSeconds();
      const look = () => {
        const r = current();
        const channel = r.channels.find((c) => c.link_memo === memo);
        if (channel) return { kind: "channel", root: channel.root };
        if ((r.invites ?? []).some((i) => i.memo === memo && alive(i))) return { kind: "invite" };
        return null;
      };
      const cached = look();
      if (cached || !network) return cached;
      try {
        // ⛔⛔⛔ `fetch` AND NOT `load({ network: true })`, AND THE DIFFERENCE IS THE
        // WHOLE OF CASE 7. `load` returns the CACHED blob whenever there is one and
        // reaches the network only when there is not — which is right for `load` and
        // exactly wrong here. **The case this function exists for is a link made on the
        // other device AFTER this one cached**, so the cached copy is by construction
        // the one that does not have it, and a "network read" that re-reads the cache
        // answers `null` to the only question ever asked of it.
        //
        // ⭐ It read `load({ network: true })` for a day and every check passed, because
        // the only test devices that recognised anything had cached AFTER the write. The
        // two-device order in `test/elsewhere.mjs` is what tells the two apart, and it
        // is the order D-174 actually happens in.
        await fetch(LINK_OPENED);
      } catch {
        // §3.4.1c rule 4: a read that failed has taught this device nothing, which is
        // a state the caller already handles. It must not become a recognition either
        // way — and it must not stop the person opening the link.
        //
        // ⚠️ INCLUDING §7.3.2's `stale` REFUSAL, AND THAT IS §3.4.1c's [server-trust]
        // paragraph exactly: a server serving an old roster can withhold an invite entry
        // and put this device back in the ambiguity §3.4.1c removed. It cannot
        // MANUFACTURE a recognition — the memo is compared against this identity's own
        // sealed copy — and the cached blob is left intact here, so the next read made
        // for any other reason meets §7.3.2's high-water mark and refuses loudly.
        return null;
      }
      return look();
    },

    /**
     * §3.6.2: the user compared the six digits with the person they meant to
     * reach, and they were the same.
     *
     * ⚠️ MONOTONE, AND THERE IS DELIBERATELY NO INVERSE (D-080). §7.3.1 rule 6
     * merges this by OR, so a "mark unverified" control would be an act that
     * survives on one device and is undone by the next merge — worse than not
     * offering it at all. The remedy for a channel you have stopped trusting is to
     * delete it and pair again.
     *
     * ⚠️ It is a §7.3.3 case 2 write (a channel changed), so it does touch the
     * server. That is why the interface asks once and stops offering it.
     */
    async setVerified(root) {
      const encoded = b64uEncode(root);
      const entry = current().channels.find((c) => c.root === encoded);
      if (!entry || entry.verified) return roster;
      return write((r) => {
        const c = r.channels.find((x) => x.root === encoded);
        if (c) c.verified = true;
        return r;
      }, CHANNEL_CHANGE);
    },

    /**
     * §3.5: a verified second claim arrived for this channel's invitation.
     *
     * ⚠️⚠️ THIS IS THE LINE THAT MAKES §3.5's WARNING "NON-DISMISSABLE", AND
     * UNTIL 0.9.22 THERE WAS NO LINE. The evidence lived in the pairing result and
     * was dropped the moment the user answered §3.6.2's question — including
     * *"not yet"*, which §3.6.2 expressly permits, so the product's only intrusion
     * alarm was cleared by pressing the button the product itself offers.
     *
     * ⚠️ MONOTONE, NO INVERSE, exactly as `setVerified` is and for §7.3.1 rule 7's
     * reason: OR is the only merge that cannot lose an event that happened once on
     * one device. The remedy for a channel you have stopped trusting is deletion.
     */
    async setTripwire(root) {
      const encoded = b64uEncode(root);
      const entry = current().channels.find((c) => c.root === encoded);
      if (!entry || entry.tripwire) return roster;
      return write((r) => {
        const c = r.channels.find((x) => x.root === encoded);
        if (c) c.tripwire = true;
        return r;
      }, CHANNEL_CHANGE);
    },

    async renameChannel(root, name) {
      const encoded = b64uEncode(root);
      return write((r) => {
        const c = r.channels.find((x) => x.root === encoded);
        if (c) c.name = name;
        return r;
      }, CHANNEL_CHANGE);
    },

    /**
     * §7.3.1a: deleting one conversation. **Permanent, no undo**, and it
     * propagates to every device that merges.
     *
     * ⚠️ The tombstone can never expire (§7.3.1a), so a roster that is compelled
     * open reveals how many conversations were ever deleted and on which day,
     * indefinitely — and an adversary holding a candidate root seized from the
     * OTHER party can hash it and confirm this channel once existed. `at` is
     * day-rounded and that is all that can be done. **The product must not tell a
     * user that deleting a conversation removes every trace of it.**
     */
    async removeChannel(root) {
      const encoded = b64uEncode(root);
      const hash = await rosters.rootHash(root);
      const at = rosters.startOfUtcDay(unixSeconds());
      return write((r) => {
        r.channels = r.channels.filter((c) => c.root !== encoded);
        if (!r.tombstones.some((t) => t.root_hash === hash)) r.tombstones.push({ root_hash: hash, at });
        return r;
      }, CHANNEL_CHANGE);
    },

    /**
     * §7.3.3 case 3 and §6.3: the session generation lives here, not in the
     * session store.
     *
     * ⚠️⚠️ THE WRITE HAS TO LAND BEFORE THE MESSAGE GOES OUT, which is why
     * `flow/message.js` awaits its `onGeneration` callback rather than firing it.
     * A generation that reached the peer but not the roster is the
     * frozen-generation failure §6.3 warns about, with an extra step: the next
     * migration starts from 1 again, the peer refuses it as a replay, and the
     * channel is dead with no way to re-pair.
     *
     * §7.3.3 discloses this as a genuine widening of the access rule: re-establishing
     * a conversation is a moment the server can see this `roster_id`.
     */
    async setGeneration(root, generation) {
      const encoded = b64uEncode(root);
      const entry = current().channels.find((c) => c.root === encoded);
      if (entry && entry.generation >= generation) return roster;
      return write((r) => {
        const c = r.channels.find((x) => x.root === encoded);
        // §7.3.1 rule 3 takes the maximum, and so does this: a merge may have
        // raised it past what this device was asking for.
        if (c) c.generation = Math.max(c.generation, generation);
        return r;
      }, GENERATION_CHANGE);
    },

    /**
     * §7.3.1a's **panic action**: delete every conversation, on every device.
     *
     * ⚠️⚠️ THIS IS NOT `destroy()`, AND THE DIFFERENCE IS THE WHOLE POINT. Deleting
     * the roster from the server leaves the other devices with a 404 — which §7.2
     * requires to be rendered as *"there is no identity under that phrase"*, so the
     * user of a device that was meant to be wiped is told their passphrase is
     * wrong, and the device keeps every channel root it already had. The wipe has
     * to be something the other devices can **read and act on**, which is what
     * `purged_at` beside a full tombstone set is.
     *
     * ⚠️ THE CALLER MUST HAVE REQUIRED THE PASSPHRASE TO BE RETYPED before calling
     * this (§7.3.1a). It is not checked here because this layer has no phrase — it
     * holds only what was derived from one — so it is a rule about the control, and
     * the control is where it is enforced.
     *
     * ⭐ IT MUST ALSO BE REACHABLE FROM A DEVICE THE USER HAS NEVER USED BEFORE,
     * with the phrase alone. That is why nothing here assumes an established
     * session: the phrase yields `K_master`, which yields `roster_id` and
     * `roster_auth`, so a fresh browser can `load({ network: true })` and then call
     * this. **The scenario this action exists for is a device that is gone**, and an
     * implementation offering the wipe only from an already-set-up device offers it
     * exactly where it cannot be used.
     */
    async purgeEverything() {
      const at = rosters.startOfUtcDay(unixSeconds());
      return write(async (r) => {
        // Every channel becomes a tombstone. §7.3.1 rule 1 then drops it on every
        // device that merges, and §7.3.1a forbids the tombstone from ever expiring.
        for (const c of r.channels) {
          const hash = await rosters.rootHash(b64uDecode(c.root, "channel root"));
          if (!r.tombstones.some((t) => t.root_hash === hash)) r.tombstones.push({ root_hash: hash, at });
        }
        r.channels = [];
        // ⚠️ The maximum, never the assignment: §7.3.1 rule 5 merges `purged_at` by
        // taking the maximum, and a device whose clock is behind must not be able
        // to lower a purge that has already been acted on elsewhere.
        r.purged_at = Math.max(r.purged_at ?? 0, at);
        return r;
      }, CHANNEL_CHANGE);
    },

    /**
     * ⚠️ REMOVES THE LIST AND NOTHING ELSE, AND IS NOT THE PANIC ACTION — see
     * `purgeEverything()` above, which is. The mailboxes derived from every root
     * still exist until they expire, the counterpart still holds their copy of
     * `R`, and anybody who still has the phrase can create a roster under the same
     * identifier again. §7.2: a user who believes their passphrase is exposed has
     * exactly one remedy, and it is to re-pair every channel from scratch.
     */
    async destroy() {
      await call("DELETE", undefined, CHANNEL_CHANGE);
      const k = await key;
      await storage.delete(`${k}.blob`);
      // ⚠️ THE HIGH-WATER MARK SURVIVES (§7.3.2 rule 4). It is cleared only by
      // §7.8's thorough ending, which must warn that rollback detection is being
      // reset — because a cleared mark is a device that will accept any version
      // the server offers.
      roster = null;
      outer = null;
    },
  };
  return self;
}

/**
 * The local cache key.
 *
 * ⚠️ IT IS A HASH OF `roster_id`, NOT `roster_id`. Storage keys leak more readily
 * than values — they appear in indexes, in developer tools, in a profile copied
 * without its contents — and `roster_id` is precisely the value §7.2 identifies as
 * confirming a passphrase guess with one HKDF. The blob beside it is already
 * bound to this identity; the key does not need to name it too.
 */
/** 128 bits of SHA-256 over the sealed bytes — enough to identify our own ciphertext. */
async function fingerprint(blob) {
  return b64uEncode((await sha256(blob)).slice(0, 16));
}

/**
 * The way out of an unreadable `DURABLE` record, and the only one there is.
 *
 * ⛔⛔ IT DELETES §7.3.2's ROLLBACK PROTECTION, WHICH IS WHY NOTHING CALLS IT
 * WITHOUT BEING ASKED (D-170). After this the next fetch is adopted as the new
 * baseline, so a server rolling the roster back at that moment is not caught — the
 * state §7.3.2 calls *"a device unlocking with no local history"*, entered on
 * purpose instead of by accident. The copy has to say that in those words.
 *
 * ⚠️ IT NEEDS NO KEY, AND THAT IS THE POINT. The person is locked out precisely
 * because `local_key` will not open these rows; a way out that required reading
 * them would not be one. Deleting by NAME is safe here for a reason that does not
 * generalise and must not be copied to the message store: these three names each
 * contain `identityDigest(roster_id)`, so a row at one of them was written by this
 * KEY and no other. `vault.js`'s rule — never delete what you cannot read — is
 * about rows whose owner is unknown, and the owner of these is in the address.
 *
 * ⚠️ The cached blob goes with them. It is not the problem and it costs one fetch,
 * and leaving one damaged record behind after the person pressed the button is how
 * they end up pressing it twice.
 */
export async function forgetLocalHistory(db, scope) {
  const k = `lpm.roster.${scope}`;
  await db.delete(DURABLE, `${k}.hwm`);
  await db.delete(DURABLE, `${k}.sent`);
  await db.delete(CONVERSATION, `${k}.blob`);
}

async function storageKeyPromise(rosterId) {
  // ⚠️ THE DIGEST COMES FROM `storage/vault.js` AND IS NOT COMPUTED AGAIN HERE
  // (D-170). It is the part of a record's name that says whose record it is, and
  // three files now need it; two derivations of one value is the defect class this
  // project keeps finding. The bytes are unchanged, which they must be — these keys
  // hold §7.3.2's high-water mark, and a mark at a new address is a mark that is
  // gone. `test/storage.mjs` pins the string.
  return `lpm.roster.${await identityDigest(rosterId)}`;
}

/**
 * Turn a server refusal into a reason.
 *
 * ⚠️ 404 IS THE INTERESTING ONE and it means different things to the two
 * intentions §7.2 separates. On `load()` it is a wrong phrase and must be shown as
 * a retry; the caller decides, which is why this layer only names it.
 */
export function describeFailure(err, localSeconds = epochs.nowSeconds()) {
  if (err instanceof RosterFailure) return err;

  // ⚠️⚠️ FEEDBACK 16'S GAP, AT THE SECOND SITE, AND IT HAS BEEN REACHING PEOPLE THE
  // WHOLE TIME (D-173). `flow/pair.js` maps this and named the lesson — *"the reasons
  // that go unmapped are the ones the server never gets to name"* — and the fix was
  // made where it was noticed. A `NetworkError` is not an `ApiError`: nothing answered
  // at all, so it fell past every branch below carrying no `reason`, and
  // `describeIdentity` answered **"Something went wrong, and this device could not say
  // what."** Pressing "check for changes" with no network has said that since the
  // control existed, and it is what the three controls repaired in D-173 would have
  // said about a lost connection.
  if (err?.name === "NetworkError") return new RosterFailure("offline", "nothing answered", err);

  if (err?.name !== "ApiError") return err;

  if (err.status === 401) {
    const skew = signing.clockSkewFromDate(err.date, localSeconds);
    if (skew !== null && Math.abs(skew) > signing.MAX_CLOCK_SKEW_SECONDS) {
      // ⚠️ D-152 — the message is for whoever reads a log. `ui/copy.js` owns every
      // word the person reads, and builds it from `skew`.
      return new RosterFailure("clock_skew", `clock skew ${skew}s`, err, skew);
    }
    return new RosterFailure("unauthorized", "the server refused this device's signature", err);
  }
  if (err.status === 404) return new RosterFailure("not_found", "there is no identity under this phrase", err);
  if (err.status === 409 && err.code === "already_exists") {
    return new RosterFailure("identity_exists", "this phrase already has an identity", err);
  }
  if (err.status === 409) return new RosterFailure("conflict", "the roster was written by another device", err);
  if (err.status === 429) return new RosterFailure("rate_limited", "too many roster requests", err);
  if (err.status === 507 || err.code === "storage_full") {
    return new RosterFailure("storage_full", "the server is out of space and is not accepting new writes", err);
  }
  return new RosterFailure("server_state", `server refused: ${err.code}`, err);
}
