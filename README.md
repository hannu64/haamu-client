# haamu

**haamu** is a messenger with no accounts. There is no phone number, no email
address, no username and no password — two people pair by sending each other a
link, and what identifies you afterwards is eight words you write down: your
**KEY**. Messages are end-to-end encrypted with Olm (the double ratchet), and the
server is never given anything it could read.

It runs at **https://haamu.app**, in Finnish at **https://haamu.app/fi**.

This repository is the **client** — every line of code that runs in your browser,
which is the half that holds your keys and does the encrypting. It is published so
that the claims above can be checked rather than believed.

---

## ⭐ Verify it in thirty seconds

You do not have to read this code to get something out of it being here. The most
useful thing you can do takes one command, and it answers the question that
actually matters: **is the site serving the code in this repository, or something
else?**

```sh
git clone https://github.com/hannu64/haamu-client && cd haamu-client

FILES=$(find app src argon2/dist curve/dist wasm/dist -type f ! -name build.js)
for f in $FILES; do
  code=$(curl -sL -o .live.chk -w '%{http_code}' "https://haamu.app/$f")
  { [ "$code" = 200 ] && cmp -s .live.chk "$f"; } || echo "MISMATCH ($code): $f"
done; rm -f .live.chk; echo "checked $(echo "$FILES" | wc -l) files"
```

Silence means every file haamu.app serves is byte-identical to the one here.
(`app/build.js` is excluded on purpose: it carries the build stamp, so it differs
by construction.)

⚠️ **The status code is checked before the bytes, deliberately.** An empty body has
a perfectly good hash, so a check that compares content alone reports a missing
file as one that merely "differs" — and `-L` is needed because Go's file server
answers `app/index.html` with a 301 to `app/`. Both of those made the first run of
this very command report a failure that was not one.

**That check is possible because there is no build step for the JavaScript** — no
bundler, no transpiler, no minifier. The file you read is the file the browser
runs. That is a deliberate decision and its reasoning is below.

### The three WASM artefacts, which *are* built

Rust cannot be shipped without a build, so the cryptographic crates are verified
one step differently — a hash, or a rebuild if you want to go further:

```sh
# hash what the live site serves, and compare with the committed sums
curl -s https://haamu.app/wasm/dist/lpm_olm_wasm_bg.wasm | sha256sum
cat wasm/SHA256SUMS

# or rebuild from source: the toolchain is pinned in rust-toolchain.toml
./wasm/build.sh && ( cd wasm/dist && sha256sum -c ../SHA256SUMS )
```

`dist/` is committed **in this repository only**. In the private development repo
it is gitignored, because a build product does not belong in a source tree — but
here it is the whole point, so that checking costs a hash rather than a weekend.

## The licence

**GNU AGPL-3.0-only.** See [LICENSE](LICENSE). Copyright © Zumitomi Oy.

If you run a modified version of this client as a network service, the AGPL
requires you to offer your users its source. That is the intent: fork it, learn
from it, improve it — but a service built on it should be as checkable as this one.

## What is here, and what is not

| | |
|---|---|
| **here** | the entire browser client — crypto, protocol, storage, interface, and its test suites |
| **here** | `DECISIONS.md` — 163 numbered decisions with the argument for each, including the ones that were rejected |
| **not here** | the server (Go), its database migrations, and the deployment configuration |

**The server is deliberately closed, and this concedes no security claim.** It
receives a mailbox id, a public value and a ciphertext; it cannot read a message,
and the client is written on the assumption that it is hostile. Everything you
would want to audit — key derivation, the pairing handshake, the ratchet, what
reaches disk, what leaves the device — is in this repository. If the server were
malicious, the code here is what would have to fail for it to matter, and that is
the code you can read.

⚠️ **This has not been audited by a professional security firm.** It has had two
rounds of outside review of its protocol across three independent models, and one
outside review of its cryptographic wrapper. That is not the same thing, and it is
not claimed to be.

## Reporting a security issue

Found something? Please email **support@zumitomi.fi** first, before opening
anything in public — so the flaw cannot be exploited before it is fixed. We aim to
fix reported issues within a few days, and we are glad to credit you publicly if
you would like. If four days (96 hours) pass without a fix, you are free to
disclose it publicly.

## Where the reasoning lives

`DECISIONS.md` is the document to read if you want to know *why* rather than
*what*. It is not a changelog: each entry is a question that was open, what was
decided, and the argument — with the rejected alternatives kept in place so that
nobody re-opens a settled question without meeting the reason it was settled.

The normative specification (`PROTOCOL.md`, `ARCHITECTURE.md`) is referenced
throughout the code by section number. It is not in this repository yet.

---

# The client

```
src/crypto      the primitives of PROTOCOL.md §0.2, plus the JS side of the wrapper
src/protocol    one file per PROTOCOL.md section — the arithmetic, pure
src/net         the only place this client makes a request
src/flow        the ORDER of a multi-step exchange — where §3's and §6's security
                lives: what is true if the process ends between two steps, what is
                true if a SECOND TAB is doing it too (`tabs.js`), and what §7.8's
                ending has to do in which order (`ending.js`)
src/storage     what reaches disk: the record, the store it goes in, the key it is
                sealed under (§7.2's `local_key`), and the conditional write that
                makes a database shared by every tab safe (§5.4.3a)
src/ui          every sentence the product says, built from its constants
wasm/           the Olm layer (vodozemac + our wrapper) — its own README
argon2/         §7.2's Argon2id, a second crate and a second artefact — its own README
curve/          §0.2's X25519/Ed25519 fallback, a third one — its own README. Only
                fetched by browsers that have no WebCrypto alternative
app/            the interface (step 8), plus §7.8's landing page (`ended.html`),
                which is deliberately inert: no database, no key, no request
test/           the suites below, plus the end-to-end ones
```

**`/protocol` and `/flow` are separate on purpose.** `/protocol` computes; it has
no idea what order anything happens in. `/flow` decides the order, and the order is
what protocol 0.8.5 changed: five messages instead of four, because the initiator
publishing its key first let a relaying attacker grind the six-digit short
authentication string. Three checks in `/flow/pair.js` are the difference between a
paired channel and a relayed one, and each returns a boolean that every call site
branches on.

⭐⭐ **Step 6 is the clearest case yet, and it is in `stream.mjs`.** §5.3's client
rules are all about situations nobody can arrange on demand: a network that accepts
connections and drops them two seconds later, a socket that is open and
black-holed, an epoch boundary that arrives once a week. Each is a pure function
over a number there — and the one that matters most is arithmetic, not behaviour:
with the backoff resetting on `open` instead of on health, a correct client mints
tokens as fast as the round trip allows. The suite computes the worst sustained rate
(160/hour) and compares it with the server's limit (240), which is a thing a running
system would take a week of bad wifi to tell you.

⭐ **Step 5 made the same split earn its keep twice over.** §6.3's rules are pure
functions in `protocol/session.js`, which is what makes the awkward cases *writable*
— a simultaneous split, a device whose own state is gone, a generation that went
backwards. Through the network each needs a scenario and some cannot be provoked on
demand. `flow/message.js` then holds two orderings that run in opposite directions
(§5.4.3): **persist before transmit**, because encrypting spends a message key and
using one twice is a confidentiality break; **persist before acknowledge**, because
decrypting is not a repeatable read.

`ARCHITECTURE.md` §4 makes the shape of these two directories a design constraint
rather than a preference: *"/crypto and /protocol must be readable by an auditor
who has this specification open beside them. Function names should match the
section names."* The audience for this product includes people who will actually
do that.

## No dependencies, no build step

`src/` is ES modules and WebCrypto. There is no npm dependency, no bundler and no
transpiler — `package.json` exists only to tell Node that `.js` here means ESM.

That is a decision, not an omission. `ARCHITECTURE.md` §7.1 makes a reproducible
build a release blocker, and every tool between the source and the browser is
another input that has to be pinned, asserted and re-verified on every release.
The WASM crate needs that machinery because Rust cannot be shipped without it; the
JavaScript does not, so the file an auditor reads is the file the browser runs.

## Running the tests

    ./test.sh                 # all of them, in the order a failure is easiest to read

    node test/rfc.mjs         # the primitives, against published RFC vectors
    node test/unit.mjs        # the refusals and bounds checks
    node test/session.mjs     # §6.3's session rules and §6.7's payload, pure
    node test/stream.mjs      # §5.3's transport policy — backoff, watchdog, boundary
    node test/roster.mjs      # §7.3's merge rules, freshness and padding, pure
    node test/vectors.mjs     # src/ against the frozen protocol vectors
    ( cd ../server && go test ./internal/api/ -run TestProtocolVectors )

    ../e2e.sh                 # pair, mailboxes, encrypted messages, live delivery
    ../e2e.sh --serve         # leave it running, with the app, for two browsers

    ./wasm/test.sh            # the Olm wrapper, built reproducibly and then checked
    ./argon2/test.sh          # §7.2's Argon2id, likewise
    ./curve/test.sh           # §0.2's fallback — and then AGAINST WebCrypto

⚠️ The message suite and the app load `wasm/dist/`, the roster suite loads
`argon2/dist/`, and a browser without X25519 loads `curve/dist/`. All three are
**gitignored in the development repository** because they are derived — run each
`build.sh` on a fresh clone first. ⭐ In the **public** repository they are
committed, so that verifying the live site costs a hash instead of a Rust
toolchain; see "Verify it in thirty seconds" above.

## Why there are this many suites

⭐ Because of what the WASM wrapper measured on 2026-08-11: with §6.2's HKDF
output reversed, its 25-check functional suite passed **25 of 25**. A suite that
only ever talks to itself will certify a completely broken derivation. Each suite
here is anchored to something the code cannot move.

⭐⭐ **And because of what step 7 measured: the end-to-end roster suite passed with
§7.3.1's merge REMOVED ENTIRELY.** Its check that "neither write was lost" is
satisfied by the compare-and-swap loop alone — the loser refetches and re-applies
its own intention against fresh state, reaching the same answer by a different
route. Two mechanisms, one visible outcome, and the test could not say which was
doing the work. The merge rules are therefore tested in `roster.mjs` as the pure
function they are, where a broken rule fails immediately. **A test that passes
under sabotage is not a weak test; it is a different test than the one you thought
you wrote.**

| suite | anchored to | catches |
|---|---|---|
| `rfc.mjs` | RFC 4648, 4231, 5869, 7748, 8032 | a primitive that is not the primitive it claims to be |
| `unit.mjs` | the specification's own warnings | a refusal that stopped refusing |
| `vectors.mjs` | `test/vectors/lpm.json`, frozen 2026-08-11 | a derivation that quietly moved |
| the Go test | **a second implementation, in another language** | client and server disagreeing about bytes |
| `e2e-pair.mjs` | **two processes over real HTTP** | client and server disagreeing about the *order* |
| `e2e-mailbox.mjs` | **a real server's real `Date` header** | the wrong-clock diagnosis §5.2 requires, which no in-process test can exercise |
| `roster.mjs` | §7.3.1's five merge rules, as pure functions | a rule that stopped resolving anything — see below |
| `argon2/test/argon2.mjs` | **`K_master` measured on six real devices**, through a different crate | a key derivation that quietly moved, which is a lost roster |
| `curve/test/curve.mjs` | **WebCrypto itself, on the same inputs** — every §0.2 vector twice, once per implementation | two devices in one conversation deriving different secrets, which shows up on somebody's phone and nowhere else |
| `session.mjs` | the specification's own rules, as pure functions | a §6.3 case that cannot be provoked on demand through a network |
| `e2e-message.mjs` | **two Olm accounts derived independently from one `R`** | §6.2's bootstrap failing across the WASM boundary, and every ordering rule that only matters when a step does not complete |
| `stream.mjs` | arithmetic: a rate limit, a clock bound, an epoch length | a §5.3 policy whose consequence is a week or an hour away — a flapping network, a black-holed socket, a boundary that arrives once a week |
| `e2e-stream.mjs` | **elapsed time against a poll interval** | live delivery that is not live: the claim is that a message arrives in tens of milliseconds where the floor poll is five minutes |
| `storage.mjs` | §7.8's two categories and §6.6's timer | a record that reached disk in the clear, a ciphertext that opens in the wrong slot, an ending that took §7.3.2's high-water mark with it |
| `copy.mjs` | **the constants the sentences describe** | prose that kept saying the old number, and a claim §7.7, §7.8, §7.3.1a, §6.6 or §11 forbids — the only suite that reads English |
| `ending.mjs` | **§7.8's ORDER, recorded as a sequence** | an ending that clears the database while its own drain is still writing to it, a key sweep that misses the Ed25519 seed one level down, and a bfcache restore that shows the conversation again. ⚠️ It asserts on the SEQUENCE, not the end state — a check of the end state passes on the broken order |
| `tabs.mjs` | Web Locks and `BroadcastChannel`, **modelled** | §4.2's election picking two leaders or none, and §7.8 step 3's ending claiming a whole browser it only checked one tab of. ⚠️ It checks the POLICY; the platform guarantees beneath it — that a readwrite transaction is isolated across documents, that a lock is released when a tab is killed — are the browser's to keep, and are asked for in a browser |

The last two are the ones that matter most. §5.2 spends a page on a single failure
— client and server building the canonical signing string differently, so every
request 401s, *intermittently at first* — and no amount of care inside one
codebase can catch it. `client/test/vectors/lpm.json` is read by both ends.

⚠️⚠️ **The vectors are frozen. Do not regenerate them to make a failing test
pass.** A regenerated vector agrees with the new code by construction and tests
nothing. `test/gen-vectors.mjs` says so at the top and refuses to write anything
the two implementations disagree on.

**The one legitimate reason to re-freeze is a deliberate change to `PROTOCOL.md`
itself**, recorded in its §13 and dated in the vector file. That has happened
twice, both on 2026-08-11:

- **0.8.4 → 0.8.5**, when §3 became commit-then-reveal because implementing §3.6
  showed the six-digit short authentication string could be **ground to match in
  seconds** under the old flow (§3.6.1, D-046). Only `commit_i`, `mac_offer` and
  `mac_claim` moved.
- **0.8.6 → 0.8.7**, when §5.2's credential gained `key=` so that §5.1's
  authenticated read of a mailbox that does not exist could actually be performed
  (D-049). **Three lines changed, all of them `authorization`, each gaining a
  `,key=` suffix equal to the `public_key` already recorded beside it.** Every
  canonical string and every signature is byte-identical, which is exactly what
  should happen: the key is outside the signature.

In both cases the values that did *not* move are the evidence that the change was
scoped to the section it claimed. **A re-freeze that touches values the change
should not have reached is a bug report, not a merge conflict.**

**Measured, not argued.** With §4.2's info string reverted to the withdrawn
`LE64(e)` form — the encoding defect that would not surface until epoch 2944 —
`rfc.mjs` passed 44/44 and `unit.mjs` passed 85 of 86, its one failure an
incidental change of error message. `vectors.mjs` failed 26 checks naming every
derivation that moved, and the Go test failed with both keys printed. Sabotaging
the *server's* side instead produced the same result from the other direction.

## What is here, and what is not

| file | PROTOCOL.md |
|---|---|
| `crypto/` | §0.2's primitives: b64u, SHA-256, HMAC, HKDF, AES-256-GCM, X25519, Ed25519, CSPRNG |
| `protocol/pairing.js` | §2 the link, §3 the handshake (**commit-then-reveal**, 0.8.5), §3.6 the short authentication string |
| `protocol/code.js` | §2.2 the spoken code, §2.2b its spelling, §2.2c the `L` it makes — 80 bits where §2.1 has 128 |
| `net/api.js` | §2 of `ARCHITECTURE.md` — every request, with `credentials: "omit"` and a deadline |
| `flow/pair.js` | §3 end to end: both roles, the three checks, §3.4.1's storage, §3.5's tripwire |
| `flow/mailbox.js` | §5 end to end: §5.1's two-trip registration, §5.5's send and delivery state, §5.4.1's drain-and-acknowledge, §4.1's three-epoch poll, §5.3's mint |
| `net/stream.js` | §5.3's transport: one connection, the watchdog, and the backoff that resets on health rather than on success |
| `flow/live.js` | §5.3 end to end: one stream per channel, the drain it triggers, the floor poll that must never stop, and the registration that lets a stream be opened at all |
| `protocol/epoch.js` | §4.1 |
| `protocol/mailbox.js` | §4.2 |
| `protocol/signing.js` | §5.2 |
| `crypto/olm.js` | §6.1's library boundary — the only place the wrapper's own message form is spoken |
| `protocol/envelope.js` | §6.4, §6.5 |
| `protocol/payload.js` | §6.6, §6.7 |
| `protocol/session.js` | §6.3's rules, pure |
| `storage/sessions.js` | the record §5.4.3's atomic write is made of |
| `flow/message.js` | §6 end to end: the session, the envelope, the two orderings, §5.4.2's counters |
| `protocol/passphrase.js` | §7.2, §7.4 |
| `protocol/wordlist.js` | §7.4's EFF short list #1, frozen |
| `protocol/roster.js` | §7.3's encoding |
| `protocol/pow.js` | §9.1 |
| `storage/db.js`, `storage/vault.js` | §4.1's storage table and §7.2's `local_key`; §5.4.3a's conditional write |
| `flow/tabs.js` | `ARCHITECTURE.md` §4.2's election and §7.8.1's census |
| `flow/ending.js`, `flow/lock.js` | §7.8's order, §7.7's overwrite, §4.3's idle lock |
| `flow/ghost.js` | §7.6 end to end: the store, the minted lock name, the message log its list omitted |
| `ui/copy.js` | every sentence the product says, with every number interpolated from its constant (D-064) — **and since 2026-08-13 that is enforced rather than intended: `test/copy.mjs` reads `app/*.html` and `app/app.js` and fails on any user-facing string they wrote themselves** |

Deliberately absent, each a later ROADMAP step rather than an oversight:

- **Argon2id** (§7.2). ✅ **Landed in step 7** — `client/argon2/`, its own zero-import
  Rust crate, installed into the seam by `app/app.js` and nowhere else.
- **The X25519/Ed25519 WASM fallback** (§0.2). ✅ **Landed in step 12** —
  `client/curve/`, a third zero-import Rust crate, reached through `crypto/curve.js`
  and loaded only after `ensurePrimitives()` has asked for it, so a browser with both
  primitives fetches nothing. §0.2's detection is now called from `app/app.js` at
  boot, which it never was before. ⚠️ Filling this hook is what exposed **D-076**:
  every length and validity check in `x25519.js`/`ed25519.js` sat *below* the branch
  that chooses an implementation, so for ten steps they covered only the path a
  developer runs. They are above it now, and `test/unit.mjs` pins that with a
  deliberately hostile stub implementation rather than with a comment.
- **Multi-tab** (ROADMAP step 9). ✅ **Landed** — `flow/tabs.js`, and the correctness
  half is in `storage/db.js`'s conditional write rather than in the election, because
  `ARCHITECTURE.md` §4.2 permits browsers with no lock API at all.
- **§7.8's ending** (step 10). ✅ **Landed** — `flow/ending.js` and `app/ended.html`,
  in the order 0.8.13 corrected: silencing before the clear, confirmation after it.
- **Ghost mode's interface** (§7.6). ✅ **Landed in step 11** — `flow/ghost.js`. Its
  store was built and tested in step 8 and nothing in `app/` could reach it, which is
  how §7.6's storage rule went four versions without anybody noticing that **the
  messages were not on its list** (0.8.14, D-072).
- **§7.5's WebAuthn PRF wrapper.** The unlock record has no store of its own yet;
  `db.js` records where it belongs when it lands (with conversation state, because
  §7.8 clears device unlock state in Kept mode). **Still the case — Phase 2.**

⚠️ **Three entries above said "not built" for work that had shipped**, because this
list was written in step 2 and the steps that closed them did not come back to it. It
is the same failure mode `feedback_legal_text_drift` names one level up from prose:
a description of the code that nothing in a build checks.

### What the first real user changed (step 15, 2026-08-13)

Sixteen observations from the first evening the product was live
(`FEEDBACK_2026-08-12.md`). Two were protocol gaps and neither could have been found
by reading — see PROTOCOL.md 0.9.0 and D-079/D-081. What they left in this directory:

- **`app/index.html` says nothing.** Every sentence moved into `ui/copy.js`, and the
  suite now enforces it. ⭐ **The gate found two more escapees on its first run**: the
  ending page's `<title>`, and `app.js`'s last-resort *"Something went wrong."*
- **`#write` is a new panel** (D-084). The chosen phrase and the retype field are no
  longer on one screen — while the phrase is visible the retype is evidence of
  nothing, which is a security defect that no amount of reading the code can show.
- **`protocol/payload.js` has a second kind** — §6.7.1's `closed`, the only message
  this product sends by itself. No `text` field, and `decodePayload` drops one a
  hostile peer supplies.
- **`storage/sessions.js` holds the closed marker**, beside the session record rather
  than in it: §6.3 rotates that record, and a peer who has left is still gone after a
  rotation.
- **The roster entry gained `verified`** (§3.6.2, merged by OR), and the six digits
  can be shown again from inside a conversation, which is what makes "not yet" an
  honest answer rather than a polite refusal.
- **`flow/lock.js`'s thresholds are testing-period values** — 30 minutes idle, 5
  minutes blur (D-082). Not measurements. `ARCHITECTURE.md` §4.3 says why.

### What the second sitting changed (step 16, 2026-08-13)

Fourteen more the next day. PROTOCOL → **0.9.1**, D-086…D-092. ⭐ **Almost none of
them were prose defects** — the gate above had already swept that class — so what
came back was deeper.

- ⚠️⚠️ **`app.js` listens for `hashchange`**, and this is the one to read the comment
  on (D-086, §2.1.1). Pasting a link into the address bar of a tab already on `/c`
  changes only the fragment, so the browser fires `hashchange` and **does not
  reload** — and the boot-time `location.hash` read never looked again. **Every line
  in this directory was correct.** What was wrong is a fact about the platform, and
  nothing here mentioned it. ➡️ **No suite in `test/` can find this class**: they are
  Node tests with no document, no address bar and no history. The verification is a
  browser run, and its load-bearing assertion is a `window` marker that only survives
  a *same-document* navigation.
- **`#paste` is a new panel** (D-090): somewhere to paste a link instead of using the
  address bar — which is also the *safer* route, since typing a link into the omnibox
  hands the secret to the browser's history, where §2.1's `replaceState` cannot reach
  it. ⚠️ It owns a check navigation does not need: **a link for another origin is
  refused**, because `parseLink` would otherwise turn another deployment's `L` into a
  `pairing_id` claimed against this server.
- **`failWith` no longer falls back to `err.message`** (D-088). §9.2's limiter put
  *"429 rate_limited"* on a user's screen, because the sentence table is keyed by a
  `reason` an `ApiError` does not carry. There is now **no path from an exception to
  a sentence a person reads**; the machine's words go in the detail line. ⭐
  `test/copy.mjs` reads the reasons out of `flow/pair.js` — not from a list kept
  beside the copy — and found `server_state` missing on its first run.
- **The ending controls name no conversation** (D-087). *"End this conversation on
  this device"* came out of §7.8's own opening sentence, which was written from Ghost
  mode; on the Kept-mode list it labelled a control that empties the browser.
- **`measurements.link`** joins the diagnostics (D-089). The panel measured boot and
  had nothing to say about the wait people actually notice, which is §9.1's
  proof-of-work: **322–3651 ms over eight solves** in Chrome at twenty bits. A nonce
  search has an unbounded tail, so the row records the *last* solve, never an average.

### What the third round changed (step 17, 2026-08-13)

Four observations and two answers. PROTOCOL → **0.9.2**, D-093…D-099. ⭐⭐⭐ **This
round found a defect we had already fixed, in the section next door**, twice.

- ⚠️⚠️ **`tellThemAll` in `app/app.js`** (D-093, §7.3.1a). The panic action deletes
  every conversation an identity has and told nobody — which is §6.7.1's founding
  defect performed once per contact. It now purges first and sends afterwards, which
  is the **reverse** of the single deletion's order and deliberately so: the roots
  come from the roster, and the action is a race with whoever holds the lost device.
  ⭐ **Read the comment about `generation`.** That line was a claim until a sabotage
  made it a measurement — and the first attempt at the same sabotage said it did not
  matter, because an identity that has never migrated is already at the generation an
  empty record computes. It bites from the second device onwards, and there the
  failure is invisible from both ends.
- **`copy.roster.failure` is a complete table** (D-094), the same fix as D-088's, in
  the module I did not look at when I made it. Six of nine reasons had no sentence,
  and pressing "check" twice printed **"§7.3.3 allows one check for changes per
  hour"** at a user. ⚠️ `test/copy.mjs`'s reader **had a blind spot of exactly the
  shape it was written to catch** — it matched only the constructions that fit on one
  line, five of thirteen invisible — so it now tolerates the wrap *and counts*, and
  the caller asserts the two numbers agree.
- **`describeIdentity` prints no `err.message`, and neither does `detailOf`.** The
  machine's name goes to the new `problem` row in the diagnostics panel instead:
  removing the message removed the only way a tester could say *which* failure they
  hit, and the tester round is next. The **name**, never the message — those are what
  cite `PROTOCOL.md` and a README at somebody.
- **The word is `passphrase`** (D-098), everywhere, by Hannu's decision. The copy
  suite walks every string the module can produce and fails on the bare word, because
  a sweep holds only until the next sentence somebody writes.

### What the fourth round changed (step 18, 2026-08-13)

Three copy items and two questions. PROTOCOL → **0.9.3**, D-100…D-103. ⭐⭐⭐ **This
round found a REASON, not a defect** — a "no" recorded in this directory with a
justification that `PROTOCOL.md` refutes on a page nobody had reason to open.

- ⚠️⚠️ **Read `pairing.keepOpen`'s comment in `src/ui/copy.js` before you touch
  pairing.** It used to justify "the tab must stay open" with *"storing the pairing
  key durably would put a live key on disk in a product built so nothing is
  written"*. **§3.4.1 measured and stated the opposite two versions earlier:
  `sessionStorage` is persisted, `L` reaches disk today.** The difference between the
  two stores is lifetime, not disk. The answer is still "not now" — §3.4.1a and D-100
  carry what it would actually cost — but the reason is rewritten, and the lesson is
  that a wrong *reason* closes a question in a way a wrong line of code never does.
- ⭐ **`src/ui/emphasis.js` is new, and it is the only markup in the product**
  (D-103). Copy strings may contain `**marked**` runs; `app/app.js` splits them into
  real `<strong>` element nodes. ⚠️ **Do not reach for `innerHTML` here.** Measured in
  Chrome against the real headers: it raises *"This document requires 'TrustedHTML'
  assignment"*, the boot block dies with it, and **the gate never renders** — the page
  shows nothing at all. ⚠️ **`**` is a display bug in every string except
  `product.what`**; anywhere else it reaches a person as two asterisks, and the copy
  suite enforces that.
- **One name for the one thing: `invite link`** (D-102). Every string that
  *introduces* it says so; a second mention inside the same sentence may say "the
  link". The copy suite checks the rule rather than the sweep — a string mentioning a
  link with no "invite" in it is a first mention that got missed — with one checked
  exception, *"haamu is a link-paired messenger"*, where the word is not a noun.

### What the fifth round changed (step 19, 2026-08-13)

Five colour items and one diagnostics panel. PROTOCOL → **0.9.4**, D-104…D-106.
⭐⭐⭐ **The findings were in the item that was not a complaint** — two panels pasted
"in case it is useful", one of which he had already talked himself out of.

- ⚠️⚠️ **`app/app.css` now uses colour to MEAN something, and there are two hues.**
  `--accent` (green) is what you do and say on this device; `--second` (violet) is
  what is not you — a passphrase you already had, and the other person's messages.
  Three strengths carry importance: filled accent = the one action on a screen, soft
  fill + coloured border = important, coloured border alone = notable, `--line` =
  ordinary. **If you add a colour, give it one of these jobs or do not add it.**
- ⭐⭐ **`.rows` is the conversation list and it PAINTS. Do not borrow it for
  layout.** The gate's two buttons used it for its `flex-direction: column`, and
  `.rows button` (0,1,1) beat plain `button` (0,0,1) — so the accent fill
  `#go-setup` was written to have **never rendered once**, on the first screen of the
  product. `.choices` is the gate's own container and does not paint. ➡️ **A cascade
  collision is invisible in source and visible only to a browser**, which is why
  `browser-feedback19.mjs` asserts on `getComputedStyle` and never on a class list,
  at both themes.
- ⭐⭐⭐ **`src/protocol/pow.js` no longer searches with WebCrypto** (D-105, §9.1a).
  ~86% of the old solver's cost was the *call*, not the hash; 250 solves scaled to 20
  bits went from **3.52 s to 0.75 s**. ⚠️ **The private SHA-256 in that file is not a
  primitive of this product and must never become one** — it is un-exported, it
  cannot return a digest, and it is checked against WebCrypto both before the search
  and on the answer. Every real hash is `crypto/hash.js`. ⚠️ **And the yield budget is
  in milliseconds, not attempts**: a count is a constant amount of work and a variable
  amount of time, and a background tab clamps a timer to a second.
- ⭐ **The diagnostics `problem` row is dated and counted, and cancelling is not a
  problem** (D-106). `Error` is what `err.name` gives every un-subclassed exception,
  so failures carry an explicit `reason` now and anything without one reads `unnamed`.
  ⚠️ **An exception used as control flow is not a fault** — pressing Cancel throws, and
  filing that as a problem is how somebody who changed their mind gets told their
  device has an error. There is also a `proof` row: the `link` total covered five
  things and could not say which one the wait was.

`/crypto` and `/protocol` remain pure functions over bytes; only `/net` and `/flow`
reach the network, and nothing here reaches a database.
