// What reaches disk — PROTOCOL.md §7.2's `local_key`, §7.6's Ghost rule, §7.8's
// two categories, §6.6's TTL, and ARCHITECTURE.md §4.1's storage table.
//
// No browser. `storage/db.js` ships a Map-backed handle with the same key ordering
// as IndexedDB, so the layer where a silent bug lives — the one that decides what
// is encrypted, under which key, and in which store — is tested here, and
// `test/browser-storage.mjs` then only has to show that the real IndexedDB behaves
// like it. That split is deliberate: a check that runs in a browser runs once,
// slowly, and says "something in this stack works"; these say which thing.

import { randomBytes } from "../src/crypto/random.js";
import { utf8Bytes } from "../src/crypto/bytes.js";
import * as db from "../src/storage/db.js";
import * as vault from "../src/storage/vault.js";
import * as sessions from "../src/storage/sessions.js";
import * as quarantine from "../src/flow/quarantine.js";
import * as pair from "../src/flow/pair.js";
import * as rosterFlow from "../src/flow/roster.js";
import { readFileSync } from "node:fs";
import { check, equal, rejects, section, done } from "./harness.mjs";

const localKey = randomBytes(32);
const other = randomBytes(32);
const open = () => vault.openVault({ db: db.memoryDatabase(), localKey });

/**
 * Does this byte string contain that one?
 *
 * ⚠️ Not `utf8String(bytes).includes(...)` — ciphertext is not valid UTF-8 and the
 * decoder is fatal, so the natural way to write this check throws instead of
 * failing, which reads as a broken test rather than as a leak.
 */
function contains(haystack, needle) {
  const n = utf8Bytes(needle);
  outer: for (let i = 0; i + n.length <= haystack.length; i++) {
    for (let j = 0; j < n.length; j++) if (haystack[i + j] !== n[j]) continue outer;
    return true;
  }
  return false;
}

// ============================================================ the record layer

section("§7.2 — local_key, and what a record looks like on disk");

{
  const v = open();
  await v.conversation.set("lpm.session.abc", { generation: 3, pickle: "AAAA" });
  const back = await v.conversation.get("lpm.session.abc");
  equal("a record round-trips", String(back.generation), "3");

  const raw = await v.db.get(db.CONVERSATION, "lpm.session.abc");
  check("⭐ and what is actually stored is bytes, not the object", raw instanceof Uint8Array);
  check(
    "⭐⭐ with no plaintext of the record in them",
    !contains(raw, "AAAA") && !contains(raw, "generation"),
    `${raw.length} bytes`
  );

  equal("a key that was never written reads as null", String(await v.conversation.get("nothing")), "null");
}

{
  // The whole point of deriving the key from `K_master` (§7.2) rather than
  // generating one and storing it beside the ciphertext: a device that is not
  // unlocked cannot read its own session state, which is what makes §11's
  // "device theft, locked" row true of the stored ratchet.
  const one = db.memoryDatabase();
  const mine = vault.openVault({ db: one, localKey });
  const theirs = vault.openVault({ db: one, localKey: other });
  await mine.conversation.set("k", { secret: "value" });
  await rejects("⭐⭐ another key cannot read the record", () => theirs.conversation.get("k"), /.*/);
}

{
  // §0.2's AEAD gives every record its own IV; the AAD gives it its own SLOT. An
  // attacker who can write to IndexedDB but cannot read `local_key` would
  // otherwise be able to move channel A's session state onto channel B — where it
  // authenticates perfectly, because nothing in the ciphertext says where it
  // belongs.
  const one = db.memoryDatabase();
  const v = vault.openVault({ db: one, localKey });
  await v.conversation.set("lpm.session.aaa", { pickle: "A" });
  const moved = await one.get(db.CONVERSATION, "lpm.session.aaa");
  await one.put(db.CONVERSATION, "lpm.session.bbb", moved);
  await rejects(
    "⭐⭐ a record moved to another key does not open there",
    () => v.conversation.get("lpm.session.bbb"),
    /.*/
  );
  const still = await v.conversation.get("lpm.session.aaa");
  equal("and still opens where it belongs", still.pickle, "A");
}

{
  // ⚠️ THE RESIDUAL, TESTED SO IT CANNOT BE FORGOTTEN. Binding the slot does not
  // stop ROLLBACK: an earlier version of the same record authenticates perfectly
  // under the same key and the same slot. §7.3.2 solves this for the roster with a
  // high-water mark and there is no equivalent for a session pickle — an Olm
  // ratchet driven backwards re-uses message keys. What stands between an attacker
  // and this is holding the device, and the comment in `vault.js` says so.
  const one = db.memoryDatabase();
  const v = vault.openVault({ db: one, localKey });
  await v.conversation.set("k", { step: 1 });
  const old = await one.get(db.CONVERSATION, "k");
  await v.conversation.set("k", { step: 2 });
  await one.put(db.CONVERSATION, "k", old);
  equal("⚠️ an OLD version of the same record still opens — rollback is not closed", String((await v.conversation.get("k")).step), "1");
}

// ================================================================ §7.8's split

section("§7.8 — what an ending clears");

{
  const one = db.memoryDatabase();
  const v = vault.openVault({ db: one, localKey });
  await v.conversation.set("lpm.session.x", { pickle: "p" });
  await v.durable.set("lpm.roster.x.hwm", 44);
  await v.messages.append("chan", { dir: "in", text: "hei", firstSeen: 1000 });

  await v.endSession();

  equal("conversation state is gone", String(await v.conversation.get("lpm.session.x")), "null");
  equal("so is the message history", String((await v.messages.list("chan")).length), "0");
  equal("⭐⭐ and §7.3.2's high-water mark is NOT", String(await v.durable.get("lpm.roster.x.hwm")), "44");

  await v.clearEverything();
  equal(
    "⚠️ the thorough ending does take it — which is why §7.8 makes it warn",
    String(await v.durable.get("lpm.roster.x.hwm")),
    "null"
  );
}

{
  /*
    ⚠️⚠️ THE ORDINARY ENDING ENDS **ONE** IDENTITY. Until 2026-08-24 it called
    `db.clear(ENDING_CLEARS)`, which empties whole object stores — so a browser
    holding two identities lost both when either ended, and what the other lost was
    unrecoverable: its messages had been acknowledged and deleted from the server the
    moment they arrived (§5.4.1). §7.8 reserves that reach for the THOROUGH ending,
    which is a different control with its own warning.

    ⭐⭐ AND THE RULE WAS ALREADY IN `vault.js`, IN THE METHOD NEXT DOOR. `sweep()`
    has always skipped a record it cannot open, with the reason spelled out: *"Not
    ours — another identity in this browser... deleting what we cannot read would let
    any identity wipe another's history."* The method that runs every few minutes
    obeyed it; the one that runs once and cannot be undone did not.
    ➡️ **A RULE STATED AT ONE CALL SITE IS NOT A RULE.**
  */
  const one = db.memoryDatabase();
  const mine = vault.openVault({ db: one, localKey });
  const theirs = vault.openVault({ db: one, localKey: other });

  await mine.conversation.set("lpm.session.mine", { pickle: "M" });
  await mine.messages.append("chanM", { dir: "in", text: "minun", firstSeen: 1000 });
  await theirs.conversation.set("lpm.session.theirs", { pickle: "T" });
  await theirs.messages.append("chanT", { dir: "in", text: "heidän", firstSeen: 1000 });

  const outcome = await mine.endSession();

  equal("this identity's session state is gone", String(await mine.conversation.get("lpm.session.mine")), "null");
  equal("and its message history", String((await mine.messages.list("chanM")).length), "0");

  check("⭐⭐⭐ THE OTHER IDENTITY'S SESSION STATE IS STILL THERE",
    (await theirs.conversation.get("lpm.session.theirs"))?.pickle === "T");
  const survivors = await theirs.messages.list("chanT");
  equal("⭐⭐⭐ AND SO IS ITS MESSAGE HISTORY, which nothing could have recovered",
    survivors.map((m) => m.text).join(), "heidän");

  equal("the ending reports how much was not its own to delete", String(outcome.left), "2");

  // ⚠️ AND THE THOROUGH ENDING STILL REACHES EVERYTHING. That is not an oversight
  // in the other direction: §7.8 step 5 is the control that says so and warns.
  await theirs.clearEverything();
  equal("⭐ the thorough ending is still total", String((await theirs.messages.list("chanT")).length), "0");
}

{
  /*
    ⚠️⚠️ AND IT IS STILL **ONE TRANSACTION**, which is the fix this one could have
    undone. `db.clear`'s own comment records why: a browser killed between two
    transactions leaves a HALF-ENDED identity, whose message rows become readable
    again under the re-derived `local_key` on a device whose owner was told they were
    gone. A loop of `delete()` calls would have scoped the ending correctly and
    reintroduced exactly that. ➡️ **A FIX THAT SATISFIES THE NEW REQUIREMENT BY
    DISCARDING THE OLD ONE IS NOT A FIX.**
  */
  const calls = [];
  const one = db.memoryDatabase();
  const counted = new Proxy(one, {
    get(target, prop) {
      const v = target[prop];
      if (typeof v !== "function") return v;
      return (...args) => (calls.push(prop), v.apply(target, args));
    },
  });
  const v = vault.openVault({ db: counted, localKey });
  await v.conversation.set("a", { x: 1 });
  await v.messages.append("c", { dir: "in", text: "t", firstSeen: 1 });
  calls.length = 0;
  await v.endSession();

  equal("⭐⭐ the ordinary ending issues ONE batched delete across the stores",
    String(calls.filter((c) => c === "deleteAll").length), "1");
  equal("⭐⭐ and never `clear`, which is the whole-store reach it just gave up",
    String(calls.filter((c) => c === "clear").length), "0");
  equal("⭐ nor a delete per row, which would drop the atomicity",
    String(calls.filter((c) => c === "delete").length), "0");

  calls.length = 0;
  await v.clearEverything();
  equal("⚠️ while the THOROUGH ending still uses `clear`, deliberately",
    String(calls.filter((c) => c === "clear").length), "1");
}

{
  // The list is in one place and both endings read it, so "clear conversation
  // state" cannot drift from what §7.8 enumerates.
  check("the ordinary ending names two of the three stores", db.ENDING_CLEARS.length === db.STORES.length - 1);
  check("and DURABLE is the one it leaves", !db.ENDING_CLEARS.includes(db.DURABLE));
}

// ============================================================== §6.6's message TTL

section("§6.6 — 24 hours after FIRST RECEIPT, not after sent_at");

{
  const v = open();
  const chan = "aGFzaA";
  await v.messages.append(chan, { dir: "in", text: "one", firstSeen: 1000, sentAt: 5 });
  await v.messages.append(chan, { dir: "out", text: "two", firstSeen: 1001, sentAt: 999999 });

  const log = await v.messages.list(chan);
  equal("history comes back in arrival order", log.map((m) => m.text).join(","), "one,two");
  check(
    "⭐ and the order is arrival, not the peer's clock (§6.7 rule 2)",
    log[0].sentAt < log[1].sentAt === false || log[0].seq < log[1].seq,
    "the second message claims to have been sent long after the first"
  );

  // A message that waited five days on the server (§5.4's retention) arrives older
  // than its own TTL. Deleting on `sent_at` would destroy it before it was read —
  // which is why §6.6 says this is a required change and not a preference.
  const late = { dir: "in", text: "late", firstSeen: 2000, sentAt: 1 };
  await v.messages.append(chan, late);
  equal("a message sent long ago is not born expired", String((await v.messages.list(chan)).length), "3");

  const now = 1000 + vault.MESSAGE_TTL_S;
  equal("the sweep takes exactly what is due", String(await v.messages.sweep(now)), "1");
  equal("and leaves the rest", (await v.messages.list(chan)).map((m) => m.text).join(","), "two,late");
}

{
  // ⚠️ `first_seen` is inside the ciphertext, so a sweep needs `local_key` — which
  // means another identity's history cannot be swept by this one. That is the
  // property that keeps two people sharing a browser from wiping each other, and
  // it is the reason the sweep skips what it cannot read instead of deleting it.
  const one = db.memoryDatabase();
  const mine = vault.openVault({ db: one, localKey });
  const theirs = vault.openVault({ db: one, localKey: other });
  await mine.messages.append("c", { dir: "in", text: "mine", firstSeen: 0 });
  await theirs.messages.append("c", { dir: "in", text: "theirs", firstSeen: 0 });

  equal("⭐ a sweep deletes only what this identity can read", String(await mine.messages.sweep(1e9)), "1");
  equal("the other identity's history is untouched", String((await theirs.messages.list("c")).length), "1");
}

{
  const v = open();
  await v.messages.append("a", { dir: "in", text: "1", firstSeen: 0 });
  await v.messages.append("b", { dir: "in", text: "2", firstSeen: 0 });
  await v.messages.forget("a");
  equal("forgetting one channel leaves the other", String((await v.messages.list("b")).length), "1");
  equal("and takes its own", String((await v.messages.list("a")).length), "0");
}

// ================================================================== Ghost mode

section("§7.6 — Ghost mode writes to sessionStorage and nowhere else");

{
  const fake = new Map();
  const sessionStorage = {
    getItem: (k) => (fake.has(k) ? fake.get(k) : null),
    setItem: (k, v) => fake.set(k, v),
    removeItem: (k) => fake.delete(k),
  };
  const ghost = vault.ghostStore(sessionStorage);
  await ghost.set("root", { role: "I", generation: 2 });
  equal("Ghost state round-trips", String((await ghost.get("root")).generation), "2");
  check("under a prefixed key in sessionStorage", [...fake.keys()].every((k) => k.startsWith("lpm.ghost.")));

  // ⚠️ AND IT IS NOT ENCRYPTED, which is the honest position rather than an
  // oversight: there is no `K_master` in Ghost mode, so any key would live in the
  // same `sessionStorage` as the state it protects. §7.6's defence is that this
  // store is measured not to survive process death on either platform tested — not
  // that anything in it is unreadable while it is there.
  check("and it is plaintext, which §7.6 does not pretend otherwise about", fake.get("lpm.ghost.root").includes('"I"'));

  check(
    "⭐⭐ the Ghost store speaks the same interface as the sealed one",
    ["get", "set", "delete", "read", "write"].every(
      (m) => typeof ghost[m] === "function" && typeof open().conversation[m] === "function"
    ),
    "so a channel does not know which mode it is running in — the app picks the store, once"
  );
}

// ============================================================= session records

section("§6.3, §5.4.2 — the channel record over a real backend");

{
  const v = open();
  const root = randomBytes(32);
  const empty = await sessions.loadRecord(v.conversation, root);
  equal("an untouched channel reads as an empty record", String(empty.record.generation), "0");
  equal("with no token, meaning “there must be nothing here”", String(empty.token), "null");

  await sessions.saveRecord(
    v.conversation,
    root,
    { ...empty.record, generation: 4, sessions: { s: { pickle: "P" } } },
    empty.token
  );
  const back = await sessions.loadRecord(v.conversation, root);
  equal("⭐ and it survives, which is what a reload needed", String(back.record.generation), "4");

  const key = await sessions.channelKey(root);
  check("under a hash of the root and never the root itself", !key.includes(Buffer.from(root).toString("base64")), key);

  await sessions.forgetChannel(v.conversation, root);
  equal(
    "forgetting a channel empties it",
    String((await sessions.loadRecord(v.conversation, root)).record.generation),
    "0"
  );
}

// ================================================= §6.7.1 — the closed marker

// ⚠️ IT IS A SEPARATE KEY RATHER THAN A FIELD ON THE SESSION RECORD, and that is
// the property worth asserting: §6.3's rules rotate, prune and rebuild that record
// as a matter of course, and a peer who has left is still gone after a rotation.

section("§6.7.1 — the closed marker outlives the session record");

{
  const v = open();
  const root = randomBytes(32);

  equal("a channel starts open", String(await sessions.loadClosed(v.conversation, root)), "null");

  await sessions.markClosed(v.conversation, root, 1754000000);
  equal(
    "and remembers when the other person left",
    String((await sessions.loadClosed(v.conversation, root)).at),
    "1754000000"
  );

  // The session record being replaced is ordinary §6.3 behaviour, and it must not
  // reopen a conversation whose other end is gone.
  const held = await sessions.loadRecord(v.conversation, root);
  await sessions.saveRecord(v.conversation, root, { ...held.record, generation: 7 }, held.token);
  check("⭐ rewriting the session record does not clear it", await sessions.loadClosed(v.conversation, root));

  // §6.7.1 rule 8: a client of this protocol cannot send after closing, so anything
  // arriving afterwards is a hostile or broken peer — and hiding it behind "they
  // have left" would be the client lying about its own screen.
  await sessions.clearClosed(v.conversation, root);
  equal(
    "⭐ and a later message from that peer reopens it",
    String(await sessions.loadClosed(v.conversation, root)),
    "null"
  );

  await sessions.markClosed(v.conversation, root, 1754000000);
  await sessions.forgetChannel(v.conversation, root);
  equal(
    "⚠️ deleting the conversation takes the marker with it, not only the record",
    String(await sessions.loadClosed(v.conversation, root)),
    "null"
  );
}

{
  const v = open();
  const root = randomBytes(32);
  await v.conversation.set(await sessions.channelKey(root), { v: 99, generation: 1 });
  await rejects(
    "a record from a future version of this app is refused, not guessed at",
    () => sessions.loadRecord(v.conversation, root),
    /unsupported record version/
  );
}

// ====================================================== 0.8.12 — a second writer

section("§6, 0.8.12 — the store is shared between tabs, and a lost update is key reuse");

{
  // ⚠️⚠️ THE FAILURE THIS PREVENTS IS NOT A LOST MESSAGE, IT IS A REUSED CHAIN KEY.
  // Two tabs load the same record, each advances the ratchet, each stores. Without
  // the token the second store simply wins and the first advance is forgotten — so
  // the next send encrypts under a message key that has already been used, which
  // for AES-CBC hands anyone holding both ciphertexts their XOR. `flow/message.js`
  // has always ordered its writes to survive a CRASH; a second writer is not a
  // crash, and no ordering addresses it.
  const v = open();
  const root = randomBytes(32);
  await sessions.saveRecord(v.conversation, root, { ...sessions.emptyRecord(), generation: 1 }, null);

  const tabA = await sessions.loadRecord(v.conversation, root);
  const tabB = await sessions.loadRecord(v.conversation, root);
  equal("two tabs read the same record", tabA.token.length === tabB.token.length ? "same" : "different", "same");

  await sessions.saveRecord(v.conversation, root, { ...tabA.record, generation: 2 }, tabA.token);
  await rejects(
    "⭐⭐ and the second write is REFUSED rather than silently winning",
    () => sessions.saveRecord(v.conversation, root, { ...tabB.record, generation: 99 }, tabB.token),
    /changed under this write/
  );
  equal(
    "the first tab's advance is still there",
    String((await sessions.loadRecord(v.conversation, root)).record.generation),
    "2"
  );

  // And the refusal is answerable: read again, and the write lands.
  const again = await sessions.loadRecord(v.conversation, root);
  await sessions.saveRecord(v.conversation, root, { ...again.record, generation: 3 }, again.token);
  equal(
    "⭐ re-reading is the whole of the fix — this is what flow/message.js does",
    String((await sessions.loadRecord(v.conversation, root)).record.generation),
    "3"
  );
}

{
  // The same rule one layer down, where a caller cannot reach it.
  const one = db.memoryDatabase();
  await one.put(db.CONVERSATION, "k", new Uint8Array([1, 2, 3]));
  await rejects(
    "swap refuses when the stored bytes are not the expected bytes",
    () => one.swap(db.CONVERSATION, "k", { expect: new Uint8Array([9, 9, 9]), value: new Uint8Array([4]) }),
    /changed under this write/
  );
  await rejects(
    "⭐ and “I expected nothing here” is a real expectation, not a wildcard",
    () => one.swap(db.CONVERSATION, "k", { expect: null, value: new Uint8Array([4]) }),
    /changed under this write/
  );
  await one.swap(db.CONVERSATION, "k", { expect: new Uint8Array([1, 2, 3]), value: new Uint8Array([4]) });
  equal("with the right bytes it writes", String((await one.get(db.CONVERSATION, "k"))[0]), "4");
}

{
  // ⚠️ A DIFFERENT FAILURE WITH A DIFFERENT FIX. The message log picks its own key,
  // so two tabs appending at once choose the same `seq` — and `put` would let the
  // second REPLACE the first. That is a received message vanishing with the sender
  // told it was delivered and the mailbox row already deleted.
  const one = db.memoryDatabase();
  await one.add(db.MESSAGES, ["chan", 0], new Uint8Array([1]));
  await rejects(
    "⭐⭐ add refuses an occupied slot instead of overwriting it",
    () => one.add(db.MESSAGES, ["chan", 0], new Uint8Array([2])),
    /already exists/
  );

  // ⚠️ CONCURRENTLY, WHICH IS THE ONLY WAY THIS SAYS ANYTHING. Appending one after
  // the other works with `put` too — both tabs have to be choosing their sequence
  // number at the same time for the collision to exist at all.
  const v = vault.openVault({ db: one, localKey });
  await Promise.all([
    v.messages.append("other", { dir: "in", text: "first", firstSeen: 1 }),
    v.messages.append("other", { dir: "in", text: "second", firstSeen: 1 }),
  ]);
  const log = await v.messages.list("other");
  equal("⭐⭐ and both messages survive", log.map((m) => m.text).sort().join(","), "first,second");
  equal("at distinct sequence numbers", log.map((m) => m.seq).join(","), "0,1");
}


// ====================================== D-170 — one browser is ONE database

section("D-170 — a record's name has to say whose record it is");

/**
 * ⚠️⚠️ THE FAKE HERE IS NOTHING. Two `openVault`s over ONE `memoryDatabase` is
 * exactly what a browser holding two KEYs has, and every fault below was found by
 * building it — not by reading. `~/lpm-probes/probe-two-identities-one-browser.mjs`
 * is the same construction outside the suite.
 */
const twoIdentities = () => {
  const shared = db.memoryDatabase();
  return [
    vault.openVault({ db: shared, localKey: randomBytes(32) }),
    vault.openVault({ db: shared, localKey: randomBytes(32) }),
    shared,
  ];
};

{
  const [A, B] = twoIdentities();
  await A.conversation.set("shared-name", { mine: true });

  const seen = await B.conversation.attempt("shared-name");
  check("⭐ `attempt` has THREE answers, and this is the one two states lose", seen.found && !seen.ours,
    `found=${seen.found} ours=${seen.ours}`);
  const nothing = await B.conversation.attempt("never-written");
  check("nothing there is not the same answer as somebody else's", !nothing.found && !nothing.ours);
  const mine = await A.conversation.attempt("shared-name");
  check("and our own record still reads as ours", mine.ours && mine.value.mine === true);

  await rejects("⚠️ `get` still THROWS, which is right for every caller that has not decided",
    () => B.conversation.get("shared-name"), /.*/);
}

{
  // ⛔⛔ THE LOCKOUT ITSELF. Before D-170 the quarantine lived at one name for the
  // whole browser, `sweep()` runs on every unlock, and `records.get` throws on a
  // record it cannot open — so identity A quarantining a conversation refused
  // identity B entry to its own.
  const [A, B] = twoIdentities();
  const qa = quarantine.openQuarantine({ storage: A.conversation, scope: "AAAA", unixSeconds: () => 1000 });
  const qb = quarantine.openQuarantine({ storage: B.conversation, scope: "BBBB", unixSeconds: () => 1000 });

  await qa.hold([{ root: "aaa", name: "A's chat" }]);
  // ⚠️ CAUGHT RATHER THAN LET FLY, so that reverting the fix reads as a named failure
  // instead of killing the runner. What it throws when it is broken is the very
  // `OperationError` Hannu's Firefox panel showed.
  let swept = null;
  let threw = null;
  try {
    swept = await qb.sweep();
  } catch (err) {
    threw = err;
  }
  check("⛔⛔ the OTHER identity's unlock sweep no longer throws", threw === null,
    threw ? `${threw.name} — the lockout, reproduced` : "clean");
  equal("and finds nothing, because the other identity's list is not addressed at all",
    String(swept?.length ?? -1), "0");
  equal("⭐ and A still has what it quarantined", (await qa.list()).map((e) => e.root).join(","), "aaa");

  await qb.hold([{ root: "bbb", name: "B's chat" }]);
  equal("⭐⭐ two identities, two quarantines, neither reaching the other (A)",
    (await qa.list()).map((e) => e.root).join(","), "aaa");
  equal("⭐⭐ two identities, two quarantines, neither reaching the other (B)",
    (await qb.list()).map((e) => e.root).join(","), "bbb");
}

await rejects(
  "⚠️⚠️ and a quarantine with no scope is refused rather than defaulted — the fault could not come back quietly",
  async () => quarantine.openQuarantine({ storage: (await twoIdentities())[0].conversation }),
  /scope/
);

{
  // The migration: a list written before D-170 belongs to whoever can open it.
  const [A, B] = twoIdentities();
  await A.conversation.set("lpm.quarantine", [{ root: "old", name: "from before", state: "held", expiresAt: 9e9 }]);

  equal("⛔ the identity that CANNOT open the old list leaves it alone",
    await quarantine.adoptLegacy(B.conversation, "BBBB"), "not-ours");
  const stillThere = await A.conversation.attempt("lpm.quarantine");
  check("⭐⭐ so it is still there for its owner — deleting what we cannot read is how one identity wipes another",
    stillThere.found && stillThere.ours);

  equal("⭐ and the owner moves it", await quarantine.adoptLegacy(A.conversation, "AAAA"), "moved");
  const qa = quarantine.openQuarantine({ storage: A.conversation, scope: "AAAA", unixSeconds: () => 1000 });
  equal("with the entry intact at the new name", (await qa.list()).map((e) => e.root).join(","), "old");
  check("and nothing left at the old one", !(await A.conversation.attempt("lpm.quarantine")).found);
  equal("⚠️ running it twice is a no-op, so an interrupted move costs nothing",
    await quarantine.adoptLegacy(A.conversation, "AAAA"), "nothing-there");
}

{
  // ⛔⛔ THE SECOND FIXED NAME, AND ITS FAULT IS SILENT RATHER THAN LOUD: in Kept mode
  // `pairingStore()` is `vault.conversation`, so one identity starting a pairing
  // OVERWROTE another's in-flight record — the ephemeral private key with it.
  const [A, B] = twoIdentities();
  const inflight = (role) => ({ v: 1, role, l: "AAAAAAAAAAAAAAAAAAAAAA", priv: "A".repeat(43), expires_at: 4e12 });
  const sa = pair.scopedStore(A.conversation, "AAAA");
  const sb = pair.scopedStore(B.conversation, "BBBB");

  await sa.set(pair.INFLIGHT_KEY, inflight("I"));
  await sb.set(pair.INFLIGHT_KEY, inflight("J"));
  check("⛔⛔ B starting a pairing no longer reaches A's record", (await pair.loadInFlight(sa)) !== null);
  check("and B has its own", (await pair.loadInFlight(sb)) !== null);
  check("⭐ they are not the same record", (await pair.loadInFlight(sa)).role !== (await pair.loadInFlight(sb)).role);

  // ⚠️ MOVED AND NOT DELETED — §3.4.1b rule 6's `DELETE` is owed and only the record
  // can pay it, so the migration hands it to the code that already knows that.
  const [C, D] = twoIdentities();
  await C.conversation.set(pair.INFLIGHT_KEY, inflight("I"));
  equal("⛔ a pre-D-170 record another identity cannot open is left where it is",
    await pair.adoptLegacyInFlight(D.conversation, "DDDD"), "not-ours");
  equal("⭐ and its owner moves it rather than dropping it", await pair.adoptLegacyInFlight(C.conversation, "CCCC"), "moved");
  check("so rule 6 still has a record to send its DELETE from",
    (await pair.loadInFlight(pair.scopedStore(C.conversation, "CCCC"))) !== null);
}

{
  // The way out of an unreadable §7.3.2 mark: it needs no key, and it takes exactly
  // three rows.
  const [A] = twoIdentities();
  const k = `lpm.roster.${await vault.identityDigest(new Uint8Array([9, 9, 9]))}`;
  const scope = k.slice("lpm.roster.".length);
  await A.durable.set(`${k}.hwm`, 7);
  await A.durable.set(`${k}.sent`, "abc");
  await A.conversation.set(`${k}.blob`, { blob: "x", outer: 1 });
  await A.conversation.set("lpm.roster.SOMEBODY-ELSE.blob", { blob: "y", outer: 1 });

  await rosterFlow.forgetLocalHistory(A.db, scope);
  check("⛔⛔ the way out takes §7.3.2's mark — which is the security it costs", !(await A.durable.attempt(`${k}.hwm`)).found);
  check("and the note about our own last write", !(await A.durable.attempt(`${k}.sent`)).found);
  check("and the cached list, so the button does not have to be pressed twice", !(await A.conversation.attempt(`${k}.blob`)).found);
  check("⭐⭐ and NOTHING that belongs to another identity", (await A.conversation.attempt("lpm.roster.SOMEBODY-ELSE.blob")).found);
}

{
  // ⚠️⚠️ THE INSTRUMENT, because two fixed names were added a year apart and each was
  // reasonable on its own. A THIRD must not be able to arrive quietly.
  //
  // ⭐ It reads DECLARATIONS rather than guessing at shapes. The first version of this
  // check filtered by "dots are record names, hyphens are HKDF `info` strings", which
  // is true of this product and still classified `pairing-in-progress-v1` — one of the
  // two names the whole round is about — as an `info` string and passed. ➡️ **A GUARD
  // THAT INFERS THE CATEGORY IT IS GUARDING CAN INFER ITSELF PAST THE ANSWER.**
  const named = new Map();
  const declared = /(?:const|let|var)\s+\w*(?:[Kk][Ee][Yy]|PREFIX|Prefix)\w*\s*=\s*"([^"]+)"/g;
  const inlined = /\.(?:get|set|delete|attempt)\(\s*"([^"]+)"/g;
  for (const f of ["src/flow/quarantine.js", "src/flow/pair.js", "src/flow/roster.js",
                   "src/storage/vault.js", "src/storage/sessions.js"]) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    for (const r of [declared, inlined]) for (const m of src.matchAll(r)) named.set(m[1], f);
  }

  // Each of these is bare for a reason, and the reason is that nothing about it is
  // one identity's — or that it is retired and read only to be moved:
  //   lpm.quarantine              retired; `adoptLegacy` reads it and nothing else
  //   pairing-in-progress-v1      the name INSIDE a store; `scopedStore` prefixes it
  //                               in Kept, and Ghost's store is one tab's already
  //   lpm.pairing-in-progress.v1  Web Storage (§3.4.1), per tab
  //   lpm.ghost.                  Web Storage prefix (§7.6), per tab
  equal(
    "⛔⛔ every name a record is stored under names its identity, and these four are why the other four do not",
    [...named.keys()].sort().join(" "),
    "lpm.ghost. lpm.pairing-in-progress.v1 lpm.quarantine pairing-in-progress-v1"
  );
  check(
    "⚠️ the scan still finds names, so an empty result would mean a broken regex rather than a clean tree",
    named.size === 4,
    `${named.size} declarations seen`
  );
}

done();
