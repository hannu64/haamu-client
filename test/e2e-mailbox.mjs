// Two paired clients exchange a message through the server — PROTOCOL.md §5, over
// real HTTP.
//
// It runs on top of e2e-pair.mjs's ground: two clients pair for real, and the
// channel root that comes out of that is what derives the mailboxes here. Nothing
// is stubbed — a real Go server, a real database, real Ed25519 request signatures.
//
// ⚠️ THE PAYLOAD BELOW IS NOT ENCRYPTED, and it is random bytes rather than words
// for that reason. Olm is ROADMAP step 5; this step is the transport, and the
// transport's job is to move opaque bytes without reading them. A demo that let a
// person type a sentence here would put that sentence on the wire in the clear,
// which is not a thing to build even once.
//
// Three properties can only be tested here, because httptest does not do them:
//
//   • the `Date` header on a 401, which is how §5.2's clock diagnosis works
//   • two processes agreeing on the canonical signing string
//   • the whole send → drain → acknowledge cycle across a real connection

import { createApi } from "../src/net/api.js";
import * as pairFlow from "../src/flow/pair.js";
import * as mailboxFlow from "../src/flow/mailbox.js";
import * as mailboxes from "../src/protocol/mailbox.js";
import * as epochs from "../src/protocol/epoch.js";
import { randomBytes } from "../src/crypto/random.js";
import { check, equal, section, done, hex } from "./harness.mjs";
// D-152: the sentence a person reads lives here now, and this is the only test that
// reaches §5.2's path against a real `Date` header — so it is the only place the
// measurement and the words can be checked against each other end to end.
import { roster as rosterCopy } from "../src/ui/copy.js";

const BASE = process.env.LPM_BASE_URL || "http://127.0.0.1:8099";
const ORIGIN = "https://haamu.invalid";

const api = createApi({ baseUrl: BASE, timeoutMs: 20000 });

console.log(`server ${BASE}`);

function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
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

/** Pair for real and hand back both halves of the channel. */
async function pairTwoClients() {
  let resolveLink;
  const linkReady = new Promise((r) => (resolveLink = r));

  const iRun = pairFlow.initiate({
    api,
    origin: ORIGIN,
    storage: memStorage(),
    onEvent: (e) => {
      if (e.type === "link") resolveLink(e.link);
    },
  });
  const link = await linkReady;
  const jRun = pairFlow.join({ api, link, storage: memStorage() });
  const [i, j] = await Promise.all([iRun, jRun]);
  return { i, j };
}

// --------------------------------------------------------- §5, end to end

section("§5 — a message crosses the server");

const { i, j } = await pairTwoClients();
equal("the two clients hold the same channel root", hex(i.channelRoot), hex(j.channelRoot));

const root = i.channelRoot;
const payload = randomBytes(512);

// I writes into the mailbox J reads (§4.2). `sendToPeer` registers it first if it
// does not exist, which is §5.1.1's "registration is a step of sending".
const sent = await mailboxFlow.sendToPeer(api, root, i.role, payload);
check("the send returned a message id", typeof sent.msgId === "string" && sent.msgId.length === 22);
check("and the mailbox's expiry, for §5.5's third state", Number.isInteger(sent.expires));

// ⭐ Seven to fourteen days, never less: §5.1.1 computes expiry from the SERVER's
// clock as `created_at + 2 × EPOCH_SECONDS`, precisely so that a client cannot hand
// it the channel's epoch offset as an exact value.
{
  const days = (sent.expires - epochs.nowSeconds()) / 86400;
  check("the mailbox lives 7–14 days from creation", days > 13.9 && days <= 14.001, `${days.toFixed(2)} days`);
}

// J drains all three of §4.1's epochs. Two of them do not exist; the message is in
// the third, and the two absent ones answer empty rather than 404.
const got = await mailboxFlow.drainChannel(api, root, j.role);
equal("J drains exactly one message from three polled epochs", String(got.length), "1");
equal("the payload arrived byte for byte", hex(got[0].body), hex(payload));
equal("carrying the id the sender was given", got[0].msgId, sent.msgId);

// §5.4.1: a drain deletes nothing, so the same message is still there.
const again = await mailboxFlow.drainChannel(api, root, j.role);
equal("a second drain returns it again — retrieval and deletion are separate", String(again.length), "1");

// §5.5, from the sender's side.
{
  const state = await mailboxFlow.statusOf(api, sent.mailbox, [sent.msgId]);
  equal("the sender sees it queued", state[sent.msgId], "queued");
}

const deleted = await mailboxFlow.ack(api, got[0].mailbox, [got[0].msgId]);
equal("the acknowledgement deleted it", String(deleted), "1");
equal("so the next drain is empty", String((await mailboxFlow.drainChannel(api, root, j.role)).length), "0");

{
  const state = await mailboxFlow.statusOf(api, sent.mailbox, [sent.msgId]);
  equal("and the sender is now shown Delivered", state[sent.msgId], "gone");
}

// ------------------------------------------------- §4.1, the absent mailbox

section("§4.1 — polling a mailbox that does not exist");

// ⭐⭐ THE MECHANISM THE RETENTION PROMISE RESTS ON. A client polls `e-1`, `e` and
// `e+1`; `e+1` normally does not exist. If polling created it, the server's
// `created_at + 2 × EPOCH_SECONDS` clock would start two epochs early and a message
// sent late in `e+1` would expire seconds after arriving — against a promise of "at
// least 7 days". It is also why §5.2's credential has to carry the public key:
// there is no stored key for a mailbox nobody registered.
{
  const e = await epochs.currentEpoch(root);
  const future = await mailboxes.deriveMailbox(root, e + 1, mailboxes.inboundDirection(j.role));

  for (let n = 0; n < 3; n++) {
    const empty = await mailboxFlow.drain(api, future);
    equal(`poll ${n + 1} of next epoch's mailbox is empty, not 404`, String(empty.length), "0");
  }

  // And it was not created by being read. A send into it must still fail — which
  // is checked with `send` rather than `sendToPeer`, because the latter would
  // register it and §5.1.1 forbids registering a future epoch's mailbox.
  await expectFailure(
    mailboxFlow.send(api, future, randomBytes(16)),
    "not_found",
    "three polls left the mailbox uncreated"
  );
}

// ------------------------------------------------------ §5.2, a wrong clock

section("§5.2 — a device whose clock is wrong");

// ⚠️ THE ONE FAILURE THE PRODUCT MUST EXPLAIN IN WORDS. A clock more than 60
// seconds out 401s every signed request: nothing sends, nothing arrives, and
// nothing says why — the shape D-016 identifies as most likely to send somebody
// back to an insecure channel. The diagnosis reads the response's `Date` header,
// which a real server sets and an in-process test never does. This is the only
// place in the project where that path runs.
{
  const realNow = Date.now;
  Date.now = () => realNow() + 7 * 60 * 1000; // this device is seven minutes fast
  let failure;
  try {
    failure = await expectFailure(
      mailboxFlow.drain(api, sent.mailbox),
      "clock_skew",
      "a signed request from a device seven minutes fast"
    );
  } finally {
    Date.now = realNow;
  }
  // ⚠️⚠️ D-152 — THIS USED TO READ `failure.message`, AND THAT IS THE DEFECT IT WAS
  // MEASURING. The flow module wrote the sentence itself, so a test of the module was
  // also a test of the copy, and neither the copy gate nor any review sheet ever saw it.
  // The module now carries the NUMBER; `ui/copy.js` owns the words. Both are checked.
  check(
    "and the measured offset travels as a number, seven minutes' worth",
    Math.abs(failure?.skew ?? 0) >= 400 && Math.abs(failure?.skew) <= 440,
    String(failure?.skew)
  );
  check(
    "and it says so in words a person can act on",
    /about 7 minutes ahead of the server/.test(rosterCopy.failure.clock_skew(failure?.skew ?? 0)) &&
      rosterCopy.failure.clock_skew(failure?.skew ?? 0).endsWith("try again."),
    rosterCopy.failure.clock_skew(failure?.skew ?? 0)
  );
}

// The clock is back; the same call works again, so nothing was poisoned.
equal("with the clock corrected, the same request succeeds", String((await mailboxFlow.drain(api, sent.mailbox)).length), "0");

// --------------------------------------------------------- §5.2, the key

section("§5.2 — the credential's key is checked against the identifier");

// A perfectly valid signature under a key the identifier does not commit to. This
// is what stops anyone who learns a `mailbox_id` — it travels in the request path —
// from reading or writing the mailbox it names.
{
  const stranger = await mailboxes.deriveMailbox(randomBytes(32), 1, mailboxes.DIR_I2J);
  const forged = { ...stranger, mailboxId: sent.mailbox.mailboxId };
  await expectFailure(
    mailboxFlow.drain(api, forged),
    "unauthorized",
    "a foreign key presented for somebody else's mailbox"
  );
}

done();
