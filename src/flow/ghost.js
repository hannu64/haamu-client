// Ghost mode — PROTOCOL.md §7.6, ARCHITECTURE.md §4.1's Ghost row, D-016b.
//
// No roster, no passphrase, no `K_master`. What that removes is most of this
// client: there is no identity to derive, no server-side blob, no quarantine, no
// high-water mark and no list. What it leaves is one conversation, held in one
// tab, for as long as that tab's document lives.
//
// ⚠️⚠️ §7.6's STORAGE RULE IS THE WHOLE OF GHOST MODE, AND ITS LIST WAS SHORT BY
// THE ONE ITEM THAT MATTERS MOST (0.8.14, D-072). It reads:
//
//   > the root, the role, the session generation and all Olm session state live in
//   > `sessionStorage` **and nowhere else**. No IndexedDB, no `localStorage`, no
//   > Cache Storage, no cookie.
//
// **The messages are not on that list.** Four things are named, "and nowhere else"
// closes the sentence, and the conversation itself — the plaintext a person typed
// and read — is not one of them. A closed enumeration says nothing about what it
// omits, and its emphatic tone is exactly what stops a reader noticing: the list
// looks exhaustive because it ends in a prohibition.
//
// ⚠️ AND THE GAP IS FILLED, WRONGLY, BY A SECTION THAT LOOKS UNRELATED.
// `ARCHITECTURE.md` §4.1's storage table has one Messages row — *"IndexedDB,
// encrypted"* — with **no mode qualifier**, beside a Ghost row that names only
// §7.6's four items. Read together, and read carefully, the two say: put Ghost
// mode's messages in IndexedDB, encrypted. That is the one store §7.6 forbids by
// name and the one measured to survive process death — under a key that does not
// exist, because `local_key` is derived from a `K_master` Ghost mode does not have.
// So the implementer invents a key (D-061 again) and the only place to keep it is
// the `sessionStorage` beside the ciphertext.
//
// ➡️ The question that finds this class: **if this list is exhaustive, what is NOT
// on it — and what does the rest of the document say about that?** Two rules can be
// jointly satisfiable and still leave exactly one way through, which is the wrong
// one. §7.6 now states the RULE (nothing that reveals or reopens the conversation
// leaves `sessionStorage`) and cites §7.8's `conversation state` category for the
// enumeration, so the next omission cannot happen in two places at once.
//
// ⚠️ NOTHING HERE IS ENCRYPTED AND NOTHING PRETENDS TO BE. There is no `K_master`,
// so any key would live in the same `sessionStorage` as the thing it protects.
// §7.6 is explicit that what defends Ghost mode is that `sessionStorage` is
// measured not to survive process death on either platform tested — not that
// anything in it is unreadable while it is there.
//
// ⚠️ WHAT GHOST MODE PROMISES, exactly, because §7.6 spends a paragraph on people
// getting this wrong: **nothing is written to the roster and nothing is
// recoverable on another device.** It is NOT "nothing is written to disk" — a
// `sessionStorage` area is a file — and it is NOT "dies with the tab".

import { b64uEncode, b64uDecode } from "../crypto/b64u.js";
import { randomBytes } from "../crypto/random.js";
import { randomPickleKey } from "../storage/sessions.js";
import { GHOST_PREFIX as PREFIX, MESSAGE_TTL_S, ghostStore } from "../storage/vault.js";

/** Where a Ghost session's own bookkeeping lives, under `ghostStore`'s prefix. */
export const ID_KEY = "id";
export const PICKLE_KEY = "pickle";
export const CHANNEL_KEY = "channel";
export const LOG_PREFIX = "log.";

/**
 * §4.3's cover PIN, in the mode whose whole storage rule is one sentence.
 *
 * ⚠️⚠️ §7.6 IS NORMATIVE HERE AND THIS OBEYS IT RATHER THAN MAKING AN EXCEPTION:
 * *"everything §7.8 calls CONVERSATION STATE lives in `sessionStorage` and nowhere
 * else."* A PIN chosen for this tab belongs to this tab, dies with it, and never
 * reaches IndexedDB — which is also the only place it COULD go in a mode that opens no
 * database at all.
 *
 * ⭐ IT IS NOT A SECRET THIS AREA HAS TO PROTECT, and that is worth stating rather than
 * assuming. Anybody who can read `lpm.ghost.pin` can read `lpm.ghost.channel` beside it,
 * and the channel root IS the conversation. The record is a salted hash all the same, so
 * that a PIN reused from somewhere that matters is not handed over in the clear.
 *
 * ⚠️ A DUPLICATED TAB IS HANDED A COPY OF THIS, LIKE EVERYTHING ELSE HERE. That is
 * correct: it is the same person, on the same device, in the same conversation.
 */
export const PIN_KEY = "pin";

/**
 * A Ghost session ran out of room in `sessionStorage`.
 *
 * ⚠️ IT IS REPORTABLE AND MUST NOT BE SWALLOWED. Ghost mode's entire store is one
 * origin's `sessionStorage` quota, and the only thing worse than running out of it
 * is a message that was decrypted, acknowledged to the server — which deletes the
 * server's copy (§5.4.1) — and then dropped here in silence.
 *
 * ⭐ The dangerous half is already closed by an ordering that was written for a
 * different reason: §5.4.3 makes the plaintext, the ratchet and the deletable ids
 * ONE write into the session record, and that record is in this same store. A full
 * store therefore fails *inside* `receive`, before the acknowledgement, which is
 * the safe direction. What can still fail here is the display log, one write later.
 */
export class GhostFull extends Error {
  constructor(message) {
    super(message);
    this.name = "GhostFull";
    this.reason = "ghost_full";
  }
}

const isQuota = (err) =>
  err?.name === "QuotaExceededError" || err?.name === "NS_ERROR_DOM_QUOTA_REACHED" || err?.code === 22;

/**
 * Open — or resume — the Ghost session belonging to this document.
 *
 * ⚠️⚠️ IT MINTS ONLY WHAT IS MISSING, AND THAT IS WHAT MAKES A DUPLICATED TAB
 * DETECTABLE. "Duplicate tab", and a window opened from an existing one, hand the
 * new document a **copy** of `sessionStorage` — so it finds this session's id
 * already there and adopts it, rather than minting one of its own. Two documents
 * with one id is precisely the collision `scope` below is for. A version of this
 * that generated an id per page load would be correct-looking and blind: every
 * duplicate would be a separate session that happened to share an Olm ratchet.
 *
 * ⚠️ A duplicate therefore WRITES NOTHING on this path, which §7.6 requires of it
 * ("a second document that finds the lock held MUST NOT write to that session").
 * That holds by construction rather than by checking: both values it would write
 * are already present in the copy it was handed.
 */
export async function openGhost({ sessionStorage = globalThis.sessionStorage } = {}) {
  const store = ghostStore(sessionStorage);

  let id = await store.get(ID_KEY);
  if (!id) {
    id = b64uEncode(randomBytes(16));
    await store.set(ID_KEY, id);
  }

  let pickled = await store.get(PICKLE_KEY);
  if (!pickled) {
    // §6.1's pickle key. `storage/sessions.js` explains why it is random here and
    // derived in Kept mode: there is nothing to derive it from, it lives beside
    // what it protects, and it therefore protects nothing. It is still generated
    // once and kept, because a key regenerated per page load would make §7.6's
    // "surviving accidental reload" false for the session state it names.
    pickled = b64uEncode(randomPickleKey());
    await store.set(PICKLE_KEY, pickled);
  }
  const pickleKey = b64uDecode(pickled, "ghost pickle key");

  const logKey = (channelHash) => `${LOG_PREFIX}${channelHash}`;

  /** Which conversations have a log in this document's `sessionStorage`. */
  function logs() {
    const full = `${PREFIX}${LOG_PREFIX}`;
    const out = [];
    for (let i = 0; i < (sessionStorage.length ?? 0); i++) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(full)) out.push(key.slice(full.length));
    }
    return out;
  }

  async function writeLog(channelHash, rows) {
    try {
      await store.set(logKey(channelHash), rows);
    } catch (err) {
      if (isQuota(err)) throw new GhostFull("ghost: this browser has no room left for this conversation");
      throw err;
    }
  }

  return {
    mode: "ghost",
    id,
    pickleKey,
    store,

    /**
     * The name every lock and notice channel of this Ghost session is built from.
     *
     * ⚠️ IT IS THE RANDOM ID ITSELF, NOT A HASH OF IT, and the difference from
     * `tabs.scopeFor` is the point rather than an inconsistency. §7.8.1 forbids
     * `roster_id` in a lock name because lock names are enumerable to every script
     * on the origin and `roster_id` confirms a passphrase guess in one HKDF. This
     * value confirms nothing: it is 128 random bits minted here, committed to
     * nothing, derived from nothing, and hashing it would only suggest it stands
     * for a secret it does not stand for.
     *
     * ⚠️ IT IS PER-SESSION, WHICH IS WHAT KEEPS ONE GHOST TAB OUT OF ANOTHER'S
     * ENDING. Two unrelated Ghost tabs are two identities in one browser: an
     * origin-wide name would make §7.8's end command reach a conversation the
     * person never asked to end, and a duplicated tab — which shares this id — is
     * the only client that is genuinely part of this session.
     */
    scope: `ghost.${id}`,

    /** §7.6: the root and its role. Without the role a reload cannot pick a direction. */
    async channel() {
      return (await store.get(CHANNEL_KEY)) ?? null;
    },

    /**
     * Record the conversation this session is. One, and only ever one — there is no
     * roster to hold a second, and inventing a list in `sessionStorage` would be
     * inventing the structure §7.6 removed.
     */
    async setChannel({ root, role, name, tripwire = false }) {
      // §3.6.2 rule 1: unverified until somebody compares six digits with a
      // person. There is no roster here, so §7.3.1 rule 6 has nothing to merge in
      // this mode — but it is the same field under the same name, because the chat
      // view must not have to learn which mode it is in.
      const entry = {
        root: b64uEncode(root),
        role,
        name: name ?? "",
        generation: 0,
        verified: false,
        // §3.5, and the same argument as `verified` immediately above: the same
        // field under the same name, so the chat view never has to know the mode.
        tripwire: Boolean(tripwire),
        ghost: true,
      };
      await store.set(CHANNEL_KEY, entry);
      return entry;
    },

    /** §3.6.2, in the mode with one conversation and no list. */
    async setVerified() {
      const entry = await store.get(CHANNEL_KEY);
      if (!entry) return null;
      entry.verified = true;
      await store.set(CHANNEL_KEY, entry);
      return entry;
    },

    /** §3.5, in the mode with one conversation and no list. Monotone, no inverse. */
    async setTripwire() {
      const entry = await store.get(CHANNEL_KEY);
      if (!entry) return null;
      entry.tripwire = true;
      await store.set(CHANNEL_KEY, entry);
      return entry;
    },

    /**
     * §6.3's counter, and §7.6 names it for a reason worth repeating here: with the
     * generation in memory alone, an ordinary OS page discard — the exact event
     * `sessionStorage` was chosen to survive — resets it below what the peer has
     * accepted, and §6.3 rule 1 then rejects everything this user sends, silently.
     */
    async setGeneration(generation) {
      const entry = await store.get(CHANNEL_KEY);
      if (!entry) return null;
      entry.generation = generation;
      await store.set(CHANNEL_KEY, entry);
      return entry;
    },

    /**
     * §6.6's history — the item §7.6's list omitted (D-072).
     *
     * The same four calls the Kept-mode log offers, so nothing above this line has
     * to know which mode it is in. What differs underneath is everything: no
     * encryption, no `add`-and-retry against a shared store, and no key range —
     * one document writes, and it holds the only copy.
     */
    messages: {
      async append(channelHash, message) {
        const rows = (await store.get(logKey(channelHash))) ?? [];
        const stored = { ...message, seq: rows.length };
        rows.push(stored);
        await writeLog(channelHash, rows);
        return stored;
      },

      async list(channelHash) {
        return (await store.get(logKey(channelHash))) ?? [];
      },

      async forget(channelHash) {
        await store.delete(logKey(channelHash));
      },

      /**
       * §6.6, on the same occasion as Kept mode's sweep and for a weaker reason:
       * a Ghost session that lives past a message's 24 hours is a tab left open for
       * a day. Rare, and the rule does not have an exemption for rare.
       *
       * ⚠️ IT ENUMERATES RATHER THAN BEING TOLD WHICH CONVERSATION TO SWEEP. It
       * runs at startup, which is before anything has computed a channel hash —
       * and a sweep that needed the caller to name its target would be a sweep the
       * caller could forget to point at anything. The Kept-mode one lists every row
       * in the store for the same reason.
       */
      async sweep(nowSeconds) {
        let deleted = 0;
        for (const hash of logs()) {
          const rows = await store.get(logKey(hash));
          if (!rows) continue;
          const kept = rows.filter((m) => m.firstSeen + MESSAGE_TTL_S > nowSeconds);
          if (kept.length === rows.length) continue;
          deleted += rows.length - kept.length;
          await writeLog(hash, kept.map((m, seq) => ({ ...m, seq })));
        }
        return deleted;
      },
    },

    /**
     * The key buffers §7.8 step 2 can actually reach in this mode.
     *
     * ⚠️ IT IS A SHORT LIST AND SAYING SO IS THE POINT. The pickle key and the
     * channel root are `Uint8Array`s and `fill(0)` is a real write to them. The Olm
     * session objects are inside the WASM heap and no page can zero those; §7.7
     * forbids claiming otherwise. What ends a Ghost session is step 3 clearing the
     * store, not this.
     */
    keys(channelRoot = null) {
      return channelRoot ? { pickleKey, channelRoot } : { pickleKey };
    },

    /**
     * §3.6.2's third answer, and §7.3.1a's deletion, in the mode with no roster.
     *
     * ⚠️⚠️ IT EXISTS BECAUSE ITS ABSENCE WAS A HOLE, AND THE HOLE HAD A SHAPE WORTH
     * KEEPING. `app/app.js`'s `removeConversation` reads *"remove it from the roster,
     * unless this is Ghost mode"* — and in Ghost mode it then removed nothing at all,
     * because there was no third branch. The Olm state and the message log went, the
     * channel entry stayed, and `backToStart()` read it and reopened the
     * conversation. After a SAS mismatch, that is the conversation with the person
     * who is **not** who they said they were, reopened over the same root, ready for
     * the next send to establish a fresh session on it. Found by the 2026-08-24
     * outside review.
     *
     * ➡️ **A CONDITION WITH TWO BRANCHES AND THREE MODES SILENTLY DOES NOTHING IN THE
     * THIRD.** `else if (!isGhost())` reads like a guard and behaves like a hole.
     *
     * ⚠️ IT IS NOT `discard()` AND MUST NOT BECOME IT. `discard()` removes what
     * `openGhost` minted — the pickle key and the session id — and its own comment
     * forbids reaching it once a channel exists. This removes the CONVERSATION and
     * leaves the Ghost session standing, which is what the same control does in Kept
     * mode: the person is returned to a mode with nothing in it, not signed out of a
     * mode they are still in.
     *
     * ⚠️ THE OLM STATE AND THE MESSAGE LOG ARE NOT REMOVED HERE, and that is not an
     * omission. `removeConversation` already removes both by the mode-agnostic route
     * (`storage/sessions.js` and `session.messages`), and a second remover would be a
     * second place for the list to drift.
     */
    async removeChannel() {
      await store.delete(CHANNEL_KEY);
    },

    /**
     * Undo `openGhost` — for somebody who opened this screen and changed their mind.
     *
     * ⚠️ IT IS NOT AN ENDING AND MUST NOT BE CONFUSED WITH ONE. §7.8's ending is a
     * six-step order with a census and a navigation; this removes the two values
     * `openGhost` minted, on a session that never had a conversation in it, so that
     * a tab which merely visited this mode is not one afterwards. Reaching it once
     * a channel exists would be exactly the silent data loss §7.8 exists to make
     * deliberate, so the caller must not offer it there.
     */
    async discard() {
      for (const hash of logs()) await store.delete(logKey(hash));
      await store.delete(CHANNEL_KEY);
      await store.delete(PICKLE_KEY);
      await store.delete(ID_KEY);
    },
  };
}

/** Is there a Ghost session in this document's `sessionStorage` to resume? */
export async function resumable({ sessionStorage = globalThis.sessionStorage } = {}) {
  const store = ghostStore(sessionStorage);
  return Boolean(await store.get(CHANNEL_KEY));
}
