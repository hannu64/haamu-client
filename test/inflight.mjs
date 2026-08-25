// §3.4.1b — the in-flight pairing record, and whether the person is told when it
// could not be written.
//
// ⚠️⚠️ WHY THIS IS A FLOW TEST AND NOT A SOURCE RULE. The defect was an empty `catch`
// in two places, and any grep for an empty catch finds a dozen legitimate ones. What
// is actually required is a PROPERTY — that a device which could not save its half of
// the pairing says so before the other party is committed to it — and the only honest
// way to check a property is to take the capability away and watch.
//
// ⭐ The real `initiate` runs here, against a fake api. Nothing in `src/` is stubbed:
// the proof-of-work call is the first thing to touch the network, and §3.4.1b's write
// happens BEFORE it, so an api that refuses at the first step is enough to observe the
// whole of the behaviour under test.

import * as flow from "../src/flow/pair.js";
import * as pairing from "../src/protocol/pairing.js";
import { b64uDecode, b64uEncode } from "../src/crypto/b64u.js";
import { check, equal, section, done } from "./harness.mjs";

/** An api that gets no further than §9.1's challenge. The write under test precedes it. */
const deadApi = { async powChallenge() { throw new Error("no network in this test"); } };

const mapStore = () => {
  const m = new Map();
  return {
    async get(k) { return m.get(k) ?? null; },
    async set(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
    size: () => m.size,
  };
};

/** A browser that refuses to write: full quota, private mode, or a blocked origin. */
const refusingStore = () => ({
  async get() { return null; },
  async set() { throw new Error("QuotaExceededError"); },
  async delete() {},
});

async function eventsFrom(storage) {
  const events = [];
  try {
    await flow.initiate({
      api: deadApi,
      origin: "https://haamu.app",
      storage,
      onEvent: (e) => events.push(e),
    });
  } catch {
    // Expected: `deadApi` ends the pairing at the proof-of-work step, which is after
    // everything this file is about.
  }
  return events;
}

// ════════════════════════════ §3.4.1b — the interface must agree with the record

section("§3.4.1b — a pairing record that could not be written is reported");

{
  const events = await eventsFrom(refusingStore());
  check(
    "⭐⭐⭐ a store that refuses the write produces `not_durable`",
    events.some((e) => e.type === "not_durable")
  );
  equal(
    "⚠️ and it names the role, so the interface can say the right thing",
    events.find((e) => e.type === "not_durable")?.role ?? "",
    "I"
  );
}

{
  /**
   * ⚠️⚠️ THE OTHER DIRECTION, AND IT IS THE HALF THAT ROTS. A client that emitted
   * `not_durable` unconditionally would pass the check above forever and put a
   * permanent "keep this tab open" warning on a browser that saves perfectly well —
   * which trains the warning away exactly as §3.5's alarm would be trained away by
   * appearing on every ordinary conversation.
   */
  const store = mapStore();
  const events = await eventsFrom(store);
  check(
    "⭐⭐ a store that accepts the write produces no warning",
    !events.some((e) => e.type === "not_durable")
  );
  equal("⚠️ and the record really is there afterwards", store.size(), 1);

  const rec = await flow.loadInFlight(store);
  check("⭐ and it is the resumable record §3.4.1b rule 7 needs, not an empty slot", Boolean(rec?.privateKey));
}

{
  /**
   * ⚠️ NO STORE AT ALL IS THE SAME ANSWER. A browser that throws on the
   * `sessionStorage` property itself reaches `recordStore` as null, and returning
   * "saved" there would be the original defect with a different cause.
   */
  const events = await eventsFrom(null);
  check(
    "⭐⭐ a device with no usable store at all is reported the same way",
    events.some((e) => e.type === "not_durable")
  );
}

// ═════════════════════ §3.4.1b rules 4 AND 6 — the discard that owes a `DELETE`
//
// ⚠️⚠️ THE RULE-4 CHECK ALREADY EXISTED AND WAS SILENT ABOUT RULE 6. `e2e-pair.mjs`
// asserts *"an expired record is refused"* and asked nothing about the request the
// discard owes — the same shape as the comment above `loadInFlight`, which cited rule 4
// and stopped there. ⭐ AND IT LIVES HERE RATHER THAN THERE ON PURPOSE: the e2e suites
// need a server and are exempted in the published tree (D-160), so a guard placed
// beside the old check would not run for somebody who clones the repository.

/** An api that records the abandonment `DELETE`s and nothing else. */
const watchingApi = () => {
  const deleted = [];
  return {
    deleted,
    async powChallenge() { throw new Error("no network in this test"); },
    async del(path) { deleted.push(path); },
  };
};

/** A real record for role I, aged past its expiry. Returns the store and `L`. */
async function expiredRecord({ role = pairing.ROLE_INITIATOR } = {}) {
  const store = mapStore();
  await eventsFrom(store); // the real `initiate` writes the real record
  const rec = await store.get(flow.INFLIGHT_KEY);
  await store.set(flow.INFLIGHT_KEY, { ...rec, role, expires_at: Date.now() - 1 });
  return { store, linkSecret: b64uDecode(rec.l, "stored L") };
}

section("⛔⛔ D-165 — rule 4 discards the record, rule 6 sends the `DELETE` first");

{
  const api = watchingApi();
  const { store, linkSecret } = await expiredRecord();
  const held = await flow.loadInFlight(store, { api });

  check("⚠️ rule 4 still holds: the expired record is refused", held === null);
  equal("⚠️ and it really is gone from the store", store.size(), 0);
  equal("⭐⭐⭐ rule 6's abandonment `DELETE` went out", api.deleted.length, 1);

  // ⭐ THE CANARY. A `DELETE` to the wrong path is worse than none: it would look
  // right here for ever while the claimable link stayed live. `pairing_id` derives
  // from `L` (§2.3), so the address is checkable rather than merely present.
  const { pairingId } = await pairing.derivePairing(linkSecret);
  equal(
    "⭐ addressed to the `pairing_id` that derives from the stored `L`",
    api.deleted[0],
    `/api/pair/${b64uEncode(pairingId)}`
  );
}

{
  // ⚠️⚠️ AND NOT FOR THE JOINER. Rule 6's own reason: a joiner's session is either
  // claimed — carrying §3.5's evidence the initiator is entitled to read — or one this
  // device is not a party to. "Deleting either destroys another party's state on a
  // guess." The record still goes; only the request does not.
  const api = watchingApi();
  const { store } = await expiredRecord({ role: pairing.ROLE_JOINER });
  const held = await flow.loadInFlight(store, { api });
  check("⚠️ a joiner's expired record is discarded too", held === null && store.size() === 0);
  equal("⭐⭐ but sends no `DELETE` — it is not this device's session to end", api.deleted.length, 0);
}

{
  // ⚠️ THE OTHER DIRECTION, AND IT IS THE HALF THAT ROTS. A `loadInFlight` that
  // deleted unconditionally would pass both checks above and quietly end every live
  // pairing the moment the app asked whether one existed.
  const api = watchingApi();
  const store = mapStore();
  await eventsFrom(store);
  const held = await flow.loadInFlight(store, { api });
  check("⭐⭐ a record that has NOT expired is returned", Boolean(held?.privateKey));
  equal("⭐⭐ and nothing is deleted, on the server or in the store", api.deleted.length, 0);
  equal("⚠️ the record is still there to be resumed from", store.size(), 1);
}

done();
