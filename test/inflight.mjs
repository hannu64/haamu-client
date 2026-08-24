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

done();
