// PROTOCOL.md §4.2 — mailbox derivation. A channel has TWO mailboxes per epoch,
// one per direction.

import { asciiBytes, concat, decimal, expectLength } from "../crypto/bytes.js";
import { sha256, trunc128 } from "../crypto/hash.js";
import { hkdf } from "../crypto/hkdf.js";
import * as ed25519 from "../crypto/ed25519.js";
import { ROLE_INITIATOR, ROLE_JOINER } from "./pairing.js";

/** The two directions. I writes to `i2j`; J writes to `j2i`. */
export const DIR_I2J = "i2j";
export const DIR_J2I = "j2i";

const INFO_MBAUTH = { [DIR_I2J]: "lpm-mbauth-i2j-v1:", [DIR_J2I]: "lpm-mbauth-j2i-v1:" };
const INFO_MAILBOX_ID = "lpm-mailbox-id-v1";

/** The mailbox this role writes to (the peer's inbound). */
export function outboundDirection(role) {
  if (role === ROLE_INITIATOR) return DIR_I2J;
  if (role === ROLE_JOINER) return DIR_J2I;
  throw new RangeError(`role: expected "I" or "J", got ${JSON.stringify(role)}`);
}

/**
 * The mailbox this role reads from (its own inbound).
 *
 * §4.2: "Each party drains only its own inbound mailbox." I reads `j2i` and never
 * `i2j`. With a single shared mailbox — which v0.1 specified — a sender drains its
 * own ciphertext and then either acknowledges it, destroying the message before
 * the recipient sees it, or fails to decrypt it and re-fetches it on every drain
 * until the epoch expires.
 */
export function inboundDirection(role) {
  return outboundDirection(role) === DIR_I2J ? DIR_J2I : DIR_I2J;
}

/**
 * §4.2:
 *   auth_seed_<dir> = HKDF(R, "lpm-mbauth-<dir>-v1:" || decimal(e), 32)
 *   (sk, pk)        = Ed25519_keypair_from_seed(auth_seed_<dir>)
 *   mailbox_id      = Trunc128(SHA256("lpm-mailbox-id-v1" || pk))
 *
 * ⚠️ `e` is ASCII DECIMAL, never LE64. §4.2 spells out the fuse on the earlier
 * form: a string-built `info` and a bytes-built one agree only until the epoch's
 * low byte first reaches 0x80, at which point one side UTF-8-expands it. A single
 * implementation would stay self-consistent and never notice; independent
 * implementations would diverge and channels would break with no diagnosable
 * cause. `decimal()` and `asciiBytes()` together make that unrepresentable here.
 *
 * ⚠️ `mailbox_id` is a COMMITMENT to `pk`, not an independent value (§5.1). That
 * is what makes squatting impossible: an attacker who learns an as-yet-unregistered
 * identifier cannot register a key of their own, because the identifier only
 * accepts the key it commits to.
 *
 * Both parties derive an identical keypair for a given direction. The sender needs
 * it to write, the recipient to read, and the sender again to ask whether its own
 * message is still queued (§5.5). The keypair authorises SERVER ACCESS ONLY —
 * message authenticity between the parties comes from the ratchet (§6), which uses
 * distinct per-party state (§4.3).
 */
export async function deriveMailbox(channelRoot, epoch, direction) {
  expectLength(channelRoot, 32, "R");
  const info = INFO_MBAUTH[direction];
  if (!info) throw new RangeError(`direction: expected "i2j" or "j2i", got ${JSON.stringify(direction)}`);

  const seed = await hkdf(channelRoot, info + decimal(epoch, "epoch"), 32);
  const { privateKey, publicKey } = await ed25519.keyPairFromSeed(seed);
  return {
    direction,
    epoch,
    privateKey,
    publicKey,
    mailboxId: await mailboxIdFor(publicKey),
  };
}

/** §4.2 / §5.1: `mailbox_id = Trunc128(SHA256("lpm-mailbox-id-v1" || pk))`. */
export async function mailboxIdFor(publicKey) {
  expectLength(publicKey, 32, "pk");
  return trunc128(await sha256(concat(asciiBytes(INFO_MAILBOX_ID), publicKey)));
}

/**
 * Check that an identifier really commits to a key — the client half of §5.1's
 * step 1, which the server performs before it touches the database.
 */
export async function verifyMailboxCommitment(mailboxId, publicKey) {
  const expected = await mailboxIdFor(publicKey);
  if (mailboxId.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= mailboxId[i] ^ expected[i];
  return diff === 0;
}

/**
 * Both of a channel's mailboxes for one epoch, keyed by what this role does with
 * them. `inbound` is what this device drains; `outbound` is where it writes.
 */
export async function deriveChannelMailboxes(channelRoot, epoch, role) {
  const [inbound, outbound] = await Promise.all([
    deriveMailbox(channelRoot, epoch, inboundDirection(role)),
    deriveMailbox(channelRoot, epoch, outboundDirection(role)),
  ]);
  return { inbound, outbound };
}
