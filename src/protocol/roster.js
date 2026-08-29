// PROTOCOL.md §7.3 — the roster blob's on-the-wire form.
//
// This file is the ENCODING half only: pad, encrypt, decrypt, validate shape.
// §7.3.1's merge rules and §7.3.2's freshness high-water mark are state handling
// and belong with the storage layer (ROADMAP step 7) — but note that they are in
// the MVP and are not optional: they are the failure handling for a user who
// migrates, keeps the old device, and returns to it.

import { b64uDecode, b64uEncode } from "../crypto/b64u.js";
import { concat, expectLength, utf8Bytes, utf8String } from "../crypto/bytes.js";
import { sha256 } from "../crypto/hash.js";
import { seal as aeadSeal, open as aeadOpen } from "../crypto/aead.js";
import { padToFixed, unpad } from "./envelope.js";

/**
 * §7.3: padding is to a FIXED size, not §6.5's ladder — a ladder would leak the
 * channel count within a factor of four and make every bucket transition an
 * observable growth event on a permanent identifier.
 *
 * The move from 16 KiB to 64 KiB happens ONCE and PERMANENTLY; it never shrinks
 * back, so the transition is observable at most once in the life of a roster.
 */
export const ROSTER_SIZE = 16384;
export const ROSTER_SIZE_LARGE = 65536;

/**
 * §7.3's stated capacity at the small size.
 *
 * ⚠️ THEY ARE A PROMISE TO THE USER, NOT THE TRIGGER FOR GROWING THE BLOB, and
 * `chooseSize` deliberately does not consult them. §7.3 derives 48 from 16 KiB at
 * a conservative 341 bytes per entry, with room for long names; a hundred channels
 * with short ones still fit. Growing on the COUNT would make the one-way,
 * observable transition announce *"this user just passed 48 conversations"* on a
 * permanent identifier — a sharper signal than growing when the bytes no longer
 * fit, which is some function of count and name lengths and happens later.
 */
export const MAX_CHANNELS = 48;
export const MAX_TOMBSTONES = 128;

/**
 * §7.3.1a: `tombstones[].at` is rounded down to the start of the UTC day.
 *
 * The roster keeps deletions FOREVER, so the timestamp must not also record the
 * hour. That permanence is not an oversight: any expiry, however generous, means a
 * device dormant past it returns, its copy survives the merge, and the deleted
 * contact propagates back to every device — and there is no device list to ask
 * whether a stale replica remains.
 */
export function startOfUtcDay(unixSeconds) {
  return Math.floor(unixSeconds / 86400) * 86400;
}

/**
 * §7.3: a tombstone's `root_hash` is `b64u(SHA256(root) truncated to 16 bytes)`.
 *
 * ⚠️ State the residual, because it is exactly true: this is a 128-bit commitment
 * that outlives the thing it records. An adversary holding a candidate root seized
 * from the OTHER party's device can hash it and confirm the channel once existed.
 * The product must not tell a user that deleting a conversation removes every
 * trace of it.
 */
export async function rootHash(root) {
  expectLength(root, 32, "channel root");
  return b64uEncode((await sha256(root)).slice(0, 16));
}

/** Validate the decrypted shape. Deliberately strict — this is our own data. */
function validate(roster) {
  if (roster === null || typeof roster !== "object") throw new TypeError("roster: expected an object");
  if (roster.v !== 1) throw new RangeError(`roster: unsupported version ${roster.v}`);
  if (!Number.isSafeInteger(roster.version) || roster.version < 0) {
    throw new RangeError(`roster: bad version counter ${roster.version}`);
  }
  if (!Array.isArray(roster.channels) || !Array.isArray(roster.tombstones)) {
    throw new TypeError("roster: channels and tombstones must be arrays");
  }
  for (const c of roster.channels) {
    if (typeof c.root !== "string") throw new TypeError("roster: channel root must be b64u text");
    if (c.role !== "I" && c.role !== "J") throw new RangeError(`roster: bad role ${JSON.stringify(c.role)}`);
    if (!Number.isSafeInteger(c.generation) || c.generation < 0) {
      throw new RangeError(`roster: bad generation ${c.generation}`);
    }
    // §3.6.2. Optional on the wire because rosters written before 0.9.0 do not
    // have it, and a missing field reads as `false` — which is the correct
    // reading: a channel nobody recorded a comparison for has not had one.
    if (c.verified !== undefined && typeof c.verified !== "boolean") {
      throw new TypeError(`roster: verified must be a boolean, got ${JSON.stringify(c.verified)}`);
    }
    // §3.5, and the same reasoning as `verified` above: optional on the wire
    // because rosters written before 0.9.22 do not have it, and a missing field
    // reads as `false` — a channel nobody recorded evidence against has none.
    if (c.tripwire !== undefined && typeof c.tripwire !== "boolean") {
      throw new TypeError(`roster: tripwire must be a boolean, got ${JSON.stringify(c.tripwire)}`);
    }
    // §3.4.1c, 0.9.31. Optional on the wire because rosters written before then do
    // not have it — and ABSENT reads as "not known", never as "does not match".
    // ⚠️ That distinction is the whole safety of this field: a channel with no memo
    // must be indistinguishable from a link this identity has never seen, so an old
    // roster degrades to the behaviour of §3.5 as written rather than to a silence.
    if (c.link_memo !== undefined && typeof c.link_memo !== "string") {
      throw new TypeError(`roster: link_memo must be b64u text, got ${JSON.stringify(c.link_memo)}`);
    }
  }
  // §7.3, 0.9.31: links this identity has created and not yet finished (§3.4.1c).
  if (roster.invites !== undefined) {
    if (!Array.isArray(roster.invites)) throw new TypeError("roster: invites must be an array");
    for (const i of roster.invites) {
      if (typeof i?.memo !== "string") throw new TypeError("roster: invite memo must be b64u text");
      if (!Number.isSafeInteger(i.created) || i.created < 0) {
        throw new RangeError(`roster: bad invite created ${i?.created}`);
      }
    }
  }
  return roster;
}

/** An empty roster, as written at first setup. */
export function emptyRoster(unixSeconds) {
  return { v: 1, version: 1, written_at: unixSeconds, purged_at: null, channels: [], tombstones: [], invites: [] };
}

/**
 * Encrypt a roster for storage: `LE32(len) || json || zeros` to a fixed size, then
 * AES-256-GCM under `roster_key` with a fresh 12-byte IV prepended (§0.2, §7.3).
 *
 * `currentSize` implements the one-way growth rule: pass the size this roster has
 * already used, and it never goes back down.
 */
export async function sealRoster(rosterKey, roster, { currentSize = ROSTER_SIZE } = {}) {
  const json = utf8Bytes(JSON.stringify(validate(roster)));
  const size = chooseSize(json.length, currentSize);
  return { blob: await aeadSeal(rosterKey, padToFixed(json, size)), size };
}

/** Decrypt and parse. Any authentication failure throws before JSON is touched. */
export async function openRoster(rosterKey, blob) {
  const padded = await aeadOpen(rosterKey, blob);
  const roster = validate(JSON.parse(utf8String(unpad(padded))));
  return { roster, size: padded.length };
}

// ------------------------------------------------------------- §7.3.1, merging

/**
 * §7.3.1's merge, as a pure function of two rosters.
 *
 * ⚠️⚠️ THESE RULES ARE IN THE MVP EVEN THOUGH CONCURRENT MULTI-DEVICE IS NOT
 * (D-045), and the reason is worth stating where the code is: they are not a
 * feature of two live devices, they are what happens when *one device at a time*
 * is violated — and the protocol cannot enforce that rule. Every holder of
 * `K_master` is a fully authoritative writer, there is no device list and nothing
 * to revoke. A user who migrates keeps the old phone and comes back to it.
 *
 * The five rules, in §7.3.1's order:
 *
 *   1. union the channels by `root`, union the tombstones, then drop every
 *      channel whose `SHA256(root)` appears in the merged tombstones;
 *   2. `role` is immutable — keep the earlier `created` and warn;
 *   3. `generation` takes the maximum (§6.3);
 *   4. `name` is last-write-wins by `created` order;
 *   5. `purged_at` takes the maximum, treating null as zero;
 *   6. `verified` is the OR of the two (§3.6.2).
 *   7. `tripwire` is the OR of the two (§3.5).
 *   8. `link_memo` is immutable once set; absent reads as absent (§3.4.1c).
 *   9. `invites` is unioned by `memo` — see `pruneInvites` for the half that expires.
 *
 * ⭐ RULE 6 IS THE ONE FIELD HERE WITH NO DISCRIMINATOR PROBLEM, and that is why
 * it is monotone rather than last-write-wins (D-080). Rule 4's defect was a
 * discriminator equal in every case it applied to; a verification has the same
 * shape of problem waiting — it HAPPENED at a moment this format does not record,
 * and `created` is the channel's birthday while `written_at` is the blob's. OR
 * needs no ordering at all, and it can only be wrong in the safe direction: it
 * carries a verification forward, and it can never quietly un-verify a channel on
 * the device somebody is holding.
 *
 * ⚠️⚠️ RULE 4 CANNOT BE IMPLEMENTED AS WRITTEN, AND THIS IS PROTOCOL 0.8.10
 * (D-060). "Last-write-wins, resolved by `created` order" names a discriminator
 * that is IDENTICAL IN EVERY CASE THE RULE APPLIES TO: `created` is when the
 * channel was added, it is copied verbatim into every device's roster, and a name
 * conflict is by definition two copies of ONE channel — same `root`, same
 * `created`. There is no order to resolve by, and no other field in the entry that
 * could: §7.3's channel object carries `root`, `name`, `role`, `generation` and
 * `created`, and none of them records when the name was changed.
 *
 * What the blob does carry is `written_at`, the writing device's clock at the time
 * of the write. So the implementable reading of "last write wins" is **the name
 * from the roster that was written later**, which is what this function does. Two
 * consequences to state rather than bury:
 *
 *   • it compares two devices' CLOCKS. §5.2 bounds each to 60 seconds of the
 *     server, so they are within 120 seconds of each other — fine for a display
 *     name, and it must not be reused for anything where two minutes matters;
 *   • when they are equal, nothing discriminates. The entry already held is kept,
 *     which is deterministic given an argument order, and a warning is raised so
 *     that a rename which vanished is at least visible.
 *
 * ⚠️ RULE 1 IS THE PRODUCT-CRITICAL ONE. A plain union cannot express deletion:
 * device A deletes a channel and writes N+1 without it, stale device B at N still
 * has it, writes, gets 409, merges — and **the deleted channel comes back**, then
 * propagates to A. The user deleted a contact, the interface confirmed it, and it
 * returned. For people whose stated risk is being seen to use a secure messenger,
 * an undeletable contact list is a serious failure.
 *
 * Returns `{ roster, warnings }`. The warnings are for the interface: rule 2's
 * conflict is a thing a person may need to be told about, and swallowing it here
 * would be the same silence Rule 1 exists to prevent.
 *
 * ⚠️ IT IS ASYNC BECAUSE RULE 1's SECOND HALF NEEDS `SHA256(root)`, and an
 * earlier draft of this function left that half to the caller. Two exports where
 * the second is only sometimes called is how a rule gets skipped: the caller that
 * forgets it gets a merge that silently resurrects every deleted channel, which is
 * the one failure Rule 1 exists to prevent. Forty-eight hashes is nothing.
 */
export async function mergeRosters(mine, theirs) {
  validate(mine);
  validate(theirs);
  const warnings = [];

  const tombstones = new Map();
  for (const t of [...mine.tombstones, ...theirs.tombstones]) {
    const seen = tombstones.get(t.root_hash);
    // Earliest wins: a tombstone's `at` is a day, and the day it was first
    // deleted is the true one.
    if (!seen || t.at < seen.at) tombstones.set(t.root_hash, { root_hash: t.root_hash, at: t.at });
  }

  // Each entry is carried with the `written_at` of the roster it came from, which
  // is the only thing in §7.3's format that can order two writes. See rule 4 above.
  const channels = new Map();
  const from = [
    ...mine.channels.map((c) => ({ c, at: mine.written_at ?? 0 })),
    ...theirs.channels.map((c) => ({ c, at: theirs.written_at ?? 0 })),
  ];
  for (const { c, at } of from) {
    const held = channels.get(c.root);
    if (!held) {
      // Normalised here so that everything downstream of a merge has the field,
      // rather than only the entries that happened to collide.
      channels.set(c.root, {
        entry: { ...c, verified: Boolean(c.verified), tripwire: Boolean(c.tripwire) },
        at,
      });
      // ⚠️ `link_memo` rides in on the spread and is NOT normalised to a value:
      // absent must stay absent (§3.4.1c), because "" or null would be a memo that
      // matches nothing AND claims to be known.
      continue;
    }
    const { entry: existing, at: heldAt } = held;

    // Rule 2. ⚠️ THIS DOES NOT CONTAIN A COMPROMISED DEVICE and must never be
    // presented as if it did: a hostile writer simply supplies an earlier
    // `created`. Its real and sufficient job is resolving accidental conflicts
    // between two honest devices, where it prevents the self-drain failure §4.2
    // was introduced to eliminate.
    const earlier = c.created < existing.created ? c : existing;
    if (c.role !== existing.role) {
      warnings.push({ kind: "role_conflict", root: c.root, kept: earlier.role });
    }

    // Rule 4, by `written_at` — and a warning when even that cannot tell them
    // apart, because a rename that silently disappeared is worse than one that
    // announced itself.
    let name = existing.name;
    if (c.name !== existing.name) {
      if (at > heldAt) name = c.name;
      else if (at === heldAt) warnings.push({ kind: "name_unresolved", root: c.root, kept: existing.name });
    }

    channels.set(c.root, {
      entry: {
        root: c.root,
        role: earlier.role,
        created: earlier.created,
        name,
        generation: Math.max(c.generation, existing.generation), // rule 3
        verified: Boolean(c.verified) || Boolean(existing.verified), // rule 6
        // ⚠️⚠️ RULE 7, AND THE OBJECT LITERAL IS WHY IT HAD TO BE ADDED HERE RATHER
        // THAN LEFT TO SPREAD. This merge names every field it keeps, so a field
        // with no rule is not merged conservatively — it is DROPPED, silently, on
        // the first collision between two devices. §3.5's alarm stored without
        // this line would survive every test that never merged and vanish in the
        // field, which is the worst of the three possible outcomes.
        tripwire: Boolean(c.tripwire) || Boolean(existing.tripwire), // rule 7
        // ⚠️⚠️ RULE 8, AND IT IS HERE FOR THE REASON RULE 7's NOTE GIVES: this literal
        // names every field it keeps, so a field with no line is DROPPED on the first
        // collision between two devices. Immutable once set — two honest devices derive
        // it from the same `L` and cannot disagree — so a conflict is a fact about the
        // data and is surfaced rather than resolved.
        ...memoOf(c, existing, warnings),
      },
      at: Math.max(at, heldAt),
    });
  }

  // Rule 1's second half: drop every channel whose root hashes to a tombstone.
  for (const [root] of channels) {
    if (tombstones.has(await rootHash(b64uDecode(root, "channel root")))) channels.delete(root);
  }

  return {
    roster: {
      v: 1,
      version: Math.max(mine.version, theirs.version),
      written_at: Math.max(mine.written_at ?? 0, theirs.written_at ?? 0),
      purged_at: Math.max(mine.purged_at ?? 0, theirs.purged_at ?? 0) || null, // rule 5
      channels: [...channels.values()].map((held) => held.entry),
      tombstones: [...tombstones.values()].sort((a, b) => a.at - b.at),
      // Rule 9's union half. The half that EXPIRES needs a clock and lives in
      // `pruneInvites`, so that this function stays a pure function of two rosters.
      invites: unionInvites(mine.invites, theirs.invites),
    },
    warnings,
  };
}

/**
 * §7.3.1 rule 8: `link_memo` is immutable once set, and absent reads as ABSENT.
 *
 * ⚠️ THE THREE CASES ARE NOT SYMMETRIC. One side holding a memo and the other not is
 * the ordinary shape — a channel written before 0.9.31 meeting one written after — and
 * the answer is to keep the one that exists. Two DIFFERENT memos on one `root` cannot
 * happen between honest devices, because both ends derive from the same `L`; it is
 * surfaced rather than picked, exactly as rule 2 surfaces a role conflict.
 */
function memoOf(a, b, warnings) {
  const mine = a.link_memo;
  const theirs = b.link_memo;
  if (mine && theirs && mine !== theirs) {
    warnings.push({ kind: "memo_conflict", root: a.root });
    // Keep the earlier entry's, matching rule 2's "earlier `created` wins".
    return { link_memo: a.created <= b.created ? mine : theirs };
  }
  const kept = mine ?? theirs;
  return kept === undefined ? {} : { link_memo: kept };
}

/** Rule 9's union: by `memo`, keeping the earlier `created`. */
function unionInvites(mine = [], theirs = []) {
  const by = new Map();
  for (const i of [...(mine ?? []), ...(theirs ?? [])]) {
    const held = by.get(i.memo);
    if (!held || i.created < held.created) by.set(i.memo, { memo: i.memo, created: i.created });
  }
  return [...by.values()].sort((a, b) => a.created - b.created);
}

/**
 * §7.3.1 rule 9's expiring half, and §3.4.1c rule 7: an invite entry goes once the
 * link it describes is dead, or once the channel it produced exists.
 *
 * ⚠️⚠️ THIS IS THE ONE LIST IN §7.3 THAT MAY EXPIRE, AND THE REASON TOMBSTONES MAY NOT
 * DOES NOT REACH IT. A tombstone outlives its subject — that is its whole job, and any
 * expiry means a dormant device returns and resurrects a deleted contact. An invite
 * entry's subject is a pairing session that is dead after §1's TTL, so after that the
 * entry describes nothing and keeping it only tells a future reader that this identity
 * once made a link.
 *
 * ⚠️ A DROPPED ENTRY IS NOT A TOMBSTONE AND MUST NOT MAKE ONE. A device that still
 * holds it re-adds it on the next merge; it is harmless there and ages out again.
 */
export function pruneInvites(roster, nowSeconds, ttlSeconds) {
  const known = new Set(roster.channels.map((c) => c.link_memo).filter(Boolean));
  const invites = (roster.invites ?? []).filter(
    (i) => i.created + ttlSeconds > nowSeconds && !known.has(i.memo)
  );
  return { ...roster, invites };
}

/**
 * §7.3.1a: what happened to this device's channels between one roster and the
 * next, and which of the three answers §7.3.1a gives applies.
 *
 *   `purged`      `purged_at` rose. The whole-account wipe, and the ONLY reason
 *                 the device may act irreversibly and immediately: this is the
 *                 case for a lost or seized device, so the wipe must beat an
 *                 attacker who gets into it later. No quarantine, plain notice
 *   `deletion`    exactly one channel went, with a tombstone. Ordinary use, and
 *                 §7.3.1a says permanent with no undo — re-pairing one channel is
 *                 the cost of a mistake
 *   `suspect`     more than one went at once without a raised `purged_at`. Almost
 *                 certainly a bug rather than an intention: hide them immediately,
 *                 exactly as for a permanent deletion, and hold the entries 7 days
 *   `vanished`    a channel is gone with NO tombstone explaining it. §7.3.1's
 *                 rules cannot produce this from an honest server, and §7.3.2's
 *                 rollback is the reason to look at it. Reported separately
 *                 because it is the only one of the four that indicates the
 *                 SERVER rather than another device
 *
 * ⚠️ THE COUNT IS OF CHANNELS THIS DEVICE LOST, not of tombstones that arrived,
 * and §7.3.1a's own words are "introduces more than one tombstone at once". The
 * two differ for a tombstone naming a channel this device never held — a device
 * that has been away while the user deleted three conversations one at a time also
 * trips this, and that is deliberate: nothing in the data distinguishes catching
 * up from a bug, and the safe reading is the one that keeps the entries.
 */
export async function whatDisappeared(previous, next) {
  if (!previous) return { kind: "none", removed: [], purgeRaised: false };
  const held = new Set(next.channels.map((c) => c.root));
  const tombstoned = new Set(next.tombstones.map((t) => t.root_hash));
  const removed = [];
  const vanished = [];
  for (const c of previous.channels) {
    if (held.has(c.root)) continue;
    const hash = await rootHash(b64uDecode(c.root, "channel root"));
    (tombstoned.has(hash) ? removed : vanished).push(c);
  }

  const purgeRaised = (next.purged_at ?? 0) > (previous.purged_at ?? 0);
  const kind = purgeRaised ? "purged" : removed.length > 1 ? "suspect" : removed.length === 1 ? "deletion" : "none";
  return { kind, removed, vanished, purgeRaised };
}

/**
 * §7.3.2's freshness decision, as a pure function.
 *
 * ⚠️⚠️ THE OUTER COUNTER CANNOT CARRY THIS AND AN EARLIER DRAFT ASKED IT TO. It
 * travels beside the ciphertext, so the server has to read it to do
 * compare-and-swap and its value is therefore CHOSEN BY THE ATTACKER. Serving
 * `(ciphertext_v17, version: 99)` passes any check made against it — and a client
 * that then persisted 99 as its high-water mark would refuse the genuine version
 * 44 afterwards, by its own rule, locking the user onto the attacker's roster
 * permanently, including against an honest server.
 *
 * So the decision is made on the `version` INSIDE the ciphertext, and the outer
 * counter is only ever compared for agreement:
 *
 *   `stale`      the blob decrypts to a version below one this device has seen.
 *                Refuse it (§7.3.2 rule 2)
 *   `mismatch`   inner and outer disagree. An honest server keeps them equal; a
 *                rollback cannot without `roster_key`. Surface it in the same
 *                register as §3.5's tripwire (rule 3) — and note this is a
 *                WARNING, not a refusal: the blob itself is authentic
 *   `unknown`    no high-water mark. A genuinely new device has nothing to
 *                compare against, which is exactly where the attack aims. It
 *                cannot be closed; the caller shows what the blob asserts about
 *                itself (`written_at`, channel count) and §7.3.2 records that as
 *                weak
 *   `fresh`      inner ≥ high-water mark, inner == outer
 */
export function freshness({ inner, outer, highWaterMark }) {
  if (highWaterMark !== null && highWaterMark !== undefined && inner < highWaterMark) {
    return { state: "stale", inner, outer, highWaterMark };
  }
  if (inner !== outer) return { state: "mismatch", inner, outer, highWaterMark: highWaterMark ?? null };
  if (highWaterMark === null || highWaterMark === undefined) {
    return { state: "unknown", inner, outer, highWaterMark: null };
  }
  return { state: "fresh", inner, outer, highWaterMark };
}

/**
 * §7.3: 16 KiB, or 64 KiB once and permanently.
 *
 * At the 64 KiB limit the client REFUSES further channel additions and says so.
 * Dropping old tombstones to make room is not permitted — §7.3.1a is why.
 */
export function chooseSize(jsonLength, currentSize) {
  const needed = jsonLength + 4;
  if (currentSize <= ROSTER_SIZE && needed <= ROSTER_SIZE) return ROSTER_SIZE;
  if (needed <= ROSTER_SIZE_LARGE) return ROSTER_SIZE_LARGE;
  throw new RangeError(
    `roster: ${jsonLength} bytes exceeds the 64 KiB blob; §7.3 requires refusing further ` +
      `channel additions rather than dropping tombstones to make room`
  );
}
