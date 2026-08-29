// The pairing handshake, both roles — PROTOCOL.md §3, protocol version 0.8.5.
//
// `src/protocol/pairing.js` holds the arithmetic and is pure. This file holds the
// ORDER, which is where §3's security actually lives:
//
//   §3.1  I  POST   /api/pair/{id}          commit_I, mac_I          [PoW]
//   §3.2  J  GET    /api/pair/{id}          → commit_I, mac_I
//         J  POST   /api/pair/{id}/claim    J_pub, mac_J
//   §3.3  I  GET    /api/pair/{id}/status   → J_pub, mac_J
//         I  POST   /api/pair/{id}/reveal   I_pub
//   §3.4  J  GET    /api/pair/{id}/status   → I_pub
//         J  DELETE /api/pair/{id}
//
// ⚠️⚠️ FIVE MESSAGES, NOT FOUR, AND THE EXTRA ONE IS NOT AN OPTIMISATION. Up to
// protocol 0.8.4 the initiator published `I_pub` in its offer, so the joiner — or
// an attacker standing in the joiner's place with `L` — chose its own key after
// seeing it, and could grind the six-digit short authentication string until two
// relayed channels displayed the same digits. Measured at 2,700 attempts a second
// in unoptimised Node — which at 10⁶ digits is roughly six minutes of grinding, and
// so was INSIDE the ten-minute session this was measured against.
//
// ⚠️⚠️ D-136 RAISED THAT SESSION TO A DAY, AND WHY THAT DOES NOT REOPEN IT IS WORTH
// WRITING DOWN. The bound was never really the clock. With §3.6.1's commitment
// neither side can choose its key after seeing the other's, so the digits are uniform
// to both and each attempt costs a WHOLE FRESH PAIRING that both users watch fail. A
// day of wall-clock buys no extra attempts against one pairing, because the attempts
// are not free tries against a stored value — they are visible restarts. The other
// lifetime-sensitive quantity is §2.2's spoken code, and D-101 settled that
// separately: at sixteen characters the lifetime stops being load-bearing, which is
// precisely the precondition §3.4.1b rule 9 attaches to raising the TTL.
//
// §3.6.1 has the account. Anyone "simplifying" this back to four messages has
// reopened it.
//
// Three checks in here are the difference between a paired channel and a relayed
// one, and each returns a boolean that MUST be branched on:
//
//   J verifies `mac_I`          before it chooses a key         (§3.2)
//   I verifies `mac_J`          before it derives or reveals    (§3.3)
//   J opens the commitment      before it derives anything      (§3.4)

import { b64uDecodeExact, b64uEncode } from "../crypto/b64u.js";
import * as bytes from "../crypto/bytes.js";
import * as x25519 from "../crypto/x25519.js";
import * as code from "../protocol/code.js";
import * as pairing from "../protocol/pairing.js";
import * as pow from "../protocol/pow.js";

/**
 * A pairing that did not complete, with a machine-readable reason.
 *
 * The reasons are distinct because the right thing to tell the user differs, and
 * two of them are security events rather than failures:
 *
 *   link_malformed        the link is not a link
 *   code_malformed        §2.2's spoken code is not sixteen characters of the
 *                         alphabet. Its OWN reason rather than `link_malformed`,
 *                         because the two arrive by different routes from
 *                         different people: a link is pasted and is right or
 *                         truncated, while a code was *heard* and is short a
 *                         character or holds one that was never in it
 *   offer_unverified      §3.2: `mac_I` is wrong. Corrupted link, or a server
 *                         substituting keys. Hard error, no retry
 *   commitment_mismatch   §3.4: the revealed key does not open the commitment.
 *                         An attempted substitution. Hard error, NEVER retry
 *   already_claimed       somebody holding `L` claimed first (§3.5's alarm)
 *   claim_forged          the session was taken by a claim whose MAC is wrong —
 *                         somebody who saw `pairing_id` but does not hold `L`.
 *                         Denial of service, not interception. The link is spent
 *   expired               the link's lifetime ran out
 *   not_found             no such session: expired, deleted, or never created
 *   server_state          the server refused a legal-looking step. A bug, here
 *                         or there
 */
export class PairFailure extends Error {
  constructor(reason, message) {
    super(message);
    this.name = "PairFailure";
    this.reason = reason;
  }
}

/** How often the poll asks. Replaced by SSE at ROADMAP step 6. */
export const POLL_INTERVAL_MS = 750;

/**
 * §3.4.1b rule 11: how long this client polls ACTIVELY. **Not how long the link
 * lives, and the two were the same number until D-136 made them differ by 144×.**
 *
 * ⚠️⚠️ THE DEADLINE USED TO BE READ OFF THE SESSION TTL, BECAUSE THAT WAS THE ONLY
 * NUMBER IN SCOPE. At ten minutes nobody could tell the difference. At a day it is
 * ~114,894 requests from one tab where there were ~798 (measured at 752 ms,
 * 2026-08-20) — and `GET /status` is exempt from §9.2's per-IP limits precisely
 * because clients poll it, so nothing on the server was going to say no.
 *
 * ⭐ Ten minutes is not arbitrary: it is the entire pairing window as it stood
 * before D-136. Reaching it is NOT a failure of the pairing — the link is good for
 * the rest of its day. Only the watching stops, and rule 2's carry-on offer is what
 * picks it back up.
 */
export const POLL_ACTIVE_BUDGET_MS = 10 * 60 * 1000;

/**
 * §3.4.1b rule 10: a transport failure gets these retries, in these gaps, before it
 * is allowed to interrupt the wait at all. ~12.5 s of tolerance in total.
 *
 * ⚠️ THIS BELONGS HERE AND NOT IN `api.js`. Every §3 endpoint would inherit a retry
 * placed there — including the `POST` that creates a session and the `POST` that
 * claims one, where a retry that cannot tell "never arrived" from "arrived, answer
 * lost" is a second session or a second claim. **A `GET` of `/status` is the one
 * request in this file that is safely repeatable**, because it changes nothing.
 */
export const POLL_RETRY_BACKOFF_MS = [500, 1500, 3500, 7000];

/**
 * §3.4.1 / §3.4.1b: where pairing-in-progress state lives.
 *
 * ⚠️ IT HAS TO SURVIVE THE PAGE, AND THE REASON IS A MEASUREMENT, NOT A PREFERENCE.
 * Memory alone is not survivable: the user shares the link, switches to the
 * messaging app to send it, and iOS discards the page. The link is then live with
 * no legitimate claimant, an attacker who has it claims unopposed, and the §3.5
 * tripwire never fires because no second claim ever arrives.
 *
 * ⚠️⚠️ SINCE §3.4.1b (protocol 0.9.10, D-134) THIS FILE DOES NOT CHOOSE THE STORE.
 * The caller passes one, because the choice belongs to the mode and not to the
 * handshake:
 *
 *   Kept   `vault.conversation` — IndexedDB, sealed under `local_key` (§7.2), so
 *          the pairing resumes at the next unlock and a CLOSED browser cannot read
 *          its own link secret until the passphrase is typed back in
 *   Ghost  `sessionStorage` — §7.6 writes nothing durable, so a Ghost pairing stays
 *          bound to its tab and does NOT resume
 *
 * ⭐ The move to a durable store makes the exposure SMALLER, which is the opposite
 * of how it sounds. `sessionStorage` is persisted (§7.6) — `L` and a live private
 * key were already plaintext on disk for the whole window. Sealed, the same bytes
 * are unreadable without `K_master`, which is memory-only (§4.1). The difference
 * between the two stores was never disk; it is lifetime and encryption (D-134).
 *
 * A store is anything with async `get`/`set`/`delete` — the interface
 * `storage/vault.js` already speaks. A Web Storage object is accepted too and
 * wrapped, which is what keeps §7.6 and the unit tests working unchanged.
 */
const STORAGE_KEY = "lpm.pairing-in-progress.v1";

/** The key inside a record store. Web Storage keeps using `STORAGE_KEY`. */
export const INFLIGHT_KEY = "pairing-in-progress-v1";

/**
 * The same record, addressed by ONE identity rather than by the whole browser.
 *
 * ⛔⛔ IN KEPT MODE THIS RECORD LIVES IN INDEXEDDB, NOT IN `sessionStorage`, AND THE
 * NAME ABOVE IS THE SAME FOR EVERY IDENTITY THERE (D-170). `app.js`'s
 * `pairingStore()` hands this file `vault.conversation` when the mode is Kept, so
 * starting a pairing on one KEY **overwrote** the record of a pairing in flight on
 * another — including the ephemeral private key that is the only thing matching the
 * published commitment (§3.4.1). `loadInFlight` then found a record it could not
 * open and correctly returned `null`, so the other identity's pairing did not fail
 * loudly: **it was silently no longer in flight.** Reproduced before it was fixed —
 * `~/lpm-probes/probe-two-identities-inflight.mjs`.
 *
 * ⚠️ GHOST MODE NEEDS NO SCOPE AND CANNOT HAVE ONE. There `pairingStore()` is
 * `undefined`, `recordStore` falls through to `sessionStorage`, and that store is
 * per tab and per origin — already exactly one identity's. §7.6 has no roster and
 * so no `roster_id` to derive a digest from, which is the same fact stated twice.
 */
export function scopedStore(storage, scope) {
  if (!storage || typeof scope !== "string" || scope.length === 0) return storage;
  const at = (key) => `lpm.pairing.${scope}.${key}`;
  return {
    get: (key) => storage.get(at(key)),
    set: (key, value) => storage.set(at(key), value),
    delete: (key) => storage.delete(at(key)),
    attempt: typeof storage.attempt === "function" ? (key) => storage.attempt(at(key)) : undefined,
  };
}

/**
 * Move a pre-D-170 in-flight record onto this identity's own key, once.
 *
 * ⚠️⚠️ IT MOVES RATHER THAN DELETES, AND §3.4.1b RULE 6 IS WHY. An abandoned record
 * owes the server a `DELETE` before it goes (D-165), and the machinery that sends
 * it — `loadInFlight` → `discardExpired` — reads the record. Deleting the row here
 * would discharge nothing and leave a link claimable for its full ten minutes.
 * Moved, it arrives in front of exactly the code that already knows what it owes.
 *
 * ⚠️ A record that does not open is another identity's live pairing and is left
 * alone, for the reason `storage/vault.js` gives once for the whole client.
 */
export async function adoptLegacyInFlight(storage, scope) {
  if (typeof storage?.attempt !== "function" || typeof scope !== "string" || !scope) return "unsupported";
  const legacy = await storage.attempt(INFLIGHT_KEY);
  if (!legacy.found) return "nothing-there";
  if (!legacy.ours) return "not-ours";
  const scoped = scopedStore(storage, scope);
  const mine = await scoped.attempt(INFLIGHT_KEY);
  // This identity already has one in flight here; the older row is the stale one.
  if (!mine.found) await scoped.set(INFLIGHT_KEY, legacy.value);
  await storage.delete(INFLIGHT_KEY);
  return mine.found ? "discarded" : "moved";
}

/** Wrap a Web Storage object in the record interface, so there is one code path. */
function wrapWebStorage(webStorage) {
  return {
    async get() {
      try {
        const raw = webStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },
    /**
     * ⚠️⚠️ IT THROWS NOW, AND THE COMMENT THAT USED TO SIT HERE WAS HALF RIGHT.
     * It said *"nothing to do and nothing to report"*: the first half stands —
     * failing the pairing over a full quota would be worse — but the second half was
     * the defect. `saveInFlight` turns this into a boolean and the interface says so,
     * because §3.4.1b requires the interface to AGREE WITH THE RECORD, and
     * `keepOpen.kept` promises in as many words that closing the browser is safe.
     */
    async set(_key, value) {
      webStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    },
    async delete() {
      try {
        webStorage.removeItem(STORAGE_KEY);
      } catch {
        /* nothing to do and nothing to report */
      }
    },
  };
}

/**
 * ⚠️ THE TEST IS `get`, NOT `getItem`. A record store (vault, Ghost store, a Map in
 * a test) has `get`; Web Storage has `getItem` and would silently do nothing if it
 * were called as one.
 */
function recordStore(storage) {
  if (storage && typeof storage.get === "function") return storage;
  const web = webStorageOrNull(storage);
  return web ? wrapWebStorage(web) : null;
}

function webStorageOrNull(storage) {
  if (storage) return storage;
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    // A browser configured to refuse storage throws on the property itself.
    return null;
  }
}

/**
 * Persist the in-flight session. `pairing_id` is not stored — it derives from L.
 *
 * ⭐⭐ RETURNS WHETHER THE RECORD IS ACTUALLY THERE, AND THAT IS THE WHOLE FIX.
 * It swallowed every failure and returned nothing, so a device with a full or
 * refused store published its commitment, displayed a link good for §3.4.1b's whole
 * TTL, and told the person — in `keepOpen.kept`, in as many words — that closing the
 * browser was safe and they could carry on next time they typed their KEY. There was
 * no record to carry on from. The friend waits on a session the initiator can never
 * complete, and nothing anywhere said so.
 *
 * ⚠️ IT IS STILL NOT FATAL, AND THAT PART OF THE OLD REASONING WAS RIGHT. A browser
 * refusing storage can complete a pairing perfectly well inside one tab; refusing to
 * pair at all would take the product away from the people most likely to be using a
 * locked-down browser. **The failure is reported, not raised** — §3.4.1b rule 10's
 * own principle, that a client which cannot classify keeps working and tells the
 * truth about what it has.
 */
async function saveInFlight(storage, { role, linkSecret, privateKey, expiresAt }) {
  const s = recordStore(storage);
  if (!s) return false;
  try {
    await s.set(INFLIGHT_KEY, {
      v: 1,
      role,
      l: b64uEncode(linkSecret),
      priv: b64uEncode(privateKey),
      expires_at: expiresAt,
    });
    return true;
  } catch {
    // Full, refused, or a store that is not answering.
    return false;
  }
}

/**
 * Read an in-flight session, or null.
 *
 * ⚠️ §3.4.1b rule 4: THE CLIENT ENFORCES THE EXPIRY AND DOES NOT WAIT TO BE TOLD.
 * An expired record is deleted here rather than returned, because the record is the
 * thing that leaves a claimable secret at rest — so its life is bounded on the
 * device that stores it, by a check that runs before anything is sent. The server
 * refusing expired sessions is a second line, not this one.
 *
 * ⚠️⚠️ AND RULE 6 NAMES RULE 4 IN THE SAME BREATH, WHICH THIS FUNCTION DID NOT
 * (D-165, outside review slice B #5). *"A client MUST send it … when it discards a
 * record under rule 4, rule 5 or rule 10"* — and this cleared the record and returned,
 * owing a `DELETE` it had just destroyed the only input to. The comment above cited
 * rule 4 and stopped there. ➡️ **Citing a rule is not applying it, and the rule beside
 * the one you cited is the one you are most likely to miss.**
 *
 * ⚠️⚠️ THE WINDOW IS REAL AND IT IS THE INITIATOR'S OWN ARITHMETIC. `initiate` stamps
 * `expires_at` BEFORE §9.1's proof-of-work and before the `POST` that creates the
 * session — round 5 measured a thirty-second search on a slow phone — so the local
 * record dies that far AHEAD of the server's. In that gap the link is live, claimable,
 * and completable by nobody, which is precisely the hazard §3.4.1a named.
 *
 * ⚠️ `api` IS OPTIONAL BECAUSE THE STORE IS READ IN PLACES THAT HAVE NO SERVER — the
 * suites, and `join`'s own "have I been here before?" check. Without it the record is
 * still discarded, because rule 4's MUST does not wait for a network.
 */
export async function loadInFlight(storage, { api = null } = {}) {
  const s = recordStore(storage);
  if (!s) return null;
  let rec;
  try {
    rec = await s.get(INFLIGHT_KEY);
  } catch {
    return null;
  }
  if (!rec) return null;
  try {
    if (rec?.v !== 1) return null;
    if (typeof rec.expires_at !== "number" || rec.expires_at <= Date.now()) {
      await discardExpired(storage, rec, api);
      return null;
    }
    return {
      role: rec.role,
      linkSecret: b64uDecodeExact(rec.l, pairing.LINK_SECRET_BYTES, "stored L"),
      privateKey: b64uDecodeExact(rec.priv, 32, "stored private key"),
      expiresAt: rec.expires_at,
    };
  } catch {
    // ⚠️ NO `DELETE` IS OWED HERE AND NONE CAN BE BUILT. Reaching this means `L` itself
    // would not decode, so there is no `pairing_id` to address — an unreadable record
    // is not a session this device can prove anything about.
    await clearInFlight(storage);
    return null;
  }
}

/**
 * §3.4.1b rule 4's discard, with rule 6's `DELETE` PREPARED BEFORE IT.
 *
 * ⚠️⚠️ THE DERIVATION HAPPENS ABOVE THE CLEAR AND MUST. Rule 6: *"`pairing_id` derives
 * from `L`, and `L` is in the record being discarded. The `DELETE` MUST therefore be
 * prepared before the record is cleared, not after — an implementation that clears
 * first has thrown away the only input to the request it now owes."* `concludePairing`
 * takes its `pairingId` as an argument for exactly this reason; this is the second
 * discard path and it had no such argument to take.
 *
 * ⚠️⚠️ THE INITIATOR'S ALONE, AND THAT IS NARROWER THAN RULE 6 AS WRITTEN. Rule 6
 * restricts only its rule 10 occasion to role I. But the reason it gives applies here
 * unchanged: a joiner's expired record belongs to somebody else's session, which is
 * either already claimed — carrying §3.5's evidence the initiator is entitled to read —
 * or one this device is not a party to at all. *"Deleting either destroys another
 * party's state on a guess."* ⚠️ **Raised with PROTOCOL.md rather than assumed: rule 6
 * may want the same ⚠️ extended to rule 4.**
 */
async function discardExpired(storage, rec, api) {
  let pairingId = null;
  if (api && rec.role === pairing.ROLE_INITIATOR) {
    try {
      const l = b64uDecodeExact(rec.l, pairing.LINK_SECRET_BYTES, "stored L");
      ({ pairingId } = await pairing.derivePairing(l));
    } catch {
      pairingId = null; // unreadable: there is nothing to address
    }
  }
  await clearInFlight(storage);
  if (!pairingId) return;
  // Rule 6 SHOULDs a retry at the next unlock — and the record that would have carried
  // one is now gone by rule 4's MUST, so the memo is the only thing `abandon` has left.
  lastPairingId = pairingId;
  try {
    await api.del(idPathFor(pairingId));
    lastPairingId = null;
  } catch {
    // Kept in the memo above, which is what `abandon` retries from.
  }
}

export async function clearInFlight(storage) {
  const s = recordStore(storage);
  if (!s) return;
  try {
    await s.delete(INFLIGHT_KEY);
  } catch {
    /* nothing to do and nothing to report */
  }
}

// ------------------------------------------------------------------ helpers

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(signal.reason ?? new Error("aborted"));
      },
      { once: true }
    );
  });

function fail(err) {
  // The server's machine-readable codes, mapped once.
  if (err instanceof PairFailure) return err;
  // ⚠️⚠️ THE NETWORK'S FAILURE HAD NO `reason` AND SO HAD NO SENTENCE (feedback 16).
  // `NetworkError` is not an `ApiError` — nothing answered at all — so it fell past
  // every branch below, reached the screen as the generic *"something went wrong"*,
  // and was painted as a failure of a pairing that §3.4.1b rule 10 had just decided
  // to KEEP. ⭐ Feedback 13 was this same gap at `429`. The reasons that go unmapped
  // are the ones the server never gets to name.
  if (err?.name === "NetworkError") {
    return new PairFailure("offline", "the connection dropped before the pairing finished");
  }
  if (err?.name === "ApiError") {
    if (err.status === 404) return new PairFailure("not_found", "the pairing session is gone");
    if (err.code === "already_claimed") {
      return new PairFailure("already_claimed", "somebody claimed this link first");
    }
    // ⚠️⚠️ §9.2's REFUSAL WAS NOT MAPPED, AND THE FIRST USER SAW WHAT THAT COSTS:
    // *"429 rate_limited"*, on screen, under the heading "Pairing did not complete"
    // (feedback 13, 2026-08-13). The interface looks up a sentence by `reason`; an
    // `ApiError` carries `code` and `status` and no `reason` at all, so an error
    // that leaves this function unmapped arrives at the screen as the exception's
    // own message. ⭐ The limiter doing exactly its job read as a crash.
    if (err.status === 429) return new PairFailure("rate_limited", "too many attempts from this network");
    if (err.status === 409) return new PairFailure("server_state", `server refused: ${err.code}`);
  }
  return err;
}

/**
 * §3.4.1b rule 10. Is this pairing OVER, or did only this ATTEMPT fail?
 *
 * ⚠️⚠️ THE SECTION NEVER SAID, AND THIS FILE ANSWERED IT ANYWAY. Rules 4, 5 and 6
 * name three occasions for discarding the record — expiry, replacement, walking away
 * — and not one of them is "it went wrong". The `finally` blocks below discarded it
 * on every failure, and the reason written above one of them was *"a record kept past
 * a failure is a live link secret at rest with nothing left to do"*. That is true of
 * a terminal failure and **false of a transient one**, and it was applied to both.
 *
 * ⚠️ WHAT THAT COST, MEASURED 2026-08-20: the record survived the browser being
 * KILLED — no unwind runs, so nothing deleted it — and was destroyed by SIX SECONDS
 * OFFLINE, with the pairing still valid for hours. The hardest failure was
 * survivable and the softest was not, which is why nobody went looking. On a phone,
 * wifi → cellular is the softest one.
 *
 * ⭐ UNRECOGNISED MEANS TRANSIENT, DELIBERATELY. The two mistakes are not the same
 * size. A record kept in error is sealed (rule 3), expires on its own (rule 4) and
 * can be cancelled (rule 6). A record deleted in error destroys the only private key
 * matching a commitment already published to the server, and **nobody can recover it
 * — not the other party, not the server, not the user.** So this list is of the
 * failures that END things, and everything else is given the benefit of the doubt.
 */
const TERMINAL_REASONS = new Set([
  "link_malformed", // there was never a session
  "code_malformed",
  "offer_unverified", // §3.2: not a party to this session at all
  "commitment_mismatch", // §3.4: an attempted substitution
  "already_claimed", // §3.5: somebody holding `L` got there first
  "claim_forged", // spent by an observer of `pairing_id`
  "expired", // rule 4
  "not_found", // 404: gone, deleted, or never created
  "server_state", // 409: a legal-looking step refused. A bug, and not retryable
  // §3.4.1c, all three. ⚠️ THEY ARE HERE FOR THE SCREEN AS MUCH AS FOR THE RECORD.
  // `endsThePairing` is the ONE classifier both consumers read (feedback 16), and a
  // §3.4.1c outcome left out of it would be painted "The pairing was interrupted" over
  // a carry-on offer — an offer to resume a link this device can never finish.
  //
  // ⚠️ `own_link` and `own_channel` are raised BEFORE the try block, so they never
  // reach `concludePairing` and cannot clear a record. Nothing was started: the check
  // that produced them sent no claim and created nothing.
  "own_link", // §3.4.1c rule 3: this identity's own link, on a device that cannot finish it
  "own_channel", // §3.4.1c rule 2: this identity is already a party to this pairing
  "invite_unrecorded", // §3.4.1c rule 5: the memo was refused, so the creation is abandoned
]);

export function endsThePairing(err) {
  if (err instanceof PairFailure) return TERMINAL_REASONS.has(err.reason);
  // Unmapped, i.e. it never reached `fail`. Only the unambiguous ones count.
  if (err?.name === "ApiError") return err.status === 404 || err.status === 409 || err.status === 410;
  return false;
}

/**
 * WHICH FAILURES ARE WORTH A SECOND ATTEMPT — the transport ones, and only those.
 * ⚠️ Since 0.9.20 this judges WRITES too, and it is unchanged by that: a 409 is still
 * never worth repeating. `writeRetrying` does not retry one, it re-READS it. §9.2's
 * refusal is deliberately NOT here — the limiter is per HOUR, so four tries over
 * twelve seconds could only make it worse, and rule 10 keeps the record anyway.
 */
const worthRetrying = (err) =>
  err?.name === "NetworkError" || (err?.name === "ApiError" && err.status >= 500);

/**
 * §3.4.1b rules 10 and 6, in the one place every ending passes through.
 *
 * ⚠️⚠️ `pairingId` IS TAKEN AS AN ARGUMENT AND THAT IS THE WHOLE ORDERING. It derives
 * from `L` (§2.3), and `L` is inside the record about to be deleted — so a caller
 * that cleared first would have thrown away the only input to the request it now
 * owes. PROTOCOL.md §3.4.1b rule 6 says this normatively since 0.9.12.
 */
async function concludePairing(storage, { api, pairingId, failure, role, signal }) {
  // Rule 10: only this attempt failed. Keep the record; the next unlock offers to
  // carry on or to cancel, which is what rule 2 built the sealed store for.
  if (failure && !endsThePairing(failure)) return;

  await clearInFlight(storage);

  // Rule 6, and ONLY for the initiator. A J that got here holds either an offer that
  // failed `mac_I` — so it is not a party to that session — or one somebody else has
  // claimed, which is carrying §3.5's evidence the initiator is still entitled to
  // read. Deleting either destroys another party's state on a guess.
  if (!failure || role !== pairing.ROLE_INITIATOR || !pairingId) return;
  try {
    // ⚠️ NO `signal`. Reaching here by an abort is the commonest way to reach here,
    // and passing the aborted signal would cancel the cleanup the abort is for.
    await api.del(idPathFor(pairingId));
    lastPairingId = null;
  } catch {
    // Rule 6 SHOULDs a retry at the next unlock, which `abandon` performs.
  }
}

/**
 * §3.5, the half of it a client can perform.
 *
 * ⚠️ THE SERVER CANNOT MAKE THIS JUDGEMENT AND DOES NOT TRY. Verifying a claim
 * MAC needs `pairing_mac_key`, which comes from `L`, which the server never sees.
 * It records the refused claim; this function decides what it means. A `tripwire`
 * flag with no verifiable evidence behind it is NOT an alarm — anyone who watched
 * `pairing_id` go past could otherwise raise one at will.
 */
async function readTripwire(status, macKey, commit) {
  if (!status?.tripwire) return { raised: false, verified: false };
  const r = status.rejected_claim;
  if (!r?.pub || !r?.mac) return { raised: true, verified: false };
  try {
    const pub = b64uDecodeExact(r.pub, 32, "rejected claim key");
    const mac = b64uDecodeExact(r.mac, 32, "rejected claim MAC");
    return { raised: true, verified: await pairing.verifyClaim(macKey, pub, commit, mac) };
  } catch {
    return { raised: true, verified: false };
  }
}

/**
 * §3.4.1b rule 11: a hidden document does not poll, and waiting to be shown again
 * does not spend the budget.
 *
 * ⚠️ NO `document` MEANS ALWAYS VISIBLE. The unit tests and `e2e-pair.mjs` run this
 * file under Node, and a poll that blocked forever there would be a test harness
 * measuring nothing — which is the failure mode this project has already paid for
 * once.
 */
/**
 * ⚠️⚠️ D-144 — THIS WAITED ON AN EVENT, AND AN EVENT THAT DOES NOT ARRIVE IS FOREVER.
 *
 * Until round 20 this resolved only from a `visibilitychange` listener. Android Chrome
 * freezes a backgrounded tab and restores it, and a restore does not reliably deliver
 * the transition to a listener registered before the freeze — so the promise never
 * settled. The poll was parked, on a document the person was LOOKING AT, with no error
 * anywhere: `problem none`, and a screen still reading "Waiting for your friend to open
 * it". Only starting again recovered it, because a fresh call on an already-visible
 * document returns `Promise.resolve()` without ever needing the event.
 *
 * ⭐⭐⭐ AND I MADE IT WORSE THREE TIMES WHILE FIXING OTHER THINGS. D-140 put this call
 * inside the retry ladder; D-141 built the budget clock beside it; D-143 wrapped five
 * more reads in it. Every one of those was correct in itself and every one widened the
 * blast radius of a single missed event. **A dependency that cannot fail loudly gets
 * quietly load-bearing.**
 *
 * ⭐⭐ THE FIX IS NOT A BETTER EVENT, IT IS NOT TRUSTING ONE. `visibilityState` is the
 * truth and the event is only a hint that it changed, so this polls the truth as well as
 * listening for the hint. A missed event now costs a second, not a pairing.
 *
 * ⚠️ Hannu's report is what distinguished it from D-140, and one clause did it: *"it does
 * not work even if I come back to the pairing screen and wait there."* Backgrounding was
 * ruled out by the reporter, which is what made the parked-forever reading the only one
 * left. Firefox on Android pairing fine on the same desktop was the second half.
 */
const WAKE_CHECK_MS = 1000;

export function whenVisible(signal) {
  const doc = typeof document === "undefined" ? null : document;
  if (!doc || doc.visibilityState !== "hidden") return Promise.resolve();
  return new Promise((resolve, reject) => {
    let timer = null;
    const cleanup = () => {
      if (timer !== null) clearInterval(timer);
      timer = null;
      doc.removeEventListener("visibilitychange", check);
      globalThis.removeEventListener?.("pageshow", check);
      globalThis.removeEventListener?.("focus", check);
      signal?.removeEventListener("abort", onAbort);
    };
    const check = () => {
      if (doc.visibilityState !== "hidden") {
        cleanup();
        resolve();
      }
    };
    const onAbort = () => {
      cleanup();
      reject(signal.reason ?? new Error("aborted"));
    };
    doc.addEventListener("visibilitychange", check);
    // `pageshow` is the bfcache restore and `focus` covers a window that is raised
    // without a visibility transition. Neither is trusted either — see the timer.
    globalThis.addEventListener?.("pageshow", check);
    globalThis.addEventListener?.("focus", check);
    // ⭐ The one that actually guarantees it. A frozen document runs no timers, so this
    // costs nothing while away and fires on the first tick after the tab is running
    // again — whether or not any event was delivered.
    timer = setInterval(check, WAKE_CHECK_MS);
    signal?.addEventListener("abort", onAbort, { once: true });
    // A transition that happened between the check above and these registrations would
    // otherwise be missed by exactly the mechanism this exists to make safe.
    check();
  });
}

/** The live `document`, or null where there is none — see `whenVisible`. */
const theDocument = () => (typeof document === "undefined" ? null : document);

/** Is this document hidden right now? No `document` means always visible — see `whenVisible`. */
function hiddenNow() {
  return theDocument()?.visibilityState === "hidden";
}

/**
 * A stopwatch that runs only while the document is visible, and stops dead while it
 * is not. §3.4.1b rule 11's active budget is a measure of THIS DEVICE'S ATTENTION,
 * and attention is the one thing a backgrounded tab is definitely not spending.
 *
 * ⚠️⚠️ D-141 — THE BUDGET USED TO BE ADDED UP WITH A STOPWATCH THAT NEVER STOPPED. The
 * old code took a `sliceStart` immediately after `whenVisible()` returned and added the
 * whole slice at the bottom of the loop, so any absence the loop sat through INSIDE
 * that slice was billed to a budget that is supposed to measure attention.
 *
 * ⭐⭐ BUT THE MECHANISM IS NARROWER THAN IT READS, AND I HAD IT WRONG FIRST. Reasoning
 * from this source alone said the absence would be billed almost always — during the
 * 750 ms sleep, or with a request in flight. Measured, every slice across a real
 * twenty-second absence came back 751–752 ms. The loop's park point sits at the TOP,
 * ABOVE the slice, and a hidden tab's throttled timer still fires: so within about a
 * second of going away the loop reaches that park and waits there, outside the
 * accounting. A socket that fails FAST does the same thing, one `continue` sooner.
 *
 * ⭐⭐⭐ WHAT ACTUALLY BILLS AN ABSENCE IS A REQUEST THAT HANGS — one `/status` nobody
 * ever answers keeps `readStatus` awaiting inside the slice for as long as the person
 * is gone. That is not an exotic case: a phone that switches app and drops off Wi-Fi
 * leaves exactly this, a half-open socket nobody answers until TCP gives up. Measured
 * on the old code, one slice read `+21996 ms -> 25007 ms` and the page announced that
 * it had stopped waiting; the same arm on this code reads 4690 ms and it keeps waiting.
 * `~/lpm-probes/probe-visible-budget.mjs`, both ways, with the two negative arms kept.
 *
 * ➡️ A MECHANISM READ OUT OF SOURCE IS A HYPOTHESIS. The bug was real and the first
 * account of WHY was refuted by the first measurement of it.
 *
 * ⭐ It is D-140 again one statement further down: rule 11 taught to the loop's PARKING
 * and not to the accumulator wrapped around it, exactly as it had been taught to the
 * polling and not to the retry ladder. Two mechanisms side by side, each correct read
 * alone, and nothing saying how they meet. Adjacency is not composition.
 *
 * `doc` and `now` are injected the way `flow/lock.js` injects them, so that the rule can
 * be tested without a browser and without waiting ten real minutes. A missing `doc` —
 * Node — means permanently visible, which makes this a plain wall clock there.
 */
export function visibleClock({ doc = theDocument(), now = () => Date.now() } = {}) {
  let total = 0;
  const away = () => doc?.visibilityState === "hidden";
  let since = away() ? null : now();

  /**
   * ⭐⭐⭐ D-165 — THE STATE IS THE TRUTH AND THE EVENT IS ONLY A HINT THAT IT CHANGED.
   * That is D-144's own sentence, written for `whenVisible` eighty lines above this
   * one, and this clock went on trusting the event that sentence is about. Android
   * restores a frozen tab without delivering the transition to a listener registered
   * before the freeze: `since` then stays `null` for the life of the pairing, the
   * budget never advances, and rule 11's ten minutes never expire.
   *
   * ⚠⚠ MEASURED, on a driven document: eleven minutes of real attention billed as
   * SIXTY SECONDS. The poll then runs to the 24-hour deadline instead of stopping and
   * offering to carry on — 86400 / 0.75 = **115,200 requests**, on a phone.
   *
   * ⭐ AND IT COSTS NO TIMER, WHICH IS WHY THE OTHER FIX'S SHAPE DID NOT COPY ACROSS.
   * `whenVisible` needs an interval because it is asleep; this is asked for its answer
   * at the bottom of every poll, so re-reading the truth AT THAT MOMENT is the same
   * fix for nothing. A missed event now costs one poll interval rather than a day.
   *
   * ⚠ Guarded in both directions, because `visibilitychange` can fire twice for one
   * departure and a second `total +=` would bill the same milliseconds again — and
   * that same guard is what makes it safe for `elapsed()` to call this as often as it
   * likes.
   */
  const sync = () => {
    if (away()) {
      if (since !== null) {
        total += now() - since;
        since = null;
      }
    } else if (since === null) {
      since = now();
    }
  };

  doc?.addEventListener("visibilitychange", sync);
  return {
    elapsed: () => {
      sync();
      return total + (since === null ? 0 : now() - since);
    },
    stop: () => doc?.removeEventListener("visibilitychange", sync),
  };
}

/**
 * One `/status` read, with §3.4.1b rule 10's bounded retry around it.
 *
 * ⚠️⚠️ RULE 11 GOVERNS THIS LADDER TOO, AND UNTIL ROUND 19 IT DID NOT. `pollStatus`
 * below parks on `whenVisible()` between ticks, so a hidden tab stops polling — but the
 * request already in flight when the tab went away dies WITH it, and these four retries
 * then ran blind behind a hidden document. 500 + 1500 + 3500 + 7000 is twelve and a half
 * seconds, after which this threw and the pairing was over, with the screen still
 * reading "Waiting for your friend to open it".
 *
 * ⭐ THE FIELD REPORT THAT FOUND IT IS THE SHAPE OF THE BUG. *"It once paired
 * successfully immediately but other times not"* — because whether Android FROZE the tab
 * or merely hid it decided whether these timers were allowed to run. `probe-hidden-claim`
 * arms G and H are the same twenty-five seconds and differ in nothing else: frozen it
 * pairs, running it dies. A person cannot tell those two apart and should not have to.
 *
 * ⚠️ A FAILURE THAT HAPPENED WHILE HIDDEN DOES NOT SPEND AN ATTEMPT. Rule 10's budget
 * is evidence that the SERVER is unreachable; a socket that died because the person
 * switched apps is evidence about the phone. Counting it would mean four app-switches
 * end a pairing that nothing is actually wrong with. `attempt` is therefore advanced by
 * hand rather than by the `for`, which is the whole reason this loop has no update
 * clause — do not tidy it back into one.
 */
async function retrying(signal, attempt_) {
  for (let attempt = 0; ; ) {
    await whenVisible(signal);
    try {
      return await attempt_();
    } catch (err) {
      if (signal?.aborted || !worthRetrying(err)) throw err;
      // Park at the top of the loop instead: a hidden document does not poll, and it
      // does not retry either. The abort signal is still the way out.
      if (hiddenNow()) continue;
      if (attempt >= POLL_RETRY_BACKOFF_MS.length) throw err;
      await sleep(POLL_RETRY_BACKOFF_MS[attempt], signal);
      attempt++;
    }
  }
}

/**
 * A §3 read, with rule 10's bounded retry around it.
 *
 * ⚠️⚠️ D-143 — RULE 10 SAYS *"BEFORE SURFACING IT AT ALL"*, AND UNTIL ROUND 20 IT MEANT
 * "WHILE POLLING". The ladder was built inside `readStatus` and every other request in
 * §3 got nothing: the joiner's fetch of the offer, both resumption reads and the
 * initiator's tripwire re-read each surfaced the first transport blip straight to the
 * screen as *"The pairing was interrupted."* One dropped packet, no second attempt.
 *
 * ⭐ It is D-140 and D-141 a third time, and the widest of the three. Rule 11 was taught
 * to the poll and not to the ladder; rule 11 was taught to the parking and not to the
 * accumulator; **rule 10 was taught to one call site and not to its five neighbours.**
 * The tell is the same every time — a rule implemented where it was NOTICED rather than
 * where it APPLIES — and `retrying` exists so that there is one ladder to point at.
 *
 * ⚠️ FOR READS. The writes have their own wrapper as of 0.9.20 — see `writeRetrying`,
 * which runs inside this same ladder rather than beside it.
 */
const readRetrying = (api, path, signal) => retrying(signal, () => api.get(path, { signal }));

/**
 * ⚠️⚠️ WHY A WRITE IN §3 MAY BE RETRIED, AND WHAT HAS TO BE TRUE FIRST (0.9.20).
 *
 * Rule 10 says a client SHOULD retry a transport failure a bounded number of times
 * before surfacing it. It did not say what a retry MEANS for a request that changes
 * something, and all three writes in §3 are state transitions:
 *
 *   `POST {id}`         creates the session   — a second landing is `already_exists`
 *   `POST {id}/claim`   spends it, by a CAS   — ⚠️⚠️ a second landing reads as a
 *                                               SECOND HOLDER OF `L`, WHICH IS §3.5's
 *                                               INTRUSION ALARM
 *   `POST {id}/reveal`  publishes `i_pub`     — a second landing is `wrong_state`
 *
 * A transport failure cannot tell "never arrived" from "arrived, answer lost", so a
 * BLIND retry of the claim can fire the product's only alarm at somebody whose pairing
 * is perfectly fine. **That alarm has to mean something on the day it matters.**
 *
 * ⭐ WHAT MAKES THE RETRY SAFE IS THAT THE CLIENT CAN ASK. Each of the three writes
 * puts a value on the server that ONLY THIS DEVICE COULD HAVE PRODUCED — `commit` for
 * §3.1, `J_pub` for §3.2, `I_pub` for §3.3 — so "did my write land?" is a question with
 * an answer, and the answer is a plain read. Before every retry, and again on any 409,
 * the value is fetched and held against the one computed here. If it matches, the write
 * landed and no second one is sent; if it does not, or if the read fails, the write is
 * treated as NOT landed and the 409 keeps its full meaning.
 *
 * ⚠️ FALSE IS THE SAFE ANSWER, AS IT IS IN `claimIsOurs`. The check can only ever
 * SUPPRESS a 409 — it can never raise one — so a doubt must resolve to "not ours",
 * which surfaces the conflict. An attacker's claim carries a different `J_pub` and can
 * never match; that is the whole reason this is sound and not merely convenient.
 *
 * ⚠️ THE RETRY RUNS INSIDE `retrying`, NOT BESIDE IT. Rule 11's parking, the rule that
 * a failure while hidden does not spend an attempt, `worthRetrying`'s judgement and the
 * abort signal are all properties of that one ladder, and a second ladder here would
 * have had to grow every one of them again. D-143 was rule 10 taught at one call site
 * and not at its five neighbours; a private copy of the ladder is the same mistake with
 * a different shape.
 */
async function writeRetrying(signal, { send, landed }) {
  let sent = false;
  return await retrying(signal, async () => {
    // Not on the first pass: nothing has been sent, so there is nothing to have landed.
    // ⚠️ An aborted signal costs one doomed `send()` here rather than a guard of its
    // own — `api` rejects an aborted request immediately and `retrying` rethrows it.
    if (sent && (await landed())) return "already";
    sent = true;
    try {
      return await send();
    } catch (err) {
      // ⚠️⚠️ THE ONE 409 THAT IS NOT A CONFLICT. `worthRetrying` says a 409 is never
      // worth repeating and that stays true — this does not retry it, it re-reads it.
      if (err?.name === "ApiError" && err.status === 409 && (await landed())) return "already";
      throw err;
    }
  });
}

/**
 * "Is the server already holding the thing this device wrote?", as `writeRetrying` wants
 * it: a fetch and a comparison, with every failure answering no.
 *
 * ⚠️⚠️ A BARE `api.get`, DELIBERATELY, WHERE EVERY OTHER §3 READ USES `readRetrying`.
 * This one is called from INSIDE rule 10's ladder, and a ladder inside a ladder is not
 * twice as patient — it is five attempts of twelve and a half seconds each, a minute of
 * silence under a screen that says the pairing is still going. The retry belongs to the
 * loop above; a read that fails here simply means "cannot be shown to have landed", and
 * the loop tries again and asks again.
 */
const landedCheck = (api, path, signal, owns) => async () => {
  try {
    return owns(await api.get(path, { signal }));
  } catch {
    return false;
  }
};

/**
 * A 32-byte base64url field the server is serving, against the bytes this device holds.
 *
 * ⚠️ Every throw is a `false`: an absent field, a short one, one that will not decode.
 * See `claimIsOurs`, which is this same judgement with its own read attached.
 */
const ownBytes = (served, mine, label) => {
  if (!served) return false;
  try {
    return bytes.timingSafeEqual(b64uDecodeExact(served, 32, label), mine);
  } catch {
    return false;
  }
};

const readStatus = (api, idPath, signal) => readRetrying(api, `${idPath}/status`, signal);

/**
 * Poll `/status` until `until(status)` is true, the session's own lifetime runs out,
 * or §3.4.1b rule 11's active budget does.
 *
 * ⚠️⚠️ THE TWO DEADLINES ARE DIFFERENT THINGS AND USED TO BE ONE. `deadline` is the
 * session's — absolute wall-clock, the link genuinely gone, `expired`. The budget is
 * this device's attention: it counts only time spent WATCHING, so a tab left in the
 * background for an hour comes back with its ten minutes intact — which was written
 * here before it was true, and made true by D-141. Spending it is not
 * a failure of the pairing and the record survives it (rule 10 — `still_waiting` is
 * not in `TERMINAL_REASONS`, and that is load-bearing, not incidental).
 */
async function pollStatus(api, idPath, { deadline, signal, onStatus, until }) {
  // ⚠️ D-141: a clock that stops while hidden, NOT a slice measured with `Date.now()`.
  // See `visibleClock` for what the arithmetic underneath this used to bill.
  const watching = visibleClock();
  try {
    for (;;) {
      await whenVisible(signal);
      const status = await readStatus(api, idPath, signal);
      if (onStatus) await onStatus(status);
      if (until(status)) return status;
      if (Date.now() >= deadline) {
        throw new PairFailure("expired", "the pairing session expired before the other side arrived");
      }
      await sleep(POLL_INTERVAL_MS, signal);
      if (watching.elapsed() >= POLL_ACTIVE_BUDGET_MS) {
        throw new PairFailure(
          "still_waiting",
          "nobody has opened this invite link yet — it stays good, but this page has stopped watching"
        );
      }
    }
  } finally {
    // One listener per pairing attempt, removed on every exit including the successful
    // one. `deadline` and the budget are different clocks; only this one is a subscription.
    watching.stop();
  }
}

const idPathFor = (pairingId) => `/api/pair/${b64uEncode(pairingId)}`;

/**
 * §9.1: fetch a challenge and solve it. CPU-bound; in the browser this belongs in
 * a Worker.
 *
 * ⚠️ THE SEARCH IS TIMED SEPARATELY FROM THE ROUND TRIP THAT FETCHES THE
 * CHALLENGE, and the `proof` event carries only the former. Round 5 reported a
 * thirty-second wait to make a link, and the one number that existed covered a
 * key generation, this fetch, this search and a `POST` — so it could not say
 * whether the machine was slow or the network was. Two causes, two clocks.
 */
async function solveProofOfWork(api, signal, onEvent) {
  const c = await api.powChallenge({ signal });
  const startedAt = performance.now();
  const solution = await pow.solve(c.challenge, c.bits, { signal });
  onEvent({ type: "proof", ms: Math.round(performance.now() - startedAt), bits: c.bits });
  return solution;
}

// ------------------------------------ the two tails, shared with resumption
//
// ⚠️⚠️ THESE TWO FUNCTIONS ARE EXTRACTED RATHER THAN COPIED, AND §3.4.1b RULE 7 IS
// WHY. "Resumption re-enters the existing flow and adds no message to it" — a
// resumed I continues at §3.3, a resumed J at §3.4. Written twice, the three checks
// this file exists to make (`mac_I`, `mac_J`, the commitment) would have a second
// home to drift out of, and the copy reached only by a resumed pairing is the copy
// nobody looks at. There is one of each, and both entrances land on it.

/**
 * §3.3 from the wait onwards: poll for a claim, verify `mac_J`, derive, reveal.
 *
 * `commit` is recomputed by the caller from `publicKey` and never read off the
 * server — a resumed I therefore needs no round trip to know what it committed to,
 * and cannot be handed a commitment to verify a claim against.
 */
async function initiatorAwaitsClaim({
  api, idPath, macKey, commit, linkSecret, linkMemo, privateKey, publicKey, expiresAt, signal, onEvent,
}) {
  let tripwire = { raised: false, verified: false };
  const claimed = await pollStatus(api, idPath, {
    deadline: expiresAt,
    signal,
    onStatus: async (s) => {
      const t = await readTripwire(s, macKey, commit);
      if (t.verified && !tripwire.verified) onEvent({ type: "tripwire", ...t });
      if (t.raised) tripwire = t;
    },
    until: (s) => s.state !== "open",
  });

  const joinerPublic = b64uDecodeExact(claimed.j_pub, 32, "J_pub");
  const joinerMac = b64uDecodeExact(claimed.j_mac, 32, "mac_J");

  // §3.3. A claim whose MAC does not verify was made by somebody who knows
  // `pairing_id` — which travels in the request path — but not `L`. The session
  // is spent and cannot be recovered: the transition is a single CAS and the
  // forger holds it. This is a denial of service and NOT an interception, and
  // saying so accurately matters: the alarm this product raises has to mean
  // something the day it matters.
  if (!(await pairing.verifyClaim(macKey, joinerPublic, commit, joinerMac))) {
    throw new PairFailure(
      "claim_forged",
      "this link was taken by a claim that cannot prove it came from the link — start a new one"
    );
  }
  onEvent({ type: "claimed" });

  const channelRoot = await pairing.deriveChannelRoot(privateKey, joinerPublic, linkSecret);
  const sas = await pairing.shortAuthString(channelRoot);

  // ⚠️ SENT ONLY IF IT HAS NOT BEEN SENT, WHICH MATTERS ONLY TO A RESUMED I. The
  // record is written before the offer and cleared after the reveal, so a browser
  // discarded in between leaves a record for a session that is already `REVEALED`.
  // §3.4.1b rule 7 says a resumption re-creates and re-claims nothing; the reveal is
  // the same kind of step, and re-`POST`ing it would turn a pairing the other side
  // can still finish into `server_state` on this one.
  //
  // ⚠️ THE TEST IS THAT THE KEY IS *OURS*, NOT MERELY THAT ONE IS THERE. A different
  // `i_pub` is not a reveal this device made, and skipping on it would let a server
  // suppress the real one.
  const alreadyRevealed =
    claimed.i_pub &&
    (() => {
      try {
        return bytes.timingSafeEqual(b64uDecodeExact(claimed.i_pub, 32, "I_pub"), publicKey);
      } catch {
        return false;
      }
    })();
  if (!alreadyRevealed) {
    // The check above reads a status fetched before the reveal was attempted; this one
    // reads a fresh status between attempts, which is the same question asked after the
    // event rather than before it. A `wrong_state` over an `i_pub` that is ours is this
    // device's own reveal landing twice, not §3.3 refused.
    await writeRetrying(signal, {
      send: () => api.post(`${idPath}/reveal`, pairing.buildReveal(publicKey), { signal }),
      landed: landedCheck(api, `${idPath}/status`, signal, (s) => ownBytes(s?.i_pub, publicKey, "I_pub")),
    });
  }
  onEvent({ type: "revealed" });

  // One last look before `macKey` is discarded: a claim can arrive between the
  // poll that returned and the reveal, and after this line nothing on this
  // device can verify one.
  try {
    const t = await readTripwire(await readStatus(api, idPath, signal), macKey, commit);
    if (t.verified && !tripwire.verified) onEvent({ type: "tripwire", ...t });
    if (t.raised) tripwire = t;
  } catch {
    // The session may already be deleted by J. Not a failure of the pairing.
  }

  lastPairingId = null; // completed, so there is nothing left to abandon
  // ⚠️ `linkMemo` TRAVELS OUT WITH THE RESULT because §3.4.1c rule 6 requires it in the
  // roster write that CREATES the channel — with it or before it, never in a write of
  // its own, for the same reason §3.5's tripwire field is taken that way. The caller
  // cannot recompute it: `L` is gone by the time this returns.
  return { role: pairing.ROLE_INITIATOR, channelRoot, sas, tripwire, linkMemo };
}

/**
 * §3.4 from the wait onwards: poll for the reveal, open the commitment, derive,
 * delete the session.
 */
async function joinerAwaitsReveal({
  api, idPath, macKey, commit, linkSecret, linkMemo, privateKey, expiresAt, signal, onEvent,
}) {
  let tripwire = { raised: false, verified: false };
  const revealed = await pollStatus(api, idPath, {
    deadline: expiresAt,
    signal,
    onStatus: async (s) => {
      const t = await readTripwire(s, macKey, commit);
      if (t.verified && !tripwire.verified) onEvent({ type: "tripwire", ...t });
      if (t.raised) tripwire = t;
    },
    until: (s) => s.state === "revealed",
  });

  const initiatorPublic = b64uDecodeExact(revealed.i_pub, 32, "I_pub");

  // §3.4, and this is the check the whole of 0.8.5 exists to make possible.
  // "On mismatch, abort with a hard error and do not derive anything. A
  // mismatch means the server served a key its own stored commitment does not
  // cover — an attempted substitution, not a transient failure, and retrying is
  // exactly the wrong response."
  if (!(await pairing.openCommitment(commit, initiatorPublic))) {
    throw new PairFailure(
      "commitment_mismatch",
      "the key the server sent is not the key this link committed to — do not retry"
    );
  }
  onEvent({ type: "revealed" });

  const channelRoot = await pairing.deriveChannelRoot(privateKey, initiatorPublic, linkSecret);
  const sas = await pairing.shortAuthString(channelRoot);

  // §3.4: J is now the last party to need the session, so J deletes it. Best
  // effort — the ten-minute TTL is the guarantee, this is the courtesy.
  try {
    await api.del(idPath, { signal });
  } catch {
    /* the reaper will take it */
  }

  lastPairingId = null; // completed, so there is nothing left to abandon
  return { role: pairing.ROLE_JOINER, channelRoot, sas, tripwire, linkMemo };
}

// ------------------------------------------------------------- the initiator

/**
 * Role I (§3.1 → §3.3). Creates the link, waits for a claim, reveals, and returns
 * the channel root with its six-digit short authentication string.
 *
 * `onEvent` receives, in order: `proof`, `link` or `code`, `claimed`, `revealed`,
 * and possibly `tripwire`. That event is what the interface needs immediately — the
 * user cannot share what has not been shown to them. `proof` carries §9.1's search
 * time and difficulty, and exists only for the diagnostics panel.
 *
 * `as` picks which of §2's two secrets this pairing is built on, and they are NOT
 * two renderings of one thing (D-116):
 *
 *   "link"  §2.1  16 bytes from getRandomValues     128 bits, in a URL fragment
 *   "code"  §2.2  16 characters of §2.2's alphabet   80 bits, readable aloud
 *
 * ⚠️⚠️ ONE PAIRING HAS ONE SECRET AND THEREFORE ONE OF THESE, WHICH IS WHY THE
 * INTERFACE MAKES THE USER RESTART TO CHANGE ITS MIND (D-117). Deriving both from
 * the same `L` would be one screen and no restart — and would silently drop every
 * invite link in the product from 128 bits to 80, spending the margin §2.2a says is
 * what keeps §3.6's relay unavailable to a hostile server at all.
 *
 * `links` is the identity's memory of its own links (§3.4.1c) — `flow/roster.js`'s
 * `rememberInvite`. ⚠️ **`null` IS GHOST MODE AND NOTHING ELSE.** §7.6 has no roster,
 * so rule 8 exempts it explicitly and a ghost client performs none of §3.4.1c. Every
 * other caller has one, and passing `null` from a caller that has a roster would put
 * a link into the world that the maker's own other devices cannot recognise — which
 * is the entire defect D-174 measured.
 */
export async function initiate({
  api, origin, storage, signal, as = "link", links = null, onEvent = () => {},
}) {
  // ⚠️ A typo here must not quietly hand back a 128-bit link to a caller that asked
  // for something a person can say out loud — the difference is invisible until the
  // friend on the telephone has nothing to read.
  if (as !== "link" && as !== "code") throw new TypeError(`initiate: unknown secret kind ${as}`);
  const spoken = as === "code" ? code.newCode() : null;
  const linkSecret = spoken ? code.secret(spoken) : pairing.newLinkSecret();
  const { pairingId, macKey, linkMemo } = await pairing.derivePairing(linkSecret);
  const { privateKey, publicKey } = await x25519.generateKeyPair();
  const commit = await pairing.commitTo(publicKey);
  const idPath = idPathFor(pairingId);
  // See `abandon` — this is what keeps §3.4.1's DELETE sendable after an abort that
  // clears the record out from under it. Cleared on success, below.
  lastPairingId = pairingId;

  let failure = null; // §3.4.1b rule 10 — the `finally` has to know WHICH ending
  // §3.4.1b rule 6 is about "a link left claimable", and until the offer lands there is
  // no link and nothing to delete. See where it is set.
  let published = false;
  const expiresAt = Date.now() + pairing.PAIRING_TTL_SECONDS * 1000;
  // Stored BEFORE the offer goes out. If the page is discarded between the two,
  // the worst case is an unclaimed session that expires with the link; stored
  // after, the worst case is a live link this device can no longer complete.
  // ⚠️ THE EVENT GOES OUT BEFORE THE OFFER DOES, for the same reason the write does:
  // everything after this line is visible to the other party, and a person deciding
  // whether to keep a tab open needs to know before the link exists, not after.
  if (!(await saveInFlight(storage, { role: pairing.ROLE_INITIATOR, linkSecret, privateKey, expiresAt }))) {
    onEvent({ type: "not_durable", role: pairing.ROLE_INITIATOR });
  }

  try {
    // ⛔⛔ §3.4.1c RULE 5 — THE CREATION'S COMMIT POINT, AND IT IS BEFORE EVERYTHING
    // OBSERVABLE. §6.7.1 rule 1a is the same discipline for the removal (D-173): the
    // record that other devices read goes down FIRST, and a refusal abandons the act
    // rather than proceeding without it.
    //
    // ⚠️⚠️ A LINK THAT EXISTS AND IS NOT RECORDED IS THE WHOLE OF D-174. The maker's
    // own second device then finds no reason to think the link is its owner's, claims
    // it, pairs the person with themselves, spends the link — and the friend it was
    // actually sent to trips a genuine MAC-verified §3.5 alarm naming its own owner.
    // Nothing has to fail for that; it is what the correct code did.
    //
    // ⚠️ IT RUNS BEFORE §9.1's SEARCH, NOT AFTER IT. The refusal then reaches the
    // person before the seconds of proof-of-work rather than after them, and nothing
    // between here and the `POST` is visible to anybody. The creation already needs the
    // network for both of those, so no case that worked offline stops working.
    if (links) {
      try {
        await links.rememberInvite(linkMemo);
      } catch (err) {
        throw new PairFailure(
          "invite_unrecorded",
          `the invite link could not be recorded, so it was not created: ${err?.reason ?? err?.name ?? err}`
        );
      }
    }

    const solution = await solveProofOfWork(api, signal, onEvent);
    const offer = await pairing.buildOffer(macKey, commit, solution);
    // §3.1, with rule 10's ladder and 0.9.20's ownership check. The commitment the
    // server serves back is `SHA-256(i_pub)` for a key generated moments ago in this
    // function, so a session already standing under `commit` is this device's own
    // first attempt. A DIFFERENT commitment under the same `pairing_id` is a second
    // holder of `L` who got there first, and stays `already_exists`.
    // ⚠️⚠️ SET BEFORE THE ATTEMPT AND NOT AFTER IT, AND THE DIRECTION IS THE WHOLE
    // POINT. `writeRetrying` can land the `POST` and then fail its read-back, so "it
    // returned" is not the same question as "did a session get created". A spurious
    // `DELETE` for a session that does not exist is a 404 nobody sees; a skipped one
    // leaves a claimable link alive for its whole day, which is the hazard rule 6
    // exists for. Uncertainty therefore has to fall on the side of sending it.
    published = true;
    await writeRetrying(signal, {
      send: () => api.post(idPath, offer, { signal }),
      landed: landedCheck(api, idPath, signal, (o) => ownBytes(o?.commit, commit, "served commit")),
    });

    // ⚠️ A code pairing emits NO link, and must not. `buildLink` would happily make
    // a perfectly valid URL out of these sixteen bytes — and it would be an 80-bit
    // link, indistinguishable on screen from §2.1's 128-bit one, offered to a person
    // who chose this route precisely because no link can reach their friend.
    onEvent(
      spoken
        ? { type: "code", code: spoken, expiresAt }
        : { type: "link", link: pairing.buildLink(origin, linkSecret), expiresAt }
    );

    return await initiatorAwaitsClaim({
      api, idPath, macKey, commit, linkSecret, linkMemo, privateKey, publicKey, expiresAt, signal, onEvent,
    });
  } catch (err) {
    failure = fail(err);
    throw failure;
  } finally {
    // §3.3 ("I then discards `i_priv`, `L` and the pairing session") on success, and
    // §3.4.1b rules 10 and 6 on failure. `pairingId` is passed in because the record
    // holding `L` is about to go.
    //
    // ⚠️ AND THE MEMO GOES WITH IT. `lastPairingId` is `abandon`'s fallback for the race
    // where the record is already gone, and a fallback pointing at a session that was
    // never created is a `DELETE` waiting to be sent for one. A resumption re-sets it.
    if (!published) lastPairingId = null;
    // ⚠️ `null` WHEN NOTHING WAS PUBLISHED, which §3.4.1c rule 5 made reachable: a
    // refused invite memo abandons the creation BEFORE §9.1's search, so there is no
    // session to abandon — and a `DELETE` sent anyway would hand the server a
    // `pairing_id` derived from an `L` that never left this device.
    await concludePairing(storage, {
      api, pairingId: published ? pairingId : null, failure, role: pairing.ROLE_INITIATOR, signal,
    });
  }
}

// ---------------------------------------------------------------- the joiner

/**
 * Role J (§3.2 → §3.4). Opens the link, claims blind to `I_pub`, waits for the
 * reveal, checks it against the commitment, and returns the same root and digits.
 *
 * `link` is either §2.1's URL or §2.2's spoken code, and this function decides
 * which. ⚠️ THE TEST IS THE SHAPE OF THE STRING, NOT WHETHER IT PARSES. Routing on
 * validity would send a code with one character misheard down the link path and
 * report it as a base64 complaint — to the one user in this product who is holding a
 * telephone rather than a screen, and who needs to be told that a character is
 * missing. A `#` or a `://` means a link; anything else is a code and is judged as
 * one.
 *
 * ⚠️ The caller is responsible for `history.replaceState` — §2.1 requires the
 * fragment to be stripped from the address bar the moment it is read, and this
 * module does not touch the document.
 *
 * `links` is §3.4.1c's memory, as in `initiate`, and here it is what stops this
 * device joining its own identity's link. `null` is Ghost mode (rule 8).
 */
export async function join({ api, link, storage, signal, links = null, onEvent = () => {} }) {
  let linkSecret;
  const spoken = typeof link === "string" && !link.includes("#") && !link.includes("://");
  // ⚠️ TWO CONSTRUCTIONS RATHER THAN ONE WITH A TERNARY IN IT, AND `test/copy.mjs`
  // IS WHY. It reads the reasons this module can raise out of the source, so that a
  // reason added without a sentence fails loudly instead of printing its own name at
  // a user (feedback 13). A `new PairFailure(cond ? "a" : "b", …)` hides one of them
  // from that scan — and the check caught exactly that, on the first run.
  try {
    linkSecret = spoken ? code.secret(link) : pairing.parseLink(link);
  } catch (err) {
    if (spoken) throw new PairFailure("code_malformed", err.message);
    throw new PairFailure("link_malformed", err.message);
  }
  const { pairingId, macKey, linkMemo } = await pairing.derivePairing(linkSecret);
  const idPath = idPathFor(pairingId);
  // ⚠️⚠️ NO MEMO HERE, AND ITS ABSENCE IS THE RULE (§3.4.1b rule 6, 0.9.26 — D-167). The
  // memo exists so `abandon` can still send the `DELETE` after an abort has cleared the
  // record; a joiner may not send that `DELETE` on any occasion, so a joiner has nothing
  // to remember. Setting it here is how the joiner's `DELETE` used to get out.
  let failure = null; // §3.4.1b rule 10 — the `finally` has to know WHICH ending

  // ⚠️⚠️ THIS DEVICE MAY HAVE BEEN HERE BEFORE, AND UNTIL §3.4.1b NOTHING ASKED.
  // A record for THIS link — same `L`, joiner's role, not expired — means this
  // browser already claimed and was interrupted. Every `already_claimed` below is
  // then a report of THIS DEVICE'S OWN claim, which is not §3.5's alarm.
  const held = await loadInFlight(storage, { api }); // D-165: rule 6 follows rule 4 everywhere
  const heldHere =
    held && held.role === pairing.ROLE_JOINER && bytes.timingSafeEqual(held.linkSecret, linkSecret)
      ? held
      : null;
  // ⚠️⚠️ AND THE LINK MAY BE THIS DEVICE'S OWN — the case above asked only whether
  // this browser had JOINED here before. See below; both halves of it were live.
  const heldAsInitiator =
    held && held.role === pairing.ROLE_INITIATOR && bytes.timingSafeEqual(held.linkSecret, linkSecret)
      ? held
      : null;

  // ⛔⛔⛔⛔ §3.4.1c RULE 1 — AND EVERYTHING ABOVE IT ASKS A QUESTION ABOUT THIS
  // BROWSER WHILE THE QUESTION IS ABOUT THIS PERSON (D-174).
  //
  // §3.4.1b's record is addressed per browser (D-170) and is destroyed on success by
  // rule 8, so a second device of the same identity — holding the same KEY, the same
  // conversations, the same everything — holds no record for a link made on the first
  // one and never will. Both branches above then find nothing, and:
  //
  //   · ⛔ THE ABSENCE OF A RECORD OF YOUR OWN ACT IS NOT EVIDENCE OF SOMEBODY
  //     ELSE'S. That is D-169's fallacy, and §3.5's own sentence — *"the alarm is
  //     evaluated only once the device has established that it is a J"* — was asking
  //     for something no client could produce.
  //   · measured 2026-08-28: the second device claimed its owner's own offer, both of
  //     that person's screens reached §3.6's digits, the link was spent, and the
  //     friend it had been sent to tripped a genuine MAC-verified §3.5 tripwire
  //     NAMING ITS OWN OWNER.
  //
  // `link_memo` is `HKDF(L, …)` kept inside the sealed roster, which is where the
  // IDENTITY can see it rather than where one browser can.
  //
  // ⚠️ IT IS OUTSIDE THE `try`, AND DELIBERATELY. Nothing has been started — no claim
  // sent, no session created — so there is nothing for `concludePairing` to conclude,
  // and running it here would clear an in-flight record belonging to a DIFFERENT
  // pairing this device may have open.
  //
  // ⚠️ AND IT RUNS AFTER `heldAsInitiator`, WHICH RULE 3 REQUIRES: a device that does
  // hold the record is a resumed I and §3.4.1b rule 7 governs, not this.
  if (!heldAsInitiator) {
    // ⚠️ `null` MEANS "LEARNED NOTHING" (rule 4) — a failed roster read, a ghost
    // client, or the ordinary first-time joiner, and all three must stay
    // indistinguishable. Falling through to §3.4.1b rule 7 and §3.5 is what that means.
    const known = links ? await links.recogniseLink(linkMemo) : null;
    if (known?.kind === "channel") {
      // Rule 2. MUST NOT claim, MUST NOT raise §3.5's alarm, SHOULD open what is
      // already there — so the root travels with the error for the caller to open.
      const already = new PairFailure(
        "own_channel",
        "this invite link already made a conversation this identity has"
      );
      already.root = known.root;
      throw already;
    }
    if (known?.kind === "invite") {
      // Rule 3. This identity created the link and this device is not the one that
      // did: `i_priv` is ephemeral and lives only where it was generated, so this
      // device CANNOT finish the pairing and must say so rather than report a failure.
      throw new PairFailure(
        "own_link",
        "this invite link was created by this identity, on a device that is not this one"
      );
    }
  }

  try {
    // ⚠️⚠️⚠️ THE PERSON WHO MADE THIS LINK IS NOT JOINING IT (Hannu, 2026-08-19).
    // §3.4.1b rule 7: an I holding a record for this `L` is a RESUMED I and
    // "continues at §3.3". "Neither re-creates nor re-claims" — so becoming a J for
    // one's own pairing is not a thing this client may do, and both ways it went
    // wrong were reproduced before this branch existed:
    //
    //   · a claim already there → `describeExistingClaim` told the person who MADE
    //     the link that it had been intercepted. `claimIsOurs` could not save this
    //     one: the claim genuinely is somebody else's — it is the FRIEND'S, which is
    //     the entire point of having sent them a link.
    //   · no claim yet → the code fell through and CLAIMED ITS OWN OFFER, then
    //     overwrote the I record with a J one, destroying the only private key that
    //     matches the published commitment. The pairing was then unrecoverable by
    //     either side, silently, with no error shown.
    //
    // ⚠️ IT RUNS BEFORE THE `GET`, AND THAT IS THE POINT. A resumed I recomputes its
    // commitment from its own stored key; reading `commit` off the offer would be
    // verifying the friend's claim against a value the SERVER chose, which is the
    // substitution §3.6.1 exists to stop.
    if (heldAsInitiator) {
      const { privateKey, publicKey } = await x25519.keyPairFromPrivate(heldAsInitiator.privateKey);
      return await initiatorAwaitsClaim({
        api, idPath, macKey,
        commit: await pairing.commitTo(publicKey),
        linkSecret, linkMemo,
        privateKey, publicKey,
        expiresAt: heldAsInitiator.expiresAt,
        signal, onEvent,
      });
    }

    const offer = await readRetrying(api, idPath, signal);
    const commit = b64uDecodeExact(offer.commit, 32, "commit_I");
    const offerMac = b64uDecodeExact(offer.mac, 32, "mac_I");

    // §3.2: "J MUST verify `mac_I` before proceeding. If verification fails,
    // abort and show a hard error — this means either a corrupted link or a
    // server attempting a man-in-the-middle."
    //
    // ⚠️ IT RUNS ON THE RESUMED PATH TOO, and that is deliberate: a resumed J holds
    // `L` and a private key, but never held `commit_I`, so it re-fetches the offer
    // and re-earns §3.2's check rather than trusting a second serving of it.
    if (!(await pairing.verifyOffer(macKey, commit, offerMac))) {
      throw new PairFailure(
        "offer_unverified",
        "this link does not match what the server is offering — do not continue"
      );
    }
    if (offer.state !== "open") {
      // §3.4.1b rule 7: a resumed J MUST NOT re-claim, and its own earlier claim
      // coming back at it is not an interception. Continue at §3.4 instead.
      if (heldHere && (await claimIsOurs(api, idPath, heldHere.privateKey, signal))) {
        return await joinerAwaitsReveal({
          api, idPath, macKey, commit, linkSecret, linkMemo,
          privateKey: heldHere.privateKey,
          expiresAt: heldHere.expiresAt,
          signal, onEvent,
        });
      }
      throw await describeExistingClaim(api, idPath, macKey, commit, signal);
    }

    // ⚠️ THE STORED KEY IS REUSED WHEN THERE IS ONE, AND ONLY THE STORED ONE WILL DO.
    // `state` is still open, so the claim this device wrote a record for never landed
    // — but the record is what a later resumption will read, so a fresh key here
    // would leave the device holding a private key that matches no claim it makes.
    // Knowing nothing but the hash is still true of both: the record was written
    // under that same rule.
    const { privateKey, publicKey } = heldHere
      ? await x25519.keyPairFromPrivate(heldHere.privateKey)
      : await x25519.generateKeyPair();
    const expiresAt = Math.min(
      Date.now() + pairing.PAIRING_TTL_SECONDS * 1000,
      typeof offer.expires === "number" ? offer.expires * 1000 : Infinity
    );
    // ⚠️ Since 0.8.5 J holds its private key until the reveal (§3.4.1), so it
    // needs the same survivable storage the initiator has always needed.
    if (!(await saveInFlight(storage, { role: pairing.ROLE_JOINER, linkSecret, privateKey, expiresAt }))) {
      onEvent({ type: "not_durable", role: pairing.ROLE_JOINER });
    }

    // ⚠️⚠️ `publicKey`, NOT `heldHere.privateKey` — THE KEY THIS CALL JUST SAVED, NOT THE
    // ONE IT ENTERED WITH. The 409 handler used to ask `heldHere`, which is the record
    // read at the top of this function, and a FIRST-TIME joiner has none: the check was
    // skipped entirely and §3.5's alarm fired. That cost nothing while the `POST` was
    // sent once and could not land twice. It is exactly what a retry breaks, and fixing
    // it is the precondition for wrapping this write at all, not a tidy-up beside it.
    // The two agree wherever both exist — `privateKey` IS `heldHere.privateKey` when
    // there was a record (see the key reuse above) — so this is strictly wider.
    const claimBody = await pairing.buildClaim(macKey, publicKey, commit);
    try {
      await writeRetrying(signal, {
        send: () => api.post(`${idPath}/claim`, claimBody, { signal }),
        landed: landedCheck(api, `${idPath}/status`, signal, (s) => ownBytes(s?.j_pub, publicKey, "J_pub")),
      });
    } catch (err) {
      if (err?.name === "ApiError" && err.status === 409) {
        // Not ours, then. Somebody claimed between the `GET` above and this `POST`,
        // and §3.5 is what that means.
        throw await describeExistingClaim(api, idPath, macKey, commit, signal);
      }
      throw err;
    }
    onEvent({ type: "claimed" });

    return await joinerAwaitsReveal({
      api, idPath, macKey, commit, linkSecret, linkMemo, privateKey, expiresAt, signal, onEvent,
    });
  } catch (err) {
    failure = fail(err);
    throw failure;
  } finally {
    // Rule 10 keeps the record on a transient failure here too — a J that loses the
    // network mid-wait is holding `j_priv` for a claim the server has already
    // accepted, and throwing it away is what makes the pairing unfinishable.
    // ⚠️ Rule 6's DELETE is NOT sent for a joiner: see `concludePairing`.
    await concludePairing(storage, {
      api, pairingId, failure, role: pairing.ROLE_JOINER, signal,
    });
  }
}

/**
 * Is the claim the server is holding the one THIS DEVICE made?
 *
 * ⚠️⚠️ THIS IS THE DISCRIMINATOR `describeExistingClaim` CANNOT HAVE, AND ITS ABSENCE
 * WAS A CONFIRMED DEFECT (2026-08-18). That function verifies `mac_J` on the accepted
 * claim and concludes "a second holder of `L`" — but a device re-opening its own link
 * finds its own claim there, carrying a perfectly valid `mac_J` made with the same
 * `pairing_mac_key`. The MAC cannot tell the two apart, because both were made by
 * somebody holding `L`, and both times that somebody was the user. §3.5's alarm then
 * fires at a person who did nothing, which is how an alarm stops being believed.
 *
 * What DOES tell them apart is the private key still on this device: only the claim
 * this device made carries the matching `J_pub`. Nothing secret is compared and
 * nothing is sent — the public half is recomputed locally and held against what the
 * server is serving.
 *
 * ⚠️ FALSE IS THE SAFE ANSWER AND EVERY FAILURE RETURNS IT. A network error, a
 * missing `j_pub`, a key that will not decode: all of them mean "this cannot be shown
 * to be ours", and the caller then goes on to §3.5's judgement. Suppressing the alarm
 * on a doubt would be the one way to make this change dangerous.
 */
async function claimIsOurs(api, idPath, privateKey, signal) {
  let status;
  try {
    status = await readRetrying(api, `${idPath}/status`, signal);
  } catch {
    return false;
  }
  if (!status?.j_pub) return false;
  try {
    const { publicKey } = await x25519.keyPairFromPrivate(privateKey);
    return ownBytes(status.j_pub, publicKey, "J_pub");
  } catch {
    return false;
  }
}

/**
 * Someone else holds the session. Which someone, exactly, is the question §3.5
 * asks and cannot answer server-side — but J holds `pairing_mac_key` and can.
 *
 * A valid MAC on the accepted claim means a second holder of `L`: interception,
 * and §3.5's alarm. An invalid one means somebody who saw `pairing_id` in transit
 * and forged a claim: the link is dead but nothing was intercepted. Telling the
 * user the second when it was the first — or the first when it was the second —
 * is how an alarm stops being believed.
 */
async function describeExistingClaim(api, idPath, macKey, commit, signal) {
  let status;
  try {
    status = await readRetrying(api, `${idPath}/status`, signal);
  } catch {
    return new PairFailure("already_claimed", "this link has already been used");
  }
  if (!status?.j_pub || !status?.j_mac) {
    return new PairFailure("already_claimed", "this link has already been used");
  }
  try {
    const pub = b64uDecodeExact(status.j_pub, 32, "J_pub");
    const mac = b64uDecodeExact(status.j_mac, 32, "mac_J");
    if (await pairing.verifyClaim(macKey, pub, commit, mac)) {
      return new PairFailure(
        "already_claimed",
        "somebody else opened this link before you — they hold the link secret"
      );
    }
  } catch {
    /* fall through to the forged case */
  }
  return new PairFailure(
    "claim_forged",
    "this link was taken by something that cannot prove it came from the link — ask for a new one"
  );
}

// ------------------------------------------------------- §3.4.1b resumption

/**
 * §3.4.1b rule 7: pick up a pairing this browser had in progress.
 *
 * Returns `null` when there is nothing to resume — no record, or one rule 4 has
 * just discarded for being expired. Otherwise it returns exactly what `initiate`
 * and `join` return, because it *is* them: the record says which role this device
 * played, and the flow re-enters at §3.3 or §3.4 having sent no message twice.
 *
 * ⚠️⚠️ RULE 7 IS A PROHIBITION AND THIS FUNCTION IS WHERE IT IS KEPT. A resumed I
 * MUST NOT `POST` the offer again and a resumed J MUST NOT re-claim: the session is
 * `CLAIMED` or `REVEALED`, the server refuses, and a client that reads that refusal
 * as *start over* has spent a link that was still good. Neither branch below creates
 * anything — I recomputes what it already committed to, J re-fetches and re-verifies
 * the offer it was always going to be shown.
 *
 * ⚠️ THE INITIATOR NEEDS NO ROUND TRIP TO KNOW ITS OWN COMMITMENT. `commit` is
 * `H(I_pub)` and `I_pub` comes from the stored private key, so it is recomputed here
 * rather than read back from the server. A resumed I that fetched its commitment
 * would be verifying the claim against a value the server chose, which is the whole
 * substitution §3.6.1 exists to stop.
 *
 * ⚠️ WHAT IS NOT HERE: anything past the reveal. §3.4.1b rule 8 bounds the window to
 * §3.1→§3.3 for I and §3.2→§3.4 for J. A tab that dies while the user is reading
 * §3.6's digits is a different question and this function does not answer it.
 */
export async function resume({ api, storage, signal, onEvent = () => {} } = {}) {
  const rec = await loadInFlight(storage, { api }); // D-165: rule 6 follows rule 4 everywhere
  if (!rec) return null;
  if (rec.role !== pairing.ROLE_INITIATOR && rec.role !== pairing.ROLE_JOINER) {
    await clearInFlight(storage);
    return null;
  }

  const { pairingId, macKey, linkMemo } = await pairing.derivePairing(rec.linkSecret);
  const idPath = idPathFor(pairingId);
  // ⚠️ THE MEMO IS THE INITIATOR'S (§3.4.1b rule 6, 0.9.26 — D-167). A resumed J may
  // not send the abandonment `DELETE` on any occasion, so remembering an id it must
  // never use would only give `abandon` a way to send one after the record is gone.
  if (rec.role === pairing.ROLE_INITIATOR) lastPairingId = pairingId;

  // ⚠️ THE `open` BRANCH BELOW IS ONE PATH THAT MUST NOT CLEAR THE RECORD. Since
  // 0.9.12 it is no longer the only one: §3.4.1b rule 10 keeps it past any failure
  // that ended the ATTEMPT rather than the pairing, and `concludePairing` decides.
  //
  // ⚠️⚠️ THE SENTENCE THAT USED TO BE HERE WAS THE DEFECT. It read: *"a record kept
  // past a failure is a live link secret at rest with nothing left to do."* True of a
  // terminal failure; false of a transient one; applied to both — so six seconds
  // offline destroyed a pairing that was good for another twenty-three hours. The
  // reasoning was sound and it lived in a comment, which is the only place it lived.
  let keepRecord = false;
  let failure = null;
  try {
    if (rec.role === pairing.ROLE_INITIATOR) {
      const { privateKey, publicKey } = await x25519.keyPairFromPrivate(rec.privateKey);
      return await initiatorAwaitsClaim({
        api, idPath, macKey,
        commit: await pairing.commitTo(publicKey),
        linkSecret: rec.linkSecret,
        linkMemo,
        privateKey, publicKey,
        expiresAt: rec.expiresAt,
        signal, onEvent,
      });
    }

    const offer = await readRetrying(api, idPath, signal);
    const commit = b64uDecodeExact(offer.commit, 32, "commit_I");
    const offerMac = b64uDecodeExact(offer.mac, 32, "mac_I");
    // §3.2 again, and it is not a formality: this device never held `commit_I`, so
    // the only thing standing between it and a substituted commitment is `mac_I`.
    if (!(await pairing.verifyOffer(macKey, commit, offerMac))) {
      throw new PairFailure(
        "offer_unverified",
        "this link does not match what the server is offering — do not continue"
      );
    }
    // ⚠️ A SESSION STILL `open` MEANS THE CLAIM NEVER LANDED, AND THAT CASE STOPS
    // HERE ON PURPOSE. The record is written before the `POST` (see `join`), so a
    // browser discarded in between leaves exactly this. Rule 7 says a resumed J
    // "continues at §3.4 — poll `/status` for the reveal", and claiming from here
    // would not be that; it would be a construction the section does not describe,
    // which README §0 says to ask about rather than invent. `join` DOES cover it —
    // the same person opening the same link again reuses this record's key — so what
    // is lost is only the unlock-time offer, and nothing is spent or alarmed.
    //
    // ⚠️ NO ABANDONMENT `DELETE` HERE, AND RULE 6 IS WHY IT WOULD BE WRONG. That
    // rule names an expired record (4) and a replaced one (5). This is neither, and
    // the session being deleted belongs to the OTHER person, who is still waiting on
    // a link that is still good.
    if (offer.state === "open") {
      keepRecord = true;
      return null;
    }
    onEvent({ type: "claimed" });
    return await joinerAwaitsReveal({
      api, idPath, macKey, commit,
      linkSecret: rec.linkSecret,
      linkMemo,
      privateKey: rec.privateKey,
      expiresAt: rec.expiresAt,
      signal, onEvent,
    });
  } catch (err) {
    failure = fail(err);
    throw failure;
  } finally {
    if (!keepRecord) {
      await concludePairing(storage, { api, pairingId, failure, role: rec.role, signal });
    }
  }
}

/**
 * §3.4.1: "On abandonment, send `DELETE /api/pair/{pairing_id}`." A user who
 * starts pairing and gives up otherwise leaves a claimable link alive for the full
 * the link's whole lifetime — a day since D-136. §3.4.1b rule 6 makes this a MUST
 * rather than advice, and D-136 is what makes it matter.
 *
 * ⚠️⚠️ THE FALLBACK BELOW EXISTS BECAUSE 0.9.10 CREATED A RACE THAT 0.9.9 COULD NOT
 * HAVE. Until the record moved to an async store, this function read it on its
 * first SYNCHRONOUS line — so a caller that aborted the pairing and called
 * `abandon()` in the same tick was guaranteed to see it, and `app/app.js` says so
 * in bold above `$("to-code")`. `await loadInFlight()` suspends, and `initiate`'s
 * own `finally` clears the record on the very next microtask. The read can now
 * lose that race, and losing it means the DELETE is never sent: a claimable link
 * alive for its full lifetime with nobody able to complete it.
 *
 * ⚠️ The memo holds `pairing_id` and NOTHING ELSE. `L` is not kept here — that is
 * the secret this file exists to bound. `pairing_id` travels in the request path of
 * every message in §3, so remembering one for the length of a pairing tells an
 * attacker nothing they could not read off the wire.
 */
let lastPairingId = null;

/**
 * §3.4.1b rule 6 — the abandonment `DELETE`, on leaving a pairing screen, and rule 6's
 * "retry at the next unlock".
 *
 * ⛔⛔ IT SENT IT FOR A JOINER TOO, AND PROTOCOL 0.9.26 FORBIDS THAT (D-167). The rule
 * had restricted only its *rule 10* occasion to role I; ruling the section tighter
 * exposed this function, twenty lines from `discardExpired`, which had it right. **The
 * hazard rule 6 exists for is a link left claimable, and only an initiator can leave
 * one** — a joiner's record describes a session it has already claimed (the link is
 * spent) or the initiator's own live link, offered to a friend who may yet arrive, and
 * deleting either destroys another party's state on a guess. A claimed session is
 * carrying §3.5's evidence, which the initiator is still entitled to read.
 *
 * ⚠️ THE MEMO IS THE INITIATOR'S TOO, and it had to be: `lastPairingId` alone cannot
 * say which role wrote it, so a J that reached here with its record already cleared
 * would have sent the `DELETE` from the memo instead. `join()` therefore no longer
 * memoises at all — it has nothing it may abandon.
 */
export async function abandon({ api, storage, signal } = {}) {
  // ⚠️ `api` IS PASSED IN, AND WITHOUT IT THIS FUNCTION DEFEATED ITSELF (D-165). This
  // is rule 6's "retry at the next unlock" — and its first act was a read that silently
  // destroyed the expired record it needed, leaving `lastPairingId` (null after a
  // reload) as the only fallback. The retry could not fire for the one case it exists
  // for. `discardExpired` now sends it, and leaves the memo behind if it failed.
  const rec = await loadInFlight(storage, { api });
  await clearInFlight(storage);
  // The record is the truth when it is there; the memo covers only the race. ⚠️ A
  // record that is present and is J's answers the question — it does NOT fall through
  // to the memo, which would be a `DELETE` sent on a guess about a different session.
  let pairingId = lastPairingId;
  if (rec) {
    pairingId =
      rec.role === pairing.ROLE_INITIATOR ? (await pairing.derivePairing(rec.linkSecret)).pairingId : null;
  }
  lastPairingId = null;
  if (!pairingId) return false;
  try {
    await api.del(idPathFor(pairingId), { signal });
    return true;
  } catch {
    return false;
  }
}
