// Staying live on a channel — PROTOCOL.md §5.3, ARCHITECTURE.md §4.4.
//
// `net/stream.js` owns one connection. `flow/message.js` owns one drain. This file
// owns the thing neither can see: that a stream is a HINT and the drain is the
// DELIVERY, and that the two have to be arranged so no message can fall between
// them.
//
//   connect → drain → wake → drain → … → the connection dies → drain → reconnect
//
// ⚠️⚠️ ONE STREAM PER CHANNEL, NOT THREE, AND THIS IS A DECISION RATHER THAN AN
// OMISSION (PROTOCOL 0.8.9, D-054). §5.3's stream is opened on A MAILBOX; §4.1
// makes every client watch THREE — `e-1`, `e` and `e+1` — and nothing in either
// section says how many connections a channel therefore costs. The answer is not a
// detail: it is a 3× multiplier on the exact number open item 6 exists to measure,
// and two implementers reading those two sections would answer differently.
//
// It is one, on `e`, because the extra two would buy almost nothing. §5.2 keeps
// every device within 60 seconds of the server, so two devices are within 120
// seconds of each other, and the only moment a peer writes to an epoch this device
// is not streaming is that 120-second window around a boundary — once per channel
// per WEEK. Three permanent connections to cover four minutes a week is the wrong
// trade. What covers it instead is below: the poll interval shortens near the
// boundary, and every drain reads all three epochs anyway.
//
// ⚠️ THE FLOOR POLL IS NOT BELT AND BRACES THAT COULD BE REMOVED LATER. A wake may
// be coalesced, dropped under back-pressure, or never sent because the connection
// was refused at a ceiling; the mailbox is the record and the drain is the only
// thing that reads it. A design where the only path to a message is a notification
// is a design where a lost notification is a lost message.

import { b64uEncode } from "../crypto/b64u.js";
import * as epochs from "../protocol/epoch.js";
import * as stream from "../net/stream.js";
import * as mailboxFlow from "./mailbox.js";
import * as messageFlow from "./message.js";

/** What the caller may show a person. */
export const CONNECTING = "connecting";
export const LIVE = "live";
export const POLLING = "polling"; // no stream; messages still arrive, just later

/** The floor poll while the stream is healthy. Three signed reads every 5 minutes. */
export const FLOOR_POLL_MS = 300_000;

/**
 * The poll interval near an epoch boundary — the one window in which a peer writes
 * to a mailbox this device is not streaming. See the header for why the answer is a
 * faster poll rather than more connections.
 */
export const BOUNDARY_POLL_MS = 30_000;

/**
 * How far from a boundary that window reaches. §5.2 bounds each device to 60
 * seconds from the server, so two devices differ by at most 120; 150 is that with
 * margin for the drift accumulated between two poll ticks.
 */
export const BOUNDARY_WINDOW_S = 150;

/**
 * The poll interval with no stream at all.
 *
 * ⚠️ IT IS THE RELEASE VALVE FOR THE VERY CEILING THAT REFUSED THE STREAM, so it
 * cannot be as fast as the product would like. Three signed reads every 20 seconds
 * is 540 an hour against §9.2's per-mailbox budget — comfortable for one client and
 * the reason open item 6 wants a measurement rather than an estimate, because it is
 * what every refused client does at once.
 */
export const DEGRADED_POLL_MS = 20_000;

/**
 * How long to wait before trying to stream again after the server refused to let us
 * — a full ceiling or an exhausted mint budget. Far longer than the transport
 * backoff: nothing about the situation improves by asking again quickly, and the
 * asking is itself the load.
 */
export const REFUSED_RETRY_MS = 120_000;

/** Pure: the poll interval, given the state and the distance to a boundary. */
export function pollIntervalMs(state, secondsFromBoundary) {
  if (state !== LIVE) return DEGRADED_POLL_MS;
  if (Math.abs(secondsFromBoundary) <= BOUNDARY_WINDOW_S) return BOUNDARY_POLL_MS;
  return FLOOR_POLL_MS;
}

/** Pure: seconds to the NEAREST boundary in either direction. */
export function secondsFromBoundary(offset, unixSeconds) {
  const next = epochs.nextBoundary(offset, unixSeconds);
  return Math.min(next - unixSeconds, unixSeconds - (next - epochs.EPOCH_SECONDS));
}

/**
 * Keep a channel live. Returns `{ stop, drainNow, state }`.
 *
 * `onMessages(messages)` is called with what `flow/message.js` staged, and its
 * return is awaited before the acknowledgement goes out — it is the caller's
 * statement that the messages are stored, which is what §5.4.1's separation of
 * retrieval from deletion is for.
 *
 * ⚠️ `onRefused(list)` IS THE OPPOSITE AND MUST NOT BE CONFUSED WITH IT. Those messages
 * were NOT staged, are NOT stored and will NOT be acknowledged by this drain — they are
 * still in the mailbox, still counting towards §5.4.2's three. It is a report so the
 * person is not left waiting in silence, and nothing may be deleted on the strength of
 * it. Its return is not awaited, because nothing downstream depends on it.
 */
export function startLive(
  channel,
  { onMessages, onRefused, onState, eventSource, random = Math.random, unixSeconds } = {}
) {
  const clock = () => unixSeconds?.() ?? epochs.nowSeconds();
  const stopping = new AbortController();
  let state = CONNECTING;
  let refusedUntil = 0;
  let registeredEpoch = null;

  const report = (next, detail) => {
    if (next) state = next;
    onState?.({ state, ...detail });
  };

  // ------------------------------------------------------------- the drain

  const drainNow = serialiser(drainOnce, () => stopping.signal.aborted);

  async function drainOnce() {
    try {
      const batch = await messageFlow.receive(channel, { signal: stopping.signal });
      // §5.4.2, said on the FIRST drain instead of the third — see `flow/message.js`.
      if (batch.refused?.length) onRefused?.(batch.refused);
      if (batch.messages.length === 0) return;
      await onMessages?.(batch.messages);
      // Only now: §5.4.1's acknowledgement is what deletes, and `flow/message.js`
      // will not clear its staging list until it has happened.
      await batch.settle();
    } catch (err) {
      if (stopping.signal.aborted) return;
      report(null, { failure: err });
    }
  }

  // ------------------------------------------------------------ the stream

  async function session() {
    const now = clock();
    const epoch = await epochs.currentEpoch(channel.channelRoot, now);
    const mailbox = await mailboxFlow.inboundNow(channel.channelRoot, channel.role, now);

    // ⚠️⚠️ GOING LIVE REGISTERS THIS DEVICE'S OWN INBOX FOR THE CURRENT EPOCH, AND
    // NOTHING ELSE (PROTOCOL 0.8.9, D-053). Without it §5.3 cannot start: a stream
    // is opened on a mailbox, and §5.1.1 made a mailbox come into existence only
    // when the PEER writes into it — so a reader could not watch its own inbox
    // until a message had already been delivered there, which is precisely the
    // event the stream exists to announce. Measured before the fix: the first
    // message of a channel took five seconds and arrived by poll.
    //
    // ⚠️ THE CURRENT EPOCH ONLY. §5.1.1 forbids registering a FUTURE epoch's
    // mailbox because `created_at + 2 × EPOCH_SECONDS` would then land before the
    // end of that epoch and make §5.4's seven-day floor false. That reason does not
    // reach `e`: §5.1.1 states the safe condition itself — "created_at falls inside
    // epoch e ... and created_at + 2 × EPOCH_SECONDS then lands at or after the end
    // of e+1, which is exactly what §5.4 requires". `e-1` and `e+1` are still
    // polled and never registered.
    //
    // It costs nothing in total: §5.1.1 says either party may register either
    // mailbox and that the operation is idempotent, and the peer's first `send`
    // would have created this same row. Two registrations per channel per epoch,
    // as before — only the order changed.
    if (registeredEpoch !== epoch) {
      await mailboxFlow.register(channel.api, mailbox, { signal: stopping.signal });
      registeredEpoch = epoch;
    }

    const { token } = await mailboxFlow.streamToken(channel.api, mailbox, { signal: stopping.signal });

    // ⚠️ THE CONNECTION IS BOUND TO AN EPOCH'S MAILBOX, so it ends at the boundary
    // rather than outliving the mailbox it is watching. Reconnecting there is also
    // what re-points the stream at the new `e` — and every reconnect drains all
    // three epochs, which is what carries anything the old stream could not see.
    const offset = await epochs.epochOffset(channel.channelRoot);
    const untilBoundary = Math.max(1, epochs.nextBoundary(offset, now) - now + 1);
    const session = new AbortController();
    const onStop = () => session.abort();
    stopping.signal.addEventListener("abort", onStop, { once: true });
    const rollover = setTimeout(() => session.abort(), untilBoundary * 1000);

    try {
      return await stream.runOnce({
        mailboxId: b64uEncode(mailbox.mailboxId),
        token,
        eventSource,
        signal: session.signal,
        onReady: () => report(LIVE),
        onWake: () => {
          void drainNow();
        },
      });
    } finally {
      clearTimeout(rollover);
      stopping.signal.removeEventListener("abort", onStop);
    }
  }

  async function streamLoop() {
    const backoff = new stream.Backoff({ random });
    while (!stopping.signal.aborted) {
      // ARCHITECTURE.md §4.4: "On reconnect, drain the mailbox by polling BEFORE
      // resuming the stream — messages may have arrived while disconnected."
      await drainNow();
      if (stopping.signal.aborted) return;

      if (clock() < refusedUntil) {
        await sleep(REFUSED_RETRY_MS, stopping.signal);
        continue;
      }

      let result;
      try {
        report(CONNECTING);
        result = await session();
      } catch (err) {
        if (stopping.signal.aborted) return;
        // ⚠️ NONE OF THIS IS FATAL. A refused mint, a full ceiling, a browser with
        // no EventSource: the channel keeps working on the poll below, which is the
        // whole reason the stream is allowed to be a hint.
        const refused =
          err?.reason === "rate_limited" || err?.reason === "unavailable" || err?.reason === "stream_unsupported";
        report(POLLING, { failure: err });
        refusedUntil = clock() + (refused ? REFUSED_RETRY_MS / 1000 : 0);
        await sleep(refused ? REFUSED_RETRY_MS : backoff.next(), stopping.signal);
        continue;
      }

      if (stopping.signal.aborted || result.reason === stream.ENDED_ABORTED) {
        // An abort is either `stop()` or the epoch boundary. Neither is a failure,
        // and neither should be counted against the backoff.
        if (stopping.signal.aborted) return;
        continue;
      }

      report(POLLING, { ended: result.reason });
      // ⚠️ TIME SPENT HEALTHY, NOT "IT CONNECTED" — see net/stream.js.
      backoff.settle(result.livedMs);
      await sleep(backoff.next(), stopping.signal);
    }
  }

  async function pollLoop() {
    while (!stopping.signal.aborted) {
      const offset = await epochs.epochOffset(channel.channelRoot);
      const wait = pollIntervalMs(state, secondsFromBoundary(offset, clock()));
      await sleep(wait, stopping.signal);
      if (stopping.signal.aborted) return;
      await drainNow();
    }
  }

  void streamLoop();
  void pollLoop();

  return {
    stop() {
      stopping.abort();
    },
    drainNow,
    get state() {
      return state;
    },
  };
}

/**
 * Run `fn` one at a time, coalescing anything asked for while it is running into a
 * single further run.
 *
 * ⚠️⚠️ THE DRAIN IS SERIALISED, AND NOT FOR TIDINESS. Step 6 gives the drain TWO
 * triggers — the stream and the poll — where step 5 had one, and
 * `flow/message.js`'s receive is load → decrypt → save over a single stored record.
 * Two of them at once fetch the same ciphertext twice: the second decrypt runs
 * against a ratchet the first has already advanced, fails, and is counted as a
 * §5.4.2 decryption failure. A message would be reported to its reader as
 * unreadable purely because this device asked for it twice — and the losing save
 * would take the other's staging list with it.
 *
 * Coalescing rather than queueing, because a drain reads everything that is there:
 * three wakes during one drain are one more drain, not three.
 */
export function serialiser(fn, stopped = () => false) {
  let running = false;
  let again = false;
  return async function run() {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        await fn();
      } while (again && !stopped());
    } finally {
      running = false;
    }
  };
}

/** An abortable pause. Rejecting on abort would turn `stop()` into an error path. */
function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}
