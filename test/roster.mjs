// §7.3's roster: the merge rules, the freshness decision, and the padding.
//
// ⚠️⚠️ THIS FILE EXISTS BECAUSE `e2e-roster.mjs` DOES NOT TEST WHAT IT LOOKS LIKE
// IT TESTS, AND THE SABOTAGE IS WHAT SHOWED THAT. Its check that "neither write
// was lost" passes with `mergeRosters` REMOVED ENTIRELY from the 409 path —
// because the compare-and-swap loop refetches and re-applies the caller's
// intention against fresh state, which reproduces the same answer by a different
// route. One of the two mechanisms was doing all the work and the test could not
// tell which. (The tombstone check is the one that does bite: with Rule 1's second
// half removed, the deleted channel comes back over real HTTP.)
//
// So the rules are tested here, as the pure function they are, where a broken rule
// fails immediately and for the stated reason. This is the same lesson step 6 wrote
// down in a different form: a test that passes under sabotage is not a weak test,
// it is a DIFFERENT test than the one you thought you wrote.

import { b64uEncode } from "../src/crypto/b64u.js";
import * as rosters from "../src/protocol/roster.js";
import * as quarantine from "../src/flow/quarantine.js";
import { describeFailure } from "../src/flow/roster.js";
import { NetworkError } from "../src/net/api.js";
import { check, equal, section, done } from "./harness.mjs";

const root = (n) => new Uint8Array(32).fill(n);
const enc = (n) => b64uEncode(root(n));

function roster({ version = 1, written_at = 1000, channels = [], tombstones = [], purged_at = null } = {}) {
  return { v: 1, version, written_at, purged_at, channels, tombstones };
}

const channel = (n, extra = {}) => ({
  root: enc(n),
  name: `n${n}`,
  role: "I",
  generation: 0,
  created: 500,
  ...extra,
});

// ============================================================ §7.3.1 the merge

section("§7.3.1 rule 1 — the union, and what deletion has to survive");

{
  const mine = roster({ channels: [channel(1)] });
  const theirs = roster({ channels: [channel(2)] });
  const { roster: merged } = await rosters.mergeRosters(mine, theirs);
  equal("two devices' channels are unioned", merged.channels.map((c) => c.name).sort().join(","), "n1,n2");
}

{
  // ⭐⭐ The failure this rule exists for, in miniature. A plain union cannot
  // express deletion: device A deletes and writes without the channel, stale
  // device B still holds it, and the union puts it back — then propagates it to A.
  // The user deleted a contact, the interface confirmed it, and it returned.
  const hash = await rosters.rootHash(root(1));
  const stale = roster({ channels: [channel(1), channel(2)] });
  const current = roster({ version: 2, channels: [channel(2)], tombstones: [{ root_hash: hash, at: 86400 }] });

  const { roster: merged } = await rosters.mergeRosters(stale, current);
  equal("⭐⭐ a tombstoned channel does not come back", merged.channels.map((c) => c.name).join(","), "n2");
  equal("and the tombstone is carried forward", String(merged.tombstones.length), "1");
}

{
  // §7.3.1a: tombstones MUST NOT expire, so a merge may never drop one — a device
  // dormant past any expiry returns, its copy survives, and the deleted contact
  // propagates everywhere. There is no device list to ask whether a stale replica
  // remains, so any timer is a guess.
  const old = { root_hash: await rosters.rootHash(root(9)), at: 0 };
  const { roster: merged } = await rosters.mergeRosters(roster({ tombstones: [old] }), roster({}));
  equal("a tombstone from the epoch's start is kept", String(merged.tombstones.length), "1");
}

section("§7.3.1 rule 2 — role is immutable, and what that does not protect");

{
  const mine = roster({ channels: [channel(1, { role: "I", created: 500 })] });
  const theirs = roster({ channels: [channel(1, { role: "J", created: 900 })] });
  const { roster: merged, warnings } = await rosters.mergeRosters(mine, theirs);
  equal("the earlier `created` keeps its role", merged.channels[0].role, "I");
  equal("and the conflict is surfaced, not swallowed", warnings[0]?.kind, "role_conflict");

  // ⚠️ Stated because §7.3.1 states it: this does NOT contain a compromised
  // device. A hostile writer supplies an earlier `created` and wins. Its real job
  // is resolving accidental conflicts between two honest devices.
  const hostile = roster({ channels: [channel(1, { role: "J", created: 1 })] });
  const { roster: taken } = await rosters.mergeRosters(mine, hostile);
  equal("a hostile writer with an earlier `created` takes the role", taken.channels[0].role, "J");
}

section("§7.3.1 rule 3 — generation takes the maximum (§6.3)");

{
  const mine = roster({ channels: [channel(1, { generation: 2 })] });
  const theirs = roster({ channels: [channel(1, { generation: 7 })] });
  const { roster: merged } = await rosters.mergeRosters(mine, theirs);
  // ⚠️ A generation that went BACKWARDS is the frozen-generation failure §6.3
  // warns about: the peer refuses the next session as a replay and the channel is
  // dead, with no way to re-pair because §3's links are single-use.
  equal("⭐ the higher generation wins whichever side it is on", String(merged.channels[0].generation), "7");
  const { roster: other } = await rosters.mergeRosters(theirs, mine);
  equal("and the merge is symmetric in it", String(other.channels[0].generation), "7");
}

section("§7.3.1 rule 4 — 'last write wins by created order' cannot resolve anything");

{
  // ⭐⭐ PROTOCOL 0.8.10. `created` is when the CHANNEL was added and is copied
  // verbatim into every device's roster — so in the only case rule 4 applies to,
  // two copies of one channel, it is EQUAL BY CONSTRUCTION. The rule names a
  // discriminator that cannot discriminate, and no other field in §7.3's channel
  // object records when a name changed.
  const mine = roster({ written_at: 1000, channels: [channel(1, { name: "Bea" })] });
  const theirs = roster({ written_at: 2000, channels: [channel(1, { name: "Bo" })] });
  equal("the two entries agree on `created`", String(mine.channels[0].created), String(theirs.channels[0].created));

  const { roster: merged } = await rosters.mergeRosters(mine, theirs);
  equal("⭐ the name from the roster written later wins", merged.channels[0].name, "Bo");
  const { roster: swapped } = await rosters.mergeRosters(theirs, mine);
  equal("and argument order does not decide it", swapped.channels[0].name, "Bo");
}

{
  // When the clocks agree there is nothing left to resolve by. §5.2 bounds every
  // device to 60 seconds of the server, so this is a two-minute window, and it is
  // a display name — but a rename that silently disappeared is worse than one that
  // said so.
  const a = roster({ written_at: 5000, channels: [channel(1, { name: "Bea" })] });
  const b = roster({ written_at: 5000, channels: [channel(1, { name: "Bo" })] });
  const { roster: merged, warnings } = await rosters.mergeRosters(a, b);
  equal("an unresolvable rename keeps one deterministically", merged.channels[0].name, "Bea");
  equal("and says so", warnings[0]?.kind, "name_unresolved");
}

section("§7.3.1 rule 5 — purged_at takes the maximum");

{
  const { roster: merged } = await rosters.mergeRosters(
    roster({ purged_at: null }),
    roster({ purged_at: 86400, channels: [] })
  );
  // A device that merges a roster whose `purged_at` is higher than the value it
  // has acted on purges immediately and irreversibly (§7.3.1a). It is the panic
  // action for a lost or seized device, so it must beat an attacker who gets into
  // that device later — there is no quarantine.
  equal("a raised purge marker survives the merge", String(merged.purged_at), "86400");
  const { roster: none } = await rosters.mergeRosters(roster({}), roster({}));
  equal("and null stays null rather than becoming zero", String(none.purged_at), "null");
}

// ========================================== §7.3.1 rule 6 — verified merges by OR

// ⚠️⚠️ MONOTONE, AND THE REASON IS D-060's LESSON APPLIED BEFORE IT BITES. Rule 4's
// defect was a discriminator equal in every case it applied to; a verification has
// the same problem waiting — it HAPPENED at a moment this format does not record,
// and `created` is the channel's birthday while `written_at` is the blob's. OR
// needs no ordering at all, and it can only be wrong in the safe direction: it can
// carry a verification forward, never quietly drop one.

section("§7.3.1 rule 6 — a verification cannot be lost by a merge (§3.6.2)");

{
  const verified = roster({ written_at: 1000, channels: [channel(1, { verified: true })] });
  const not = roster({ written_at: 9999, channels: [channel(1, { verified: false })] });

  const { roster: a } = await rosters.mergeRosters(verified, not);
  check("⭐⭐ a LATER roster that says false does not un-verify the channel", a.channels[0].verified);

  const { roster: b } = await rosters.mergeRosters(not, verified);
  check("and the same holds with the arguments the other way round", b.channels[0].verified);

  // §3.6.2 rule 1: a channel nobody recorded a comparison for has not had one, and
  // rosters written before 0.9.0 do not carry the field at all.
  const older = roster({ channels: [channel(2)] });
  const { roster: c } = await rosters.mergeRosters(older, roster({}));
  equal("⭐ a roster written before the field existed reads as unverified, not undefined",
    String(c.channels[0].verified), "false");

  const { roster: d } = await rosters.mergeRosters(older, roster({ channels: [channel(2, { verified: true })] }));
  check("and a verification made on one device reaches the other", d.channels[0].verified);
}

// ============================ §7.3.1 rule 7 — the tripwire merges by OR (§3.5)

// ⚠️⚠️ THE MERGE NAMES EVERY FIELD IT KEEPS, so a field with no rule is not merged
// conservatively — it is DROPPED, on the first collision between two devices. That is
// the failure this section exists to make impossible: a §3.5 alarm stored correctly,
// passing every test that never merged, and gone in the field on the day two devices
// sync. ⭐ The whole point of the marker is that it OUTLIVES the screen it was raised
// on, so a merge that loses it is the same defect as the dismiss button it replaced.

section("§7.3.1 rule 7 — §3.5's evidence cannot be lost by a merge");

{
  const tripped = roster({ written_at: 1000, channels: [channel(1, { tripwire: true })] });
  const clean = roster({ written_at: 9999, channels: [channel(1, { tripwire: false })] });

  const { roster: a } = await rosters.mergeRosters(tripped, clean);
  check("⭐⭐ a LATER roster that says false does not clear the alarm", a.channels[0].tripwire);

  const { roster: b } = await rosters.mergeRosters(clean, tripped);
  check("and the same holds with the arguments the other way round", b.channels[0].tripwire);

  // ⭐ THE ONE THAT MATTERS MOST: the alarm was raised on the laptop and the person
  // opens the conversation on the phone. A marker that did not travel would be
  // defeated by the most ordinary act there is.
  const older = roster({ channels: [channel(2)] });
  const { roster: c } = await rosters.mergeRosters(older, roster({}));
  equal("⭐ a roster written before the field existed reads as false, not undefined",
    String(c.channels[0].tripwire), "false");

  const { roster: d } = await rosters.mergeRosters(older, roster({ channels: [channel(2, { tripwire: true })] }));
  check("⭐⭐ evidence recorded on one device reaches the other", d.channels[0].tripwire);

  // ⚠️ AND THE TWO FIELDS ARE INDEPENDENT. Comparing the six digits settles who is at
  // the far end; it does not un-hold the invite link, and a merge that let `verified`
  // stand in for `tripwire` would quietly retire the alarm on the day somebody
  // answered §3.6.2 on their other device.
  const verifiedOnly = roster({ channels: [channel(3, { verified: true, tripwire: false })] });
  const trippedOnly = roster({ channels: [channel(3, { verified: false, tripwire: true })] });
  const { roster: e } = await rosters.mergeRosters(verifiedOnly, trippedOnly);
  check("⭐⭐⭐ a verified channel still carries its tripwire", e.channels[0].tripwire && e.channels[0].verified);
}

// ============================================================= §7.3.2 freshness

section("§7.3.2 — the version the client trusts is inside the ciphertext");

{
  // ⚠️⚠️ The outer counter travels beside the blob, so the server must be able to
  // read it — which means its value is CHOSEN BY THE ATTACKER. Serving
  // (ciphertext_v17, version: 99) passes any check made against it, and a client
  // that persisted 99 as its high-water mark would then refuse the genuine version
  // 44 for ever, by its own rule, locking the user onto the attacker's roster even
  // against an honest server.
  equal("a rollback below the high-water mark is refused", rosters.freshness({ inner: 17, outer: 17, highWaterMark: 44 }).state, "stale");
  equal("inner and outer disagreeing is a warning, not a refusal", rosters.freshness({ inner: 17, outer: 99, highWaterMark: 10 }).state, "mismatch");
  equal("a new device has nothing to compare against", rosters.freshness({ inner: 44, outer: 44, highWaterMark: null }).state, "unknown");
  equal("and the ordinary case is fresh", rosters.freshness({ inner: 44, outer: 44, highWaterMark: 44 }).state, "fresh");

  // The high-water mark is a floor, not an equality: a device that missed writes
  // made elsewhere must still accept the newer roster.
  equal("a higher version is fresh, not stale", rosters.freshness({ inner: 50, outer: 50, highWaterMark: 44 }).state, "fresh");
}

// ================================================================ §7.3 the blob

section("§7.3 — the padding leaks nothing, and the growth is one-way");

{
  const rosterKey = crypto.getRandomValues(new Uint8Array(32));

  const empty = await rosters.sealRoster(rosterKey, rosters.emptyRoster(1000));
  const full = await rosters.sealRoster(
    rosterKey,
    roster({ channels: Array.from({ length: 20 }, (_, i) => channel(i)) })
  );
  equal("twenty channels and none are the same size", String(full.blob.length), String(empty.blob.length));
  equal("which is 16 KiB plus a 12-byte IV and a 16-byte tag", String(empty.blob.length), "16412");

  const opened = await rosters.openRoster(rosterKey, full.blob);
  equal("and it comes back", String(opened.roster.channels.length), "20");

  // ⚠️ The move to 64 KiB happens once and never reverses, so the transition is an
  // observable growth event at most once in the life of a roster. A ladder would
  // make every bucket transition observable and leak the channel count within a
  // factor of four.
  // ⚠️ THE TRIGGER IS "DOES IT FIT", NOT §7.3's STATED 48 CHANNELS, and the
  // difference is a privacy one rather than an arithmetic one. §7.3's 48 is a
  // conservative capacity for the user-facing promise (341 bytes per entry, room
  // for long names); a hundred channels with short names still fit in 16 KiB. If
  // the move were triggered by the COUNT, the transition would tell the server
  // "this user just passed 48 conversations" — a sharp signal on a permanent
  // identifier. Triggered by fit, it says only that some function of count and
  // name lengths crossed a line, which is fuzzier and happens later.
  const long = (i) => channel(i % 200, { name: "x".repeat(120) });
  const big = roster({ channels: Array.from({ length: 100 }, (_, i) => long(i)) });
  const grown = await rosters.sealRoster(rosterKey, big);
  equal("a roster that outgrows 16 KiB moves to 64", String(grown.size), String(rosters.ROSTER_SIZE_LARGE));
  const stays = await rosters.sealRoster(rosterKey, rosters.emptyRoster(1000), { currentSize: rosters.ROSTER_SIZE_LARGE });
  equal("⭐ and never shrinks back", String(stays.size), String(rosters.ROSTER_SIZE_LARGE));
}

{
  // §7.3: at the 64 KiB limit the client refuses further channels and says so.
  // Dropping old tombstones to make room is NOT permitted (§7.3.1a).
  const key = crypto.getRandomValues(new Uint8Array(32));
  const huge = roster({ channels: Array.from({ length: 900 }, (_, i) => channel(i % 200, { name: "x".repeat(60) })) });
  let threw = false;
  try {
    await rosters.sealRoster(key, huge, { currentSize: rosters.ROSTER_SIZE_LARGE });
  } catch {
    threw = true;
  }
  check("a roster past 64 KiB is refused rather than truncated", threw);
}

// ====================================================== §7.3.1a what disappeared

section("§7.3.1a — the three answers, and the one that is not a deletion");

const tomb = async (n, at = 900) => ({ root_hash: await rosters.rootHash(root(n)), at });

{
  const before = roster({ channels: [channel(1), channel(2), channel(3)] });
  const after = roster({ channels: [channel(1), channel(3)], tombstones: [await tomb(2)] });
  const change = await rosters.whatDisappeared(before, after);
  equal("one channel with a tombstone is an ordinary deletion", change.kind, "deletion");
  equal("and it is named, because the interface has to say what went", change.removed[0].name, "n2");

  const two = roster({ channels: [channel(3)], tombstones: [await tomb(1), await tomb(2)] });
  const suspect = await rosters.whatDisappeared(before, two);
  equal("⭐⭐ two at once is suspect — §7.3.1a's quarantine case", suspect.kind, "suspect");
  equal("with both entries in hand", String(suspect.removed.length), "2");

  const purged = roster({ channels: [], purged_at: 1000, tombstones: [await tomb(1), await tomb(2), await tomb(3)] });
  const wipe = await rosters.whatDisappeared(before, purged);
  equal(
    "⭐⭐ a raised purged_at outranks the count — the panic action skips the quarantine",
    wipe.kind,
    "purged"
  );

  equal("an unchanged roster reports nothing", (await rosters.whatDisappeared(before, before)).kind, "none");
  equal(
    "and a device with no previous roster has lost nothing",
    (await rosters.whatDisappeared(null, purged)).kind,
    "none"
  );
}

{
  // ⚠️ THE ONE THAT IS NOT A DELETION AT ALL. §7.3.1's rules cannot remove a
  // channel without a tombstone, so a channel that is simply absent means the blob
  // did not come from the sequence of writes this device has been part of —
  // §7.3.2's rollback, in the case where the high-water mark did not catch it. It
  // is counted separately because the question is not "was this you?", it is
  // whether to trust the server at all.
  const before = roster({ channels: [channel(1), channel(2)] });
  const after = roster({ channels: [channel(1)] });
  const change = await rosters.whatDisappeared(before, after);
  equal("a channel gone with no tombstone is not a deletion", change.kind, "none");
  equal("⭐ it is reported as unexplained", String(change.vanished.length), "1");
}

// ================================================ §7.3.1a the quarantine itself

section("§7.3.1a — seven days, and what an undo can actually undo");

{
  let now = 1_000_000;
  const m = new Map();
  const storage = {
    get: async (k) => (m.has(k) ? m.get(k) : null),
    set: async (k, v) => m.set(k, v),
    delete: async (k) => m.delete(k),
  };
  const q = quarantine.openQuarantine({ storage, scope: "test", unixSeconds: () => now });

  await q.hold([channel(1), channel(2)]);
  equal("both entries are held", String((await q.pending()).length), "2");

  await q.hold([channel(1)]);
  equal("holding the same entry twice does not duplicate it", String((await q.pending()).length), "2");
  const held = (await q.list()).find((e) => e.root === enc(1));
  equal(
    "⭐ nor re-date it — a refetch must not extend its own window",
    String(held.expiresAt),
    String(1_000_000 + quarantine.QUARANTINE_S)
  );

  const restored = await q.restore(enc(1));
  equal("an undo moves the entry to kept", restored.state, quarantine.KEPT);
  equal("and it is no longer counted as pending", String((await q.pending()).length), "1");

  now += quarantine.QUARANTINE_S + 1;
  const dropped = await q.sweep();
  equal("the seven days take what was still held", String(dropped.length), "1");
  equal(
    "⭐ and hand back the entry, because its session record and history must go with it",
    dropped[0].root,
    enc(2)
  );
  equal("⭐⭐ and never what was restored", String((await q.list()).length), "1");

  // ⚠️⚠️ THE UNDO IS LOCAL AND CAN NEVER BE ANYTHING ELSE — the eighth hole.
  // §7.3.1a offers an undo; §7.3.1 rule 1 drops every channel whose root hashes to
  // a merged tombstone; §7.3.1a forbids a tombstone from ever expiring. So the
  // restored entry cannot go back into the roster: writing it there produces a
  // conversation that reappears and then vanishes again at the next merge, on
  // every device, which is D-016's failure with an extra step.
  const list = await q.list();
  const merged = await quarantine.withRestored([{ root: enc(9), name: "n9" }], list);
  equal("a restored conversation is listed beside the roster's", String(merged.length), "2");
  check(
    "⭐⭐⭐ and it is marked local — on this device and nowhere else, permanently",
    merged.find((c) => c.root === enc(1)).local === true && merged.find((c) => c.root === enc(9)).local === false
  );

  await q.purge();
  equal("§7.3.1a's panic path takes the quarantine with it, kept entries included", String((await q.list()).length), "0");
}

section("§7.3 — a failure with nobody on the other end still has a reason (D-173)");

/**
 * ⛔⛔ FEEDBACK 16'S GAP, AT THE SECOND SITE, AND IT HAD BEEN REACHING PEOPLE.
 *
 * `flow/pair.js` maps `NetworkError` to a reason and wrote the lesson down —
 * *"the reasons that go unmapped are the ones the server never gets to name"*. This
 * file's `describeFailure` opened with `if (err?.name !== "ApiError") return err`, so
 * the same error fell straight through with no `reason` at all, `describeIdentity`
 * missed its lookup, and every roster failure caused by being offline arrived as
 * **"Something went wrong, and this device could not say what."** Pressing "check for
 * changes" with no network has said that since the control existed.
 *
 * ⚠️ THE COMPLETENESS CHECK IN `copy.mjs` COULD NOT SEE THIS. It reads which reasons
 * the module RAISES and demands a sentence for each — a perfect instrument for a
 * reason that exists and a blind one for a reason that was never constructed.
 */
{
  const offline = describeFailure(new NetworkError("PUT /api/roster/x: Failed to fetch", new TypeError("Failed to fetch")));
  equal("⛔⛔ a network error that reached nobody comes back with a reason", offline.reason, "offline");
  check("⚠️ and it is a RosterFailure, so every caller that switches on the type still works",
    offline.name === "RosterFailure", offline.name);
  check("⚠️ and it keeps the original as its cause, for the diagnostics panel",
    offline.cause instanceof NetworkError);

  // ⚠️ THE THINGS IT MUST NOT SWALLOW. `describeFailure` is the funnel every roster
  // call goes through, and a mapper that answered "offline" for everything would be
  // worse than the gap it closes.
  const already = new Error("something else");
  check("⚠️ an error that is neither ours nor the API's is still passed through untouched",
    describeFailure(already) === already, describeFailure(already)?.name ?? "?");
  const conflict = Object.assign(new Error("409"), { name: "ApiError", status: 409 });
  equal("⚠️ and the API's own refusals keep their own reasons", describeFailure(conflict).reason, "conflict");
}

done();
