// §6.7.2 — the ONE rule that says a value the server can alter may not reach
// durable state until the plaintext has confirmed it.
//
// ⚠️⚠️ WHY THIS IS A FILE OF ITS OWN, AND NOT THREE MORE CHECKS IN `session.mjs`.
// The binding has two halves and they live in different places:
//
//   · `protocol/payload.js` SEALS the two fields and COMPARES them. `session.mjs`
//     covers that half exhaustively, as pure functions over bytes.
//   · `flow/message.js` decides WHAT TO DO with the verdict — and the defect the
//     2026-08-24 outside review found was entirely in that second half. The
//     comparison did not exist, but even with it, a build that compared the fields
//     and adopted the generation anyway would pass every check in `session.mjs`.
//
// ➡️ **A CHECK THAT ASKS WHETHER SOMETHING IS COMPARED CANNOT TELL YOU WHETHER THE
// COMPARISON IS OBEYED.** So this suite runs the real receive path, with the real
// WASM artefact the browser downloads, over a hostile mailbox — and asserts on the
// number that reached the roster, which is the number the attack was for.
//
// ⚠️ NO SERVER, ON PURPOSE. `e2e-message.mjs` proves the honest path against the
// real Go server and cannot run in the published client repository (there is no
// `../server` there, and `./test.sh` says so and exits 0). A guard for a security
// property must run for the person who clones the public repository and types
// `./test.sh`, so the only thing faked here is the transport: `api.signed` returns
// the bytes an attacker would have put in the mailbox. Everything above it —
// epoch derivation, request signing, Olm, the session rules, the store — is real.

import { readFileSync } from "node:fs";
import * as olm from "../src/crypto/olm.js";
import * as messageFlow from "../src/flow/message.js";
import * as envelopes from "../src/protocol/envelope.js";
import * as payloads from "../src/protocol/payload.js";
import { ROLE_INITIATOR, ROLE_JOINER } from "../src/protocol/pairing.js";
import * as store from "../src/storage/sessions.js";
import { b64uEncode } from "../src/crypto/b64u.js";
import { utf8Bytes, utf8String } from "../src/crypto/bytes.js";
import { check, equal, section, done } from "./harness.mjs";

await olm.initOlm({ wasm: readFileSync(new URL("../wasm/dist/lpm_olm_wasm_bg.wasm", import.meta.url)) });

const CHANNEL_ROOT = new Uint8Array(32).fill(0x5b);
const SESSION_ID = utf8Bytes("lpm-session-16by");

/**
 * A mailbox that hands over exactly one message, once.
 *
 * ⚠️ ONCE IS PART OF THE FIXTURE. `drainChannel` polls several epochs (§4.1's
 * window), so a fake that answered every GET would deliver the same `msg_id`
 * repeatedly and the assertions below would be about deduplication instead.
 */
function mailboxHolding(body) {
  let served = false;
  return {
    signed: async (method, path) => {
      if (method === "GET" && path.endsWith("/messages")) {
        if (served) return { messages: [] };
        served = true;
        return { messages: [{ msg_id: "m1", body: b64uEncode(body) }] };
      }
      if (path.endsWith("/ack")) return { deleted: 1 };
      return {};
    },
  };
}

/** What the initiator would have put on the wire, with `generation` as the server left it. */
function envelopeFrom(text, sealedGeneration, claimedGeneration = sealedGeneration) {
  // ⚠️ THE SENDER'S PAIRING ROLE, not "the one starting" — §6.2 via `crypto/olm.js`.
  // The receiver below is `ROLE_JOINER`, so this side is the initiator.
  const session = olm.initiate(CHANNEL_ROOT, SESSION_ID, ROLE_INITIATOR);
  try {
    const payload = payloads.buildPayload({
      text,
      sentAt: 1754000000,
      sessionId: SESSION_ID,
      generation: sealedGeneration,
    });
    const message = session.encrypt(envelopes.pad(payloads.encodePayload(payload)));
    return utf8Bytes(
      JSON.stringify(
        envelopes.buildEnvelope({
          sessionId: SESSION_ID,
          generation: claimedGeneration,
          type: message.type,
          body: message.body,
        })
      )
    );
  } finally {
    session.free();
  }
}

/** A receiving device, with the roster it writes its generation into. */
function receiver(body) {
  const roster = { generation: 0, writes: [] };
  const channel = messageFlow.openChannel({
    api: mailboxHolding(body),
    backend: store.memoryBackend(),
    pickleKey: store.randomPickleKey(),
    channelRoot: CHANNEL_ROOT,
    role: ROLE_JOINER,
    generation: roster.generation,
    onGeneration: (g) => {
      roster.generation = g;
      roster.writes.push(g);
    },
  });
  return { channel, roster };
}

// ─────────────────────────────────────────────────────────── the honest path

section("§6.7.2 — an untouched envelope still works, which is the control");

{
  const { channel, roster } = receiver(envelopeFrom("hei", 4));
  const batch = await messageFlow.receive(channel);

  equal("one message arrives", String(batch.messages.length), "1");
  equal("and it is the plaintext, not a refusal", batch.messages[0].payload?.text, "hei");
  equal("⭐ the generation it declared reached the roster", String(roster.generation), "4");
  await batch.settle();
}

// ──────────────────────────────────────────────────────────── the attack

/*
  ⚠️⚠️ THE ATTACK IN ONE SENTENCE. The ciphertext is genuine and untouched — the
  server cannot forge one — so `olm.accept` succeeds and the client has every
  reason to believe the message. `generation` is not an input to that decryption
  and never was, so the server rewrites it in transit and the client persists the
  number it was handed. §7.3.1 rule 3 merges generations by taking the MAXIMUM, so
  `Number.MAX_SAFE_INTEGER` is permanent: `nextGeneration()` can never exceed it,
  no later session can be established, and the channel is dead for good — including
  after the server becomes honest again. The only cure is to pair again, and
  nothing in the interface would say why.
*/

section("§6.7.2 — a rewritten generation is refused, and never reaches the roster");

{
  const POISON = Number.MAX_SAFE_INTEGER;
  const { channel, roster } = receiver(envelopeFrom("hei", 4, POISON));
  const batch = await messageFlow.receive(channel);

  equal("the message is still delivered as a line the person sees", String(batch.messages.length), "1");
  equal("⭐⭐ but as a refusal, not as words", batch.messages[0].failure, messageFlow.TAMPERED);
  check("and the text is not rendered", batch.messages[0].payload === undefined);
  check("the refusal says which field disagreed", /generation/.test(batch.messages[0].detail ?? ""));

  equal("⭐⭐⭐ THE POISON NUMBER NEVER REACHED THE ROSTER", String(roster.generation), "0");
  equal("and the roster was never asked to write anything at all", String(roster.writes.length), "0");
  await batch.settle();
}

section("§6.7.2 — and the same envelope with its session_id rewritten");

{
  const honest = JSON.parse(utf8String(envelopeFrom("hei", 4)));
  honest.session_id = b64uEncode(new Uint8Array(16).fill(9));
  const { channel, roster } = receiver(utf8Bytes(JSON.stringify(honest)));
  const batch = await messageFlow.receive(channel);

  /*
    ⚠️ THIS ONE IS *ALLOWED* TO LAND ON EITHER SIDE OF THE LINE, AND PINNING IT
    WOULD BE PINNING vodozemac'S INTERNALS RATHER THAN THIS PROTOCOL'S RULE. §6.2
    derives the receiving account from the channel root AND the session id, so a
    rewritten id usually fails inside `accept` — an ordinary undecryptable message,
    which §5.4.2 counts to three before it stages anything, so `messages` is empty
    and `refused` carries the early report (D-146). If a future library version
    made `accept` succeed instead, §6.7.2 would catch it one step later and the
    message would be staged as `tampered`.

    ⭐ Both landings are correct and the test asserts what is true of BOTH: the
    person is told, nothing is rendered as words, and — the thing the attack was
    for — nothing was adopted.
  */
  const seen = [...batch.messages, ...batch.refused];
  equal("the person is told, by one route or the other", String(seen.length), "1");
  check("nothing renders as words", seen.every((m) => m.payload === undefined));
  check("and the refusal is a named one",
    [messageFlow.TAMPERED, messageFlow.UNDECRYPTABLE].includes(seen[0].failure), seen[0].failure);
  equal("⭐⭐ and nothing was written to the roster either way", String(roster.writes.length), "0");
  await batch.settle();
}

done();
