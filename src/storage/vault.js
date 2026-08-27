// What may be written to disk, and under what key — PROTOCOL.md §7.2, §7.6, §7.8
// and the storage table in ARCHITECTURE.md §4.1.
//
// ⚠️⚠️ THE KEY IS `local_key`, AND IT DID NOT EXIST UNTIL THIS STEP. §4.1 requires
// the Olm session state, the messages and the outbound delivery state to be
// "IndexedDB, encrypted"; §7.2 derived three values and none of them was for this.
// The two answers an implementer reaches for when a key is not named are reusing
// `roster_key` — the key that protects a different plaintext held by someone else
// — or generating a random key and storing it beside the ciphertext, which is not
// encryption at all and is the one that looks most like it works.
//
// `local_key = HKDF(K_master, "lpm-local-key-v1", 32)` is what makes the threat
// model's "device theft, locked" row true of stored data: `K_master` is memory-only
// (§4.1), so a device that is not unlocked cannot read its own session pickles, and
// a pickle IS the conversation — §6.2 is explicit that Olm state decrypts on its
// own, without `R`.
//
// ⚠️ WHAT THIS DOES NOT DO, stated because encryption at rest invites the belief
// that it does everything:
//
//   • It does not hide SIZE. The cached roster blob is 16412 bytes or 65564 (§7.3),
//     so an examiner still learns which side of §7.3's one-way growth this user is
//     on. AES-GCM hides content, not length, and no amount of it hides that one.
//   • It does not stop ROLLBACK. The AAD below binds a record to its own slot, so
//     ciphertext cannot be moved from one key to another — but replacing a record
//     with an EARLIER version of itself authenticates perfectly. §7.3.2 solves this
//     for the roster with a high-water mark; there is no equivalent for a session
//     pickle, and an Olm ratchet driven backwards re-uses message keys. What stops
//     it is that reaching IndexedDB at all means holding the device.
//   • It does not survive the passphrase. Every holder of the phrase holds
//     `local_key`, exactly as they hold everything else (§7.3.1, §11).

import * as aead from "../crypto/aead.js";
import { b64uEncode } from "../crypto/b64u.js";
import { utf8Bytes, utf8String } from "../crypto/bytes.js";
import { sha256 } from "../crypto/hash.js";
import { CONVERSATION, DURABLE, ENDING_CLEARS, MESSAGES, STORES, WriteConflict, prefixRange } from "./db.js";

/** §6.6: a client deletes a message 24 hours after it FIRST RECEIVED it. */
export const MESSAGE_TTL_S = 24 * 60 * 60;

/**
 * How many times a message append will pick a new sequence number before giving up.
 * Each collision means another client appended in the same instant; more than a
 * handful in a row is a bug rather than contention.
 */
export const MAX_APPEND_ATTEMPTS = 8;

/**
 * The part of a record's key that says WHOSE it is.
 *
 * ⚠️⚠️ ENCRYPTING PER IDENTITY IS NOT ISOLATING PER IDENTITY, AND THIS FILE READ AS
 * THOUGH IT WERE UNTIL D-170. One browser holds ONE database, and `openVault` hands
 * out a `conversation` and a `durable` that are this identity's only in the sense
 * that they are sealed under its `local_key`. **The address space is shared by every
 * identity in the browser.** Two records were named without this digest in them —
 * `lpm.quarantine` and the in-flight pairing record — so a second KEY in the same
 * browser addressed the first one's row, and:
 *
 *   • the quarantine read THREW, on the unlock path, so the second identity could
 *     not open at all — a hard lockout with a sentence that named nothing; and
 *   • the pairing record was OVERWRITTEN, destroying the private key of a pairing
 *     in flight on the other identity, silently.
 *
 * Both reproduced against this code before either was fixed —
 * `~/lpm-probes/probe-two-identities-one-browser.mjs`.
 *
 * ➡️ **A KEY THAT DOES NOT NAME THE IDENTITY IS A KEY EVERY IDENTITY OWNS.** The
 * AAD below binds the store and the record's name, which makes "it opened" a
 * statement about this row — it was never a statement about whose row it is, and
 * nothing else was doing that job.
 *
 * ⚠️ It is a PREFIX OF A HASH of `roster_id`, which is already public to the server
 * (§7.3.3), so it discloses nothing to an examiner that the database's mere
 * existence does not. It is deliberately the same digest `flow/roster.js` has always
 * used, so that its keys do not move and §7.3.2's high-water mark survives this
 * change — a mark that moved would be a mark that vanished, which is the one thing
 * §7.3.2 may not do.
 */
export async function identityDigest(rosterId) {
  return b64uEncode((await sha256(rosterId)).slice(0, 16));
}

/**
 * §0.2's AEAD rule reaches here: the IV is inside `seal()` and no caller can pick
 * one. What this adds is the slot.
 *
 * A record encrypted under `local_key` alone is valid in every slot in the
 * database, so an attacker with write access could put channel A's session state
 * where channel B's belongs and watch the ratchet fail — or worse, succeed. The
 * store name and key cost nothing to authenticate and remove the question.
 */
function slot(store, key) {
  return utf8Bytes(`lpm-record-v1|${store}|${JSON.stringify(key)}`);
}

/**
 * Whether this record is THIS identity's, answered the only way it can be: by
 * opening it.
 *
 * ⚠️ THE AAD IS PART OF THE ANSWER AND NOT AN EXTRA. `slot()` binds the store and
 * the key into the tag, so a record moved to another key does not open here either
 * — which is what makes "it opened" a statement about this row rather than about
 * these bytes.
 */
async function opens(localKey, store, key, blob) {
  if (!blob) return false;
  try {
    await aead.open(localKey, blob, slot(store, key));
    return true;
  } catch {
    return false;
  }
}

/**
 * The interface every persistent store in this client speaks: `get`, `set`,
 * `delete`, values JSON-able, everything async.
 *
 * It is deliberately the interface `storage/sessions.js` already defined for its
 * backend, so that the session store did not have to learn about encryption and
 * this file did not have to learn what a session is.
 */
function records(db, store, localKey) {
  return {
    async get(key) {
      const blob = await db.get(store, key);
      if (!blob) return null;
      return JSON.parse(utf8String(await aead.open(localKey, blob, slot(store, key))));
    },

    /**
     * `get`, for a caller that has decided what an UNREADABLE record means.
     *
     * ⚠️⚠️ `get` THROWS, AND THAT IS RIGHT FOR EVERY CALLER THAT HAS NOT DECIDED.
     * A record that does not open is not an empty record — reading it as one is how
     * a rollback guard becomes no guard — so the default has to be the loud one and
     * this has to be the exception a caller asks for by name (D-170).
     *
     * Three answers, not two: `{ found: false }` is nothing there, `{ ours: true }`
     * is a record this identity can read, and `{ found: true, ours: false }` is a
     * record that exists and is not this identity's — another KEY's, or damaged.
     * The middle case is the one a two-state answer loses.
     *
     * ⚠️ A STORE THAT IS NOT ANSWERING STILL THROWS. `db.get` is outside the `try`
     * on purpose: ARCHITECTURE §4.2.3's blocked store is a level the app raises, not
     * a record it may treat as foreign, and swallowing it here would report an
     * unreachable database as somebody else's data.
     */
    async attempt(key) {
      const blob = await db.get(store, key);
      if (!blob) return { found: false, ours: false, value: null };
      try {
        return { found: true, ours: true, value: JSON.parse(utf8String(await aead.open(localKey, blob, slot(store, key)))) };
      } catch {
        return { found: true, ours: false, value: null };
      }
    },
    async set(key, value) {
      await db.put(store, key, await aead.seal(localKey, utf8Bytes(JSON.stringify(value)), slot(store, key)));
    },
    async delete(key) {
      await db.delete(store, key);
    },

    /**
     * `get`, plus the token that says which version of the record this was.
     *
     * The token is the stored ciphertext itself — see `db.js`. It is opaque to
     * everybody above this line, and it is deliberately NOT a version number: a
     * counter has to be stored, and a stored counter can be rolled back to make a
     * stale write look current. This one is the thing being replaced.
     */
    async read(key) {
      const blob = await db.get(store, key);
      if (!blob) return { value: null, token: null };
      return { value: JSON.parse(utf8String(await aead.open(localKey, blob, slot(store, key)))), token: blob };
    },

    /**
     * `set`, but only if the record is still the one `token` came from.
     *
     * ⚠️ THE SEALING HAPPENS BEFORE THE TRANSACTION OPENS, and it has to: an
     * IndexedDB transaction commits the moment its queue drains, so awaiting
     * `crypto.subtle` inside one closes it. The compare and the write are what go
     * in the transaction, and they are both synchronous once the bytes exist.
     */
    async write(key, value, token) {
      const blob = value === null ? null : await aead.seal(localKey, utf8Bytes(JSON.stringify(value)), slot(store, key));
      await db.swap(store, key, { expect: token, value: blob });
      return blob;
    },
  };
}

/**
 * The message log — §6.6's TTL and the history a chat view shows.
 *
 * Keyed `[channelHash, seq]`, where `channelHash` is §7.3's 128-bit commitment to
 * the channel root (`rootHash`) and never the root itself, and `seq` is arrival
 * order on THIS device. ⚠️ §6.7 rule 2: `sent_at` is the peer's clock and MUST NOT
 * order a history. Arrival order is the only order this device can vouch for, and
 * it is the key rather than a sorted field for the same reason.
 */
function messageLog(db, localKey) {
  const key = (channelHash, seq) => [channelHash, seq];

  async function nextSeq(channelHash) {
    const rows = await db.list(MESSAGES, prefixRange([channelHash]));
    if (rows.length === 0) return 0;
    return rows[rows.length - 1][0][1] + 1;
  }

  return {
    /**
     * Append a message. `firstSeen` is §6.6's timer input and is set here.
     *
     * ⚠️⚠️ IT PICKS ITS OWN KEY, WHICH IS WHY IT USES `add` AND RETRIES. `seq` is
     * "one past the last row on disk", so two clients appending in the same instant
     * choose the same number — and `put` would let the second silently REPLACE the
     * first. That is a received message disappearing with nothing anywhere to
     * notice it: the sender was told it was delivered, the mailbox row is deleted,
     * and the only copy was overwritten by a later arrival.
     *
     * `add` refuses instead, and refusing is a complete answer here because the
     * only thing that was wrong is the number. Recomputing it and trying again
     * cannot lose anything — unlike the session record next door, where the retry
     * has to re-derive what it was about to write (see `flow/message.js`).
     */
    async append(channelHash, message) {
      for (let attempt = 0; attempt < MAX_APPEND_ATTEMPTS; attempt++) {
        const seq = await nextSeq(channelHash);
        const k = key(channelHash, seq);
        const stored = { ...message, seq };
        try {
          await db.add(MESSAGES, k, await aead.seal(localKey, utf8Bytes(JSON.stringify(stored)), slot(MESSAGES, k)));
          return stored;
        } catch (err) {
          if (!(err instanceof WriteConflict)) throw err;
        }
      }
      throw new Error(`vault: ${MAX_APPEND_ATTEMPTS} message slots in a row were taken while appending`);
    },

    /** Everything held for one channel, in arrival order. */
    async list(channelHash) {
      const rows = await db.list(MESSAGES, prefixRange([channelHash]));
      const out = [];
      for (const [k, blob] of rows) {
        out.push(JSON.parse(utf8String(await aead.open(localKey, blob, slot(MESSAGES, k)))));
      }
      return out;
    },

    async forget(channelHash) {
      await db.deleteRange(MESSAGES, prefixRange([channelHash]));
    },

    /**
     * §6.6, and it is the only enforcement there is.
     *
     * ⚠️ IT RUNS WHEN THE APP RUNS. `first_seen` is inside the ciphertext, so
     * expiry needs `local_key`, so a message whose 24 hours pass while the app is
     * closed is deleted at the next unlock and not before. That is a residual to
     * state in the product's own words — "24 hours after you receive it, the next
     * time you open this" — rather than a bug to fix by putting the timestamp in
     * the clear, which would hand a locked device the shape of every conversation.
     * §6.6 already says deletion is client-enforced and best-effort.
     */
    async sweep(nowSeconds) {
      const rows = await db.list(MESSAGES, undefined);
      let deleted = 0;
      for (const [k, blob] of rows) {
        let record;
        try {
          record = JSON.parse(utf8String(await aead.open(localKey, blob, slot(MESSAGES, k))));
        } catch {
          // Not ours — another identity in this browser, or a corrupted record.
          // Both are left alone: deleting what we cannot read would let any
          // identity wipe another's history.
          continue;
        }
        if (record.firstSeen + MESSAGE_TTL_S <= nowSeconds) {
          await db.delete(MESSAGES, k);
          deleted++;
        }
      }
      return deleted;
    },
  };
}

/**
 * Everything this identity may write, over one database.
 *
 * ⚠️ `durable` and `conversation` are separate because §7.8 says so: the ordinary
 * ending clears conversation state and MUST leave §7.3.2's high-water mark, and a
 * client with no high-water mark is precisely what the roster rollback needs. The
 * split is in `db.js`; this is where a caller gets one or the other, and it is why
 * `flow/roster.js` takes two storages rather than one and refuses to invent a
 * default for the second.
 */
export function openVault({ db, localKey }) {
  if (!(localKey instanceof Uint8Array) || localKey.length !== 32) {
    throw new RangeError("vault: local_key must be 32 bytes — see PROTOCOL.md §7.2");
  }
  /**
   * §7.8 step 3's deletion plan: which rows in `ENDING_CLEARS` open under THIS
   * `local_key`. ⚠️ A plain closure and not a method, so that neither caller
   * depends on `this` — a destructured `endSession` would otherwise throw at the
   * exact moment §7.8 has already stopped every writer.
   */
  const planEnding = async () => {
    const plan = [];
    let left = 0;
    for (const store of ENDING_CLEARS) {
      const mine = [];
      for (const [key, blob] of await db.list(store, undefined)) {
        if (await opens(localKey, store, key, blob)) mine.push(key);
        else left++;
      }
      plan.push([store, mine]);
    }
    return { plan, left };
  };

  return {
    db,
    conversation: records(db, CONVERSATION, localKey),
    durable: records(db, DURABLE, localKey),
    messages: messageLog(db, localKey),

    /**
     * §7.8 step 2, and it does NOT reach `DURABLE`.
     *
     * ⚠️⚠️ IT DELETES WHAT OPENS UNDER **THIS** `local_key`, NOT EVERYTHING IN THE
     * STORES. Until 2026-08-24 this was `db.clear(ENDING_CLEARS)`, which empties
     * whole object stores — so a browser holding two identities lost BOTH when
     * either one ended ordinarily. What the other identity loses is not
     * recoverable: its messages were acknowledged and deleted from the server the
     * moment they arrived (§5.4.1), and its cached roster and Olm pickles go with
     * them. §7.8 reserves that reach for the THOROUGH ending, which is a different
     * control with a different warning, and `clearEverything` below still has it.
     *
     * ⭐⭐ THE RULE WAS ALREADY WRITTEN DOWN IN THIS FILE, IN THE METHOD NEXT DOOR.
     * `sweep()` skips a record it cannot open and says why: *"Not ours — another
     * identity in this browser... deleting what we cannot read would let any
     * identity wipe another's history."* Exactly the rule, applied by the method
     * that runs every few minutes and not by the one that runs once and is
     * irreversible. ➡️ **A RULE STATED AT ONE CALL SITE IS NOT A RULE.** Found by
     * an outside review that had not read `sweep`.
     *
     * ⚠️ WHAT IT LEAVES BEHIND, STATED RATHER THAN HIDDEN. A record of this
     * identity's that will not decrypt — corrupted, or written under a key that is
     * gone — survives the ending. It is a row nothing can read, including this
     * client, and deleting rows on any weaker test than "it opened" is how one
     * identity wipes another's. The thorough ending removes it.
     *
     * ⚠️ AND ONE RACE, WHICH §7.8 STEP 1 IS WHAT BOUNDS. The listing and the
     * decryption happen outside the transaction, because a `crypto.subtle` call
     * inside an IndexedDB transaction closes it. A message another tab appends in
     * that window survives. Step 1 stops the things that write BEFORE this runs,
     * which is what makes the window empty rather than merely small.
     */
    planEnding,

    /**
     * ⛔⛔ THE HALF THAT NEEDS THE KEY IS `planEnding()`, AND IT MUST RUN BEFORE §7.8
     * STEP 2 ZEROES IT (D-162). Deciding which rows are ours means OPENING them, so a
     * plan built after the wipe is empty and this deletes nothing while returning a
     * shape that reads like success. `flow/ending.js` therefore prepares the plan at
     * its step 2a and hands it here.
     *
     * ⚠️ The argument is optional so that a caller with a live key can still say
     * `endSession()` and mean both halves — `test/storage.mjs` does, and so does any
     * path that is not §7.8's ordered ending. It is NOT a fallback for the ordered
     * one: called there without a plan it would build an empty one and say nothing
     * was wrong. `deleted: 0` with `left` counting every row is what that looks like.
     */
    async endSession(prepared) {
      const { plan, left } = prepared ?? (await planEnding());
      await db.deleteAll(plan);
      return { deleted: plan.reduce((n, [, keys]) => n + keys.length, 0), left };
    },

    /**
     * §7.8 step 5's reach, as a method rather than as a header, for the ending
     * page that has no server. It takes the high-water mark with it, which the
     * control MUST warn about — see §7.3.2 rule 4.
     */
    async clearEverything() {
      await db.clear(STORES);
    },
  };
}

/**
 * Ghost mode's store — §7.6, and the rule is the whole of it: the root, the role,
 * the generation and ALL Olm session state live in `sessionStorage` and NOWHERE
 * ELSE. No IndexedDB, no `localStorage`, no Cache Storage, no cookie.
 *
 * ⚠️ IT IS NOT ENCRYPTED AND MUST NOT PRETEND TO BE. There is no `K_master` in
 * Ghost mode and therefore no `local_key`; a key generated here would live in the
 * same `sessionStorage` as the thing it protects. What protects Ghost state is
 * that it is measured not to survive process death on either platform tested
 * (§7.6), not that it is unreadable while it is there.
 *
 * ⚠️ §7.7 says avoid `String` on secret paths and `sessionStorage` stores only
 * strings. §7.6 records that tension rather than resolving it, and so does this.
 */
export const GHOST_PREFIX = "lpm.ghost.";

export function ghostStore(sessionStorage, prefix = GHOST_PREFIX) {
  const raw = (key) => {
    const v = sessionStorage.getItem(prefix + key);
    return v === undefined ? null : v;
  };
  return {
    async get(key) {
      const v = raw(key);
      return v === null ? null : JSON.parse(v);
    },
    async set(key, value) {
      sessionStorage.setItem(prefix + key, JSON.stringify(value));
    },
    async delete(key) {
      sessionStorage.removeItem(prefix + key);
    },

    /**
     * ⚠️⚠️ THE COMPARE-AND-SWAP IS HONEST HERE AND CANNOT HELP HERE, and the
     * difference is the one thing worth knowing about Ghost mode and tabs.
     * `sessionStorage` is per-tab, so two Ghost tabs never contend — but a
     * DUPLICATED tab is handed a COPY of it, and a copy is not a conflict: both
     * documents then hold the same Olm session, advance it independently, and
     * neither write ever meets the other's. That is key reuse with no shared record
     * anywhere to detect it, and nothing in this file can see it.
     *
     * What can see it is `flow/tabs.js`: the two documents are same-origin, so the
     * second one finds the first holding the writer claim and stands down. That is
     * the only defence, it needs Web Locks, and where Web Locks is absent this case
     * is undetectable — stated in PROTOCOL.md §7.6 rather than hidden here.
     */
    async read(key) {
      const v = raw(key);
      return { value: v === null ? null : JSON.parse(v), token: v };
    },
    async write(key, value, token) {
      const held = raw(key);
      if (held !== (token ?? null)) throw new WriteConflict("ghost: the record changed under this write");
      const next = JSON.stringify(value);
      sessionStorage.setItem(prefix + key, next);
      return next;
    },
  };
}
