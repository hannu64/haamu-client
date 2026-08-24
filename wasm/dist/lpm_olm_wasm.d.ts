/* tslint:disable */
/* eslint-disable */

/**
 * The result of accepting a first message: the session, plus its plaintext.
 *
 * ⚠️ **`takeSession` is a method and not a getter, and that is a fix, not a
 * style choice.** The spike exposed it as `#[wasm_bindgen(getter)] fn
 * session(self)`, which *moves* the Rust value: reading `accepted.session`
 * twice — or reading it before `accepted.plaintext` — dropped the object and
 * the next access trapped with "null pointer passed to rust". Property access
 * that works or traps depending on the order it appears in is not something a
 * caller can be expected to know. Now the ownership transfer is visible in the
 * name, and a second call is a plain error.
 */
export class LpmAccepted {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    takeSession(): LpmSession;
    /**
     * The §6.5 padded byte string, for the same reason `encrypt` takes one.
     */
    readonly plaintext: Uint8Array;
}

/**
 * One direction of one channel: an Olm session and nothing else.
 */
export class LpmSession {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Role J (§6.2). Accepts the first message and returns its plaintext.
     */
    static accept(root: Uint8Array, session_id: Uint8Array, message: string): LpmAccepted;
    decrypt(message: string): Uint8Array;
    /**
     * ⚠️ `plaintext` is the §6.5 **padded byte string**, not text — see rule 3
     * at the top of this file.
     */
    encrypt(plaintext: Uint8Array): string;
    /**
     * Role I (§6.2). Starts a session with no round trip and no key directory —
     * the responder's keys come out of `R`.
     */
    static initiate(root: Uint8Array, session_id: Uint8Array): LpmSession;
    /**
     * vodozemac's own session identifier, which is **not** §6.3's `session_id`.
     * Exposed under an unambiguous name so the two can never be confused.
     */
    olmSessionId(): string;
    /**
     * Persist. The pickle key is a device-held key (§7.5), never `R`.
     */
    pickle(pickle_key: Uint8Array): string;
    static unpickle(pickle: string, pickle_key: Uint8Array): LpmSession;
}

/**
 * What this build is, so a client can say what cryptography it is running
 * rather than assert it. The vodozemac version comes out of `Cargo.lock` at
 * compile time (`build.rs`), so it cannot drift from what is linked.
 */
export function lpmBuildInfo(): string;

/**
 * The four public keys a pre-key message carries in the clear, as b64u.
 *
 * Everything here is already on the wire — this reveals nothing a passive
 * observer does not have. It exists for two checks that cannot be made
 * otherwise:
 *
 * **`oneTimeKey` and `identityKey` are the external anchor.** They are the keys
 * §6.2 derives from `R`, and a second implementation (Node's HKDF and X25519,
 * in `test/upgrade.mjs`) can compute them from `R` alone and compare. That is
 * the only check in this crate that does not consult this crate for the answer,
 * and it is what catches a vodozemac release that *reinterprets* the same
 * 32 bytes — clamping them differently, say — which every self-referential
 * guard in `account_from_derived` would sail straight past.
 *
 * **`ratchetKey` vs `baseKey` is a weak alias guard.** If those two are ever the
 * same value, §6.2's exposure analysis changes, because the base key is public.
 * ⚠️ **It does NOT detect derivation, and an earlier comment claimed it did.** A
 * `T_0` *derived* from the base key is not *equal* to it, so the assertion would
 * pass while the property it guards was gone — and if the derivation used public
 * base-key material, an observer could compute the `T_0` private key and the
 * next ratchet DH. **Dependency upgrades require inspecting vodozemac's `T_0`
 * generation path, not running this.**
 *
 * Shipped rather than kept behind a test-only feature, so the bytes the tests
 * exercise are the bytes the client serves. One artefact, one hash.
 */
export function prekeyPublicKeys(message: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_lpmaccepted_free: (a: number, b: number) => void;
    readonly __wbg_lpmsession_free: (a: number, b: number) => void;
    readonly lpmBuildInfo: (a: number) => void;
    readonly lpmaccepted_plaintext: (a: number, b: number) => void;
    readonly lpmaccepted_takeSession: (a: number, b: number) => void;
    readonly lpmsession_accept: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly lpmsession_decrypt: (a: number, b: number, c: number, d: number) => void;
    readonly lpmsession_encrypt: (a: number, b: number, c: number, d: number) => void;
    readonly lpmsession_initiate: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly lpmsession_olmSessionId: (a: number, b: number) => void;
    readonly lpmsession_pickle: (a: number, b: number, c: number, d: number) => void;
    readonly lpmsession_unpickle: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly prekeyPublicKeys: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export: (a: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export2: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export3: (a: number, b: number) => number;
    readonly __wbindgen_export4: (a: number, b: number, c: number, d: number) => number;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
