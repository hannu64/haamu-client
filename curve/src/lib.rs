//! X25519 and Ed25519 for §0.2's fallback path.
//!
//! Five operations, which is every use the protocol has for these two curves:
//!
//!   §3.1, §3.2  an ephemeral X25519 public key from a 32-byte private key
//!   §3.3        `dh = X25519(own_priv, peer_pub)`
//!   §4.2, §7.2  an Ed25519 public key from a 32-byte seed
//!   §5.2        a signature over the canonical request
//!   —           verification, which the client does not do in MVP but must be
//!               able to do, or it cannot tell a broken signer from a broken
//!               server (see `src/crypto/ed25519.js`)
//!
//! There is deliberately **no key generation**: §3.1's ephemeral keypair is a
//! random 32-byte seed, and the seed is drawn on the JavaScript side by the same
//! `randomBytes` the WebCrypto path uses. This module imports nothing, so it
//! could not read `crypto.getRandomValues` if it wanted to — and that is the
//! point rather than a limitation, because two paths through one source of
//! randomness is one fewer thing that can differ between two devices.
//!
//! ## The C ABI, and why there is no `wasm-bindgen`
//!
//! Same answer as `argon2/`: the glue is an ES module the registry caches
//! forever, it puts imports into a module whose emptiness is a stated property,
//! and for byte-in/byte-out functions it buys nothing. `test/curve.mjs` asserts
//! the import list is empty.
//!
//! ⚠️ **The buffers are static and the operations take no pointers.** The other
//! two crates hand out `lpm_alloc` pointers; this one cannot, and the difference
//! is lifetime. `argon2/` is instantiated for one derivation and dropped whole, so
//! it leaks its buffers on purpose. This instance lives for the whole session and
//! signs every request (§5.2) — an allocation per signature would be a leak that
//! grows with the length of a conversation. So there is one fixed buffer per role,
//! reached through `lpm_key`, `lpm_key2`, `lpm_msg` and `lpm_out`, and no
//! allocator is involved at any point. The module's linear memory is whatever
//! these four arrays need and never grows.
//!
//! ⚠️⚠️ **THAT MAKES THIS MODULE NON-REENTRANT, AND THE JAVASCRIPT SIDE IS WHAT
//! KEEPS IT SAFE.** Two operations in flight at once would overwrite each other's
//! input buffers. The rule that prevents it is in `src/crypto/curve.js`: the
//! sequence *write the buffers → call → read `lpm_out`* contains no `await`, and
//! JavaScript cannot interleave a synchronous block. This is not a comment
//! somewhere hoping to be read — `test/curve.mjs` runs concurrent operations with
//! different keys and checks every answer, so an `await` introduced into that
//! sequence later fails a test rather than corrupting a signature.
//!
//! ## Three rules, inherited from the other two crates
//!
//! 1. **No reachable panic.** `panic = "abort"` is set and a trap poisons the
//!    instance. Every failure a caller can provoke is a return code, and the only
//!    slicing here is over fixed-size arrays behind an explicit bound check.
//! 2. **No secret in an error.** A return code carries no value.
//! 3. **Secrets are erased on the way out.** §7.7's disclaimer is about
//!    JavaScript. `lpm_key` holds a private key or a seed, and it is zeroed
//!    before every operation that reads one returns, whatever the outcome was.

use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use x25519_dalek::{x25519, X25519_BASEPOINT_BYTES};
use zeroize::Zeroize;

/// Success. `lpm_ed25519_verify` returns this for an INVALID signature — see its
/// own documentation, which is the one place in this ABI where 0 is not "fine".
const OK: i32 = 0;
/// A length the caller passed is outside what this module accepts.
const ERR_ARGS: i32 = -1;
/// §3.3's all-zero shared secret: the peer public key has small order.
const ERR_SMALL_ORDER: i32 = -2;
/// An Ed25519 public key is not a valid point, so nothing can be verified
/// against it. Distinct from "the signature did not verify", because the two have
/// different causes and only one of them can be a peer's fault.
const ERR_PUBKEY: i32 = -3;

/// Every key, seed and public key in §0.2 is 32 bytes; every signature is 64.
const KEY_LEN: usize = 32;
const SIG_LEN: usize = 64;

/// The longest message this module will sign or verify.
///
/// §5.2's canonical request is seven short lines — a tag, a method, a path, three
/// base64url values and a decimal timestamp — and the longest one the protocol can
/// build is a few hundred bytes. 8 KiB is more than an order of magnitude of
/// headroom, and it is 8 KiB of static memory, so being generous costs nothing.
///
/// ⚠️ It is exported as `lpm_msg_max` rather than written down again in
/// JavaScript, because a limit copied into two files is a limit that will be
/// raised in one of them. And "more than the protocol can produce" is a claim
/// about §5.2 made in a comment, which no build reads — so `test/curve.mjs`
/// builds the longest canonical request the client can construct and checks it
/// against this number, read back out through `lpm_msg_max`.
const MAX_MSG: usize = 8192;

/// The four buffers, in one static so that there is exactly one place in this
/// crate where a mutable static is reached.
struct Buffers {
    /// 32 bytes. A private key, a seed, or a public key to verify with.
    key: [u8; KEY_LEN],
    /// 64 bytes. A peer public key (first 32) or a signature to check (all 64).
    key2: [u8; SIG_LEN],
    /// The message to sign or verify.
    msg: [u8; MAX_MSG],
    /// 64 bytes. A public key (32), a shared secret (32), a signature (64).
    out: [u8; SIG_LEN],
}

static mut BUFFERS: Buffers = Buffers {
    key: [0; KEY_LEN],
    key2: [0; SIG_LEN],
    msg: [0; MAX_MSG],
    out: [0; SIG_LEN],
};

/// The only path to `BUFFERS`.
///
/// Reached through a raw pointer rather than `&mut BUFFERS`, which is what Rust
/// 2024 requires and what this edition warns about. The aliasing rule it exists to
/// protect is kept by the module being single-threaded and non-reentrant — see the
/// second warning at the top of this file, and the test that holds it.
///
/// # Safety
///
/// The caller must not hold two of these at once. Every function below takes one,
/// uses it, and returns.
#[allow(clippy::mut_from_ref)]
unsafe fn buffers() -> &'static mut Buffers {
    &mut *core::ptr::addr_of_mut!(BUFFERS)
}

/// The 32-byte input buffer: a private key, a seed, or a public key.
#[no_mangle]
pub extern "C" fn lpm_key() -> *mut u8 {
    unsafe { buffers().key.as_mut_ptr() }
}

/// The 64-byte second input buffer: a peer public key (first 32) or a signature.
#[no_mangle]
pub extern "C" fn lpm_key2() -> *mut u8 {
    unsafe { buffers().key2.as_mut_ptr() }
}

/// The message buffer, `lpm_msg_max()` bytes long.
#[no_mangle]
pub extern "C" fn lpm_msg() -> *mut u8 {
    unsafe { buffers().msg.as_mut_ptr() }
}

/// How many bytes `lpm_msg` holds. Read, not assumed — see `MAX_MSG`.
#[no_mangle]
pub extern "C" fn lpm_msg_max() -> usize {
    MAX_MSG
}

/// The 64-byte output buffer. Written only on success.
#[no_mangle]
pub extern "C" fn lpm_out() -> *mut u8 {
    unsafe { buffers().out.as_mut_ptr() }
}

/// The public half of the X25519 private key in `lpm_key` → `lpm_out[0..32]`.
///
/// This is `X25519(k, 9)`, RFC 7748's own formulation, including the clamping of
/// `k` that RFC 7748 §5 specifies. WebCrypto clamps too, which is why the two
/// paths produce the same public key for the same 32 bytes — `test/curve.mjs`
/// checks that against WebCrypto rather than asserting it here.
#[no_mangle]
pub extern "C" fn lpm_x25519_public() -> i32 {
    unsafe {
        let b = buffers();
        let public = x25519(b.key, X25519_BASEPOINT_BYTES);
        b.out[..KEY_LEN].copy_from_slice(&public);
        b.key.zeroize();
    }
    OK
}

/// §3.3's `dh = X25519(own_priv, peer_pub)` → `lpm_out[0..32]`.
///
/// `lpm_key` is the private key, `lpm_key2[0..32]` is the peer public key.
///
/// ⚠️ The all-zero result is rejected here, and it is ALSO rejected in
/// `src/crypto/x25519.js` after the branch that chose this path. That is not
/// duplication by accident: the JavaScript check covers any implementation handed
/// to `installFallback`, including one that is not this crate, and this one gives
/// the caller a reason instead of a comparison. RFC 7748 §6.1 recommends the
/// check; in this protocol an all-zero result means a small-order peer key, which
/// can only arrive from a server substituting keys — the case §3.3's MACs also
/// catch.
#[no_mangle]
pub extern "C" fn lpm_x25519_dh() -> i32 {
    unsafe {
        let b = buffers();
        let mut peer = [0u8; KEY_LEN];
        peer.copy_from_slice(&b.key2[..KEY_LEN]);
        let shared = x25519(b.key, peer);
        b.key.zeroize();
        if shared.iter().fold(0u8, |acc, byte| acc | byte) == 0 {
            return ERR_SMALL_ORDER;
        }
        b.out[..KEY_LEN].copy_from_slice(&shared);
    }
    OK
}

/// RFC 8032 key generation from the 32-byte seed in `lpm_key` → `lpm_out[0..32]`.
///
/// §4.2's `(sk, pk) = Ed25519_keypair_from_seed(auth_seed_<dir>)`, and §7.2's
/// `roster_auth`. The private key IS the seed, so nothing is returned for it.
#[no_mangle]
pub extern "C" fn lpm_ed25519_public() -> i32 {
    unsafe {
        let b = buffers();
        let signing = SigningKey::from_bytes(&b.key);
        b.out[..KEY_LEN].copy_from_slice(signing.verifying_key().as_bytes());
        b.key.zeroize();
    }
    OK
}

/// §5.2's signature over `lpm_msg[..msg_len]`, with the seed in `lpm_key`
/// → `lpm_out[0..64]`.
#[no_mangle]
pub extern "C" fn lpm_ed25519_sign(msg_len: usize) -> i32 {
    unsafe {
        let b = buffers();
        if msg_len > MAX_MSG {
            // The seed is erased even on the refusal: the caller wrote it before
            // it knew the length was wrong, and this function is where it stops
            // being needed either way.
            b.key.zeroize();
            return ERR_ARGS;
        }
        let signing = SigningKey::from_bytes(&b.key);
        let signature = signing.sign(&b.msg[..msg_len]);
        b.out.copy_from_slice(&signature.to_bytes());
        b.key.zeroize();
    }
    OK
}

/// Verify `lpm_key2[0..64]` over `lpm_msg[..msg_len]` against the public key in
/// `lpm_key`.
///
/// ⚠️ **The return value is not the ABI's usual one.** `1` means the signature is
/// valid, `OK` (0) means it is invalid, and a negative value means the question
/// could not be asked. A caller that treats 0 as success would accept every
/// forgery, so `src/crypto/curve.js` compares against 1 and nothing else.
///
/// `lpm_key` is a PUBLIC key here, so it is not erased. Everything else in this
/// ABI that reads `lpm_key` erases it, and a reader who noticed the asymmetry has
/// noticed the right thing.
///
/// `verify_strict` is used rather than `verify`: it rejects small-order public
/// keys and takes the cofactorless equation, which is the stricter of the two
/// readings RFC 8032 permits. §0.2 records what that means for agreement with
/// WebCrypto — for every signature this protocol produces, nothing, because they
/// agree; for adversarial inputs, this path may refuse what another accepts. A
/// verifier that is stricter than its peers is the safe direction for a difference
/// to run in, and the client verifies nothing in MVP anyway.
#[no_mangle]
pub extern "C" fn lpm_ed25519_verify(msg_len: usize) -> i32 {
    unsafe {
        let b = buffers();
        if msg_len > MAX_MSG {
            return ERR_ARGS;
        }
        let verifying = match VerifyingKey::from_bytes(&b.key) {
            Ok(k) => k,
            Err(_) => return ERR_PUBKEY,
        };
        let mut sig = [0u8; SIG_LEN];
        sig.copy_from_slice(&b.key2);
        let signature = Signature::from_bytes(&sig);
        if verifying.verify_strict(&b.msg[..msg_len], &signature).is_ok() {
            1
        } else {
            OK
        }
    }
}
