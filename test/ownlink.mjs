// §3.4.1c — your own invite link, on your own other device.
//
// ⚠️⚠️ WHY THIS IS A FLOW TEST. The defect (D-174) was not a wrong line anywhere. Every
// line was right about the question it asked; the question was wrong. §3.4.1b's in-flight
// record answers *"is this my own link?"* PER BROWSER, and the question is asked PER
// PERSON — so the maker's own second device, holding the same KEY and the same
// conversations, found no record, concluded it was a joiner, claimed its owner's own
// offer, and left the friend the link had been sent to tripping a genuine MAC-verified
// §3.5 alarm naming its own owner. Nothing failed. Nothing could be grepped for.
//
// ⭐ So the real `initiate` and `join` run here against a fake api and a fake `links`,
// and what is checked is ORDER and REFUSAL — the two things §3.4.1c is made of:
//
//   rule 5   the invite memo is written BEFORE anything observable, and a refusal
//            abandons the creation rather than publishing an unrecorded link
//   rule 1   the roster is consulted before any claim and before §3.5's judgement
//   rules 2,3 what recognition does: open what is there, or name the device that can
//   rule 4   and recognising NOTHING is indistinguishable from a first-time joiner
//   rule 8   Ghost mode has no roster and performs none of it
//
// ⚠️ `test/elsewhere.mjs` holds the other half, and neither is worth much alone: this
// file proves the flow asks the right question, that one proves two devices of one
// identity compute the same answer. A memo derived differently on the two sides would
// leave every check in this file green.

import * as flow from "../src/flow/pair.js";
import * as pairing from "../src/protocol/pairing.js";
import { b64uEncode } from "../src/crypto/b64u.js";
import { check, equal, section, done } from "./harness.mjs";

const ORIGIN = "https://haamu.app";

const mapStore = () => {
  const m = new Map();
  return {
    async get(k) { return m.get(k) ?? null; },
    async set(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
    size: () => m.size,
  };
};

/**
 * An api that records what it was asked for and gets no further.
 *
 * ⚠️ THE LOG IS THE ASSERTION IN HALF THIS FILE. "The claim was not sent" is not
 * observable by watching for an error — every one of these paths ends in an error. It is
 * observable by the request never being made, which needs something that counts.
 */
function watchfulApi() {
  const calls = [];
  return {
    calls,
    async powChallenge() {
      calls.push("pow");
      throw new Error("no network in this test");
    },
    async get(path) {
      calls.push(`GET ${path}`);
      throw new Error("no network in this test");
    },
    async post(path) {
      calls.push(`POST ${path}`);
      throw new Error("no network in this test");
    },
    async del(path) {
      calls.push(`DELETE ${path}`);
    },
  };
}

/** §3.4.1c's memory, as `flow/roster.js` presents it, with the answer dialled in. */
function fakeLinks({ answer = null, refuse = false, log = [] } = {}) {
  return {
    log,
    async rememberInvite(memo) {
      if (refuse) throw Object.assign(new Error("the roster refused"), { reason: "conflict" });
      log.push(`remember ${b64uEncode(memo)}`);
    },
    async recogniseLink(memo) {
      log.push(`recognise ${b64uEncode(memo)}`);
      return answer;
    },
  };
}

const raise = async (fn) => {
  try {
    await fn();
    return null;
  } catch (err) {
    return err;
  }
};

// ═══════════════════════════════════ rule 5 — the creation's commit point

section("§3.4.1c rule 5 — the invite memo goes down before the link exists");

{
  const api = watchfulApi();
  const store = mapStore();
  const links = fakeLinks();
  await raise(() => flow.initiate({ api, origin: ORIGIN, storage: store, links }));

  // ⚠️ THE MEMO IS COMPARED TO THE ONE `L` ACTUALLY DERIVES, not merely counted. A
  // `rememberInvite(somethingElse)` would satisfy "it was called" forever, and the other
  // device would look up sixteen bytes nobody ever wrote.
  const rec = await flow.loadInFlight(store);
  const { linkMemo } = await pairing.derivePairing(rec.linkSecret);
  equal(
    "⭐⭐⭐ the memo written is `HKDF(L, …)` for the link this pairing is actually built on",
    links.log.join(" | "),
    `remember ${b64uEncode(linkMemo)}`
  );
  equal("⚠️ and it is §2.3's sixteen bytes, not a root or an id", linkMemo.length, 16);

  // ⭐ ORDER, WHICH IS THE ENTIRE RULE. `deadApi` fails at §9.1's challenge, and that is
  // the first thing in `initiate` to touch the network — so a memo recorded by the time
  // the pow call was made is a memo recorded before the offer could possibly exist.
  equal("⭐⭐ and it was written before §9.1's search, which is before anything observable",
    api.calls.join(","), "pow");
}

{
  const api = watchfulApi();
  const store = mapStore();
  const err = await raise(() =>
    flow.initiate({ api, origin: ORIGIN, storage: store, links: fakeLinks({ refuse: true }) })
  );
  equal("⛔⛔ a REFUSED memo abandons the creation — it does not publish an unrecorded link",
    err?.reason ?? "(none)", "invite_unrecorded");
  // ⚠️ INCLUDING THE ABANDONMENT `DELETE`. §3.4.1b rule 6 is about "a link left
  // claimable", and nothing was ever published — so a `DELETE` here would hand the
  // server a `pairing_id` derived from an `L` that never left this device, for a
  // session it has never heard of. It sent one until this rule made the case reachable.
  equal("⭐⭐ and nothing was asked of the server at all: no search, no offer, no DELETE",
    api.calls.join(",") || "(nothing)", "(nothing)");
  check("⚠️ the refusal ENDS the pairing, so no screen offers to carry on with it",
    flow.endsThePairing(err));
  equal("⭐ and the in-flight record is gone, which is what 'abandon the creation' means",
    store.size(), 0);
}

{
  // Rule 8. §7.6 has no roster, so a ghost client performs none of §3.4.1c and must not
  // be stopped by it — `links` is null and the creation proceeds exactly as before.
  const api = watchfulApi();
  await raise(() => flow.initiate({ api, origin: ORIGIN, storage: mapStore(), links: null }));
  equal("⚠️ Ghost mode records nothing and is not blocked by that (rule 8)",
    api.calls.join(","), "pow");
}

// ═══════════════════════════ rules 1–4 — the joiner consults before it claims

section("§3.4.1c rules 1–4 — the roster is asked before any claim");

/** A link built from a real `L`, so the memo the joiner computes is the real one. */
async function aLink() {
  const secret = pairing.newLinkSecret();
  return { link: pairing.buildLink(ORIGIN, secret), ...(await pairing.derivePairing(secret)) };
}

{
  const { link, linkMemo } = await aLink();
  const api = watchfulApi();
  const root = b64uEncode(new Uint8Array(32).fill(7));
  const links = fakeLinks({ answer: { kind: "channel", root } });
  const err = await raise(() => flow.join({ api, link, storage: mapStore(), links }));

  equal("⭐⭐ rule 2: a memo naming a channel stops the join", err?.reason ?? "(none)", "own_channel");
  equal("⭐⭐⭐ and it names WHICH conversation, because the rule says to open it",
    err?.root ?? "(none)", root);
  equal("⛔⛔ AND NOT ONE REQUEST WAS SENT — no claim, and nothing for §3.5 to judge",
    api.calls.join(",") || "(nothing)", "(nothing)");
  equal("⚠️ the roster was asked with the memo this link derives, not some other value",
    links.log.join(" | "), `recognise ${b64uEncode(linkMemo)}`);
}

{
  const { link } = await aLink();
  const api = watchfulApi();
  const err = await raise(() =>
    flow.join({ api, link, storage: mapStore(), links: fakeLinks({ answer: { kind: "invite" } }) })
  );
  equal("⭐⭐ rule 3: a memo in `invites` stops the join too", err?.reason ?? "(none)", "own_link");
  equal("⛔⛔ and again nothing was sent — this is the claim that spent the link",
    api.calls.join(",") || "(nothing)", "(nothing)");
  check("⚠️ it ENDS the pairing: this device can never finish it, so no carry-on offer",
    flow.endsThePairing(err));
}

{
  /**
   * ⚠️⚠️ RULE 4, AND IT IS THE ONE THAT KEEPS THE PRODUCT WORKING. Learning nothing is
   * the ordinary case for every first-time joiner there will ever be, and it MUST stay
   * indistinguishable from it — a check that stopped here would break every pairing in
   * the product while passing all three checks above.
   */
  const { link, pairingId } = await aLink();
  const api = watchfulApi();
  const err = await raise(() =>
    flow.join({ api, link, storage: mapStore(), links: fakeLinks({ answer: null }) })
  );
  equal("⭐⭐⭐ recognising NOTHING falls straight through to §3.2 — the ordinary join",
    api.calls.join(","), `GET /api/pair/${b64uEncode(pairingId)}`);
  check("⚠️ and the failure it ends with is the network's, not a §3.4.1c one",
    err?.reason !== "own_link" && err?.reason !== "own_channel", err?.reason ?? err?.message);
}

{
  const { link, pairingId } = await aLink();
  const api = watchfulApi();
  await raise(() => flow.join({ api, link, storage: mapStore(), links: null }));
  equal("⚠️ Ghost mode joins exactly as before, recognising nothing (rule 8)",
    api.calls.join(","), `GET /api/pair/${b64uEncode(pairingId)}`);
}

done();
