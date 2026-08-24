// §7.6's Ghost mode, as a set of pure checks.
//
// No browser, no server, no WASM. What is being asserted here is a STORAGE RULE and
// a naming rule, and both are the kind of thing a browser test would confirm in the
// happy case while saying nothing about the case that matters:
//
//   • §7.6: the root, the role, the generation, all Olm session state — and, from
//     0.8.14, the MESSAGES — live in `sessionStorage` and nowhere else. A test that
//     watched a conversation work in Chrome would pass with the message log in
//     IndexedDB, which is precisely the defect (D-072).
//   • §7.6's duplicated tab: "Duplicate tab" hands the new document a COPY of
//     `sessionStorage`. Nothing in Node duplicates a tab, but the thing that makes
//     the duplicate DETECTABLE is that it adopts the id it was handed rather than
//     minting one — and that is a pure property of `openGhost`, checkable by
//     copying a Map.
//
// ⚠️ The one thing this cannot show is that the browser really does clone
// `sessionStorage` on duplication, and really does release a Web Lock when a tab
// dies. Those are the platform's to keep; `test/tabs.mjs` has the same boundary and
// says so in the same place.

import * as ghosts from "../src/flow/ghost.js";
import * as store from "../src/storage/sessions.js";
import { b64uEncode } from "../src/crypto/b64u.js";
import { MESSAGE_TTL_S, GHOST_PREFIX } from "../src/storage/vault.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { check, equal, section, done, hex } from "./harness.mjs";

/**
 * A `sessionStorage` that can be copied, the way a duplicated tab's is.
 *
 * It is a real implementation of the four members `flow/ghost.js` uses — including
 * `length` and `key(i)`, which the §6.6 sweep enumerates with — rather than a stub
 * with the two that happen to be convenient.
 */
function fakeSession(from = null) {
  const m = from ? new Map(from.map) : new Map();
  return {
    map: m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    get length() {
      return m.size;
    },
    key: (i) => [...m.keys()][i] ?? null,
  };
}

const ROOT = new Uint8Array(32).fill(7);

// ============================================ §7.6 — everything, in one place only

section("§7.6 — the storage rule, including the item its list omitted (D-072)");

{
  const sessionStorage = fakeSession();
  const ghost = await ghosts.openGhost({ sessionStorage });

  await ghost.setChannel({ root: ROOT, role: "I", name: "Bea" });
  await ghost.setGeneration(3);

  // The session record, through the SAME interface Kept mode uses. `storage/
  // sessions.js` never learns which backend it has; that is the point of the two
  // modes sharing one `openChannel`.
  const record = { ...store.emptyRecord(), generation: 3, staged: [{ text: "the plaintext" }] };
  await store.saveRecord(ghost.store, ROOT, record, null);

  await ghost.messages.append("cafe", { dir: "in", text: "a message somebody typed", firstSeen: 1000 });

  const keys = [...sessionStorage.map.keys()];
  check("everything written is under one prefix", keys.every((k) => k.startsWith(GHOST_PREFIX)), keys.join(" "));
  check("and there is something to check", keys.length >= 4, `${keys.length} keys`);

  const blob = [...sessionStorage.map.values()].join("\n");

  // ⭐⭐ THE ASSERTION THE EIGHTH-TO-TWELFTH HOLES ARE ALL ABOUT: the thing being
  // protected is in the place the rule names. §7.6 enumerated four items and the
  // conversation was not one of them, while `ARCHITECTURE.md` §4.1's unqualified
  // "Messages | IndexedDB, encrypted" row stood ready to answer for it.
  check("⭐⭐ the MESSAGES are here — §7.6's list did not say so until 0.8.14", blob.includes("a message somebody typed"));
  check("§5.4.3's staged plaintext is here too, inside the session record", blob.includes("the plaintext"));
  check("§7.6's root is here", blob.includes(b64uEncode(ROOT)), b64uEncode(ROOT));
  check("§7.6's role is here — without it a reload cannot pick a direction", blob.includes('"I"'));
  check("§7.6's generation is here — §6.3 rule 1 rejects everything if it goes backwards", /"generation":3/.test(blob));

  // ⚠️ NOT A STYLE NOTE. §7.6: there is no `K_master` in this mode and therefore no
  // `local_key`; a key generated here would live in the same `sessionStorage` as
  // the thing it protects. What defends Ghost mode is that the store is measured
  // not to survive process death — not that anything in it is unreadable.
  check("⚠️ and none of it is encrypted, which §7.6 requires the client not to pretend", blob.includes("a message somebody typed"));
}

{
  // ⭐ A STRUCTURAL CHECK, because the rule is about a store that is NOT used and no
  // behavioural test can observe the absence of a call. `flow/ghost.js` importing
  // `storage/db.js` would be the first step of the defect, and an import is the one
  // thing about a module that can be read without running it.
  const src = readFileSync(new URL("../src/flow/ghost.js", import.meta.url), "utf8");
  const imports = [...src.matchAll(/^import .* from "(.*)";$/gm)].map((m) => m[1]);
  check(
    "⭐ Ghost mode's module does not import IndexedDB at all",
    !imports.some((i) => i.includes("storage/db.js")),
    imports.join(" ")
  );
  check("and the app opens no database on this path", !/openDatabase/.test(src));
}

// ================================================ §7.6 — the duplicated tab

section("§7.6 — a duplicated tab is handed a COPY, and a copy is not a conflict");

{
  const original = fakeSession();
  const a = await ghosts.openGhost({ sessionStorage: original });
  await a.setChannel({ root: ROOT, role: "I" });

  // What "Duplicate tab" does: the new document starts with a copy of the area.
  const copied = fakeSession(original);
  const b = await ghosts.openGhost({ sessionStorage: copied });

  equal("⭐⭐ the duplicate adopts the id rather than minting one", b.id, a.id);
  equal("so both documents ask for the same lock name", b.scope, a.scope);
  check("which is the only reason the census can see it at all", b.scope === a.scope);

  // ⚠️ AND IT WROTE NOTHING WHILE FINDING THAT OUT, which §7.6 requires of it: both
  // values `openGhost` would mint were already in the copy it was handed.
  equal("⚠️ and the duplicate wrote nothing to reach that answer", String(copied.map.size), String(original.map.size));

  const unrelated = await ghosts.openGhost({ sessionStorage: fakeSession() });
  check("a genuinely separate tab gets a separate name", unrelated.scope !== a.scope, `${unrelated.scope} vs ${a.scope}`);

  // §7.8.1 bars `roster_id` from a lock name because names are enumerable through
  // `locks.query()` and that value confirms a passphrase guess in one HKDF. This
  // one commits to nothing — it is random, minted here, and derived from nothing.
  check("the name is this session's own random id and commits to no secret", a.scope === `ghost.${a.id}`);
}

// ======================================= §7.6 — surviving the reload it was chosen for

section("§7.6 — what a reload has to bring back");

{
  const sessionStorage = fakeSession();
  const first = await ghosts.openGhost({ sessionStorage });
  await first.setChannel({ root: ROOT, role: "J", name: "Bea" });
  await first.setGeneration(4);

  // A reload: same document, same `sessionStorage`, new module state.
  const after = await ghosts.openGhost({ sessionStorage });

  equal("the id comes back", after.id, first.id);
  equal("⭐ and so does the PICKLE key, or the Olm state that survived cannot be opened", hex(after.pickleKey), hex(first.pickleKey));

  const entry = await after.channel();
  equal("the root comes back", entry.root, (await first.channel()).root);
  equal("the role comes back — §4.2 needs it to pick a direction", entry.role, "J");
  equal("⭐ and the generation, which §7.6 names because §6.3 rule 1 is silent when it is wrong", String(entry.generation), "4");

  check("there is one conversation and no structure for a second", typeof entry === "object" && !Array.isArray(entry));
}

// ================================================================ §6.6's history

section("§6.6 — the message log, in the store §7.6 names");

{
  const sessionStorage = fakeSession();
  const ghost = await ghosts.openGhost({ sessionStorage });
  await ghost.setChannel({ root: ROOT, role: "I" });

  await ghost.messages.append("cafe", { dir: "in", text: "one", firstSeen: 1000 });
  await ghost.messages.append("cafe", { dir: "out", text: "two", firstSeen: 2000 });
  const log = await ghost.messages.list("cafe");
  equal("arrival order is the order", log.map((m) => m.text).join(","), "one,two");
  equal("and the sequence numbers are arrival order too", log.map((m) => m.seq).join(","), "0,1");

  // §6.6, and the timer input is FIRST RECEIPT — never the peer's `sent_at`, which
  // §6.7 rule 2 says may not order or expire anything.
  const dropped = await ghost.messages.sweep(1000 + MESSAGE_TTL_S);
  equal("§6.6 drops a message once its 24 hours are up", String(dropped), "1");
  const left = await ghost.messages.list("cafe");
  equal("the newer one is still there", left.map((m) => m.text).join(","), "two");
  equal("⚠️ and it is renumbered, because `seq` is a position and not an identity", left.map((m) => m.seq).join(","), "0");

  await ghost.messages.forget("cafe");
  equal("forgetting a conversation empties its log", String((await ghost.messages.list("cafe")).length), "0");
}

{
  // The sweep enumerates rather than being told which conversation to sweep — it
  // runs at startup, before anything has computed a channel hash.
  const sessionStorage = fakeSession();
  const ghost = await ghosts.openGhost({ sessionStorage });
  await ghost.messages.append("aaaa", { text: "old", firstSeen: 0 });
  await ghost.messages.append("bbbb", { text: "old", firstSeen: 0 });
  equal("⭐ the sweep finds every log without being pointed at one", String(await ghost.messages.sweep(MESSAGE_TTL_S)), "2");
}

{
  // ⚠️ A FULL STORE IS REPORTABLE AND MUST NOT BE SWALLOWED: Ghost mode's whole
  // store is one origin's quota, and a message that was decrypted, acknowledged —
  // which deletes the server's copy — and then dropped in silence is the one
  // failure §5.4.3's ordering exists to prevent, arriving one write later.
  const full = fakeSession();
  const ghost = await ghosts.openGhost({ sessionStorage: full });
  full.setItem = () => {
    const err = new Error("quota");
    err.name = "QuotaExceededError";
    throw err;
  };
  let reason = null;
  try {
    await ghost.messages.append("cafe", { text: "no room", firstSeen: 0 });
  } catch (err) {
    reason = err?.reason ?? null;
  }
  equal("a full store is a named failure, not a silent drop", reason, "ghost_full");
}

// ============================================== the interface the two modes share

section("one interface, two backends — `storage/sessions.js` never learns which");

{
  const sessionStorage = fakeSession();
  const ghost = await ghosts.openGhost({ sessionStorage });

  const { record, token } = await store.loadRecord(ghost.store, ROOT);
  equal("an untouched channel reads as empty", String(record.generation), "0");
  equal("with no token, because there is nothing there yet", String(token), "null");

  const first = await store.saveRecord(ghost.store, ROOT, { ...record, generation: 1 }, null);
  const reread = await store.loadRecord(ghost.store, ROOT);
  equal("what was written is what comes back", String(reread.record.generation), "1");
  equal("and the token is the stored value itself", reread.token, first);

  // §5.4.3a's conditional write. ⚠️ It is HONEST here and it is BLIND here, and
  // §7.6 states that rather than solving it: within one document it refuses a stale
  // write exactly as IndexedDB does, and across two duplicated documents there is
  // no shared record for it to compare against at all. The lock is the only defence
  // for that case, which is why `flow/ghost.js` builds a lock name.
  let refused = false;
  try {
    await store.saveRecord(ghost.store, ROOT, { ...record, generation: 99 }, null);
  } catch (err) {
    refused = store.isConflict(err);
  }
  check("⭐ a stale write is refused inside one document", refused);
  equal("and the refusal changed nothing", String((await store.loadRecord(ghost.store, ROOT)).record.generation), "1");
}

// ==================================================================== leaving it

section("`discard` — the mode was opened and not used");

{
  const sessionStorage = fakeSession();
  const ghost = await ghosts.openGhost({ sessionStorage });
  await ghost.messages.append("cafe", { text: "x", firstSeen: 0 });
  check("there is something to discard", sessionStorage.map.size > 0);

  await ghost.discard();
  equal("⚠️ and afterwards this tab is not a Ghost tab", String(sessionStorage.map.size), "0");
  equal("so nothing resumes on the next load", String(await ghosts.resumable({ sessionStorage })), "false");
}

{
  const sessionStorage = fakeSession();
  const ghost = await ghosts.openGhost({ sessionStorage });
  equal("an id alone does not resume a session", String(await ghosts.resumable({ sessionStorage })), "false");
  await ghost.setChannel({ root: ROOT, role: "I" });
  equal("⭐ a CONVERSATION does — that is what the boot path looks for", String(await ghosts.resumable({ sessionStorage })), "true");
}


// ============================ §3.6.2's third answer, in the mode with no roster

/*
  ⚠️⚠️ THE CONTROL THIS GUARDS IS THE ONE NOBODY PRESSES IN TESTING. "This is not
  the person I meant to reach" is §3.6.2's third answer and the whole reason the six
  digits are on the screen — and until 2026-08-24 it removed nothing in Ghost mode.
  `app/app.js` read `if (entry.local) … else if (!isGhost()) …`: two branches for
  three modes, so Ghost fell off the end. The Olm state went, the message log went,
  and the channel entry stayed — so `backToStart()` read it and reopened the
  conversation with the person who had just failed the comparison, over the same
  root, ready for the next send to establish a fresh session on it.

  ➡️ **A CONDITION WITH TWO BRANCHES AND THREE MODES SILENTLY DOES NOTHING IN THE
  THIRD.** Nothing throws, nothing is logged, and the screen afterwards looks exactly
  like the screen you would get if it had worked.
*/
section("§3.6.2 — 'this is not the person' leaves no Ghost conversation behind");

{
  const store = fakeSession();
  const g = await ghosts.openGhost({ sessionStorage: store });
  await g.setChannel({ root: new Uint8Array(32).fill(0x11), role: "I", name: "" });
  check("there is a conversation to remove", (await g.channel()) !== null);

  await g.removeChannel();
  equal("⭐⭐⭐ the channel entry is GONE — the boot path has nothing to reopen",
    String(await g.channel()), "null");
  check("⭐⭐ and `resumable()` agrees, which is what `backToStart()` asks",
    (await ghosts.resumable({ sessionStorage: store })) === false);

  // ⚠️ AND THE SESSION IS STILL A GHOST SESSION. This is not `discard()`: the same
  // control in Kept mode returns the person to an empty list, not out of the mode.
  const again = await g.setChannel({ root: new Uint8Array(32).fill(0x22), role: "J", name: "" });
  check("⭐ a new conversation can still be opened in the same Ghost session", again.root !== undefined);

  /*
    ⚠️⚠️ AND IT IS CALLED. Everything above proves a remover exists and works, and a
    remover that nothing invokes would pass every one of those checks with the defect
    untouched — which is the shape the 2026-08-24 review found FOUR times in one pass
    (`copy.product.endedTitle` defined in both languages and read by nothing, §2.1's
    strip living in a function that ran minutes late, and two more).
    ➡️ **A CHECK THAT ASKS WHETHER SOMETHING EXISTS CANNOT TELL YOU WHETHER IT IS
    USED.** `app/app.js` cannot be imported here — it touches the document on its
    first line — so this reads it as source, which is enough for the one question.
  */
  const appSrc = readFileSync(fileURLToPath(new URL("../app/app.js", import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  check("⭐⭐ `app/app.js` calls it — a remover nothing invokes is not a fix",
    /session\.ghost\.removeChannel\(\)/.test(appSrc));
  /*
    ⚠️ AND THE SHAPE OF THE BRANCH, because "calls it somewhere" is not the rule.
    Measured while mutation-testing this on 2026-08-24: a first attempt at this check
    matched `entry.local … isGhost() … roster.removeChannel` and passed against the
    original two-branch code, because `!isGhost()` contains `isGhost()`.
    ➡️ **A PATTERN THAT DOES NOT NOTICE A NEGATION TESTS THE OPPOSITE RULE AS
    HAPPILY AS THE RULE.** So the three questions are asked separately.
  */
  // ⚠️ ANCHORED ON THE FUNCTION, NOT ON THE FIRST `if (entry.local)`. There is an
  // earlier one eleven thousand characters up, in the list rendering, and a slice
  // that started there swept in half the file — including several honest
  // `!isGhost()` guards that have nothing to do with this rule. The first attempt at
  // this check did exactly that and reported the opposite of the truth.
  const fn = appSrc.slice(appSrc.indexOf("async function removeConversation"));
  const branch = fn.slice(fn.indexOf("if (entry.local)"), fn.indexOf("roster.removeChannel(rootBytesOf(entry))"));
  check("⭐⭐ Ghost is its own branch", /else if \(isGhost\(\)\)/.test(branch));
  check("⭐⭐ and is NOT tested by negation — that is how it fell off the end",
    !/!isGhost\(\)/.test(branch));
  check("⭐ and that branch removes the channel", /ghost\.removeChannel\(\)/.test(branch));
}

done();
