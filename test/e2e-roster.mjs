// The roster against the real server — PROTOCOL.md §7.2, §7.3, ROADMAP step 7.
//
// Real Argon2id at 128 MiB, real Ed25519 signatures, a real Postgres row, and two
// "devices" that hold the same passphrase and write at the same version. The
// merge rules of §7.3.1 are in the MVP even though concurrent multi-device is not
// (D-045), and this is where they are shown to work — because they are not a
// feature of two live devices, they are what happens when *one device at a time*
// is violated, and the protocol cannot enforce that rule.
//
// ⚠️ THE TWO DEVICES SHARE KEYS AND SHARE NOTHING ELSE. That is exactly what §7.2
// produces: one phrase, one `K_master`, one `roster_id`, one `roster_auth` — and
// two separate local caches, which is where every interesting failure lives.

import { readFileSync } from "node:fs";
import { createApi } from "../src/net/api.js";
import { b64uEncode } from "../src/crypto/b64u.js";
import { randomBytes } from "../src/crypto/random.js";
import * as argon2 from "../src/crypto/argon2.js";
import * as passphrase from "../src/protocol/passphrase.js";
import * as rosters from "../src/protocol/roster.js";
import * as rosterFlow from "../src/flow/roster.js";
import { check, equal, section, done } from "./harness.mjs";

const BASE = process.env.LPM_BASE_URL || "http://127.0.0.1:8099";
const api = createApi({ baseUrl: BASE, timeoutMs: 30000 });

await argon2.initArgon2({ wasm: readFileSync(new URL("../argon2/dist/lpm_argon2.wasm", import.meta.url)) });
passphrase.installArgon2id(argon2.argon2id);

console.log(`server ${BASE}`);

function memStorage() {
  const m = new Map();
  return {
    get: async (k) => (m.has(k) ? m.get(k) : null),
    set: async (k, v) => m.set(k, v),
    delete: async (k) => m.delete(k),
    // Not part of the interface the flow module uses — it is here so a test can ask
    // what ended up on disk without reconstructing the key, which is deliberately a
    // hash of `roster_id` and not the identifier itself.
    keys: () => [...m.keys()],
  };
}

/** What a device wrote to disk under `<key>.blob`. */
async function cachedBlob(storage) {
  const k = storage.keys().find((x) => x.endsWith(".blob"));
  return k === undefined ? null : (await storage.get(k)).blob;
}

/**
 * A device is a cache, a durable store and a clock. The keys come from the phrase.
 *
 * ⚠️ TWO STORES, BECAUSE §7.8 SEPARATES THEM: the cached blob is conversation
 * state and the high-water mark must survive the ordinary ending. `openRoster`
 * refuses to default the second one — see the check at the end of this file.
 */
function device(keys, storage = memStorage(), durable = memStorage()) {
  return { storage, durable, roster: rosterFlow.openRoster({ api, keys, storage, durable }) };
}

const root = () => randomBytes(32);

// ================================================================ §7.2 setup

section("§7.2 — one phrase, one identity");

const phrase = passphrase.generatePhrase();
const keysA = await rosterFlow.identity(phrase);
equal("the phrase is §7.4's eight words", String(phrase.split(" ").length), "8");
equal("§7.2's roster_id is 16 bytes", String(keysA.rosterId.length), "16");
check("Argon2id ran at §7.2's parameters", argon2.lastRun().heapMiB >= 128, `${argon2.lastRun().ms} ms here`);

// ⭐ The same phrase on a second device derives the same identity with nothing
// transferred between them. That is the whole recovery story: no account, no key
// escrow, no device list — just the phrase.
const keysB = await rosterFlow.identity(phrase);
equal("a second device derives the same roster_id", b64uEncode(keysB.rosterId), b64uEncode(keysA.rosterId));
equal("and the same roster_auth", b64uEncode(keysB.rosterAuth.publicKey), b64uEncode(keysA.rosterAuth.publicKey));

const A = device(keysA);
await A.roster.create();
check("the identity is created", A.roster.roster !== null, `outer version ${A.roster.outerVersion}`);

// ⚠️ §7.2's ambiguity, closed by making the two intentions different calls.
{
  let reason = null;
  try {
    await device(keysA).roster.create();
  } catch (err) {
    reason = err.reason;
  }
  equal("⭐ creating an identity that exists is refused, never a silent overwrite", reason, "identity_exists");
}

{
  // A mistyped phrase yields a different K_master, a different roster_id and a
  // 404 — the same response as genuine first use. §7.2 requires the client to
  // render this as a retry; here it is at least a DIFFERENT ANSWER from success,
  // which is what makes that possible.
  const wrong = await rosterFlow.identity(passphrase.generatePhrase());
  let reason = null;
  try {
    await device(wrong).roster.load({ network: true });
  } catch (err) {
    reason = err.reason;
  }
  equal("⭐ a wrong phrase is not_found, and never a new identity", reason, "not_found");
}

// ============================================================== §7.3 channels

section("§7.3 — channels, and what a second device sees");

const mikko = root();
await A.roster.addChannel({ root: mikko, name: "Mikko", role: "I" });
equal("the channel is in the roster", String(A.roster.channels().length), "1");
equal("with its role", A.roster.channel(mikko).role, "I");

const B = device(keysB);
await B.roster.load({ network: true });
equal("⭐ the second device fetches it with the phrase alone", String(B.roster.channels().length), "1");
equal("and reads the name", B.roster.channel(mikko).name, "Mikko");

// §6.3 and §7.3.3 case 3: the generation lives here, not in the session store.
await A.roster.setGeneration(mikko, 3);
await B.roster.check();
equal("⭐⭐ the session generation reaches the other device", String(B.roster.channel(mikko).generation), "3");

// ============================================================ §7.3.1 the merge

section("§7.3.1 — two writers at the same version");

{
  // Both devices are now at the same outer version and neither knows what the
  // other is about to do. This is the scenario §7.3.1 exists for and it is not
  // exotic: a user who migrated, kept the old phone, and came back to it.
  const fromA = root();
  const fromB = root();
  await Promise.all([
    A.roster.addChannel({ root: fromA, name: "Aino", role: "I" }),
    B.roster.addChannel({ root: fromB, name: "Bo", role: "J" }),
  ]);

  const C = device(keysA);
  await C.roster.load({ network: true });
  const names = C.roster
    .channels()
    .map((c) => c.name)
    .sort()
    .join(",");
  // ⚠️ WHAT THIS CHECK ACTUALLY TESTS IS THE COMPARE-AND-SWAP LOOP, NOT THE
  // MERGE, and the sabotage is what showed it: with `mergeRosters` removed
  // entirely from the 409 path, this still passes. The loser refetches and
  // re-applies its own intention against fresh state, which reaches the same
  // answer by a different route. The merge rules are tested where they can fail —
  // `test/roster.mjs`, as the pure function they are. The one check here that DOES
  // bite is the tombstone below.
  equal("⭐ neither write was lost", names, "Aino,Bo,Mikko");
}

// ============================================================= §7.3.1a delete

section("§7.3.1a — a deleted conversation must not come back");

{
  // The failure this is protecting against, in full: device A deletes a channel
  // and writes N+1 without it; stale device B at version N still holds it, writes,
  // gets 409, merges — and without the tombstone the deleted channel returns, then
  // propagates to A. The user deleted a contact, the interface confirmed it, and
  // it came back. For people whose stated risk is being seen to use a secure
  // messenger, an undeletable contact list is a serious failure.
  const doomed = root();
  await A.roster.addChannel({ root: doomed, name: "Delete me", role: "I" });

  const stale = device(keysB);
  await stale.roster.load({ network: true }); // sees `doomed`
  await A.roster.removeChannel(doomed); // A deletes it and writes

  // The stale device now writes something of its own. Its copy still has the
  // deleted channel in it.
  await stale.roster.addChannel({ root: root(), name: "Later", role: "J" });

  const fresh = device(keysA);
  await fresh.roster.load({ network: true });
  const back = fresh.roster.channel(doomed);
  check("⭐⭐ the deleted channel did not return", back === null);
  check("and the stale device's own write survived", fresh.roster.channels().some((c) => c.name === "Later"));

  const tomb = fresh.roster.roster.tombstones;
  equal("the tombstone is kept", String(tomb.length), "1");
  equal(
    "and its day is rounded, because the roster keeps deletions forever",
    String(tomb[0].at % 86400),
    "0"
  );
}

// =========================================================== §7.3.3 the access rule

section("§7.3.3 — how often roster_id may be seen at all");

{
  // ⚠️ THE MITIGATION FOR A PERMANENT JOIN KEY IS BEHAVIOURAL AND THIS IS IT. A
  // device that fetched on launch would make `roster_id` a daily signal; one that
  // reads its own cache makes it a rare one. The difference costs nothing.
  const cached = device(keysA);
  await cached.roster.load({ network: true });
  const offline = createApi({
    baseUrl: BASE,
    fetchImpl: () => {
      throw new Error("the network was touched on load()");
    },
  });
  const reopened = rosterFlow.openRoster({
    api: offline,
    keys: keysA,
    storage: cached.storage,
    durable: cached.durable,
  });
  const fromCache = await reopened.load();
  check("⭐ a device with a cache opens without touching the server at all", fromCache !== null);
  equal("and sees its channels", String(reopened.channels().length), String(cached.roster.channels().length));

  // ⚠️⚠️ THE CACHE HOLDS CIPHERTEXT. An earlier draft of §7.3.3 said the client
  // "caches the decrypted roster locally", which implemented literally puts every
  // `R` on disk in the clear: a stolen locked device or a copied browser profile
  // then yields the full §6.2 consequences of root compromise WITHOUT the
  // passphrase, bypassing §11's locked-device row entirely.
  const stored = await cachedBlob(cached.storage);
  check("⭐⭐ what is on disk is ciphertext, not roots", stored !== null && !stored.includes(b64uEncode(mikko)));
  check(
    "and the key it is under is not roster_id either",
    !cached.storage.keys().some((k) => k.includes(b64uEncode(keysA.rosterId))),
    cached.storage.keys()[0]
  );
}

{
  let reason = null;
  try {
    await A.roster.check();
    await A.roster.check(); // twice within the hour
  } catch (err) {
    reason = err.reason;
  }
  equal("§7.3.3 case 5 is limited to one check per hour", reason, "access_rule");
}

// ============================================================ what the server holds

section("§7.3 — the server's view");

{
  // The server stores one fixed size whatever the roster contains, so the length
  // says nothing about how many people somebody talks to.
  const one = device(await rosterFlow.identity(passphrase.generatePhrase()));
  await one.roster.create();
  for (let i = 0; i < 5; i++) await one.roster.addChannel({ root: root(), name: `n${i}`, role: "I" });

  const empty = device(await rosterFlow.identity(passphrase.generatePhrase()));
  await empty.roster.create();

  equal(
    "⭐ five channels and none are the same number of bytes",
    String((await cachedBlob(one.storage)).length),
    String((await cachedBlob(empty.storage)).length)
  );
  equal("and it is §7.3's 16 KiB plus the AEAD's IV and tag", String(rosters.ROSTER_SIZE + 28), "16412");
}

// ========================================================== §7.3.1a disappearance

section("§7.3.1a — what a device does when its conversations are gone");

{
  // Two devices, one phrase — §7.2's actual product. A deletes; B finds out.
  const keys = await rosterFlow.identity(passphrase.generatePhrase());
  const A = device(keys);
  await A.roster.create();
  const r1 = root();
  const r2 = root();
  await A.roster.addChannel({ root: r1, name: "one", role: "I" });
  await A.roster.addChannel({ root: r2, name: "two", role: "J" });

  const seen = [];
  const bStorage = memStorage();
  const bDurable = memStorage();
  const B = rosterFlow.openRoster({
    api,
    keys,
    storage: bStorage,
    durable: bDurable,
    onDisappeared: (change) => seen.push(change),
  });
  await B.load({ network: true, reason: rosterFlow.SETUP });
  equal("B sees both conversations", String(B.channels().length), "2");

  await A.roster.removeChannel(r1);
  await A.roster.removeChannel(r2);

  await B.check();
  equal("⭐⭐ B is told, once, that more than one went at a time", String(seen.length), "1");
  equal("and §7.3.1a calls that suspect rather than a deletion", seen[0]?.kind, "suspect");
  equal("with both entries in hand for the quarantine", String(seen[0]?.removed.length), "2");
  equal("the list itself is empty now", String(B.channels().length), "0");
}

{
  // ⚠️⚠️ THE ORDER IS THE WHOLE VALUE OF THE QUARANTINE, and this is the check
  // that holds it. §7.3.1a's entries must be held BEFORE the new roster is cached:
  // cache first, crash, and the device comes back with the deletion adopted, the
  // entries never held, and no undo and no notice for the case §7.3.1a itself
  // calls "almost certainly a bug". Same rule as §5.4.3's persist-before-you-
  // acknowledge, about a different object.
  const keys = await rosterFlow.identity(passphrase.generatePhrase());
  const A = device(keys);
  await A.roster.create();
  const roots = [root(), root()];
  for (const r of roots) await A.roster.addChannel({ root: r, name: "x", role: "I" });

  const storage = memStorage();
  const durable = memStorage();
  const B = rosterFlow.openRoster({
    api,
    keys,
    storage,
    durable,
    onDisappeared: async () => {
      throw new Error("the quarantine could not be written");
    },
  });
  await B.load({ network: true, reason: rosterFlow.SETUP });
  const before = await cachedBlob(storage);

  for (const r of roots) await A.roster.removeChannel(r);

  let threw = null;
  try {
    await B.check();
  } catch (err) {
    threw = err;
  }
  check("⭐⭐ a quarantine that cannot be written stops the fetch", threw !== null, threw?.message);
  equal("⭐⭐⭐ and the device still holds its conversations", String(B.channels().length), "2");
  equal("because the cache was never overwritten", await cachedBlob(storage), before);
}

// ================================================================ §7.8's split

section("§7.8 — the store that survives an ending, and the one that does not");

{
  // ⚠️⚠️ THE HIGH-WATER MARK IS THE ONE THING §7.8 KEEPS, and the reason is that
  // clearing it manufactures the precondition for §7.3.2's rollback: a device with
  // no local version accepts whatever the server offers. An app that held both in
  // one store would reset rollback detection every time somebody ended a session —
  // so the signature refuses to guess which store the caller meant.
  let refused = null;
  try {
    rosterFlow.openRoster({ api, keys: keysA, storage: memStorage() });
  } catch (err) {
    refused = err;
  }
  check("⭐⭐ a roster cannot be opened with one store by accident", refused instanceof RangeError, refused?.message);

  const both = device(await rosterFlow.identity(passphrase.generatePhrase()));
  await both.roster.create();
  check("the cached blob is in the store an ending clears", both.storage.keys().some((k) => k.endsWith(".blob")));
  check("and the high-water mark is in the store it does not", both.durable.keys().some((k) => k.endsWith(".hwm")));
  check(
    "⭐ neither store holds the other's record",
    !both.storage.keys().some((k) => k.endsWith(".hwm")) && !both.durable.keys().some((k) => k.endsWith(".blob"))
  );
}

done();
