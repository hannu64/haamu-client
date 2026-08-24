// PROTOCOL.md §4.1 — epochs.

import { expectLength, readLe64 } from "../crypto/bytes.js";
import { hkdf } from "../crypto/hkdf.js";

/** §4.1. Seven days, and it is also the retention period — deliberately one number. */
export const EPOCH_SECONDS = 604800;

const INFO_EPOCH_OFFSET = "lpm-epoch-offset-v1";

/**
 * §4.1: `offset = LE64_decode(HKDF(R, "lpm-epoch-offset-v1", 8)) mod EPOCH_SECONDS`.
 *
 * The offset is per channel and is not optional. Both parties derive the same one
 * from `R`, so they always agree, and the server sees each channel roll over at a
 * different moment in the week. A global boundary would be a thundering herd, an
 * exhaustion of the per-IP creation limit for anyone with several channels, and a
 * synchronisation event that hands the server a strong hint that every mailbox
 * created just after it is a rollover of an existing channel.
 *
 * BigInt: the eight bytes are a full 64-bit value and 2^64 does not fit a JS
 * number. Taking the modulus first and converting afterwards keeps every bit.
 */
export async function epochOffset(channelRoot) {
  expectLength(channelRoot, 32, "R");
  const bytes = await hkdf(channelRoot, INFO_EPOCH_OFFSET, 8);
  return Number(readLe64(bytes) % BigInt(EPOCH_SECONDS));
}

/** §4.1: `e = floor((unix_seconds - offset) / EPOCH_SECONDS)`. */
export function epochNumber(offset, unixSeconds) {
  if (!Number.isFinite(unixSeconds)) throw new TypeError("epochNumber: unixSeconds must be a number");
  return Math.floor((unixSeconds - offset) / EPOCH_SECONDS);
}

/** The current epoch for a channel. */
export async function currentEpoch(channelRoot, unixSeconds = nowSeconds()) {
  return epochNumber(await epochOffset(channelRoot), unixSeconds);
}

/**
 * The unix second at which this channel's current epoch becomes the next one.
 *
 * ⚠️ IT IS PER CHANNEL, and that is what makes it usable. §4.1's offset means every
 * channel rolls over at a different moment in the week, so a client can schedule
 * around its own boundaries without any of them coinciding — and a live client
 * needs to, because §5.3's stream is bound to ONE mailbox while §4.1 says a message
 * may land in any of three. See `flow/live.js` on what is done with it.
 */
export function nextBoundary(offset, unixSeconds) {
  return offset + (epochNumber(offset, unixSeconds) + 1) * EPOCH_SECONDS;
}

/**
 * The three epochs a client polls — `e-1`, `e`, `e+1` (§4.1). This absorbs
 * epoch-boundary races and costs three reads per drain per channel.
 *
 * ⚠️⚠️ Polling one of these MUST NOT create it. §5.1 makes an authenticated read
 * of an absent mailbox return empty and create nothing, precisely so that a client
 * does not have to register `e+1` in order to poll it — registering it would start
 * the server's `created_at + 2 × EPOCH_SECONDS` clock two epochs before the
 * mailbox is used, and a message sent late in `e+1` would expire seconds after it
 * arrived, against a promise of "at least 7 days".
 *
 * A mailbox is created only by a SEND into it, within its own epoch (§5.1.1).
 */
export function pollEpochs(e) {
  return [e - 1, e, e + 1];
}

/**
 * Wall-clock seconds.
 *
 * ⚠️ The device clock is load-bearing and its failure is total: §5.2 rejects any
 * signed request more than 60 seconds out, so a wrong clock means nothing sends,
 * nothing arrives, and nothing says why. The client must read the `Date` header of
 * a 401 and say plainly that the clock is wrong — see transport, not here.
 */
export function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}
