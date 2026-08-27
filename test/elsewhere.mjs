// D-168 — what this client can say about a SECOND HOLDER OF THE KEY, and what it may not.
//
// ⚠️⚠️ THE ONLY THING FAKED HERE IS THE TRANSPORT, which is `binding.mjs`'s and
// `relay.mjs`'s reason and the same reason again: `e2e-roster.mjs` proves the honest path
// against the real Go server and CANNOT run in the published client repository — there is
// no `../server` there. The detection this file guards is the product's whole answer to
// the fault Hannu measured on 2026-08-26, and a guard for it that a stranger who clones
// `hannu64/haamu-client` and types `./test.sh` does not run is a guard for nobody.
//
// ⚠️ NO ARGON2 AND NO WASM. §7.2's Argon2id turns a PHRASE into `K_master`; everything
// this file needs hangs off `K_master` itself, so a random 32 bytes stands in for the
// phrase and the derivation below is the real one.
//
// ⭐ WHAT IT IS ABOUT. §7.3.1 rule 1 and D-045 put concurrent multi-device out of scope,
// and it cannot be enforced: every holder of `K_master` is a fully authoritative writer,
// there is no device list, and there is nothing to revoke. So the client cannot STOP a
// second device — it can only notice one, and the noticing is a single comparison:
//
//     the sealed roster's own version rose, and this device did not raise it.
//
// Everything below is about the two halves of that sentence being load-bearing.

import { randomBytes } from "../src/crypto/random.js";
import { utf8String } from "../src/crypto/bytes.js";
import { b64uEncode } from "../src/crypto/b64u.js";
import { ApiError } from "../src/net/api.js";
import * as passphrase from "../src/protocol/passphrase.js";
import * as rosterFlow from "../src/flow/roster.js";
import { check, equal, section, done } from "./harness.mjs";

/** A roster row in memory: one blob, one compare-and-swap counter, no crypto. */
function fakeServer() {
  const state = { blob: null, version: 0 };
  const api = {
    async signed(method, path, { bodyBytes } = {}) {
      const body = bodyBytes === undefined ? undefined : JSON.parse(utf8String(bodyBytes));
      if (method === "GET") {
        if (state.blob === null) throw new ApiError(404, "not_found");
        return { blob: state.blob, version: state.version };
      }
      if (method === "POST") {
        if (state.blob !== null) throw new ApiError(409, "identity_exists");
        state.blob = body.blob;
        state.version = 1;
        return { version: 1 };
      }
      if (method === "PUT") {
        // §7.3.1's compare-and-swap, which is the whole of what the server does here.
        if (body.if_match !== state.version) throw new ApiError(409, "version_conflict");
        state.blob = body.blob;
        state.version += 1;
        return { version: state.version };
      }
      throw new ApiError(405, "method_not_allowed");
    },
    async powChallenge() {
      return { challenge: "", bits: 0 };
    },
  };
  // §7.3.2 rule 3's shape: the counter moves and the sealed blob does not. A server can
  // do this for free; nothing but `rosterKey` can move the version INSIDE the blob.
  const bumpCounterOnly = () => (state.version += 1);
  return { state, api, bumpCounterOnly };
}

const memStore = () => {
  const m = new Map();
  return { get: async (k) => (m.has(k) ? m.get(k) : null), set: async (k, v) => void m.set(k, v), delete: async (k) => void m.delete(k) };
};

/** One phrase, two devices: shared keys, separate caches. §7.2 produces exactly this. */
const device = (api, keys) => rosterFlow.openRoster({ api, keys, storage: memStore(), durable: memStore() });

const kinds = (roster) => roster.takeWarnings().map((w) => w.kind);
const elsewhereIn = (list) => list.filter((k) => k === "elsewhere").length;

const keys = await passphrase.deriveRosterKeys(randomBytes(32));
const root = (n) => new Uint8Array(32).fill(n);

// ============================================================================

section("D-168 — the version inside the sealed blob is what says another device wrote");

{
  const server = fakeServer();
  const a = device(server.api, keys);
  const b = device(server.api, keys);

  await a.create();
  await b.load({ network: true });

  // ⚠️ A DEVICE THAT HAS JUST MET THE ROSTER FOR THE FIRST TIME HAS NO BASELINE, and
  // the check must not invent one. §7.3.2 makes the same point about the high-water mark.
  equal("a first read raises nothing — there is nothing to have risen from", kinds(b).join(","), "");

  await a.addChannel({ root: root(1), name: "one", role: "I" });
  equal("⭐ and a device is never told about its own write", kinds(a).join(","), "");

  await b.check();
  const seen = kinds(b);
  check(`⛔⛔ the other device's write reaches B as 'elsewhere' (${seen.join(",") || "nothing"})`, elsewhereIn(seen) === 1, seen.join(","));

}

{
  // ⚠️ §7.3.3 case 5 is rate-limited to one an hour, so a second `check()` on the same
  // instance throws `access_rule` rather than fetching. Every scenario below therefore
  // uses a FRESH pair, which is also the honest shape: these are separate runs.
  const server = fakeServer();
  const a = device(server.api, keys);
  const b = device(server.api, keys);
  await a.create();
  await b.load({ network: true });
  await a.addChannel({ root: root(2), name: "two", role: "I" });
  await b.check();
  kinds(b);

  // §7.3.3 case 2: a channel change fetches without any button being pressed, and the
  // same evidence arrives that way too.
  await a.addChannel({ root: root(3), name: "three", role: "I" });
  await b.addChannel({ root: root(4), name: "four", role: "J" });
  const seen = kinds(b);
  check("⭐ and it does not need the button — a channel change meets it too", elsewhereIn(seen) === 1, seen.join(","));
}

section("§7.3.1's 409 is the same evidence arriving the other way round");

{
  const server = fakeServer();
  const a = device(server.api, keys);
  const b = device(server.api, keys);
  await a.create();
  await b.load({ network: true });
  kinds(a);
  kinds(b);

  // Both hold version 1. B writes; A then writes at a version that is no longer current.
  await b.addChannel({ root: root(5), name: "b's", role: "J" });
  kinds(b);
  await a.addChannel({ root: root(6), name: "a's", role: "I" });

  const seen = kinds(a);
  check("⛔⛔ the 409's refetch is what tells A, and it comes through the same comparison", elsewhereIn(seen) === 1, seen.join(","));

  // ⚠️ AND THE WRITE STILL LANDS. A notice that cost the person their write would be a
  // worse product than the silence it replaced: §7.3.1 merges and retries, and this is
  // the check that the notice was added BESIDE that and not in front of it.
  const names = a.channels().map((c) => c.name).sort().join(",");
  equal("⭐ and A's own addition survived the merge it just heard about", names, "a's,b's");
}

section("⚠️⚠️ it is the INNER version, so a server cannot raise this notice by itself");

{
  const server = fakeServer();
  const a = device(server.api, keys);
  await a.create();
  await a.addChannel({ root: root(7), name: "seven", role: "I" });
  kinds(a);

  const b = device(server.api, keys);
  await b.load({ network: true });
  kinds(b);

  // §7.3.2 rule 3's move: the counter rises, the sealed bytes do not.
  server.bumpCounterOnly();
  await b.check();
  const seen = kinds(b);
  check("⛔⛔ a counter the server moved on its own raises no 'elsewhere'", elsewhereIn(seen) === 0, seen.join(","));
  check("⚠️ and it is not silence either — §7.3.2 rule 3's mismatch is what it IS", seen.includes("version_mismatch"), seen.join(","));
}

{
  // ⚠️⚠️ THE CANARY FOR THE CHECK ABOVE. "No 'elsewhere'" would also pass if the
  // detection had been deleted outright, so the same instrument has to show it firing.
  const server = fakeServer();
  const a = device(server.api, keys);
  const b = device(server.api, keys);
  await a.create();
  await b.load({ network: true });
  kinds(b);
  await a.addChannel({ root: root(8), name: "eight", role: "I" });
  await b.check();
  check("⚠️⚠️ and the same instrument sees it fire when the SEALED version is the one that moved", elsewhereIn(kinds(b)) === 1, "canary");
}

section("what the notice may not become — the limits are in the code, not only the prose");

{
  const server = fakeServer();
  const a = device(server.api, keys);
  await a.create();
  kinds(a);

  // ⚠️ AN EVENT AND NOT A PRESENCE. Reading the same roster again is not another device;
  // if it were, a device that merely re-read on a schedule would accuse itself for ever.
  const b = device(server.api, keys);
  await b.load({ network: true });
  kinds(b);
  await b.check();
  equal("⭐ re-reading an unchanged roster raises nothing", kinds(b).join(","), "");

  // ⚠️ AND IT IS RAISED ONCE PER EVENT, not once per read: `takeWarnings` drains.
  const c = device(server.api, keys);
  await c.load({ network: true });
  kinds(c);
  await a.addChannel({ root: root(9), name: "nine", role: "I" });
  await c.check();
  equal("⭐ and it is drained by the reader — one event, one telling", elsewhereIn(kinds(c)), 1);
  equal("⚠️ so a second drain finds nothing left to say", kinds(c).join(","), "");
}

section("⚠️⚠️ a document that stopped being a client stops being a witness (§4.2.2)");

{
  // ⭐ MEASURED FIRST, THEN RULED. `~/lpm-probes/probe-elsewhere-tabs.mjs` put two tabs of
  // ONE browser on one KEY: the second went dormant exactly as §4.2.2 requires, the first
  // wrote the roster, and the takeover then raised a notice naming "another browser or
  // another device" for what was the tab next door — a case §4.2.2 had already handled
  // properly, with a control. A false alarm is the worst outcome available (§3.5).
  const server = fakeServer();
  const a = device(server.api, keys);
  const b = device(server.api, keys);
  await a.create();
  await b.load({ network: true });
  kinds(b);

  // B goes dormant. From here it touches nothing, so it cannot keep its version current.
  b.forgetBaseline();
  await a.addChannel({ root: root(10), name: "ten", role: "I" });

  await b.check();
  equal("⛔⛔ the first read after waking says nothing — it slept through the interval", kinds(b).join(","), "");

  // ⭐ AND IT IS A ONE-READ SILENCE, NOT AN OFF SWITCH. A genuine second device is caught
  // by the next comparison, because the read above re-established the baseline.
  await a.addChannel({ root: root(11), name: "eleven", role: "J" });
  await b.addChannel({ root: root(12), name: "twelve", role: "J" });
  const seen = kinds(b);
  check("⭐⭐ and the very next one catches a real second device", elsewhereIn(seen) === 1, seen.join(","));
}

{
  // ⚠️ THE OTHER DIRECTION: forgetting the baseline must not suppress §7.3.2's warnings,
  // which are about the SERVER and have nothing to do with which client is awake.
  const server = fakeServer();
  const a = device(server.api, keys);
  await a.create();
  await a.addChannel({ root: root(13), name: "thirteen", role: "I" });
  const b = device(server.api, keys);
  await b.load({ network: true });
  kinds(b);
  b.forgetBaseline();
  server.bumpCounterOnly();
  await b.check();
  check("⚠️⚠️ §7.3.2 rule 3's mismatch is untouched by it", kinds(b).includes("version_mismatch"), "mismatch still raised");
}

done();
