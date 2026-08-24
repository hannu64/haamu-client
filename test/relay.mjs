// I2 — "the pairing handshake cannot be relayed", proved with no server.
//
// ⚠️⚠️⚠️ WHY THIS FILE EXISTS, AND IT IS THE SHARPEST FINDING OF THE 2026-08-24
// REVIEW EVEN THOUGH NO SLICE REPORTED IT.
//
// I2 was returned **UNPROVEN IN THIS SLICE** by all three reviewers, and each was
// blind to a different quarter of it:
//
//   A saw `protocol/pairing.js` — the arithmetic — and not the flow around it.
//   B saw `flow/pair.js` — the branching — and not the arithmetic or the curve.
//   C saw `app/app.js` — the decision a person makes — and not either.
//
// Three "unproven"s over one property that is in fact whole. ⭐⭐⭐ THE REVIEW
// INSTRUMENT HAD A BLIND SPOT SHAPED LIKE ITSELF: a property spanning four files
// cannot be seen by a reader given three of them, however carefully it reads.
//
// ⚠️⚠️ AND THE PASS THAT FOLLOWED FOUND SOMETHING WORSE THAN A MISSING PROOF. The
// property IS tested — in `e2e-pair.mjs`, which needs the Go server and is exempted
// in the published tree. So haamu's single strongest claim, the one the whole of §3
// exists to make, was guarded ONLY in a file that a person who clones the public
// repository and types `./test.sh` never runs. Same shape as `binding.mjs` and
// `app-document.mjs`, and this is the third time: ⭐ A GUARD THAT DOES NOT RUN FOR
// THE READER IS A GUARD THAT IS NOT OFFERED TO THEM.
//
// ⭐ Everything below is arithmetic over real primitives. No server, no transport,
// no mocks: an attacker here is simply a third keypair and a wrong `L`.

import * as pairing from "../src/protocol/pairing.js";
import * as x25519 from "../src/crypto/x25519.js";
import { check, equal, section, done, hex } from "./harness.mjs";

const party = async () => await x25519.generateKeyPair();

// ══════════════════════════════════ the relay that does not hold `L`

section("I2 — a relay without `L` cannot reach the channel the two people reach");

{
  const L = pairing.newLinkSecret();
  const I = await party();
  const J = await party();
  const M = await party(); // the relay, sitting in the middle with its own keypair

  const honest = await pairing.deriveChannelRoot(I.privateKey, J.publicKey, L);
  const other = await pairing.deriveChannelRoot(J.privateKey, I.publicKey, L);
  equal("⭐ the two honest parties derive the same root", hex(honest), hex(other));

  /**
   * ⚠️⚠️ THE RELAY'S BEST CASE IS GIVEN TO IT FOR FREE HERE. It is allowed to
   * complete a Diffie–Hellman with each side — which is what a relay IS — and the
   * question is only whether the root it lands on is the one either side has.
   * `R = HKDF(dh ‖ L, …)`: without `L` the last input is wrong, so it is not.
   */
  const wrongL = pairing.newLinkSecret();
  const relayToI = await pairing.deriveChannelRoot(M.privateKey, I.publicKey, wrongL);
  const relayToJ = await pairing.deriveChannelRoot(M.privateKey, J.publicKey, wrongL);

  check("⭐⭐⭐ the relay's root with I is not the honest root", hex(relayToI) !== hex(honest));
  check("⭐⭐⭐ nor is its root with J", hex(relayToJ) !== hex(honest));

  /**
   * ⚠️ AND THE PART A PERSON ACTUALLY SEES. §3.6's six digits derive from the root,
   * so two different roots are two different numbers read aloud — which is the whole
   * mechanism by which a human catches a relay that the arithmetic cannot refuse.
   */
  const sasHonest = await pairing.shortAuthString(honest);
  const sasRelayed = await pairing.shortAuthString(relayToI);
  check("⭐⭐⭐ so the six digits differ, which is what the two people compare", sasHonest !== sasRelayed);
  equal("⚠️ and both are six digits, so neither side sees anything odd about the other's", 
    `${sasHonest.length}/${sasRelayed.length}`, "6/6");

  /**
   * ⚠️⚠️ THE DECISIVE ONE: EVEN WITH `L`, A SUBSTITUTED KEY CHANGES THE ROOT. This is
   * the case §3.5's tripwire is about — the link leaked — and it is why possession of
   * `L` is not by itself possession of the conversation. The digits still diverge.
   */
  const withL = await pairing.deriveChannelRoot(M.privateKey, I.publicKey, L);
  check("⭐⭐⭐ a relay holding `L` STILL lands on a different root", hex(withL) !== hex(honest));
  check("⚠️ and therefore on different digits", (await pairing.shortAuthString(withL)) !== sasHonest);

  /**
   * ⛔⛔ THIS CHECK EXISTS BECAUSE THE ONES ABOVE DO NOT PROVE WHAT THEY CLAIM, AND A
   * MUTATION IS WHAT SAID SO. Dropping `linkSecret` from `deriveChannelRoot`
   * entirely — `HKDF(dh)` instead of `HKDF(dh ‖ L)` — left every check above
   * passing, because the relay uses its OWN keypair and so the Diffie–Hellman
   * already differs. They prove that DH works. **`L`'s contribution was untested**,
   * on the one line that carries I2.
   *
   * ⭐ So hold the keys constant and vary only `L`. Nothing else in this file can
   * tell the difference between a root that binds the invitation and one that
   * merely binds two keys.
   */
  const sameKeysWrongL = await pairing.deriveChannelRoot(I.privateKey, J.publicKey, wrongL);
  check(
    "⭐⭐⭐ SAME keypairs, different `L` → a different root: the invitation is genuinely bound in",
    hex(sameKeysWrongL) !== hex(honest)
  );
  check(
    "⚠️ and different digits, so the binding is visible to the two people as well",
    (await pairing.shortAuthString(sameKeysWrongL)) !== sasHonest
  );
}

// ══════════════════════════════════ the commitment, which removes the retry

section("§3.4 — the commitment is what stops the server choosing a key");

{
  const I = await party();
  const M = await party();
  const commit = await pairing.commitTo(I.publicKey);

  check("⭐ the honest key opens the commitment", await pairing.openCommitment(commit, I.publicKey));
  check(
    "⭐⭐⭐ a substituted key does not — J aborts here and derives nothing",
    !(await pairing.openCommitment(commit, M.publicKey))
  );

  // ⚠️ §3.1 publishes the COMMITMENT and never the key, so a server that wants to
  // substitute must do it before it has seen what it is substituting for.
  check("⚠️ and the commitment is not the key it commits to", hex(commit) !== hex(I.publicKey));
}

// ══════════════════════════════════ the MACs, which need `L` to forge

section("§3.1/§3.2 — participation requires `L`, not merely `pairing_id`");

{
  const L = pairing.newLinkSecret();
  const { pairingId, macKey } = await pairing.derivePairing(L);

  // Anyone who watches traffic learns `pairing_id`: it travels in the request PATH.
  // What they cannot do is derive the MAC key, which comes from `L`.
  const observer = await pairing.derivePairing(pairing.newLinkSecret());
  const J = await party();
  const commit = await pairing.commitTo((await party()).publicKey);

  const realOffer = await pairing.macOffer(macKey, commit);
  const realClaim = await pairing.macClaim(macKey, J.publicKey, commit);
  check("⭐ the holder of `L` produces offer and claim MACs that verify", 
    (await pairing.verifyOffer(macKey, commit, realOffer)) &&
    (await pairing.verifyClaim(macKey, J.publicKey, commit, realClaim)));

  const forgedOffer = await pairing.macOffer(observer.macKey, commit);
  const forgedClaim = await pairing.macClaim(observer.macKey, J.publicKey, commit);
  check("⭐⭐⭐ an observer of `pairing_id` cannot forge the offer MAC", 
    !(await pairing.verifyOffer(macKey, commit, forgedOffer)));
  check("⭐⭐⭐ nor the claim MAC — which is what makes §3.5's alarm mean something",
    !(await pairing.verifyClaim(macKey, J.publicKey, commit, forgedClaim)));

  // ⚠️ §3.5 spends a paragraph on this: if a forged claim could raise the alarm,
  // anyone who saw a request line could make two honest users distrust each other
  // at will, and the one alarm this design has would become the one users dismiss.
  check("⚠️ and `pairing_id` really is derivable by anyone holding `L`", pairingId.length > 0);
  check("⚠️ while a different `L` gives a different pairing entirely", 
    hex(pairingId) !== hex(observer.pairingId));
}

// ══════════════════════════════════ the curve, which slice B could not see

section("RFC 7748 §6.1 — a small-order key cannot force a known shared secret");

{
  const I = await party();
  // The all-zero point: the canonical small-order public key. A relay that could
  // make `dh` return all-zero would know the root without knowing anything else.
  let refused = null;
  try {
    await pairing.deriveChannelRoot(I.privateKey, new Uint8Array(32), pairing.newLinkSecret());
  } catch (e) {
    refused = e.message;
  }
  check("⭐⭐⭐ the all-zero peer key is refused, not silently agreed with", 
    refused !== null, refused ?? "NOT REFUSED");

  let refusedRaw = null;
  try {
    await x25519.dh(I.privateKey, new Uint8Array(32));
  } catch (e) {
    refusedRaw = e.message;
  }
  check("⚠️ and refused at the primitive too, not only where this protocol calls it", refusedRaw !== null);

  /**
   * ⛔ AND THE TWO CHECKS ABOVE DO NOT TEST THE CODE THEY LOOK LIKE THEY TEST.
   * Deleting the explicit all-zero loop from `crypto/x25519.js` leaves both of them
   * passing, because Node's WebCrypto refuses the agreement by itself — so on this
   * engine they measure the ENGINE. The comment beside that loop says exactly why it
   * is there: *"Not every engine does"*, and a device that lands on the fallback has
   * only the loop between it and a known shared secret.
   *
   * ⭐ So install a fallback that returns all-zero and demand a refusal. That is the
   * one arrangement in which the loop is the only thing that can refuse — and it is a
   * real arrangement, not a contrivance: `installFallback` exists for browsers with
   * no X25519 in WebCrypto, which is the case `client/curve/` was built for.
   */
  // ⚠️⚠️ THE PEER KEY IS GENERATED BEFORE THE FALLBACK IS INSTALLED, and the first
  // version of this check was not — so `generateKeyPair` went to the fake, which has
  // no `publicFromPrivate`, and the throw this check reported was that. **It passed
  // for the wrong reason**, which is the same defect as the check it is testing.
  // The assertion below therefore reads the MESSAGE, not merely that something threw.
  const peer = (await party()).publicKey;
  const zeroing = { dh: () => new Uint8Array(32) };
  let refusedFallback = null;
  try {
    x25519.installFallback(zeroing, { insteadOfWebCrypto: true });
    await x25519.dh(I.privateKey, peer);
  } catch (e) {
    refusedFallback = e.message;
  } finally {
    // ⚠️ ALWAYS, even on a throw: this is module state and every later test in the
    // process would otherwise run against a curve that returns zeroes.
    x25519.installFallback(null, { insteadOfWebCrypto: false });
  }
  check(
    "⭐⭐⭐ an implementation that returns all-zero is refused by THIS module, not by the engine",
    /small order|all-zero/i.test(refusedFallback ?? ""),
    refusedFallback ?? "NOT REFUSED — the explicit check is the only thing here"
  );

  // ⚠️ And the fallback really was uninstalled, or everything after this file lies.
  const sane = await x25519.dh(I.privateKey, (await party()).publicKey);
  check("⚠️ and the real curve is back afterwards", sane.some((b) => b !== 0));
}

done();
