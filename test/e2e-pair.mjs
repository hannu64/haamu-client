// Two clients pair, over real HTTP, against the real Go server.
//
// The other suites in this directory are anchored outside the project: published
// RFC vectors, the specification's own warnings, frozen protocol vectors, and a
// second implementation in Go. This one is anchored differently again — it is the
// only test in which the two ends of PROTOCOL.md §3 are separate processes that
// have to agree, and the thing it proves is the thing the ROADMAP asked for:
// **two browsers pair, and both see the same six digits.**
//
// It needs a running server. `./e2e.sh` at the repository root starts one against
// the throwaway development database and points this file at it.

import { createApi, NetworkError } from "../src/net/api.js";
import * as flow from "../src/flow/pair.js";
import * as pairing from "../src/protocol/pairing.js";
import * as codes from "../src/protocol/code.js";
import * as pow from "../src/protocol/pow.js";
import * as x25519 from "../src/crypto/x25519.js";
import { b64uEncode, b64uDecodeExact } from "../src/crypto/b64u.js";
import { randomBytes } from "../src/crypto/random.js";
import { check, equal, section, done, hex } from "./harness.mjs";

const BASE = process.env.LPM_BASE_URL || "http://127.0.0.1:8099";
const ORIGIN = "https://haamu.invalid";

const api = createApi({ baseUrl: BASE, timeoutMs: 20000 });

console.log(`server ${BASE}`);

/** A stand-in for `sessionStorage` (§3.4.1) that a Node test can inspect. */
function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    get size() {
      return m.size;
    },
  };
}

/**
 * §3.4.1b's OTHER kind of store: async `get`/`set`/`delete` holding a structured
 * value — the interface `storage/vault.js` speaks, which is what a Kept-mode
 * pairing record now lives in.
 *
 * ⚠️ IT IS HERE BECAUSE A REFACTOR THAT ONLY THE OLD PATH EXERCISES IS NOT TESTED.
 * Every other check in this file hands `initiate`/`join` a Web Storage double, so
 * all of them would still pass with the record-store branch wrong in every
 * particular. The one below is the only thing standing under that branch.
 */
function memRecords() {
  const m = new Map();
  return {
    async get(k) {
      return m.has(k) ? m.get(k) : null;
    },
    async set(k, v) {
      m.set(k, v);
    },
    async delete(k) {
      m.delete(k);
    },
    get size() {
      return m.size;
    },
    keys() {
      return [...m.keys()];
    },
  };
}

/**
 * A record store that answers on a real timer instead of a microtask, the way
 * IndexedDB-plus-AES-GCM does. Reads only — a slow write would change what is under
 * test rather than how long the read takes.
 */
function slowRecords(inner, ms = 30) {
  const later = () => new Promise((r) => setTimeout(r, ms));
  return {
    ...inner,
    async get(k) {
      await later();
      return inner.get(k);
    },
  };
}

/**
 * A store that can be made to stop forgetting, which is how a test says *the browser
 * was discarded*.
 *
 * ⚠️⚠️ AN `AbortController` ALONE MODELS NOTHING HERE, AND GETTING THAT WRONG WOULD
 * MAKE EVERY RESUMPTION CHECK BELOW VACUOUS. `initiate` and `join` clear the record
 * in a `finally`, so an abort leaves an EMPTY store — a resumption test written on
 * top of one would be resuming from nothing and would pass by finding nothing to do.
 * A page iOS discards runs no `finally` at all: whatever was in the store when it
 * died is what the next page finds. `crash()` is that, exactly — the delete stops
 * happening — and `reboot()` is the new page, which forgets normally again.
 *
 * ⚠️ WRITTEN OUT RATHER THAN SPREAD FROM `inner`. `{...inner}` would evaluate the
 * `size` getter once and freeze it at whatever it read at that instant.
 */
function crashable(inner) {
  let crashed = false;
  return {
    get: (k) => inner.get(k),
    set: (k, v) => inner.set(k, v),
    delete: async (k) => {
      if (!crashed) await inner.delete(k);
    },
    get size() {
      return inner.size;
    },
    keys: () => inner.keys(),
    crash: () => (crashed = true),
    reboot: () => (crashed = false),
  };
}

async function expectFailure(promise, reason, what) {
  try {
    await promise;
    check(`${what} → ${reason}`, false, "it succeeded instead");
    return null;
  } catch (err) {
    check(`${what} → ${reason}`, err?.reason === reason, `got ${err?.reason ?? err?.message ?? err}`);
    return err;
  }
}

// ------------------------------------------------------------------ §3, live

section("§3 — two clients pair");

{
  const iStore = memStorage();
  const jStore = memStorage();

  let resolveLink;
  const linkReady = new Promise((r) => (resolveLink = r));
  const iEvents = [];
  const jEvents = [];

  const iRun = flow.initiate({
    api,
    origin: ORIGIN,
    storage: iStore,
    onEvent: (e) => {
      iEvents.push(e.type);
      if (e.type === "link") resolveLink(e.link);
    },
  });

  const link = await linkReady;
  check("the initiator publishes a link before anyone has claimed", link.startsWith(`${ORIGIN}/c#`));
  check("the in-flight session is on disk while it waits (§3.4.1)", (await flow.loadInFlight(iStore)) !== null);

  const jRun = flow.join({ api, link, storage: jStore, onEvent: (e) => jEvents.push(e.type) });
  const [i, j] = await Promise.all([iRun, jRun]);

  // ⭐ THE POINT OF THE WHOLE STEP.
  equal("both sides derive the same channel root", hex(i.channelRoot), hex(j.channelRoot));
  equal("both sides display the same short authentication string", i.sas, j.sas);
  check("the SAS is six digits, zero-padded (§3.6)", /^[0-9]{6}$/.test(i.sas));
  check("no tripwire on a clean pairing", !i.tripwire.raised && !j.tripwire.raised);

  // ⚠️ AN EXACT SEQUENCE, ON PURPOSE — this is one of the few places that can see
  // §3's ORDER rather than its arithmetic. `proof` joined it in round 5 and must
  // stay FIRST: §9.1's work is what buys the right to publish an offer, so a
  // build that emitted it after `link` would be a build that published first and
  // paid afterwards.
  equal("the initiator's events", iEvents.join(","), "proof,link,claimed,revealed");
  // The joiner has no `proof` because the joiner does no work — §9.1 charges the
  // side that creates the pairing. A `proof` appearing here would be a real find.
  equal("the joiner's events", jEvents.join(","), "claimed,revealed");

  // §3.3 and §3.4: both discard `L` and their private key when they are done.
  check("the initiator cleared its in-flight state", (await flow.loadInFlight(iStore)) === null);
  check("the joiner cleared its in-flight state", (await flow.loadInFlight(jStore)) === null);

  // ⚠️⚠️ §3.4 NO LONGER REMOVES THE ROW, AND THIS ASSERTION USED TO SAY IT DID.
  // `migrations/005` (D-181) turns J's §3.4 delete on a CLAIMED or REVEALED session
  // into a TOMBSTONE: state USED, `i_pub` dropped, and the four fields a late arrival
  // needs to judge for itself kept. This file was last touched before that landed and
  // nobody ran it afterwards, so the check below has been red on `main` since D-181
  // shipped — found 2026-09-01, by running `e2e.sh`, which is not in the pre-push
  // list that `test.sh` and the probes are in. That gap is the real finding.
  //
  // ⭐ AND THE TOMBSTONE IS WORTH MORE THAN THE 404 WAS. "It is gone" was one bit;
  // this says the row that remains carries exactly what §3.5's arrival check reads
  // and NOT the initiator's key, which is the property D-181 exists for.
  //
  // ⚠️ IT TAKES BOTH ROUTES, BECAUSE THE FOUR FIELDS ARE SPLIT ACROSS THEM: §3.2's
  // offer serves `commit` and `mac`, §3.3's status serves the two keys. A late
  // arrival reads both, so a check of one proves half a tombstone.
  const { pairingId } = await pairing.derivePairing(pairing.parseLink(link));
  const idPath = `/api/pair/${b64uEncode(pairingId)}`;
  const offer = await api.get(idPath);
  const spent = await api.get(`${idPath}/status`);
  equal("§3.4 leaves a tombstone rather than a hole (D-181)", spent.state, "used");
  equal("and §3.2's route says the same word about it", offer.state, "used");
  check(
    "⭐⭐ the initiator's key is NOT in it — §3.3 discarded it and the row may not keep it",
    !spent.i_pub,
    `i_pub: ${JSON.stringify(spent.i_pub)}`
  );
  check(
    "⭐⭐⭐ but everything a late arrival judges the link by IS",
    Boolean(offer.commit && offer.mac && spent.j_pub && spent.j_mac),
    "commit + mac say the offer is the one this link describes; j_pub + j_mac say whoever took it held L"
  );
}

// ------------------------------------------------- §2.2, over the same wire

/**
 * The same handshake on §2.2's secret instead of §2.1's, and the point is that
 * NOTHING BELOW §2.2c KNOWS THE DIFFERENCE.
 *
 * ⚠️⚠️ THE ONE THING THIS CATCHES THAT NO OTHER SUITE CAN: the code reaches the
 * other side as a STRING A PERSON SAID, so the joiner's input is not the initiator's
 * output — it is a rendering of it. The vectors prove one implementation normalises
 * the same way twice; this proves the value survives the round trip in the shape a
 * real person produces, which is lower case with spaces where the dashes were.
 */
section("§2.2 — the same handshake, on a code somebody read out");

{
  const iStore = memStorage();
  const jStore = memStorage();

  let resolveCode;
  const codeReady = new Promise((r) => (resolveCode = r));
  const iEvents = [];

  const iRun = flow.initiate({
    api,
    origin: ORIGIN,
    storage: iStore,
    as: "code",
    onEvent: (e) => {
      iEvents.push(e.type);
      if (e.type === "code") resolveCode(e.code);
    },
  });

  const spoken = await codeReady;
  equal("the initiator publishes 16 characters, not a link", String(spoken.length), "16");
  check(
    "and every one of them is in §2.2's alphabet",
    [...spoken].every((c) => codes.CODE_ALPHABET.includes(c)),
    codes.format(spoken)
  );
  equal("the events are the link flow's, with `code` where `link` was", iEvents.join(","), "proof,code");

  // ⭐ What the other person actually types, having heard it down a telephone.
  const asHeard = codes.format(spoken).toLowerCase().replace(/-/g, " ");
  const jRun = flow.join({ api, link: asHeard, storage: jStore });
  const [i, j] = await Promise.all([iRun, jRun]);

  equal("both sides derive the same channel root", hex(i.channelRoot), hex(j.channelRoot));
  equal("both sides display the same six digits", i.sas, j.sas);
  check("no tripwire", !i.tripwire.raised && !j.tripwire.raised);

  // ⚠️ §2.2's 80 bits are not §2.1's 128, and `L` is the same LENGTH either way —
  // which is the whole of why §3 needed no change (D-116). Asserting it here is
  // asserting that the choice held all the way to the wire.
  equal("§2.2c — L was 16 bytes on this pairing too", String(codes.secret(spoken).length), "16");
}

{
  // ⚠️ A mistyped code must not arrive as a complaint about a missing `#`. The two
  // failures below are the two mistakes a person can actually make, and they are
  // told apart so the copy can say which one happened.
  await expectFailure(
    flow.join({ api, link: "KOMP-3XQR-BHTW-9FD", storage: memStorage() }),
    "code_malformed",
    "a code one character short"
  );
  await expectFailure(
    flow.join({ api, link: "KOMP-3XQR-BHTW-9FDN", storage: memStorage() }),
    "not_found",
    "sixteen legal characters that were never issued"
  );
}

// -------------------------------------------------- §3.6.1, on the wire

section("§3.6.1 — the key is not on the wire until the joiner has committed");

/**
 * Publish an offer by hand, so each message can be inspected as it goes past.
 *
 * The secret is a parameter so that a caller can publish a SECOND offer on a link a
 * device already holds a §3.4.1b record for — see the last block of §3.4.1b, which
 * needs exactly that state and cannot reach it any other way from outside.
 */
async function freshOffer(secret) {
  const linkSecret = secret ?? pairing.newLinkSecret();
  const { pairingId, macKey } = await pairing.derivePairing(linkSecret);
  const { privateKey, publicKey } = await x25519.generateKeyPair();
  const commit = await pairing.commitTo(publicKey);
  const idPath = `/api/pair/${b64uEncode(pairingId)}`;

  const c = await api.powChallenge();
  const solution = await pow.solve(c.challenge, c.bits);
  await api.post(idPath, await pairing.buildOffer(macKey, commit, solution));
  return { linkSecret, pairingId, macKey, privateKey, publicKey, commit, idPath };
}

{
  // ⭐⭐ D-136: THE TWO TTL CONSTANTS AGREE, MEASURED AGAINST A REAL OFFER RATHER
  // THAN ASSERTED BETWEEN TWO LITERALS. `store.PairingTTL` (Go) and
  // `PAIRING_TTL_SECONDS` (JS) are separate numbers in separate languages, and the
  // server is the authority: it stamps `expires_at` from its own clock and every
  // query filters on it. A client reading HIGH would promise a life the link does not
  // have — it would offer to carry on with a pairing the server had already dropped,
  // and §3.4.1b rule 4's whole job is to delete a record before that can happen.
  //
  // ⚠️ THE TOLERANCE IS THE ROUND TRIP, NOT A FUDGE FACTOR. The offer is stamped on
  // the server between this client reading its clock and reading the response, so the
  // two can differ by the request's own duration and no more.
  const before = Date.now();
  const s = await freshOffer();
  const offer = await api.get(s.idPath);
  const serverTtlMs = offer.expires * 1000 - before;
  const clientTtlMs = pairing.PAIRING_TTL_SECONDS * 1000;
  check(
    "⭐⭐ the server's link lifetime is the one the client promises (D-136)",
    Math.abs(serverTtlMs - clientTtlMs) < 30_000,
    `server ${Math.round(serverTtlMs / 1000)}s vs client ${pairing.PAIRING_TTL_SECONDS}s`
  );
  equal("and it is one day", pairing.PAIRING_TTL_SECONDS, 86400);

  check("the offer carries the commitment", offer.commit === b64uEncode(s.commit));
  check("⭐ the offer carries NO public key", !("pub" in offer) && !("i_pub" in offer));
  check("a joiner can verify the offer MAC", await pairing.verifyOffer(s.macKey, s.commit, b64uDecodeExact(offer.mac, 32, "mac_I")));

  let st = await api.get(`${s.idPath}/status`);
  check("before the claim: state open, no key", st.state === "open" && !st.i_pub);

  const j = await x25519.generateKeyPair();
  await api.post(`${s.idPath}/claim`, await pairing.buildClaim(s.macKey, j.publicKey, s.commit));

  st = await api.get(`${s.idPath}/status`);
  check("after the claim: the joiner's key is there", st.j_pub === b64uEncode(j.publicKey));
  check(
    "⭐⭐ after the claim the initiator's key is STILL not on the wire — this is what makes the SAS one-shot",
    !st.i_pub
  );

  await api.post(`${s.idPath}/reveal`, pairing.buildReveal(s.publicKey));
  st = await api.get(`${s.idPath}/status`);
  check("only the reveal publishes it", st.i_pub === b64uEncode(s.publicKey));
  check("and it opens the commitment", await pairing.openCommitment(s.commit, b64uDecodeExact(st.i_pub, 32, "I_pub")));

  await api.del(s.idPath);
}

// ------------------------------------------------------------------ §3.5

section("§3.5 — the tripwire, judged by the party that can");

{
  const s = await freshOffer();
  const j = await x25519.generateKeyPair();
  await api.post(`${s.idPath}/claim`, await pairing.buildClaim(s.macKey, j.publicKey, s.commit));

  // A second holder of `L` claims. It is refused, and the refusal is recorded.
  const attacker = await x25519.generateKeyPair();
  let refused = false;
  try {
    await api.post(`${s.idPath}/claim`, await pairing.buildClaim(s.macKey, attacker.publicKey, s.commit));
  } catch (err) {
    refused = err?.status === 409 && err?.code === "already_claimed";
  }
  check("a second claim is refused", refused);

  const st = await api.get(`${s.idPath}/status`);
  check("the server records that it happened", st.tripwire === true);
  check("and hands over the evidence rather than a verdict", !!st.rejected_claim);
  check(
    "⭐ the refused claim's MAC verifies under `L` — this one really is an interception",
    await pairing.verifyClaim(
      s.macKey,
      b64uDecodeExact(st.rejected_claim.pub, 32, "pub"),
      s.commit,
      b64uDecodeExact(st.rejected_claim.mac, 32, "mac")
    )
  );
  await api.del(s.idPath);
}

{
  /**
   * ⛔⛔⛔ D-167 — EVERYTHING ABOVE IS THE PRIMITIVE, AND THE PRIMITIVE WAS NEVER THE
   * QUESTION. The two checks before this one prove the server records the refused claim
   * and that `verifyClaim` accepts it. Neither runs `initiate()`, so neither could say
   * whether the alarm reaches the value the interface reads — and it is the interface
   * that had the fault Hannu found on 2026-08-26.
   *
   * ➡️ **A test of the pieces is not a test of the path.** This drives the real flow,
   * with two real joiners racing one link, and asks the initiator what it came back with.
   */
  let resolveLink;
  const linkReady = new Promise((r) => (resolveLink = r));
  const events = [];
  const iRun = flow.initiate({
    api, origin: ORIGIN, storage: memStorage(),
    onEvent: (e) => { events.push(e.type); if (e.type === "link") resolveLink(e.link); },
  });
  const raced = await linkReady;
  const [i, one, two] = await Promise.allSettled([
    iRun,
    flow.join({ api, link: raced, storage: memStorage() }),
    flow.join({ api, link: raced, storage: memStorage() }),
  ]);

  const refused = [one, two].filter((r) => r.status === "rejected");
  check("one of the two holders of `L` is refused", refused.length === 1, `${refused.length} refused`);
  check("⭐⭐⭐ and the INITIATOR comes back with a verified tripwire", i.value?.tripwire?.verified === true);
  check("⭐⭐ the interface is told while it waits, not only at the end", events.includes("tripwire"));

  // ⚠️ THE OTHER DIRECTION, because an alarm that is always on is no alarm. §3.5's own
  // reasoning: the one alarm this design has must not become the one users dismiss.
  let cleanLink;
  const cleanReady = new Promise((r) => (cleanLink = r));
  const cleanRun = flow.initiate({
    api, origin: ORIGIN, storage: memStorage(),
    onEvent: (e) => { if (e.type === "link") cleanLink(e.link); },
  });
  const link2 = await cleanReady;
  const [ci] = await Promise.all([cleanRun, flow.join({ api, link: link2, storage: memStorage() })]);
  check("⚠️ an unraced pairing right afterwards comes back clean", ci.tripwire?.verified === false);
}

{
  // The same flag, raised by somebody who saw `pairing_id` go past but does not
  // hold `L`. ⚠️ If the client trusted the flag, this would be a false alarm any
  // observer could raise at will — which is why §3.5's check had to move.
  const s = await freshOffer();
  const j = await x25519.generateKeyPair();
  await api.post(`${s.idPath}/claim`, await pairing.buildClaim(s.macKey, j.publicKey, s.commit));

  try {
    await api.post(`${s.idPath}/claim`, { pub: b64uEncode(randomBytes(32)), mac: b64uEncode(randomBytes(32)) });
  } catch {
    /* refused, as it must be */
  }
  const st = await api.get(`${s.idPath}/status`);
  check("the server raises the same flag, because it cannot tell the difference", st.tripwire === true);
  check(
    "⭐⭐ but the evidence does NOT verify, so the client must not raise the alarm",
    !(await pairing.verifyClaim(
      s.macKey,
      b64uDecodeExact(st.rejected_claim.pub, 32, "pub"),
      s.commit,
      b64uDecodeExact(st.rejected_claim.mac, 32, "mac")
    ))
  );
  await api.del(s.idPath);
}

// ------------------------------------------------------- what the client does

section("§3 — the client's refusals");

{
  // An observer of `pairing_id` claims before the real joiner. The initiator must
  // notice that the claim cannot prove it came from the link, and must say so
  // as a denial of service rather than as an interception.
  const store = memStorage();
  let forged;
  const run = flow.initiate({
    api,
    origin: ORIGIN,
    storage: store,
    onEvent: async (e) => {
      if (e.type !== "link") return;
      const { pairingId } = await pairing.derivePairing(pairing.parseLink(e.link));
      forged = `/api/pair/${b64uEncode(pairingId)}`;
      await api.post(`${forged}/claim`, {
        pub: b64uEncode(randomBytes(32)),
        mac: b64uEncode(randomBytes(32)),
      });
    },
  });
  await expectFailure(run, "claim_forged", "a claim the link cannot vouch for");
  check("the in-flight state is cleared even on failure", (await flow.loadInFlight(store)) === null);
  await api.del(forged);
}

{
  // The joiner arrives at a session somebody else already holds legitimately.
  const s = await freshOffer();
  const other = await x25519.generateKeyPair();
  await api.post(`${s.idPath}/claim`, await pairing.buildClaim(s.macKey, other.publicKey, s.commit));

  const link = pairing.buildLink(ORIGIN, s.linkSecret);
  await expectFailure(
    flow.join({ api, link, storage: memStorage() }),
    "already_claimed",
    "a link somebody with the secret opened first"
  );
  await api.del(s.idPath);
}

{
  // §3.4's hard error. A hostile server serves a key its own commitment does not
  // cover; the joiner must abort and must not retry.
  const hostile = createApi({
    baseUrl: BASE,
    timeoutMs: 20000,
    fetchImpl: async (url, init) => {
      const res = await fetch(url, init);
      if (!String(url).endsWith("/status")) return res;
      const body = await res.json();
      if (body.i_pub) body.i_pub = b64uEncode(randomBytes(32));
      return new Response(JSON.stringify(body), { status: res.status, headers: res.headers });
    },
  });

  let resolveLink;
  const linkReady = new Promise((r) => (resolveLink = r));
  const iRun = flow.initiate({
    api,
    origin: ORIGIN,
    storage: memStorage(),
    onEvent: (e) => e.type === "link" && resolveLink(e.link),
  });
  const link = await linkReady;
  const jRun = flow.join({ api: hostile, link, storage: memStorage() });

  await expectFailure(jRun, "commitment_mismatch", "a substituted key at the reveal");
  await iRun.catch(() => {});
}

{
  // §3.2's hard error. A hostile server serves a different offer entirely.
  const s = await freshOffer();
  const hostile = createApi({
    baseUrl: BASE,
    timeoutMs: 20000,
    fetchImpl: async (url, init) => {
      const res = await fetch(url, init);
      if (!/\/api\/pair\/[^/]+$/.test(String(url))) return res;
      const body = await res.json();
      body.commit = b64uEncode(randomBytes(32));
      return new Response(JSON.stringify(body), { status: res.status, headers: res.headers });
    },
  });
  await expectFailure(
    flow.join({ api: hostile, link: pairing.buildLink(ORIGIN, s.linkSecret), storage: memStorage() }),
    "offer_unverified",
    "a substituted offer"
  );
  await api.del(s.idPath);
}

{
  await expectFailure(
    flow.join({ api, link: `${ORIGIN}/c`, storage: memStorage() }),
    "link_malformed",
    "a link whose fragment was stripped in transit"
  );
}

// ---------------------------------------------------------------- §3.4.1

section("§3.4.1 — abandonment and survivable state");

{
  const store = memStorage();
  let link;
  const run = flow.initiate({
    api,
    origin: ORIGIN,
    storage: store,
    onEvent: (e) => e.type === "link" && (link = e.link),
  });
  // Let the offer land, then walk away from it as a user closing the tab would.
  while (!link) await new Promise((r) => setTimeout(r, 25));

  const record = await flow.loadInFlight(store);
  check("the in-flight record survives being read back", record?.role === pairing.ROLE_INITIATOR);
  equal(
    "and it is the same link secret",
    hex(record.linkSecret),
    hex(pairing.parseLink(link))
  );

  const { pairingId } = await pairing.derivePairing(record.linkSecret);
  check("abandon() deletes the session", await flow.abandon({ api, storage: store }));
  check("and clears the record", (await flow.loadInFlight(store)) === null);
  check("and the Web Storage double is empty, not merely overwritten", store.size === 0);

  let gone = false;
  try {
    await api.get(`/api/pair/${b64uEncode(pairingId)}`);
  } catch (err) {
    gone = err?.status === 404;
  }
  check("so the link is dead rather than claimable for ten more minutes", gone);

  run.catch(() => {}); // it is still polling a session that no longer exists
}

// -------------------------------------------------------------- §3.4.1b

section("§3.4.1b — the same record in a sealed store (D-134)");

{
  const store = memRecords();
  let link;
  const run = flow.initiate({
    api,
    origin: ORIGIN,
    storage: store,
    onEvent: (e) => e.type === "link" && (link = e.link),
  });
  while (!link) await new Promise((r) => setTimeout(r, 25));

  // ⭐ The point of the whole refactor: `initiate` wrote through the record
  // interface, not through `setItem`, and the value it stored is an OBJECT — which
  // is what lets `vault.conversation` seal it under `local_key` without this file
  // knowing anything about encryption.
  check("a record store is written through get/set/delete", store.size === 1);
  equal("and under §3.4.1b's key", store.keys()[0], flow.INFLIGHT_KEY);

  const record = await flow.loadInFlight(store);
  check("the record reads back with its role", record?.role === pairing.ROLE_INITIATOR);
  equal("and the same link secret", hex(record.linkSecret), hex(pairing.parseLink(link)));
  check("the private key came back whole", record.privateKey?.length === 32);
  check("and it is an expiry the client can enforce (rule 4)", typeof record.expiresAt === "number");

  // §3.4.1b rule 4: an expired record is DELETED on read, not returned. The client
  // bounds the life of the thing that leaves a claimable secret at rest, and does
  // not wait for the server to refuse.
  const stored = await store.get(flow.INFLIGHT_KEY);
  await store.set(flow.INFLIGHT_KEY, { ...stored, expires_at: Date.now() - 1 });
  check("⭐ an expired record is refused", (await flow.loadInFlight(store)) === null);
  check("⭐⭐ and deleted on the spot, not left at rest", store.size === 0);

  await flow.abandon({ api, storage: store }).catch(() => {});
  run.catch(() => {});
}

{
  // ⚠️⚠️ THE RACE 0.9.10 CREATED, ARRANGED ON PURPOSE.
  //
  // `app/app.js` documents in bold above `$("to-code")` that `flow.abandon` is
  // called BEFORE the first `await` and that the order is "the whole correctness of
  // this handler": `abandon` used to read the in-flight record on its first
  // SYNCHRONOUS line, while `initiate`'s `finally` clears that record one microtask
  // after the abort propagates. Moving the record into an async store put an `await`
  // in front of that read, so the two now race — and if the read loses, no DELETE is
  // sent and a claimable link stays alive for its whole lifetime with nobody able to
  // complete it.
  //
  // ⭐ Nothing else in this file catches it: every other check calls `abandon` on a
  // pairing that is still running, where the record is comfortably there.
  //
  // ⚠️⚠️ AND THE STORE HERE IS DELIBERATELY SLOW, WHICH IS THE WHOLE TEST. Written
  // against `memRecords()` this case passed with the fix REMOVED — a Map resolves in
  // one microtask, so `abandon`'s read is a shorter chain than the abort's rejection
  // and wins by accident. The store this record actually lives in is
  // `vault.conversation`: IndexedDB plus an AES-GCM open, which is many turns of the
  // loop. A test whose double is faster than the real thing proves the opposite of
  // what it claims. `slowRecords` models the real one and fails without the memo.
  const store = slowRecords(memRecords());
  const controller = new AbortController();
  let link;
  const run = flow.initiate({
    api,
    origin: ORIGIN,
    storage: store,
    signal: controller.signal,
    onEvent: (e) => e.type === "link" && (link = e.link),
  });
  while (!link) await new Promise((r) => setTimeout(r, 25));
  const { pairingId } = await pairing.derivePairing(pairing.parseLink(link));

  const cancelled = new Error("cancelled");
  cancelled.reason = "cancelled";
  controller.abort(cancelled);
  const deleted = flow.abandon({ api, storage: store }); // same tick, as the app does
  run.catch(() => {});

  check("⭐⭐⭐ the DELETE still goes out when the abort clears the record first", await deleted);

  let gone = false;
  try {
    await api.get(`/api/pair/${b64uEncode(pairingId)}`);
  } catch (err) {
    gone = err?.status === 404;
  }
  check("⭐⭐ so an abandoned link is dead rather than claimable for ten more minutes", gone);
}

// ------------------------------------------------- §3.4.1b rule 7, resumption

section("§3.4.1b — a pairing that outlives the browser (rule 7)");

/**
 * Start an initiator and wait until it has published a link.
 *
 * Returned unawaited on purpose: every block below needs the initiator STILL RUNNING
 * while the joiner is discarded and comes back, because a resumption that only works
 * against a counterpart who has also stopped is not the case anybody is in.
 */
async function initiatorWithLink(storage) {
  let link;
  const run = flow.initiate({
    api,
    origin: ORIGIN,
    storage,
    onEvent: (e) => e.type === "link" && (link = e.link),
  });
  run.catch(() => {});
  while (!link) await new Promise((r) => setTimeout(r, 25));
  return { run, link };
}

/** Claim, then die before the reveal — the window §3.4.1b rule 8 makes survivable. */
async function joinerDiscardedAfterClaiming(link, store) {
  const controller = new AbortController();
  const run = flow.join({
    api,
    link,
    storage: store,
    signal: controller.signal,
    onEvent: (e) => {
      if (e.type !== "claimed") return;
      // ⚠️ IN THIS ORDER. Crash first, abort second: the other way round lets the
      // `finally` win and the record is gone before the page is said to have died.
      store.crash();
      controller.abort(new Error("discarded"));
    },
  });
  await run.catch(() => {});
  store.reboot();
}

/**
 * Publish a link, then die before anything claims it — the initiator's half of the
 * same window, and the state Hannu's 2026-08-19 report starts from.
 *
 * ⚠️ SAME ORDER AS ABOVE, FOR THE SAME REASON: `crash()` before `abort()`, or
 * `initiate`'s `finally` clears the record and the block below resumes from an empty
 * store — which passes by having nothing to do.
 */
async function initiatorDiscardedAfterPublishing(storage) {
  let link;
  const controller = new AbortController();
  const run = flow.initiate({
    api,
    origin: ORIGIN,
    storage,
    signal: controller.signal,
    onEvent: (e) => e.type === "link" && (link = e.link),
  });
  run.catch(() => {});
  while (!link) await new Promise((r) => setTimeout(r, 25));
  storage.crash();
  controller.abort(new Error("discarded"));
  await run.catch(() => {});
  storage.reboot();
  return link;
}

{
  // ⭐⭐⭐ THE DEFECT, REPRODUCED AND THEN NOT REPRODUCED (2026-08-18).
  //
  // A person opened their own invite link, the tab died, and reopening the SAME link
  // told them: *"Somebody else opened this invite link before you, and that person
  // holds the secret in it. Treat the invite link as compromised and start again."*
  // Nobody else had been anywhere near it. `describeExistingClaim` verifies `mac_J`
  // on the accepted claim and concludes "a second holder of `L`" — and this device's
  // own claim carries a perfectly valid `mac_J`, made with the same
  // `pairing_mac_key`. The MAC cannot separate them; the private key still on the
  // device can, and `claimIsOurs` is that comparison.
  const iStore = memRecords();
  const jStore = crashable(memRecords());
  const { run: iRun, link } = await initiatorWithLink(iStore);

  await joinerDiscardedAfterClaiming(link, jStore);
  check("the record outlived the page, because no `finally` ran", jStore.size === 1);

  const j = await flow.join({ api, link, storage: jStore });
  const i = await iRun;
  equal("⭐⭐⭐ reopening your own claimed invite link finishes the pairing", hex(i.channelRoot), hex(j.channelRoot));
  equal("and both sides show the same digits", i.sas, j.sas);
  check("⭐⭐ no interception alarm, because nothing was intercepted", !j.tripwire.raised);
  check("the record is gone once it completes (rule 8)", jStore.size === 0);
}

{
  // The same window, entered the way the interface will enter it: not by opening the
  // link again — the person may not still have it — but from the record itself, at
  // the next unlock. §3.4.1b rule 7's resumed J "continues at §3.4".
  const iStore = memRecords();
  const jStore = crashable(memRecords());
  const { run: iRun, link } = await initiatorWithLink(iStore);

  await joinerDiscardedAfterClaiming(link, jStore);

  const events = [];
  const j = await flow.resume({ api, storage: jStore, onEvent: (e) => events.push(e.type) });
  const i = await iRun;
  check("⭐⭐ a joiner resumes from the record alone, with no link in hand", j !== null);
  equal("and derives the same channel root", hex(i.channelRoot), hex(j.channelRoot));
  equal("the resumed joiner's events", events.join(","), "claimed,revealed");
  check("the record is destroyed at §3.4, as it always was", jStore.size === 0);
}

{
  // ⭐⭐ THE INITIATOR'S SIDE, AND THE `POST` IT MUST NOT REPEAT. Rule 7: "A resumed I
  // MUST NOT `POST` the offer again. The session is CLAIMED or REVEALED, the server
  // will refuse, and a client that reads that refusal as *start over* has spent a
  // link that was still good."
  //
  // ⭐ THAT PROHIBITION IS WHAT THIS BLOCK MEASURES, not merely asserts: a resumed I
  // that re-published its offer would be answered 409 by the server, and the pairing
  // below would fail rather than agree on a root. There is no way to pass it twice.
  const iStore = crashable(memRecords());
  const jStore = memRecords();

  const link = await initiatorDiscardedAfterPublishing(iStore);
  check("the initiator's record outlived the page too", iStore.size === 1);

  // The friend opens the link while this device is still gone — which is the whole
  // point of the link surviving the tab that made it.
  const jRun = flow.join({ api, link, storage: jStore });
  const i = await flow.resume({ api, storage: iStore });
  const j = await jRun;
  check("⭐⭐ an initiator resumes and the friend never knew it had gone", i !== null);
  equal("and both sides derive the same channel root", hex(i.channelRoot), hex(j.channelRoot));
  equal("and show the same digits", i.sas, j.sas);
  check("the initiator's record is destroyed at §3.3", iStore.size === 0);
}

{
  // ⭐⭐⭐⭐ THE PERSON WHO MADE THE LINK OPENS IT THEMSELVES (Hannu, 2026-08-19).
  //
  // Reported against the deployed §3.4.1b build: *"If the initiator of the
  // conversation closed the tab and tried to get back with own invite link"* → **"Somebody
  // else opened this invite link before you… Treat the invite link as compromised."**
  //
  // ⚠️ `claimIsOurs` DOES NOT REACH THIS ONE, and that is the whole lesson of the
  // second round. The claim sitting on the server really is somebody else's — it is
  // the FRIEND'S, which is what sending them a link is for. The discriminator that
  // works here is not "whose claim is this" but **"whose LINK is this"**, and the
  // answer was already in the store: a record with role I for this same `L`.
  const iStore = crashable(memRecords());
  const jStore = memRecords();

  const link = await initiatorDiscardedAfterPublishing(iStore);
  check("the initiator's tab is gone and its record survived", iStore.size === 1);

  const jRun = flow.join({ api, link, storage: jStore });
  jRun.catch(() => {});
  // The friend claims while the initiator is still away, so the state `join` meets is
  // CLAIMED — the exact state that produced the sentence above.
  while ((await api.get(`/api/pair/${b64uEncode((await pairing.derivePairing(pairing.parseLink(link))).pairingId)}`)).state === "open") {
    await new Promise((r) => setTimeout(r, 25));
  }

  const i = await flow.join({ api, link, storage: iStore });
  const j = await jRun;
  check("⭐⭐⭐⭐ opening YOUR OWN invite link is not an interception", i !== null);
  equal("and it completes the pairing instead of refusing it", hex(i.channelRoot), hex(j.channelRoot));
  equal("with the same six digits on both sides", i.sas, j.sas);
  check("⭐⭐ and no alarm was raised at the person who made the link", !j.tripwire.raised);
  check("the record is destroyed at §3.3 (rule 8)", iStore.size === 0);
}

{
  // ⭐⭐⭐ THE WORSE SIBLING, WHICH NOBODY REPORTED BECAUSE IT IS SILENT. Same act,
  // but before the friend has claimed: the old code found no joiner record, fell
  // through, and **claimed its own offer** — rule 7's "Neither re-creates nor
  // re-claims", broken in the direction that leaves no error on screen. The I record
  // was then overwritten with a J one, destroying the only private key matching the
  // published commitment, so neither side could ever finish.
  //
  // ⭐ The assertion is on the RECORD, not on a message, because there was never a
  // message. What went wrong was a state change nobody was told about.
  const iStore = crashable(memRecords());
  const link = await initiatorDiscardedAfterPublishing(iStore);
  const before = await iStore.get(flow.INFLIGHT_KEY);
  equal("the record is the initiator's", before.role, pairing.ROLE_INITIATOR);

  // It must not COMPLETE here — nobody has claimed — so it is left waiting and cut
  // off, and what the record says afterwards is the measurement.
  const controller = new AbortController();
  const rejoin = flow.join({ api, link, storage: iStore, signal: controller.signal });
  rejoin.catch(() => {});
  await new Promise((r) => setTimeout(r, 2500));
  iStore.crash();
  controller.abort(new Error("stop"));
  await rejoin.catch(() => {});
  iStore.reboot();

  const after = await iStore.get(flow.INFLIGHT_KEY);
  equal("⭐⭐⭐ it stays the initiator's rather than claiming its own offer", after.role, pairing.ROLE_INITIATOR);
  // ⭐ `priv`, not `l`: the link secret surviving proves only that the record was not
  // replaced wholesale. The PRIVATE KEY is the thing a claim would have regenerated,
  // and it is the half that matches the commitment already published to the friend.
  equal("and the private key matching the published commitment is untouched", after.priv, before.priv);
  await flow.abandon({ api, storage: iStore }).catch(() => {});
}

{
  check(
    "resuming with nothing in the store is not an error, it is `null`",
    (await flow.resume({ api, storage: memRecords() })) === null
  );

  // Rule 4 again, on the resumption path: an expired record is not something to
  // resume from, and reading it deletes it rather than returning it.
  const store = memRecords();
  const { link } = await initiatorWithLink(store);
  const rec = await store.get(flow.INFLIGHT_KEY);
  await store.set(flow.INFLIGHT_KEY, { ...rec, expires_at: Date.now() - 1 });
  check("⭐ an expired record is not resumable (rule 4)", (await flow.resume({ api, storage: store })) === null);
  check("and is deleted rather than left at rest", store.size === 0);
  await api.del(`/api/pair/${b64uEncode((await pairing.derivePairing(pairing.parseLink(link))).pairingId)}`).catch(() => {});
}

{
  // ⚠️⚠️ THE SAFETY HALF, AND IT IS THE ONE THAT MATTERS. Everything above makes an
  // alarm stop firing; this makes sure the change did not make it stop firing when it
  // SHOULD. A record on this device is not a licence to trust whatever claim the
  // server is holding — only a claim carrying THIS DEVICE'S key is its own.
  //
  // ⚠️ THE ROUTE TO THIS STATE IS ARRANGED AND THE STATE ITSELF IS NOT. Getting a
  // device to hold a record for a link whose accepted claim is somebody else's needs
  // the two events in an order a single run cannot be made to produce reliably, so
  // the session is re-published on the same `L` and a second holder claims it. What
  // `join` then sees — a valid `mac_J` over a key this device does not hold — is
  // exactly §3.5's case, byte for byte.
  const iStore = memRecords();
  const jStore = crashable(memRecords());
  const { run: iRun, link } = await initiatorWithLink(iStore);
  const linkSecret = pairing.parseLink(link);
  const { pairingId, macKey } = await pairing.derivePairing(linkSecret);
  const idPath = `/api/pair/${b64uEncode(pairingId)}`;
  // ⚠️ §3.2's ROUTE, NOT §3.3's. `commit` is on the OFFER; `/status` carries the two
  // keys and never the commitment, so reading it here built a claim over `undefined`
  // — which threw inside the hook, left the record uncrashed, and turned the check
  // below into one that could not have passed.
  const { commit: commitB64 } = await api.get(idPath);
  // ⚠️ DECODED. The route serves base64url and `buildClaim` MACs raw bytes; a string
  // handed to it produces a claim the server refuses, the hook throws inside
  // `saveInFlight`'s catch, and the record is left for `join`'s `finally` to delete —
  // a premise that quietly fails to be arranged rather than an error anybody sees.
  const commit = b64uDecodeExact(commitB64, 32, "commit_I");

  /*
   * ⚠️⚠️ THE ARRANGEMENT CHANGED ON 2026-09-01. THE PROPERTY DID NOT.
   *
   * It used to delete the session and re-publish the offer on the same `L`, so that a
   * second holder could claim it. `migrations/005` (D-181) made that impossible: a
   * delete on a CLAIMED row is now a tombstone, so the re-publish came back
   * `409 already_exists` and this file has crashed here since D-181 shipped. Nobody
   * saw it, because `e2e.sh` was not in the list run before a push.
   *
   * ⭐ AND THE ROUTE THAT REPLACES IT IS THE ONE REALITY USES, which the old one never
   * was. §3.4.1b rule 7 has J save its record BEFORE it claims — so an interception
   * that lands in that window leaves exactly the state this block needs: a device
   * holding a record for a link whose accepted claim belongs to somebody else. The
   * store is the test's own, so hooking the write that opens the window is enough; no
   * timing, no abort, no second offer.
   *
   * ⚠️ `crash()` INSIDE THE HOOK, NOT AFTER. `join` clears the record in a `finally`,
   * and the `finally` runs when the 409 below turns into a thrown `already_claimed`.
   * Crashing the store first is what makes the record outlive the attempt — which is
   * the whole premise, and without it the check under this would find an empty store
   * and pass by having nothing to look at.
   */
  const write = jStore.set;
  let armed = true;
  jStore.set = async (k, v) => {
    await write(k, v);
    if (!armed) return;
    armed = false;
    const attacker = await x25519.generateKeyPair();
    await api.post(`${idPath}/claim`, await pairing.buildClaim(macKey, attacker.publicKey, commit));
    jStore.crash();
  };
  await flow.join({ api, link, storage: jStore }).catch(() => {});
  jStore.set = write;
  jStore.reboot();
  check("this device holds a record for the link", jStore.size === 1);

  await expectFailure(
    flow.join({ api, link, storage: jStore }),
    "already_claimed",
    "⭐⭐⭐ a claim that is NOT this device's own still raises §3.5's alarm"
  );
  await iRun.catch(() => {});
  await api.del(idPath).catch(() => {});
}

// -------------------------------------- §3.4.1b rule 10, for the three writes

/**
 * An `api` whose POSTs to a matching path fail the way a phone on a train fails.
 *
 * ⚠️⚠️ THE TWO FAILURES ARE DIFFERENT AND THE CLIENT CANNOT TELL THEM APART. That is
 * the entire problem 0.9.20 is about, so the harness has to be able to produce both:
 *
 *   `delivered: false`   the request never left — nothing landed, a retry is free
 *   `delivered: true`    it landed, and the ANSWER was lost — a blind retry sends a
 *                        second claim, which is §3.5's alarm at the user themselves
 *
 * ⚠️ `sent` COUNTS THE MATCHED PATH ONLY, AND THE FIRST DRAFT OF THIS COUNTED EVERY
 * POST THE SIDE MADE. The initiator posts a create AND a reveal, so "published exactly
 * once" read 2 and looked exactly like the product writing twice. It was the instrument.
 * A count that spans two endpoints cannot answer a question about one of them.
 *
 * `before` fires once, immediately before the first matched request goes out: the way
 * to put something on the server INSIDE the window a retry is supposed to survive.
 */
function lossyPost(inner, match, { times = 1, delivered = true, before = null } = {}) {
  let left = times;
  let armed = before;
  const counts = { sent: 0, dropped: 0 };
  return {
    ...inner,
    counts,
    post: async (path, body, opts) => {
      if (!match(path)) return await inner.post(path, body, opts);
      if (armed) {
        const run = armed;
        armed = null;
        await run();
      }
      if (left > 0) {
        left--;
        if (!delivered) {
          counts.dropped++;
          throw new NetworkError(`POST ${path}: never left`);
        }
        counts.sent++;
        // ⚠️ COUNTED AFTER, NOT BEFORE. A request the server REFUSES has not lost its
        // answer — it got one. Counting the arming rather than the loss made the
        // stranger test read as a dropped 409, which is a thing that cannot happen.
        await inner.post(path, body, opts);
        counts.dropped++;
        throw new NetworkError(`POST ${path}: answer lost`);
      }
      counts.sent++;
      return await inner.post(path, body, opts);
    },
  };
}

/** Run one whole pairing, with either side's `api` swapped for a lossy one. */
async function pairThrough({ iApi = api, jApi = api } = {}) {
  const iStore = memStorage();
  const jStore = memStorage();
  let resolveLink;
  const linkReady = new Promise((r) => (resolveLink = r));
  const iRun = flow.initiate({
    api: iApi,
    origin: ORIGIN,
    storage: iStore,
    onEvent: (e) => e.type === "link" && resolveLink(e.link),
  });
  const link = await linkReady;
  const jRun = flow.join({ api: jApi, link, storage: jStore });
  const [i, j] = await Promise.all([iRun, jRun]);
  return { i, j, iStore, jStore };
}

const isCreate = (p) => /^\/api\/pair\/[^/]+$/.test(p);

section("§3.4.1b rule 10 — a write whose answer was lost (0.9.20)");

{
  // ⭐⭐⭐ THE CASE THE OLD 409 HANDLER COULD NOT SEE. It asked whether the claim on the
  // server matched the record this call was ENTERED with, and a first-time joiner has
  // no record at all — so the check was skipped and §3.5's alarm fired at a person
  // whose pairing was fine. Nothing here holds a prior record: `memStorage()` is empty,
  // which is the whole point of the arrangement.
  const jApi = lossyPost(api, (p) => p.endsWith("/claim"), { times: 3 });
  const { i, j } = await pairThrough({ jApi });

  equal("both sides still derive the same channel root", hex(i.channelRoot), hex(j.channelRoot));
  equal("both sides still show the same six digits", i.sas, j.sas);
  check("⭐⭐⭐ no tripwire — the recovered claim is not read as a second holder of `L`", !i.tripwire.raised && !j.tripwire.raised);
  // ⚠️⚠️ THE SAFETY ASSERTION. Three losses were armed and only ONE claim reached the
  // server: the second attempt asked whether its own `J_pub` was already there, found
  // it, and never sent. A recovery that spends the CAS twice has fired the alarm.
  equal("⭐⭐ the CAS was spent exactly once, over three armed failures", jApi.counts.sent, 1);
  check("and the loss really happened", jApi.counts.dropped === 1);
}

{
  // The other failure: the request never left the phone. Here the retry is the thing
  // that saves it — the ownership check answers "not landed" and a second claim IS
  // sent, which is correct and is what rule 10 asked for in the first place.
  const jApi = lossyPost(api, (p) => p.endsWith("/claim"), { times: 2, delivered: false });
  const { i, j } = await pairThrough({ jApi });

  equal("a claim that never left is retried until it does", hex(i.channelRoot), hex(j.channelRoot));
  equal("and it took two dropped attempts to get there", jApi.counts.dropped, 2);
  equal("the claim that finally landed is the only one", jApi.counts.sent, 1);
  check("no tripwire", !i.tripwire.raised && !j.tripwire.raised);
}

{
  // §3.1. `POST {id}` is not on the alarm path, but it is on the same ladder: a lost
  // answer here used to end the pairing before the link had even been shown.
  const iApi = lossyPost(api, isCreate, { times: 2 });
  const { i, j } = await pairThrough({ iApi });

  equal("a create whose answer was lost still pairs (§3.1)", hex(i.channelRoot), hex(j.channelRoot));
  // ⚠️ The commitment the server serves back is `SHA-256(i_pub)` for a key made in
  // this call, so a session standing under it is this device's own first attempt.
  equal("⭐⭐ and the offer was published exactly once", iApi.counts.sent, 1);
}

{
  // §3.3. The reveal already refused to re-send when it could see its own `i_pub` in a
  // status it had ALREADY fetched; 0.9.20 is the same question asked between attempts.
  const iApi = lossyPost(api, (p) => p.endsWith("/reveal"), { times: 2 });
  const { i, j } = await pairThrough({ iApi });

  equal("a reveal whose answer was lost still pairs (§3.3)", hex(i.channelRoot), hex(j.channelRoot));
  equal("⭐⭐ and `i_pub` was published exactly once", iApi.counts.sent, 1);
  check("the joiner still opens the commitment", !j.tripwire.raised);
}

{
  // ⚠️⚠️ THE SAFETY HALF, AND IT IS THE ONE THAT MATTERS. Everything above makes the
  // alarm stop firing at the user; this makes sure the ownership check cannot swallow a
  // REAL one. §3.2's read says `open`, and a stranger claims in the window between that
  // read and this device's POST — so the 409 arrives at the retry, which is the one
  // place 0.9.20 added. The answer to "is it mine?" must be no, and it must be no on
  // every one of the three attempts, not just the first.
  const { run: iRun, link } = await initiatorWithLink(memRecords());
  // ⚠️ THE LIVE SESSION, NOT A FRESH ONE. `freshOffer` would publish a second offer on
  // the same `L` and be refused — and the window this test is about only exists on a
  // session that is genuinely `open` when the joiner reads it. `commit` comes off the
  // wire because the stranger, like any holder of `L`, has to read it the same way.
  const { pairingId, macKey } = await pairing.derivePairing(pairing.parseLink(link));
  const idPath = `/api/pair/${b64uEncode(pairingId)}`;
  const commit = b64uDecodeExact((await api.get(idPath)).commit, 32, "commit");
  const stranger = await x25519.generateKeyPair();

  const jApi = lossyPost(api, (p) => p.endsWith("/claim"), {
    times: 3,
    before: async () => {
      await api.post(`${idPath}/claim`, await pairing.buildClaim(macKey, stranger.publicKey, commit));
    },
  });

  await expectFailure(
    flow.join({ api: jApi, link, storage: memStorage() }),
    "already_claimed",
    "⭐⭐⭐ a stranger's claim inside the retry window still raises §3.5's alarm"
  );
  check("nothing was lost — the server answered, and it said no", jApi.counts.dropped === 0);
  equal("⭐⭐ and the refusal was surfaced rather than retried", jApi.counts.sent, 1);
  await iRun.catch(() => {});
  await api.del(idPath).catch(() => {});
}

done();
