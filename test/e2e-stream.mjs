// Live delivery over real HTTP — PROTOCOL.md §5.3, ROADMAP Phase 1 step 6.
//
// Two paired clients, a real Go server, a real database, real Ed25519 signatures
// and a real event stream. A message is sent by one and appears at the other
// WITHOUT ANY POLL HAVING BEEN DUE — which is the whole claim of this step, and the
// one thing step 5's two-second timer made impossible to observe.
//
// ⚠️ ONE SUBSTITUTION, AND IT IS NAMED. Node 20 has no `EventSource`, so the
// `sse()` below reads the same wire format over `fetch`. It is a stand-in for the
// BROWSER, not for anything in `src/` — every byte it parses came off a socket from
// the real handler. What it cannot check is the browser-specific half of §5.3: that
// `close()` inside the `error` handler really does cancel `EventSource`'s own
// reconnect to the same URL with the same spent token. Only Chrome can answer that,
// and `client/demo` under puppeteer is where it is asked.

import { readFileSync } from "node:fs";
import { createApi } from "../src/net/api.js";
import { b64uEncode } from "../src/crypto/b64u.js";
import * as olm from "../src/crypto/olm.js";
import * as pairFlow from "../src/flow/pair.js";
import * as mailboxFlow from "../src/flow/mailbox.js";
import * as messageFlow from "../src/flow/message.js";
import * as liveFlow from "../src/flow/live.js";
import * as streamNet from "../src/net/stream.js";
import * as store from "../src/storage/sessions.js";
import { check, equal, section, done } from "./harness.mjs";

const BASE = process.env.LPM_BASE_URL || "http://127.0.0.1:8099";
const ORIGIN = "https://haamu.invalid";

const api = createApi({ baseUrl: BASE, timeoutMs: 20000 });
await olm.initOlm({ wasm: readFileSync(new URL("../wasm/dist/lpm_olm_wasm_bg.wasm", import.meta.url)) });

console.log(`server ${BASE}`);

// --------------------------------------------------------- the browser stand-in

/**
 * The minimum of `EventSource` that §5.3 uses: named events, `close()`, and an
 * `error` event when the connection fails. Deliberately WITHOUT auto-reconnect —
 * §5.3 forbids relying on it, so a stand-in that reconnected would be testing a
 * behaviour the product must never depend on.
 */
class FetchEventSource {
  constructor(url) {
    this.listeners = new Map();
    this.controller = new AbortController();
    this.opened = 0;
    void this.#run(url);
  }
  addEventListener(name, fn) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(fn);
  }
  close() {
    this.controller.abort();
  }
  #emit(name) {
    for (const fn of this.listeners.get(name) ?? []) fn({ type: name });
  }
  async #run(url) {
    try {
      this.opened++;
      const res = await fetch(BASE + url, { signal: this.controller.signal, cache: "no-store" });
      // §5.3: a refusal is a non-200, which is what makes a real browser give up
      // rather than retry a spent token for ever.
      if (!res.ok || !res.headers.get("content-type")?.startsWith("text/event-stream")) {
        this.status = res.status;
        this.#emit("error");
        return;
      }
      this.status = res.status;
      let buffer = "";
      for await (const chunk of res.body) {
        buffer += Buffer.from(chunk).toString("utf8");
        let cut;
        while ((cut = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const name = frame.match(/^event: (.+)$/m)?.[1];
          if (name) this.#emit(name);
        }
      }
      this.#emit("error"); // the stream ended
    } catch (err) {
      if (!this.controller.signal.aborted) this.#emit("error");
    }
  }
}

// ------------------------------------------------------------------ scaffolding

function memStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
  };
}

async function pairTwoClients() {
  let resolveLink;
  const linkReady = new Promise((r) => (resolveLink = r));
  const iRun = pairFlow.initiate({
    api,
    origin: ORIGIN,
    storage: memStorage(),
    onEvent: (e) => e.type === "link" && resolveLink(e.link),
  });
  const link = await linkReady;
  const jRun = pairFlow.join({ api, link, storage: memStorage() });
  const [i, j] = await Promise.all([iRun, jRun]);
  return { i, j };
}

function device(side, roster = { generation: 0 }) {
  return messageFlow.openChannel({
    api,
    backend: store.memoryBackend(),
    pickleKey: store.randomPickleKey(),
    channelRoot: side.channelRoot,
    role: side.role,
    generation: roster.generation,
    onGeneration: (g) => {
      roster.generation = g;
    },
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(what, predicate, ms = 15000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (predicate()) return true;
    await sleep(25);
  }
  return false;
}

// ================================================================= the claim

section("§5.3 — a message arrives without waiting for a poll");

const { i, j } = await pairTwoClients();
const sender = device(i);
const reader = device(j);

const arrived = [];
const states = [];
const held = liveFlow.startLive(reader, {
  eventSource: FetchEventSource,
  onMessages: (msgs) => arrived.push(...msgs),
  onState: (s) => states.push(s),
});

check("the reader goes live", await waitFor("live", () => held.state === liveFlow.LIVE));

// ⚠️ THE MEASUREMENT THAT MATTERS. `FLOOR_POLL_MS` is five minutes and
// `DEGRADED_POLL_MS` twenty seconds; anything that arrives in under a second
// arrived because of the stream and not because a timer came due.
const before = Date.now();
await messageFlow.send(sender, "kuka siellä");
const got = await waitFor("the message", () => arrived.length === 1, 10_000);
const latency = Date.now() - before;

check("⭐ it arrived", got);
equal("decrypted, from the sender's own words", arrived[0]?.payload?.text, "kuka siellä");
check(
  "⭐⭐ and it arrived in stream time, not poll time",
  latency < 2000 && latency < liveFlow.DEGRADED_POLL_MS,
  `${latency} ms, against a floor poll of ${liveFlow.FLOOR_POLL_MS / 1000} s`
);

// §5.4.1: the acknowledgement follows the caller taking delivery, so by now the
// server is holding nothing.
{
  const mailbox = await mailboxFlow.inboundNow(reader.channelRoot, reader.role);
  const left = await mailboxFlow.drain(api, mailbox);
  equal("and it was acknowledged, so the server kept nothing", String(left.length), "0");
}

section("§5.3 — several messages, one connection");

{
  const start = arrived.length;
  for (const text of ["yksi", "kaksi", "kolme"]) await messageFlow.send(sender, text);
  check("all three arrive", await waitFor("three", () => arrived.length === start + 3, 10_000));
  equal(
    "in order, on the session that is already open",
    arrived
      .slice(start)
      .map((m) => m.payload?.text)
      .join(","),
    "yksi,kaksi,kolme"
  );
  // One stream carried all of it: a client that re-minted per message would be
  // spending §9.2's tightest budget three times over.
  check("and the stream was opened once, not once per message", states.filter((s) => s.state === liveFlow.LIVE).length === 1);
}

section("§5.4.1 — what arrived while the stream was down");

{
  // ARCHITECTURE.md §4.4: "On reconnect, drain the mailbox by polling before
  // resuming the stream — messages may have arrived while disconnected." Here the
  // reader is stopped entirely, so no wake can reach it.
  held.stop();
  await sleep(200);
  const start = arrived.length;
  await messageFlow.send(sender, "kun et ollut paikalla");

  const resumed = liveFlow.startLive(reader, {
    eventSource: FetchEventSource,
    onMessages: (msgs) => arrived.push(...msgs),
  });
  check(
    "⭐ a message sent while disconnected is found by the drain, not by a wake",
    await waitFor("the missed message", () => arrived.length === start + 1, 10_000)
  );
  equal("and it is the right one", arrived.at(-1)?.payload?.text, "kun et ollut paikalla");
  resumed.stop();
  await sleep(100);
}

// ============================================================ the refusals

section("§5.3 — the token, against the real server");

{
  const mailbox = await mailboxFlow.inboundNow(reader.channelRoot, reader.role);
  const id = b64uEncode(mailbox.mailboxId);
  const { token, ttl } = await mailboxFlow.streamToken(api, mailbox);
  equal("§5.3's thirty seconds, from the server", String(ttl), "30");

  // Single-use, over real HTTP: the second request for the same URL is refused.
  const first = await fetch(BASE + streamNet.streamUrl(id, token), { cache: "no-store" });
  equal("the token opens a stream", String(first.status), "200");
  equal("as an event stream", first.headers.get("content-type")?.split(";")[0], "text/event-stream");
  const second = await fetch(BASE + streamNet.streamUrl(id, token), { cache: "no-store" });
  equal("⭐ and it does not open a second one", String(second.status), "401");
  // ⚠️ The refusal must NOT be a 200 carrying an error: a real `EventSource`
  // reconnects to the same URL for ever unless the response fails the connection,
  // and a spent token in that URL means a permanent, silent 401 loop.
  check(
    "the refusal is not itself an event stream, so a browser stops rather than looping",
    !second.headers.get("content-type")?.startsWith("text/event-stream")
  );
  await first.body.cancel();
  await second.body.cancel();

  const nobodys = await fetch(BASE + streamNet.streamUrl(id, "A".repeat(43)), { cache: "no-store" });
  equal("a token nobody minted is refused", String(nobodys.status), "401");
  await nobodys.body.cancel();

  // Bound to the mailbox it was minted for (§5.3). The OUTBOUND mailbox of this
  // channel is a different identifier, and this client holds its key too.
  const outbound = await mailboxFlow.outboundNow(reader.channelRoot, reader.role);
  await mailboxFlow.register(api, outbound);
  const fresh = await mailboxFlow.streamToken(api, mailbox);
  const crossed = await fetch(BASE + streamNet.streamUrl(b64uEncode(outbound.mailboxId), fresh.token), {
    cache: "no-store",
  });
  equal("⭐ a token minted for one mailbox does not open another's stream", String(crossed.status), "401");
  await crossed.body.cancel();
}

section("§5.3 — a mailbox that does not exist");

{
  // D-049, on the new endpoint: `mailbox_id` is a commitment to a key anyone can
  // generate, so minting for an absent mailbox would be free server state.
  const ghost = await mailboxFlow.inboundNow(reader.channelRoot, reader.role, Math.floor(Date.now() / 1000) + 4_000_000);
  let reason = null;
  try {
    await mailboxFlow.streamToken(api, ghost);
  } catch (err) {
    reason = err?.reason;
  }
  equal("minting for a mailbox nobody registered is refused", reason, "not_found");
}

done();
