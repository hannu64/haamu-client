//! Argon2id at §7.2's parameters, and nothing else.
//!
//!   K_master = Argon2id(P, salt, m=128MiB, t=3, p=1, out=32)
//!
//! `canonical()` and `salt = SHA256("lpm-roster-salt-v1" || P)` are NOT here.
//! They are in `client/src/protocol/passphrase.js`, where they are already
//! specified, tested and shared with everything else that hashes. This module
//! takes bytes and returns bytes: one function, no opinions about what they mean.
//!
//! ## The C ABI, and why there is no `wasm-bindgen`
//!
//! Three exported functions over exported linear memory:
//!
//!   `lpm_alloc(len) -> ptr`          reserve a buffer to write into
//!   `lpm_argon2id(...) -> i32`       0 on success, a code below on failure
//!   `lpm_heap_pages() -> i32`        64 KiB pages this instance has reached
//!
//! ⚠️ **The module imports nothing, and that is a property rather than an
//! accident.** It cannot call out, cannot reach the network, and cannot read
//! `crypto.getRandomValues` -- it is a pure function of the bytes handed to it,
//! and `test/argon2.mjs` asserts the import list is empty rather than trusting
//! this comment. `wasm-bindgen`'s glue would end that property, and its glue is
//! also a cached ES module, which would hold one instance alive for the life of
//! the page -- the opposite of what this crate is arranged to allow.
//!
//! ## Two rules, inherited from the Olm wrapper
//!
//! 1. **No reachable panic.** `panic = "abort"` is set and a trap poisons the
//!    instance. Every failure a caller can provoke is a return code.
//! 2. **No secret in an error.** A return code carries no value, which makes
//!    that easy here.
//!
//! ⚠️ §7.7's "zeroization is not achievable" is about JavaScript and does not
//! reach this file. The password and salt buffers are overwritten before this
//! function returns, and so is the Argon2 block array. The 32 output bytes are
//! not: the caller asked for them.

use argon2::{Algorithm, Argon2, Block, Params, Version};

/// The caller's two secret buffers, overwritten on every exit from `lpm_argon2id`.
///
/// ⚠️ IT EXISTS BECAUSE AN EARLY RETURN IS INVISIBLE AT THE PLACE THE WIPE IS
/// WRITTEN. `lpm_argon2id` had its `fill(0)` calls on the success path, below a
/// parameter check and a fallible allocation that both returned above them -- so the
/// two failures a caller can actually provoke were the two that kept the passphrase.
/// `Drop` cannot be forgotten by a future edit, which a fifth `return` statement can.
struct Wipe<'a> {
    password: &'a mut [u8],
    salt: &'a mut [u8],
}

impl Drop for Wipe<'_> {
    fn drop(&mut self) {
        self.password.fill(0);
        self.salt.fill(0);
    }
}

/// Success.
const OK: i32 = 0;
/// §7.2's parameters were rejected by the library (m, t, p or the output length).
const ERR_PARAMS: i32 = -1;
/// The block array could not be allocated -- see the note in `lpm_argon2id`.
const ERR_MEMORY: i32 = -2;
/// The hash itself failed. Not reachable for any input this client produces.
const ERR_HASH: i32 = -3;
/// A pointer or length the caller passed does not describe a usable buffer.
const ERR_ARGS: i32 = -4;

/// §7.2's output length. Fixed here rather than taken as an argument: the caller
/// has no business asking for a different `K_master`.
const OUT_LEN: usize = 32;

/// A ceiling on the inputs, so that a mistake on the JavaScript side is a code
/// and not a multi-gigabyte allocation. §7.4's phrase is ~50 bytes and the salt
/// is a SHA-256 output; a kilobyte is four times the longest thing §7.2 can hand
/// this function and small enough that being wrong costs nothing.
const MAX_INPUT: usize = 1024;

/// Reserve `len` bytes and return a pointer the caller may write to.
///
/// The allocation is deliberately leaked: this module is instantiated for one
/// derivation and then dropped whole, so a free list has nothing to be right
/// about. What matters is that the buffer stays put between the write and the
/// call, which `Vec::leak` guarantees and a returned `Vec` would not.
///
/// Returns a null pointer if the allocation fails or `len` is out of range.
#[no_mangle]
pub extern "C" fn lpm_alloc(len: usize) -> *mut u8 {
    if len == 0 || len > MAX_INPUT {
        return core::ptr::null_mut();
    }
    let mut v: Vec<u8> = Vec::new();
    if v.try_reserve_exact(len).is_err() {
        return core::ptr::null_mut();
    }
    v.resize(len, 0);
    v.leak().as_mut_ptr()
}

/// `K_master = Argon2id(password, salt, m_kib, t, p, out=32)`.
///
/// Writes 32 bytes to `out`. Returns `OK` or one of the codes above; on any
/// failure `out` is left untouched, so a caller that ignores the code cannot
/// mistake a half-written buffer for a key.
///
/// ⚠️ **THE BLOCK ARRAY IS ALLOCATED HERE RATHER THAN BY THE LIBRARY, AND THAT IS
/// THE DIFFERENCE BETWEEN A RESULT AND A DEAD TAB.** `Argon2::hash_password_into`
/// allocates 128 MiB internally and aborts if it cannot -- which in WASM is a trap
/// that poisons the instance. On the low-end phones §7.2's parameters were chosen
/// for, "128 MiB could not be allocated" is a likely and *reportable* outcome, so
/// it is reserved through `try_reserve_exact` and returned as `ERR_MEMORY`. The
/// spike that measured open item 2 learned this first.
///
/// # Safety
///
/// `password`, `salt` and `out` must point at buffers of the given lengths inside
/// this module's linear memory. They come from `lpm_alloc`, so the caller is
/// this crate's own JavaScript.
#[no_mangle]
pub unsafe extern "C" fn lpm_argon2id(
    password: *mut u8,
    password_len: usize,
    salt: *mut u8,
    salt_len: usize,
    m_kib: u32,
    t_cost: u32,
    p_cost: u32,
    out: *mut u8,
) -> i32 {
    if password.is_null() || salt.is_null() || out.is_null() {
        return ERR_ARGS;
    }
    if password_len == 0 || password_len > MAX_INPUT || salt_len == 0 || salt_len > MAX_INPUT {
        return ERR_ARGS;
    }

    // ⚠️⚠️ THE SLICES ARE TAKEN BEFORE ANYTHING THAT CAN FAIL, AND `Wipe` IS WHY.
    // Until 2026-08-24 they were created AFTER `Params::new` and after the memory
    // reservation, so the two early returns below left the caller's password and salt
    // sitting in linear memory -- on the low-memory device the `try_reserve_exact`
    // path exists to serve, which is the one case it was written for. The comment
    // under the hash said "whatever the outcome above was" and meant it, but the
    // outcomes it could see began after the allocation.
    //
    // ⭐ A GUARD RATHER THAN A `fill(0)` ON EACH RETURN. There are four exits from
    // here and a fifth is one edit away; `Drop` runs on all of them, including any
    // added later by somebody who has not read this paragraph.
    let wipe = Wipe {
        password: core::slice::from_raw_parts_mut(password, password_len),
        salt: core::slice::from_raw_parts_mut(salt, salt_len),
    };

    let params = match Params::new(m_kib, t_cost, p_cost, Some(OUT_LEN)) {
        Ok(p) => p,
        Err(_) => return ERR_PARAMS,
    };

    let mut memory: Vec<Block> = Vec::new();
    if memory.try_reserve_exact(params.block_count()).is_err() {
        return ERR_MEMORY;
    }
    memory.resize(params.block_count(), Block::default());

    let mut derived = [0u8; OUT_LEN];
    let result = Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
        .hash_password_into_with_memory(&*wipe.password, &*wipe.salt, &mut derived, &mut memory);

    // §7.7's exception. The password and salt are `Wipe`'s job now; the block array
    // is wiped here because it exists only on this path -- a reservation that failed
    // has nothing to clear, and a guard for it would be a guard over an empty `Vec`.
    for block in memory.iter_mut() {
        *block = Block::default();
    }

    if result.is_err() {
        derived.fill(0);
        return ERR_HASH;
    }
    core::ptr::copy_nonoverlapping(derived.as_ptr(), out, OUT_LEN);
    derived.fill(0);
    OK
}

/// The 64 KiB pages this instance's linear memory has reached.
///
/// Reported because the number that decides whether §7.2's parameters are viable
/// on a 2 GB phone is the footprint, not the duration -- and because the whole
/// argument for this crate being separate is that the footprint is permanent
/// within an instance. A caller can watch it grow and see that it never falls.
#[no_mangle]
pub extern "C" fn lpm_heap_pages() -> i32 {
    core::arch::wasm32::memory_size(0) as i32
}
