//! The LPM ↔ vodozemac WASM boundary.
//!
//! §6.1 says "use vodozemac compiled to WASM". No such binding is published, so
//! this is the wrapper that has to exist. It is deliberately the *whole* surface
//! the client needs and nothing else: initiate, accept, encrypt, decrypt,
//! persist, restore. No Matrix concepts, no key directory, no device lists.
//!
//! It also solves the problem the native harness uncovered — §6.2's bootstrap
//! needs Olm keys derived from the channel root `R`, and vodozemac's public API
//! has no constructor for chosen keys. The reshaping is done here, in Rust, once,
//! rather than in the client.
//!
//! ⚠️ **§7.7's "zeroization is not achievable" disclaimer does not reach this
//! file.** That reasoning is about JavaScript. This is Rust, and secrets here are
//! erased on the way out — see `scrub` and the `Zeroize` derives below.
//!
//! ## Three rules this file keeps
//!
//! 1. **No reachable panic.** `panic = "abort"` is set, and a trap inside WASM
//!    poisons the instance: every later call fails, and the session state the
//!    client was holding is gone. Every failure that a caller can provoke
//!    returns `Err`. The only `expect`s left are on statements that cannot be
//!    false for any input (a 32-byte HKDF output length).
//! 2. **No secret in an error string.** Errors name what was wrong and cite the
//!    section, never the value. The client shows them to people.
//! 3. ⚠️ **A plaintext is BYTES, never a string.** §6.5 encrypts
//!    `LE32(true_length) || plaintext || zeros`, which is not text and is not
//!    valid UTF-8 — a 200-byte message begins `C8 00 00 00`. Until 2026-08-11
//!    `encrypt` took `&str` and `decrypt` returned `String`, and **measurement
//!    showed the first real message would have been destroyed**: pushed through
//!    the obvious `TextDecoder`/`TextEncoder` pair, 256 padded bytes came back as
//!    258, the `C8` having become U+FFFD, and §6.5's bounds check then read a
//!    declared length of 12,435,439. A `latin1` reading happens to survive, which
//!    is worse than failing — it makes the choice of string encoding a private
//!    convention between two builds of this wrapper, exactly the divergence §6.4
//!    warns about for `b64u`. There is no correct string reading of a byte
//!    string, so the boundary carries `Uint8Array` in both directions.

use hkdf::Hkdf;
use serde_json::json;
use sha2::Sha256;
use vodozemac::{
    olm::{Account, OlmMessage, PreKeyMessage, Session, SessionConfig},
    Curve25519PublicKey, Curve25519SecretKey,
};
use wasm_bindgen::prelude::*;
use zeroize::{Zeroize, ZeroizeOnDrop};

/// What this build is, so a client can say what cryptography it is running
/// rather than assert it. The vodozemac version comes out of `Cargo.lock` at
/// compile time (`build.rs`), so it cannot drift from what is linked.
#[wasm_bindgen(js_name = lpmBuildInfo)]
pub fn lpm_build_info() -> String {
    json!({
        "wrapper": env!("CARGO_PKG_VERSION"),
        "vodozemac": env!("LPM_VODOZEMAC_VERSION"),
    })
    .to_string()
}

/// §6.4 specifies `b64u`, and §0.1 defines that as base64url.
///
/// ⚠️ vodozemac's own `base64_encode` uses the **standard** alphabet (`+` and
/// `/`, no padding — `utilities/mod.rs`, `STANDARD_NO_PAD`). Passing its output
/// straight into the envelope would emit a message §6.4 does not describe.
/// Nothing breaks between two builds of this wrapper, and a same-build round-trip
/// test **cannot** notice, because it decodes exactly what it encoded — but a
/// second implementer building from §6.4 writes an incompatible decoder.
fn b64u_encode(bytes: &[u8]) -> String {
    vodozemac::base64_encode(bytes).replace('+', "-").replace('/', "_")
}

/// Strict: standard-alphabet or padded input is rejected rather than repaired,
/// so a non-conforming peer is a visible error and not a silent acceptance.
fn b64u_decode(s: &str) -> Result<Vec<u8>, JsError> {
    if s.contains('+') || s.contains('/') || s.contains('=') {
        return Err(JsError::new("body must be base64url (§0.1 b64u), unpadded"));
    }
    vodozemac::base64_decode(s.replace('-', "+").replace('_', "/"))
        .map_err(|e| JsError::new(&format!("base64url: {e}")))
}

/// §6.2's `HKDF(R, info, 32)`: `R` is the input keying material, the label is
/// `info`, and there is no salt — which RFC 5869 defines as `HashLen` zero bytes
/// and `Hkdf::new(None, …)` implements.
fn hkdf32(root: &[u8; 32], info: &[u8]) -> [u8; 32] {
    let h: Hkdf<Sha256> = Hkdf::new(None, root);
    let mut out = [0u8; 32];
    h.expand(info, &mut out).expect("32 is a valid HKDF output length");
    out
}

/// The stack copy of `R`. Recovering it is total channel compromise (§6.2), so
/// it is held in a guard that erases it on drop rather than as a bare array.
#[derive(Zeroize, ZeroizeOnDrop)]
struct Root([u8; 32]);

fn root32(root: &[u8]) -> Result<Root, JsError> {
    root.try_into()
        .map(Root)
        .map_err(|_| JsError::new("channel root must be 32 bytes"))
}

/// §6.2 requires exactly 16 bytes, and it feeds an HKDF `info` string. Accepting
/// any length is a conformance gap: two clients disagreeing about the length
/// derive different one-time keys and never establish a session.
fn session_id16(session_id: &[u8]) -> Result<&[u8; 16], JsError> {
    session_id
        .try_into()
        .map_err(|_| JsError::new("session_id must be exactly 16 bytes (§6.2)"))
}

/// §6.2's derived Olm keys for one channel root and one session id.
#[derive(Zeroize, ZeroizeOnDrop)]
struct Bootstrap {
    idk_i: [u8; 32],
    idk_j: [u8; 32],
    otk: [u8; 32],
}

impl Bootstrap {
    fn derive(root: &Root, session_id: &[u8; 16]) -> Self {
        let mut otk_info = b"lpm-olm-otk-v1".to_vec();
        otk_info.extend_from_slice(session_id);
        Self {
            idk_i: hkdf32(&root.0, b"lpm-olm-idk-I-v1"),
            idk_j: hkdf32(&root.0, b"lpm-olm-idk-J-v1"),
            otk: hkdf32(&root.0, &otk_info),
        }
    }

    /// §6.2: *"Each party holds the private keys for the three derived keypairs
    /// but uses only its own role's identity key."*
    ///
    /// ⚠️⚠️ "ITS OWN ROLE" IS THE **PAIRING** ROLE (§3), FIXED FOR THE LIFE OF THE
    /// CHANNEL — not "whoever is starting this session". Until 2026-08-24 this
    /// crate had no role parameter at all: `initiate` always used `idk_I` and
    /// `accept` always used `idk_J`, which reads the same sentence as though I and
    /// J meant *session* initiator and responder. §6.3 is explicit that either
    /// party creates a session when it has no usable state — first message, cleared
    /// storage, device migration — so the pairing JOINER initiates routinely.
    ///
    /// ⭐ TWO COPIES OF THIS CLIENT NEVER NOTICED, AND COULD NOT HAVE. Both apply
    /// the same wrong rule, both derive both private keys from `R` (§6.2's
    /// deniability property), so every message decrypts and every test passes. What
    /// breaks is a SECOND IMPLEMENTATION built from `PROTOCOL.md`: a conforming
    /// role-I peer cannot accept a session this crate's role-J device opened,
    /// because it is addressed to the wrong identity key. Found by the 2026-08-24
    /// outside review, which had the specification and not this history.
    fn own(&self, role: Role) -> &[u8; 32] {
        match role {
            Role::I => &self.idk_i,
            Role::J => &self.idk_j,
        }
    }

    fn peer(&self, role: Role) -> &[u8; 32] {
        match role {
            Role::I => &self.idk_j,
            Role::J => &self.idk_i,
        }
    }
}

/// §3's pairing role, which this channel keeps for its whole life.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Role {
    I,
    J,
}

impl Role {
    /// ⚠️ NO DEFAULT AND NO FALLBACK. An unrecognised role must be a loud error and
    /// not a guess: guessing is precisely the behaviour being removed, and a silent
    /// `else { Role::I }` would restore it for every caller that forgot the argument.
    fn parse(s: &str) -> Result<Self, JsError> {
        match s {
            "I" => Ok(Role::I),
            "J" => Ok(Role::J),
            other => Err(JsError::new(&format!(
                "role must be \"I\" or \"J\" (§3's pairing role), got {other:?}"
            ))),
        }
    }
}

/// Overwrite every string in a `serde_json` tree.
///
/// The pickle `Value` holds the injected secrets *and* the random material
/// `Account::new()` generated, both as base64 strings. Best effort by nature —
/// serde_json may have reallocated a `String` while parsing, and this cannot
/// reach the freed copy — but the live buffers are erased, which is more than
/// dropping the value does.
fn scrub(v: &mut serde_json::Value) {
    match v {
        serde_json::Value::String(s) => s.zeroize(),
        serde_json::Value::Array(a) => a.iter_mut().for_each(scrub),
        serde_json::Value::Object(o) => o.iter_mut().for_each(|(_, x)| scrub(x)),
        _ => {}
    }
}

/// Build an `Account` around a chosen Curve25519 identity key and, for the
/// responder, a chosen one-time key.
///
/// vodozemac exposes no such constructor, so this goes through the pickle, which
/// is `Serialize + Deserialize`. That is a real coupling to vodozemac's pickle
/// shape: it is not covered by semver and a version bump can silently break it.
/// The guards are in `account_from_derived`, and the vector that catches a
/// changed *interpretation* is in `test/upgrade.mjs`.
fn build_account(idk: &[u8; 32], otk: Option<&[u8; 32]>) -> Result<Account, JsError> {
    let mut pickle = serde_json::to_value(Account::new().pickle())
        .map_err(|e| JsError::new(&format!("pickle serialise: {e}")))?;

    // ⚠️ Index assignment on a `Value` PANICS if the shape changes, and a
    // wrapper whose failure mode is a trap is worse than one that returns an
    // error the client can fall through on (rule 1 at the top of this file).
    let obj = pickle
        .as_object_mut()
        .ok_or_else(|| JsError::new("pickle is not a JSON object"))?;

    let idk_secret = Curve25519SecretKey::from_slice(idk);
    obj.insert(
        "diffie_hellman_key".into(),
        serde_json::to_value(&idk_secret)
            .map_err(|e| JsError::new(&format!("identity key serialise: {e}")))?,
    );

    if let Some(otk) = otk {
        let sk = Curve25519SecretKey::from_slice(otk);
        let pk = Curve25519PublicKey::from(&sk);
        obj.insert(
            "one_time_keys".into(),
            json!({
                "next_key_id": 1,
                "public_keys": { "0": serde_json::to_value(pk)
                    .map_err(|e| JsError::new(&format!("otk public: {e}")))? },
                "private_keys": { "0": serde_json::to_value(&sk)
                    .map_err(|e| JsError::new(&format!("otk secret: {e}")))? },
            }),
        );
    }

    let parsed = serde_json::from_value(pickle.clone())
        .map_err(|e| JsError::new(&format!("pickle deserialise: {e}")));
    scrub(&mut pickle);
    Ok(Account::from_pickle(parsed?))
}

/// Manufacture a pre-key message addressed to the derived keys, so that the
/// account under test has to **use** its injected private material to open it.
fn injection_probe(
    idk_pub: Curve25519PublicKey,
    otk_pub: Curve25519PublicKey,
) -> Result<(Curve25519PublicKey, PreKeyMessage), JsError> {
    let probe = Account::new();
    let mut session = probe
        .create_outbound_session(SessionConfig::version_1(), idk_pub, otk_pub)
        .map_err(|e| JsError::new(&format!("probe outbound session: {e}")))?;
    let message = session
        .encrypt("lpm-key-injection-probe")
        .map_err(|e| JsError::new(&format!("probe encrypt: {e}")))?;
    match message {
        OlmMessage::PreKey(p) => Ok((probe.identity_keys().curve25519, p)),
        OlmMessage::Normal(_) => Err(JsError::new("probe did not produce a pre-key message")),
    }
}

/// Build the account **and prove the injection worked**, per §6.1's normative
/// requirement.
///
/// ⚠️ **Reporting is not possession, and an earlier version of this guard only
/// asked the account to report.** The pickle carries a one-time key as two
/// separate fields, `public_keys` and `private_keys`. A check that reads
/// `account.one_time_keys()` reads the **public** map, so a release that renamed
/// `private_keys` alone would leave the public key adopted, the guard passing,
/// and the private key absent — exactly the failure §6.1 exists to prevent. The
/// identity key happened to be safe, because vodozemac derives its public half
/// from the private half it holds; the one-time key is not, and the asymmetry is
/// invisible from the API.
///
/// Three layers, cheapest first:
///
/// 1. the identity key the account reports must be the one we asked for;
/// 2. the re-serialised pickle must have **exactly one** one-time key, at id `0`,
///    with `next_key_id: 1` — a map that merely *contains* the right key may also
///    contain a random one a later call would hand out;
/// 3. a probe pre-key message addressed to the derived public keys must open,
///    which cannot succeed unless both **private** halves were adopted.
///
/// ⚠️ **The limit, stated because it cannot be closed here.** The probe and the
/// values it is built from are computed by the same implementation, so a changed
/// *interpretation* of the same bytes — `Curve25519SecretKey::from_slice` reading
/// them differently — moves both sides together and is not caught. **A
/// self-referential check always passes.** That is what `test/upgrade.mjs`
/// exists for: it holds public keys computed by a second implementation and
/// ciphertext frozen before the upgrade, neither of which moves when this crate
/// does.
///
/// Cost: layer 3 builds a second account and one throwaway session, so accepting
/// a session is roughly three times the work of building one. It happens once per
/// session establishment — 4.6 ms on a current phone, 20.5 ms on a ten-year-old
/// one (§6.1).
fn account_from_derived(idk: &[u8; 32], otk: Option<&[u8; 32]>) -> Result<Account, JsError> {
    let account = build_account(idk, otk)?;

    let want_idk = Curve25519PublicKey::from(&Curve25519SecretKey::from_slice(idk));
    if account.identity_keys().curve25519 != want_idk {
        return Err(JsError::new("key injection failed: identity key not adopted"));
    }

    let Some(otk) = otk else { return Ok(account) };
    let want_otk = Curve25519PublicKey::from(&Curve25519SecretKey::from_slice(otk));

    // Layer 2 — exact shape, read back off the account we are about to return.
    let mut round = serde_json::to_value(account.pickle())
        .map_err(|e| JsError::new(&format!("pickle re-serialise: {e}")))?;
    let shape_ok = (|| {
        let otks = round.get("one_time_keys")?;
        if otks.get("next_key_id")? != &json!(1) {
            return None;
        }
        let public = otks.get("public_keys")?.as_object()?;
        let private = otks.get("private_keys")?.as_object()?;
        (public.len() == 1
            && private.len() == 1
            && public.contains_key("0")
            && private.contains_key("0"))
        .then_some(())
    })()
    .is_some();
    scrub(&mut round);
    if !shape_ok {
        return Err(JsError::new(
            "key injection failed: one-time key map is not exactly one key at id 0",
        ));
    }
    if account.one_time_keys().values().next() != Some(&want_otk) {
        return Err(JsError::new("key injection failed: one-time key not adopted"));
    }

    // Layer 3 — exercise the private halves. `create_inbound_session` consumes
    // the one-time key, so it runs against a second, identical account.
    let mut probe_target = build_account(idk, Some(otk))?;
    let (probe_idk, probe_prekey) = injection_probe(want_idk, want_otk)?;
    probe_target
        .create_inbound_session(SessionConfig::version_1(), probe_idk, &probe_prekey)
        .map_err(|_| {
            JsError::new("key injection failed: derived private keys do not open a probe message")
        })?;

    Ok(account)
}

/// §6.4's envelope, minus the fields the client adds (`v`, `session_id`,
/// `generation`). The library's numeric `0:` / `1:` prefix is **not** §6.4's
/// `type` field, so it is translated here rather than leaked to the wire.
fn encode(m: &OlmMessage) -> Result<String, JsError> {
    let (kind, body) = m.to_parts();
    let ty = match kind {
        0 => "prekey",
        1 => "normal",
        other => return Err(JsError::new(&format!("unknown olm message kind {other}"))),
    };
    Ok(json!({ "type": ty, "body": b64u_encode(&body) }).to_string())
}

fn decode(s: &str) -> Result<OlmMessage, JsError> {
    let v: serde_json::Value =
        serde_json::from_str(s).map_err(|_| JsError::new("malformed message envelope"))?;
    let kind = match v.get("type").and_then(|t| t.as_str()) {
        Some("prekey") => 0,
        Some("normal") => 1,
        _ => return Err(JsError::new("envelope type must be \"prekey\" or \"normal\"")),
    };
    let body = v
        .get("body")
        .and_then(|b| b.as_str())
        .ok_or_else(|| JsError::new("envelope has no body"))?;
    let body = b64u_decode(body)?;
    OlmMessage::from_parts(kind, &body).map_err(|e| JsError::new(&format!("decode: {e}")))
}

/// A 32-byte key handed in from JavaScript, copied out and erased after use.
///
/// The caller's `Uint8Array` still holds it — that is §7.7's disclaimer and this
/// crate cannot fix it — but the Rust-side copy does not outlive the call.
fn key32(bytes: &[u8], what: &str) -> Result<[u8; 32], JsError> {
    bytes
        .try_into()
        .map_err(|_| JsError::new(&format!("{what} must be 32 bytes")))
}

/// One direction of one channel: an Olm session and nothing else.
#[wasm_bindgen]
pub struct LpmSession {
    session: Session,
}

#[wasm_bindgen]
impl LpmSession {
    /// Start a session with no round trip and no key directory (§6.2) — the
    /// responder's keys come out of `R`.
    ///
    /// ⚠️ `role` IS THIS DEVICE'S PAIRING ROLE (§3), NOT "I am the one starting".
    /// See `Bootstrap::own`. §6.3 has either party create a session whenever it has
    /// no usable state, so a role-J device calls this routinely and must still use
    /// `idk_J`.
    pub fn initiate(root: &[u8], session_id: &[u8], role: &str) -> Result<LpmSession, JsError> {
        let role = Role::parse(role)?;
        let root = root32(root)?;
        let session_id = session_id16(session_id)?;
        let b = Bootstrap::derive(&root, session_id);
        let me = account_from_derived(b.own(role), None)?;
        let peer_idk = Curve25519PublicKey::from(&Curve25519SecretKey::from_slice(b.peer(role)));
        let peer_otk = Curve25519PublicKey::from(&Curve25519SecretKey::from_slice(&b.otk));
        let session = me
            .create_outbound_session(SessionConfig::version_1(), peer_idk, peer_otk)
            .map_err(|e| JsError::new(&format!("outbound session: {e}")))?;
        Ok(Self { session })
    }

    /// Accept the first message on a session and return its plaintext (§6.2).
    ///
    /// ⚠️ `role` IS THIS DEVICE'S PAIRING ROLE, as above. §6.2's single `otk` is
    /// per-`session_id` rather than per-role, so it belongs to whichever party is
    /// RESPONDING on that session — which is this one, whatever its pairing role.
    pub fn accept(
        root: &[u8],
        session_id: &[u8],
        message: &str,
        role: &str,
    ) -> Result<LpmAccepted, JsError> {
        let role = Role::parse(role)?;
        let root = root32(root)?;
        let session_id = session_id16(session_id)?;
        let b = Bootstrap::derive(&root, session_id);
        let mut me = account_from_derived(b.own(role), Some(&b.otk))?;
        let peer_idk = Curve25519PublicKey::from(&Curve25519SecretKey::from_slice(b.peer(role)));
        let prekey = match decode(message)? {
            OlmMessage::PreKey(p) => p,
            OlmMessage::Normal(_) => {
                return Err(JsError::new("first message must be a pre-key message"))
            }
        };
        let created = me
            .create_inbound_session(SessionConfig::version_1(), peer_idk, &prekey)
            .map_err(|e| JsError::new(&format!("inbound session: {e}")))?;
        Ok(LpmAccepted {
            session: Some(LpmSession { session: created.session }),
            plaintext: created.plaintext,
        })
    }

    /// ⚠️ `plaintext` is the §6.5 **padded byte string**, not text — see rule 3
    /// at the top of this file.
    pub fn encrypt(&mut self, plaintext: &[u8]) -> Result<String, JsError> {
        let m = self
            .session
            .encrypt(plaintext)
            .map_err(|e| JsError::new(&format!("encrypt: {e}")))?;
        encode(&m)
    }

    pub fn decrypt(&mut self, message: &str) -> Result<Vec<u8>, JsError> {
        let m = decode(message)?;
        self.session
            .decrypt(&m)
            .map_err(|e| JsError::new(&format!("decrypt: {e}")))
    }

    /// vodozemac's own session identifier, which is **not** §6.3's `session_id`.
    /// Exposed under an unambiguous name so the two can never be confused.
    #[wasm_bindgen(js_name = olmSessionId)]
    pub fn olm_session_id(&self) -> String {
        self.session.session_id()
    }

    /// Persist. The pickle key is a device-held key (§7.5), never `R`.
    pub fn pickle(&self, pickle_key: &[u8]) -> Result<String, JsError> {
        let mut key = key32(pickle_key, "pickle key")?;
        let out = self.session.pickle().encrypt(&key);
        key.zeroize();
        Ok(out)
    }

    pub fn unpickle(pickle: &str, pickle_key: &[u8]) -> Result<LpmSession, JsError> {
        let mut key = key32(pickle_key, "pickle key")?;
        let p = vodozemac::olm::SessionPickle::from_encrypted(pickle, &key);
        key.zeroize();
        let p = p.map_err(|e| JsError::new(&format!("unpickle: {e}")))?;
        Ok(Self { session: Session::from_pickle(p) })
    }
}

/// The result of accepting a first message: the session, plus its plaintext.
///
/// ⚠️ **`takeSession` is a method and not a getter, and that is a fix, not a
/// style choice.** The spike exposed it as `#[wasm_bindgen(getter)] fn
/// session(self)`, which *moves* the Rust value: reading `accepted.session`
/// twice — or reading it before `accepted.plaintext` — dropped the object and
/// the next access trapped with "null pointer passed to rust". Property access
/// that works or traps depending on the order it appears in is not something a
/// caller can be expected to know. Now the ownership transfer is visible in the
/// name, and a second call is a plain error.
#[wasm_bindgen]
pub struct LpmAccepted {
    session: Option<LpmSession>,
    plaintext: Vec<u8>,
}

#[wasm_bindgen]
impl LpmAccepted {
    #[wasm_bindgen(js_name = takeSession)]
    pub fn take_session(&mut self) -> Result<LpmSession, JsError> {
        self.session
            .take()
            .ok_or_else(|| JsError::new("takeSession() has already been called on this result"))
    }

    /// The §6.5 padded byte string, for the same reason `encrypt` takes one.
    #[wasm_bindgen(getter)]
    pub fn plaintext(&self) -> Vec<u8> {
        self.plaintext.clone()
    }
}

/// The four public keys a pre-key message carries in the clear, as b64u.
///
/// Everything here is already on the wire — this reveals nothing a passive
/// observer does not have. It exists for two checks that cannot be made
/// otherwise:
///
/// **`oneTimeKey` and `identityKey` are the external anchor.** They are the keys
/// §6.2 derives from `R`, and a second implementation (Node's HKDF and X25519,
/// in `test/upgrade.mjs`) can compute them from `R` alone and compare. That is
/// the only check in this crate that does not consult this crate for the answer,
/// and it is what catches a vodozemac release that *reinterprets* the same
/// 32 bytes — clamping them differently, say — which every self-referential
/// guard in `account_from_derived` would sail straight past.
///
/// **`ratchetKey` vs `baseKey` is a weak alias guard.** If those two are ever the
/// same value, §6.2's exposure analysis changes, because the base key is public.
/// ⚠️ **It does NOT detect derivation, and an earlier comment claimed it did.** A
/// `T_0` *derived* from the base key is not *equal* to it, so the assertion would
/// pass while the property it guards was gone — and if the derivation used public
/// base-key material, an observer could compute the `T_0` private key and the
/// next ratchet DH. **Dependency upgrades require inspecting vodozemac's `T_0`
/// generation path, not running this.**
///
/// Shipped rather than kept behind a test-only feature, so the bytes the tests
/// exercise are the bytes the client serves. One artefact, one hash.
#[wasm_bindgen(js_name = prekeyPublicKeys)]
pub fn prekey_public_keys(message: &str) -> Result<String, JsError> {
    let prekey: PreKeyMessage = match decode(message)? {
        OlmMessage::PreKey(p) => p,
        OlmMessage::Normal(_) => return Err(JsError::new("not a pre-key message")),
    };
    Ok(json!({
        "identityKey": b64u_encode(&prekey.identity_key().to_bytes()),
        "baseKey":     b64u_encode(&prekey.base_key().to_bytes()),
        "oneTimeKey":  b64u_encode(&prekey.one_time_key().to_bytes()),
        "ratchetKey":  b64u_encode(&prekey.message().ratchet_key().to_bytes()),
    })
    .to_string())
}
