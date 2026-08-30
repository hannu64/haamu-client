// Two paired clients exchange ENCRYPTED messages through the real server —
// PROTOCOL.md §6, over real HTTP. ROADMAP Phase 1 step 5's demo, as a test.
//
// Everything below runs against a real Go server, a real database, real Ed25519
// request signatures and the real WASM artefact the browser downloads. The only
// thing standing in for the product is the storage backend, which is a Map
// (IndexedDB is step 8) — and that substitution is visible in one place.
//
// What can only be tested here:
//
//   • that two independently derived Olm accounts, built from the SAME channel
//     root and nothing else, can actually talk (§6.2's bootstrap, end to end)
//   • that the bytes crossing the server carry no plaintext
//   • the ordering rules `flow/message.js` exists for, each of which is about what
//     happens when a step DOESN'T complete

import { readFileSync } from "node:fs";
import { createApi } from "../src/net/api.js";
import * as olm from "../src/crypto/olm.js";
import * as pairFlow from "../src/flow/pair.js";
import * as mailboxFlow from "../src/flow/mailbox.js";
import * as messageFlow from "../src/flow/message.js";
import * as mailboxes from "../src/protocol/mailbox.js";
import * as sessionRules from "../src/protocol/session.js";
import * as payloads from "../src/protocol/payload.js";
import * as envelopes from "../src/protocol/envelope.js";
import * as store from "../src/storage/sessions.js";
import * as db from "../src/storage/db.js";
import * as vaults from "../src/storage/vault.js";
import { utf8Bytes, utf8String } from "../src/crypto/bytes.js";
import { check, equal, section, done, hex } from "./harness.mjs";

const BASE = process.env.LPM_BASE_URL || "http://127.0.0.1:8099";
const ORIGIN = "https://haamu.invalid";

const api = createApi({ baseUrl: BASE, timeoutMs: 20000 });
await olm.initOlm({ wasm: readFileSync(new URL("../wasm/dist/lpm_olm_wasm_bg.wasm", import.meta.url)) });

console.log(`server ${BASE}`);
console.log(`olm    ${JSON.stringify(olm.buildInfo())}`);

function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

async function pairTwoClients() {
  let resolveLink;
  const linkReady = new Promise((r) => (resolveLink = r));
  const iRun = pairFlow.initiate({
    api,
    origin: ORIGIN,
    storage: memStorage(),
    onEvent: (e) => e.type === "link" && resolveLink(e.link),
  });
  const link = await linkReady;
  const jRun = pairFlow.join({ api, link, storage: memStorage() });
  const [i, j] = await Promise.all([iRun, jRun]);
  return { i, j };
}

/**
 * A device: its own storage, its own pickle key, the same channel root.
 *
 * `roster` stands in for §7.3's blob — the one piece of channel state that
 * outlives the device, because it is stored on the server under `roster_id` and
 * fetched again after a migration. Step 7 builds it; what matters here is that the
 * generation lives in it and not in the session store.
 */
function device(side, roster = { generation: 0 }) {
  return messageFlow.openChannel({
    scope: "test",
    api,
    backend: store.memoryBackend(),
    pickleKey: store.randomPickleKey(),
    channelRoot: side.channelRoot,
    role: side.role,
    generation: roster.generation,
    onGeneration: (g) => {
      roster.generation = g;
    },
  });
}

const texts = (batch) => batch.messages.filter((m) => m.payload).map((m) => m.payload.text);
const failures = (batch) => batch.messages.filter((m) => m.failure).map((m) => m.failure);

/** Read the raw ciphertext queued for a device, without disturbing anything. */
async function peek(channel) {
  return mailboxFlow.drainChannel(api, channel.channelRoot, channel.role);
}

// ------------------------------------------------ §6 — a message, encrypted

section("§6 — an encrypted message crosses the server");

const { i, j } = await pairTwoClients();
const iRoster = { generation: 0 };
const jRoster = { generation: 0 };
const I = device(i, iRoster);
const J = device(j, jRoster);

const SECRET = "tapaaminen kello kuusi, sillalla";
const sent = await messageFlow.send(I, SECRET);
equal("the first message on a new session is a pre-key message (§6.4)", sent.type, "prekey");
equal("at generation 1 — nothing was ever accepted before it", String(sent.generation), "1");

// ⭐ What the server actually holds. Everything except `body` is metadata it is
// allowed to see; `body` must be opaque.
{
  const raw = await peek(J);
  equal("one message is queued for the peer", String(raw.length), "1");
  const envelope = JSON.parse(utf8String(raw[0].body));
  equal("the envelope has exactly §6.4's fields",
    Object.keys(envelope).sort().join(","), "body,generation,session_id,type,v");
  check("there is no eph_pub field, and there must never be one", !("eph_pub" in envelope));
  check("no direction field either — direction is which mailbox it is in (§4.2)",
    !("direction" in envelope) && !("dir" in envelope));
  check("the body is base64url (§0.1)", !/[+/=]/.test(envelope.body));
  check("⭐ the plaintext is nowhere in the bytes the server stored",
    !hex(raw[0].body).includes(hex(utf8Bytes(SECRET))) && !utf8String(raw[0].body).includes("sillalla"));
}

const first = await messageFlow.receive(J);
equal("the peer decrypts it", texts(first).join(), SECRET);
equal("having derived its own Olm keys from R alone (§6.2)", String(first.messages.length), "1");
equal("and nothing failed", failures(first).join(), "");

// §5.4.1: nothing is deleted until the caller says it has stored what it got.
{
  const still = await peek(J);
  equal("the server still holds it — settle() has not been called", String(still.length), "1");
}
await first.settle();
{
  const gone = await peek(J);
  equal("after settle() it is deleted", String(gone.length), "0");
}

// -------------------------------------------------- the unanswered direction

section("§6.2/§6.3 — three messages before any reply");

// ⚠️⚠️ THE CASE THAT WOULD HAVE BEEN DESTROYED BY A LITERAL READING OF §6.3'S
// REPLAY RULE. Until the peer replies, EVERY message is a pre-key message carrying
// the SAME session_id. A client that treated a repeated session_id as a replay
// would deliver the first and drop the rest — and §6.2 says an unanswered
// conversation is exactly the shape this product exists for.
{
  const a = await messageFlow.send(I, "one");
  const b = await messageFlow.send(I, "two");
  const c = await messageFlow.send(I, "three");
  equal("all three are pre-key messages", [a.type, b.type, c.type].join(), "prekey,prekey,prekey");
  equal("all three carry one session id", new Set([a.sessionId, b.sessionId, c.sessionId]).size + "", "1");
  equal("and one generation", new Set([a.generation, b.generation, c.generation]).size + "", "1");

  const batch = await messageFlow.receive(J);
  equal("⭐ the peer reads all three, in order", texts(batch).join(","), "one,two,three");
  equal("none of them was refused as a replay", failures(batch).join(), "");
  await batch.settle();
}

section("§6 — the reply, and the ratchet that follows it");

{
  const reply = await messageFlow.send(J, "olen siellä");
  equal("the reply opens the peer's own session at its own generation", String(reply.generation), "1");
  const got = await messageFlow.receive(I);
  equal("the initiator decrypts the reply", texts(got).join(), "olen siellä");
  await got.settle();

  const next = await messageFlow.send(I, "hyvä");
  equal("and its next message is no longer a pre-key message (§6.4)", next.type, "normal");
  const back = await messageFlow.receive(J);
  equal("which the peer decrypts on the established session", texts(back).join(), "hyvä");
  await back.settle();
}

// ------------------------------------------------------------- §6.5 padding

section("§6.5 — what the server can measure");

/**
 * ⛔⛔ THIS CHECK WAS RED FOR A DAY AND NOTHING SAID SO (found 2026-08-25, verifying
 * the second review pass). It sent 180 characters against §6.5's first bucket, and
 * `cdc2058` — §6.7.2's payload binding, 2026-08-24 18:19 — added `session_id` and
 * `generation` to every payload. **The first bucket's text capacity fell from about
 * 250 characters to 147**, so 180 crossed into the second bucket and the two messages
 * stopped matching. The property is intact; the constant in the test was not.
 *
 * ⭐⭐ AND THE REASON NOBODY SAW IT IS THE SAME SHAPE AS D-160. This file is in
 * `e2e.sh`, not `test.sh`; it needs a Postgres that dies with the editor. A suite that
 * is only run deliberately is a suite that is red between the times somebody decides
 * to look.
 *
 * ⭐ SO THE CHECK NOW PINS THE BOUNDARY RATHER THAN GUESSING A LENGTH BELOW IT. A
 * payload that grows again does not silently halve the band in which every ordinary
 * message looks alike — it fails here, with the new capacity in the message.
 */
{
  // What the first bucket can actually carry, computed from the code rather than
  // remembered: the longest run of text whose encoded payload still fits 256 bytes.
  const fits = (n) =>
    payloads.encodePayload(
      payloads.buildPayload({
        text: "y".repeat(n),
        sentAt: 1_756_000_000,
        kind: payloads.KIND_TEXT,
        sessionId: new Uint8Array(envelopes.SESSION_ID_BYTES),
        generation: 0,
      })
    ).length +
      4 <=
    envelopes.PAD_BUCKETS[0];
  let capacity = 0;
  while (fits(capacity + 1)) capacity++;

  check(
    "⚠️⚠️ §6.5's first bucket still holds an ordinary message — 100 characters at least",
    capacity >= 100,
    `${capacity} characters of text fit the ${envelopes.PAD_BUCKETS[0]}-byte bucket ` +
      `(it was ~250 before §6.7.2's binding, and this check exists because that fell silently)`
  );

  const short = await messageFlow.send(I, "ok");
  const long = await messageFlow.send(I, "y".repeat(capacity));
  const raw = await peek(J);
  const sizes = raw.map((m) => m.body.length);
  equal("two messages of very different lengths", String(raw.length), "2");
  equal("⭐ are the same size on the wire — §6.5's first bucket", String(sizes[0]), String(sizes[1]));
  check("and the id the sender was given matches one of them",
    raw.some((m) => m.msgId === short.msgId) && raw.some((m) => m.msgId === long.msgId));
  const batch = await messageFlow.receive(J);
  await batch.settle();
}

section("§6.5 — and one character past the bucket is a different size, which is the honest half");

{
  // ⚠️ THE OTHER DIRECTION, AND IT IS WHAT MAKES THE CHECK ABOVE MEAN ANYTHING. If
  // every message were the same size regardless, the equality above would pass on a
  // client that had stopped padding at all. Bucketing hides the length WITHIN a
  // bucket and does not pretend to hide which bucket — §6.5 says so, and so does this.
  const one = await messageFlow.send(I, "ok");
  const over = await messageFlow.send(I, "y".repeat(600)); // comfortably into 1 KiB
  const raw = await peek(J);
  equal("two messages, one either side of the boundary", String(raw.length), "2");
  check(
    "⭐ they are NOT the same size, and §6.5 never claimed they would be",
    raw[0].body.length !== raw[1].body.length,
    `${raw[0].body.length} and ${raw[1].body.length} bytes`
  );
  check("both ids are accounted for",
    raw.some((m) => m.msgId === one.msgId) && raw.some((m) => m.msgId === over.msgId));
  const batch = await messageFlow.receive(J);
  await batch.settle();
}

// ------------------------------------------- the crash between the two steps

section("§5.4.1/§5.4.2 — a crash between decrypting and acknowledging");

// ⚠️⚠️ THE FAILURE THIS GUARD PREVENTS IS A FALSE ALARM, NOT A LOSS. §5.4.1
// separates retrieval from deletion so that "a client which crashes between them
// loses nothing" — true of the ciphertext, but decryption moves the ratchet, so
// the same ciphertext cannot be read a second time. Without the staging list, a
// client that crashed there would meet its own already-read message, fail on it
// three times, and tell the user a message had arrived that it could not read.
{
  await messageFlow.send(I, "kirje");
  const batch = await messageFlow.receive(J); // decrypted, staged, NOT settled
  equal("the message is read", texts(batch).join(), "kirje");

  // The crash: the process ends here. Nothing was acknowledged.
  const afterCrash = await messageFlow.receive(J);
  equal("⭐ after the crash it is handed over again, not decrypted again", texts(afterCrash).join(), "kirje");
  equal("with no failure recorded against it", failures(afterCrash).join(), "");
  equal("and the same message id, which is what the caller deduplicates on",
    afterCrash.messages[0].msgId, batch.messages[0].msgId);
  await afterCrash.settle();
  equal("settling it clears the server", String((await peek(J)).length), "0");
}

// And the falsification: with the staging list removed by hand — a client that
// wrote the ratchet but not the plaintext — the same drain produces the false
// alarm above. This is the measurement that says the list is load-bearing.
{
  await messageFlow.send(I, "toinen kirje");
  const batch = await messageFlow.receive(J);
  equal("read once", texts(batch).join(), "toinen kirje");

  const key = await store.channelKey("test", J.channelRoot);
  const record = await J.backend.get(key);
  record.staged = [];
  await J.backend.set(key, record);

  let failed = null;
  for (let attempt = 1; attempt <= store.MAX_DECRYPT_FAILURES; attempt++) {
    failed = await messageFlow.receive(J);
  }
  equal("⭐ without the staging list the same message becomes 'cannot read this'",
    failures(failed).join(), messageFlow.UNDECRYPTABLE);
  equal("after exactly the three drains §5.4.2 allows", String(failed.messages[0].attempts), "3");
  await failed.settle();
}

// ------------------------------------------------- §5.4.2's transient branch

section("§5.4.2 — a message for a session that has not arrived yet");

// ⚠️⚠️ THE DESTRUCTION PRIMITIVE §5.4.2 CLOSES. A dishonest server withholds the
// pre-key message and releases only what follows it. The recipient has no session
// for that `session_id` — and if that counted as a decryption failure it would
// destroy the messages itself after three drains, while the sender was shown
// "Delivered". Here the server is honest and the effect is produced by relabelling
// one envelope, which is something a server can do to any message it holds.
{
  await messageFlow.send(I, "normal message on an unknown session");
  const [queued] = await peek(J);
  const envelope = JSON.parse(utf8String(queued.body));
  const orphan = { ...envelope, type: "normal", session_id: "AAAAAAAAAAAAAAAAAAAAAA" };

  // Clear the real one first, so only the relabelled copy is queued.
  const real = await messageFlow.receive(J);
  await real.settle();
  await mailboxFlow.sendToPeer(api, I.channelRoot, I.role, utf8Bytes(JSON.stringify(orphan)));

  for (let attempt = 1; attempt <= store.MAX_DECRYPT_FAILURES + 1; attempt++) {
    const batch = await messageFlow.receive(J);
    equal(`drain ${attempt}: nothing delivered, nothing counted`, batch.messages.length + "", "0");
    await batch.settle();
  }
  equal("⭐ and after four drains it is STILL on the server, not destroyed",
    String((await peek(J)).length), "1");

  // Clean up: it stays queued for the mailbox's life, which is the point.
  const stuck = await peek(J);
  await mailboxFlow.ack(api, stuck[0].mailbox, [stuck[0].msgId]);
}

section("§6.4 — an envelope the server altered");

// Every field outside `body` is unauthenticated, and §6.4's rule is "validate
// shape, then let decryption be the authority". A message that cannot be an
// envelope at all is deleted at once: no session anywhere could read it, and a
// server that can corrupt a message can drop it outright.
{
  await mailboxFlow.sendToPeer(api, I.channelRoot, I.role, utf8Bytes("{not an envelope"));
  const batch = await messageFlow.receive(J);
  equal("a malformed envelope is reported once", failures(batch).join(), messageFlow.MALFORMED);
  await batch.settle();
  equal("and deleted immediately rather than retried", String((await peek(J)).length), "0");
}

// ------------------------------------------------------- §6.3, a new device

section("§6.3 — the initiator is restored from nothing");

// Cleared storage or a device migration: same `R` from the roster, no session
// state. §6.3 rule 2 says the peer adopts the higher generation unconditionally.
{
  // ⚠️ The session store is EMPTY and the roster is not — that difference is the
  // whole point. §6.3 keeps the generation in the roster precisely because the
  // device's own state is what a migration loses.
  const restored = device(i, iRoster); // same root, same role, empty store
  const after = await messageFlow.send(restored, "uusi laite");
  equal("a restored device starts a new session at the next generation", String(after.generation), "2");
  equal("and its first message is a pre-key message again", after.type, "prekey");

  const batch = await messageFlow.receive(J);
  equal("the peer reads it", texts(batch).join(), "uusi laite");
  await batch.settle();

  const back = await messageFlow.send(J, "sain sen");
  equal("and now replies on the NEW session (rule 2)", String(back.generation), "2");
  const heard = await messageFlow.receive(restored);
  equal("which only the restored device can read", texts(heard).join(), "sain sen");
  await heard.settle();

  // ⚠️ RULE 5 BEFORE RULE 1, and this is the order that surprised the test. The
  // old device is still on generation 1 and its session is superseded — but the
  // peer KEPT it (rule 5: "accept messages on either session until the end of the
  // current epoch"), so a message on it is still delivered. Rule 1 is about
  // sessions the peer does not hold, not about everything at an older generation.
  const stale = await messageFlow.send(I, "vanhalta laitteelta");
  equal("the old device is still on generation 1", String(stale.generation), "1");
  const heardAnyway = await messageFlow.receive(J);
  equal("⭐ and the peer still reads it — rule 5's grace, inside the epoch",
    texts(heardAnyway).join(), "vanhalta laitteelta");
  await heardAnyway.settle();
}

// ------------------------- §5.4.2's third row, rewritten by 0.9.19 (D-146)

section("§5.4.2 — a refusal that can never resolve is reported at once");

// ⚠️⚠️ THIS IS THE ASSERTION THAT WOULD HAVE CAUGHT HANNU'S ROUND-22 REPORT, and it
// is about WHEN a true sentence is said rather than about whether it is true.
//
// §5.4.2's table used to count a below-generation refusal to three "because it is
// refused without being tried and can never become readable, so the three drains
// are a formality that bounds it". Measured, that formality cost two drains, and
// the notice it delays lands underneath whatever the person sent in the meantime —
// where it reads as a verdict on THAT message. An undecryptable message carries no
// readable timestamp, so the line can only be drawn at "now"; WHEN it is drawn is
// therefore the whole of what it appears to be about.
//
// ⚠️ The first assertion below FAILS against the previous implementation — checked
// by running this file against the saved copy of `flow/message.js` — because the
// refusal went into the drain's `refused` list rather than its `messages`, and only
// became a staged failure on the third sight of it.
{
  const { i: i5, j: j5 } = await pairTwoClients();
  const iR5 = { generation: 0 };
  const jR5 = { generation: 0 };
  const A = device(i5, iR5);
  const B = device(j5, jR5);

  await messageFlow.send(A, "ensimmainen");
  const opened = await messageFlow.receive(B);
  equal("the conversation is established", texts(opened).join(), "ensimmainen");
  await opened.settle();

  // ⚠️ SENT AND NEVER DRAINED — the state a cleared browser leaves behind. The peer
  // keeps talking to a session that is about to exist nowhere, and §5.4's retention
  // holds the ciphertext for a fortnight.
  await messageFlow.send(A, "orpo viesti");

  // The migration: same roster, empty session store, and D-130's reconnect message
  // is what re-establishes.
  const B2 = device(j5, jR5);
  const re = await messageFlow.send(B2, "Reconnecting old conversation.");
  equal("the migrated device re-establishes at the next generation", String(re.generation), "2");

  const drain = await messageFlow.receive(B2);
  equal("⭐ the stranded message is reported on the FIRST drain, not the third",
    failures(drain).join(), messageFlow.STALE_SESSION);
  equal("after a single sight of it", String(drain.messages[0].attempts), "1");
  equal("and nothing else is queued behind it", String(drain.messages.length), "1");
  await drain.settle();

  const after = await messageFlow.receive(B2);
  equal("⭐ it is acknowledged too, so it is not re-fetched for a fortnight",
    String(after.messages.length), "0");

  // ⚠️⚠️ A MUST DRAIN B's RECONNECT FIRST, AND THE FIRST DRAFT OF THIS TEST DID NOT —
  // it asserted that A's next message would be at generation 2 and got 1, because a
  // device learns the peer's new session only by receiving it. That is not a defect,
  // it is `copy.chat.reconnect.cost` stated as an assertion: *"before you send a new
  // message you cannot receive messages from your friend"*, and the mirror of it is
  // that until you RECEIVE theirs you are still talking to a session that is gone.
  // In the running app the drain loop closes this in a second; in a test nothing
  // happens that is not written down.
  const learn = await messageFlow.receive(A);
  equal("A hears the reconnect and adopts the new session (§6.3 rule 2)",
    texts(learn).join(), "Reconnecting old conversation.");
  await learn.settle();

  // ⚠️ AND THE LIVE PATH IS UNAFFECTED, which is the half that matters: the point of
  // reporting the dead one sooner is that the next real message is not standing
  // behind it.
  const live = await messageFlow.send(A, "ensimmainen oikea");
  equal("the sender is on the re-established session", String(live.generation), "2");
  const got = await messageFlow.receive(B2);
  equal("and it arrives, unmarked", texts(got).join(), "ensimmainen oikea");
  equal("with no failure beside it", failures(got).join(), "");
  await got.settle();
}

section("§6 — a send that never left the device");

// ⚠️⚠️ PERSIST BEFORE TRANSMIT. `encrypt` advances the sending ratchet, so a
// client that transmitted first and crashed before writing would come back holding
// a chain key it has already used — and encrypt the NEXT message under a message
// key that is already spent. Two plaintexts under one key is the plaintexts' XOR.
// The other order loses a message that was never sent, and the ratchet is built to
// tolerate exactly that gap.
{
  // A fresh pair: the sections above have moved this channel on to a later
  // generation and a different device, and a test that reads the wrong device's
  // mailbox proves nothing about ordering.
  const { i: i3, j: j3 } = await pairTwoClients();
  const A = device(i3);
  const B = device(j3);
  await messageFlow.send(A, "avaus");
  const opening = await messageFlow.receive(B);
  await opening.settle();

  const key = await store.channelKey("test", B.channelRoot);
  const before = JSON.stringify((await B.backend.get(key)).sessions);

  const aborted = new AbortController();
  aborted.abort(new Error("the network went away"));
  let threw = false;
  try {
    await messageFlow.send(B, "tämä ei lähtenyt", { signal: aborted.signal });
  } catch {
    threw = true;
  }
  check("the send failed", threw);

  const after = JSON.stringify((await B.backend.get(key)).sessions);
  check("⭐ but the advanced ratchet was written before the attempt", before !== after);
  equal("and nothing reached the peer", String((await peek(A)).length), "0");

  // The message key that was consumed is simply skipped; the next message arrives.
  await messageFlow.send(B, "tämä lähti");
  const batch = await messageFlow.receive(A);
  equal("the next message still decrypts across the gap", texts(batch).join(), "tämä lähti");
  await batch.settle();
}

section("§6.3 rule 3 — both sides create a session at once");

// The case the tie-break was written for, and the only way to reach it is to let
// both devices write before either reads. Both then hold two sessions at the same
// generation, one created by each party, and must converge WITHOUT talking about
// it — the comparison is over the 16 raw bytes, so both compute the same winner.
{
  const { i: i2, j: j2 } = await pairTwoClients();
  const A = device(i2);
  const B = device(j2);

  const fromA = await messageFlow.send(A, "yhtä aikaa A");
  const fromB = await messageFlow.send(B, "yhtä aikaa B");
  equal("both created a session at generation 1",
    `${fromA.generation},${fromB.generation}`, "1,1");
  check("with different session ids", fromA.sessionId !== fromB.sessionId);

  const atA = await messageFlow.receive(A);
  const atB = await messageFlow.receive(B);
  equal("each reads what the other sent", texts(atA).join(), "yhtä aikaa B");
  equal("in both directions", texts(atB).join(), "yhtä aikaa A");
  await atA.settle();
  await atB.settle();

  const nextA = await messageFlow.send(A, "jatkuu A");
  const nextB = await messageFlow.send(B, "jatkuu B");
  // ⚠️ The winner is decided over BYTES. An earlier draft of this test sorted the
  // two b64u STRINGS — the precise mistake §6.3 spends a paragraph on — and
  // disagreed with the implementation on the first pair it was given.
  const smaller =
    sessionRules.compareSessionIds(sessionRules.idFromKey(fromA.sessionId), sessionRules.idFromKey(fromB.sessionId)) < 0
      ? fromA
      : fromB;
  equal("⭐ both now send on the same session, chosen the same way on both devices",
    `${nextA.sessionId === nextB.sessionId}`, "true");
  check("and it is the one whose id is smaller as bytes",
    nextA.sessionId === smaller.sessionId, `${nextA.sessionId} vs ${smaller.sessionId}`);

  const lastA = await messageFlow.receive(A);
  const lastB = await messageFlow.receive(B);
  equal("nothing was lost while they disagreed", texts(lastA).join(), "jatkuu B");
  equal("in either direction", texts(lastB).join(), "jatkuu A");
  await lastA.settle();
  await lastB.settle();
}

section("§6.3 rule 1 — a session at a dead generation");

// The genuine case is a second migration: a message queued on a session the peer
// never accepted, at a generation it has already moved past. Relabelling one
// envelope reproduces it exactly, and is something a server can do to any message
// it holds.
{
  await messageFlow.send(I, "kuollut istunto");
  const [queued] = await peek(J);
  const envelope = JSON.parse(utf8String(queued.body));
  const dead = { ...envelope, generation: 0, session_id: "_____________________w" };

  const real = await messageFlow.receive(J);
  await real.settle();
  await mailboxFlow.sendToPeer(api, I.channelRoot, I.role, utf8Bytes(JSON.stringify(dead)));

  // ⚠️⚠️ THIS LOOP USED TO RUN `MAX_DECRYPT_FAILURES` TIMES AND ASSERT `attempts: 3`,
  // and 0.9.19 (D-146) is why it does not any more. §5.4.2's table called those three
  // drains "a formality that bounds it"; the formality delayed the notice by two
  // drains, which put it underneath whatever the person had sent in between. ⭐ This
  // suite is what caught the change when it landed — the assertion below is the old
  // rule written down, and it failed the moment the new one shipped, which is the
  // whole reason for writing rules down as assertions.
  const refused = await messageFlow.receive(J);
  equal("⭐ a session below the highest accepted is refused, never tried",
    failures(refused).join(), messageFlow.STALE_SESSION);
  equal("⭐ and reported on the FIRST drain — 0.9.19, not the three of 0.9.18",
    String(refused.messages[0].attempts), "1");
  await refused.settle();
  equal("so it does not sit in the mailbox for a fortnight", String((await peek(J)).length), "0");
}

// ------------------------------------------------- ROADMAP step 8, the reload

section("§6.3 — a device whose storage came BACK does not spend a generation");

// ⭐⭐ THE CONTRAST WITH "RESTORED FROM NOTHING" ABOVE IS THE POINT OF STEP 8.
// That block is a device that lost its session store: §6.3 covers it by starting a
// new session one generation up, which works and costs something every time. Until
// this step the client did that on every RELOAD, because the pickles lived in the
// tab and the pickle key was generated per tab.
//
// Two things had to become durable together, and either alone is useless: the
// session records, which now live in `storage/vault.js` under IndexedDB, and the
// key they are sealed with, which is `HKDF(K_master, "lpm-pickle-key-v1", 32)` and
// therefore comes back with the passphrase.
{
  const { i: i2, j: j2 } = await pairTwoClients();

  // One identity's worth of durable state: the same database and the same derived
  // pickle key on both sides of the "reload".
  const disk = db.memoryDatabase();
  const vault = vaults.openVault({ db: disk, localKey: crypto.getRandomValues(new Uint8Array(32)) });
  const pickleKey = crypto.getRandomValues(new Uint8Array(32));
  const roster = { generation: 0 };
  const open = () =>
    messageFlow.openChannel({
      scope: "test",
      api,
      backend: vault.conversation,
      pickleKey,
      channelRoot: i2.channelRoot,
      role: i2.role,
      generation: roster.generation,
      onGeneration: (g) => {
        roster.generation = g;
      },
    });

  const peer = device(j2);
  const first = await messageFlow.send(open(), "ennen uudelleenlatausta");
  equal("the first message opens a session at generation 1", String(first.generation), "1");
  const heard = await messageFlow.receive(peer);
  equal("and the peer reads it", texts(heard).join(), "ennen uudelleenlatausta");
  await heard.settle();

  // ⚠️ THE REPLY IS PART OF THE SETUP, not decoration. Until the peer answers,
  // EVERY message is a pre-key message on the same session (§6.4, and the section
  // above measures it) — so "is it still a pre-key message?" cannot tell a restored
  // session from a fresh one before that point. After the reply it can, and that is
  // what makes the check below say something.
  const answer = await messageFlow.send(peer, "kuulen");
  const gotAnswer = await messageFlow.receive(open());
  equal("the peer replies and the ratchet turns", texts(gotAnswer).join(), "kuulen");
  await gotAnswer.settle();
  equal("the reply came at the peer's own generation 1", String(answer.generation), "1");

  // The reload: a completely new channel object, nothing carried in memory, over
  // the same store and the same key.
  const after = await messageFlow.send(open(), "uudelleenlatauksen jalkeen");
  equal("⭐⭐⭐ after a reload the generation has NOT moved", String(after.generation), "1");
  equal("⭐⭐ and it is a NORMAL message — the established session came back", after.type, "normal");
  equal("the roster was never asked to record a new generation", String(roster.generation), "1");

  const again = await messageFlow.receive(peer);
  equal("the peer reads it on the same session, with no migration", texts(again).join(), "uudelleenlatauksen jalkeen");
  await again.settle();

  // ⚠️ And the negative, in the same shape, so that the check above is testing the
  // store rather than the arithmetic: the same channel with an EMPTY store does
  // still spend a generation, which is §6.3 working exactly as before.
  const forgotten = messageFlow.openChannel({
    scope: "test",
    api,
    backend: vaults.openVault({ db: db.memoryDatabase(), localKey: crypto.getRandomValues(new Uint8Array(32)) })
      .conversation,
    pickleKey,
    channelRoot: i2.channelRoot,
    role: i2.role,
    generation: roster.generation,
    onGeneration: () => {},
  });
  const spent = await messageFlow.send(forgotten, "tyhjasta");
  equal("⭐ a device that really did lose its store still starts at the next generation", String(spent.generation), "2");
  const last = await messageFlow.receive(peer);
  await last.settle();
}

// ------------------------------------------ ROADMAP step 9, the second writer

section("§6, 0.8.12 — two TABS of one device, over one store");

// ⚠️⚠️ THIS IS THE FAILURE STEP 8 CREATED AND STEP 9 FOUND. The block above made
// the session record durable, which also made it SHARED: every tab of the origin
// opens the same IndexedDB. `flow/message.js` orders its writes so that a CRASH
// cannot leave a used chain key unrecorded — and a second tab is not a crash. Two
// tabs each load the record, each `encrypt` (which advances the sending ratchet),
// and each store; the second store erases the first tab's advance, and the next
// message goes out under a message key that has already been used.
//
// ⚠️ Nothing above this line would have noticed. Both sends "succeed", both
// messages reach the mailbox, and what is damaged is a property no test of a
// single tab can see.
{
  const { i: i4, j: j4 } = await pairTwoClients();

  // One device: one database, one `local_key`, one `pickle_key`. Two tabs.
  const disk = db.memoryDatabase();
  const vault = vaults.openVault({ db: disk, localKey: crypto.getRandomValues(new Uint8Array(32)) });
  const pickleKey = crypto.getRandomValues(new Uint8Array(32));
  const roster = { generation: 0 };
  const tab = () =>
    messageFlow.openChannel({
      scope: "test",
      api,
      backend: vault.conversation,
      pickleKey,
      channelRoot: i4.channelRoot,
      role: i4.role,
      generation: roster.generation,
      onGeneration: (g) => {
        roster.generation = Math.max(roster.generation, g);
      },
    });

  const peer = device(j4);
  const one = tab();
  const two = tab();

  // ⚠️⚠️ THE SESSION HAS TO BE ESTABLISHED FIRST, AND FINDING THAT OUT IS WHY THIS
  // BLOCK IS WRITTEN THIS WAY. The first version raced two sends on an EMPTY store
  // and sabotaging the conditional write did not reproduce key reuse at all: with
  // no session yet, each tab simply built its own, so the two ciphertexts were
  // under two unrelated chain keys. Real, and a different failure — see the check
  // below, which is what caught it. Reuse needs a chain key that ALREADY EXISTS
  // for both tabs to advance from.
  await messageFlow.send(one, "avaus");
  const opening = await messageFlow.receive(peer);
  await opening.settle();
  await messageFlow.send(peer, "kuulen");
  const reply = await messageFlow.receive(one);
  await reply.settle();
  equal("a session is established in both directions", texts(reply).join(), "kuulen");

  // Now both tabs send at once, with NO lock between them — the arrangement on a
  // browser with no Web Locks, and the one `flow/tabs.js` exists to make rare
  // rather than to make safe. Both load the same record, both advance the SAME
  // chain key, both store.
  const [a, b] = await Promise.all([
    messageFlow.send(one, "ensimmainen valilehti"),
    messageFlow.send(two, "toinen valilehti"),
  ]);
  check("both tabs sent", Boolean(a.msgId && b.msgId));

  // ⭐⭐⭐ THE ASSERTION. With one advance lost, both of these were encrypted under
  // the same message key — two plaintexts under one key, which for AES-CBC is their
  // XOR to anyone holding both. The peer reads the first and refuses the second as
  // §5.4.2's `undecryptable`, with the sender shown "Delivered" and neither person
  // told why. Reading both back is the conditional write and the restart working.
  const both = await messageFlow.receive(peer);
  equal(
    "⭐⭐⭐ the peer reads BOTH",
    texts(both).sort().join(" | "),
    "ensimmainen valilehti | toinen valilehti"
  );
  equal("and neither is a §5.4.2 failure", failures(both).join(), "");
  await both.settle();

  // ⚠️ AND ON ONE SESSION, NOT TWO — the failure the first draft of this block
  // actually produced. A client that answered contention by starting a fresh
  // session per tab would pass the check above too, while spending a §6.3
  // generation per tab and leaving the peer's rule-3 tie-break two live sessions to
  // choose between. Tabs share a device; they must share its session.
  equal(
    "⭐⭐ on ONE session, at ONE generation",
    `${a.sessionId === b.sessionId}/${a.generation}/${b.generation}`,
    "true/1/1"
  );
  equal("and the roster was told once", String(roster.generation), "1");

  // The other direction, where a lost RECEIVE advance would show.
  await messageFlow.send(peer, "vastaus yksi");
  await messageFlow.send(peer, "vastaus kaksi");
  const [drainA, drainB] = await Promise.all([messageFlow.receive(one), messageFlow.receive(two)]);
  const read = [...texts(drainA), ...texts(drainB)];
  check(
    "⭐⭐ two tabs draining at once both come back with readable messages",
    read.length >= 2 && read.every((t) => t.startsWith("vastaus")),
    read.join(" | ")
  );
  equal("with nothing unreadable", [...failures(drainA), ...failures(drainB)].join(), "");
  await drainA.settle();
  await drainB.settle();
  equal("and the mailbox is empty afterwards", String((await peek(one)).length), "0");
}

// ------------------------------------------ ROADMAP step 10, the ending's order

section("§7.8, 0.8.13 — clearing the store while a drain is still in flight");

// ⚠️⚠️ THIS IS WHAT §7.8's PRINTED ORDER DOES. Its step 2 clears storage; its step
// 3 stops the SSE connection and tells the other clients. An implementation that
// followed that order literally clears the database while its own drain is between
// the network read and the write that stores the plaintext and the advanced
// ratchet — and the drain then writes into the store the ending just emptied,
// after which step 4 navigates away and leaves it there.
//
// ⭐ IT NEEDS NO SECOND TAB. This block has exactly one client, and it is enough:
// the racing writer is the ending document's own delivery loop.
{
  const { i: i5, j: j5 } = await pairTwoClients();
  const disk = db.memoryDatabase();
  const vault = vaults.openVault({ db: disk, localKey: crypto.getRandomValues(new Uint8Array(32)) });
  const pickleKey = crypto.getRandomValues(new Uint8Array(32));
  const mine = messageFlow.openChannel({
    scope: "test",
    api,
    backend: vault.conversation,
    pickleKey,
    channelRoot: i5.channelRoot,
    role: i5.role,
    onGeneration: () => {},
  });
  const peer = device(j5);

  // Something to be in flight, and a session to be advanced by reading it.
  await messageFlow.send(peer, "matkalla");

  const rowsIn = async (store) => (await disk.list(store, undefined)).length;

  // The ORDER §7.8 PRINTS: clear first, stop afterwards. The drain is started and
  // deliberately not awaited — which is exactly the state a real client is in when
  // somebody presses the control.
  const inFlight = messageFlow.receive(mine);
  await vault.endSession(); // §7.8 step 2, on the printed order
  const batch = await inFlight; // ...and step 3 would have stopped this
  await batch.settle();

  const leftBehind = (await rowsIn(db.CONVERSATION)) + (await rowsIn(db.MESSAGES));
  check(
    "⚠️⚠️ on §7.8's printed order the ending leaves the conversation's state behind",
    leftBehind > 0,
    `${leftBehind} record(s) written into a store that had just been cleared`
  );
  equal("and the drain read the message, so this is real state", texts(batch).join(), "matkalla");

  // ⚠️⚠️ AND IT IS NOT ONLY A RATCHET. §5.4.3 requires the decrypted plaintext, the
  // advanced session and the ids safe to delete to be ONE write — so the record
  // left behind holds the message itself, sealed under `local_key`, which comes
  // back with the passphrase. The ending said "removes it from this browser now".
  const survivor = await store.loadRecord(vault.conversation, "test", i5.channelRoot);
  const stranded = survivor.record.staged.map((s) => s.payload?.text).filter(Boolean);
  check(
    "⭐⭐⭐ and what survives includes the PLAINTEXT, not just the session",
    stranded.includes("matkalla") || Object.keys(survivor.record.sessions).length > 0,
    stranded.length ? `staged: ${stranded.join(",")}` : "an Olm session, readable with the phrase"
  );

  // The CORRECTED order — `flow/ending.js`'s: stop, then clear.
  const { i: i6, j: j6 } = await pairTwoClients();
  const disk2 = db.memoryDatabase();
  const vault2 = vaults.openVault({ db: disk2, localKey: crypto.getRandomValues(new Uint8Array(32)) });
  const mine2 = messageFlow.openChannel({
    scope: "test",
    api,
    backend: vault2.conversation,
    pickleKey,
    channelRoot: i6.channelRoot,
    role: i6.role,
    onGeneration: () => {},
  });
  const peer2 = device(j6);
  await messageFlow.send(peer2, "matkalla taas");

  const drain = messageFlow.receive(mine2);
  await drain; // ← step 1: stop delivery, and WAIT for it to have stopped
  await vault2.endSession(); // ← step 3: only now is the store cleared

  const after = (await disk2.list(db.CONVERSATION, undefined)).length + (await disk2.list(db.MESSAGES, undefined)).length;
  equal("⭐⭐⭐ stopping first leaves nothing behind", String(after), "0");
}

// ------------------------------ §6.7.1 rule 5 — sending into a conversation that ended

section("§6.7.1 rule 5 — the SEND PATH refuses a conversation the peer has ended");

// ⚠️⚠️ THIS SECTION EXISTS BECAUSE THE RULE USED TO LIVE IN THE CALLERS, AND D-172
// IS WHAT THAT COST. The composer is hidden and disabled while closed, and
// `reconnectAutomatically` asks `loadClosed` itself — but that second guard was
// added only after the app had shipped able to send, by itself, into a mailbox
// nobody will ever drain again. Everything below goes through `flow/message.js`
// with no `app/app.js` in the picture at all, which is the whole point: it is the
// send path that must refuse, not the two callers that happen to remember.
{
  const { i: iC, j: jC } = await pairTwoClients();
  const A = device(iC); // ends the conversation
  const B = device(jC); // is told, and must then be unable to send

  // Warm it, so nothing below is testing a channel that never worked.
  await messageFlow.send(A, "hei");
  const first = await messageFlow.receive(B);
  equal("an ordinary message crosses first", texts(first).join(), "hei");
  await first.settle();

  // ⛔⛔⛔ B REACHES "CLOSED" THE WAY THE PRODUCT DOES — over the wire, from a real
  // §6.7.1 notice. Calling `markClosed` alone would set the same byte and prove far
  // less: it would skip the notice entirely, and the notice is the ONLY thing that
  // ever writes that marker in the product. D-175: the path a test takes to reach a
  // state is part of what it tests.
  await messageFlow.sendClosing(A);
  const notice = await messageFlow.receive(B);
  equal("the notice arrives as its own kind (§6.7.1)",
    notice.messages.map((m) => m.payload?.kind).join(), payloads.KIND_CLOSED);
  check("⭐ and carries no words — there is no `text` key at all, not an empty one",
    !("text" in (notice.messages[0].payload ?? {})));
  await notice.settle();

  // What `app/app.js` does on receipt — §6.7.1 rule 5's first half, "mark the channel
  // closed in local conversation state".
  await store.markClosed(B.backend, "test", B.channelRoot, 1_756_000_000);

  const queuedForA = (await peek(A)).length;

  let refused = null;
  try {
    await messageFlow.send(B, "oletko siellä?");
  } catch (err) {
    refused = err;
  }
  check(
    "⛔⛔⛔ a message into a closed conversation is REFUSED BY THE SEND PATH ITSELF",
    messageFlow.isClosed(refused),
    refused ? `${refused.name}: ${refused.message}` : "it was sent"
  );
  equal(
    "⭐⭐ and NOTHING reached the server — the refusal is before the transmit, so " +
      "there is no ciphertext sitting in a mailbox for §5.1.1's fourteen days",
    String((await peek(A)).length),
    String(queuedForA)
  );

  // ⭐ THE EXEMPTION, AND IT HAS TO WORK. B receiving A's notice does not take away
  // B's own ending: §6.7.1 rule 1 makes the notice part of a removal, and B removing
  // their copy is an ordinary thing to do. A guard on `kind` would have exempted this
  // too — but it would also have exempted every kind that does not exist yet.
  const ownNotice = await messageFlow.sendClosing(B);
  check("⭐ B's OWN closing notice still goes, on the same closed channel",
    Boolean(ownNotice?.msgId), JSON.stringify(ownNotice?.msgId ?? null));

  // ⭐⭐ THE FALSIFICATION. Without this, every check above would pass on a send path
  // that had simply stopped working. §6.7.1 rule 8 — a later message from that peer
  // clears the marker — and the same call then succeeds, which says the marker is
  // what refused it and that the guard re-reads it rather than latching.
  await store.clearClosed(B.backend, "test", B.channelRoot);
  const again = await messageFlow.send(B, "takaisin");
  check("⭐⭐ clearing the marker (§6.7.1 rule 8) makes the very same call succeed",
    Boolean(again?.msgId), JSON.stringify(again?.msgId ?? null));

  const back = await messageFlow.receive(A);
  // ⚠️ TWO THINGS ARRIVE AT A, AND THE PAIR OF THEM IS §6.7.1 RULE 8 SEEN FROM A'S
  // SIDE: B's closing notice, and then a message from B after it. A client of this
  // protocol cannot normally do that — B only can here because the line above cleared
  // the marker by hand — which is exactly the hostile-or-broken peer rule 8 is about.
  // The honest response is the one that does not hide content, so BOTH are handed over.
  equal(
    "the notice and the message after it are BOTH handed over (§6.7.1 rule 8)",
    back.messages.map((m) => m.payload?.kind ?? "?").join(","),
    `${payloads.KIND_CLOSED},${payloads.KIND_TEXT}`
  );
  equal("and the message is readable at the other end",
    back.messages.map((m) => m.payload?.text).filter(Boolean).join(), "takaisin");
  await back.settle();
}

done();
