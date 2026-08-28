// Where a channel's Olm state lives between operations — PROTOCOL.md §6.3, §5.4.2.
//
// ARCHITECTURE.md §4 puts persistence in `/storage`. This file is the RECORD and
// the small interface a backend has to satisfy. Nothing here decides anything —
// §6.3's rules are in `protocol/session.js` and the ordering is in
// `flow/message.js`, and the backends are in `vault.js`: IndexedDB sealed under
// `local_key` in Kept mode, `sessionStorage` in Ghost mode (§7.6), a Map in tests.
//
// ⚠️ THE RECORD HOLDS PLAINTEXT — the decrypted staging list of §5.4.3 lives in it,
// beside the pickles, because the crash rule below requires them written together.
// What keeps that off a locked device's disk is the backend, not this file: §7.2's
// `local_key` is derived from `K_master`, which is memory-only, so an unlocked
// session is the only state in which these records can be read back at all.

import { randomBytes } from "../crypto/random.js";
import { rootHash } from "../protocol/roster.js";
import { CONVERSATION } from "./db.js";

export const RECORD_V = 1;

/** §5.4.2's "recommended: 3, across separate drains". */
export const MAX_DECRYPT_FAILURES = 3;

/** A Map-backed backend. The interface a real one has to satisfy is these five. */
export function memoryBackend() {
  const m = new Map();
  return {
    async get(key) {
      return m.has(key) ? JSON.parse(m.get(key)) : null;
    },
    async set(key, value) {
      m.set(key, JSON.stringify(value));
    },
    async delete(key) {
      m.delete(key);
    },
    async read(key) {
      const raw = m.has(key) ? m.get(key) : null;
      return { value: raw === null ? null : JSON.parse(raw), token: raw };
    },
    async write(key, value, token) {
      const held = m.has(key) ? m.get(key) : null;
      if (held !== (token ?? null)) throw new RecordConflict("memory: the record changed under this write");
      const raw = JSON.stringify(value);
      m.set(key, raw);
      return raw;
    },
  };
}

/**
 * ⚠️ THE PICKLE KEY MUST NOT BE `R`, and that is the whole rule. A pickle
 * encrypted under the channel root would put the stored ratchet inside the same
 * secret the roster already holds, so recovering one would recover the other — and
 * §6.2's forward-secrecy argument is precisely that the ratchet state is the part
 * `R` cannot reach.
 *
 * ⭐ WHAT SUPPLIES IT NOW IS §7.2, AND THAT IS WHY A RELOAD NO LONGER COSTS A
 * GENERATION. Until step 8 the key was generated per tab, so the pickles could not
 * outlive it however durable the store was; §6.3 covered the loss by restarting the
 * session one generation up, which works and spends something. `pickle_key =
 * HKDF(K_master, "lpm-pickle-key-v1", 32)` comes back with the passphrase, so the
 * sessions do too.
 *
 * Ghost mode has no `K_master` and therefore nothing to derive from, so it uses
 * the key below — generated once and held with the session state it protects,
 * which protects nothing and does not pretend to. §7.6 is explicit that what
 * defends Ghost mode is that `sessionStorage` is measured not to survive process
 * death, not that anything in it is unreadable while it is there.
 */
export function randomPickleKey() {
  return randomBytes(32);
}

/** An untouched channel. */
export function emptyRecord() {
  return {
    v: RECORD_V,
    generation: 0,
    sending: null,
    sessions: {},
    acceptedPrekeys: [],
    staged: [],
    failures: {},
  };
}

/**
 * ⛔⛔ THE SCOPE IS NOT OPTIONAL AND A DEFAULT WOULD BE THE BUG (D-171).
 *
 * `ARCHITECTURE.md` §4.1.1 requires every record's NAME to say whose record it is,
 * and until D-171 it exempted "a hash of the channel root, which is one identity's
 * by construction". **That clause is false.** §3 gives BOTH ends of a channel the
 * same `R`, so both compute the same hash — and a browser holding both ends of one
 * pairing addressed one row with two identities. The exemption I wrote was the
 * defect, and the guard was written from the exemption, so it could not see it.
 *
 * A missing scope therefore throws rather than defaulting. A default would put the
 * old shared name back at whichever call site forgot, which is precisely the shape
 * D-165 has now cost four rounds.
 */
function requireScope(scope) {
  if (typeof scope !== "string" || scope.length === 0) {
    throw new RangeError(
      "session store: every record's name must say whose it is — pass the identity scope (ARCHITECTURE.md §4.1.1)"
    );
  }
  return scope;
}

/**
 * The storage key for a channel.
 *
 * `R` itself is never a key. Storage keys leak more readily than values — they
 * appear in indexes, in developer tools, in a database dump taken without the
 * values — and §7.3 already defines a 128-bit commitment to a root for exactly
 * this kind of reference. ⚠️ That commitment says WHICH channel and cannot say
 * WHOSE side of it — see `requireScope` above.
 */
export async function channelKey(scope, channelRoot) {
  return `lpm.session.${requireScope(scope)}.${await rootHash(channelRoot)}`;
}

/**
 * Load a channel's record, and the token that says which version of it this is.
 *
 * ⚠️⚠️ THE TOKEN IS RETURNED BESIDE THE RECORD RATHER THAN ON IT, AND THAT IS
 * DELIBERATE (PROTOCOL 0.8.12). Carrying it as a field would ride along through
 * every `{...record}` in `protocol/session.js` for free — until one rule function
 * built a fresh object instead of spreading, and dropped it. `saveRecord` would
 * then compare against "there should be nothing here", fail forever, and the cause
 * would be four files away. Threading it by hand is more typing and cannot be
 * forgotten quietly: the call site does not compile in the reader's head without it.
 */
export async function loadRecord(backend, scope, channelRoot) {
  const { value, token } = await backend.read(await channelKey(scope, channelRoot));
  if (!value) return { record: emptyRecord(), token: null };
  if (value.v !== RECORD_V) throw new RangeError(`session store: unsupported record version ${value.v}`);
  return { record: value, token };
}

/**
 * ⚠️⚠️ ONE WRITE, AND IT IS THE ATOMIC UNIT OF THE WHOLE RECEIVE PATH. The
 * advanced ratchet, the decrypted plaintext and the list of message ids that are
 * safe to delete are written together or not at all. A backend that split them
 * would reintroduce precisely the failure `flow/message.js` describes: state that
 * says a message was read alongside a message that was never handed over.
 *
 * ⚠️⚠️ AND IT IS CONDITIONAL ON `token`, WHICH IS WHAT STEP 9 ADDED AND WHY. The
 * rule above was written against a crash — one writer, interrupted. Step 8 moved
 * this record into IndexedDB, which every tab of the origin shares, and a rule
 * about ORDER says nothing about a SECOND WRITER: two tabs that each load, advance
 * the ratchet and store are a lost update, and the update lost is the record of a
 * chain key having been used. The next send encrypts under a message key that is
 * already spent — two plaintexts under one key, which for AES-CBC is their XOR.
 *
 * The write therefore refuses unless the stored record is still the one the caller
 * read. Refusing is safe wherever it can happen, because `flow/message.js` puts
 * every irreversible act — the transmission, the acknowledgement — AFTER this line.
 */
export async function saveRecord(backend, scope, channelRoot, record, token = null) {
  return backend.write(await channelKey(scope, channelRoot), record, token);
}

/**
 * A write refused because another client got there first.
 *
 * ⚠️ NOT A FAILURE TO REPORT TO A PERSON. Nothing was lost and nothing was sent;
 * the caller reads the new state and decides again. It reaches a user only after
 * `flow/message.js` has run out of attempts, which means a tab is writing to this
 * channel continuously.
 */
export class RecordConflict extends Error {
  constructor(message) {
    super(message);
    this.name = "RecordConflict";
    this.reason = "record_conflict";
  }
}

/** Is this the storage layer saying "somebody else wrote first"? */
export function isConflict(err) {
  return err?.reason === "record_conflict";
}

export async function forgetChannel(backend, scope, channelRoot) {
  await backend.delete(await channelKey(scope, channelRoot));
  await backend.delete(await closedKey(scope, channelRoot));
}

// -------------------------------------------------- §6.7.1 — the closed marker

/**
 * Where "the other person has left this conversation" is remembered.
 *
 * ⚠️ IT IS CONVERSATION STATE AND NOT ROSTER STATE, and `ARCHITECTURE.md` §4.1
 * now says so in the table. It is derived from a MESSAGE, and messages do not
 * travel between one user's devices at all (D-045 — sequential migration, not
 * concurrent use). Putting it in the roster would make it the one fact about a
 * conversation's *contents* that syncs, and it would cost a roster write — a
 * server contact — on the receipt of a message, which §7.3.3's list of five
 * permitted occasions does not include and must not gain.
 *
 * ⭐ It is a separate key rather than a field on the session record, because the
 * session record is rotated, pruned and rebuilt by §6.3's rules and this outlives
 * all of that: a peer who left is still gone after a session rotation.
 */
export async function closedKey(scope, channelRoot) {
  return `lpm.closed.${requireScope(scope)}.${await rootHash(channelRoot)}`;
}

/** `{ at }` in unix seconds, or null. */
export async function loadClosed(backend, scope, channelRoot) {
  return (await backend.get(await closedKey(scope, channelRoot))) ?? null;
}

export async function markClosed(backend, scope, channelRoot, at) {
  await backend.set(await closedKey(scope, channelRoot), { v: 1, at });
}

/**
 * §6.7.1 rule 8: a later message from that peer clears it.
 *
 * ⚠️ A CLIENT OF THIS PROTOCOL CANNOT REACH THIS, which is exactly why it exists.
 * Closing destroys the ratchet at the sending end, so anything arriving afterwards
 * is a hostile or broken peer — and the honest response is the one that does not
 * hide content. Leaving "they have left" over a screen that is receiving messages
 * would be the client lying about what is in front of it.
 */
export async function clearClosed(backend, scope, channelRoot) {
  await backend.delete(await closedKey(scope, channelRoot));
}

// --------------------------------------------- D-171 — the two names that were the channel's

/** The record families whose names used to say WHICH channel and not WHOSE side of it. */
export const LEGACY_CHANNEL_PREFIXES = Object.freeze(["lpm.session.", "lpm.closed."]);

/**
 * Move this identity's channel records onto names that say they are this identity's.
 *
 * ⚠️⚠️ IT MOVES WHAT OPENS AND LEAVES EVERYTHING ELSE EXACTLY WHERE IT IS — the rule
 * `vault.js` states at `sweep()`, reaching its fifth call site. A row at one of these
 * old names belongs to whichever end of the channel wrote it FIRST (the write is a
 * compare-and-swap, so the second end was refused and never had a row at all). For
 * that other identity this row is live data: an Olm ratchet and, with it, every message
 * still in flight. Deleting it because we cannot read it is how one identity destroys
 * another's conversation.
 *
 * ⚠️ TELLING A MIGRATED NAME FROM A LEGACY ONE IS A DOT. Both the scope and the channel
 * hash are base64url, which has no `.` in its alphabet — so `lpm.session.<hash>` has no
 * dot after the prefix and `lpm.session.<scope>.<hash>` has exactly one. No version
 * marker is needed and none is invented.
 *
 * ⚠️ THE LISTING IS BY NAME AND THE DECISION IS BY KEY. `db.list` gives names without
 * decrypting anything; `storage.attempt` is what answers "is this ours", and it is the
 * only thing that may.
 */
export async function adoptLegacyChannelRecords(db, storage, scope) {
  if (typeof storage?.attempt !== "function") return { moved: 0, left: 0, supported: false };
  requireScope(scope);
  let moved = 0;
  let left = 0;
  for (const [key] of await db.list(CONVERSATION, undefined)) {
    if (typeof key !== "string") continue;
    const prefix = LEGACY_CHANNEL_PREFIXES.find((pre) => key.startsWith(pre));
    if (!prefix || key.slice(prefix.length).includes(".")) continue;
    const held = await storage.attempt(key);
    if (!held.found || !held.ours) {
      // Another identity's — the other end of this channel, living in this browser.
      // It stays at the old name, which is still a name it alone can read.
      left++;
      continue;
    }
    const target = `${prefix}${scope}.${key.slice(prefix.length)}`;
    // ⚠️ The scoped record wins if both exist: it was written by this build and is
    // therefore the later one. The legacy row is OURS — it opened — so removing it is
    // this identity discarding its own superseded copy and reaches nobody else.
    if (!(await storage.attempt(target)).found) await storage.set(target, held.value);
    await storage.delete(key);
    moved++;
  }
  return { moved, left, supported: true };
}
