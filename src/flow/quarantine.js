// PROTOCOL.md §7.3.1a's 7-day quarantine — the entries a merge removed, held long
// enough for a person to say "that was not me".
//
// ⚠️⚠️ WHAT THE UNDO CAN ACTUALLY DO, AND IT IS NOT WHAT §7.3.1a IMPLIES. This is
// the eighth hole this implementation has found in the specification, and it has a
// shape none of the first seven had: every rule involved is evaluable, correct and
// enforced, and two of them are jointly impossible.
//
//   §7.3.1a  offers "a local, non-synced quarantine for 7 days with an undo".
//   §7.3.1   rule 1 drops every channel whose root hashes to a merged tombstone.
//   §7.3.1a  "Tombstones MUST NOT expire", and dropping them is not permitted.
//
// So an undo that writes the channel back to the roster is undone by the very next
// merge, on this device and on every other, permanently — and the one thing it
// would achieve first is D-016's failure with an extra step: the conversation
// reappears, the user believes it was restored, and it disappears again. There is
// no ordering, no timestamp and no flag in §7.3's format that can express "this
// deletion was retracted", and there cannot be one while Rule 1 is a set
// membership test and the set only grows.
//
// ➡️ THE UNDO IS THEREFORE LOCAL TO THIS DEVICE, PERMANENTLY, and the product must
// say so in those words. What it restores is real and not a stub: the channel root
// is what §4.2 derives the mailboxes from, so a restored conversation still sends
// and still receives, and the counterparty never knew anything happened. What it
// cannot do is come back on the user's other devices, or survive this browser
// being cleared — because the roster is the only thing that syncs and the only
// thing that is backed up, and this entry is not in it and can never be again.
//
// ⚠️ And the residual §7.3.1a states is this file's doing: for those 7 days — and
// for as long as a restored entry is kept — the channel roots still exist on this
// device, so a device stolen while locked and opened later within the window
// yields them. That is why the panic action (`purged_at`) skips the quarantine
// entirely: the wipe must beat an attacker who gets into a lost device later.

import { rootHash } from "../protocol/roster.js";
import { b64uDecode } from "../crypto/b64u.js";
import * as epochs from "../protocol/epoch.js";

/** §7.3.1a. Seven days, from the moment the entries were removed. */
export const QUARANTINE_DAYS = 7;
export const QUARANTINE_S = QUARANTINE_DAYS * 24 * 60 * 60;

/** Held pending a decision, and dropped when the seven days run out. */
export const HELD = "held";

/**
 * Restored by the user, and kept until they delete it. ⚠️ A `kept` entry is a
 * conversation that exists on this device and NOWHERE ELSE — see the header.
 */
export const KEPT = "kept";

const KEY = "lpm.quarantine";

/**
 * The quarantine, over `storage/vault.js`'s interface.
 *
 * One record rather than one per entry: the list is short, it is always read
 * whole, and the alternative invites a partial write in which a channel is in
 * neither the roster nor the quarantine. ⚠️ It is conversation state (§7.8) — it
 * holds channel roots — so it belongs in the store an ending clears, and never in
 * the durable one.
 */
export function openQuarantine({ storage, unixSeconds = () => epochs.nowSeconds() }) {
  async function read() {
    const held = await storage.get(KEY);
    return Array.isArray(held) ? held : [];
  }

  async function write(entries) {
    if (entries.length === 0) await storage.delete(KEY);
    else await storage.set(KEY, entries);
  }

  return {
    /**
     * Take in the channels a merge removed. Returns what was actually held —
     * an entry already present is not re-dated, or a device that refetched twice
     * would extend its own window.
     */
    async hold(entries) {
      const now = unixSeconds();
      const list = await read();
      const known = new Set(list.map((e) => e.root));
      const added = entries
        .filter((e) => !known.has(e.root))
        .map((e) => ({ ...e, state: HELD, removedAt: now, expiresAt: now + QUARANTINE_S }));
      if (added.length > 0) await write([...list, ...added]);
      return added;
    },

    /** Everything still held or kept, expired entries excluded. */
    async list() {
      const now = unixSeconds();
      return (await read()).filter((e) => e.state === KEPT || e.expiresAt > now);
    },

    /** Just the ones awaiting a decision — what the notice counts. */
    async pending() {
      return (await this.list()).filter((e) => e.state === HELD);
    },

    /**
     * The undo. ⚠️ IT DOES NOT TOUCH THE ROSTER, and cannot — see the header. The
     * entry moves to `kept` and this device talks to that channel again; no other
     * device ever learns that anything was restored.
     */
    async restore(root) {
      const list = await read();
      const entry = list.find((e) => e.root === root);
      if (!entry) return null;
      entry.state = KEPT;
      delete entry.expiresAt;
      await write(list);
      return entry;
    },

    /** The user agreeing with the deletion, or ending a restored conversation. */
    async forget(root) {
      await write((await read()).filter((e) => e.root !== root));
    },

    /**
     * Drop what the seven days took, and RETURN THE ENTRIES rather than a count.
     *
     * ⚠️ That is not a convenience. §7.3.1a's residual is that the channel roots
     * still exist on this device for those seven days, and the only thing that
     * makes the window a window rather than a permanent leak is somebody deleting
     * the session record and the message history when it closes. A caller handed a
     * number cannot do that, and would have no way to know it was supposed to.
     */
    async sweep() {
      const now = unixSeconds();
      const list = await read();
      const survivors = list.filter((e) => e.state === KEPT || e.expiresAt > now);
      if (survivors.length !== list.length) await write(survivors);
      return list.filter((e) => !survivors.includes(e));
    },

    /**
     * §7.3.1a's panic path: `purged_at` rose, so everything goes immediately and
     * irreversibly, with no quarantine and no undo. This is the case the action
     * exists for — a device that is gone — and the wipe must beat an attacker who
     * reaches it later.
     */
    async purge() {
      await storage.delete(KEY);
    },
  };
}

/**
 * The channels a device should treat as its own: the roster's, plus anything the
 * user restored from quarantine.
 *
 * ⚠️ `local: true` IS NOT DECORATION. A restored channel is not in the roster and
 * can never be put back into it, so it does not sync, does not survive a cleared
 * browser, and does not appear on another device. An interface that renders it
 * identically to the others tells the user something false about where their
 * conversation lives — and the whole reason this entry exists is that they were
 * already told something false once, by a bug.
 */
export async function withRestored(rosterChannels, quarantined) {
  const kept = quarantined.filter((e) => e.state === KEPT);
  const out = rosterChannels.map((c) => ({ ...c, local: false }));
  for (const e of kept) {
    if (out.some((c) => c.root === e.root)) continue;
    out.push({ ...e, local: true, rootBytes: b64uDecode(e.root, "channel root") });
  }
  return out;
}

/** The 128-bit commitment §7.3 uses, for an entry that carries only its root. */
export async function entryHash(entry) {
  return rootHash(b64uDecode(entry.root, "channel root"));
}
