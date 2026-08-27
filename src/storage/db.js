// IndexedDB — the store, and only the store. Nothing here knows what a channel is.
//
// ARCHITECTURE.md §4.1 is the table this file implements. What it puts in each
// store is decided in `vault.js`; what may be written at all is decided by
// PROTOCOL.md §7.6 (Ghost writes nothing here) and §7.8 (what an ending clears).
//
// ⚠️⚠️ THREE STORES, AND THE SPLIT IS §7.8's RULE MADE STRUCTURAL. The ordinary
// ending clears conversation state and, in Kept mode, device unlock state — while
// §7.3.2's high-water mark MUST survive it, because a client with no local version
// to compare against is exactly what the roster-rollback attack needs.
//
// That is a rule about which records go and which stay, and an implementer holding
// one object store obeys it by remembering to. Here the ending clears two stores
// and does not name the third, so forgetting is not one of the available mistakes.
// (§7.8 step 5 — `Clear-Site-Data` — takes all three, deliberately, and MUST warn
// that it is resetting the rollback check. That is the one path that may.)
//
// ⚠️⚠️ STEP 9: THIS DATABASE IS SHARED BY EVERY TAB, AND THAT IS WHY `add` AND
// `swap` EXIST (PROTOCOL 0.8.12). Step 8 moved the Olm session state in here, which
// silently ended the assumption every ordering rule in §6 was written under — that
// one writer owns the record. Two tabs doing `get` then `put` is a lost update, and
// a lost update on a ratchet is a chain key used twice.
//
// The two primitives below are the answer, and neither needs an election, a lock or
// any other client to be reachable: an IndexedDB readwrite transaction is atomic
// and isolated across every client of the origin, so a read and a write placed in
// ONE transaction cannot interleave with another tab's.
//
//   `add`   refuses a key that already exists, instead of overwriting it
//   `swap`  writes only if the stored bytes are still the bytes the caller read
//
// ⚠️ EVERY REQUEST IN A TRANSACTION MUST BE ISSUED SYNCHRONOUSLY. An IndexedDB
// transaction commits as soon as its request queue drains, so `await`ing anything
// that is not an IndexedDB request inside one — a `crypto.subtle` call, a fetch —
// closes it. That is why `swap` takes the finished bytes rather than a callback
// that could encrypt: sealing happens outside, and only the compare-and-write is in
// here. See `storage/vault.js` for the loop that arranges it.

/** Bumping this runs `upgrade()` below; every store must be created there. */
export const DB_NAME = "lpm";
export const DB_VERSION = 1;

/** Cleared by the ordinary ending (§7.8 step 2). Session pickles, roster cache. */
export const CONVERSATION = "conversation";

/** Cleared by the ordinary ending. Keyed `[channelHash, seq]` — see `vault.js`. */
export const MESSAGES = "messages";

/**
 * NOT cleared by the ordinary ending. §7.3.2's high-water mark, and — since D-169 —
 * the fingerprint of the last roster blob this device SENT, which is the only thing
 * that can tell "another device raised the version" from "I raised it and never heard
 * back". Both are answers to a question asked on the first read of a session, and the
 * ordinary ending is exactly what makes that read the whole of what a device knows.
 *
 * §7.5's unlock record is device unlock state, which the ordinary ending in Kept mode
 * DOES clear, so it belongs in `CONVERSATION` when it lands.
 */
export const DURABLE = "durable";

export const STORES = Object.freeze([CONVERSATION, MESSAGES, DURABLE]);

/** Stores the ordinary ending clears. `DURABLE` is absent on purpose. */
export const ENDING_CLEARS = Object.freeze([CONVERSATION, MESSAGES]);

export function idbAvailable() {
  return typeof globalThis.indexedDB !== "undefined" && globalThis.indexedDB !== null;
}

/**
 * How long ONE store operation may take before the app is told the store is not
 * answering — ARCHITECTURE.md §4.2.3.
 *
 * ⚠️⚠️ THIS EXISTS BECAUSE A BLOCKED STORE IS INDISTINGUISHABLE FROM A WORKING ONE,
 * WHICH WAS MEASURED RATHER THAN SUPPOSED (2026-08-18, `scratchpad/probe-blocked-silence.mjs`).
 * Another connection holding this store makes a readwrite here WAIT, not fail — so the
 * drain does not throw, `flow/live.js` reports no failure, the status line goes on saying
 * "live", and the screen is identical to a conversation with nothing to deliver. Forty
 * seconds of that were recorded against a running product with the message already fetched.
 *
 * ⭐ FIVE SECONDS IS CHOSEN AGAINST TWO MEASUREMENTS AND NOT BY FEEL. Chrome force-aborts
 * the transaction a frozen document is holding after about a minute, and D-127 sampled the
 * block present from 4 s to 54 s — so this lands inside the window with 55 seconds of it
 * left to report. And a free store answers in **0 ms** (measured in the same file, both
 * before and after), so the margin against an ordinary slow device is three orders of
 * magnitude rather than a guess.
 */
export const STORE_SLOW_MS = 5000;

/**
 * Time every operation, and report the transition into and out of "not answering".
 *
 * ⚠️ IT COUNTS OPERATIONS THAT ARE INDIVIDUALLY SLOW, NOT TIME WITH ANY OPERATION IN
 * FLIGHT. A single timer armed on the first outstanding request and cleared on the last
 * would fire during a busy second of fast writes, which is a healthy store, and the app
 * would announce a fault that is not there.
 *
 * ⚠️ `onSlow(false)` IS REPORTED FROM A `finally`, so a rejected operation clears the
 * state as well as a resolved one. An operation that fails still stops waiting.
 */
function guarding({ onSlow, slowMs }) {
  let stalled = 0;
  return async function guard(work) {
    let counted = false;
    const timer = setTimeout(() => {
      counted = true;
      if (++stalled === 1) onSlow(true);
    }, slowMs);
    try {
      return await work;
    } finally {
      clearTimeout(timer);
      if (counted && --stalled === 0) onSlow(false);
    }
  };
}

/**
 * A write refused because the record changed under the caller.
 *
 * ⚠️ IT IS NOT AN ERROR CONDITION, it is the mechanism working. Something else
 * wrote first; the caller's job is to read the new state and decide again, which is
 * what `flow/message.js` does by restarting the whole operation.
 */
export class WriteConflict extends Error {
  constructor(message) {
    super(message);
    this.name = "WriteConflict";
    this.reason = "record_conflict";
  }
}

/** Byte equality, for the compare half of `swap`. Length first: it usually differs. */
export function sameBytes(a, b) {
  if (a === null || b === null || a === undefined || b === undefined) return a == null && b == null;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function promise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexeddb: request failed"));
  });
}

function finished(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("indexeddb: transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("indexeddb: transaction aborted"));
  });
}

function upgrade(db) {
  if (!db.objectStoreNames.contains(CONVERSATION)) db.createObjectStore(CONVERSATION);
  if (!db.objectStoreNames.contains(MESSAGES)) db.createObjectStore(MESSAGES);
  if (!db.objectStoreNames.contains(DURABLE)) db.createObjectStore(DURABLE);
}

/**
 * Open the database.
 *
 * ⚠️⚠️ `blocked` AND `versionchange` ARE THE TWO HALVES OF ONE PROBLEM AND NEITHER
 * MAY BE SWALLOWED. `blocked` fires here when another tab holds this database open
 * at an older version: without a handler the open never settles and the app hangs
 * on a blank screen. `versionchange` fires on THIS connection when another tab is
 * trying to upgrade: without a handler that other tab is the one that hangs, and it
 * is a tab whose user is looking at a newer release wondering why it will not start.
 *
 * Neither can be fixed inside this file — one tab cannot close another and must not
 * silently discard the session in this one — so both are reported and the caller
 * decides. A release that bumps `DB_VERSION` with these unhandled is a release that
 * cannot be installed by anybody with two tabs open.
 *
 * ⚠️ `onSlow` IS A THIRD REPORT OF THE SAME KIND AND IT IS NOT AN ERROR CALLBACK.
 * `blocked` and `versionchange` are events IndexedDB raises; a store that has simply
 * stopped answering raises nothing at all, which is exactly why §4.2.3 needs it timed.
 * It is called with `true` when an operation passes `slowMs` and `false` when the last
 * such operation settles — a level, not an event, so the caller can put it on a screen
 * and take it off again without keeping its own state.
 */
export async function openDatabase({
  name = DB_NAME,
  version = DB_VERSION,
  onBlocked = () => {},
  onVersionChange = () => {},
  onSlow = () => {},
  slowMs = STORE_SLOW_MS,
} = {}) {
  if (!idbAvailable()) throw new Error("indexeddb: not available in this context");
  const req = globalThis.indexedDB.open(name, version);
  req.onupgradeneeded = () => upgrade(req.result);
  req.onblocked = () => onBlocked();
  const db = await promise(req);
  db.onversionchange = () => {
    // Closing is not optional: the other tab's upgrade cannot start until every
    // connection is gone. What the caller does about a session whose store just
    // vanished is the caller's decision, and it has to be told to make it.
    db.close();
    onVersionChange();
  };
  return handle(db, name, guarding({ onSlow, slowMs }));
}

/**
 * The handle. Reads and writes are one transaction each: the record IS the atomic
 * unit (`storage/sessions.js` says why for the receive path), so batching across
 * records would buy nothing and lose the property.
 */
function handle(db, name, guard = (work) => work) {
  const readwrite = (store) => db.transaction(store, "readwrite").objectStore(store);
  const readonly = (store) => db.transaction(store, "readonly").objectStore(store);

  return {
    name,

    async get(store, key) {
      const value = await guard(promise(readonly(store).get(key)));
      return value === undefined ? null : value;
    },

    async put(store, key, value) {
      const os = readwrite(store);
      os.put(value, key);
      await guard(finished(os.transaction));
    },

    /**
     * Write only if the key is free. Rejects with `WriteConflict` if it is taken.
     *
     * The message log picks its own key — `[channelHash, seq]`, the next sequence
     * number after the last one on disk — and two tabs reading the same last row
     * pick the same `seq`. With `put` the second silently REPLACES the first and a
     * received message is gone with nothing to notice it; `add` turns that into a
     * refusal the caller can answer by picking again.
     */
    async add(store, key, value) {
      const os = readwrite(store);
      const req = os.add(value, key);
      const taken = () => req.error?.name === "ConstraintError";
      // ⚠️ A ConstraintError aborts the transaction unless it is claimed here, and
      // an unclaimed abort arrives as the generic transaction failure — which the
      // caller cannot tell apart from a disk error, and would answer differently.
      req.onerror = (event) => taken() && event.preventDefault();
      try {
        await guard(finished(os.transaction));
      } catch (err) {
        if (!taken()) throw err;
      }
      if (taken()) throw new WriteConflict(`indexeddb: ${store} key already exists`);
    },

    /**
     * Compare and swap: write `value` only if what is stored is still `expect`.
     *
     * ⚠️⚠️ THE READ AND THE WRITE ARE ONE TRANSACTION, WHICH IS THE ENTIRE POINT.
     * Two tabs each doing `get` then `put` is a lost update; two tabs each doing
     * this cannot interleave, because IndexedDB serialises overlapping readwrite
     * transactions on a store across every client of the origin. That guarantee is
     * the reason multi-tab safety here needs no lock, no election and no other tab
     * to be reachable — the ones in `flow/tabs.js` avoid the conflict, this is what
     * makes it harmless when they are unavailable.
     *
     * `expect` is the previous ciphertext itself rather than a version number: it
     * changes on every write (§0.2's IV is fresh each time), it needs no extra
     * field on disk, and it cannot go backwards the way a counter can. Pass `null`
     * to mean "there must be nothing here".
     */
    async swap(store, key, { expect, value }) {
      const os = readwrite(store);
      // ⚠️⚠️ THE READ IS **NOT** GUARDED AND THAT IS THE HEADER'S RULE, NOT AN OVERSIGHT.
      // A transaction stays active across microtasks queued from a request's success
      // handler and no further, so the `put` below has to be issued out of THIS promise's
      // resolution — and every wrapper between them is another hop to be sure of. The
      // completion below is guarded instead, which loses nothing: a store that cannot
      // start this transaction cannot finish it either, so the wait is timed either way.
      const current = await promise(os.get(key));
      const held = current === undefined ? null : current;
      if (!sameBytes(held, expect)) {
        os.transaction.abort();
        throw new WriteConflict(`indexeddb: ${store} record changed under this write`);
      }
      if (value === null) os.delete(key);
      else os.put(value, key);
      await guard(finished(os.transaction));
    },

    async delete(store, key) {
      const os = readwrite(store);
      os.delete(key);
      await guard(finished(os.transaction));
    },

    /** Every `[key, value]` in a key range, in key order. */
    async list(store, range) {
      const os = readonly(store);
      const [keys, values] = await guard(
        Promise.all([promise(os.getAllKeys(range)), promise(os.getAll(range))])
      );
      return keys.map((key, i) => [key, values[i]]);
    },

    async deleteRange(store, range) {
      const os = readwrite(store);
      os.delete(range);
      await guard(finished(os.transaction));
    },

    /**
     * §7.8's ending, as ONE transaction across every store it names.
     *
     * ⚠️⚠️ IT WAS A LOOP, ONE TRANSACTION EACH, AWAITED IN TURN — so a browser killed
     * between `conversation` and `messages` left a HALF-ENDED identity: the roster can
     * be fetched again at the next unlock, and the still-sealed message rows become
     * readable under the re-derived `local_key`, on a device whose owner was told the
     * ending had removed them. IndexedDB gives atomicity across stores for free as
     * long as every request is issued synchronously inside one transaction, which is
     * what the loop below does. Found by the 2026-08-24 outside review.
     */
    async clear(stores) {
      const tx = db.transaction(stores, "readwrite");
      for (const store of stores) tx.objectStore(store).clear();
      await guard(finished(tx));
    },

    /**
     * Delete NAMED keys across several stores, in one transaction.
     *
     * ⚠️⚠️ IT EXISTS BECAUSE `clear()` REACHES TOO FAR AND ITS ATOMICITY IS STILL
     * NEEDED. §7.8's ordinary ending clears "conversation state" — this identity's.
     * `clear()` empties whole object stores, so ending one identity in a browser
     * that holds two destroys the other's message history, which nothing can
     * recover: those messages were acknowledged and deleted from the server the
     * moment they arrived. Found by the 2026-08-24 outside review.
     *
     * ⭐ AND THE OBVIOUS FIX — a loop of `delete()` calls — WOULD UNDO THE FIX
     * ABOVE IT. `clear()`'s own comment records why one transaction matters: a
     * browser killed between two of them leaves a HALF-ENDED identity, whose
     * message rows become readable again under the re-derived `local_key` on a
     * device whose owner was told they were gone. So the scoping and the atomicity
     * are one method: the caller decides WHICH keys outside the transaction, where
     * it may decrypt; this issues every delete inside one, where it may not.
     *
     * `plan` is `[[store, keys], …]`. Every request is issued synchronously — see
     * the file header.
     */
    async deleteAll(plan) {
      const stores = plan.map(([store]) => store);
      if (stores.length === 0) return;
      const tx = db.transaction(stores, "readwrite");
      for (const [store, keys] of plan) {
        const os = tx.objectStore(store);
        for (const key of keys) os.delete(key);
      }
      await guard(finished(tx));
    },

    close() {
      db.close();
    },
  };
}

/**
 * The same handle over a Map. Not a mock: this is what the Node suites run
 * against, so the record layer above it — which is where a silent bug would live —
 * is tested without a browser, and `test/browser-*.mjs` then only has to show that
 * the real IndexedDB behaves like it.
 *
 * Keys may be arrays (`MESSAGES` uses `[channelHash, seq]`), which a Map compares
 * by identity, so they are held encoded and decoded on the way out. That also
 * gives the ordering IndexedDB guarantees and a Map does not.
 */
export function memoryDatabase({ name = DB_NAME } = {}) {
  const stores = new Map(STORES.map((s) => [s, new Map()]));
  const enc = (key) => JSON.stringify(key);
  const dec = (key) => JSON.parse(key);
  const inRange = (key, range) => {
    if (!range) return true;
    return cmp(key, range.lower) >= 0 && cmp(key, range.upper) <= 0;
  };
  const of = (store) => {
    const m = stores.get(store);
    if (!m) throw new RangeError(`memoryDatabase: no store ${store}`);
    return m;
  };

  return {
    name,
    async get(store, key) {
      const v = of(store).get(enc(key));
      return v === undefined ? null : v;
    },
    async put(store, key, value) {
      of(store).set(enc(key), value);
    },
    /**
     * ⚠️ ATOMIC FOR A DIFFERENT REASON THAN THE REAL ONE, and the difference is
     * worth stating rather than glossing. IndexedDB serialises overlapping
     * readwrite transactions; here there is one thread and no `await` between the
     * read and the write, so nothing can interleave either. What these two share is
     * the CONTRACT, which is what the callers are written against and what the
     * suites check — the isolation guarantee itself only the browser can be asked
     * for, which is `test/browser-*.mjs`'s job.
     */
    async add(store, key, value) {
      const m = of(store);
      if (m.has(enc(key))) throw new WriteConflict(`memory: ${store} key already exists`);
      m.set(enc(key), value);
    },
    async swap(store, key, { expect, value }) {
      const m = of(store);
      const held = m.has(enc(key)) ? m.get(enc(key)) : null;
      if (!sameBytes(held, expect)) throw new WriteConflict(`memory: ${store} record changed under this write`);
      if (value === null) m.delete(enc(key));
      else m.set(enc(key), value);
    },
    async delete(store, key) {
      of(store).delete(enc(key));
    },
    async list(store, range) {
      return [...of(store).entries()]
        .map(([k, v]) => [dec(k), v])
        .filter(([k]) => inRange(k, range))
        .sort((a, b) => cmp(a[0], b[0]));
    },
    async deleteRange(store, range) {
      for (const [k] of await this.list(store, range)) of(store).delete(enc(k));
    },
    async clear(list) {
      for (const store of list) of(store).clear();
    },
    async deleteAll(plan) {
      for (const [store, keys] of plan) for (const key of keys) of(store).delete(enc(key));
    },
    close() {},
  };
}

/**
 * IndexedDB's key ordering for the shapes used here: numbers, strings, and arrays
 * compared element by element. Arrays sort above everything, which is why
 * `keyRange()` below can use `[]` as an upper bound that no real key reaches.
 */
function cmp(a, b) {
  const type = (v) => (Array.isArray(v) ? 2 : typeof v === "string" ? 1 : 0);
  if (type(a) !== type(b)) return type(a) - type(b);
  if (Array.isArray(a)) {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (i >= a.length) return -1;
      if (i >= b.length) return 1;
      const c = cmp(a[i], b[i]);
      if (c !== 0) return c;
    }
    return 0;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * A bound range, in the one shape this client needs: every key under a prefix.
 *
 * Returned as a plain `{ lower, upper }` when IndexedDB is absent so that
 * `memoryDatabase` can answer the same question — an `IDBKeyRange` cannot be
 * constructed in Node, and `list()` is where the ordering is decided.
 */
export function prefixRange(prefix) {
  const lower = [...prefix];
  const upper = [...prefix, []];
  if (idbAvailable()) return globalThis.IDBKeyRange.bound(lower, upper);
  return { lower, upper };
}
