// The JavaScript side of the Olm wrapper — PROTOCOL.md §6.1, §6.2.
//
// `client/wasm/` is the wrapper itself (a Rust crate around vodozemac, D-031).
// This file is the only place that loads it and the only place that speaks its
// private message form, so that everything above sees §6.4's vocabulary and
// nothing else.
//
// ⚠️ TWO ENCODINGS MEET HERE AND NEITHER IS §6.4's.
//
//   • The library's message kind is a numeric `0:` / `1:` prefix; §6.4's `type`
//     is a name. The crate translates that one.
//   • The crate hands JavaScript a JSON string `{"type":…,"body":<b64u>}`. That
//     is NOT the envelope: §6.4's envelope also carries `v`, `session_id` and
//     `generation`, which the crate deliberately knows nothing about. This file
//     converts between the two so that `protocol/envelope.js` stays the single
//     place the wire format is built.
//
// ⚠️ A PLAINTEXT IS BYTES. §6.5 encrypts `LE32(true_length) || plaintext ||
// zeros`, which is not text — a 200-byte message begins `C8 00 00 00`. Measured
// 2026-08-11 against the wrapper's earlier `String` boundary: 256 padded bytes
// came back as 258, the `C8` having become U+FFFD, and §6.5's own bounds check
// then read a declared length of 12,435,439 out of a 254-byte buffer. There is no
// correct string reading of a byte string, so nothing here accepts one.

import { b64uDecode, b64uEncode } from "./b64u.js";

const GLUE = "../../wasm/dist/lpm_olm_wasm.js";
const WASM = "../../wasm/dist/lpm_olm_wasm_bg.wasm";

let mod = null;

/**
 * Load the wrapper. Idempotent — the second call returns the first module.
 *
 * The browser needs neither argument. Node has no `fetch` for `file:` URLs, so a
 * test passes the `.wasm` bytes it read off disk; that is the same artefact the
 * browser downloads, which is the rule `client/wasm/README.md` states as *the
 * tested bytes are the shipped bytes*.
 */
export async function initOlm({ glue, wasm } = {}) {
  if (mod) return mod;
  const loaded = glue ?? (await import(new URL(GLUE, import.meta.url).href));
  await loaded.default({ module_or_path: wasm ?? new URL(WASM, import.meta.url).href });
  mod = loaded;
  return mod;
}

function required() {
  if (!mod) throw new Error("olm: initOlm() has not been awaited");
  return mod;
}

/** What cryptography this client is actually running (§6.1), not what it claims. */
export function buildInfo() {
  return JSON.parse(required().lpmBuildInfo());
}

/** The crate's form → `{ type, body }` with the body as bytes. */
function fromCrate(json) {
  const m = JSON.parse(json);
  return { type: m.type, body: b64uDecode(m.body, "olm body") };
}

/** `{ type, body }` → the crate's form. */
function toCrate(message) {
  if (message?.type !== "prekey" && message?.type !== "normal") {
    throw new RangeError(`olm: message type must be "prekey" or "normal", got ${JSON.stringify(message?.type)}`);
  }
  if (!(message.body instanceof Uint8Array)) throw new TypeError("olm: message body must be bytes");
  return JSON.stringify({ type: message.type, body: b64uEncode(message.body) });
}

/**
 * One Olm session, held only for as long as an operation takes.
 *
 * ⚠️ NOTHING IN THIS CLIENT KEEPS A LIVE SESSION BETWEEN OPERATIONS, and that is
 * a rule rather than an oversight (`flow/message.js` states it in full). Both
 * `encrypt` and `decrypt` advance the ratchet, so a live object and a stored
 * pickle disagree the moment either is used, and the disagreement is silent until
 * a reload picks the older of the two. Unpickle, use, re-pickle, free.
 */
export class OlmSession {
  constructor(inner) {
    this.inner = inner;
  }

  /** §6.5's padded byte string in, §6.4's `{ type, body }` out. */
  encrypt(padded) {
    if (!(padded instanceof Uint8Array)) throw new TypeError("olm: encrypt takes the padded plaintext as bytes");
    return fromCrate(this.inner.encrypt(padded));
  }

  /** §6.4's `{ type, body }` in, §6.5's padded byte string out. */
  decrypt(message) {
    return this.inner.decrypt(toCrate(message));
  }

  /** vodozemac's own identifier, which is NOT §6.3's `session_id` (§6.3 warns). */
  olmSessionId() {
    return this.inner.olmSessionId();
  }

  /** Persist. The pickle key is a device-held key (§7.5), never `R`. */
  pickle(pickleKey) {
    return this.inner.pickle(pickleKey);
  }

  /** Release the WASM object. Using the session afterwards is an error. */
  free() {
    this.inner.free();
    this.inner = null;
  }
}

/** Role I (§6.2): start a session from `R` alone, with no round trip. */
export function initiate(channelRoot, sessionId) {
  return new OlmSession(required().LpmSession.initiate(channelRoot, sessionId));
}

/**
 * Role J (§6.2): accept a pre-key message and read it.
 *
 * ⚠️ CALL THIS ONLY WHEN NO SESSION EXISTS FOR THIS `session_id`. Accepting the
 * same pre-key message twice succeeds and rebuilds the session at ratchet zero —
 * measured 2026-08-11, and it is what §6.3's replay rule is about. A pre-key
 * message for a session this device already holds is an ordinary message on that
 * session and must go to `decrypt`.
 */
export function accept(channelRoot, sessionId, message) {
  const accepted = required().LpmSession.accept(channelRoot, sessionId, toCrate(message));
  try {
    return { session: new OlmSession(accepted.takeSession()), plaintext: accepted.plaintext };
  } finally {
    accepted.free();
  }
}

/** Restore a persisted session (§7.5's device key, not `R`). */
export function unpickle(pickle, pickleKey) {
  return new OlmSession(required().LpmSession.unpickle(pickle, pickleKey));
}
