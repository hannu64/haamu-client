// PROTOCOL.md §6.3 — which Olm session a message belongs to, and which one this
// device sends on.
//
// Pure decisions over a plain state object: no storage, no WASM, no clock beyond
// the epoch number it is handed. `flow/message.js` supplies the state, performs
// the cryptography, and writes the result back.
//
// ⚠️ THE INPUT IS UNAUTHENTICATED (§6.4). `session_id` and `generation` are outer
// envelope fields and the server can alter either. Nothing here may treat them as
// more than a hint about which key to try — every path ends in a decryption that
// either works or does not, and that is the authority.

import { b64uDecodeExact, b64uEncode } from "../crypto/b64u.js";
import { SESSION_ID_BYTES, TYPE_PREKEY } from "./envelope.js";

/** What to do with an incoming envelope. */
export const DECRYPT = "decrypt"; // a session exists — use it, whatever the type
export const ACCEPT = "accept"; // no session and a valid pre-key: create one
export const WAIT = "wait"; // no session and not a pre-key: TRANSIENT (§5.4.2)
export const REFUSE = "refuse"; // it can never be read; `reason` says why

export const key = (sessionId) => b64uEncode(sessionId);

/** A channel with no session yet. */
export function emptyState() {
  return { generation: 0, sending: null, sessions: {}, acceptedPrekeys: [] };
}

/**
 * §6.3 rule 3's ordering: "compared as 16 raw bytes interpreted as an unsigned
 * big-endian integer".
 *
 * ⚠️ NOT the b64u strings, and §6.3 spends a paragraph on why: base64url's
 * alphabet is not ASCII-monotonic, so for `x = 00…00 d0` and `y = 00…00 04` the
 * two readings genuinely disagree — `x > y` as bytes while `b64u(x) < b64u(y)` —
 * and two clients would each conclude the other's session had won.
 */
export function compareSessionIds(a, b) {
  if (a.length !== b.length) throw new RangeError("session ids must be the same length");
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/**
 * Where an incoming envelope goes.
 *
 * ⚠️⚠️ THE FIRST BRANCH IS THE ONE §6.3 DID NOT SAY OUT LOUD, AND GETTING IT
 * WRONG DESTROYS THE CONVERSATIONS THIS PRODUCT EXISTS FOR. An initiator whose
 * peer has not replied yet emits a PRE-KEY message for every message it sends —
 * measured 2026-08-11: messages one, two and three of an unanswered conversation
 * are all `type: "prekey"`, all carrying the same `session_id`. §6.3's replay rule
 * reads "record the `session_id` of every prekey it has accepted at that
 * generation and reject a repeat", and a client that applied that to the MESSAGE
 * would drop everything after the first — for a tip-off that is never answered,
 * §6.2 says that is 100% of the traffic.
 *
 * The rule is right about the danger and the discriminator is the session table,
 * not a message counter: a `session_id` is the KEY TO A SESSION, not a token that
 * gets spent. A pre-key message for a session that exists is an ordinary message
 * on it. `accept` is for the case where there is nothing to decrypt with, and it
 * is there that the danger is real — accepting the same pre-key twice succeeds and
 * rebuilds the session at ratchet zero (measured), which is why the accepted set
 * below still exists for sessions that have since been dropped.
 */
export function classify(envelope, state) {
  const k = key(envelope.sessionId);

  if (state.sessions[k]) return { action: DECRYPT, session: k };

  if (envelope.generation < state.generation) {
    // §6.3 rule 1. It cannot become readable later: the peer will re-establish at
    // the higher generation rather than resend on this one.
    return { action: REFUSE, reason: "stale_generation" };
  }
  if (envelope.type !== TYPE_PREKEY) {
    // ⚠️⚠️ §5.4.2: "no session exists for this session_id" is TRANSIENT and MUST
    // NOT count toward the three-failure limit. Without that, a dishonest server
    // withholds the pre-key message, releases the ones after it, and the recipient
    // destroys them itself — while the sender is shown "Delivered".
    return { action: WAIT, reason: "no_session" };
  }
  if (envelope.generation === state.generation && state.acceptedPrekeys.includes(k)) {
    // The session was accepted at this generation and has since been dropped
    // (§6.3 rule 5's epoch expiry). Re-accepting would roll a live conversation
    // back to ratchet zero, so the set outlives the session it records.
    return { action: REFUSE, reason: "replayed_prekey" };
  }
  return { action: ACCEPT };
}

/**
 * §6.3 rules 2, 3 and 4, applied after a pre-key message has actually opened.
 *
 * Adoption decides what this device SENDS on. It never decides what it can read:
 * a session that loses the tie-break is kept and keeps decrypting until the epoch
 * ends (rule 5), which is what stops a resolved split from eating the messages
 * that were already in flight when it was resolved.
 */
export function adopt(state, { sessionId, generation, epoch }) {
  const k = key(sessionId);
  const next = {
    ...state,
    sessions: { ...state.sessions },
    acceptedPrekeys: [...state.acceptedPrekeys],
  };

  if (generation > state.generation) {
    // Rule 2: adopted unconditionally, whatever its session_id.
    next.generation = generation;
    next.acceptedPrekeys = [k];
    return supersede(next, k, epoch);
  }

  // Same generation. Rule 3's tie-break, and only here: it was written for two
  // prekey sessions of the same generation, one created by each party.
  if (!next.acceptedPrekeys.includes(k)) next.acceptedPrekeys.push(k);

  const mineKey = state.sending;
  const mine = mineKey ? state.sessions[mineKey] : null;
  const isTie = mine && mine.createdByUs && mine.generation === generation && mine.supersededAtEpoch === null;

  // Rule 4: a session this device cannot use is never a candidate — `mine` is
  // read out of the session table, so a device whose own state is gone has none.
  if (isTie && compareSessionIds(idFromKey(mineKey), sessionId) < 0) {
    return next; // ours is smaller: keep sending on it, but keep theirs to read
  }
  return supersede(next, k, epoch);
}

/** Switch the sending session, marking the outgoing one for rule 5's grace. */
function supersede(state, newKey, epoch) {
  const old = state.sending;
  if (old && old !== newKey && state.sessions[old]) {
    state.sessions[old] = { ...state.sessions[old], supersededAtEpoch: epoch };
  }
  state.sending = newKey;
  return state;
}

/**
 * §6.3 rule 5: "Accept messages on either session until the end of the current
 * epoch", not for a fixed number of hours.
 *
 * ⚠️ The two windows must NEST, not overlap — §6.3 records that a 24-hour
 * acceptance window inside a 7–14 day retention window let a client resolve a
 * split, wait a day, then drain a mailbox still holding messages sent on the
 * losing session and drop them silently. Ordinary mobile clock drift was enough.
 */
export function prune(state, epoch) {
  const sessions = {};
  const dropped = [];
  for (const [k, s] of Object.entries(state.sessions)) {
    if (s.supersededAtEpoch !== null && epoch > s.supersededAtEpoch) {
      dropped.push(k);
      continue;
    }
    sessions[k] = s;
  }
  return { state: dropped.length === 0 ? state : { ...state, sessions }, dropped };
}

/**
 * The generation a device uses when it has to create a session: §6.3's "(highest
 * it has ever accepted) + 1".
 *
 * ⚠️ THE ROSTER WRITE THAT CARRIES IT IS NOT OPTIONAL AND MUST NOT TRAIL THE
 * MESSAGE (§6.3, §7.3.3 case 3). An earlier draft left the stored generation
 * frozen at its pairing value; on a second device migration the recovering device
 * re-used a generation the peer had already accepted, rule 1 admitted it, and the
 * tie-break had a coin-flip chance of pointing the peer at a dead session —
 * messages undecryptable, destroyed after three drains, the sender shown
 * "Delivered", and the channel dead in both directions with no cause displayed.
 */
export function nextGeneration(state) {
  return state.generation + 1;
}

/** Register a session this device created (role I) as the one it sends on. */
export function created(state, { sessionId, generation, epoch }) {
  const k = key(sessionId);
  const next = {
    ...state,
    generation: Math.max(state.generation, generation),
    sessions: { ...state.sessions },
    acceptedPrekeys: generation > state.generation ? [] : [...state.acceptedPrekeys],
  };
  next.sessions[k] = { generation, createdByUs: true, supersededAtEpoch: null };
  return supersede(next, k, epoch);
}

/** Register a session accepted from the peer (role J), before `adopt` runs. */
export function accepted(state, { sessionId, generation }) {
  const k = key(sessionId);
  return {
    ...state,
    sessions: {
      ...state.sessions,
      [k]: { generation, createdByUs: false, supersededAtEpoch: null },
    },
  };
}

/**
 * ⚠️ The tie-break compares BYTES, and the state table is keyed by b64u text, so
 * the local candidate has to be turned back into bytes to be compared. Decoding
 * here rather than storing a second copy keeps one representation authoritative.
 */
export function idFromKey(k) {
  return b64uDecodeExact(k, SESSION_ID_BYTES, "stored session id");
}
