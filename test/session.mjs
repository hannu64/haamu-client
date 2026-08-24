// PROTOCOL.md §6.3's session rules and §6.7's payload, with no server, no WASM and
// no clock. Everything here is a pure function over a plain object, which is why
// the awkward cases — a simultaneous split, a device whose own state is gone, a
// generation that went backwards — can be written down at all: through the network
// they would each need a scenario, and some of them cannot be provoked on demand.
//
// The parts that need real ciphertext are in `e2e-message.mjs`, against the real
// server. Nothing is stubbed here; these functions genuinely have no dependencies.

import * as s from "../src/protocol/session.js";
import * as payloads from "../src/protocol/payload.js";
import { MAX_PLAINTEXT, TYPE_NORMAL, TYPE_PREKEY, pad, unpad } from "../src/protocol/envelope.js";
import { utf8Bytes } from "../src/crypto/bytes.js";
import { check, equal, section, rejects, done } from "./harness.mjs";

const id = (n) => new Uint8Array(16).fill(n);
const env = (sessionId, generation, type = TYPE_PREKEY) => ({ sessionId, generation, type, version: 1 });

// --------------------------------------------------------- §6.3, classifying

section("§6.3 — where an incoming message goes");

{
  const fresh = s.emptyState();
  equal("a pre-key for an unknown session opens one", s.classify(env(id(1), 1), fresh).action, s.ACCEPT);

  // ⚠️⚠️ THE ONE THAT WOULD HAVE DESTROYED UNANSWERED CONVERSATIONS. Every message
  // an initiator sends before the first reply is a PRE-KEY message carrying the
  // same session_id (measured against vodozemac 0.10.0). Read as a rule about
  // messages, §6.3's "reject a repeat" drops all of them but the first — and for a
  // tip-off that is never answered that is the entire conversation.
  let state = s.accepted(fresh, { sessionId: id(1), generation: 1 });
  state = s.adopt(state, { sessionId: id(1), generation: 1, epoch: 10 });
  equal("the SECOND pre-key of the same session is an ordinary message on it",
    s.classify(env(id(1), 1), state).action, s.DECRYPT);
  equal("and so is a normal message on it", s.classify(env(id(1), 1, TYPE_NORMAL), state).action, s.DECRYPT);

  // §6.3 rule 1.
  equal("a session below the highest accepted is refused",
    s.classify(env(id(2), 0), state).reason, "stale_generation");

  // ⚠️⚠️ §5.4.2: transient, and it must never be counted.
  const later = s.classify(env(id(9), 1, TYPE_NORMAL), state);
  equal("a normal message for a session this device does not have waits", later.action, s.WAIT);
  equal("and says why, because §5.4.2 turns on the distinction", later.reason, "no_session");

  // The replay the accepted set is actually for: the session was dropped by rule
  // 5's epoch expiry, so the first branch no longer catches it.
  const dropped = { ...state, sessions: {} };
  equal("a pre-key already accepted at this generation is refused once its session is gone",
    s.classify(env(id(1), 1), dropped).reason, "replayed_prekey");
  equal("but a NEW session at the same generation is not a replay",
    s.classify(env(id(3), 1), dropped).action, s.ACCEPT);
}

// ------------------------------------------------------------ §6.3, adopting

section("§6.3 — which session this device sends on");

{
  // Rule 2: a higher generation is adopted unconditionally, whatever its id.
  let mine = s.created(s.emptyState(), { sessionId: id(0xf0), generation: 3, epoch: 10 });
  equal("this device's own session is the one it sends on", mine.sending, s.key(id(0xf0)));
  let after = s.adopt(s.accepted(mine, { sessionId: id(0x01), generation: 4 }), {
    sessionId: id(0x01), generation: 4, epoch: 10,
  });
  equal("a higher generation wins even with a larger session id", after.sending, s.key(id(0x01)));
  equal("and the generation moves with it", String(after.generation), "4");
  equal("the replay set is discarded when the generation advances",
    after.acceptedPrekeys.join(), s.key(id(0x01)));
  check("the superseded session is kept, not deleted — rule 5",
    after.sessions[s.key(id(0xf0))]?.supersededAtEpoch === 10);
}

{
  // Rule 3: same generation, one session created by each party — smaller wins.
  const base = s.created(s.emptyState(), { sessionId: id(0x40), generation: 2, epoch: 7 });
  const theirsBigger = s.adopt(s.accepted(base, { sessionId: id(0x80), generation: 2 }), {
    sessionId: id(0x80), generation: 2, epoch: 7,
  });
  equal("ours is smaller, so ours keeps sending", theirsBigger.sending, s.key(id(0x40)));
  check("theirs is still readable", !!theirsBigger.sessions[s.key(id(0x80))]);

  const theirsSmaller = s.adopt(s.accepted(base, { sessionId: id(0x10), generation: 2 }), {
    sessionId: id(0x10), generation: 2, epoch: 7,
  });
  equal("theirs is smaller, so we switch to theirs", theirsSmaller.sending, s.key(id(0x10)));

  // ⚠️ Rule 3's ordering is over BYTES. base64url is not ASCII-monotonic, so the
  // string comparison disagrees on exactly this pair — and two clients would each
  // conclude the other had won.
  const x = new Uint8Array(16); x[15] = 0xd0;
  const y = new Uint8Array(16); y[15] = 0x04;
  check("bytes say x > y", s.compareSessionIds(x, y) > 0);
  check("b64u text says the opposite, which is why the rule names bytes",
    s.key(x) < s.key(y), `${s.key(x)} < ${s.key(y)}`);
}

{
  // Rule 4: a session this device cannot use is never a tie-break candidate. The
  // state says it is sending on a session whose state is gone — a device restored
  // from a backup that missed one write.
  const crippled = { ...s.created(s.emptyState(), { sessionId: id(0x10), generation: 2, epoch: 7 }), sessions: {} };
  const out = s.adopt(s.accepted(crippled, { sessionId: id(0x90), generation: 2 }), {
    sessionId: id(0x90), generation: 2, epoch: 7,
  });
  equal("the usable session wins regardless of ordering", out.sending, s.key(id(0x90)));
}

{
  // A device that did not itself create a session at this generation has nothing
  // to tie-break, and §6.3 says the incoming session is simply adopted.
  const clean = s.emptyState();
  const out = s.adopt(s.accepted(clean, { sessionId: id(0xff), generation: 1 }), {
    sessionId: id(0xff), generation: 1, epoch: 3,
  });
  equal("with nothing of its own, the incoming session is adopted", out.sending, s.key(id(0xff)));
}

section("§6.3 rule 5 — the losing session lives until the epoch ends");

{
  let state = s.created(s.emptyState(), { sessionId: id(1), generation: 1, epoch: 5 });
  state = s.adopt(s.accepted(state, { sessionId: id(2), generation: 2 }), { sessionId: id(2), generation: 2, epoch: 5 });
  equal("inside the epoch, both sessions are still there",
    String(Object.keys(s.prune(state, 5).state.sessions).length), "2");
  const pruned = s.prune(state, 6);
  equal("at the next epoch the superseded one goes", String(Object.keys(pruned.state.sessions).length), "1");
  equal("and the sending one stays", pruned.state.sessions[s.key(id(2))] ? "kept" : "gone", "kept");
}

section("§6.3 — the generation a new session gets");

{
  const state = s.created(s.emptyState(), { sessionId: id(1), generation: 1, epoch: 0 });
  equal("(highest ever accepted) + 1", String(s.nextGeneration(state)), "2");
  const adopted = s.adopt(s.accepted(state, { sessionId: id(2), generation: 9 }), {
    sessionId: id(2), generation: 9, epoch: 0,
  });
  equal("a peer's higher generation raises the floor too", String(s.nextGeneration(adopted)), "10");
}

// ----------------------------------------------------------------- §6.7

section("§6.7 — the message payload");

{
  const p = payloads.buildPayload({ text: "hei", sentAt: 1754000000 });
  const round = payloads.decodePayload(payloads.encodePayload(p));
  equal("a payload round-trips", round.text, "hei");
  equal("carrying the sender's clock, for display only", String(round.sentAt), "1754000000");
  equal("§6.6's TTL runs from FIRST RECEIPT, not from sent_at",
    String(payloads.expiresAt(1754999999)), String(1754999999 + 86400));

  // ⚠️ §6.5 pads to a BYTE STRING. This is the buffer that would have been
  // destroyed by a string-typed cipher boundary: it starts with a length prefix.
  const padded = pad(payloads.encodePayload(p));
  equal("padding reaches the first bucket", String(padded.length), "256");
  equal("unpadding returns exactly what went in", payloads.decodePayload(unpad(padded)).text, "hei");

  // ⚠️⚠️ A PADDED PLAINTEXT IS NOT TEXT, and this is why the Olm wrapper's
  // plaintext boundary had to become `Uint8Array` on 2026-08-11. Some perfectly
  // ordinary message length puts a byte above 0x7F at the front of the buffer, and
  // there it is not a valid UTF-8 sequence — so the obvious string round trip
  // silently changes the length of the message.
  let notText = null;
  for (let n = 100; n < 400 && !notText; n++) {
    const cand = pad(payloads.encodePayload(payloads.buildPayload({ text: "x".repeat(n), sentAt: 1754000000 })));
    if (cand[0] >= 0x80) notText = cand;
  }
  check("some message length puts a non-UTF-8 byte first", notText !== null, `0x${notText?.[0].toString(16)}`);
  const throughAString = utf8Bytes(new TextDecoder().decode(notText));
  check("and a string round trip does not return it",
    throughAString.length !== notText.length, `${notText.length} bytes became ${throughAString.length}`);
  await rejects("§6.5's bounds check then fires on an honest message",
    () => unpad(throughAString), /exceeds/);

  // A peer is not a trusted source, even though it is an authenticated one.
  await rejects("a payload that is not JSON is refused", () => payloads.decodePayload(utf8Bytes("nope")), /not JSON/);
  await rejects("a payload that is not an object is refused", () => payloads.decodePayload(utf8Bytes("[1,2]")), /object/);
  await rejects("a non-integer sent_at is refused",
    () => payloads.decodePayload(utf8Bytes('{"v":1,"kind":"text","sent_at":"now","text":"x"}')), /sent_at/);
  await rejects("a text message with no text is refused",
    () => payloads.decodePayload(utf8Bytes('{"v":1,"kind":"text","sent_at":1}')), /text must be a string/);

  // Not failures: a newer client legitimately sends these, and §5.4.2 must not see
  // them as decryption failures — they decrypted perfectly.
  const newerKind = payloads.decodePayload(utf8Bytes('{"v":1,"kind":"file","sent_at":1,"ref":"x"}'));
  check("an unknown kind is unsupported, not malformed", newerKind instanceof payloads.UnsupportedPayload);
  equal("and names what it was", newerKind.detail, "file");
  const newerV = payloads.decodePayload(utf8Bytes('{"v":2,"anything":true}'));
  check("a newer payload version is unsupported too", newerV instanceof payloads.UnsupportedPayload);

  // §6.5's ceiling is measured on the ENCODED payload, because JSON escaping makes
  // the text length and the byte length differ by up to six times.
  check("a message of the maximum size fits", payloads.fits("a".repeat(MAX_PLAINTEXT - 100)));
  check("one too large does not", !payloads.fits("a".repeat(MAX_PLAINTEXT)));
  check("and a short message of quotation marks can also be too large",
    !payloads.fits('"'.repeat(MAX_PLAINTEXT / 2)));
  await rejects("encoding refuses it rather than truncating",
    () => payloads.encodePayload(payloads.buildPayload({ text: " ".repeat(30000), sentAt: 1 })),
    /exceeds 65532/);
}

// ================================================ §6.7.1 — the closing notice

// ⚠️⚠️ THE SUBJECT HERE IS THE FIELD THAT MUST NOT EXIST. §6.7.1 forbids a `text`
// field: the sender is destroying their own ability to receive an answer in the
// same act, so a free-text field is a one-way channel for a parting shot AND an
// arbitrary string that a receiving client will render. Every field is
// peer-controlled and authenticated is not trustworthy (§11), so a peer WILL be
// able to put one on the wire — what matters is that decoding gives it nowhere to
// go.

section("§6.7.1 — the closing notice carries no words");

{
  const closing = payloads.buildClosing({ sentAt: 1754000000 });
  equal("it is its own kind", closing.kind, payloads.KIND_CLOSED);
  check("⭐ and it has no `text` key at all, not an empty one", !("text" in closing));
  equal("it still carries §6.6's sent_at", String(closing.sent_at), "1754000000");

  const round = payloads.decodePayload(payloads.encodePayload(closing));
  equal("it round-trips as itself", round.kind, payloads.KIND_CLOSED);
  check("and is not reported as unsupported", !(round instanceof payloads.UnsupportedPayload));

  // ⭐ THE ONE THAT WOULD CATCH A WELL-MEANING FUTURE CHANGE. "A later version
  // might use it, so let us pass it through" is exactly how the field that must
  // not exist arrives anyway.
  const hostile = payloads.decodePayload(
    utf8Bytes('{"v":1,"kind":"closed","sent_at":1,"text":"you will regret this"}')
  );
  check("⭐⭐ a peer that sends words in a closing notice has them dropped, not rendered",
    !("text" in hostile));

  // §6.5: it must not be distinguishable by size from an ordinary short message.
  const short = pad(payloads.encodePayload(payloads.buildPayload({ text: "ok", sentAt: 1754000000 })));
  const notice = pad(payloads.encodePayload(closing));
  equal("⭐ and it pads to the same bucket as a two-letter message, so the server cannot tell them apart",
    String(notice.length), String(short.length));
}

done();
