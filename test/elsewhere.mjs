// D-168 — what this client can say about a SECOND HOLDER OF THE KEY, and what it may not.
//
// ⚠️⚠️ THE ONLY THING FAKED HERE IS THE TRANSPORT, which is `binding.mjs`'s and
// `relay.mjs`'s reason and the same reason again: `e2e-roster.mjs` proves the honest path
// against the real Go server and CANNOT run in the published client repository — there is
// no `../server` there. The detection this file guards is the product's whole answer to
// the fault Hannu measured on 2026-08-26, and a guard for it that a stranger who clones
// `hannu64/haamu-client` and types `./test.sh` does not run is a guard for nobody.
//
// ⚠️ NO ARGON2 AND NO WASM. §7.2's Argon2id turns a PHRASE into `K_master`; everything
// this file needs hangs off `K_master` itself, so a random 32 bytes stands in for the
// phrase and the derivation below is the real one.
//
// ⭐ WHAT IT IS ABOUT. §7.3.1 rule 1 and D-045 put concurrent multi-device out of scope,
// and it cannot be enforced: every holder of `K_master` is a fully authoritative writer,
// there is no device list, and there is nothing to revoke. So the client cannot STOP a
// second device — it can only notice one, and the noticing is a single comparison:
//
//     the sealed roster's own version rose, and this device did not raise it.
//
// Everything below is about the two halves of that sentence being load-bearing.

import { randomBytes } from "../src/crypto/random.js";
import { utf8String } from "../src/crypto/bytes.js";
import { b64uEncode } from "../src/crypto/b64u.js";
import { ApiError } from "../src/net/api.js";
import * as passphrase from "../src/protocol/passphrase.js";
import * as rosterFlow from "../src/flow/roster.js";
import { check, equal, section, done } from "./harness.mjs";

/** A roster row in memory: one blob, one compare-and-swap counter, no crypto. */
function fakeServer() {
  const state = { blob: null, version: 0, killNextPut: false };
  const api = {
    async signed(method, path, { bodyBytes } = {}) {
      const body = bodyBytes === undefined ? undefined : JSON.parse(utf8String(bodyBytes));
      if (method === "GET") {
        if (state.blob === null) throw new ApiError(404, "not_found");
        return { blob: state.blob, version: state.version };
      }
      if (method === "POST") {
        if (state.blob !== null) throw new ApiError(409, "identity_exists");
        state.blob = body.blob;
        state.version = 1;
        return { version: 1 };
      }
      if (method === "PUT") {
        // §7.3.1's compare-and-swap, which is the whole of what the server does here.
        if (body.if_match !== state.version) throw new ApiError(409, "version_conflict");
        state.blob = body.blob;
        state.version += 1;
        // ⚠️⚠️ THE SERVER HAS COMMITTED AND THE CLIENT NEVER HEARS. ARCHITECTURE §4.2.3's
        // measured hazard is exactly this — a phone freezing a background tab with a
        // request in flight — and a lost response does it just as well.
        if (state.killNextPut) {
          state.killNextPut = false;
          throw new Error("the tab was frozen; the response never arrived");
        }
        return { version: state.version };
      }
      throw new ApiError(405, "method_not_allowed");
    },
    async powChallenge() {
      return { challenge: "", bits: 0 };
    },
  };
  // §7.3.2 rule 3's shape: the counter moves and the sealed blob does not. A server can
  // do this for free; nothing but `rosterKey` can move the version INSIDE the blob.
  const bumpCounterOnly = () => (state.version += 1);
  return { state, api, bumpCounterOnly };
}

const { identityDigest } = await import("../src/storage/vault.js");

const memStore = () => {
  const m = new Map();
  // D-170: the keys whose record EXISTS and will not open — another identity's, or
  // damaged. `storage/vault.js` answers this with `attempt`; a `Map` has to be told.
  const jammed = new Set();
  return {
    // ⚠️ IT THROWS ON A JAMMED KEY, BECAUSE `storage/vault.js`'s `get` DOES. A fake
    // whose `get` sailed past the case the fix is about would let the fix be reverted
    // with every check still green.
    get: async (k) => {
      if (jammed.has(k)) throw new Error("fake: this record does not open under this local_key");
      return m.has(k) ? m.get(k) : null;
    },
    set: async (k, v) => void m.set(k, v),
    delete: async (k) => void m.delete(k),

    /**
     * The three-state read `storage/vault.js` grew for D-170, over a Map.
     *
     * ⚠️ `found: true, ours: false` IS THE STATE THE WHOLE FIX IS ABOUT and a fake
     * that could not produce it would be a fake that agrees with the code by being
     * unable to disagree.
     */
    attempt: async (k) => {
      if (jammed.has(k)) return { found: true, ours: false, value: null };
      if (!m.has(k)) return { found: false, ours: false, value: null };
      return { found: true, ours: true, value: m.get(k) };
    },
    jam: (k) => void jammed.add(k),
    unjam: (k) => void jammed.delete(k),
    // §7.8's two endings, as the two calls that separate them: the ordinary one clears
    // `CONVERSATION` and leaves `DURABLE` standing, and step 5's `Clear-Site-Data` takes
    // both. Nothing in `flow/roster.js` calls this; the tests below are the ending.
    wipe: () => m.clear(),
    empty: () => m.size === 0,
  };
};

/** One phrase, two devices: shared keys, separate caches. §7.2 produces exactly this. */
const device = (api, keys) => rosterFlow.openRoster({ api, keys, storage: memStore(), durable: memStore() });

const kinds = (roster) => roster.takeWarnings().map((w) => w.kind);
const elsewhereIn = (list) => list.filter((k) => k === "elsewhere").length;

const keys = await passphrase.deriveRosterKeys(randomBytes(32));
const root = (n) => new Uint8Array(32).fill(n);

// ============================================================================

section("D-168 — the version inside the sealed blob is what says another device wrote");

{
  const server = fakeServer();
  const a = device(server.api, keys);
  const b = device(server.api, keys);

  await a.create();
  await b.load({ network: true });

  // ⚠️ A DEVICE THAT HAS JUST MET THE ROSTER FOR THE FIRST TIME HAS NO BASELINE, and
  // the check must not invent one. §7.3.2 makes the same point about the high-water mark.
  equal("a first read raises nothing — there is nothing to have risen from", kinds(b).join(","), "");

  await a.addChannel({ root: root(1), name: "one", role: "I" });
  equal("⭐ and a device is never told about its own write", kinds(a).join(","), "");

  await b.check();
  const seen = kinds(b);
  check(`⛔⛔ the other device's write reaches B as 'elsewhere' (${seen.join(",") || "nothing"})`, elsewhereIn(seen) === 1, seen.join(","));

}

{
  // ⚠️ §7.3.3 case 5 is rate-limited to one an hour, so a second `check()` on the same
  // instance throws `access_rule` rather than fetching. Every scenario below therefore
  // uses a FRESH pair, which is also the honest shape: these are separate runs.
  const server = fakeServer();
  const a = device(server.api, keys);
  const b = device(server.api, keys);
  await a.create();
  await b.load({ network: true });
  await a.addChannel({ root: root(2), name: "two", role: "I" });
  await b.check();
  kinds(b);

  // §7.3.3 case 2: a channel change fetches without any button being pressed, and the
  // same evidence arrives that way too.
  await a.addChannel({ root: root(3), name: "three", role: "I" });
  await b.addChannel({ root: root(4), name: "four", role: "J" });
  const seen = kinds(b);
  check("⭐ and it does not need the button — a channel change meets it too", elsewhereIn(seen) === 1, seen.join(","));
}

section("§7.3.1's 409 is the same evidence arriving the other way round");

{
  const server = fakeServer();
  const a = device(server.api, keys);
  const b = device(server.api, keys);
  await a.create();
  await b.load({ network: true });
  kinds(a);
  kinds(b);

  // Both hold version 1. B writes; A then writes at a version that is no longer current.
  await b.addChannel({ root: root(5), name: "b's", role: "J" });
  kinds(b);
  await a.addChannel({ root: root(6), name: "a's", role: "I" });

  const seen = kinds(a);
  check("⛔⛔ the 409's refetch is what tells A, and it comes through the same comparison", elsewhereIn(seen) === 1, seen.join(","));

  // ⚠️ AND THE WRITE STILL LANDS. A notice that cost the person their write would be a
  // worse product than the silence it replaced: §7.3.1 merges and retries, and this is
  // the check that the notice was added BESIDE that and not in front of it.
  const names = a.channels().map((c) => c.name).sort().join(",");
  equal("⭐ and A's own addition survived the merge it just heard about", names, "a's,b's");
}

section("⚠️⚠️ it is the INNER version, so a server cannot raise this notice by itself");

{
  const server = fakeServer();
  const a = device(server.api, keys);
  await a.create();
  await a.addChannel({ root: root(7), name: "seven", role: "I" });
  kinds(a);

  const b = device(server.api, keys);
  await b.load({ network: true });
  kinds(b);

  // §7.3.2 rule 3's move: the counter rises, the sealed bytes do not.
  server.bumpCounterOnly();
  await b.check();
  const seen = kinds(b);
  check("⛔⛔ a counter the server moved on its own raises no 'elsewhere'", elsewhereIn(seen) === 0, seen.join(","));
  check("⚠️ and it is not silence either — §7.3.2 rule 3's mismatch is what it IS", seen.includes("version_mismatch"), seen.join(","));
}

{
  // ⚠️⚠️ THE CANARY FOR THE CHECK ABOVE. "No 'elsewhere'" would also pass if the
  // detection had been deleted outright, so the same instrument has to show it firing.
  const server = fakeServer();
  const a = device(server.api, keys);
  const b = device(server.api, keys);
  await a.create();
  await b.load({ network: true });
  kinds(b);
  await a.addChannel({ root: root(8), name: "eight", role: "I" });
  await b.check();
  check("⚠️⚠️ and the same instrument sees it fire when the SEALED version is the one that moved", elsewhereIn(kinds(b)) === 1, "canary");
}

section("what the notice may not become — the limits are in the code, not only the prose");

{
  const server = fakeServer();
  const a = device(server.api, keys);
  await a.create();
  kinds(a);

  // ⚠️ AN EVENT AND NOT A PRESENCE. Reading the same roster again is not another device;
  // if it were, a device that merely re-read on a schedule would accuse itself for ever.
  const b = device(server.api, keys);
  await b.load({ network: true });
  kinds(b);
  await b.check();
  equal("⭐ re-reading an unchanged roster raises nothing", kinds(b).join(","), "");

  // ⚠️ AND IT IS RAISED ONCE PER EVENT, not once per read: `takeWarnings` drains.
  const c = device(server.api, keys);
  await c.load({ network: true });
  kinds(c);
  await a.addChannel({ root: root(9), name: "nine", role: "I" });
  await c.check();
  equal("⭐ and it is drained by the reader — one event, one telling", elsewhereIn(kinds(c)), 1);
  equal("⚠️ so a second drain finds nothing left to say", kinds(c).join(","), "");
}

section("⚠️⚠️ a document that stopped being a client stops being a witness (§4.2.2)");

{
  // ⭐ MEASURED FIRST, THEN RULED. `~/lpm-probes/probe-elsewhere-tabs.mjs` put two tabs of
  // ONE browser on one KEY: the second went dormant exactly as §4.2.2 requires, the first
  // wrote the roster, and the takeover then raised a notice naming "another browser or
  // another device" for what was the tab next door — a case §4.2.2 had already handled
  // properly, with a control. A false alarm is the worst outcome available (§3.5).
  const server = fakeServer();
  const a = device(server.api, keys);
  const b = device(server.api, keys);
  await a.create();
  await b.load({ network: true });
  kinds(b);

  // B goes dormant. From here it touches nothing, so it cannot keep its version current.
  b.forgetBaseline();
  await a.addChannel({ root: root(10), name: "ten", role: "I" });

  await b.check();
  equal("⛔⛔ the first read after waking says nothing — it slept through the interval", kinds(b).join(","), "");

  // ⭐ AND IT IS A ONE-READ SILENCE, NOT AN OFF SWITCH. A genuine second device is caught
  // by the next comparison, because the read above re-established the baseline.
  await a.addChannel({ root: root(11), name: "eleven", role: "J" });
  await b.addChannel({ root: root(12), name: "twelve", role: "J" });
  const seen = kinds(b);
  check("⭐⭐ and the very next one catches a real second device", elsewhereIn(seen) === 1, seen.join(","));
}

{
  // ⚠️ THE OTHER DIRECTION: forgetting the baseline must not suppress §7.3.2's warnings,
  // which are about the SERVER and have nothing to do with which client is awake.
  const server = fakeServer();
  const a = device(server.api, keys);
  await a.create();
  await a.addChannel({ root: root(13), name: "thirteen", role: "I" });
  const b = device(server.api, keys);
  await b.load({ network: true });
  kinds(b);
  b.forgetBaseline();
  server.bumpCounterOnly();
  await b.check();
  check("⚠️⚠️ §7.3.2 rule 3's mismatch is untouched by it", kinds(b).includes("version_mismatch"), "mismatch still raised");
}

// ============================================================================

section("⚠️⚠️ D-169 — the baseline survives the lock, because §7.3.2's mark does");

// ⭐⭐ HANNU MEASURED THIS ON A DEVICE, 2026-08-27: *"the panel came only in the first try
// and stayed until I removed the key but did not come anymore."* The comparison lived in
// memory, and memory is `null` on the first read of every session — which is exactly the
// read most likely to be carrying another device's work. The number was already on disk:
// §7.3.2 keeps the high-water mark in `DURABLE` precisely so that locking cannot erase
// what this device has seen, and the ordinary ending is forbidden from clearing it.

{
  const server = fakeServer();
  // One device, two sessions, one pair of stores — which is what a lock is.
  const storage = memStore();
  const durable = memStore();
  const mine = () => rosterFlow.openRoster({ api: server.api, keys, storage, durable });
  const other = device(server.api, keys);

  const first = mine();
  await first.create();
  check("this device made version 1 and wrote it down", !durable.empty(), "high-water mark recorded");

  await other.load({ network: true });
  check(
    "⛔⛔ a device with no mark of its own claims NOTHING on its first read",
    elsewhereIn(kinds(other)) === 0,
    "a KEY typed into a new browser is not evidence about anybody"
  );

  await other.addChannel({ root: root(20), name: "twenty", role: "I" });

  // §7.8's ORDINARY ending — and the whole point is which of the two stores it may touch.
  storage.wipe();
  check("the ordinary ending took the cached roster", storage.empty(), "conversation store cleared");
  check("⭐⭐ and §7.3.2 forbids it the mark", !durable.empty(), "durable store kept");

  const back = mine();
  await back.load({ network: true, reason: rosterFlow.SETUP });
  check(
    "⭐⭐⭐ so the first read after the lock CAN say another device wrote",
    elsewhereIn(kinds(back)) === 1,
    "elsewhere, from a baseline that outlived the session"
  );
}

{
  // ⚠️⚠️ THE CANARY, AND IT IS WHAT STOPS THE CHECK ABOVE FROM BEING TRUE OF EVERY UNLOCK.
  // Same shape, same wipe, same fresh session — and nobody else wrote in between. A guard
  // that fires here would be announcing a second device to every person who locks and
  // comes back, which is worse than the silence it replaced.
  const server = fakeServer();
  const storage = memStore();
  const durable = memStore();
  const mine = () => rosterFlow.openRoster({ api: server.api, keys, storage, durable });

  const first = mine();
  await first.create();
  await first.addChannel({ root: root(21), name: "twenty-one", role: "I" });
  kinds(first);
  storage.wipe();

  const back = mine();
  await back.load({ network: true, reason: rosterFlow.SETUP });
  check(
    "⚠️⚠️ and a version this device made itself is not another device",
    elsewhereIn(kinds(back)) === 0,
    "locking and coming back to your own work is silent"
  );
}

{
  // ⭐ THE HONEST CONSEQUENCE OF §7.8 STEP 5, which `ui/copy.js` already warns about in as
  // many words: `Clear-Site-Data` takes the high-water mark too, so the device that comes
  // back after one has no baseline and cannot claim. That is the same trade the rollback
  // check makes, stated once here so that a future change cannot quietly assume otherwise.
  const server = fakeServer();
  const storage = memStore();
  const durable = memStore();
  const mine = () => rosterFlow.openRoster({ api: server.api, keys, storage, durable });
  const other = device(server.api, keys);

  await mine().create();
  await other.load({ network: true });
  await other.addChannel({ root: root(22), name: "twenty-two", role: "I" });

  storage.wipe();
  durable.wipe(); // §7.8 step 5 — the thorough ending, the one that warns

  const back = mine();
  await back.load({ network: true, reason: rosterFlow.SETUP });
  check(
    "⚠️ the thorough ending resets the comparison as well as the rollback check",
    elsewhereIn(kinds(back)) === 0,
    "nothing seen, nothing claimed"
  );
}

// ============================================================================

section("⛔⛔⛔ D-169 — a device may not accuse ITSELF of being a second device");

// ⭐⭐⭐ HANNU, 2026-08-27, ON A BROWSER HOLDING A KEY NOBODY ELSE HELD. The panel named
// another browser and another device for his own interrupted write. §7.3.2's high-water
// mark is recorded AFTER the server accepts a write — rule 2 forbids recording a version
// this device has not decrypted — so a device killed in that window has RAISED a version
// it never WROTE DOWN, and every later read finds it and calls it somebody else's.
//
// The approved §7.3.1 sentence has two clauses — *"rise above the highest it has adopted,
// WITHOUT HAVING RAISED IT"* — and until now the client could only check the first.

{
  const server = fakeServer();
  const storage = memStore();
  const durable = memStore();
  const mine = () => rosterFlow.openRoster({ api: server.api, keys, storage, durable });

  const first = mine();
  await first.create();
  await first.addChannel({ root: root(30), name: "thirty", role: "I" });
  kinds(first);

  server.state.killNextPut = true;
  let threw = false;
  await first.setGeneration(root(30), 4).catch(() => (threw = true));
  check("the write reached the server and the answer did not", threw && server.state.version === 3, `server at ${server.state.version}`);

  // The tab is gone. A reload, or the KEY typed back in.
  const back = mine();
  await back.load({ network: false });
  check("⚠️ the cache alone says nothing, as it always did", elsewhereIn(kinds(back)) === 0);
  await back.check();
  check(
    "⛔⛔⛔ AND THE NETWORK READ DOES NOT ACCUSE IT EITHER — those are its own bytes",
    elsewhereIn(kinds(back)) === 0,
    "one device, one KEY, no alarm"
  );
}

{
  // ⚠️⚠️ THE CANARY, AND WITHOUT IT THE CHECK ABOVE COULD BE AN OFF SWITCH. Same
  // interruption, and then a REAL second device writes. The device must still be told.
  const server = fakeServer();
  const storage = memStore();
  const durable = memStore();
  const mine = () => rosterFlow.openRoster({ api: server.api, keys, storage, durable });
  const other = device(server.api, keys);

  const first = mine();
  await first.create();
  await first.addChannel({ root: root(31), name: "thirty-one", role: "I" });
  kinds(first);

  server.state.killNextPut = true;
  await first.setGeneration(root(31), 4).catch(() => {});

  await other.load({ network: true });
  kinds(other);
  await other.addChannel({ root: root(32), name: "thirty-two", role: "I" });

  const back = mine();
  await back.load({ network: false });
  await back.check();
  check(
    "⭐⭐ a genuine second device is still announced, interruption or no interruption",
    elsewhereIn(kinds(back)) === 1,
    "the silence is one blob wide, not a switch"
  );
}

{
  // ⭐⭐⭐ WHY IT IS THE BLOB AND NOT THE NUMBER. This device attempts version N+1 and is
  // beaten to it by another device, which makes a DIFFERENT N+1. Comparing numbers would
  // read its own attempt in somebody else's write and say nothing — a false silence, which
  // D-168 rules is the worse of the two errors. Two devices cannot produce the same sealed
  // bytes: `sealRoster` picks a fresh nonce every time.
  const server = fakeServer();
  const a = device(server.api, keys);
  const b = device(server.api, keys);

  await a.create();
  await b.load({ network: true });
  kinds(a);
  kinds(b);

  // Both are holding version 1 and both go to write version 2. `b` gets there first.
  await b.addChannel({ root: root(33), name: "b's", role: "I" });
  await a.addChannel({ root: root(34), name: "a's", role: "I" });

  check(
    "⛔⛔ the loser of the compare-and-swap is told, even though it attempted that very number",
    elsewhereIn(kinds(a)) === 1,
    "same version, different bytes, still another device"
  );
}

// ============================================================================

section("⛔⛔ D-170 — an unreadable record is not an absent one, and only ONE of them may be treated as one");

// ⭐⭐ HANNU MET THIS ON A DEVICE, 2026-08-27: three of seven KEYs would not open in one
// Firefox profile, and the whole of what the product could tell him was *"Something went
// wrong, and this device could not say what."* The refusal was CORRECT — see below — and
// indistinguishable from a crash, which is the part that was wrong.

{
  const server = fakeServer();
  const storage = memStore();
  const durable = memStore();
  const mine = () => rosterFlow.openRoster({ api: server.api, keys, storage, durable });

  const first = mine();
  await first.create();
  // The roster cache is a copy of something the server still holds, so a device that
  // cannot read it is in a state it already knows how to be in: the state every new
  // device is in.
  const k = `lpm.roster.${await identityDigest(keys.rosterId)}`;
  storage.jam(`${k}.blob`);
  // ⚠️ CAUGHT, so that reverting this to `get` reads as a named failure rather than
  // killing the runner — and so the two halves of D-170's split are checked the same
  // way, one asserting a refusal and one asserting the absence of a refusal.
  let offline = "(threw)";
  try {
    offline = await mine().load();
  } catch {
    /* left as "(threw)" */
  }
  equal("⭐ a cached roster that will not open reads as NO cached roster", String(offline), "null");
  const online = await mine().load({ network: true, reason: rosterFlow.SETUP });
  check("⭐⭐ so the caller fetches, exactly as a new device does, and the person sees their list",
    online !== null && online.channels.length === 0, "refetched");
  storage.unjam(`${k}.blob`);
}

{
  const server = fakeServer();
  const storage = memStore();
  const durable = memStore();
  const mine = () => rosterFlow.openRoster({ api: server.api, keys, storage, durable });
  await mine().create();

  const k = `lpm.roster.${await identityDigest(keys.rosterId)}`;
  durable.jam(`${k}.hwm`);

  // ⛔⛔ §7.3.2 SAYS THE OPPOSITE ABOUT ITS OWN MARK: *"a device unlocking with no local
  // history has no high-water mark, which is exactly where the attack aims."* Reading an
  // unreadable mark as "no mark" would not be recovering from damage — it would be
  // manufacturing the rollback precondition, quietly, on the unlock path, every time.
  let raised = null;
  try {
    await mine().load({ network: true, reason: rosterFlow.SETUP });
  } catch (err) {
    raised = err;
  }
  check("⛔⛔ an unreadable high-water mark REFUSES — it is not read as an absent one", raised !== null);
  equal("⭐⭐ and it refuses by NAME, so the sentence can say which thing is damaged",
    raised?.reason ?? "(none)", "record_unreadable");
  equal("⭐ naming the record itself, for the panel a tester reads out", raised?.which ?? "(none)", "hwm");

  durable.unjam(`${k}.hwm`);
  const fine = await mine().load({ network: true, reason: rosterFlow.SETUP });
  check("⚠️ and the refusal is the damage's and not a latch — an intact mark opens", fine !== null);
}

{
  // ⚠️ THE SAME RULE FOR THE SAME STORE. D-169's note about this device's own last write
  // lives in `DURABLE` beside the mark; a device that cannot read it can check neither
  // clause of §7.3.1's sentence, and has no third answer available that is honest.
  const server = fakeServer();
  const storage = memStore();
  const durable = memStore();
  const mine = () => rosterFlow.openRoster({ api: server.api, keys, storage, durable });
  const a = mine();
  await a.create();

  const other = device(server.api, keys);
  await other.load({ network: true });
  await other.addChannel({ root: root(4), name: "theirs", role: "I" });

  const k = `lpm.roster.${await identityDigest(keys.rosterId)}`;
  durable.jam(`${k}.sent`);
  let raised = null;
  try {
    await a.check();
  } catch (err) {
    raised = err;
  }
  equal("⛔ the note about our own last write refuses in the same way and for the same reason",
    raised?.reason ?? "(none)", "record_unreadable");
  equal("and names itself too", raised?.which ?? "(none)", "sent");
}

done();
