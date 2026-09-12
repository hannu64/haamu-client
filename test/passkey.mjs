// §7.5's PRF wrapper — what the ceremony must refuse, and what the wrap must survive.
//
// ⚠️⚠️ WHAT THIS FILE CANNOT CLAIM, SAID FIRST. There is no WebAuthn in Node, so every
// authenticator here is a fake and nothing below is evidence that PRF works on any real
// device. That evidence exists and is not in a test file: `DEVICE_RESULTS.md` records
// six devices, two platforms and a reboot on each. ➡️ **The container is not a device**
// — so what is guarded here is the half that is ours: the refusals, the wrap, and the
// binding. The fakes are built to return exactly what the panel MEASURED real platforms
// returning, including the two that return something that looks like success.

import * as passkey from "../src/flow/passkey.js";
import { check, equal, rejects, section, done, hex } from "./harness.mjs";

// ---------------------------------------------------------------- fake authenticators

const UP = 0x01;
const UV = 0x04;
const BE = 0x08;
const BS = 0x10;

function authData(flags) {
  const d = new Uint8Array(37);
  d[32] = flags;
  return d;
}

/**
 * One credential's PRF output, deterministic in its id so that a second evaluation of
 * the same credential returns the same bytes — which is the property §7.5's daily
 * unlock rests on and the one the panel measured across a reboot.
 */
function prfFor(id, salt) {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = (id[i % id.length] ^ salt[i] ^ 0x5a) & 0xff;
  return out;
}

/**
 * A platform authenticator that behaves the way the iPhone and the Galaxy did.
 * `quirks` turns it into each of the failures the panel actually met.
 */
function authenticator(quirks = {}) {
  const made = [];
  return {
    made,
    async create({ publicKey }) {
      if (quirks.refuseCreate) throw new Error("NotAllowedError");
      const id = new Uint8Array(16).fill(made.length + 1);
      made.push({ id, publicKey });
      const rk = quirks.credProps === "absent" ? undefined : { rk: quirks.credProps ?? true };
      return {
        rawId: id.buffer.slice(0),
        authenticatorAttachment: "attachment" in quirks ? quirks.attachment : "platform",
        getClientExtensionResults: () => ({ prf: { enabled: true }, ...(rk ? { credProps: rk } : {}) }),
      };
    },
    async get({ publicKey }) {
      if (quirks.refuseGet) throw new Error("NotAllowedError");
      const asked = publicKey.allowCredentials.map((c) => new Uint8Array(c.id));
      const known = asked.find((id) => made.some((m) => hex(m.id) === hex(id)));
      if (!known) throw new Error("NotAllowedError");
      const salt = new Uint8Array(publicKey.extensions.prf.eval.first);
      const first = quirks.prf === "empty" ? new Uint8Array(0) : quirks.prf === "absent" ? undefined : prfFor(known, salt);
      return {
        rawId: known.buffer.slice(known.byteOffset, known.byteOffset + known.length),
        authenticatorAttachment:
          "getAttachment" in quirks ? quirks.getAttachment : "attachment" in quirks ? quirks.attachment : "platform",
        response: { authenticatorData: authData(quirks.flags ?? UP | UV | BE | BS) },
        getClientExtensionResults: () => (first === undefined ? {} : { prf: { results: { first } } }),
      };
    },
  };
}

const master = () => new Uint8Array(32).fill(7);

/**
 * ⚠️ WebCrypto's AEAD refusal names nothing, on purpose — a decryption failure that
 * distinguished a wrong key from a wrong tag would be an oracle. So this matches the
 * one sentence it does give rather than pretending to read a reason out of it.
 */
const REFUSED = /operation-specific reason|Cipher job failed/;
const SCOPE = "TXlJZGVudGl0eURpZ2VzdA";

// ------------------------------------------------------------------------------------

section("§7.5 — the two labels, which are the protocol's own bytes");

equal("the PRF salt label is the protocol's", passkey.PRF_SALT_LABEL, "lpm-prf-v1");
equal("and the HKDF info is", passkey.WRAP_INFO, "lpm-wrap-v1");

// ⚠️ A CONSTANT IS NOT A CONSTRUCTION. The salt is SHA-256 OF that label, not the label,
// and a client that passed the ASCII through would interoperate with nothing and would
// still unlock on the device that made the mistake — which is why this is pinned.
{
  const salt = await passkey.prfSalt();
  equal("and the salt is SHA-256 of the label, 32 bytes", salt.length, 32);
  // ⚠️ CHECKED AGAINST `sha256sum` AND NOT AGAINST THIS CLIENT. A pin computed by the
  // code it guards agrees with itself; this one was produced outside the repository.
  equal(
    "pinned, because a wrong salt is invisible on the device that chose it",
    hex(salt),
    "8fd7cabd0a2309875c4ddec20fa8ce022a480c843725c4fc8f76ff2f991c3765"
  );
}

section("§7.5 — the flags byte, which is read and never assumed");

equal("no flags at all is no answer", passkey.flagsOf(new Uint8Array(10)), null);
equal("and a missing buffer is no answer", passkey.flagsOf(undefined), null);
check("user presence alone does not set uv", passkey.flagsOf(authData(UP))?.uv === false);
check("verification sets it", passkey.flagsOf(authData(UP | UV))?.uv === true);
// ⭐ The two backup flags are §7.5.2's privacy cost, stated by the device itself.
check("backup-eligible is read", passkey.flagsOf(authData(UP | UV | BE))?.be === true);
check("and backup-state separately", passkey.flagsOf(authData(UP | UV | BE | BS))?.bs === true);
check("a credential that does not sync says so", passkey.flagsOf(authData(UP | UV))?.be === false);

section("§7.5 — the wrap, and what it is bound to");

{
  const prf = new Uint8Array(32).fill(3);
  const blob = await passkey.sealMaster(prf, master(), SCOPE);
  const back = await passkey.openMaster(prf, blob, SCOPE);
  equal("K_master survives the round trip", hex(back), hex(master()));

  // ⚠️ THE UNWRAP DIRECTION DEFENDS ITSELF, WHICH IS WHY D-193's RULE LIVES AT SEAL TIME.
  const other = new Uint8Array(32).fill(4);
  await rejects("a different PRF output does not open it", () => passkey.openMaster(other, blob, SCOPE), REFUSED);
  await rejects("and neither does another identity's row", () => passkey.openMaster(prf, blob, "AnotherScope"), REFUSED);

  // ⭐ The tag covers the whole blob, so a single flipped byte is a refusal and never a
  // partial K_master — the property the AEAD exists for, checked here because this is the
  // one record in the client that is NOT also sealed under `local_key`.
  const bent = blob.slice();
  bent[bent.length - 1] ^= 1;
  await rejects("a bent ciphertext is refused whole", () => passkey.openMaster(prf, bent, SCOPE), REFUSED);
}

await rejects(
  "a short PRF output is refused before it can become a key",
  () => passkey.wrapKeyFrom(new Uint8Array(16)),
  /32 bytes/
);

section("§7.5.1 — the record, and why it is stored in the clear");

{
  const rec = passkey.encodeRecord({
    credentialId: new Uint8Array([1, 2, 3, 4]),
    rkRequested: "required",
    blob: new Uint8Array([9, 9, 9]),
  });
  equal("the record carries a version", rec.v, passkey.RECORD_V);
  equal("and what was asked for, as a word rather than a boolean", rec.rk, "required");
  check("it is JSON-able, because it is stored unencrypted", JSON.parse(JSON.stringify(rec)).id === rec.id);
  const back = passkey.decodeRecord(rec);
  equal("and it decodes", hex(back.credentialId), "01020304");

  // ⚠️ A LAUNCH PATH GETS `null` AND NEVER A THROW. This is read before anything is
  // unlocked, on a screen with nothing behind it to catch an exception.
  equal("a damaged record is null", passkey.decodeRecord({ v: 1, id: "!!!", blob: "x" }), null);
  equal("a record from a future version is null", passkey.decodeRecord({ v: 2, id: "AQ", blob: "AQ" }), null);
  equal("and nothing at all is null", passkey.decodeRecord(null), null);
}

section("§7.5 — enrolment on an authenticator that behaves");

{
  const auth = authenticator();
  const got = await passkey.enrol({ credentials: auth, kMaster: master(), scope: SCOPE });
  check("it enrols", got.ok, got.reason ?? "");
  equal("one credential was created, not two", auth.made.length, 1);

  // ⚠️⚠️ THE ESCALATION LADDER IS GONE AND THIS IS THE GUARD THAT KEEPS IT GONE. §7.5.1's
  // cheap first rung returns nothing on Android and buys no privacy on iOS, and it leaves
  // a permanently listed passkey behind before the working rung is even tried.
  equal(
    "and it was asked for as discoverable the first time",
    auth.made[0].publicKey.authenticatorSelection.residentKey,
    "required"
  );
  equal(
    "with verification required rather than preferred",
    auth.made[0].publicKey.authenticatorSelection.userVerification,
    "required"
  );
  equal(
    "and the platform's own authenticator, never a roaming one",
    auth.made[0].publicKey.authenticatorSelection.authenticatorAttachment,
    "platform"
  );
  check("PRF is requested at create()", "prf" in auth.made[0].publicKey.extensions);
  check("and credProps beside it", auth.made[0].publicKey.extensions.credProps === true);

  // ⚠️ THE HANDLE IS RANDOM PER ENROLMENT — see the module header for why the tidy
  // alternative breaks the first device every time somebody sets up a second one.
  const again = await passkey.enrol({ credentials: auth, kMaster: master(), scope: SCOPE });
  check("a second enrolment makes a second credential", again.ok);
  check("with a different user handle", hex(auth.made[0].publicKey.user.id) !== hex(auth.made[1].publicKey.user.id));

  // The record it produced opens, through the public route a launch would take.
  const entry = passkey.decodeRecord(got.record);
  const seen = await passkey.evaluate({ credentials: auth, entries: [{ scope: SCOPE, credentialId: entry.credentialId }] });
  check("the stored credential evaluates", seen.ok, seen.reason ?? "");
  equal("and names the identity it belongs to", seen.scope, SCOPE);
  const back = await passkey.openMaster(seen.prfOut, entry.blob, seen.scope);
  equal("⭐ and out comes K_master, with no KEY typed", hex(back), hex(master()));
}

section("§7.5 — every failure the device panel actually met");

{
  // ⚠️ The Galaxy S25 on Samsung Browser 30: `extension:prf: true` from the capability
  // report, and ZERO BYTES from the round trip. Truthy in every shape test, and not a key.
  const empty = authenticator({ prf: "empty" });
  equal(
    "a PRF field with no bytes in it is a refusal, not a key",
    (await passkey.enrol({ credentials: empty, kMaster: master(), scope: SCOPE })).reason,
    passkey.NO_PRF
  );

  const none = authenticator({ prf: "absent" });
  equal(
    "and so is no PRF result at all",
    (await passkey.enrol({ credentials: none, kMaster: master(), scope: SCOPE })).reason,
    passkey.NO_PRF
  );

  // ⛔⛔ D-193 RULE 1. This assertion succeeds, returns 32 good bytes, and would build a
  // record that needs a second device in the room — after §7.5.2 has promised otherwise.
  const hybrid = authenticator({ attachment: "cross-platform" });
  equal(
    "⛔ a phone answering over hybrid may not wrap anything",
    (await passkey.enrol({ credentials: hybrid, kMaster: master(), scope: SCOPE })).reason,
    passkey.NOT_PLATFORM
  );

  // ⚠️ AND THE SAME RULE ON THE ASSERTION, NOT ONLY ON THE CREATION. A credential made
  // here can still be answered from somewhere else later.
  const driftedAway = authenticator({ getAttachment: "cross-platform" });
  equal(
    "a credential made here but answered elsewhere is refused too",
    (await passkey.enrol({ credentials: driftedAway, kMaster: master(), scope: SCOPE })).reason,
    passkey.NOT_PLATFORM
  );

  // ⚠️ `null` IS REFUSED WITH `"cross-platform"`. A value that cannot be verified has not
  // been verified, and the cost of refusing is one Argon2id.
  const silent = authenticator({ attachment: null });
  equal(
    "a browser that will not say where it ran is refused",
    (await passkey.enrol({ credentials: silent, kMaster: master(), scope: SCOPE })).reason,
    passkey.NOT_PLATFORM
  );

  // ⚠️⚠️ ASKING FOR VERIFICATION IS NOT RECEIVING IT. Presence alone would mean a tap on
  // an already-unlocked device unwraps K_master and through it every channel root.
  const presenceOnly = authenticator({ flags: UP });
  equal(
    "⛔ presence without verification does not unwrap anything",
    (await passkey.enrol({ credentials: presenceOnly, kMaster: master(), scope: SCOPE })).reason,
    passkey.NOT_VERIFIED
  );

  const dismissed = authenticator({ refuseCreate: true });
  equal(
    "a dismissed sheet is a decline and never an error",
    (await passkey.enrol({ credentials: dismissed, kMaster: master(), scope: SCOPE })).reason,
    passkey.DECLINED
  );

  // ⚠️ Firefox 153 on the panel: no platform authenticator at all. The feature is absent,
  // which is a different sentence from "it failed".
  equal(
    "a browser with no WebAuthn is not a failure",
    (await passkey.enrol({ credentials: null, kMaster: master(), scope: SCOPE })).reason,
    passkey.NO_API
  );
  check("and `available` says so without calling anything", passkey.available(null) === false);
  check("while a real-shaped one passes the shape test", passkey.available(authenticator()) === true);
}

section("§7.5.1 — Safari returns no credProps, and that is not a failure");

{
  const safari = authenticator({ credProps: "absent" });
  const got = await passkey.enrol({ credentials: safari, kMaster: master(), scope: SCOPE });
  check("it still enrols", got.ok, got.reason ?? "");
  // ⚠️ THREE-VALUED, NEVER A BOOLEAN (§7.5.1). Read as `false`, Safari's working
  // credential would be recorded as a refused one.
  equal("and records that it does not know", got.record.rk, "unknown");

  const refused = authenticator({ credProps: false });
  const denied = await passkey.enrol({ credentials: refused, kMaster: master(), scope: SCOPE });
  equal("an authenticator that says no is recorded as refusing", denied.record.rk, "refused");
  // ⭐ AND IT IS STILL ENROLLED. `credProps` is a diagnostic; the round trip is the
  // authority, and this one round-tripped.
  check("⭐ and enrolled anyway, because the round trip is the authority", denied.ok);
}

section("D-170 — two identities in one browser, one biometric sheet");

{
  const auth = authenticator();
  const one = await passkey.enrol({ credentials: auth, kMaster: new Uint8Array(32).fill(1), scope: "ScopeOne" });
  const two = await passkey.enrol({ credentials: auth, kMaster: new Uint8Array(32).fill(2), scope: "ScopeTwo" });
  const entries = [
    { scope: "ScopeOne", credentialId: passkey.decodeRecord(one.record).credentialId },
    { scope: "ScopeTwo", credentialId: passkey.decodeRecord(two.record).credentialId },
  ];

  let asked = 0;
  const counted = { create: auth.create, get: (...a) => (asked++, auth.get(...a)) };
  const seen = await passkey.evaluate({ credentials: counted, entries });
  equal("one ceremony, not one per identity", asked, 1);
  check("and it resolves to one of them", seen.ok && ["ScopeOne", "ScopeTwo"].includes(seen.scope));

  // ⚠️ AND THE RIGHT ONE. The response names the credential that answered; reading the
  // wrong row would hand a wrap key to a blob it cannot open, which fails closed but
  // fails with the wrong sentence on the screen.
  const rec = seen.scope === "ScopeOne" ? one.record : two.record;
  const want = seen.scope === "ScopeOne" ? 1 : 2;
  const got = await passkey.openMaster(seen.prfOut, passkey.decodeRecord(rec).blob, seen.scope);
  equal("⭐ and out comes THAT identity's K_master", hex(got), hex(new Uint8Array(32).fill(want)));
}

section("§7.5 — a stale entry in the platform account is not a fault of the person's");

{
  const auth = authenticator();
  await passkey.enrol({ credentials: auth, kMaster: master(), scope: SCOPE });

  equal(
    "nothing stored means nothing to evaluate, and nothing is asked of the person",
    (await passkey.evaluate({ credentials: auth, entries: [] })).reason,
    passkey.NO_RECORD
  );

  // ⚠️⚠️ `allowCredentials` IS A REQUEST AND NOT A GUARANTEE, WHICH IS THE WHOLE REASON
  // THE RESPONSE IS MATCHED RATHER THAN ASSUMED. Item 4d measured a `get()` on the iPhone
  // offering FIVE of this application's passkeys with nothing named; a platform that can
  // do that can also answer a named request with a discoverable credential of its own
  // choosing — and §7.5.1 records that an abandoned one can never be deleted, so a person
  // who set this up twice has spares in their account forever.
  const stranger = new Uint8Array(16).fill(9);
  const ignoresTheList = {
    create: auth.create,
    async get({ publicKey }) {
      return auth.get({
        publicKey: { ...publicKey, allowCredentials: [{ type: "public-key", id: stranger }] },
      });
    },
  };
  auth.made.push({ id: stranger, publicKey: null }); // it exists in the account, not here
  const answered = await passkey.evaluate({
    credentials: ignoresTheList,
    entries: [{ scope: SCOPE, credentialId: new Uint8Array(16).fill(1) }],
  });
  // ⭐ Fail closed, and fail with the RIGHT sentence: the record is missing, which is a
  // fact about this browser. Nothing was wrong with the person or their fingerprint.
  equal("a credential this browser has no row for is refused", answered.reason, passkey.NO_RECORD);
}

done();
