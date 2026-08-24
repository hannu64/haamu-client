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
import * as epochs from "../protocol/epoch.js";
import * as passphrase from "../protocol/passphrase.js";
import * as rosters from "../protocol/roster.js";
import * as signing from "../protocol/signing.js";
import * as pow from "../protocol/pow.js";
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

const OCCASIONS = new Set([SETUP, CHANNEL_CHANGE, GENERATION_CHANGE, CONFLICT_REFETCH, USER_CHECK]);

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

  async function highWaterMark() {
    const n = await durable.get(`${await key}.hwm`);
    return Number.isSafeInteger(n) && n >= 0 ? n : null;
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
      const next = await mutate(structuredClone(current()));
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

      try {
        const res = await call("PUT", { if_match: outer, blob: b64uEncode(sealed.blob) }, reason);
        roster = next;
        outer = res.version;
        size = sealed.size;
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

  return {
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
    /** §3.5-register things the interface should say. Drained by the caller. */
    takeWarnings() {
      return warnings.splice(0, warnings.length);
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
      const cached = await storage.get(`${k}.blob`);
      if (cached) {
        return adopt(b64uDecode(cached.blob, "cached roster"), Number(cached.outer ?? 0));
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
    async addChannel({ root, name, role, tripwire = false }) {
      const encoded = b64uEncode(root);
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
        });
        return r;
      }, CHANNEL_CHANGE);
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
async function storageKeyPromise(rosterId) {
  return `lpm.roster.${b64uEncode((await sha256(rosterId)).slice(0, 16))}`;
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
