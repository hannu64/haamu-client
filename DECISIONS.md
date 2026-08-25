# DECISIONS.md

**Decision log** — link-paired, identity-less secure messenger
Companion to PROTOCOL.md (normative), ARCHITECTURE.md, ROADMAP.md, REVIEW.md.

Decisions are recorded here as they are made, with the reasoning, so they are not
relitigated. Once a decision is stable it gets folded into the normative
documents and the entry here keeps the *why*.

---

## 2026-08-03 — Session 1 (Hannu + Claude Code, after REVIEW.md v1)

Hannu had read the short review only. Long review to be read 2026-08-04.

### D-001. The protocol namespace token is NOT the brand, and never will be

**Decided.** HKDF `info` strings are permanent — they are baked into every
derived key on every device, and changing one after launch invalidates every
existing channel and roster. A domain name is *not* permanent: brands get
renamed, domains get lost, products get merged. Binding one to the other is
exactly the mistake that put `privis-` into a spec for a product that is not
privis.

Therefore the token describes **the protocol**, not the product.

**Chosen token: `lpm`** — *link-paired messenger*. It describes the construction,
which cannot become wrong. Examples:

```
lpm-pairing-id-v1        lpm-mailbox-i2j-v1       lpm-roster-key-v1
lpm-pairing-mac-v1       lpm-mailbox-j2i-v1       lpm-roster-auth-v1
lpm-channel-root-v1      lpm-mbauth-v1            lpm-olm-idk-I-v1
```

Auth scheme header becomes `LPM-Ed25519`.

**Consequence, and it is a good one: naming is now off the critical path.** The
product can be called anything, on any domain, decided at any time — including
after testers have used it. Nothing in the cryptography depends on it.

### D-002. Do not build on privsend.net

**Decided.** Using a privsend-family domain for a *different* product reads as
either a typosquat of your own product or a claim that this *is* privsend. It
dilutes a brand that is already live and published.

Separate recommendation, unrelated to this project: **register privsend.net
defensively anyway.** A vacant `.net` next to a live `.app` is a phishing surface
for a security product — someone can register it and host a convincing fake.
That is cheap insurance and worth doing regardless of what this messenger becomes.

On "mini-messenger": honest read — it is serviceable but undersells. "Mini"
promises *less*, and the pitch here is *more, with less friction*. Not a decision
that needs making now (see D-001), so it is deferred deliberately.

### D-003. Phase 0.5 is happening regardless of outcome

**Decided by Hannu.** Build the disposable pairing-UX prototype in any case — the
feedback and experience make everything after it better, and there is no hurry.

Recorded as a standing decision so it is not re-argued: Phase 0.5 ships before
any cryptographic implementation work begins.

### D-004. Tester panel — confirmed, and unusually well suited

**Hannu's panel:** friends from his previous business. Seasoned computer and
mobile software users. They value privacy but are "absolutely much too lazy and
comfort-seeking to use any privacy tools whatsoever."

This is close to an ideal panel for this specific thesis. The product's entire
bet is *easy enough that comfort-seekers adopt it, strong enough that the
paranoid respect it*. The second half can be verified by reading the
specification. **The first half can only be verified by people exactly like
this** — and their laziness is the measurement instrument, not an obstacle to it.

If this panel pairs without help, the thesis holds. If they stall, it does not,
and no amount of cryptographic quality will rescue it.

### D-005. "Self-hosted" is struck. EU-hosted is the commitment

**Decided.** The word "self-hosted" was inserted by an AI agent during ideation
and survived unchallenged. It must go, because in this industry **"self-hosted"
means the *user* runs the server** — a completely different and much larger
promise (packaging, docs, upgrade paths, support for other people's
infrastructure).

What Hannu actually means, and what is true: **EU-hosted on infrastructure
Zumitomi Oy controls directly — Hetzner, the same footprint as privsend.**

That is a genuine and marketable position for a Finnish privacy product, and it
is honest. `ARCHITECTURE.md §1` and any future marketing copy must say
"EU-hosted, on hardware we control," never "self-hosted."

### D-006. Undelivered-message retention — single global policy, no toggle

**Decided.** Hannu's preference was a user toggle (keep undelivered / delete
undelivered), with a stated fallback of a single loud policy. Taking the
fallback, for a reason that is not just simplicity:

**The toggle is ambiguous about whose choice it is.** If the *recipient* sets
"delete undelivered," the sender's message vanishes according to a setting the
sender cannot see. If the *sender* sets it, the recipient's data lifetime is
controlled by someone else. Neither is explicable in one sentence, and a privacy
control that cannot be explained in one sentence is a privacy control that will
be misunderstood — which is worse than not having it.

**Policy:** one global rule, stated plainly, in the interface and not only in the
documentation. Working copy:

> Messages on the server are deleted the moment they reach you. If you don't come
> online, we hold them for at least 7 days and then they are gone for good.

### D-007. Epoch length is set equal to the retention period

**Decided 2026-08-04** (proposed 2026-08-03; confirmed after Hannu read the long
review). This is the technical consequence of D-006, and it resolves three open
problems at once.

**The contradiction it fixes first:** the documents already disagree with
themselves about retention. `ARCHITECTURE.md §3.1` has the reaper deleting
"messages older than 7 days regardless of ack," while `PROTOCOL.md §5.4` expires
messages "unconditionally at epoch `e+2`" — about 2–3 days, and via `ON DELETE
CASCADE` from the mailbox row, so the 7-day rule can never actually fire. One of
these numbers is dead code.

**The change:** make the epoch **7 days** instead of 24 hours, and let the
mailbox lifetime *be* the retention period rather than being a second,
independent parameter.

| | 24 h epoch (current) | 7-day epoch (proposed) |
|---|---|---|
| Retention of undelivered messages | ~2–3 days | 7–14 days |
| Mailbox registrations per channel | 2/day | 2/week |
| Proof-of-work burden | see REVIEW B3 — breaks | **3.5× lower** (corrected — see note) |
| Mailboxes polled per drain per channel | 3 | 3 |
| `mailbox_id` stable for | 1 day | 7 days |

**Correction, 2026-08-04:** the table above originally said 7×. That was written
before B1's second mailbox was counted. A channel registers *two* mailboxes per
epoch, not one, so the true reduction is **3.5×** — from 7 solves per channel per
week to 2. The conclusion is unchanged and the arithmetic still works out
comfortably (20 solves a week for a 10-channel user), but the number was wrong.

The PoW arithmetic in REVIEW §B3 — 40 solves per day for a 10-channel user
against a 20/hour CGNAT-shared limit — largely dissolves at 3.5× fewer
registrations. It does not fully solve B3; the "PoW once per channel at pairing,
later epochs authorised by signing with the previous epoch's key" fix is still
wanted. But it converts B3 from *broken* to *tunable*.

**The honest cost:** a `mailbox_id` visible to the server is now stable for a
week rather than a day, so a server watching one mailbox sees a week of one
channel's traffic pattern instead of a day of it. Weighed against the fact that
the same client already polls consecutive epochs over the same TLS connection
from the same IP — which means `PROTOCOL.md §4.2`'s claim of cross-epoch
unlinkability was always weaker in practice than on paper — this is a good trade.
**That §4.2 claim needs softening regardless of whether D-007 is adopted.**

**Second consequence, must not be missed:** `PROTOCOL.md §6.6` deletes messages
on the client 24 hours after `sent_at`. With 7-day retention, a message that sat
undelivered for five days would be deleted on arrival, before it is ever read.
The client TTL must therefore run **from first receipt, not from `sent_at`**.
Still honest, still "disappearing messages," but it is a required change and not
an optional one.

---

## 2026-08-04 — Session 2 (after Hannu read REVIEW.md in full)

### D-008. The sender is told what happened to their message

**Decided.** REVIEW §D1 named three acceptable responses to "messages can vanish
unseen" and said doing none of them was the only bad answer. Hannu chose the
delivery-state option, plus explicit documentation. Both, not either.

**Why this is cheaper than it looks:** because both parties derive an *identical*
mailbox keypair (`PROTOCOL.md` §4.3), the sender already holds the key that
authorises reading the recipient's mailbox. Checking "is my ciphertext still
queued?" therefore needs **no new key material and no new trust assumption**. The
genuinely new parts are small: the server must return a message id on store, and
expose a status query for a set of ids.

**Honest limitation — this is a fourth [server-trust] property.** "Delivered"
means *the server reports the ciphertext is gone*. A dishonest server can lie in
either direction. It belongs in the same class as the tripwire (§3.5): a hint,
not a guarantee, and it must be labelled as such in the threat model. An
end-to-end authenticated delivery receipt would require the recipient to send a
signed ack back through the ratchet — a real reverse-direction message, which
costs a round trip and reveals that the recipient came online. Not for MVP.

**Sender-side states** (the client can distinguish these from its own clock,
since it knows the expiry it uploaded with):

| State | Meaning |
|---|---|
| Delivered | ciphertext left the server before its expiry |
| Waiting — *n* days left | still queued |
| Expired, never delivered | the window closed with it still queued |

**Documentation copy, approved shape:**

> Your message waits on our server, encrypted, until your contact's app picks it
> up. The moment it is delivered it is deleted from the server. If your contact
> does not come online within 7 days, the message is deleted undelivered — and it
> is gone for everyone. Every message you send shows its state: delivered,
> waiting with the time remaining, or expired.

### D-009. Retention control returns in V2 — asymmetric, not symmetric

**Decided in principle; not MVP scope.** D-006 killed the retention toggle
because it never said *whose* choice it was. Hannu's refinement — recipient sets
a default, sender may override per message — is the right instinct (both parties
do have a claim) but the symmetric form fails the same test: it lets a stranger
extend how long *your* mailbox holds data you cannot yet read.

**The asymmetric form passes.** Name each party's claim precisely:

- **The recipient sets a ceiling.** "Never hold anything for me longer than X
  days." Nobody can override it.
- **The sender sets their own message's lifetime, clamped to that ceiling.**
  Always allowed to shorten; never allowed to lengthen.

Each side then has a sentence that is true and complete standing alone: *"I
decide how long my message tries to live"* / *"I decide the longest anything is
ever held for me."* Nothing invisible can surprise either party, and the sender
sees the ceiling before sending — which is the visibility Hannu asked for.

**A structural argument points the same way.** Under D-007 a message's mailbox
dies on a fixed schedule. Shortening one message's life is a single extra expiry
column. Lengthening it past the mailbox is impossible without re-uploading into
the next epoch's mailbox, which the sender cannot do. **The direction that is
ethically murky is also the technically expensive one.**

**Metadata caveat for whenever this is built:** the server sees each message's
chosen lifetime, so free-form values become a per-channel fingerprint. It must be
a small fixed set of buckets — three choices, not a slider.

**Until then, D-006 stands.** MVP ships one global policy and says so out loud.

### D-010. Passphrase editing — the "Advanced" control

**Decided 2026-08-04 — cut.** Hannu: *"We go with your recommendation: cut it for
MVP. Let's go with only: generated 6-word phrase."* REVIEW §C1: `ROADMAP.md`
says generated secrets cannot be edited, `PROTOCOL.md` §7.4 adds an "Advanced"
control where they can, gated by zxcvbn at ≥2^60 guesses and ≥12 characters.

**Recommendation: cut it for MVP.**

- The passphrase is the only protection on the roster blob if a copy is ever
  taken from the server, and because of §7.2's deterministic salt that attack is
  **offline** — no rate limit we control applies to it.
- Generated ≈77 bits vs. the Advanced floor ≈60 bits is roughly **130,000× less
  work** for that attacker. Both infeasible today; the margin is what is being
  spent, and open item 2 (lowering Argon2id memory for cheap Android) spends more
  of it. C2's instruction to close those two as *one* joint decision applies here.
- Anyone who types their own types something memorable — which is why a floor is
  needed at all, and an entropy-floor dialogue is exactly the feature the product
  thesis forbids.
- Free to add in V2, painful to remove once people depend on it.

**Cost of cutting:** enthusiasts who like choosing their own words. Mitigation —
regeneration is unlimited and the result pastes into a password manager.

**One thing left open deliberately, as open item 7.** The EFF large list is
English, and a share of the intended users are Finnish or Malayalam speakers for
whom six English words are opaque strings to transcribe rather than words to
remember. EFF's **short list #2** is built for that case — unique 4-character
prefixes and a minimum edit distance of 3 — which allows type-four-letters
autocomplete that corrects typos without costing entropy.

| | 6 words, EFF large (7776) | 8 words, EFF short #2 (1296) |
|---|---|---|
| Entropy | 77.5 bits | 82.7 bits |
| Words to type | 6 | 8 |
| Unique 4-char prefixes | no | **yes** |
| Designed typo resistance | no | yes |

The longer phrase may be the *easier* one. **Settled by measurement in Phase 0.5,
not by argument** — testers re-enter their phrase on a second device and we count
failures. Either way the entropy stays above 77 bits, so nothing downstream
depends on the answer.

### D-011. Two defects found while folding the review into the specification

Neither was in `REVIEW.md`; both surfaced only when the accepted changes were
written out in full. Recorded here because they are the argument for doing the
fold as one deliberate pass rather than a series of patches.

**a) A flat 24-hour blob TTL orphans attachments.** `PROTOCOL.md` §8 gave file
blobs a 24-hour lifetime while messages were retained for 2–3 days in v0.1 — and
7–14 days after D-007. A recipient returning after two days would find the
message intact and the file already deleted: a broken attachment, with no
explanation, in precisely the scenario the retention promise exists to cover.
**Fixed:** blob lifetime follows the mailbox, created in epoch `e` and deleted at
the end of `e+1`, so a file and its message die together. Any retention number
for blobs that is not the message retention number is a bug.

**b) A global epoch boundary is a synchronisation event.** With `e = floor(unix /
EPOCH)`, every channel in the system rolls over on the same second. That is a
thundering herd against one Hetzner box; it exhausts the per-IP creation limit
for multi-channel users all at once, worst for the CGNAT-shared users the design
specifically tries not to penalise; and it tells the server that any mailbox
created just after the boundary is a rollover of an existing channel — metadata
given away for nothing. **Fixed:** the epoch is offset per channel, by an offset
both parties derive from `R`. The honest cost is that a channel's rollover
*time of week* becomes a weak stable fingerprint — far weaker than a shared
global boundary, and weaker than the IP-level correlation the server already has.

---

## 2026-08-05 — Session 3 (Phase 0.5 built)

The prototype exists: `/home/node/haamu`, commit `ad8b2b3`, Go standard library
only, ~700 lines. 49 API checks and 23 smoke checks green; the browser test is
Hannu's and had not happened when this was written. Not deployed.

### D-012. The Phase 0.5 domain is `haamu.app` — and that is not a naming decision

**Decided.** `haamu` is Finnish for *ghost*. Alternatives weighed were `mese`
(Finnish slang for messenger) and a subdomain of an existing property.

**The argument that settled it is about measurement, not marketing.** A tester
who opens `dev.zumitomi.fi` knows they are testing Hannu's dev thing, and will
be **polite**. A tester who opens `haamu.app` sees a product. D-004 says this
panel's laziness *is* the measuring instrument — and politeness suppresses
exactly that. It matters most for *"does anyone paste the link somewhere
public?"*, which only gets an honest answer from someone treating the thing as
real. So a real-looking domain is the better instrument, and that outweighs the
€14.

`haamu` over `mese` for the same reason: `mese` announces "chat app" and stops
there, while `haamu` makes people curious, and curiosity is what extracts
feedback from comfort-seekers. It is also *accurate* here — Phase 0.5 has no
persistence at all, so the prototype genuinely is ghost-only.

**⚠️ The recorded half of this decision is the negative one: the thing testers
see is the thing that becomes the name by accident.** If `haamu` ends up on the
real product that must be a decision taken deliberately, not one the prototype
made. Two things to weigh if it ever comes up, neither of which applies to a
throwaway: *ghost* names the **transient** mode, while Kept mode is the half
that makes people adopt the product; and "ghost" is crowded in this category.
Nothing in the protocol is affected either way — D-001 fixed the namespace token
as `lpm` precisely so naming could never sit on the critical path.

**Language: English only.** The panel are Finns with good English (Hannu's
call). It also keeps the phrase test clean: the EFF lists are English regardless,
so Finnish speakers transcribing English words *is* open item 7's real case.

### D-013. The prototype does not tell the joiner who invited them

**Decided, as an omission rather than a feature.** There are no identities in
this design, so the person opening a link genuinely cannot be shown who sent it.
The tempting patch — let the creator type a display name, carried in the fragment
so the server never sees it — was rejected **for the prototype**, because a
tester asking *"who is this from?"* unprompted is worth more than an answer we
guessed at. The join page therefore carries one neutral sentence — *"Someone
sent you this link."* — and a button.

If testers do not raise it, that is itself the finding. If they do, the fragment
carries a name at no cost to the server's ignorance, and it becomes a real
design question for Phase 1.

### D-014. SSE, not a websocket, and one artefact worth knowing about

`ROADMAP.md` Phase 0.5 said "plaintext over a websocket". Built with SSE + POST
instead: zero dependencies, `EventSource` reconnects by itself, and it is the
transport the real client will use — so what we learn about phones on mobile
networks transfers instead of being thrown away with the rest. ROADMAP updated.

**The artefact to remember when reading the results:** a tester who closes the
tab loses the conversation (Ghost mode being honest), and re-opening the link
would otherwise re-claim it and fire a **tripwire against their own chat**. The
tripwire count is one of the four things being measured, so it must not be
polluted by people re-opening their own links. A `localStorage` marker records
which pairing ids this browser already opened, and shows *"You opened this link
before"* instead of claiming again. **A tripwire event in the results is
therefore always someone else** — that is the property the marker buys.

### D-015. Ghost mode's "dies with the tab" is not claimed until it is measured

**Decided 2026-08-05**, prompted by Hannu asking a plain question of the
prototype: *does closing the tab erase the messages from browser memory, or only
make them unreachable?*

The honest answer for the prototype is "unreachable, and nothing we wrote
touches disk" — messages live only in the DOM and JS heap, and the standing
no-memory-zeroization decision already forbids claiming more than that.

**But the question exposed a gap in the real design.** `ARCHITECTURE.md` stores
the Ghost-mode **channel root** in `sessionStorage`, and browsers persist session
storage **to disk** for crash and session restore. If that holds on the devices
we care about, then Ghost mode's central promise is logical rather than physical:
the key is unreachable to any page, but it is on the disk of a seized laptop.

**Therefore: no Ghost-mode durability claim may be written before the Phase 0
measurement lands** (added to the Phase 0 table). Same discipline as open item 8
and the forward-secrecy claim — the measurement gates the sentence, not the
other way round. If session storage does reach disk, the options are to reword
the promise, or to hold the Ghost root only in a JavaScript variable and accept
that a reload ends the conversation.

**⭐ The general lesson: a naive user's question about the prototype found a
defect in the specification that reading the specification had not.** This is
the same effect as D-011, from the other direction — there, writing the review
into the document surfaced bugs that reviewing it had not.

### D-016. First tester round: the pairing is fine, the **tab** is the problem

**Result, 2026-08-05 evening.** Hannu sent 7 invitations; **5 people wrote back
the same night, after 22:00.** Panel as described in D-004 plus family — a
career software engineer at one end, a veterinarian at the other.

**The Phase 0.5 gate is PASSED.** Hannu's summary: *"starting a conversation
with a link was not strange."* Nobody was confused by the idea that a link goes
to one person. The cryptographic work is not built on a broken interaction.

**But every single one of them lost the original tab**, some at the start, some
later when they paused mid-conversation. Hannu lost one twice himself. The
mechanism is specific and it is worst on mobile:

1. Create the link. 2. Tap **Share** — the natural thing to do. 3. The phone
switches to WhatsApp. 4. **Getting back to a particular browser tab is not an
obvious act**, and several never found their way back at all.

**⭐⭐ THE FINDING THAT MATTERS MOST: the testers discovered the right affordance
and the product refused it.** *"Many tried to click the share link themselves,
after going to the main page, sometimes in a new tab."* They had the link
sitting in WhatsApp, reasoned correctly that it should let them back in, and got
either a claim attempt or *"already used"*. **The users' instinct was better
than the design.** Whatever Phase 1 does here should start from that instinct.

**⚠️ Hannu's conclusion — "that will be remedied when the 6-word passphrases come
into use" — is right but INCOMPLETE, and the gap is the important part.** Kept
mode restores conversations for a user who already has a passphrase. But **the
first conversation happens before any passphrase exists**, and the first
conversation is the one that decides whether somebody adopts the product at all.
That is precisely the case the testers hit.

**The real shape of the problem: pairing is a two-step act with a gap in the
middle, and the gap is exactly where the user leaves the application.** Any
design that requires returning to *one specific tab* will keep losing people.

Three ways out, none decided — this deserves its own pass in Phase 1:

- **(a) Persist a recovery record locally from the moment the link is created**,
  before any passphrase, and encrypt it at rest later when one is set. Lowest
  friction; costs a plaintext local record in the window before setup.
- **(b) Ask for the passphrase before the first link can be made.** Clean, but
  it loads setup onto the very first minute — the moment the product thesis is
  most protective of. Direct tension with *"simplicity is the product"*.
- **(c) Let the creator re-open their own link.** What the testers actually
  tried. The creator holds the pairing secret, so re-deriving is possible in
  principle — but a link that restores the *creator's* side, not just the
  joiner's, changes what possessing the link grants, and that needs thinking
  through against the threat model before it goes anywhere near the protocol.
  A device-local variant (this link **plus** this browser's own memory) has none
  of that risk and matches the observed behaviour just as well.

**Shipped to the prototype the same evening** (guidance, not a fix): a visible
amber notice above the Copy/Share buttons — *"Keep this page open until they
arrive"* — placed **above** the buttons because the moment that matters is
before the tap, plus a `beforeunload` guard for desktop and a standing line in
the chat footer. Mobile browsers largely ignore `beforeunload` on tab close,
which is why the visible notice carries the weight.

### D-016b. Ghost mode is an **expert** choice, not the beginner default

**Hannu's insight, 2026-08-05, and it inverts an assumption in
`ARCHITECTURE.md`.** The documents treat Ghost as the state everyone starts in
and Kept as the upgrade. He argues the opposite is what will actually happen:

> *"Ghost mode will be most used by the most paranoid nerds — they have a
> passphrase-saved chat list, but when they are really wary they use Ghost mode
> in a private browser."*

That rings true, and D-016's tester round supports it: for an ordinary first-time
user, Ghost is not a privacy feature at all — **it is just the state in which
they lose everything.** The people who genuinely want ephemerality are the ones
sophisticated enough to have set up Kept mode first and to reach for Ghost
deliberately, in a private window.

**Consequence for Phase 1, not decided here:** if Ghost is an expert mode, then
the first-run experience should not be Ghost by default. Hannu's own proposal is
the gentlest form — an **optional** offer at the very start (*"if you want to
keep your conversations, take a passphrase now; otherwise closing the tab loses
this one"*) rather than a mandatory setup gate. That keeps the first minute
light while making the consequence visible before it bites, which is exactly
where D-016's testers were injured. Note it interacts with D-010: the generated
phrase is 6 EFF-large words today; whether it becomes 8 short ones is what the
Phase 0.5 phrase test is measuring.

### D-016c. Shipped: the creator can get back in from the same device

**Built the same evening**, on Hannu's decision, and it changes what the
prototype is: it is **no longer a faithful model of Ghost mode**. Deliberate —
the Ghost finding is collected and loud, and making testers keep losing
conversations costs goodwill without buying another data point. Testing whether
the *remedy* works is now the more valuable experiment.

The device remembers how to rejoin (`localStorage`), the front page lists those
conversations, and clicking your own shared link puts you back into it from
either side. **The TTL is 12 hours, matching the server's own idle lifetime** —
Hannu suggested 30 minutes, but any local number shorter than the server's
throws away conversations that still exist, and any longer offers conversations
that no longer do. Only the matching number tells the user the truth. A
*"Forget these"* control clears it.

The `beforeunload` guard added earlier was **removed** in the same change: once
losing the tab is recoverable, a browser warning on every close is a warning
that cries wolf — the same lesson privsend learned with its copy guard.

### D-017. WebRTC peer-to-peer transport — considered, does not fit

One of Hannu's testers has built a similar messenger and described his design:
the server carries only a keep-alive flag (session live / kill), never the
conversation, and messages travel **peer-to-peer over WebRTC**. Recorded here so
it is not re-raised without the reasons.

The instinct is the same as ours — hold as little on the server as possible —
but the shape does not fit this product:

- **WebRTC requires both parties online at the same time.** This design's entire
  retention model exists because they are *not* (D-006's 7-day hold, D-008's
  sender-visible delivery state). A messenger where both must be present is a
  different product; it is closer to a call than to a message.
- **It hands each party the other's IP address.** ICE candidate gathering
  exposes real network addresses between peers. For a link-paired messenger where
  you may be talking to someone you do not know — and emphatically for the
  Phase 3 whistleblower case — that is a serious regression, not a gain.
- **When direct connection fails you need a TURN relay**, which is a server
  relaying the traffic, with worse economics than store-and-forward. Direct P2P
  fails routinely behind CGNAT and symmetric NAT — i.e. mobile networks, and
  specifically the Indian users the design already tries not to penalise.

**Worth keeping from it:** his optional keep-alive, so a session does not drop
when the connection is interrupted for a long time, is the same lesson our SSE
reconnect handling has to learn from real mobile networks.

**⭐ The better use of this person: he has actually built one of these.** He is
an outside technical reviewer who costs nothing, and `PROTOCOL.md` would benefit
from his eyes far more than from another AI pass.

---

### D-018. The phrase test was measuring the wrong thing, twice over

**2026-08-06, from the first `/phrase` testers.** Both corrections came from
Hannu relaying tester behaviour, not from re-reading the design.

**Correction 1 — the "short" arm had the longest words on it.** The second arm
was 8 words from **EFF short list #2**. That list is picked for *unique 4-character
prefixes and a minimum edit distance of 3* — properties for **autocomplete**,
which we never built — and the price of those properties is that its words are
the longest of any list available (mean 7.3 letters, up to 10). So the arm
labelled "short" was in fact the most characters on screen.

Testers reported that the long words made them **slow down and check**. That is
the whole finding: *long words buy accuracy with time.* An error-rate comparison
between "6 long words" and "8 longer words" therefore measures how careful each
phrase made people, not which shape is easier. **Time on task was an
uncontrolled confound, and the arms were not really contrasting.**

Replaced with **EFF short list #1** — 1296 words, every one **3–5 letters**,
10.34 bits each. The arms are now:

| variant | words | bits | typical characters |
|---|---|---|---|
| `large6` — EFF large | 6 | 77.5 | ~47 |
| `tiny8` — EFF short #1 | 8 | **82.7** | **~43** |

The short arm now carries **more entropy in fewer keystrokes**, so the comparison
is finally between two *shapes* — few-and-long against many-and-short — with
security held equal or better. New variant id `tiny8`, deliberately not a
redefinition of `short8`, so the rows already in `phrase.jsonl` stay unambiguous.

*If prefix autocomplete is ever built, short list #2 becomes the right list
again;* it is recoverable from git (`haamu` commit `ad8b2b3`).

**Correction 2 — requiring two devices was the barrier, and it was not even
faithful.** Testers struggled to have a second device to hand. The two-device
setup was only ever a **proxy** for the property that matters: *the phrase is
not on the clipboard, and not in front of you while you type it.* One page can
enforce that directly — show the phrase, tester puts it away, phrase leaves the
DOM, pasting disabled.

And the one-device flow is **closer to the real ritual, not further from it**. In
life you do not read a recovery phrase off a second screen beside you; you read
it off **paper**. So the button that hides the phrase is the question:
*"I wrote it down"* / *"I'll keep it in my head"* — and the answer is logged,
which separates a transcription test from a memory test after the fact instead
of hoping everyone did the same thing.

**Every attempt now records how the tester worked**: `mode`, `kept`,
`visible_ms`, `typing_ms`, `peeks`, `chars`. Peeking is **allowed and counted**
rather than forbidden — a rule people can break silently produces worse data
than a rule that logs itself. Without these fields, "fewer errors" cannot be
told apart from "they took twice as long", which is exactly the confound above.
Client-reported values are clamped and restricted to a fixed vocabulary before
they reach the results file; the server's own `seconds_since_issue` remains the
authoritative clock.

**Generalisable lesson, the same shape as D-015:** *a wordlist's selection
criterion is a claim about a feature you must actually ship.* Short list #2's
virtue is real only in an autocompleting client. Adopting a list for a property
you have not built means paying its cost — here, the longest words — and getting
nothing back. Check what a list was optimised **for** before treating its name as
a description.

---

## 2026-08-07 — Session 4 (phrase-test results read)

The `/phrase` test ran on 2026-08-06 between 12:39 and 19:29 UTC and produced
70 rows in `/var/lib/haamu/phrase.jsonl`: 33 phrases issued, 37 attempts, 33
distinct codes. Small, but the arms are clean and the instrumentation added in
D-018 did its job. Only aggregates left the box.

### D-019. The phrase test answered: `tiny8`

**Decided 2026-08-07** (Hannu: *"I choose tiny8, I think the pros outweigh the
cons"*). Adopt **`tiny8`** — 8 words from EFF short list #1, every word 3–5
letters, 82.7 bits, ~43 characters. `large6` is retired.

| variant | attempts | correct | median typing | median chars |
|---|---:|---:|---:|---:|
| **`tiny8`** — 8 × EFF short #1, **82.7 bits** | 10 | **9 (90%)** | **24.4 s** | 44 |
| `large6` — 6 × EFF large, 77.5 bits | 23 | 14 (61%) | 34.4 s | 49 |
| `short8` — retired arm, pre-D-018 schema | 4 | 4 | — | — |

**The decision does not rest on the testers, and that is why it is safe to take
on n=10.** `tiny8` already wins on arithmetic: more entropy (82.7 > 77.5) in
fewer characters (44 < 49). That is a property of the two wordlists and is
settled before anyone types anything. The study therefore only had to rule out a
usability *penalty* for the many-short-words shape. It found an advantage
instead — faster and more accurate — so the burden of proof was asymmetric and
`tiny8` cleared it comfortably.

**Be honest about the power of the test.** 9/10 against 14/23 is p ≈ 0.10
one-tailed by Fisher's exact — suggestive, **not** conventionally significant.
"90% versus 61%" must not be quoted as a proven effect. It does not need to be;
see the paragraph above.

**The obvious confound was checked and is clean.** The paper/head split is
near-identical across the two arms — `large6` 11 paper / 8 head, `tiny8` 6 paper
/ 4 head — so the accuracy gap is not an artefact of more memorisers landing in
one arm.

**Hannu's mechanism, and the lists agree with it:** *long words are harder to
write and to spell correctly; short words are easier.* EFF large averages **7.0**
letters per word (up to 9); short list #1 averages **4.5** (max 5). D-018 had
found that long words made testers *slow down and check* — the same effect seen
from the other side.

*If prefix autocomplete is ever built, EFF short list #2 becomes the right list
again — see D-018. But see D-021: autocomplete is now decided against, and the
reasoning there covers the list question too.*

### D-020. The phrase is a **stored** secret, not a memorised one

**Decided 2026-08-07** (Hannu: *"stored is much more realistic — I have great
difficulties to believe in memorizing 8 words for a long period of time"*). The
phrase is optimised for *transcribe-once and retype-occasionally*. Memorability
is explicitly **not** a design goal.

**What the testers did.** Of 29 attempts that recorded it, `kept` was **paper
17 / head 12** — 41% intended to memorise. They were markedly worse at it:

| | n | correct | median typing | median peeks |
|---|---:|---:|---:|---:|
| **paper** | 17 | **15 (88%)** | 27.9 s | 0 |
| **head** | 12 | **5 (42%)** | 43.9 s | 1 |

Slower, peeking more, and wrong more than half the time *within minutes of
seeing the phrase*.

**⚠️ The 41% is a known-biased number and must never be quoted as a real-world
rate.** Hannu's point, and it is the methodological half of this entry: *a test
that asks you to hold something for one minute manufactures memorisers.* Nobody
memorises a secret they know they will need in six months — they write it down.
The `kept` split measures the test, not the world, and no five-minute test can
correct this, because the bias comes from the stakes and a short test cannot
create stakes.

**What people actually do.** Hannu reports the common pattern among people he
knows, and lives it himself: an encrypted file or password manager holds
everything, and only **one** master secret is memorised. His own is two very
long full-disk-encryption passphrases — one for desktops, one for laptops — with
everything else inside. ⇒ **haamu's phrase will realistically live inside
somebody else's encrypted store.** It is a stored secret that gets transcribed
once and retyped rarely. That is the case to design for.

**⚠️ Consequence — blocking paste is a TEST constraint, not a product
requirement.** The `/phrase` page disables pasting in order to *measure*
transcription. Carrying that rule into Phase 1 would force every user into
exactly the error-prone manual typing the test measured, and would fight the
storage pattern above. **Check whether a test rule was ever a real rule** —
this is the same trap as D-018's two-device setup, which was only ever a proxy
for "the phrase is not on the clipboard and not in front of you".

**⚠️ Consequence — the 42% matters more here than it would elsewhere, because
there is no redundancy.** Hannu can forget one of his two FDE passphrases
because the backups hold the same data behind the other. **A haamu recovery
phrase has no second copy: lose it and it is gone.** So the memorise path is not
merely weaker, it is a single point of failure with a measured ~58% failure
rate.

**The product guidance — decided.** Memorising is **not forbidden**; the product
asks everyone to **write the phrase down and keep it somewhere safe**. No
lecture, no blocking.

*Note on scope, recorded because it was briefly confused: the "I wrote it down"
/ "I'll keep it in my head" button lives on the `/phrase` **test** page and is a
measuring instrument, not a product control.* **It stays exactly as it is** —
nudging testers toward paper there would bias the very data it collects.

### D-021. An abbreviated note is the whole phrase — and this is why there is no autocomplete

**Decided 2026-08-07.** **No prefix autocomplete anywhere in the phrase flow.**
This entry is a **constraint on future design**, not user-facing copy.

Hannu reports a real habit: people hide a shortened note at home — for example
the first three letters of each word run together without spaces. Computed
against the actual lists in `/home/node/haamu/words/`:

| the note | `large6` residual | `tiny8` residual |
|---|---:|---:|
| first **3** letters of each word | 77.5 → **20.6 bits** | 82.7 → **9.1 bits** |
| first **4** letters of each word | 77.5 → **9.4 bits** | 82.7 → **1.0 bit** |

In EFF short list #1, **37%** of words have a unique 3-letter prefix and **89%**
a unique 4-letter one; **40%** of the list is four letters or shorter, so for
those the "hint" is simply the word. **Neither list survives the habit** — 20.6
bits is a few hundred thousand guesses and 9.1 bits about 550, both trivial
offline. This cannot be answered by choosing a wordlist.

**Why autocomplete was considered and rejected.** It was proposed as a usability
win. Measured against the real list, the mean shortest uniquely-identifying
prefix in short list #1 is **3.72 letters** against a mean word length of 4.54 —
so perfect autocomplete saves **0.82 letters per word, 6.6 keystrokes per
phrase**, roughly three or four seconds off a task the testers completed in
24.4. The words are already 3–5 letters; there is very little to complete.

Against that, three costs:

1. **It teaches the shortcut.** Today, abbreviating is a private habit that is
   rare *because* few people realise four letters is enough. An app that
   completes after four letters demonstrates the trick to everyone who uses it,
   and a four-letter note on `tiny8` leaves **1.0 bit**.
2. **It defeats the confirmation retype** (D-022). A completed word proves the
   user can pick from a dropdown, not that they wrote the phrase down correctly.
3. **It buys nothing for the half that actually fails.** The measured errors came
   from writing words by hand and reading them back, which autocomplete does not
   touch. This is also why autocomplete does **not** reopen D-018's note that
   short list #2 becomes the right list once autocomplete exists — that
   reasoning only ever covered typing.

**Frequency and severity are separate, and both were argued.** Hannu's
correction: the habit is *not* common, because very few people realise three or
four letters is usually enough. Accepted. **But the user's ignorance is the
attacker's advantage, not the user's protection** — the severity is unchanged,
and the person doing it believes they have been clever. The decisive point is
not the arithmetic anyway: **a "full password" gets hidden carefully and a
"hint" gets left in a notebook or a phone note.** The abbreviation weakens *how
carefully the note is stored* more than it weakens the secret.

⇒ **With autocomplete out, the product no longer teaches the shortcut, so no
warning text is shown.** The finding is recorded here so that autocomplete is
never added later as an obvious usability win by someone who has not read this.

### D-022. Rhythmic ("poetry") passphrase generation — considered, does not fit

**Considered and rejected 2026-08-07**, after Markus raised research on randomly
generated passphrases carrying a built-in rhythm.

*Context, because it changes how this input should be read: this was not a
critique of haamu. Markus is building his own simpler **WebRTC-based** messenger
— the transport haamu considered and rejected in D-017 — and is implementing the
rhythm path there himself; the research is what he had dug up for his own work.
The reasons below are therefore **specific to haamu**, not a verdict on the
method. For a design that expects its secret to be memorised, they do not
apply.*

The research is real:
Ghazvininejad & Knight, *How to Memorize a Random 60-Bit String*, NAACL 2015 —
random bits encoded as a rhyming, metrical couplet, with USC reporting 61% exact
recall weeks later.

**Three reasons it does not fit.**

1. **Its own conclusion puts plain random words level with poetry** — the paper
   finds the XKCD method and the poetry method both perform best. `tiny8` *is*
   the XKCD method, so the research endorses the choice already made.
2. **60 bits, not 82.7**, and a 16-syllable line is more to type than 43
   characters. Scaling a poem to 82.7 bits means ~37% more poem, past the point
   where the 61% was measured.
3. **It optimises memorability**, which D-020 removes as a design goal.

A secondary source cited alongside it, Shay et al. (SOUPS 2012), in fact found
system-assigned passphrases *no* more memorable than system-assigned passwords
of equal entropy, and slower and more error-prone to type.

*One idea from that material survived, in a different form — see D-023.*

### D-023. Six candidates, one choice, and a full retype before you continue

**Decided 2026-08-07.** The setup flow generates **six** `tiny8` candidates, the
person picks the one that suits them, and then **types the whole phrase back**
before the flow will continue.

**Why six, and why choosing costs so little.** Picking 1 of N uniformly
generated phrases costs exactly log₂N bits of min-entropy, in the worst case
where an attacker knows precisely which phrase a given person would prefer:

| candidates | cost | `tiny8` becomes |
|---|---:|---:|
| **6** | **2.58 bits** | **80.1 bits** |
| 8 | 3.00 bits | 79.7 bits |

**Six keeps the result above 80 bits; eight drops just under.** The line is a
convention rather than a law, but "over 80 bits" is a cleaner sentence to say in
public than "just under", and the real loss is smaller than this conservative
floor.

**Implementation constraints.** All six are generated **in the browser**. Only
the chosen one is used. **The other five, and the index of the choice, are
discarded and never transmitted or logged.**

**Why the full retype rather than a wallet-style spot check.** Crypto wallets
ask for 3 of 12 words. That is a **compliance device, not error detection**:
asking 2 of 8 catches a single transcription error only **25%** of the time. Its
real job is forcing the write-down to happen at all — worth doing, but not what
it appears to be.

The test data says the stronger version is affordable here. Median typing time
for `tiny8` was **24.4 seconds** with 90% correct. Wallets ask for 3 of 12
because twelve long words is genuinely tedious; **eight short words at 24
seconds is not.** So haamu asks for the whole phrase and gets real error
detection for a cost the testers have already demonstrated is small. Hannu:
*"full retype is more valuable for success than the autocomplete."*

**On a wrong answer:** show the phrase again, ask for it to be written down
properly, and let them try again.

**Deferred, not rejected — a checksum.** BIP-39 carries one in its last word. It
does not fix a badly-written note, but at recovery time it turns a silent
failure into *"this phrase has a typo in it"*, which is a very different
experience at the worst possible moment. Worth revisiting when the recovery flow
is specified.

**Generalisable lesson, the same shape as D-018's:** *check what a measurement
was able to measure before believing what it says.* D-018 caught arms that were
not really contrasting. This round caught a `kept` split produced by the test's
own duration, and a memorability literature answering a question this product
does not ask.

---

## 2026-08-07 — Session 5 (the outside review of PROTOCOL.md)

Three independent reviewers read v0.3. Their raw output, the brief they worked
from, and the triage that reconciles them are in `reviews/`. The entries below
record only the decisions that came out of it; the reasoning for individual
findings lives in `reviews/TRIAGE_2026-08-07.md`, and the text changes are listed
in `PROTOCOL.md` §13.

### D-024. How the outside review was run, and why it is worth repeating

**Decided and executed 2026-08-07.** Recorded because the *method* produced most
of the value and the next round — a re-review after these edits, the vodozemac
measurement, and eventually the V2 group design — should repeat it.

**One brief, three different angles. Never three copies of the same brief.**
`REVIEW_BRIEF.md` was written once, with a Part 1 listing every deliberate
decision so reviewers would not spend their output rediscovering them. Part 4 then
assigned each reviewer a distinct angle:

| | Reviewer | Angle | Raw findings |
|---|---|---|---|
| A | OpenAI `gpt-5.6-sol`, high effort | cryptographic core | 5 |
| B | Grok 4.5 Expert | server and network | 5 |
| C | claude.ai Opus 5, ExtraHigh | claims against construction | 28 |

⭐ **The result that justifies the design: nothing was found by all three, and
every reviewer declared at least one section sound that another one broke.** The
deepest finding — that the server is told to compute an expiry it has no data for
— was found by A and C and **explicitly called sound by B**, which was reading
from the operator's point of view and checked that the retention *policy* was
coherent without asking whether it was *implementable*. Two-reviewer agreement is
a useful signal and it is not the only one.

**Every reviewer starts in a fresh context.** Grok had previously distilled this
plan from other material, and claude.ai Opus 5 wrote much of v0.2. A model that
helped create a design defends it — it treats its own earlier reasoning as settled
instead of re-examining it. Both were re-run cold, with no history.

**Claude Code was deliberately not a reviewer.** It co-authored D-016…D-023 and
much of v0.2 and v0.3; its job was the brief and the triage. **Two findings landed
on its own work and both were upheld** (D-029 below, and a wrong suggestion about
rounding the expiry timestamp). A reviewer who wrote the thing is the one reviewer
guaranteed to share its blind spots.

**Practical notes for next time.** For a *document* review, do not use a
code-oriented CLI — send the document to the API and use the strongest reasoning
model available. **Check the model list before every run; it drifts fast**, and
the tier is not inferable from the name (`gpt-5.6` turned out to be three models,
of which `sol` is the flagship). A briefed run cost a few dollars.

**Generalisable lesson:** *a review's coverage is set by the angle you assign, not
by the reviewer's ability.* All three were capable of finding all of it. Each
found what it was pointed at.

### D-025. Mailbox and blob expiry belong to the server's clock, not to the epoch

**Decided 2026-08-07 (Hannu).** `expires_at = created_at + 2 × EPOCH_SECONDS`,
computed server-side. Clients MUST NOT supply an expiry and the server MUST NOT
accept one. See `PROTOCOL.md` §5.1.1.

**The old rule was not implementable.** §5.1 told the server to expire a mailbox
at *"the end of epoch `e+1`"*. The server knows `mailbox_id` and nothing else; `e`
depends on an offset derived from `R`, which the server never sees, and
`mailbox_id` is a PRF output that reveals neither. There was no expiry field in
the registration body. An implementer hits this on day one.

**The obvious repair was the damaging one, and rejecting it is the actual
decision.** Letting the client supply the expiry hands the server the per-channel
offset as an **exact value** — 19.2 bits at second granularity, so two mailboxes
congruent mod `EPOCH_SECONDS` are the same channel with overwhelming probability.
**That is precisely the trade §9.1 already refused** when it turned down the
continuity-signature scheme, arriving by a different route. Rounding does not
rescue it: to the hour is still 168 buckets, ~7.4 bits, a strong join key at any
realistic size. For blobs it is worse, since upload is PoW-gated but otherwise
unauthenticated, so an attacker would set their own retention.

**What it costs, stated rather than buried.** D-006 and D-007 made the epoch
length and the retention period deliberately the same number, so there would be
*"exactly one number to reason about, to document, and to say out loud to a
user"*. That is no longer literally true: the epoch governs client behaviour and
rollover, while server retention is a flat 14 days from creation. The user-facing
promise (§5.4) is a floor — *"at least 7 days"* — so nothing said to a user
changes. **The elegance was real and it was traded for a rule that can actually be
implemented.**

### D-026. Proof-of-work is friction against casual abuse. It is not a defence, and the document no longer says it is

**Decided 2026-08-07.** §9.1's claim *"unnoticeable when creating a chat,
expensive at scale"* is withdrawn. The mechanism stays; the justification is
rewritten around attacker cost.

20 bits is ~10⁶ SHA-256 evaluations. A commodity GPU runs ~10¹⁰/s and solves
**roughly 10,000 challenges per second**; ASICs are three orders faster again,
because SHA-256 is the most ASIC-optimised function in existence. The asymmetry is
**four to seven orders of magnitude**, and the runtime `bits` knob cannot close
it: +10 bits buys 1000× attacker cost and puts an honest phone at 1000–2000
seconds. **There is no setting at which the attacker is inconvenienced and the
product still works.**

⭐ **The error was subtler than a wrong number, and it is the reusable part.** The
worked budget in §9.1 — 20 solves a week, ~40 seconds of background CPU — is
*correct*. It measures **the honest user's cost**, and it establishes that the
mechanism is *affordable*. It says nothing whatever about whether it *works*,
which is decided by the attacker's cost. Both numbers are needed and it is easy to
compute one carefully and believe it answered the other.

**Consequences now in the protocol:** the challenge is stateless
(`HMAC(server_key, …)`, no server-side storage, so issuing one cannot be a
memory-exhaustion target); blob difficulty scales with size
(`bits = 18 + log₂(MB)`); and **a global storage ceiling with an eviction policy
is required and is what actually bounds the damage** — open item 9. The unpriced
resource was never requests, it was storage: §9.2's limits permit on the order of
840 GB per IP per fortnight through blob upload alone.

### D-027. `roster_id` is disclosed, not rotated

**Decided 2026-08-07 (Hannu).** Add it to the `[server-trust]` table and state the
linkage plainly, in the same register §10 already uses for push notifications.
Specify that the client touches it **only on new-device setup and on channel
add/remove — never on launch, never on a schedule.** Do not rotate it.

**The finding.** `roster_id = HKDF(K_master, "lpm-roster-id-v1", 16)` and the
passphrase never changes, so it is a permanent per-user identifier presented from
every device the user owns. A client cannot poll any mailbox before decrypting the
roster, so the server sees `roster_id X` fetch, then poll `M₁…Mₙ`, on one
connection — and after every epoch rotation the next roster read re-links the
entire new set. New device, new country, new IP: still X. **§4 spends its design
effort rotating mailbox identifiers and §9.1 refuses a cheaper PoW scheme to
protect that, and then §7.3 hands the server a permanent identifier they all hang
from.** §10 already treats exactly this harm as serious enough to default push off
and write user-facing copy; the roster did it by default and said nothing.

**Why not rotation.** Two objections, and the second is the one that decides it.

1. **The rotation event is observable.** Rotating means read the old roster, write
   the new one, delete the old — one connection, seconds apart, same size. The
   server relinks trivially. **The user would be told they had achieved something
   they had not**, which is the same failure this session fixed in the paste
   dialogue (D-029).
2. **Any counter-based scheme breaks recovery.** There are no accounts: a new
   device finds the roster *only* by deriving the identifier from the passphrase.
   If the identifier advances by a counter, a new device must probe 0, 1, 2, … —
   **handing the server the entire chain of every identifier the user has ever
   had, in one burst, at the moment of recovering a lost device.**

**Hannu's two variants, both considered.** A manual *"rotate my id now"* button in
Settings, and then *"rotate at login if more than a week has passed"*. Both hit
objection 1 unchanged. The login-triggered version is **strictly worse on
objection 2** than a purely time-derived scheme, because the timing depends on
when the user happened to log in, so a new device cannot compute the current
identifier from the clock and must probe the chain after all.

⭐ **The principle that settles it: randomness defeats an adversary who has to
guess; it does nothing against one who is watching.** The server is not predicting
when a rotation happens — it sees the read, the write and the delete.

**What actually addresses the worry** — Hannu's own framing was *"the server knows
the same id reads at the same time every day"* — **is behavioural and free.** The
client caches the decrypted roster locally, which it must anyway to work offline,
and simply stops touching `roster_id` daily. The difference between "every launch"
and "a handful of times ever" is the difference between a continuous behavioural
signal and a rare one.

*A time-derived rotation (`roster_id_e`, probing `e-1, e, e+1`) is the variant to
revisit if this ever returns: it solves objection 2 completely. It does not solve
objection 1.*

### D-028. The forward-secrecy bound is documented, not engineered around

**Decided 2026-08-07.** Amend §6.2, §11 and §0.3 to state the truth. Do **not**
adopt the mechanism that would have closed it.

**The finding.** §6.2 presented *"only the messages sent before the recipient's
first reply"* as the bound the design earns its keep with. The derivation is
correct — two reviewers verified it independently — but the double ratchet
advances its DH ratchet only **on receipt**, and a sender cannot advance its own
chain unilaterally. **So a server that withholds the reverse direction — a pure
availability action §0.3 already concedes it can take — keeps the sender at chain
0 indefinitely, and every message it writes stays `R`-decryptable.**

**And it happens with no attacker at all.** A conversation that is never answered
— a tip-off, a report, a plea — has **100% of its traffic** in the vulnerable set.
For this product's intended users, one-directional flow is not an edge case. The
row read as a small bound and was not one.

⚠️ **§0.3's assertion that *"none of them is confidentiality"* did not survive and
has been removed rather than softened.** The `[server-trust]` table also gained
three entries it was missing while claiming to be complete.

**The mechanism was declined.** Reviewer C proposed — flagging it as its own
design idea rather than a finding, and explicitly asking that it be scrutinised —
that each client publish a random `mailbox_prekey_pub` when registering its
inbound mailbox, so the first message already involves a private key `R` does not
yield. **The cryptography is sound**, including that a server substituting its own
prekey degrades to a detectable decryption failure rather than a break. It is
declined anyway, on two grounds it did not address:

1. **It breaks new-device recoverability, which is the design's core promise.**
   Everything today derives from `R`, which is exactly why a channel survives on a
   new device holding only the roster (§7.1). A *random* prekey private must be
   **stored**, and a device that loses it cannot decrypt messages sent to it —
   turning `PROTOCOL.md` §5.4.2's undecryptable-message case from rare into
   routine.
2. **It is defeatable through its own fallback.** The scheme must fall back to the
   derived key when the recipient has not been online this epoch, because §5.1
   requires supporting exactly that. **A dishonest server simply serves no
   prekey**, the fallback engages, and the channel returns to the state the
   finding complains about. *A mitigation the server can switch off does not close
   a finding whose whole point is that the server controls the bound.*

**Generalisable lesson:** *when a reviewer offers a fix as well as a finding, the
fix is not covered by the finding's credibility.* C was right to separate them and
to ask for the fix to be scrutinised on its own; the documentation half stands
alone and was taken.

### D-029. Paste is allowed at phrase confirmation, and detected

**Decided 2026-08-07 (Hannu wrote the copy).** The `paste` event on the
confirmation field changes what the user is told. It blocks nothing.

> **You pasted the phrase.** So please make very sure it is properly saved
> wherever you pasted it from. If you lose this phrase, nobody — not even us —
> can open your conversations again.

**This resolves an incoherence between D-020 and D-023, written in the same
sitting and not reconciled.** D-023 rejected a wallet-style spot check because
*"it catches a single transcription error only 25% of the time — it is a
compliance device, not error detection"* and substituted a full retype. D-020 then
required that **paste must not be blocked**, and established that the phrase would
normally live in a password manager. Put together, the normal user copies the
phrase out and pastes it back, **the clipboard round-trip confirms nothing about
whether a durable copy exists, and the retype becomes exactly the compliance
device D-023 rejected** — for precisely the users D-020 calls typical.

Both decisions were individually right. Neither was wrong about its own subject.
They were incompatible about a third thing that neither of them was about.

**Two things stated in the protocol so they are not lost:** **pasting is not a
security risk** and must not be presented as one — the dialogue asks the user to
confirm something the software cannot check, and does not scold. And **if
detection fails, nothing breaks**: the normal flow runs, which is what would have
happened without detection at all.

**Generalisable lesson, and it recurs in D-027:** *never ship a control that
reports a success it cannot verify.* A green confirmation that confirmed nothing
and a "rotated" button that rotated nothing are the same defect wearing different
clothes.

### D-030. The short authentication string moves into MVP

**Decided 2026-08-07 (Hannu).** The out-of-band six-digit comparison of §3.6 was
marked *"V1"* and *"optional"*. It is now MVP, and specified exactly.

**Because the tripwire does not catch the attack §3.6 exists to describe.** There
are two variants and the text implied one mitigation covered both:

- **Race** — the attacker claims first, the legitimate joiner's claim hits a
  `CLAIMED` session with a valid MAC, **the tripwire fires.** Works as described.
- **Relay** — the attacker claims I's session as J, then **creates its own fresh
  pairing session** and sends J a different link over the same compromised
  channel. J claims it successfully, first time. **No second claim ever reaches
  either `pairing_id`, so nothing fires.** The attacker holds two channels, relays
  between them, and reads everything.

§3.6 said *"the tripwire fires when the legitimate party then fails to claim"*,
which is true only of the race variant. **MVP as specified would have shipped with
no defence at all against a relaying man-in-the-middle** — the exact threat the
section is about.

**The specification is now exact, and that matters more than it looks:**

```
d = BE32(HKDF(R, "lpm-sas-v1", 4)) mod 1000000      // six digits, zero-padded
```

*"Rendered as six digits"* left big-endian versus little-endian, `mod 10⁶` versus
truncation, and zero-padding all undefined. **Two implementations that differed
would show honest users a mismatch on a legitimate channel, and the product would
train people to ignore the one check that catches a full MITM** — worse than not
shipping it.

~20 bits is adequate and the reasoning is written down so nobody later "improves"
the flow by comparing fewer digits: the comparison is **one-shot and online**, so
an attacker must commit to the relay before the comparison happens and gets no
retries. This is ZRTP's argument for short authentication strings.

**Cost: one KDF call and a six-digit display.**

### D-031. The Olm layer is vodozemac plus a wrapper we write and maintain

**Decided 2026-08-08 (Hannu), after the spike found there was nothing to
evaluate.** `PROTOCOL.md` §6.1 said *"use vodozemac compiled to WASM"* and budgeted
half a day to *"evaluate vodozemac's WASM bindings and browser ergonomics"*.

**There are no bindings.** Measured: `vodozemac` and `@matrix-org/vodozemac` are
both absent from npm, and the vodozemac repository has no bindings directory at
all. What exists is `@matrix-org/matrix-sdk-crypto-wasm` — the entire Matrix crypto
SDK, exposing Olm only at the Matrix level — and `@matrix-org/olm`, which is libolm
under emscripten, the implementation vodozemac was written to replace, last
published 2023-10-27.

**So §6.1 was never a library choice. It was an unrecognised work item.** The
alternatives were reviewed and all three are worse:

- **matrix-sdk-crypto-wasm** — far larger, wrong shape, and probably cannot express
  §6.2's bootstrap at all, since it does not hand out Olm accounts.
- **libolm** — shipping deprecated crypto in a product whose entire claim is
  *verifiable* crypto is indefensible, whatever the engineering merits.
- **libsignal-WASM**, the fallback §6.1 itself named — the same missing-binding
  problem **plus** AGPL-3.0.

**So we write it.** Built during the spike: six operations — initiate, accept,
encrypt, decrypt, persist, restore — and nothing else. No Matrix concepts, no key
directory, no device lists. **11 of 11 end-to-end checks pass driven from
JavaScript, at 167 KB brotli over the wire** after `wasm-opt -Oz`.

⭐ **The reframing that made this an easy decision rather than a reluctant one: a
wrapper small enough to read is BETTER for this product than an off-the-shelf SDK
would have been.** `ARCHITECTURE.md` promises code integrity — that a person can
check what the client does. That promise is served by a few hundred lines of
declarative glue and defeated by a large SDK, whoever maintains it. What looked like
an unwelcome dependency to own is closer to the thing we would have chosen.

**The cost is real and goes in the roadmap, not a footnote:** a Rust→WASM build
step, reproducible on the same terms as the rest of the client, a pinned vodozemac
version, and an upgrade test (D-032). ⚠️ **This is Hannu's maintenance burden,
accepted knowingly** — the three alternatives were put in front of him with their
costs before he chose.

### D-032. Deterministic key injection, and the guard that has to come with it

**Decided 2026-08-08.** §6.2 requires Olm's identity and one-time keys to be
*derived from `R`*, because that is what lets a new device recover a channel with no
key directory. **vodozemac has no constructor for chosen keys** — `Account::new()`
generates at random and `create_outbound_session` takes only the peer's public
parts.

The route that works, verified in the spike, is the pickle: `AccountPickle` is
`Serialize + Deserialize`, so build it as JSON, substitute the derived secrets,
deserialize it back. **This is now the specified mechanism.**

⚠️⚠️ **It is also a coupling to a structure outside vodozemac's semver guarantee,
and the failure mode is the dangerous kind.** If a future release *renames* a pickle
field, serde ignores the unknown key by default and **leaves the randomly generated
key in place**. Nothing errors. The result is a session that encrypts and decrypts
perfectly — and a channel that cannot be recovered on a new device, discovered weeks
later by someone who has lost a conversation.

**Therefore, normative:** after constructing an account from derived keys the
implementation **MUST** verify that the account reports the public keys it was
given, and **MUST** fail closed if it does not. A pinned version plus a test that
exercises this path on every upgrade is required, not optional.

⭐ **This is D-030's third lesson turned on ourselves** — *never ship a control that
reports a success it cannot verify.* We wrote that about a green retype and a
"rotated" button that rotated nothing. Here the unverified success would be our own
key derivation, and the false report would come from a library rather than a UI.
**The lesson generalises past user interfaces: any step that can silently substitute
a plausible wrong value for the right one needs an assertion, not a comment.**

### D-033. `eph` was never load-bearing, and chain 0 has no ceiling

**Recorded 2026-08-08 — a measurement, not a choice.** Open item 8 asked where an
adversary holding only the channel root `R` stops being able to decrypt. §6.2
answered from Olm's documented handshake, and two of the three outside reviewers had
worked that derivation by hand on 2026-08-07 without being able to falsify it.

**The measurement agreed with the answer and disagreed with the reasoning.**

**What was measured.** An adversary given the whole `R`-derivable key set plus the
stored ciphertext decrypts **the initiator's sending chain 0 and nothing else** — 25
of 29 messages in the first run. §6.2's exposure row was correct.

⚠️⚠️ **Then chain 0 was set to 2000 messages, and 2000 of 2004 fell.** The "bound"
§6.2 tabulated is a free parameter, not a bound. The exposed set is exactly
*everything the initiator sends before the first reply the server chooses to
deliver*, at any size. The prose warning written on 2026-08-07 (T16) was right, and
**it is the primary statement about this design's forward secrecy, not a caveat
attached to a small number.** §6.2 now says it in that order.

**What was wrong.** §12 named two assumptions the derivation rested on. The
responder's ratchet key **is** random — confirmed, two responders built from
identical key material produced different keys. But **`eph` is not Olm's initial
ratchet key `T₀`**: they are separate keys, and vodozemac generates `T₀` itself, at
random, independent of the handshake. Three things follow:

1. **`eph` being random buys nothing.** Versions 0.2–0.4 called it *"load-bearing"*.
   The forward secrecy from chain 1 onward comes from `T₀` and `T₁`, which are the
   library's, not ours.
2. **The v0.1/v0.2 exposure table cannot exist.** Both variants leak chain 0 and
   nothing else; the difference was an artefact of assuming `T₀ = eph`.
3. **`eph` is not ours to choose, and never was** — the library generates it
   internally and takes no parameter for it. So §6.4's `eph_pub` was a second,
   *unauthenticated* copy of a value already inside the Olm pre-key message, bound
   into the 3DH, with no reader. **Deleted.**

⭐ **This is a strengthening, and the shape of it is worth keeping.** The property
survived; the *explanation* died. The explanation had been crediting a protocol
decision of ours for something the library provides unconditionally — so the honest
version is the more robust one: **this design's forward secrecy from chain 1 onward
cannot be broken by us getting `eph` wrong, because `eph` was never ours.**

⭐⭐ **THE METHOD LESSON, and it is a correction to how much comfort D-024 should
have taken from agreement: two careful reviewers who cannot falsify a derivation
have not measured it.** Both worked the triple-DH correctly. Neither could check the
one thing that turned out to be false, because it was not in the document — it was
in the library. **Where a claim depends on something outside the artefact under
review, no amount of reviewing the artefact reaches it.** Run it.

**And the gate is lifted.** Open item 8 forbade any public forward-secrecy claim
until it landed. §6.2 now carries the sentence it licenses, ending: *"If your friend
never replies, that applies to everything you sent."* That clause is the measured
result and must not be dropped for being awkward.

---

### D-034. Argon2id drops to 128 MiB, and the reason is §7.5, not §7.2

**Decided 2026-08-08 (Hannu).** `K_master = Argon2id(passphrase, salt, m=128 MiB,
t=3, p=1)`. Open item 2 closed. Measured on six devices (`DEVICE_RESULTS.md`).

The arithmetic that made it affordable: D-019 fixes the phrase at 82.7
**generated** bits and D-023's six-candidate choice leaves 80.1, so the offline
attack §7.2 describes needs order 10⁸ years at 128 MiB — the margin is carried by
the entropy floor, not by the memory parameter. ⚠️ **That is only true because the
phrase is generated. If §7.4 ever admits a user-chosen phrase this reasoning is
void**, which is exactly why §7.2's joint rule stays in force even though both
numbers are now fixed.

⭐⭐ **The reason it was worth doing came from a different open item, and would not
have been visible if the two had been measured separately. Where WebAuthn PRF is
unavailable, this derivation runs on *every unlock* rather than once per device**
— and D-035 records that Android offers PRF only under a condition some users will
decline. So the decade-old Android at 2.57 s was not paying that once at setup; it
was paying it every time its owner opened the app. 128 MiB brings it to 1.17 s.

⭐ **The generalisable part: §12 said items 2, 4, 5 and 10 should be run as one
session because they need the same devices. That was a logistics argument, and it
turned out to be an epistemic one.** Four separate sessions would have produced
four correct answers and missed the interaction between two of them.

### D-035. PRF needs a listed passkey, so PRF becomes an explicit choice

**Decided 2026-08-08 (Hannu), option "platform-aware opt-in".** Open item 4 closed.

> ## ✅ AMENDED 2026-08-09 — the reasoning survives; **"platform-aware" does not**
>
> Open item **4d** measured what this decision had assumed about iOS: that
> `residentKey: 'discouraged'` bought a cheap, unlisted, undisclosable credential
> there. **It does not.** `get()` with no `allowCredentials` offered five of this
> app's passkeys on the iPhone; iCloud sync is on and the Passwords app lists
> them. The credential is **discoverable, listed and synced on iOS too** —
> `discouraged` is a preference an authenticator may ignore, and iOS ignored it.
>
> ➡️ **The opt-in and the disclosure now apply on every platform**, with no
> branch. ⭐ **D-035's reasoning is intact and only its scope was wrong — in the
> direction that makes the design simpler.** The measurement removed a special
> case rather than adding one.
>
> ⚠️ Also learned: **an abandoned credential cannot be deleted by the page that
> created it** — there is no such WebAuthn API. Five accumulated on one test
> phone. Every failed attempt leaves a permanent listed passkey.

**The measurement first.** On a current Samsung flagship under Chrome 151, a
credential created with `residentKey: 'discouraged'` returns **no PRF at all**;
the same phone, same browser, minutes later with `residentKey: 'required'`
returns **32 bytes, stable across a browser kill**. iOS returns a working PRF
without a discoverable credential. ⚠️ This overturned an earlier conclusion of
mine — *"Android has no PRF"* — which had survived two browsers and several
repeats and was still wrong, because every one of those runs asked for the same
wrong credential type. **Repetition is not replication when every repeat shares
the same mistaken parameter.**

**The cost.** A discoverable credential is a listed passkey, synced to the user's
Google account. **Enabling PRF on Android therefore tells Google that this person
uses this application** — in a design that rotates mailbox identifiers (§4) and
rejected a cheaper proof-of-work scheme to protect unlinkability (§9.1, D-026).
It is now a named row in §11's "not protected against".

**The decision, as taken on 2026-08-08.** Platform-aware, and never a silent
default:

- ~~where PRF works without a discoverable credential (iOS today) — enable it, no
  prompt, nothing to disclose;~~ ⛔ **struck 2026-08-09** — the premise was
  measured false; see the amendment above.
- where it requires one — offer it once, in plain language, name the consequence,
  and **default to off**. ✅ **This is now the rule everywhere.**
- detect the behaviour at runtime, never from the user agent. ✅ Unchanged, and it
  is what catches the next platform that moves.

⭐ **This is D-016b's shape again: the convenient default and the private default
are not the same choice, and the product's job is to say which one is being
taken.** Hannu reached the same answer for Ghost mode and for this independently,
which is a reasonable sign it is the house rule rather than a one-off.

~~📌 Still open (item 4b): PRF stability across a **reboot on iOS**~~ — ✅ closed
2026-08-09, same 32 bytes after a restart. ⚠️ Note the wording that survived here
longest: *"where the credential is non-discoverable"*. **It never was.**

### D-036. An "end this conversation" control for Ghost mode — ✅ DECIDED 2026-08-09, and the mechanism I first proposed was wrong

**Raised by Hannu 2026-08-08:** a button that fills the session with dummy data
"so your browser does not by accident recall". **Accepted in purpose, rejected in
mechanism, and it turns out to be more necessary than the reason given.**

**Why it is needed, and the argument is a measurement rather than a worry.** The
device panel found that on iOS, **closing Safari from the app switcher does not
destroy the document** — the JavaScript context survived. So a Ghost-mode user who
performs the action they would describe as *closing the browser* still has the
channel root live in memory. **The product currently offers no reliable way to end
a Ghost session**, and that is a gap for exactly the user Ghost mode exists for.

**Why not dummy data.** Browsers do not store `sessionStorage` in slots that are
overwritten in place: Chrome keeps a log-structured database, Firefox rewrites
session-restore files. Writing junk **appends a record; it does not replace the
old bytes**, and deleting appends a tombstone. The value also existed as a
JavaScript string, which §7.7 already says cannot be zeroized. ➡️ **`clear()` and
dummy-fill-then-`clear()` are identical in effect**, so the fill buys only the
appearance of strength — ⭐ **D-030's third lesson again: never ship a control that
reports a success it cannot verify.** (The one technically real variant — flooding
the quota to force compaction — is quota- and version-dependent, the same class of
fragile heuristic that produced the withdrawn `persist()` rule the same day.)

**The shape to build.** Not a wipe, an *ending*: clear the session stores **and
replace the document**, then state precisely what happened.

---

#### ⚠️⚠️ The measurement (2026-08-09) falsified the parenthesis in that sentence

The version above continued *"(navigating away releases the JS heap, which nothing
inside the page can do)"*. **That is not true**, and it was the load-bearing part.

Round 2 of the device panel left the page and came back in three browsers. On
**Thorium/Chromium the document returned from the back/forward cache with its
entire JavaScript heap intact** — `persisted: true`, same page-load id, every key
still live. Safari/iOS and Samsung Internet/Android rebuilt it. All three were
served `Cache-Control: no-store`, which used to guarantee ineligibility and no
longer does.

⭐ **Two builds of the same Chromium major version disagreed, and the disagreement
is worth more than either answer.** It makes this a build- and flag-level detail
rather than a platform property, so the right response is not to record which
browsers do it but to **stop depending on it**. A measurement that yields a rule
beats one that yields a table.

⭐⭐ **And note what nearly happened.** The false claim was a parenthesis — an
aside inside a decision whose *conclusion* was right. It would have been
implemented without ever being read as a claim. **The riskiest sentences in these
documents are the ones doing work while looking like context.**

#### ✅ The decided mechanism (now §7.8, normative)

1. **Overwrite the key buffers in place** and drop the references. §7.7 forbids
   claiming zeroization for *strings*; typed arrays are mutable and this is the
   one place the distinction earns its keep — it is what protects a document the
   browser decides to keep alive anyway.
2. **Clear the session's local state**, `sessionStorage` first, so a rebuilt
   document in the same tab cannot read the conversation back out.
3. **`location.replace()`** — never `assign`, never a link. Replacing removed the
   history entry, and any cached copy of the document with it, in all three
   browsers. This is the step that does the work.
4. **Optionally**, behind its own separate control, serve the destination with
   `Clear-Site-Data: "cache", "cookies", "storage"`. **Measured to work fully on
   both mobile platforms** — including the cookie, which no script deleted. This
   was the one I expected Safari to ignore.

⚠️ Step 4 clears the whole origin, so it also signs the browser out of any Kept
conversation. Per §7.3 the roster is server-side under `roster_id`, so that costs
a passphrase re-entry rather than data — but the control must say so.

**The wording, corrected.** The first draft said *"only closing the browser, and
ultimately your operating system, can do that"*, which is too generous: closing
the browser erases no disk traces either, and §7.6 measured that on iOS it need
not even end the document.

> *End this conversation — removes it from this browser now. It cannot erase
> traces already written to your device's disk; nothing a web page can do reaches
> those.*

#### ✅ The joint question, answered with it: the root STAYS in `sessionStorage`

The two questions shared an answer and were decided together, as §7.2 and §7.4
are. **Memory-only is rejected.** Its cost is not "the user pressed reload" — it
is **the operating system reclaiming the page**, which iOS Safari does to
backgrounded tabs under memory pressure. The tab lives, the process lives, the
document does not. `sessionStorage` survives that; a variable does not. Ghost mode
would drop conversations at moments the user neither caused nor could predict —
**D-016's failure arriving by a third route.**

Memory-only also buys less than it looks like: §7.6 measured that closing Safari
from the app switcher leaves the document alive, so the act users *call* closing
the browser does not end an in-memory root either.

The residual is stated rather than hidden in §7.6: those bytes reach disk and
process death removes them only logically. That breaks no promise, because Ghost
mode's claim is already scoped to *"nothing in the roster, nothing recoverable on
another device"* and explicitly not *"nothing on disk"*. ➡️ **The gap Ghost mode
actually had was never storage. It was that the user had no reliable way to end a
session** — which is exactly what this control is.

### D-037. The Android PRF path is blocked until the synced-passkey question is answered — 2026-08-09

D-035 made PRF a platform-aware opt-in and §7.5.1 requires a **discoverable**
credential on Android, which means a **Google-synced passkey**. Checking an
unrelated claim exposed the consequence nobody had asked about:

> **Does that synced passkey return the same PRF output on a second device signed
> into the same account?**

It is unmeasured, and the two answers need different products. If the output is
the same, a PRF-wrapped `K_master` is **portable** across the user's Android
devices and the opt-in can say so. If it differs, the wrap is **device-bound
even though the credential is not** — a user who replaces their phone finds the
passkey present, the biometric prompt working, and the conversation unopenable
without the passphrase. That is the worst failure shape available: a control that
appears to work.

➡️ **Do not implement the Android PRF path until this is measured** (open item
4c). iOS is unaffected — its credential is non-discoverable and local.

#### ✅ ANSWERED THE SAME DAY: it is PORTABLE. D-037 is unblocked.

**Three devices, one Google account, Chrome, 2026-08-09.** The passkey created on
one phone returned the **same 32 bytes** on two devices that had never opened the
application, all three reporting a `platform` authenticator.

> ## ⛔⛔ WITHDRAWN THE NEXT DAY — the sentence that followed was wrong
>
> It read: *"The bad outcome does not occur: a person who replaces their phone
> keeps access."* **That does not follow.** What travels is the PRF *output*, so
> a second device derives the same `wrap_key`. What it must then decrypt is
> `AES-GCM(wrap_key, K_master)`, which lives in the **first** device's IndexedDB —
> and **browser storage does not cross devices** (open item 4e-i, measured
> 2026-08-09 on the same two Samsung devices this test used: all five storage
> kinds present on the writing device, all five absent on the other).
>
> ➡️ **The wrap key travels; the ciphertext does not.** A person who replaces
> their phone still needs the passphrase. **D-037's blocking concern is NOT
> resolved by 4c** — it is simply not made worse by it, and §7.5 now says so
> plainly to every user before they enable the feature.
>
> ⭐ Found by the round-2 reviewer pointed at *specification versus
> measurement* — the only angle that could have caught it, one day after this
> paragraph was celebrated. **The measurement answered a narrower question than
> the sentence written from it.**

⚠️⚠️ **But the good answer carries the cost the bad one would not have.** A
portable key is an **account-bound** key: on Android the §7.5 wrap can be
recomputed on any device the Google account can enrol, so its strength rests on
that account and its password-manager recovery rather than on possession of one
phone. ⭐ **The convenient answer and the privacy answer are the same fact seen
from two sides**, and only one side was visible before it was run.

Two things follow. One is normative in §7.5; the other was demoted the next day:

- ⛔ **"The wrapped `K_master` MUST NOT be included in any cloud backup" is
  WITHDRAWN as a requirement** (round 2, T20) and is now a threat-model residual.
  The property is real — with the key account-bound, the local blob is the only
  remaining device-bound factor — but **a web page has no API to exclude its
  origin's IndexedDB from a platform backup or a device transfer.** A MUST that no
  conforming client can implement, test or honour devalues every other MUST in the
  document. Whether a backup carries it is open item 4e-ii, and ⭐ **it gates
  nothing, precisely because the answer does not change what a client can do.**
- ✅ **§7.5.2's disclosure gains a second sentence** — that the unlock lives in
  the platform account — because *observation* by the provider and *control* of
  the unlock are separate costs a user may weigh differently. ⚠️ That sentence
  must **not** also promise a painless new phone; see the withdrawal above.

⭐⭐ **The measurement was nearly worthless, and one field saved it.** Both new
devices showed a prompt the tester read as *"do you want to get lpm-device-test
credentials from another device on that Google account?"* — **a sentence
ambiguous between the two outcomes the test exists to separate**: the passkey
being materialised locally, or this device asking the first one to answer over
Bluetooth. The second returns the correct bytes and measures nothing.
`authenticatorAttachment` disambiguated it (`platform`, not `cross-platform`) on
all three. ➡️ **A prompt's wording is not evidence about which mechanism ran; a
field the platform fills in is.** The guard was added on the suspicion, before
any result existed to justify it, which is the only time such guards can be
added honestly.

⚠️ **A second correction from the same check, and it has since been settled by
running it.** PROTOCOL 0.6 stated that PRF stability across a reboot was
*"confirmed on Android"*. It was not: the two readings were **75 seconds apart in
one session**, with no restart between them. The measurement was correct and the
description was not — the harness field is named for the *comparison* and carries
no evidence of the *event*. ⭐ **A claim about survival across something needs a
record that contains the something.**

✅ **Re-run properly the same day and it holds**: the discoverable credential from
2026-08-08 17:02:53 returned the same 32 bytes at 11:37 the next morning, with a
device restart between. **Item 4b is closed on both platforms.** ⭐ Worth noting
what this cost and what it bought: the claim was already *true*, and checking it
took one restart and one button. **The correction was not about the fact — it was
about whether we had earned it**, and the same check produced D-037, which is the
one that actually blocks work.

### D-038. Round 2 of the outside review — rotate the angles, not the reviewers

**Decided 2026-08-09.** D-024 said the method was worth repeating. This records
what "repeating" means, because the naive reading — same brief, same reviewers,
new version — would waste the round.

**The angle is the variable, not the reviewer.** D-024's generalisable finding
was that coverage is set by the angle assigned, not by the reviewer's ability:
all three were capable of finding all of it. It follows that re-running the same
three angles against v0.7 mostly re-walks ground that has been walked. **Round 2
therefore assigns three angles no round-1 angle was pointed at**
(`REVIEW_BRIEF_R2.md` Part 4):

| | Angle | Why it is new |
|---|---|---|
| **D** | Local state, keys, device lifecycle — §7 entire | The largest body of text in the document that no angle has ever covered, and where nearly all of 0.5–0.7's new material landed |
| **E** | The repair pass — v0.4's 26 changes read as new text | A fix pass applied in one sitting is exactly where new defects enter, and nobody has read those edits |
| **F** | Does the specification survive contact with implementation? | Only possible *now*: there are two measurement records and real code to check the prose against |

**Reviewer→angle is a rotation, and two other constraints agreed with it.** Each
reviewer gets a different angle from the one it had. That lined up with each
one's demonstrated strength — claude.ai found 28 of the 38 raw findings, so the
breadth reviewer gets the unexplored territory; Grok's five were focused and
concrete, so it gets the 26-item repair checklist; OpenAI found the deepest
structural defect by derivation across separated parts of one document, so it
gets the same across four — and with what each interface can physically ingest.
When three independent constraints agree, take the assignment.

⭐ **A category of finding that did not exist in round 1: "your claim does not
follow from the measurement you cite."** The document has stopped being purely on
paper, so a reviewer can now check prose against a record. It is worth telling
reviewers so explicitly, because the author has already caught himself doing it
once — 0.6 asserted Android PRF stability across a reboot from two readings 75
seconds apart in one session — and one instance found by self-review is not
evidence that there was only one.

**A fourth reviewer, on code — and it is the tool D-024 ruled out.** D-024
recorded that a code-oriented CLI adds nothing to a *document* review. The
corollary is that it is the right tool the moment there is code, and
`spike/wasm/src/lib.rs` is now 240 lines of real cryptographic Rust. Angle **G**
(`CODEX_BRIEF_R2.md`) points the Codex CLI at that one file, with the throwaway
harnesses explicitly out of scope. ⚠️ It carries one instruction the protocol
brief cannot: **§7.7's "zeroization is not achievable" excuse does not reach
Rust**, so a secret left lying in that file is a real finding there and not a
disclaimed one. An excuse that is true in one language travels into a review of
another unless it is explicitly revoked.

**Two things the reviewers are NOT given**, extending D-024's rule across rounds:
the other reviewers' output, and **the round-1 triage**. §13's change table
already says what each edit was for, which is what angle E needs; the triage adds
the verdicts, the rejections and the author's reasoning, and handing a reviewer
the author's reasoning is how you get it read back to you.

**Claude Code's exclusion got stronger, not weaker.** In round 1 it had
co-authored part of the document. It has since written v0.4 through v0.7 in full,
both device harnesses and the spike. It is now the least independent reader of
this specification in existence. Brief and triage; never finding.

**No V2 group angle, and the reason is not scheduling.** D-024 listed the group
design as something a later round should cover. **There is no group design to
review** — §6.2 says only that its deniability construction must not be reused
for one. Asking a reviewer to review a document that does not exist produces
design proposals dressed as findings, which is the most expensive kind of output
to triage. Groups are a design session, not a review angle, and Part 3 of the
brief says so, so that no reviewer fills the gap uninvited.

#### ✅ What the round produced, recorded because the method is being reused

**58 raw findings → 38 items** (`reviews/TRIAGE_2026-08-09.md`), all folded into
v0.8. Nine were against text written in v0.4–v0.7; all nine upheld.

⭐⭐ **F earned the round.** Ten of its sixteen findings are contradictions
*between* documents — impossible for any other angle, because they need the
architecture and the two measurement records held against the specification at
once. Three of the five top items are F's, **and it is the only reviewer that
found a defect in the previous day's headline result** (T27), which is the
sharpest possible vindication of inventing the claim-versus-measurement category
for this round. ⭐ **The generalisable form: defects collect at seams that no
single section owns**, and a document set acquires that class simply by being
edited.

⚠️ **E found nothing D did not** — six independent confirmations, one dissolved,
one "sound" declaration that was wrong. Partly a real result, partly **my error in
designing the angles**: "the repair pass" covers §7.3.1 and §5.4.2, which sit
inside "§7 in full". I built the overlap in. ⭐ **Rotating angles is not enough —
they have to be checked for disjointness.** F, designed to be disjoint from both,
is the one that paid.

⭐ **Running a second model on one angle was justified** — G2 found three things G
missed, two confirmed by inspection and one by reading Cargo's semantics. **This
qualifies D-024:** angle diversity dominates for a long document where the
reviewer must choose where to look; **raw reasoning ability dominates for a small
dense artefact where everything is already in view.** 240 lines is the second
case.

⭐ **And the round-1 pattern repeated exactly**: one reviewer declared §6.3 sound
— *"the three ordered rules close the three distinct defects"* — which is true in
isolation and misses that the rule depends on a write another section forbids.
**A section can be internally correct and still broken by its neighbour**, and a
clean area confirmed by one reviewer is not a clean area.

---

## 2026-08-09 — Session 8 (the v0.8 fold)

### D-039. The session generation is written to the roster, and §7.3.3 says so

**Decided 2026-08-09 (Hannu).** Round 2's T2: §6.3 put the generation in the
roster while §7.3.3 permitted a write only on channel add/remove and new-device
setup, so a careful implementer never wrote it and the stored value froze. On a
second device migration the recovering device re-used a generation the peer had
accepted, and the tie-break then had a coin-flip chance of telling the peer to
adopt the dead session — **silent, permanent channel death with the sender shown
"Delivered", no attacker required.**

**The tie-break fix needed no decision** and is in §6.3 rules 2 and 4: a session a
device cannot use is never a tie-break candidate. **The decision was where the
counter lives.** Permitting the write is the smallest change to a twice-reviewed
document, and the frequency is genuinely low — a device re-establishes a session
only when it has lost *all* local session state.

⚠️ **The cost is disclosed rather than hidden:** re-establishing a conversation is
now a moment the server can see this `roster_id`, which widens §7.3.3's
"rarely".

**Considered and not adopted: order sessions by creation time instead of a stored
counter.** §5.2's ±60 s clock bound makes wall-clock a reliable total order, and
it removes the roster write entirely. **It is a new construction that no review
has seen**, and §0's hard rule is that new constructions get specified and
reviewed before anything leans on them. Recorded so a later round can attack it.

### D-040. Deletion is two actions, and tombstones are permanent

**Decided 2026-08-09 (Hannu).** His position, verbatim: *"if mass deletion is done
on one device that should delete from other devices too. It is safer like that in
case a device is lost and compromised. Rather lose all than let somebody else have
all."*

Round 2 raised the opposite risk (T4, found independently by two reviewers): one
hostile or buggy write tombstones every channel, irrecoverably, everywhere —
tombstones store `SHA256(root)` truncated, not the root. Both concerns are real
and they attach to **different actions**, which is the resolution:

- **Delete one conversation** — propagates, permanent, no undo. The cost of a
  mistake is re-pairing one channel.
- **Delete everything, on all devices** — the panic action. **Passphrase retyped
  on the initiating device**, sets `purged_at`, and receiving devices **purge
  immediately with no quarantine.** This is exactly the lost-device case, and it
  must beat an attacker who gets into that device later.
- **Anything else arriving as more than one tombstone at once** — almost certainly
  a bug — is hidden and un-polled immediately but held in a **local, non-synced**
  7-day quarantine with an undo. Never written back, so Rule 1's property holds.

⚠️ **The quarantine's own residual is stated:** for those 7 days the roots still
exist on that device.

**Tombstones MUST NOT expire, and that half was not Hannu's call** — two reviewers
pulled the rule in opposite directions and only one direction survives (T19 vs
T30). Any expiry means a device dormant past it resurrects the contact on every
device; the clean alternative is to expire once every device has seen it, and
**there is no device list, by design.** With no way to know whether a stale
replica remains, a timer is a guess. **The price is a permanent record that a
conversation was deleted**, now disclosed in §11 with `at` rounded to the day.
⭐ Three reviewers' pressure on one sentence turned *"expire well beyond plausible
dormancy"* into a decision that had to be made rather than deferred by adverb.

**Considered and not adopted:** signing each tombstone under a key derived from
that channel's `R`. Stronger against a hostile device, useless against a buggy
one, and costs a per-channel signature.

### D-041. Regeneration is capped, and a longer phrase is offered quietly

**Decided 2026-08-09 (Hannu).** Two halves, one his idea.

**The cap** (T10): the numeric loss from unlimited regeneration is trivial — 100
rerolls still leaves 73.4 bits — but **§7.2's safety argument names a figure and
rests on it, and a figure that decrements with a button press cannot be bound.**
Ten sets of six, 60 candidates, `−log₂60 = 5.91`, **floor 76.8 bits**. In
practice 80.1 bits ≈ 420 million years of offline guessing and 76.8 ≈ 42 million;
the cap costs a factor of ten on a number that was already absurd. There is also a
behavioural reason: **regenerating until the words look agreeable is a softer form
of the trimming instinct the disabled edit field exists to prevent.**

**The 10-word option was Hannu's question** — *"if somebody is paranoid and wants
to have 10 words, can we allow that?"* — and the answer is yes, at **97.5 bits**.
It is offered as one plain secondary link under the candidates, in the register
§7.6 uses for Ghost mode: present it, do not explain it, do not default to it.

⚠️ **This is not a reversal of D-010**, and §7.4 says so explicitly so a later
reader does not undo it. Two of D-010's three reasons do not reach it — the phrase
is still generated and still un-editable, and the entropy moves *up*. Only "a
choice presented to someone with no basis" applies, and weakly: both arms are
safe and the only difference experienced is a longer retype.

⭐ **It also solves the cap's ugliest edge.** Someone who exhausts all ten sets now
has somewhere to go, and that somewhere is a **stronger** phrase rather than a
weaker one. ⚠️ The choice exists only at setup and can never be revisited, because
§7.2 has no rotation — which is why it belongs on the setup screen and nowhere
else.

### D-042. The PRF disclosure is platform-independent, and says what it cannot do

**Decided 2026-08-09 (Hannu approved the copy unchanged).** Follows D-035's
amendment and T27. The user-facing text is in §7.5.2 and is normative in
substance. Two things it must do that the previous copy did not:

- **Name the cost on every platform**, because item 4d measured the iOS
  credential as discoverable, listed and synced.
- **Say plainly that it only works in this browser on this device.** The previous
  copy implied a synced passkey made replacing a phone painless. **It does not:**
  the wrap key travels and the ciphertext does not.

⭐ **The honest version is shorter than the one it replaces**, because it has one
rule instead of a platform branch.

### D-043. Blobs live to the message TTL; nothing is burned on retrieval

**Decided 2026-08-09 (Hannu).** T35: delete-on-first-retrieval assumed one
recipient with one device, and **multi-device is MVP** — §7.3's merge machinery
exists for it — ⚠️ *(that premise is now open: `ROADMAP.md` Phase 1 lists
multi-device Out of scope. See item 13. The second reason below is independent of
it, so this decision stands either way.)* — so on every second device the attachment predeceased the message
§8 exists to keep it aligned with. A second reason was already written into §8 and
is stronger: retrieval needs only the `blob_id`, so the rule was **a burn
primitive available to anyone who learns one, including the server that assigned
it.**

Hannu's instinct — that a person who has seen the photo on their phone should
understand it is gone on the laptop — was right about needing a placeholder and is
kept, but **the reason changed when the rule was dropped**: inside 7 days that
case no longer occurs, and after 7 days the client **cannot know why** the fetch
failed. Expired, never existed, and withheld by a dishonest server are
indistinguishable. So the placeholder states only what is known: *"This file is no
longer on the server. Files are kept for 7 days, the same as messages."*

⭐ **The rejected alternative fails for the same reason the tombstone timer did:**
delete after *n* retrievals needs a device list, and there is none.

⚠️ **Amended 2026-08-09: the placeholder copy quoted above was wrong.** *"Files
are kept for 7 days"* — retention is `created_at + 2 × EPOCH_SECONDS`, which
§5.1.1 states as **7 to 14 days**. It told the reader their file left the server
sooner than it does. Now *"Files are kept for up to two weeks, the same as
messages."* ⭐ The decision is unaffected; only the sentence describing it was.

---

### D-044. The storage ceiling refuses; it never deletes early

**Decided 2026-08-09 (Hannu).** Open item 9, the last sizing decision. Three
findings shaped it, and none of them was the number.

**1. Files are ~98% of the storage bill — and files are not in the MVP.** Hannu
caught this: *"I actually thought that in this first phase only text messages can
be sent."* `ROADMAP.md` Phase 1 says *"text messages only"* and lists file
attachments under **Out of scope**; `PROTOCOL.md` §8 said *"Maximum 25 MB in
MVP"*. **PROTOCOL had drifted; the ROADMAP was right**, and §8 is corrected. So
the ceiling that actually needs a number before launch is the small one.

**2. A per-user blob quota is impossible without selling a privacy property.**
Blob upload is proof-of-work-gated but otherwise unauthenticated, so there is no
identity to charge. The only candidate is the mailbox — and binding a blob to a
mailbox tells the server which channel the file belongs to, then which mailbox
fetched it, linking the channel's two mailboxes. **That is the same trade §9.1
already refused for epoch continuity, reached from another direction.** The
global ceiling is therefore the only lever, and no affordable ceiling stops a
determined attacker: one IP uploads 2.5 GB/hour and the size-scaled proof-of-work
costs it under a millisecond of GPU per blob.

⭐ **So the decision is not how big. It is what happens when it is full.**

**3. Oldest-first eviction would be an attack primitive.** An attacker fills the
store; the server deletes *other people's* undelivered data to make room. **A
capacity policy would have become a way to destroy strangers' messages on
demand, with the server as the weapon** — and it would also make §5.4's "at least
7 days" false, which §5.5's delivery state is computed from.

**Decided:**

| | |
|---|---|
| **At the ceiling** | **Refuse new writes. Never delete unexpired data.** Recovery is automatic as retention drains; no operator action |
| **Ceilings** | **Separate for messages and blobs**, refused independently — a file flood must never stop message delivery, which is the product |
| **Enforcement** | A **reserved quota on the existing box**, enforced below the application (separate filesystem or kernel quota), not by our own byte counting |
| **A volume** | **Deferred to when usage starts** (Hannu). Hetzner's pricing page was not findable and the economy boxes are temporarily unavailable — and the files that would need the space are Phase 2 anyway |
| **§8's 25 MB cap** | ✅ **DECIDED 10 MB (Hannu, 2026-08-09) — see D-045.** 5 MB would refuse high-resolution photos from the panel's own S25 Ultra; 10 MB covers any photo and most short clips, cuts the abuse rate 2.5× (1 GB/hour/IP, not 2.5), and makes §8's single-shot WebCrypto encryption *easier* on a low-end phone |
| **A flat 7-day blob TTL** | 📌 **Open, Phase 2.** Available — a blob has no epoch structure, so §5.1.1's two-epoch rule does not reach it — and it would halve the dominant term and let the copy honestly say "one week". Cost: a message could outlive its attachment by a week |

⚠️ **The reserved quota is an isolation measure before it is a capacity one.**
The MVP host also runs privsend, which is live. Without an enforced reservation,
filling this service's storage takes that one down — **an attack on the unlaunched
product breaking the production one.** Hannu chose the reserved quota over a
separate volume; the mechanism must therefore be one the application cannot get
wrong.

⭐ **Rejected: a single global ceiling.** Simpler, but a blob flood then stops
message delivery too, which hands an attacker far more than filling a disk should
buy.

---

### D-045. MVP is one device at a time — but migration is in, and the merge rules stay

**Decided 2026-08-09 (Hannu).** Open item 13. *"It is not necessary in the
beginning in MVP. MVP can be with single device… That should be possible that user
ends using one device and starts new with same roster. One device at a time. But
not two devices at the same time in the beginning."*

⭐ **The contradiction dissolved because the word was doing two jobs.**
`ROADMAP.md` meant **concurrent** use — two devices live at once, and the
interface that implies. `PROTOCOL.md` meant **more than one device can hold
`K_master`**. Both statements were true; neither document was wrong about its own
subject. **The scope list now says which one it means.**

**In scope: sequential migration. It already works, and nothing was built for
it.** The roster lives on the server encrypted under `K_master`, addressed by
`roster_id = HKDF(K_master, …)`, so any device with the passphrase derives the
key, fetches the blob and recovers every channel and root. **A new device is not
distinguishable from a reopened browser** — the design never knew the difference,
which is exactly why ROADMAP's own Phase 1 definition of done ("closes the
browser, reopens it, types their passphrase, and the conversation is there")
describes migration without naming it.

⭐ **D-039 is the other half, and it was decided yesterday for a different
reason.** The new device has no Olm session — session state is device-local. It
bootstraps a fresh one from `R` (§6.2) and **writes the generation change to the
roster** so the peer adopts it. Without that write the peer keeps talking to a
session that no longer exists: T2's silent channel death *is* the migration
failure, met from the other side.

**Not in scope: two devices live at once**, and the cross-device interface that
would need.

#### What may NOT be dropped, and why

**§7.3.1's merge rules stay in the MVP.** They are not a feature of concurrency;
they are **what happens when "one device at a time" is violated** — and the
protocol cannot enforce it:

- **Every holder of `K_master` is a fully authoritative roster writer.** There is
  no per-device key, no device list and nothing to revoke (§7.3.1 rule 2, §11).
- So the old device is never actually retired. It keeps the passphrase and a
  cached roster, and the user goes back to it — a week later, out of habit, or
  because the new phone broke.

**The failure without merging is silent and unrecoverable.** Last-write-wins
means the stale device overwrites the roster and **destroys a channel's root
`R`** — the conversation is gone for good, and §3's pairing links are single-use,
so it cannot be re-paired. Even "refuse on conflict" is not enough: a 409
immediately after a successful pairing would strand the new channel while the
link is already burned. **The client must be able to refetch and re-apply its own
change, and that is Rule 1's union.**

Rule 3 (`generation` takes the maximum) is D-039, i.e. migration itself. The
tombstones of §7.3.1a are needed for the same reason: a stale device that merges
without them **resurrects a deleted contact**, and with migration explicitly
supported, "a stale old phone exists" is a designed-for state rather than an edge
case.

#### ⚠️ Migration is not a security boundary, and the interface must not imply it is

*"Sign out"* on a device can only mean **this browser forgets** (§7.8). It cannot
mean the server stops trusting the other device, because there is nothing to
revoke. If the reason for moving is that **the old phone was lost or stolen**,
migrating changes nothing for the thief: they still hold the passphrase route to
the same roster.

➡️ **The answer to a lost device is the panic wipe (D-040), not migration** — and
that is precisely the trade Hannu already chose: *"Rather lose all than let
somebody else have all."* **No copy may present starting on a new device as
securing the old one.**

⭐ **Rejected: enforcing single-device by having the server refuse a second
writer.** There is no device identity to refuse on — the only credential is
`K_master`, which is the same on every device by construction. A server-side
"active device" flag would be advisory at best and would give the server a new
per-user record to keep, which §4's whole design exists to avoid.

---

### D-046. The pairing handshake commits before it reveals

**Decided 2026-08-11 (Hannu), on a finding from implementing §3.6.** *"Yes this is
ok: the SAS fix — commitment."*

**The six-digit short authentication string did not do what `PROTOCOL.md` said it
did.** §3.6 borrowed ZRTP's argument that ~20 bits is adequate — *"the comparison
is one-shot and online, so the attacker must commit to a relay before the
comparison happens and gets no retries"* — **without borrowing the commitment that
makes it true.**

Under the flow up to 0.8.4, the relaying attacker of §3.6 orders the two
handshakes so that it moves **last** on one of them:

1. It sends J its own link. There it is the initiator and must publish first, so
   that channel's root is fixed before `J_pub` exists.
2. J claims. **Channel B's root is now final.**
3. It claims **I's** session, where it is the joiner — and §3.2 had already handed
   it `I_pub`. So it tries candidate keys, computing `R_A` for each, until
   `SAS(R_A) == SAS(R_B)`.

Step 3 is arithmetic on the attacker's own machine, with `L` in hand so every MAC
is forgeable. ~10⁶ attempts. **Measured at 2,700/s in unoptimised Node — six
minutes on one weak core, seconds with a native library — against a session that
lives ten minutes.** Both users would then read out the same six digits and be
reassured.

**The fix is ZRTP's, restored, not invented** (§0 forbids inventing one). I
publishes `SHA256("lpm-pair-commit-v1" || I_pub)`; J claims knowing only that
hash; I verifies `mac_J`, derives `R`, then reveals `I_pub`; J checks the
commitment before deriving anything. Neither party can choose after seeing the
other, so each attempt is a genuine 1-in-10⁶ shot that costs a whole fresh pairing
— which needs **both users to act again** and shows as a pairing that failed.

**Rejected: a longer code.** Grinding is cheap and parallel; 30 bits — six
characters from §2.2's alphabet — still falls to a GPU inside the ten-minute TTL,
and real margin would need ~48 bits, which is ten characters read aloud instead of
six digits. Digits also survive being read between two languages, which an
alphanumeric alphabet does not. **The commitment removes the attack; more bits
only price it.**

Cost: one hash, one extra endpoint, one extra poll. §3.1–3.4 rewritten,
`PROTOCOL.md` → 0.8.5, migration `002_pairing_commitment.sql`, and the client's
`pairing.js` and vectors updated the same day.

⭐ **The lesson is about citations.** 0.8.4 found an encoding this document had
never specified. This found an argument quoted from elsewhere whose supporting
mechanism had not come with it. Five reviewers read §3.6 and none caught it,
because the paragraph is true *of ZRTP*. It surfaced the moment someone had to
make the numbers come out.

### D-047. The whole-account wipe must work from a device the user has never used

**Decided 2026-08-11 (Hannu).** He asked whether a person whose device is stolen
could, from another device and with the full passphrase, **ban the lost device** —
and failing that, **block the entire identity**.

**A device ban is impossible here, and it is worth writing down why** so nobody
proposes it again. Mailbox authorisation is *derived from* `R` (§4.2), so anyone
holding a channel root can re-derive the keys and read; every holder of `K_master`
is a fully authoritative roster writer; there is no per-device key, no device list
and nothing to revoke (§7.3.1, §11). A server-side ban would stop nothing.

**Blocking the identity already exists** — it is the panic wipe of §7.3.1a
(D-040), passphrase-gated, setting `purged_at` so every device that merges purges
immediately and irreversibly. What was missing was one sentence: **it MUST be
reachable from a brand-new device with the passphrase alone.** The specification
permitted that and never said it, and the omission is the difference between a
usable remedy and a theoretical one — *the scenario the action exists for is a
device that is gone*, so offering the wipe only from an already-set-up device
offers it exactly where it cannot be used.

§7.3.1a now also states the reach honestly: it does nothing to a device that never
comes online, nothing to the counterparty's copy of `R`, and nothing about an
attacker who already has the passphrase. For that last case §7.2's answer stands —
re-pair every channel.

---

### D-048. §3.5's tripwire check belongs to the clients, because the server cannot make it

**2026-08-11, while implementing the pairing endpoints (ROADMAP Phase 1 step 3).**

§3.5 divided a second claim into two cases — *"valid MAC — someone else possesses
`L`"* and *"invalid MAC — a probe"* — and gave the division to the server. The
server has no key with which to test a MAC: `mac_J = HMAC(pairing_mac_key, …)` and
`pairing_mac_key = HKDF(L, "lpm-pairing-mac-v1", 32)` (§2.3), and `L` exists only
in the two browsers. The instruction was correct as a requirement and void as an
assignment.

**Rejected: fire on every second claim.** `pairing_id` travels in the request
*path*, so anyone who can watch traffic — a proxy, a compromised terminator,
anything that sees the request line — learns it without learning `L`. A forged
claim would then raise a genuine-looking *"someone else has your link"* on a
channel nobody touched, at will. **The one alarm this design has would become the
one alarm users learn to dismiss**, and that is a worse outcome than no alarm.

**Decided:** the server records the first refused claim's `J_pub` and `mac_J` and
serves them, unjudged, on `/status`. The clients verify — both roles still hold
`pairing_mac_key` at the moment it matters, I until §3.3 and J until §3.4. Later
attempts never overwrite the first: repeated claims must not be a way to erase
what an interception looked like.

⭐ **This made the property stronger, which is not the usual direction.** Under the
old reading a hostile server could *fabricate* a tripwire as well as suppress one.
Forging the evidence now needs `L`, so **suppression is the only remaining lie**,
and §0.3's [server-trust] row narrows to say exactly that. Fixing an impossible
instruction usually costs something; here it bought something.

**The same evidence answers the joiner's question on arrival.** J may find the
session already `CLAIMED`. If the accepted claim's MAC verifies, someone holding
`L` got there first — interception. If it does not, an observer of `pairing_id`
forged a claim: the link is spent, and **nothing was intercepted**. Both need
saying, in those words, because an alarm that cries wolf once has spent its
credibility.

⚠️ **The denial of service is real, unavoidable, and now written down** (§3.5,
§3.4). An observer of `pairing_id` can consume the single claim, or `DELETE` the
session — §3.4 specifies no proof for deletion and there is none the server could
check. Both cost the pair a link; neither yields `R`. The recovery is the honest
one: the initiator sees a claim it cannot verify, abandons, and makes a new link.

---

### D-049. The mailbox key travels in the credential, and an absent mailbox costs the server nothing

**2026-08-11, while implementing the mailbox endpoints (ROADMAP Phase 1 step 4).**

**The finding.** §5.1 requires an authenticated read of a mailbox that does not
exist — *"a read presenting a valid commitment and signature over an unregistered
`mailbox_id` returns empty, creates no row, and starts no expiry clock"*. It is not
a corner case: §4.1 has every client poll `e-1`, `e` and `e+1` on every drain, and
`e+1` normally does not exist. It is also not optional, because the alternative —
registering `e+1` in order to poll it — starts the server's
`created_at + 2 × EPOCH_SECONDS` clock two epochs early and makes §5.4's *"at least
7 days"* false.

**But nothing in the request could carry the key.** §5.4.1 defines the read as
`GET …/messages`, which has no body; §5.2's credential carried `ts`, `nonce` and
`sig`; and §5.2 excludes the query string from the canonical string precisely so
that no unsigned parameter can change a request's meaning. The server had neither a
stored key nor a submitted one.

**Rejected: 401 the poll of an absent mailbox.** It breaks §4.1 outright — and
worse than outright: §5.2 tells the client to read a 401 as a clock problem, so a
healthy device polling `e+1` would have been shown *"this device's clock is
wrong"*.

**Rejected: answer empty without authentication.** A registered mailbox 401s a
bad signature while an unregistered one would answer 200 — an existence oracle for
`mailbox_id`, which travels in the request path. §4.3's *"knowing a `mailbox_id`
grants nothing"* was made true at some cost in 0.8 and must not be spent again.

**Decided:** the credential carries `key=b64u(pk)` on **every** mailbox operation,
present or absent. It is outside the signature and safe there — `mailbox_id` is a
commitment to it and `mailbox_id` is signed, so a substituted key fails the
commitment and a stripped one produces a 401, which anyone able to strip a header
could get by dropping the request. `POST /register` therefore loses its `pubkey`
body field: one value, one place.

⚠️ **Always sent, never conditionally.** A client that sent it only when it
expected the mailbox to be absent would work for epoch `e` and 401 for `e+1` — the
intermittent authentication failure §5.2 spends a page trying to make impossible.

**And then the consequences, which are the interesting half.**

⭐⭐ **"Creates no row and starts no expiry clock" had to become "creates no
state".** Those two are what a specification thinks of; a server also keeps a
replay set (§5.2) and a per-mailbox rate-limit counter (§9.2), **both keyed on
`mailbox_id`**. Because the identifier is a commitment to a public key, **anyone
can mint a keypair, compute its identifier and sign a flawless request against a
mailbox that was never registered** — one signature per entry. Either structure
would then be an unbounded map filled by an unauthenticated caller, and both refuse
at their cap rather than evict (the correct policy for an IP-keyed limiter, whose
key space is bounded by reality). That combination is **a remote off-switch for
every signed operation in the system**.

The fix is one condition — write to neither structure unless the row exists — and
it is *sound* rather than merely convenient: every operation against an absent
mailbox is a pure function of its arguments, returning the same empty answer
however often it is asked, so there is no replay to protect against. The two
operations where a replay does something (`send`, and the `stream-token` §5.2
names) both require the mailbox to exist. The whole key space is thereby behind
registration, which costs proof-of-work and is IP-rate-limited.

⭐ **§5.2's verification order changed for the same reason.** It listed the nonce
before the signature — the natural reading, reject a replay before paying for
cryptography — but the nonce check does not read a structure, it *writes* to one.
Ahead of the signature that write is free to everyone.

⭐ **And one rule had to be written down because the fix removed the accident that
enforced it.** §5.5's `/status` must never answer `gone` for a mailbox that has
expired: `gone` renders to the sender as **Delivered**, for a message that died
waiting. Until now that was impossible by construction — the verification key lived
on the mailbox row, so an expired mailbox had no key and the request 401'd. With
the key in the credential the signature verifies, and the rule has to be enforced.
*A behaviour that holds as a side effect becomes a rule the moment the side effect
is removed, and nothing in the document points at it — only the change that removes
it does.*

**Flagged, not fixed:** `roster_id = HKDF(K_master, "lpm-roster-id-v1", 16)` is
**not** a commitment to `roster_auth`, so none of §5.1's anti-squatting argument
extends to the roster: whoever presents a proof-of-work first owns a `roster_id`.
Recorded in §5.2 for ROADMAP step 7 rather than repaired here, because rosters are
not on this step's path and a change made in passing is a change nobody reviewed.

### D-050. The message payload is JSON, and the cipher boundary carries bytes

**2026-08-11, while implementing the Olm session store (ROADMAP Phase 1 step 5).**

**The finding.** §6.6 required a `sent_at` *"inside the encrypted payload"* and
made it the value the interface displays. §6.5 padded *"the plaintext"* to a
bucket. §6.4 carried the result across the server. **No section said what the
plaintext was** — a field specified without the object it lives in. Two
implementers building from those three sections write incompatible clients without
either of them contradicting a sentence: one sends bare UTF-8 text and has nowhere
to put `sent_at`, the other sends JSON.

**Decided:** §6.7, `{"v":1,"kind":"text","sent_at":…,"text":…}` as UTF-8 JSON.
Three properties are worth naming because they are choices rather than
consequences:

- **A payload version distinct from §6.4's.** The envelope's `v` versions what the
  server parses; the payload's versions a structure the server cannot see, so it
  can change **without the server learning that a client upgraded**.
- **`kind`, with a rule about not recognising it.** An unknown `kind` or `v` is
  acknowledged and displayed as *"a message from a newer version of this app"* —
  explicitly **not** a decryption failure. Without that rule every
  forward-compatible change would arrive, on older clients, looking exactly like a
  damaged message, and §5.4.2 would destroy it after three drains.
- **`sent_at` is display only.** §6.6 already forbids it as the deletion timer's
  input; §6.7 adds that it must not order a history either. It is the peer's
  clock, and a peer is authenticated but not trustworthy.

⭐ **The consequence that was measured rather than argued.** §6.5's padded
plaintext is a byte string — an ordinary 200-byte message begins `C8 00 00 00` —
and the Olm wrapper's first production build typed `encrypt`/`decrypt` as
**strings**. Pushed through the obvious `TextDecoder`/`TextEncoder` pair, 256
padded bytes came back as 258 and §6.5's bounds check read a declared length of
12,435,439. The wrapper's own suite passed 25 of 25 throughout, because it only
ever encrypted sentences. A `latin1` reading survives, which is worse than failing
— it makes the string encoding a private convention between two builds of one
wrapper. The boundary now carries `Uint8Array` in both directions (§6.1,
normative). ⚠️ The frozen upgrade vectors were **not** regenerated for this: only
the test's comparison moved. *Adapting the reader to a changed API keeps the
evidence; re-running the generator would have replaced it with something that
agrees with today's build by construction.*

*A boundary between two correct sections is covered by neither of them.*

### D-051. A pre-key message for a session that exists is an ordinary message on it

**2026-08-11, while implementing §6.3 (ROADMAP Phase 1 step 5).**

**The finding.** §6.3 said: *"the client MUST additionally record the `session_id`
of every prekey it has accepted at that generation and reject a repeat"*. Measured
the same day: **an initiator whose peer has not replied emits a pre-key message for
every message it sends, all carrying the same `session_id`.** Messages one, two and
three of an unanswered conversation are all `type: "prekey"`. Applied to messages,
the rule delivers the first line and refuses the rest — and §6.2 states that a
conversation which is never answered has **100% of its traffic** in that shape. A
tip-off, a report, a plea: precisely the traffic this product exists for, deleted
by its own recipient, with the sender shown "Delivered".

**The danger the rule was written for is real.** Also measured: feeding the same
pre-key message to `create_inbound_session` a second time **succeeds**, returns the
plaintext again and rebuilds the session at ratchet zero. §6.2's bootstrap keys are
recoverable from `R` on every accept, so the one-time key never runs out.

**Decided:** the discriminator is the session table, not a message counter.
A `session_id` is the key to a session, not a token that gets spent.

1. A pre-key message whose `session_id` names a session this device holds is
   decrypted **on that session**. A genuine replay then fails inside the ratchet,
   because the message key it needs has been consumed — measured, and it is the
   library's own guarantee rather than ours.
2. `accept` runs only when there is no session for that `session_id`, and *there*
   the accepted-`session_id` set applies — because rule 5 can drop a session while
   its generation still stands.

⭐ **The general shape.** The specification named a *symptom* (a repeated
`session_id`) instead of the *condition* (an accept that would rebuild a live
session). They coincide in the case the author had in mind and diverge in the
common case. **Ask what the rule is trying to prevent, then check whether the thing
it tests is that.**

**Also found here, and recorded in §6.3:** the session generation must be read from
the roster and not from device storage. Written the wrong way first — the
generation kept beside the session pickles — a restored device starts again at
generation 1, which on a second migration is the frozen-generation defect §6.3
already documents, reached from the other end. *State exists to survive the event
it exists for; storing it where that event destroys it is a null decision.*

### D-052. The ratchet moves before the network does

**2026-08-11, while implementing the send and receive flows (ROADMAP Phase 1 step 5).**

**The finding.** §5.4.1 separates retrieval from deletion so that *"a client which
crashes between them loses nothing"*. That is true of the ciphertext and false of
the plaintext: decryption is not a read, it advances the receiving ratchet, and the
same ciphertext cannot be decrypted twice. A client that crashed between decrypting
and acknowledging would meet its own already-read message on the next drain, fail
on it three times, and tell its user **"a message arrived that this device cannot
read"** — a false alarm manufactured by its own crash, in the one place this
protocol promises never to lose mail silently.

**Decided (§5.4.3), and it is two rules in opposite directions:**

- **Receiving: persist before you acknowledge.** The plaintext, the advanced
  session state and the ids now safe to delete are **one atomic write**, and the
  acknowledgement follows it. Because that write can still be followed by a lost
  ack, a message may be handed to the interface twice, so **clients deduplicate on
  `msg_id`**. Delivering twice is recoverable; warning about a message the user has
  already read is not.
- **Sending: persist before you transmit.** A crash after transmitting and before
  writing leaves a chain key that has already been used, and the next message goes
  out under a spent message key: two plaintexts under one key, which for Olm's
  AES-256-CBC is their XOR. **A confidentiality break, where the other order costs
  a message that was never sent** — and the double ratchet is built to skip that
  gap.

⚠️ Neither rule can be enforced by the server, and neither is visible to a test
that never interrupts anything. Both were found by asking, of each step, *what is
true if the process ends here* — and the answer differed in the two directions.

### D-053. A stream cannot be opened until after the message it exists to announce

**2026-08-11, while implementing §5.3 (ROADMAP Phase 1 step 6).**

**The finding.** §5.3 opens an event stream **on a mailbox**. §5.1.1 said a mailbox
comes into existence only when someone **sends** into it. Put those together and a
reader cannot watch its own inbox until a message has already been delivered
there — **which is precisely the event the stream exists to announce.** The
consequence is not subtle: the first message of every epoch on every channel, and
the first message a brand-new channel ever carries, could never be delivered live.
Measured on the real server before the fix: **5.0 seconds, arriving by poll.**
After: **37 ms.**

Neither section is wrong on its own. §5.1.1 is about retention arithmetic and §5.3
about authentication; the defect lives in the space between them, and nobody
reading either one alone would see it.

**Decided (§5.3.4).** A client registers **its own inbound mailbox for the current
epoch** as a step of going live, and nothing else. `e-1` and `e+1` are polled and
never registered.

**It costs nothing in total**, which is what makes it an easy call. §5.1.1 already
says either party may register either mailbox and that the operation is idempotent;
the peer's first `send` would have created the same row. Two registrations per
channel per epoch, exactly as before — only the order changed, and §9.1's
proof-of-work budget is untouched.

⚠️ **What made it defensible is that §5.1.1's own safety condition already covers
it** — see D-054's sibling finding below, which is the same defect shape §6.3
carried until 0.8.8 (D-051): **the rule tested a symptom rather than its
condition.** *"Registration is a step of sending, never of polling"* tests the
registrar's intent. What actually makes an early registration harmful is that the
mailbox belongs to a **future** epoch, because only then does `created_at + 2 ×
EPOCH_SECONDS` land before that epoch ends and make §5.4's seven-day floor false.
The two coincided in the case in front of the author — §4.1's poll of `e+1` — and
diverged in the case that arrived a step later. §5.1.1 now tests the epoch.

### D-054. One stream per channel, not three

**2026-08-11, while implementing §5.3.**

**The finding.** §4.1 has every client watch **three** mailboxes — `e-1`, `e`,
`e+1` — and §5.3's stream is scoped to **one**. Nothing in either section said how
many connections a channel therefore costs, and the answer is not a detail: it is a
**3× multiplier on the exact number open item 6 exists to bound.** Two implementers
would have answered differently, and both would have been reading correctly.

**Decided (§5.3.3): one, on `e`.** The other two would buy almost nothing. §5.2
keeps every device within 60 seconds of the server, so two devices are within 120
seconds of each other, and the only moment a peer writes to an epoch this device is
not streaming is that window around a boundary — **once per channel per week.**
Three permanent connections to cover roughly four minutes a week is the wrong
trade. Clients cover it instead by shortening the poll interval near their own
boundary, which §4.1's per-channel offset lets them compute exactly, and every
drain reads all three epochs regardless.

⚠️ **A floor poll runs even while streaming, and it is not belt and braces.** A
design in which the only path to a message is a notification is a design in which a
lost notification is a lost message. Every refusal on the stream path — a
rate-limited mint, a full ceiling, a browser without `EventSource` — leaves the
client with the poll and nothing else, which is what makes it correct to say that
**every failure here costs live delivery and never a message.**

### D-055. A rate limit does not bound a ceiling

**2026-08-11, while implementing §5.3 and answering open item 6.**

**The finding.** §9.2 named `/stream-token` as *"the input to open item 6 — the SSE
connection ceiling per instance"* and offered a **per-hour rate limit** as the
control for it. **A rate bounds arrivals; a ceiling bounds residents, and neither
implies the other.** At 240 mints an hour and a half-hour stream lifetime, a single
mailbox can hold 240 connections open indefinitely and never once exceed its rate.

**Decided.** Both, and they are different mechanisms. The tight per-mailbox rate
stays — a reconnect storm must not spend the budget that carries messages, since
the fallback for a refused stream is polling and polling is what the general bucket
pays for. Alongside it, a **count of streams in residence**, per mailbox and per
instance, refused at the cap.

⚠️ **Refused, never evicted, and here the argument is sharper than the same rule
elsewhere in this design.** Both parties of a channel derive **both** directions'
keypairs (§4.2), so either can mint a token for the mailbox its counterpart *reads
from*. Under evict-oldest that party could knock the other off its live connection
at will, repeatedly, and the victim would see nothing but a flapping network.

**Measured, and it moved the answer.** 4000 concurrent idle streams against the
real binary: **≈35 kB resident per stream**, so 10,000 ≈ 350 MB and
ARCHITECTURE.md §1's *"tens of thousands"* ≈ 0.7–1.4 GB — plausible on the intended
box. ⚠️ But the binding constraint is **file descriptors, not memory**: below
`LimitNOFILE` the configured ceiling is unreachable, `accept` fails with "too many
open files", and that failure passes through no counter and reaches no client in a
form it can interpret. The process now checks at startup and says so.

### D-056. The keep-alive is an event, and the backoff resets on health

**2026-08-11, while implementing §5.3's client half.**

**Two rules, both about a client that cannot tell what state it is in.**

**The keep-alive is an EVENT, never an SSE comment (§5.3.1).** The conventional
keep-alive is a `:` comment, which `EventSource` never surfaces to any handler. It
stops proxies and NATs reaping an idle connection and tells the client nothing — so
*"connected and nobody is talking"* and *"connected to nothing"* are one state,
on exactly the mobile networks §5.3 and §9.2 both bend their rules for. A
black-holed socket is the failure that matters there, and without an observable
beat a watchdog cannot exist. Clients abandon a connection after three missed
beats.

**And no event carries content.** A wake that carried a message would make a **lost
wake a lost message**, and it is precisely the freedom to lose one that lets the
fan-out drop under back-pressure and the client fall back to polling. It would also
be a second delivery path with different retention, ordering and failure semantics
from §5.4.1's — two channels for one value, the defect class this project keeps
finding.

**Backoff resets on a HEALTHY connection, never on a successful one (§5.3.2).**
Reset on `open`, and a network that accepts connections and drops them two seconds
later mints a token every few seconds for ever: a correctly written client, doing
what the specification said, indistinguishable from an attack on the endpoint §9.2
singles out as the one that matters. A connection counts as healthy once it has
been ready for at least the maximum backoff. Worked through — 1 s → 30 s, jitter
never below 0.75 — that is **160 mints per hour worst sustained**, against a server
limit of 240. ⚠️ The jitter floor is load-bearing arithmetic, not decoration: a
symmetric jitter would reach exactly 240 at the bottom of its range, which is the
limit rather than a margin.

### D-057. A roster read is limited by whether the roster is there, not by where it came from

**2026-08-12, while implementing §7.3 and choosing which bucket each request lands
in.**

**The finding.** §9.2 states *"Per IP: … 30 roster reads/hour"*, and three
paragraphs later exempts signed operations on existing mailboxes from IP limits
because *"legitimate users behind CGNAT would otherwise be penalised, which matters
given known user concentration on mobile networks in Kerala."* **Both cannot hold
for the roster.** A roster read is a signed operation on an object that exists,
performed by every device at every unlock, and it is the one endpoint in the system
with **no fallback**: a refused mailbox read costs live delivery, while a refused
roster read costs the channel roots, which is everything. Thirty an hour shared
across a carrier's NAT pool is a locked door for the thirty-first person, and the
case the whole design exists for — a new device with nothing cached — is exactly the
one that cannot fall back on a cache.

**And the limit cannot simply be dropped.** It is the only online mitigation for
§7.2's guessing oracle: one Argon2id and one HKDF turn a candidate phrase into a
`roster_id`, and this endpoint says whether it exists. **A per-`roster_id` limit
cannot take its place, because every guess is a different identifier** — the thing
being probed is the key space, so the only counter that sees a guesser twice is one
keyed on where they are.

**Decided: charge the miss.**

- **absent** → the per-IP bucket, §9.2's 30/hour. Every guess is a miss;
- **present** → a per-`roster_id` bucket, like every other signed operation on an
  object that exists. Every unlock is a hit;
- **creation** → its own per-IP bucket (D-058).

§7.2 already implied this where it requires a wrong phrase on a new device to be
rendered as a retry *"counted against §9.2's limit"* — it counts the **retry**, and
never the success.

⚠️ **The lookup itself stays unlimited, and that is §5.1's resolution reused.** To
know which bucket to charge, the server must know whether the row is there. An index
probe is cheap; what is being bounded is the **answer**, not the query. The same
argument, and the same acceptance of its cost, as the absent-mailbox read.

⚠️ **What this does not fix.** A guesser still burns the shared bucket for everyone
behind their address — but now that costs those neighbours their *guesses*, not
their *unlocks*, which is the whole difference.

### D-058. The roster is the only row nothing reclaims, so the bound is on creating one

**2026-08-12, while writing migration 004 and the create handler.**

**Three things came out of one question — what limits roster creation?**

**§9.2 has no number for it, and it is the only operation that allocates
permanently.** §1 gives every other object a lifetime: a pairing ten minutes, a
mailbox two epochs, a message its mailbox's. The roster's is *"until deleted"*. That
makes §9.3.2's argument for enforcing the storage ceiling by refusal — *"recovery is
automatic: the store drains as retention expires, with no operator action"* — true
of everything except the one table that only grows.

**An expiry is not the answer and is not adopted.** There is no account to warn and
no address to warn it at; a roster that expires is an identity deleted for being
away, and the person finds out by typing a phrase that used to work. The quantity is
also small next to §9.3.4's real abuse path — 16 KiB against a mailbox's 20 MB — so
the honest treatment is to bound the **rate**, say plainly in §9.3.2 that this one
store does not drain, and leave the operator with a number they can watch.

**⭐ And the ordering of the limit against the proof-of-work is the substantive
part.** §5.1's flow means the first request of every create carries no solution: the
client asks, is told `pow_required`, and pays. Charging the address bucket on that
first request means **a caller who does no work at all can exhaust a shared
address's entire creation budget** — and it silently halves the limit for honest
users, who make two requests per create. **A cheap request that spends an expensive
budget is a denial of service on the honest user rather than a bound on the
attacker, which is the opposite of what proof-of-work is for.** Work first, then the
bucket.

**⭐ Creation also gets the ordering §5.1 wanted and could not have.** §5.1's order
is normative — signature, then lookup, then proof-of-work only if absent — because
register **exempts an idempotent re-registration** from the work and the server
cannot know it is in the exempt case without looking. A roster create has no such
exemption: it carries a blob, so a second create would overwrite somebody's
channels and must be refused outright. With no exemption to serve, the work can be
demanded **before** the lookup, which is what stops the 409 from being a free
existence oracle for a guessed `roster_id`.

### D-059. The compare-and-swap token travels in the signed body

**2026-08-12, while implementing §7.3.1.**

§7.3.1 and `ARCHITECTURE.md` §2.4 both specified `If-Match: <version>`, which is the
HTTP-idiomatic spelling. §5.2 signs the method, the path, the identifier, the
timestamp, the nonce and **the body** — so an `If-Match` header would be the only
input to a write decision anywhere in this system that the signature does not cover.
Nothing is gained by the exception: the server reads a JSON body as easily as a
header, and *"two ways to say one thing"* is the defect class this project keeps
finding (0.8.7 removed the last one from `register`).

**Decided: `{"if_match": <version>, "blob": …}` in the signed body.** The threat this
closes is narrow — under TLS the actor who could rewrite a header is the server,
which chooses the value anyway — and the invariant it buys is not: *everything the
server acts on is inside the signature.*

⚠️ **It changes nothing about §7.3.2**, which is the argument that matters. The
counter the server RETURNS is still outside the AEAD and still chosen by it, which
is why the version a client trusts lives inside the ciphertext.

### D-060. A merge rule cannot resolve a conflict by a field that is equal in every conflict

**2026-08-12, while implementing §7.3.1's merge and writing its unit tests.**

**The finding.** §7.3.1 rule 4: *"`name` is last-write-wins, resolved by `created`
order."* `created` is when the **channel** was added. It is written once, copied
verbatim into every device's roster, and never changed. A name conflict is by
definition **two copies of one channel** — same `root`, same `created`. **The
discriminator is therefore equal by construction in every case the rule applies
to**, and there is no other field in §7.3's channel object that records when a name
was changed.

**Decided: resolve by the `written_at` of the roster each entry came from**, which
is the only value in the format that can order two writes, and say what that costs:

- it compares two devices' **clocks**. §5.2 bounds each to 60 seconds of the server,
  so they are within 120 of each other — acceptable for a display name and not for
  anything finer;
- when they are equal, **nothing discriminates**. The client keeps the entry it
  already holds, which is deterministic, and **surfaces the unresolved rename** —
  because a rename that silently disappeared is worse than one that announced
  itself.

**The family this belongs to.** Seven steps, seven defects that five outside
reviewers did not find, each visible only when the section had to be executed: a
value specified everywhere except its encoding (0.8.4); a citation without its
mechanism (0.8.5); an instruction to a party that cannot carry it out (0.8.6); a
check without its input (0.8.7); a field without the object it lives in (0.8.8); a
precondition only the announced event can satisfy (0.8.9); and now **a resolution
rule whose discriminator is constant across the things it must discriminate
between**.

⚠️ **A note on how this was found, because the test did not find it.** The
end-to-end merge check passed with `mergeRosters` **removed entirely** from the 409
path — the compare-and-swap loop refetches and re-applies the caller's intention
against fresh state, which reaches the same answer by another route. One of two
mechanisms was doing all the work and the test could not tell which. The rule was
only exercised once it was tested as the pure function it is. **Step 6's lesson
again, in a new place: a test that passes under sabotage is not a weak test, it is a
different test than the one you thought you wrote.**

---

### D-061. A requirement to encrypt is not a design until a key is named

**2026-08-12, ROADMAP step 8, moving the client's state into IndexedDB.**

**The finding.** `ARCHITECTURE.md` §4.1 requires the Olm session state, the stored
messages and the outbound delivery state to be *"IndexedDB, encrypted"*.
`PROTOCOL.md` §7.2 derived `roster_id`, `roster_key` and `roster_auth`, and **none
of them is for this**. The requirement was addressed to an implementer who had to
invent the key, and both answers available to them are wrong in a way that looks
right:

- **reuse `roster_key`** — the key protecting a *different* plaintext held by
  *somebody else*, sharing an IV space between two constructions nobody analysed
  together; or
- **generate a random key and store it beside the ciphertext**, which is not
  encryption at all, and **is the one that looks most like it works**: the code
  reads the same, the tests pass the same, and the property is gone.

**Decided: `local_key = HKDF(K_master, "lpm-local-key-v1", 32)`**, with
`pickle_key = HKDF(K_master, "lpm-pickle-key-v1", 32)` beside it for the Olm
pickle — separate for one narrow reason, that the pickle is sealed by vodozemac's
construction and the record around it by §0.2's AES-GCM, and one HKDF removes the
shared-IV-space question. **It is not a second line of defence**; both fall to the
same passphrase and the same unlocked device.

**Why it matters, in one row of the threat model.** "Device theft, locked."
`K_master` is memory-only, so a key derived from it makes the stored ratchet
unreadable on a device that is not unlocked — and a pickle *is* the conversation:
§6.2 is explicit that Olm state decrypts on its own, without `R`. A key stored next
to the data buys none of that.

⚠️ **What it does NOT buy, recorded because encryption at rest invites the belief
that it does everything.** It does not hide **size** — the cached roster blob is
16412 bytes or 65564, so an examiner still learns which side of §7.3's one-way
growth this user is on, and no amount of AES hides that. It does not stop
**rollback** — the AAD binds a record to its slot, so ciphertext cannot be moved
from one key to another, but replacing a record with an earlier version of itself
authenticates perfectly, and an Olm ratchet driven backwards re-uses message keys.
§7.3.2 solves that for the roster with a high-water mark; there is no equivalent
for a pickle, and what stands between an attacker and it is holding the device.

⭐ **The near-miss worth recording.** The first draft of this reasoning justified
the key partly with *"and the cached roster's size is hidden too"*. It is not —
encryption hides content, not length. Same family as the WASM-memory claim two days
earlier: a correct mechanism, a plausible sentence, and a conclusion that does not
follow from it.

---

### D-062. An undo the merge rules had already made impossible

**2026-08-12, ROADMAP step 8, implementing §7.3.1a's quarantine.**

**The finding.** Three rules, each evaluable, each correct, each enforced:

| | |
|---|---|
| §7.3.1a | offers *"a local, non-synced quarantine for 7 days **with an undo**"* |
| §7.3.1 rule 1 | drops **every** channel whose root hashes to a merged tombstone |
| §7.3.1a | *"Tombstones MUST NOT expire"*, and dropping them is not permitted |

An undo that writes the channel back into the roster is undone by the very next
merge, on this device and on every other, permanently — and the one thing it
achieves first is **D-016's failure with an extra step**: the conversation
reappears, the user believes it was restored, and it disappears again. No field,
ordering or flag in §7.3's format can express *"this deletion was retracted"*, and
none can exist while Rule 1 is a set membership test over a set that only grows.

**Decided: the undo is local to one device, normatively and permanently**
(§7.3.1a′). It restores a channel that is not in the roster and can never be put
into it, and **the interface must say all three consequences** — it will not sync,
it will not appear on the user's other devices, and it will not survive this
browser's storage being cleared. Three further points fall out:

- **The restored conversation is not a stub and must not be described as one.**
  §4.2 derives the mailboxes from `R`, so it sends and receives normally and the
  counterparty never learns anything happened. What the bug destroyed is the
  user's *record* of the conversation, not the conversation.
- **Its session generation has nowhere in the roster to live**, so it is carried in
  the quarantine record — the one case where §6.3's counter is not in the roster,
  sound because nothing else will ever write to that channel again.
- **Deleting the tombstone instead is not available.** It would be re-added by the
  next merge from any device that still holds it, and if every device dropped it
  the undeletable contact list returns. The permanence of tombstones is
  load-bearing; the undo is what gives way.

**The shape of this defect is new, and that is the part worth keeping.** The first
seven were rules that could not be **evaluated** — a value without its encoding, a
citation without its mechanism, an instruction to a party that could not carry it
out, a check without its input, a field without its container, a precondition only
the announced event could satisfy, a discriminator constant across what it must
discriminate. **This one is a specification containing its own counterexample:**
every sentence is executable, and two of them cannot both be obeyed. ➡️ The
question that finds this class is not *"can I implement this sentence?"* but
**"what else in this document is true at the same time?"**

---

### D-063. The rule about which state survives an ending, made structural

**2026-08-12, ROADMAP step 8.**

§7.8 separates **conversation state**, which the ordinary ending clears, from
§7.3.2's **high-water mark**, which it must not — because a client with no local
version to compare against is precisely the precondition the roster rollback attack
needs. ⭐ **The most thorough ending manufactures the precondition for the
rollback**, which is why §7.8 excludes the mark and requires that ending to warn it
is resetting the check.

That is a rule about which records go and which stay, and an implementer holding
one object store obeys it **by remembering to**. Decided: three IndexedDB stores —
`conversation`, `messages`, `durable` — so the ending clears two by name and cannot
reach the third, and `flow/roster.js` **refuses to open a roster** unless given both
stores separately. A defaulted second store would mean an app that never thought
about it clears both, and manufactures the precondition every time somebody presses
"end".

The same move, the same day, applied to an **order** rather than a location:
§7.3.1a's entries are written to the quarantine **before** the roster that no
longer contains them is cached. §5.4.3 states the rule for messages — persist
before you acknowledge — and this is that rule about a different object. Cache
first, crash, and the device comes back with the deletion adopted, the entries
never held, and no undo and no notice for the case §7.3.1a itself calls "almost
certainly a bug". The e2e check is a quarantine that throws: the fetch fails, and
the device still holds its conversations.

---

### D-064. The prose is checked against the constants it describes

**2026-08-12, ROADMAP step 8.**

A number in a sentence is a **copy of a decision made in another file**, and a
sentence is the one artefact that keeps saying the old thing after the decision
moves. Nothing in a build reads English. This project has already shipped one:
§8's placeholder copy said files were kept for 7 days when retention was 7 to 14 —
it told the reader their file left the server **sooner** than it does, the
dangerous direction.

Decided: every user-facing sentence lives in `client/src/ui/copy.js`, every number
in one is **interpolated from the constant it describes**, and `test/copy.mjs`
checks two things — that the numbers are the constants, and that **no sentence
makes a claim the specification forbids**. The second is the one worth having, and
each pattern carries the section that forbids it: §7.7 (memory zeroization is not
achievable in JavaScript and claiming it is dishonest), §7.8 ("unreachable is not
erased" — nothing stronger than removal from this browser), §7.3.1a (the roster
records forever that a conversation was deleted, so never "every trace"), §6.6
(deletion is client-enforced and best-effort), §11 (no "unbreakable", no
"bank-grade"), §7.3.3 (`roster_id` is a permanent per-user identifier, so never
"anonymous"). Each of those is a sentence somebody would otherwise write in
perfectly good faith.

⚠️ The stray-digit check scans **literal** strings only. A template's digits arrive
from its caller by construction, so the interesting ones there are checked by name.
The first version scanned everything and reported the test's own sample arguments
as untraceable prose — **a check that fails for a reason unrelated to the property
it defends is worse than no check**, because somebody will eventually delete it.

---

### D-065. An ordering rule is not a concurrency rule, and step 8 quietly changed which one was needed

**2026-08-12, ROADMAP step 9.** PROTOCOL 0.8.12, §5.4.3a.

§5.4.3 has two rules — *persist before transmit*, *persist before acknowledge* —
and both are correct, both are enforced, and both are defences against a **crash**:
one client, interrupted between two of its own steps. D-061 moved the Olm session
record into IndexedDB so that a reload would stop costing a generation. IndexedDB
is shared by every tab of an origin. **The premise those two rules were written
under stopped being true in a change that mentioned neither of them.**

Two tabs each load the record, each `encrypt` — which advances the sending chain —
and each store. Nobody is interrupted; both follow the rule exactly. The second
store erases the first tab's advance, so the record no longer records that a chain
key was used, and the next message goes out under a spent message key. **Two
plaintexts under one key is a confidentiality break, and §5.4.3 already says so —
about the crash.**

Decided: **every write to a session record is conditional on the record that was
read, and a refusal restarts the whole operation.** The token is the previous
ciphertext itself — it changes on every write, it needs no extra field on disk, and
unlike a counter it cannot be rolled back independently of the thing it describes.
The restart is safe *because* the two orders were already right: nothing was
transmitted and nothing was acknowledged, so there is nothing to undo.

⭐ **The mechanism needs no lock and no other tab to be reachable.** An IndexedDB
readwrite transaction is atomic and isolated across every client of the origin, so
a read and a write in one transaction cannot interleave. That matters because
`ARCHITECTURE.md` §4.2 permits browsers with no lock API to run unelected clients:
a fix that depended on the election would have been absent exactly where the
election is.

⚠️ **The first version of the test did not reproduce it, and that is the part worth
remembering.** Racing two sends on an empty store, then sabotaging the conditional
write, produced *two Olm sessions* rather than key reuse — real, and a different
failure. Reuse needs a chain key that **already exists** for both tabs to advance
from, so the session has to be established first. A test written from the claim
rather than from the mechanism passes under sabotage and gets believed.

➡️ **The general rule: when a store becomes shared, every ordering rule in the
document has to be re-read as a concurrency rule** — and the change that shares the
store will not mention any of them.

---

### D-066. A wait needs something that ends it, and a document cannot list its own siblings

**2026-08-12, ROADMAP step 9.** PROTOCOL 0.8.12, §7.8.1.

§7.8 step 3 requires an ending to *"broadcast an end command to every same-origin
client and await acknowledgement before continuing."* Every word of that is
evaluable except the one doing the work. **A page has no client list.** A
`BroadcastChannel` is a fan-out with no delivery report and no roster of listeners,
so the ending cannot know how many replies to expect — the wait either never
returns or ends on a timer, and **a timer is not an acknowledgement.** Meanwhile
the control above it says *"removes it from this browser now."*

Decided: every client holds a **shared Web Lock** on one per-identity name for the
life of its document, and `navigator.locks.query()` is the missing list. The ending
broadcasts, then waits for the census to fall to one.

⭐ **The census is strictly stronger than acknowledgements, not merely easier.** An
acknowledgement is a promise about the future, made by the client least able to
keep it. The census reports what is **running**: a client that acknowledges and
then hangs is still counted; one that is killed with no chance to speak releases
its lock and stops being counted, correctly, having said nothing. Measured in
Chrome both ways.

⚠️ The name is a 128-bit commitment to `roster_id`, never `roster_id`. Lock names
are enumerable through `query()` by any script on the origin, which makes a name
closer to a storage key than to a value — and §7.2 identifies `roster_id` as the
value that confirms a passphrase guess with one HKDF. It is also per-identity: two
identities open in one browser are two independent sets of clients, and an
origin-wide leader would elect one and leave the other's conversations unwatched.

---

### D-067. Where the census is unavailable, the ending's WORDING is what gives

**2026-08-12, ROADMAP step 9.** PROTOCOL 0.8.12, §7.8.1.

`ARCHITECTURE.md` §4.2's fallback permits an unelected second client on a browser
with neither Web Locks nor `SharedWorker`. §7.8 step 3 requires every client to be
reached and awaited. **On such a browser those cannot both hold** — the same shape
as D-062's eighth hole, two rules each correct and jointly unsatisfiable — and as
there, the resolution is to decide *which one yields* rather than to leave the
conflict for an implementer to discover.

Decided: the ending still performs every step it can, and **may not claim it did so
for the browser.** Two sentences, and which is shown depends on what the census
established:

> **Confirmed** — "Ended. This conversation has been removed from every tab of this
> browser."
>
> **Unconfirmed** — "Ended in this tab. This browser could not confirm that every
> other tab of this app has done the same — if any are open, close them."

⭐ **The strong wording is licensed by a measurement, not by the action** — which is
§7.8's own rule about erasure (*unreachable is not erased*) one level out:
**removed from this tab is not removed from this browser.** `test/copy.mjs` checks
that the unconfirmed sentence does not make the claim, so the distinction cannot be
collapsed later by somebody tidying the copy.

---

### D-068. Silencing must precede the clear; only the confirmation follows it

**2026-08-12, ROADMAP step 10.** PROTOCOL 0.8.13, §7.8.

§7.8 numbered its steps and said they MUST be implemented in that order. Step 2
cleared storage. Step 3 stopped the SSE connection and told every other client to
stop. **So the ending emptied the database while the things that write to it were
still running** — and it needs no second tab to go wrong, because the surest writer
is the ending document's own drain, which may be between the mailbox read and the
write that stores what it read.

What lands in the just-cleared store is not a stray key. §5.4.3 requires the
decrypted plaintext, the advanced session and the ids safe to delete to be **one**
write, so the record left behind holds the message, sealed under `local_key`, which
comes back with the passphrase. The control above it said *"removes it from this
browser now."* Measured against a real server: one record, holding the text.

Decided: **step 1 silences — this document first, then every other client — and
step 4 waits.** The split is the whole correction. Only the silencing has to
precede the clear; the confirmation takes as long as it takes and belongs after it,
when there is nothing left to lose and the wait can afford to report failure
honestly. §7.8 is renumbered 0–6.

⭐ **The shape is new and worth naming: a sequence of individually correct steps
whose ORDER defeats one of them.** Every step of §7.8 is easy to check in
isolation, and checking them in isolation is exactly what misses this — which is
why `test/ending.mjs` records the SEQUENCE and asserts on that, rather than running
the steps and inspecting the end state. A test of the end state passes on the
broken order, because the other tab's own ending eventually cleans up after it in
the case where the other tab obeys.

---

### D-069. The ending page is inert, and learns its own wording from the fragment

**2026-08-12, ROADMAP step 10.** PROTOCOL 0.8.13, §7.8 step 5.

§7.8's landing page exists so that a document holding keys is replaced by one that
cannot. It therefore opens no database, derives no key and makes no request — but
§7.8.1 makes its wording depend on what the census established, so it has to be
told something.

Decided: **the outcome travels in the fragment.** It cannot come from storage, which
step 3 has just cleared and step 6 may have taken entirely. It must not come from a
query parameter, because that would tell the server how many endings were confirmed
and how many were not — a statistic about this instance's users that it has no
reason to hold. §2.1's fragment property, used a second time.

⚠️ And it is passed to the navigation callback as an argument. Written the obvious
way — `const outcome = await endSession({ navigate: () => ...outcome })` — it is a
`const` referenced inside its own initialiser: a TDZ `ReferenceError` thrown from
the last step of the ending, after the storage is already gone. That is how it was
written first; a real browser found it, and the comment above it had confidently
explained why it was safe.

---

### D-070. A lock must drop the DERIVED keys, and dropping `K_master` does nothing

**2026-08-12, ROADMAP step 10.** PROTOCOL 0.8.13, `ARCHITECTURE.md` §4.3.

§4.3 said: *"`K_master` is dropped from memory on lock, so a locked session cannot
be resumed without re-authenticating."* Both halves fail against §7.2.

`K_master` is a **derivation input**. §7.2 turns it into `roster_id`, `roster_key`,
`roster_auth`, `local_key` and `pickle_key`, and a correct client overwrites it the
instant those exist — at **unlock**. So the action §4.3 specifies has already been
performed, permanently, before any lock is reached: **obeying that sentence changes
nothing at all.** And the property is false while the five derived values live,
because they open the roster, every channel root, every session pickle and the whole
local history without ever needing `K_master` again.

Decided: the lock drops the **derived set**, including buffers nested inside it —
§7.7's table records `roster_auth` as a raw Ed25519 seed, so the only signing key
the client holds sits one level below the key object. Unlocking costs a full
Argon2id derivation, and that price **is** the mechanism.

⭐ **The question that finds this class: what changes when this rule is obeyed?** A
rule whose action is already unconditionally true cannot be what delivers the
property printed beside it. It reads as a safeguard, it passes review, and it is
load-bearing for nothing.

⭐ Second, smaller, from the same section: **the lock that matters is an event, not
an elapsed time.** A hidden tab's timers are throttled to about one a minute, which
is exactly the state the blur rule is about — so a client waiting for its own tick
repaints the conversation on return and locks it up to a minute later. It is
re-evaluated on `visibilitychange`, because the moment that matters is the device
being picked up.

---

### D-071. No roster read on launch — the panic wipe does not get its reach

**2026-08-12, Hannu.** Closes PROTOCOL open item 14 (0.8.13).

**The question.** §7.3.1a's panic wipe travels *in the roster*, and §7.3.3 permits a
client to read the roster on five occasions, deliberately excluding launch. So a
lost device that is unlocked and only **read** never asks, never merges
`purged_at`, and shows its cached conversations indefinitely. Giving launch a sixth
occasion would buy the wipe its reach.

**Decided: no. The launch stays off the list.**

⭐ **Because the request is the signal, not the answer.** `roster_id` is the one
permanent identifier in a design that rotates everything else, and §7.3.3 already
records what a logging server sees on one connection: *roster_id X fetched the
roster, then polled mailboxes M₁…Mₙ*. The mailbox identifiers rotate every epoch
and **every roster read re-links the whole new set to the same person.** A
launch-time read therefore does not merely add a timestamp — it hands the server a
fresh linkage between the permanent identity and the current mailboxes on every
launch, plus an activity rhythm, a timezone and a network history. That is the
property §4's rotation exists to create and the one §9.1 turned down a cheaper
proof-of-work to protect.

**The cost is accepted, and it is smaller than it looks.** Measured against the
client as built, an attacker on a lost device triggers a roster contact only by
pairing, renaming, deleting, pressing "check for changes", or sending on a channel
whose local session state is gone. **Reading the history and impersonating the
owner in an existing conversation touch the mailbox and never the roster** — so the
two most damaging actions were never going to trigger the wipe even with a launch
read. The wipe is owner-side cleanup: it stops the owner's *other* devices and any
new device from showing the conversations. As anti-theft it was always a race
between the device phoning home and the finder copying the data, and what actually
defends a lost device is the passphrase and §4.3's idle lock.

⚠️ **A rejected variant, recorded because it is the natural idea and it does not
work:** have the device always ask and let the *server* refuse unless a purge is
pending. The server holds the `roster_id`, the address and the timestamp **the
moment the request arrives**; the refusal happens afterwards, and the party doing
the refusing is the one that must be trusted not to log. **A request that is denied
is still a request.** (Hannu reached this himself in the same message.)

📌 **Kept for Phase 2/3 — the construction that gets both.** The server publishes an
identity-free list, or a bloom filter, of purged `roster_id`s. Every client fetches
it on launch **without presenting anything**: the same bytes for everyone,
cacheable, revealing only that somebody is running the app, which fetching the app
already reveals. A match then triggers one real roster fetch to confirm, so a
false positive costs an identified read and nothing worse. It leaks the *number* of
purges and lets anyone already holding a `roster_id` test it — and holding one means
holding `K_master`, so that leak is bounded. **Not adopted now**; it is new
protocol and this document is normative.

➡️ **What this obliges the product to say:** no client may describe the panic wipe
as a remote wipe, and §11's "a device the user no longer controls" row may not
offer it as *the* remedy.

⚠️⚠️ **AND A COPY WARNING FOR THE PURGED-IDENTITY LIST BEFORE IT IS BUILT**
(`ROADMAP.md` Phase 2). Hannu's proposed pitch — *"press here to fetch the
purged-identities list to protect yourself against stolen identities"* — is the
natural way to sell it and it claims the wrong thing, in the dangerous direction.
The list does not protect anyone against theft. **It lets a device learn that an
identity it holds was wiped from another of the owner's devices, and act on it.**
A device under someone else's control will not press the button and may never
launch, so the feature never reaches the case the pitch names. What it genuinely
does is give the owner's own devices a way to catch up with the owner's own
decision without contacting the server under their identifier.

Honest register, for whoever writes the real thing: *"Check whether you deleted
everything from another device."* The feature is worth having and worth surfacing;
the sentence has to be about **catching up with your own deletion**, not about
defending against a thief. ⭐ This is `feedback_legal_text_drift`'s lesson arriving
before the code rather than after the store listing — the cheapest possible moment.

### D-072. §7.6's storage rule was a closed list that left out the conversation — and §4.1 filled the gap with the forbidden answer

**2026-08-12, found by building ROADMAP step 11 (Ghost mode's interface). PROTOCOL
0.8.14, and the twelfth defect implementation has found in the specification.**

**What §7.6 said.** *"The root, the role, the session generation and all Olm session
state live in `sessionStorage` **and nowhere else**. No IndexedDB, no `localStorage`,
no Cache Storage, no cookie."* Four items, closed by a prohibition.

**What is not among the four: the messages.** The plaintext a person typed and read
— the conversation itself — is the thing Ghost mode exists to protect, and the rule
that says where Ghost mode's data may live does not mention it.

⚠️ **A closed enumeration says nothing about what it omits, and *"and nowhere else"*
is what stops the reader noticing.** The sentence reads as exhaustive **because** it
reads as strict. Every reviewer who checked it was checking whether the four named
items were in the right place, and they were.

⚠️⚠️ **AND THE GAP DID NOT STAY A GAP — ANOTHER SECTION FILLED IT.**
`ARCHITECTURE.md` §4.1's storage table carried one *Messages* row, *"IndexedDB,
encrypted"*, with **no mode qualifier**, directly below a Ghost row naming only §7.6's
four items. Read together — and read carefully, which is the point — the two
documents said: **put Ghost mode's messages in IndexedDB, encrypted.** That is

- the one store §7.6 forbids **by name**;
- the one **measured** to survive process death on both platforms, while
  `sessionStorage` is measured not to (`DEVICE_RESULTS.md`);
- "encrypted" under a key that **cannot exist**, because `local_key` derives from a
  `K_master` this mode has none of — so the implementer invents one (**D-061 again**),
  and in this mode the only place to keep it is the `sessionStorage` beside the
  ciphertext.

⭐ **THE SHAPE, AND IT IS 0.8.11's INVERTED.** D-062's eighth defect was three rules
of which two were **jointly impossible** — an action the document forbade itself from
completing. This is two rules that are **jointly satisfiable**, where satisfying both
leaves exactly one route through and it is the damaging one. A conforming client,
following both documents to the letter, writes the conversation to disk in the mode
whose entire pitch is that it does not.

➡️ **The question that finds this class: if this list is exhaustive, what is NOT on
it — and what does the rest of the document say about that?**

**The fix is not a fifth item.** §7.6's list has been extended twice already — the
Olm session state and the generation were both added after the fact, each because
leaving it out broke something specific — and a list that has needed extending three
times will need a fourth. So the rule now names the **category**: *everything §7.8
calls conversation state lives in `sessionStorage` and nowhere else*, with §7.8's
enumeration cited rather than copied. `ARCHITECTURE.md` §4.1 now qualifies every row
with the mode it is about, because **an unqualified row in a table that describes two
modes is a rule about both of them.**

**How it is kept true.** `client/test/ghost.mjs` asserts the message plaintext is in
`sessionStorage`, and the browser check asserts that a Ghost tab creates **no
IndexedDB database at all** — not an empty one, since a database left behind is an
origin-scoped artefact that outlives the tab. Sabotaged: moving the message log to a
Map outside `sessionStorage` fails eight checks.

---

### D-073. §4.3's idle lock has no mechanism in Ghost mode, and obeying it there would be a silent ending

**2026-08-12, same step. PROTOCOL 0.8.14, and the thirteenth defect.**

**What §4.3 says.** *"Lock the UI after 10 minutes idle or on tab blur exceeding 60
seconds. Unlock requires the PRF touch, or the passphrase where PRF is
unavailable."* Every sentence of that section is written for Kept mode without saying
so. §7.6's first sentence is *"no roster, no passphrase, no `K_master`"* — **the rule
names a recovery input that does not exist in one of the two modes this design
defines.**

⚠️ **And obeying it literally is worse than skipping it.** D-070 established what a
lock must drop — the five derived values — and that unlocking pays Argon2id again,
*"and that price **is** the mechanism rather than a defect of it."* In Ghost mode
there is nothing to pay it with. Dropping the keys destroys a conversation with no
phrase, no list and no server-side copy, **ten idle minutes after the person last
touched the screen**: D-016's tab-loss failure by a fourth route, and the first one
the client would cause itself.

**Decided: a COVER, not a lock.** It hides the conversation, drops nothing, and lifts
on one action.

⚠️⚠️ **The wording is the substance here, not the presentation.** A Kept lock is worth
something because lifting it costs a derivation from a secret only the user holds. A
cover costs a click — so it defends against a **glance at a screen**, and not against
somebody **holding the device**, which is the one thing §4.3 says a lock is for.
Calling both of them "locked" would be the strongest false claim in the product's
copy, in the mode §7.6 calls *"the feature the highest-risk user is most likely to
reach for, so the claim has to be exact."* So the cover **states that anybody using
the device can lift it**, and **offers §7.8's ending beside it** — because the ending
is the only control that does anything when the device is not in the user's hands.

⭐ **The same question that found D-070 one step earlier, with a different answer.**
*What changes when this rule is obeyed?* There: nothing — the action was already
unconditionally true. Here: something, but not in both modes, and in the second mode
what it changes is the user's conversation into nothing. ➡️ **Ask it once per mode.**
A rule stated once, in a document that defines two modes, has two answers.

**Kept in place by** `client/test/copy.mjs`, which fails if the cover's sentences
contain the word "lock" or stop saying that anybody can lift it, and by a browser
check that spends a real minute in the background and then asserts the conversation
still works after one click.

---

### D-074. In Ghost mode a duplicated tab must be INERT, and its lock name is minted, not derived

**2026-08-12, same step.** Three consequences of §7.6's duplicated-tab residual,
which the section stated and did not work through. Not defects — the section is
honest about the hazard — but each one had exactly one right answer and none of them
was written down.

1. **The lock name cannot be derived, because there is nothing to derive it from.**
   §7.8.1's per-identity name is a commitment to `roster_id`; this mode has none. It
   is therefore **128 random bits minted with the session and kept in
   `sessionStorage`** — which fits the job exactly: a duplicated tab is handed a
   *copy* of that value and asks for the same name, while an unrelated Ghost tab
   mints its own. ⚠️ **It MUST be minted only when absent.** A name generated per page
   load would look correct and see nothing — every duplicate would be a separate
   session that happened to share an Olm ratchet. And it MUST be **per-session**, not
   origin-wide: §7.8 step 1's end command must not reach a conversation the person
   never asked to end.
2. ⭐⭐ **The second document must be inert, not a follower.** §4.2's follower is a
   perfectly good client because the leader drains into the **same** IndexedDB —
   *"the store is the record and the notice is the hint."* A duplicated Ghost
   document shares **no** store with the one it was copied from: there is no record
   for it to re-read and nothing it could write that the other would ever see, so the
   only correct amount of work for it to do is **none**. Treating it as a follower
   would show a conversation that silently stops advancing.
3. ⭐⭐ **§7.8 step 1's broadcast is Ghost mode's only route to the copy**, where in
   Kept mode it mainly stops other writers. The duplicate holds an independent
   `sessionStorage` area nothing else can reach, so the end command is the single
   thing that can clear it — and without `BroadcastChannel`, nothing can. §7.8.1's
   unconfirmed wording covers the case; the **consequence** differs, and the copy
   says so.

⭐ **And the census turned out to answer a second question.** It was built for §7.8
step 4 — *"is anyone still here?"* — and Ghost mode's startup asks *"was anyone
already here?"*. Same mechanism, same answer, opposite end of the session. `null`
still means the browser cannot answer and still may not be read as the comfortable
value: where Web Locks is absent the duplicate is undetectable, which §7.6 records as
a residual and the interface states rather than papering over.

⚠️ **The arbiter is the writer LOCK, not the census.** The census decides what to
*say*; holding the exclusive lock decides who may *write*. That distinction is what
makes reloading the original tab safe: the reload releases the lock, the standing-down
duplicate is next in the queue and takes over, and **exactly one document is writing
at every instant in between.** A design that went inert on the census alone would
deadlock both tabs in that sequence.

**Verified in a real browser**, which is the only thing that can show that
`window.open` genuinely hands the new document a copy of `sessionStorage`: it does,
the copy stands down, the original keeps sending and receiving on a ratchet nothing
else touched, and removing the copy does not end the tab the person is using.

---

### D-075. §0.2's fallback is a WASM module we build, not libsodium.js

**2026-08-12, ROADMAP step 12.** §0.2 has said "libsodium-WASM fallback" since 0.2.
It is now a third pinned artefact of our own, `client/curve/`, built around
`x25519-dalek 2.0.1` and `ed25519-dalek 2.2.0`.

**The argument is §6.1's, read from the other end.** There, no vodozemac WASM
binding existed, so D-031 accepted owning one, and the compensating argument was that
six operations can be *read* where a large SDK could only be *trusted*. Here
libsodium.js exists — **and that is what disqualifies it.** It is a prebuilt
emscripten artefact from a package registry; reproducing it from source needs a
toolchain we do not pin; and `ARCHITECTURE.md` §7.1 makes an unreproducible build a
release blocker. It would have been the least verifiable thing in the product,
sitting on the exact path a review had already singled out — *"the fallback path
voids the whole table"* (review D). It also breaks §7.1's other rule: `client/` has
no dependencies and no build step.

**Why a separate artefact rather than exports added to the Olm wrapper**, where
`curve25519-dalek` is already linked and the marginal size would be near zero: the
reason `argon2/` is separate, one step sharper. A WASM instance that traps is
poisoned. The Olm instance holds every channel's ratchet state for a whole unlocked
session, and Ed25519 signs **every request** (§5.2) — so one instance would make "a
signature failed" and "every conversation on this device is now unusable" the same
event. Duplicating the dalek code costs nothing where it matters, because this
artefact is downloaded only by devices with no WebCrypto alternative.

**Measured, not declared:**

| | |
|---|---|
| artefact | 41,506 B raw, **15,607 B brotli** |
| imports | **none** — asserted by `build.sh` before the bytes reach `dist/`, and again in the test |
| reproducible | byte-identical from an unrelated path with a fresh `target/` |
| sign / dh | 0.276 ms / 0.136 ms on this machine |
| agreement | identical public keys and shared secrets on 50 random inputs, and byte-identical Ed25519 signatures — Ed25519 is deterministic, so this is an equality, not "both verify" |
| interop | **a WASM-only browser and a WebCrypto browser paired over real HTTP, matched §3.4's six digits, and exchanged messages both ways** |

`precomputed-tables` is off, from measurement rather than taste: it costs 34 KiB of
brotli to save 0.17 ms per signature, on the one artefact only slow devices fetch.

⚠️ **The fallback interface is SYNCHRONOUS, and that is a safety property rather
than a style.** The crate has four static buffers and no allocator — an allocation
per signature would be a leak that grows with a conversation — so two operations in
flight would trample each other's inputs. A synchronous function cannot be
interleaved by anything in JavaScript. Initialisation may be async; operations may
not. A sabotage that added one `await` between writing the buffers and calling the
module failed the concurrency check, which is what keeps this from being a comment.

---

### D-076. A rule written downstream of a branch that returns covers one path

**2026-08-12, same step. The fourteenth defect and a sixth shape** — and the one
least like the others: this rule was correct, evaluable, reachable, tested, and
written inside the function it guards.

`x25519.js` and `ed25519.js` each had the fallback branch as the first line of every
exported function, and every check *after* it:

```js
export async function dh(privateKey, peerPublicKey) {
  if (await useFallback()) return fallback.dh(privateKey, peerPublicKey);   // ← returns
  ...
  const { key } = await importPrivate(ALG, privateKey, ["deriveBits"]);    // the 32-byte check is in here
  const peer = await importPublic(ALG, peerPublicKey, []);                 // and in here
  ...
  if (acc === 0) throw new Error("small order");                           // §3.3's rule, RFC 7748 §6.1
}
```

Four checks, all real, all covering the WebCrypto path only. The path they missed is
the one **nobody developing the product runs**, and §0.2 has required it since 0.2.
The comment above the all-zero check even argued for its own existence — *"two checks
on one attack is the correct number"* — one line below the return that skips it.

➡️ **The question: which callers reach this line? A function's text does not say.**
Where a function selects between implementations, the checks belong above the
selection. The fix is not "check in the fallback as well" — that is a second place to
forget, and a third would follow. §0.2.1 now states it normatively, `okp.js` holds
one `requireBytes`, and every function reads *validate, branch, compute, check the
result*.

⚠️ **A corollary about how the gap was proven, which is the part worth keeping.**
`client/curve/test/curve.mjs` can force the fallback on a machine that does not need
it, so every §0.2 vector runs twice. But the test that actually pins this rule needs
no artefact at all: `client/test/unit.mjs` installs a **deliberately hostile**
implementation — wrong lengths, an all-zero shared secret, "yes" to every signature —
and asserts what survives. Whatever survives a hostile fallback is a rule that lives
above the branch. Whatever does not was a rule about WebCrypto wearing a function's
name.

---

### D-077. Test the path that only strangers' devices run, or it is untested

**2026-08-12, same step.** A consequence of D-075/D-076 general enough to state on
its own, because it is not about curves.

`installFallback(impl, { insteadOfWebCrypto })` exists purely so the fallback can be
forced onto a device that has the primitive. Without it, the only browsers that ever
execute that code are the ones the developer does not own — the path would first run
in production, on somebody's old phone, in a conversation that matters to them. With
it, every published vector runs on both implementations in one process, and the two
can be asked the same question and compared.

The same shape appears twice more here and is worth recognising: §7.2's Argon2id
rungs (a small phone's 128 MiB refusal, forced on a machine with plenty), and §0.2's
"neither implementation available" halt, reachable in a browser only by refusing the
module's fetch. **A branch that cannot be forced is a branch that users test.**

⚠️ Harness faults again outnumbered product faults, three to nil, and all three first
presented as product bugs: a `.msg.them` selector where the app writes `.msg.theirs`;
a joiner sent to a pairing link *after* it had an identity, which correctly lands on
a locked gate; and `ok("label")` written with no condition on a try/catch's success
path, so a working feature reported FAIL. The harness now throws on a missing
condition instead of counting it as a failure. **Reading the output is not optional
— the dump of both sides' state is what showed the messages had arrived all along.**

---

### D-078. A rule with no execution path — the fifteenth hole, found by preparing a deployment

**2026-08-12.** `ARCHITECTURE.md` §6 specifies a security header block: CSP with
`default-src 'none'`, HSTS, COOP, COEP, Permissions-Policy. It is correct, it is
normative, it has been in the document since early — and **it had never been
applied to a single HTTP response.**

**How that was possible.** Two paths could have served the client and neither did
it. The development path (`LPM_DEV_CLIENT`) set none of the headers **on purpose**
and printed a warning saying so. The production path was a sentence in `README.md`:
Caddy sets them, *"as it does for privsend on the same box."*

⚠️ **Both halves of that sentence were false, and the combination was the dangerous
one.** Caddy sets no security headers for any site on that box. privsend sets its
own **in Go** (`api.go:1557`, confirmed against the live response headers rather
than the source). So the precedent the sentence cited does the *opposite* of what
it claims, and anyone deploying by copying privsend's Caddy block — `encode` plus
`reverse_proxy`, nothing else — would have shipped lpm **with no CSP at all**.

**What it had already cost.** Served with §6's exact headers in a browser, the
shipped client produced **27 violations**: `index.html`'s `<style>` block and 24
`style="…"` attributes blocked by `style-src 'self'`, leaving the application
unstyled; and `ended.html`'s inline module blocked by `script-src 'self'`, leaving
`PROTOCOL.md` §7.8's landing page — **the page whose whole job is to say what
happened** — as two empty panels. Ten build steps of drift, in a direction nothing
could report.

⭐⭐⭐ **The shape, and it is D-076 one layer up.** D-076 was four correct checks
written one line *below* the branch that returned past them. This is a correct rule
written for a code path that **did not exist**. The question that finds both is the
same one: *which callers reach this line?* — and here the honest answer was **none,
ever**.

➡️ **A rule with no execution path cannot be observed to drift, which is not the
same as not drifting.** It is strictly worse than an absent rule, because it reads
as protection in every review of the document. The seven questions gain an eighth,
and it is the cheapest of them to ask: **when was this rule last executed?**

**The decision.** Not "remember to set them in production" — that is a fifth item on
a list, and this project has learned what those are worth. There is now **one** path
that serves the client and it carries §6's headers **in development too**
(`LPM_CLIENT_DIR`, `api/client.go`). The old variable is **refused at startup**
rather than honoured, because the name promised a headerless path that no longer
exists. Development and production being the same path is the whole fix: a page that
violates §6 now breaks in front of whoever wrote it, on the machine they wrote it
on, which is the only place a violation is cheap.

⚠️ **A sabotage of the new tests passed, and its lesson is one step 12 already
recorded elsewhere.** `TestCSPDirectives` asserted
`strings.Contains(csp, "connect-src 'self'")`. Widening the policy to
`connect-src 'self' https://cdn.example` still contains that substring, so the test
passed while the policy had just been handed an external origin. **A security
property that is about ABSENCE cannot be tested by asserting presence.** The policy
is now matched byte for byte, where an addition is a difference.

⭐ **And the test that would have caught the whole thing** is none of the ones
asserting that the server *sends* the headers. It is the one asserting the
**agreement** between the policy and the files: that the pages the server sends them
with can still run. That property was silently false for ten steps.

---

## 2026-08-13 — Session 15 (the first real-use feedback, answered)

Hannu used the live deployment the evening it went up and wrote down sixteen
observations (`FEEDBACK_2026-08-12.md`), then answered the two questions the
triage put back to him. These seven decisions are the result. ⭐ **Two of the
sixteen turned out to be protocol gaps, and neither could have been found by
reading** — see D-079 and D-081.

### D-079. §6.7.1's closing notice — and the fifteenth question, which is not asked of the text

**Hannu, three separate observations (feedback 8, 9, 10):** he ended a
conversation, and the other browser kept sending messages successfully — no
error, no notice, nothing at all. Then he deleted a conversation held under a
saved identity, with the same result. Then he asked whether there was a way to
invite the friend back.

**What was actually there.** Nothing. **There was no "I have left" message in this
protocol**, and no section anywhere discussed one. The peer's messages were going
into a mailbox nobody would ever drain, and sitting there for the fourteen days of
§5.1.1 before the server dropped them unread.

⚠️⚠️ **The part worth keeping is why fourteen previous defects were found by
reading and this one could not be.** Every earlier hole was a contradiction: two
rules that could not both be obeyed, a rule with no execution path, a premise that
had expired. This one has no defect in any sentence. §7.8's ending is local and
says so. §7.3.1a says *"the other person keeps their copy"*, which is exactly
true. **The failure is the union of two correct sentences, and it lives in a
section that does not exist** — so there is nothing to review it against.

➡️ **THE FIFTEENTH QUESTION: WHAT DOES THE PERSON AT THE OTHER END SEE WHEN THIS
HAPPENS?** Every rule in these documents is written from the acting client's side,
which is the natural way to specify a client and is exactly why the other side
goes unwritten. Two sections can be jointly complete about what *this* device does
and leave the peer with no account of the event at all.

**The decision**, and it is Hannu's design with three constraints added:

- Pressing the control sends a fixed `kind: "closed"` payload to the peer, then
  removes the conversation here. **No `text` field** — a sender who is destroying
  their own ability to receive an answer must not also choose the words on
  somebody else's screen.
- **The receiving side stops offering to send, and keeps everything it has.** A
  closing notice is an announcement, never a remote deletion. The alternative
  hands every peer a primitive that erases history on another person's device, on
  their say-so, which is precisely what an attacker holding a stolen channel would
  want most.
- ⚠️⚠️ **Absence must never be interpreted.** It fires only when a person presses a
  control; a lost, seized, offline or simply closed device sends nothing, and a
  single failed attempt looks identical. No liveness or presence claim may ever be
  derived from not having received one.
- Feedback 10's instinct — *"they should just start a new conversation"* — is right
  and matches the design. §3's links are single-use and the channel is being
  removed at the far end, so there is nothing left to invite through. The ending
  message says so, with the control beside it.

**On the silent exit.** The triage flagged that announcing your departure is not
always wanted — somebody ending under duress needs the quiet one — and Hannu's
answer chose the announcing default. That is the right default, and the quiet
route already exists: §7.3.1a's whole-account wipe sends nothing, and neither does
closing the tab. **What must not happen is a client that promises to announce and
merely tries; the copy therefore says the notice was *sent*, never that it
arrived.**

### D-080. `verified` lives in the roster and merges by OR

The verification state is a property of the **channel**, not of the device that
happened to perform the check, so a person who compares digits on their phone must
not meet "unverified" on their laptop for the same conversation. That puts it in
the roster.

Merged by OR (§7.3.1 rule 6) rather than last-write-wins, and the reason is D-060's
lesson applied before it bites: **a verification is an event at a moment this
format does not record.** `created` is the channel's birthday and `written_at` is
the blob's, so last-write-wins would resolve verification by a discriminator that
has nothing to do with it — the same defect rule 4 had. OR needs no discriminator
at all, and it can only be wrong in the safe direction: it can carry a verification
forward, and it can never silently un-verify a channel on the device in the user's
hands.

⚠️ It is also why there is no "mark this unverified" control. The remedy for a
channel you have stopped trusting is to delete it and pair again; an unverified
marker on a channel you distrust is a weaker act than not having the channel.

### D-081. The six digits do not gate the first message — and what they actually prove

**Hannu, feedback 6:** *"in a real long distance conversation the six-digit check
is a big slow down — is there no way around it?"*, and then the question that
turned out to matter: *"is it so that in any case the six digits are the same for
both participants, and that is not what should be checked?"*

**He is right, and the copy was teaching the wrong test.** The digits are equal at
the two ends of any completed handshake — that is arithmetic — **including a
handshake with an attacker.** `copy.pairing.sas` said *"Read these six digits to
each other. They must match."* and stopped, which describes a comparison between
two screens. ⭐⭐ **The comparison is between one screen and one PERSON:** does the
human being I meant to reach have these same six digits? A relay produces two
different numbers; an intercepted link leaves the intended person with no session
and therefore **no digits at all**, which is the louder answer and the one testers
will actually meet.

**The gate is removed, and that is a security decision rather than a usability
concession.** The two people are usually not on a voice channel at the moment they
pair — that is the entire reason a link was sent — so a gate stands in front of
somebody who cannot get over it yet, and **a wall people cannot get over is a wall
they learn to click through.** A check routinely satisfied by pressing the
affirming button trains people to press the affirming button, and that reflex is
what the attacker needs. So: three answers at the pairing screen (*we compared
them* → verified; *not yet* → stays unverified and the conversation opens; *this is
not my friend* → the conversation is deleted), the unverified state is shown inside
the conversation permanently, and the transition to verified stays available there
at any later time.

⚠️ **The copy may not call an unverified channel insecure.** It is end-to-end
encrypted and not known to be intercepted. What is unproven is one specific thing,
and the sentence has to be about that thing. Conversely `verified` records a human
judgement — that somebody compared six digits with somebody they believe is their
friend — and **no sentence may upgrade that into a cryptographic conclusion.**

A recorded-voice comparison is Phase 3 at the earliest. Worth naming why it is not
free even then: a recording carried through the channel is compared by the same
endpoint the check exists to doubt.

### D-082. §4.3's thresholds had never been measured against the product's own primary task

**Hannu, feedback 17:** *"the logout time was quite short."*

10 minutes idle and **60 seconds of blur**. The blur rule is the one that was
wrong, and wrong in a specific and embarrassing way: §3's entire design is that a
person creates a link **and then leaves this app to send it.** That is what
"link-paired" means. Switching to a messaging app, finding the right thread,
pasting, and coming back is routinely over a minute on a phone — so the rule
locked people out **in the middle of the one flow every single user has to
complete**, and lifting the lock costs a 128 MiB Argon2id derivation.

⭐ **The threshold had been reasoned about honestly, against the wrong question.**
"How long before an unattended device is a risk?" is a good question and 60 seconds
is a defensible answer to it. Nobody asked "how long does this product's own
primary task take?" — and a timeout is the intersection of the two, not the
minimum of one.

**30 minutes idle, 5 minutes blur, recorded in `ARCHITECTURE.md` §4.3 as
testing-period values rather than presented as measurements.** The end state is the
two-tier design Hannu names: a short window behind a quick re-entry code, with the
phrase required only after a long one. Until that exists, one tier does both jobs
and this is the compromise.

### D-083. The masthead is `haamu`; `lpm` was the placeholder becoming the name

**Hannu, feedback 1 and 2a.** The shipped client's masthead was `<h1>lpm</h1>` and
its title `lpm` — **the protocol namespace token, displayed to users as a brand,
which is the one thing D-001 forbids and D-012 predicted verbatim**: *"the
placeholder people see is the thing that becomes the name by accident."*

Restored from the Phase 0.5 prototype: **haamu**, with *"haamu is Finnish for
ghost"* under it. `lpm` keeps its job — it is in every HKDF `info` string, it is
permanent, and it names the construction rather than the product.

⭐ **And feedback 1 answered a question the documents had left as an assumption.**
"Link-paired messenger" is a good *description* and Hannu wants it used as one: the
answer to *what on earth is this, in a few words.* So the gate now opens with a
short plain-language paragraph — no accounts, no passwords, one phrase that opens
your list, an invite link only one person can use — rather than with a sentence
about phrase length, which is what somebody who has never seen this product met
first.

### D-084. A knowledge test conducted with the answer on the screen

**Hannu, feedback 12, and it is a security defect found from a button label.** He
observed that "Show it again" went to the list of candidate phrases rather than to
the chosen one. Underneath that complaint:

⚠️⚠️ **The chosen phrase was rendered on the same panel as the retype field**,
directly above the sentence *"Typing it back is the only evidence that a copy of it
exists outside this browser tab."* It is not. It can be read off the screen a word
at a time, or selected and copied — and `.phrase { user-select: all }` made
selecting the whole thing one click. §7.4's entire purpose for that step is to
establish that the phrase exists somewhere other than this tab, and **the layout
defeated the mechanism while every line of code implementing it was correct.**

⭐ There is even a paste dialogue, and it catches pasting, *with the thing being
pasted sitting above the field.*

➡️ **A mechanism's correctness is a property of the whole screen, not of the code
that implements it.** Nothing that reads source can see this: each function does
exactly what it should. The general form is short enough to keep — **a test of
knowledge must not be conducted with the answer visible** — and the fix is a split
rather than a hiding: one step that shows the phrase and asks the person to write
it down, one step that asks for it back with the phrase gone, and each button named
for exactly where it goes.

### D-085. The client prints its own timings, on purpose, for the tester round

**Hannu, feedback 13:** Opera opened the page in about a second; Chrome took nearly
ten. He will test more devices and browsers today.

⚠️ **Not diagnosed, and deliberately not guessed at** — `feedback_verify_before_claiming`
is fresh: the `innerHTML` claim of the previous day was reasoned out from the
specification, written down confidently, and wrong on the first click of the
deployed site. Two candidates exist and neither is measured: the deploy ships
`Cache-Control: no-store` on everything including 323 KB of WASM, which also
defeats the browser's compiled-WASM code cache; and Argon2id runs on the main
thread, with no Worker anywhere in the client.

`crypto/argon2.js` has recorded `{ms, heapMiB}` on every derivation since it was
written. **The decision is to surface it** — a diagnostics line a tester can read
off the screen and paste back, carrying the derivation time, the WASM heap it
reached, whether §0.2's curve fallback was installed, and how long the boot took.
⭐ **It is deliberately not sent anywhere.** A product whose claim is that the
server learns nothing does not acquire a telemetry channel to answer a performance
question. The person holding the device reads the number and types it to me, which
is slower and is the only version of this that is consistent with the rest of the
design.

---

## 2026-08-13 — Session 16 (the second sitting, and the defect reading cannot reach)

⭐⭐⭐ **THE SHAPE OF THIS ROUND IS THE FINDING.** Session 15 answered sixteen
observations from a first evening and produced two protocol gaps. Fourteen more
arrived the next day, and **almost none of them were prose defects** — the copy gate
built in step 15 had already swept that class. What came back instead was one bug
that no reading of any artefact could have found, one sentence in PROTOCOL.md that
was wrong for half the product, and one silent failure mode in an error table. The
list got shorter and the individual findings got deeper, which is what a second
round is supposed to do.

### D-086. A link that arrives after boot — the defect no reading could reach

**Hannu, item 7.** On `https://haamu.app/c`, pasting a received invite link into the
address bar *did nothing*. Clicking any link on the page first made it work. Opening
a new tab made it work.

**Cause: `app.js` read `location.hash` once, at startup.** The joiner's client
strips the fragment (§2.1), so that tab sits on `/c` — and pasting a link into the
address bar of *that* tab changes **only the fragment**. That is a same-document
navigation: the browser fires `hashchange`, does not reload, and does not re-run a
module. Both of his workarounds are full loads, which is exactly why it read as a
mystery rather than as a bug.

⚠️⚠️ **THIS IS THE FIRST DEFECT IN THIS PROJECT THAT NO READING OF ANY ARTEFACT
COULD HAVE PRODUCED, AND IT IS WORTH BEING PRECISE ABOUT WHY.** Every earlier one
was findable in principle: D-078's header block was a rule with no execution path,
D-084's layout defeat was visible on the screen, D-079's silence was two rules whose
union nobody had taken. Here **every line is correct.** The boot read is correct,
`runJoin` is correct, the fragment strip is correct. What is wrong is a fact about
the *platform* — that changing only the fragment is not a load — and no artefact in
this repository mentions it, because there is nowhere for it to be mentioned. The
`client/test/` suites are Node tests with no document, no address bar and no
history; a same-document navigation is not a thing they can have.

➡️ **THE SIXTEENTH QUESTION, AND IT IS ASKED OF THE PLATFORM RATHER THAN THE TEXT:
WHAT HAPPENS TO THIS CODE WHEN THE BROWSER DOES SOMETHING INSTEAD OF THE USER?**
Siblings worth the same look: `pageshow` from the back/forward cache (§7.8 step 0
covers it, and only because it was *measured*), `visibilitychange`, storage events,
and a service worker update.

⭐ Written into PROTOCOL §2.1.1 as a requirement rather than left as a client bug —
the next implementation of this protocol will make the same assumption for the same
reason. Fixed with a `hashchange` listener; ⚠️ note that `history.replaceState` does
**not** fire `hashchange`, which is what keeps §2.1's strip from re-entering it, and
which a later refactor to `location.hash = ""` would turn into an endless re-join of
a spent link.

### D-087. §7.8's own first sentence was written from one mode and obeyed in both

**Hannu, items 5 and 10, and it is the most alarming report of the round:** *"'End
this conversation on this device' is a button on the page that lists all the
conversations but no conversation is chosen. If I clicked that all conversations
disappeared."*

Nothing was lost — §7.8's ordinary ending clears this browser and §7.3's list comes
back with the phrase. **The label came verbatim out of PROTOCOL §7.8's opening
sentence**, which is true in **Ghost mode**, where a session holds exactly one
conversation and ending one is ending both. The section was written from that mode's
shape (Ghost has no other reliable ending — that is its second paragraph) and then
applied to Kept mode, where a session is the whole identity.

➡️ **A rule written for one of two cases and then obeyed in both**, which is
0.9.0's joiner-notice defect one layer up: there, a sentence written for the
initiator was shown to the joiner; here, a sentence written for one *mode* was shown
in the other. **Whenever this specification says "the conversation", ask which mode
the author had in mind.** §7.8 now says so about itself.

Kept mode's control is **"Forget my phrase on this browser"** and names no
conversation, because none is ended, none is deleted, nobody is told, and §6.7.1's
closing notice is not owed. ⭐ Hannu noticed that last part himself — *"in that case
no notification about ended conversation was sent to the other party"* — and he was
right: there was nothing to notify anybody about.

### D-088. No path from an exception to a sentence a person reads

**Hannu, item 13:** several fast clicks produced *"Pairing did not complete / 429
rate_limited"*. He read it as confirmation that the limiter works, which it is. It
is also an HTTP status on a user's screen.

**Two faults, and the second is the one worth keeping.** `flow/pair.js` did not map
§9.2's 429, so it left the flow as a bare `ApiError`; and the interface picks its
sentence with `copy.pairing.failure[err.reason]`, which an `ApiError` does not carry
— so it fell through to `err.message`. ➡️ **A lookup table keyed by an error code
fails silently on the code nobody thought of, and the fallback is where that failure
becomes visible.** Nothing in a build stands between a new failure reason and a
screen with an exception on it.

So the fallback is gone: the sentence a person reads is always one of ours, and
whatever the machine said goes in the detail line underneath, which is read by
testers and nobody else. `describeIdentity` had the same hole with no detail line at
all, and a 500 from the roster endpoints would have printed *"500 internal"*.

⭐ And the check that closes it **reads the reasons out of `flow/pair.js`** rather
than from a list kept beside the copy, because a list beside the copy drifts in
exactly the way the test exists to prevent. It found a second gap on its first run:
`server_state` had been raised since the module was written and never had a
sentence.

### D-089. §9.1's proof-of-work has a tail, and the diagnostics could not see it

**Hannu, item 2.** *"Almost all 'preparing the link' went very very fast. But twice
I waited probably 4-5 seconds"* — and the diagnostics panel, opened right after,
reported `boot 11 ms`, `key 380 ms`, everything healthy. His conclusion: *"the
waiting is some other lag than what can be measured in that timing."*

He was right, and the panel had nothing to say because it measured the two things
that happen at **boot** while the wait he was looking at happens on a **button
press**.

**Measured rather than guessed** (headless Chrome in this container, the production
twenty bits, eight solves): **322, 3651, 1628, 2305, 693, 2197, 620, 1155 ms.** An
eleven-fold spread on one machine at one setting. That is not noise: §9.1's solve is
a search for a nonce, so its cost is a **geometric random variable** with an
unbounded tail. Hannu's desktop derives an Argon2id key in 380 ms where this
container is far slower, so his mean is well under a second — and a couple of
four-second waits among many is exactly the tail that distribution produces.

➡️ **A wait with a long tail cannot be explained by a measurement of its typical
case.** The client now records the *last* link preparation rather than an average:
the number worth reading out is the slow one. 📌 **Open, and Hannu's call rather
than mine:** whether twenty bits is the right price. §9.1 already states that
proof-of-work stops no attacker and is kept for friction only — so the tail is paid
by ordinary users for a defence that was never load-bearing. Eighteen bits would
quarter it.

### D-090. A paste field for §2.1's link, and the one check navigation does not need

**Hannu, item 11:** after deleting a conversation there was *"no place to click to
get to a neutral page where the user can paste an invite link"*. D-086's listener
makes the address bar work from anywhere; this is the place he asked for.

⭐ **It turns out to be the better of the two routes, for a reason nobody asked
about.** Typing a link into the address bar hands the secret to the browser's own
history and its omnibox suggestions — and §2.1's `history.replaceState` reaches
neither, because it strips the fragment from the *page's* entry, not from what the
user typed. A field on the page never enters that store at all.

⚠️⚠️ **AND IT NEEDS A CHECK THAT NAVIGATION DOES NOT.** `pairing.parseLink` accepts
any string with a fragment, so a link belonging to a **different deployment** would
be turned into a `pairing_id` and claimed against *this* server — telling this
server about a pairing meant for another one, and spending the friend's single-use
link doing it. A browser cannot make that mistake, because it goes to the host named
in the link. **Offering a field means owning the origin check**, and PROTOCOL §2.1.1
now requires it, along with clearing the field the moment the value is read.

### D-091. Ghost mode is called Ghost mode

**Hannu, item 6:** *"maybe we start using the name 'Ghost mode' for branding it so
users associate the feature with the word Ghost."*

The mode was described everywhere and named nowhere: the gate offered *"talk without
setting up a phrase"*, the screen behind it was headed *"one conversation, in this
tab"*, and somebody who had used it had no word for what they had used. **The
product is `haamu`, which is Finnish for ghost** — so this is the one piece of
branding in the product that a user can derive for themselves.

⚠️ His own draft sentence was *"everything disappears when you closed the browser"*,
which is precisely the claim §7.6 forbids: the bytes reach the disk like any others,
and unreachable is not erased. The line under the offer says the conversation is
**lost for good** and says nothing about erasure; §7.6's full sentence is two screens
later, where it always was.

### D-092. Arriving with a link re-labels all three choices, and the third was invisible

**Hannu, item 3:** *"There was no choice to open the invite link in Ghost mode."*

There was — all three controls on the gate worked, and any of them would have opened
his link. What was missing was the **sentence**: the labels answered *"do you want an
identity here"*, which is not the question somebody holding a friend's link has, and
the Ghost one described a way to **start** a conversation rather than a way to open
the one in front of them. ⭐ **The choice was on the screen he was looking at and he
could not see it** — D-084's lesson from the other side: a control's correctness is a
property of the whole screen, and so is its existence.

All three now read *"Open it, and …"* when a link is in hand. ⚠️ The **order** is
unchanged — set up, already have one, Ghost — against Hannu's listing, which put
Ghost first. D-016b stands: for a first-time user Ghost is not a privacy feature, it
is the state in which they lose everything, and somebody arriving on a link they were
sent is very often exactly that person. 📌 Flagged to him as his call.

---

## 2026-08-13 — Session 17 (the third round: two answers, and §6.7.1's own defect next door)

Hannu came back with **three answers and four new observations**. The answers closed
D-092's open question (the order of the three link-arrival choices stands as built)
and §9.1's twenty proof-of-work bits (they stand). The observations are below.

⭐⭐⭐ **THE SHAPE OF THIS ROUND: IT FOUND A DEFECT WE HAD ALREADY FIXED, IN THE
SECTION NEXT DOOR.** Round 1 produced §6.7.1 because a conversation could not end
for both people. Round 3 found that §7.3.1a's panic action — which removes *every*
conversation an identity has — sent nothing at all. **The rule was derived from one
instance and never walked to the others.** Rounds 1 and 2 each produced a class;
this one produced the discovery that closing a class where you found it is not
closing it. The same sentence describes D-094 in the same sitting, in a different
subsystem, on the same day the first half of it was written.

### D-093. §7.3.1a's panic action sends §6.7.1's closing notice, purge first

**Decided and built.** Feedback 5: *"When 'I need to delete everything' the other
parties of the conversations did not get any 'this conversation is ended'."* He is
right, and the fix is owed by §6.7.1's own reasoning: its founding defect is
somebody typing successfully into a mailbox nobody will drain, and the wipe creates
that for every contact at once.

⚠️ **The order is the REVERSE of the single deletion's, and that is the decision.**
§6.7.1 rule 1 sends before the teardown because the teardown destroys the ratchet.
Here the roots come from the roster, so purging destroys nothing the notice needs —
and the action is a **race with whoever holds the lost device**. Putting N round
trips in front of the one write that matters would trade the property the action
exists for against a courtesy. So: **purge, then tell**, best-effort, each send
independent, and nothing here can fail the wipe.

⚠️⚠️ **THE GENERATION FLOOR WAS A CLAIM UNTIL A SABOTAGE MADE IT A MEASUREMENT, AND
THE FIRST SABOTAGE SAID IT DID NOT MATTER.** The notices are sent from a browser
that has never held these conversations, so each channel's `generation` floor has to
come from the roster entry. Hardcoding `0` left **every assertion passing** — §6.3's
*"(highest ever accepted) + 1"* from an empty record is 1, and an identity that has
never migrated is already at 1. The floor only bites from the **second device
onwards**: with the identity opened twice the peer sits at 2, a panic browser
starting from zero sends at 1, §6.3 rule 1 refuses it as `stale_generation` — and
the wipe still reports the notice as sent, **because it was**. Built, encrypted,
accepted by the server, discarded by the only person it was for. Silent at both
ends. ➡️ The browser run now migrates the identity before it wipes, precisely so the
sabotage has something to break; with that in place, removing the floor makes the
receiving end fail and nothing else. **A true premise is not a measured conclusion,
and a sabotage that changes nothing has not proved the line is safe — only that the
test could not reach it.**

### D-094. Closing a class in one module is not closing the class

**Decided.** D-088 (yesterday) fixed *"429 rate_limited"* reaching a user: the
sentence table was keyed by a reason an `ApiError` does not carry, and the fallback
printed `err.message`. The fix was a table plus a test that reads the reasons out of
`flow/pair.js`. **I stopped there.** `flow/roster.js` raises nine reasons and **six
had no sentence** — and one of the six is reached by pressing a button twice, which
printed *"§7.3.3 allows one check for changes per hour"* at a user.

⭐ Two smaller findings came with it, both of the same family:

- **The test written to catch "the reason nobody thought of" had a blind spot of
  exactly that shape.** Its regex matched `new PairFailure("reason"` on one line —
  the shape prettier produces when the message is short. **Five of thirteen
  constructions wrap**, and it could not see any of them. All five happened to have
  copy, so nothing was broken; what was broken was the guarantee. The reader now
  tolerates the newline *and counts*, and the caller asserts that the number of
  reasons it could read equals the number of constructions in the file.
- **`copy.clockSkew` was `(message) => message`** — the one remaining place where an
  exception's own text was the product's sentence, by design, and nobody had
  noticed it was the practice being removed.

➡️ **Written into PROTOCOL §12 as a client rule**, because three occurrences in two
days is not a bug, and each was found by a user rather than by a test.

### D-095. §7.8's ending does NOT send a closing notice, and this is a "no"

**Decided, against the request, and Hannu is the decider if he disagrees.** He also
asked that *"Forget my passphrase, and clear this site's data"* send the ending
notice. **It must not.** That control ends nothing: the conversations stay in the
roster, stay on his other devices, and come back on this one when he types the
passphrase — which is exactly what its confirmation, written yesterday for feedback
5 and 10, promises in so many words. A notice would tell the other person that a
conversation they can still use is over, and be false the moment he signed in again.

⚠️ **The failure mode this guards against is reading a request for consistency as a
request for symmetry.** The two controls look alike and mean opposite things, which
is D-087 one layer out. The copy suite now asserts the ending's confirmation still
says *"nobody is told anything"*, so a later reading of the same request cannot
quietly add it.

### D-096. The panic action does not delete the identity, and the label said it did

**Decided.** Feedback 4: *"'I need to delete everything' did not delete the identity,
meaning the 8 word list from working. Maybe it is good so that the person can inform
others what has happened."*

He is right about the behaviour and right about the value. §7.3.1a **cannot** delete
the identity: the tombstones and `purged_at` are what carry the deletion to the
other devices, and `destroy()` instead leaves them with a 404 that §7.2 requires to
be rendered as *"there is no identity under that passphrase"* — every channel root
still in place and the user told their passphrase is wrong. So the roster survives,
and the passphrase opens an empty list.

⚠️ **What was wrong was the label.** `panic.control` said *"Delete every
conversation, everywhere"*, which is exact; the route in from the gate said *"I need
to delete everything"*, which is a promise the action never made. **One control, two
labels, and the one written in the user's emotional register was the untrue one** —
D-087 exactly. The gate now says *"I need to delete every conversation"*, and the
panel gained the sentence he had to find out by doing: the passphrase keeps working
and opens an empty list. ⭐ And his instinct was right for a better reason than he
knew — the surviving identity is precisely what makes D-093's notices possible.

### D-097. "Check for changes" names the source, not only the act

**Decided.** Feedback 2: *"That 'Check for changes' would need some clarification
because it is a mystery. Maybe 'Check for removed mailboxes'."*

It is §7.3.3 case 5: ask the server for the conversation list again so that anything
done on **another device of yours** arrives here. His suggestion is the half that
matters most and is still too narrow — it also carries additions and renames — and
"mailbox" is a word this product never says to anybody. **"Check my other devices for
changes."**

⭐ The label and D-094's missing sentence are **one defect seen twice**: a control
whose purpose is unguessable is a control people press again, and pressing it again
is what printed the section number at him.

### D-098. "passphrase", everywhere, and a test that keeps it that way

**Decided by Hannu**, who looked it up rather than guessing: *"a passphrase is a
specialized security credential made of multiple words, while a phrase is simply a
group of words used in everyday language"* — and a search for "phrase vs password"
is silently rewritten to "passphrase vs password", which is the general
understanding voting. So the product says **passphrase** and pays the four
characters. Thirty-eight lines swept.

⚠️ **A swept file stays swept only until the next sentence somebody writes.** The
copy suite now walks every string the module can produce and fails on the bare word,
because a thirty-ninth line written next month would read perfectly well and nothing
else in this repository would notice. *(The protocol has said "passphrase" all
along; it was only the product that said "phrase".)*

### D-099. Feedback 2's timing, and the row that answered it

**No change, and worth recording as a confirmation.** Hannu reported a wait of
*"2 seconds"* with the panel showing `boot 10 ms` — and, in the same panel he
pasted, **`link 3359 ms, making it`**. That row is D-089's, added yesterday for
exactly this question, and its first appearance in the wild is a multi-second
proof-of-work solve. ⭐ **The measurement that was missing is now the measurement
that answers it**, and the number he was reading (`boot`) is not the one the wait
was ever in. §9.1's twenty bits stand, by his decision this session.

⚠️ One thing did change: `describeIdentity` no longer prints `err.message`, which
was the only way a tester could say *which* failure they hit. The diagnostics panel
gained a `problem` row carrying the machine **name** — never the message, since
those are what cite section numbers. D-085's rule holds: the tester reads it out;
nothing is sent anywhere.

---

## 2026-08-13 — Session 19 (the fifth round: a request for colour, and a number nobody complained about)

Six items. Five were *"put a bit of colour on the important things, and not too much
on the rest — so it is easy for a busy tester"*. All five are built. The sixth was
two diagnostics panels pasted with no complaint attached, and it is where everything
below came from.

⭐⭐⭐ **THE SHAPE OF THIS ROUND: THE FINDINGS WERE IN THE ITEM THAT WAS NOT A
COMPLAINT.** Round 1 found prose defects. Round 2 found fewer and deeper ones once
the copy gate became a test. Round 3 found a defect already fixed one section over.
Round 4 found a wrong *reason* rather than a wrong thing. **Round 5's five stated
items were all straightforwardly right and cost an afternoon; its three real
findings all came out of a panel he pasted "in case it is useful", one of which he
had already talked himself out of** (*"maybe that error was just carried forward
from something earlier"* — it was, and that was the bug).

➡️ **READ THE ATTACHMENT, NOT ONLY THE COMPLAINT.** A tester reports what annoyed
them. What they paste alongside it is the evidence, and it does not come with a
pointer to what is wrong with it.

⚠️ And the colour request itself found a defect nobody could have found by reading:
`#go-setup` had been written to be the filled accent button on the first screen of
the product and **had never once rendered that way**, because it sat inside
`class="rows"` and `.rows button` outranks a bare `button`. See D-104.

### D-107. A better explanation does not retire the older one above it

**Round 5b item 1.** Under the gate's four opening paragraphs sat one more:
*"Your conversations are locked with a passphrase of eight words. It is generated
here, on this device, and it is the only way back to them."* — the same three facts
as `product.what[1]`, in the same order, in shorter words, as the last thing a
first-time reader met before choosing a button. **Deleted.**

⚠️ **It was not written as a duplicate; it became one.** `phrase.intro` predates
`product.what`, which round 4 rewrote into the four paragraphs (D-083). Nothing
retired the older sentence when the better one arrived above it.

➡️ **ADDING A BETTER EXPLANATION DOES NOT RETIRE THE OLDER ONE, AND NOTHING IN A
BUILD CAN NOTICE THAT TWO STRINGS SAY THE SAME THING.** Every gate this project has
— `test/copy.mjs` reading the shipped HTML, the interpolation rule, the invite-link
rule — checks a string against a *constant* or a *pattern*. None of them compares two
strings to each other, and none of them could: "these two paragraphs are redundant"
is a judgement about a reader, and the only instrument for it is somebody meeting the
screen for the first time. **This is the class of defect the tester round exists to
find, and it is the reason not to over-brief the testers.**

⚠️ **The check that read the deleted string MOVED rather than going with it.** It
guarded D-064 — the word count on the gate is interpolated from `PHRASE_WORDS`, never
typed — and `phrase.intro` merely happened to be where that number was. It now reads
`product.what`. **When a string is deleted, its checks belong on whatever inherited
its job**; deleting them alongside it is how a rule quietly stops being enforced.

Also in 5b: **"Conversations" on the conversation screen takes the accent border** —
it is the way out, and it was reading as the least of three buttons, one of them red.
`send` above it stays the one filled action. And Hannu's example spoken code is
corrected to `KD8D-UK4Y-4EHU-U3FG`; it was a throwaway illustration, not a proposal.

### D-104. Colour means something, and a layout class that paints is a trap

**Feedback items 1–5.** Hannu: *"the purpose is just to have a bit of colour on the
items that are the most important ones… and at the same time not too much strong
colour on items that are not crucial"*, with the explicit note that his own colour
suggestions were suggestions.

**Decided: two hues, three strengths, and the hue carries a meaning.**

- `--accent` (green) — **things you do and say on this device**: the one action on a
  screen, your own messages, this device's own state.
- `--second` (violet) — **things that are not you**: an identity you already have and
  are bringing back, and the other person's words.
- Strengths, which is where *"not too much"* lives: a **filled accent** is the single
  action on a screen; a **soft fill with a coloured border** is important; a
  **coloured border alone** is notable; `--line` is ordinary.

⚠️ **Item 5 is the one where the change is a REDUCTION, and he was right about it.**
Every message the user had ever sent was a filled deep-green block, which made the
loudest thing on the conversation screen the half of it they wrote themselves. What
*arrives* is the new information; what you sent is a receipt. So the outgoing bubble
keeps the accent on its border and gives up the fill. Which side is which was never
carried by the colour: `align-self` does that, as in every messenger there has ever
been.

⭐⭐ **THE DEFECT UNDERNEATH ITEM 1.** The gate's two buttons were
`<div class="rows">` — the **conversation list's** class, borrowed for its vertical
stacking. `.rows button` (specificity 0,1,1) paints every button in it a quiet grey
outline and beats plain `button` (0,0,1), so the accent fill `#go-setup` was written
to have **never rendered, on the first screen of the product, for its entire life**.
Nothing in the source said so; both rules were correct on their own, and the file
that would have shown the collision is neither of them.

➡️ **A LAYOUT CLASS THAT ALSO PAINTS IS A TRAP THE SECOND CALLER FALLS INTO**, and
the only instrument that can see it is a browser resolving the cascade. The
verification for this round therefore reads `getComputedStyle` for every assertion
and never a class list — asserting `classList.contains("choice")` would have passed
just as well on the broken version. It runs at **both themes**, 34 assertions each.

### D-105. §9.1's honest-user cost was denominated in hashes, and a client pays in calls

**Feedback item 6, first panel:** `link 30329 ms, making it`, from Firefox 153, on a
machine whose Argon2id derivation in the same panel read a healthy 465 ms.

Thirty seconds for 2²⁰ hashes is ~30 µs each, which is not a rate any engine
computes SHA-256 at. **Measured in Chrome 148**, on the 40-byte shape:
`await crypto.subtle.digest` per attempt runs at 396,040 H/s; a plain synchronous
SHA-256 runs at **2,842,928 H/s**; batching 256 digests behind one `await` is
**worse** at 275,482 H/s. **About 86% of the old solver's cost was the CALL, not the
hash** — and the batching result is what proves it, because the cost is the crossing
rather than the waiting.

**Decided: the search runs on a private SHA-256 inside `pow.js`, and only the search.**
End to end, 250 solves each at 14 bits scaled to §9.1's 20: **before mean 3.52 s,
after mean 0.75 s**. Guard rails, all four deliberate:

1. It is **un-exported**, lives in `pow.js` rather than `crypto/hash.js`, and
   **cannot return a digest** — one 32-bit word, because ≤32 leading zeros is all
   §9.1 ever asks. Nothing can import it and nothing can derive a key with it.
2. It is **checked against WebCrypto before the search starts**. A wrong search hash
   is a *hang*, not a hazard — it would find no solution and the server verifies with
   its own SHA-256 regardless — and the check turns that hang into a named error.
3. The answer is **verified with WebCrypto** before `solve` will return it.
4. **Two sabotages, both caught**: one bit flipped in the last `K` constant, and the
   two-block padding length written into block 1. Each was refused in microseconds
   with `reason: "pow_hash_mismatch"`. ⚠️ Recorded because *a sabotage that changes
   nothing has not proved the line safe* — these changed something and were caught.

⚠️ **There is no Firefox in the container, so the 20× is EXPLAINED AND NOT MEASURED.**
What is measured is that the old shape's cost was overwhelmingly the term that varies
by engine, and the new one has almost none of it. §9.1a records both halves and says
which is which.

⭐ **The second half, and the more general one: the solver yielded every 16384
attempts.** That is a constant amount of *work* and therefore a variable amount of
*time* — the slow device that needed the yields got them least often, and a
background tab, where a timer is clamped to one second, could spend longer yielding
than searching. **A budget in attempts spends a different amount of time on every
device; if what you are protecting is a person's ability to interact, count time.**
Now 60 ms.

### D-106. A diagnostic with no time on it is read as the present tense

**Feedback item 6, second panel:** `problem  Error`, on a session where, in his
words, *"I just sent a message, and all was working… maybe that error was just
carried forward from something earlier"*. He was right, and having to reason his way
out of a line the product stated flatly is the defect. Three faults in one row:

1. **It never expired and never counted.** A failure recovered from twenty minutes
   ago read exactly like one happening now, and the only way to clear it was a
   reload. It now reads `name ×n, N min ago`.
2. **`Error` is not a name.** It is what `err.name` gives for every un-subclassed
   exception in JavaScript, so it identified nothing. The client's own failures now
   carry an explicit `reason`; anything that still does not is recorded as `unnamed`,
   which at least says which kind of gap it is.
3. ⭐⭐ **The thing it was reporting was not a fault at all.** Verification found it:
   pressing **Cancel** on a pairing threw `new Error("cancelled")` — because throwing
   is how you stop work that is already running — and *every* throw was being filed
   as a problem. **An exception used as control flow is not a fault, and recording it
   as one is how somebody who pressed a button they were offered ends up reading that
   their device has an error.** Deliberate cancellation is no longer recorded.

**And the `link` row is split.** `link 30329 ms, making it` covered a key generation,
a challenge fetch, §9.1's search and a `POST`, so it could not say which of five
things the thirty seconds was. There is now a `proof` row carrying the search alone,
with its difficulty. ➡️ **A total is a diagnosis only when it has one plausible
cause.** The joiner's `proof` row reads `—`, which is the correct answer rather than
a missing measurement: §9.1 charges the side that creates the pairing.

---

## 2026-08-13 — Session 18 (the fourth round: three copy items, and two questions that took two sections apart)

Five items. Three were copy and are built. Two were **questions** — *can the invite
link last until tomorrow?* and *where did we land on a code that can be read down a
telephone?* — and they are answered here, not built.

⭐⭐⭐ **THE SHAPE OF THIS ROUND: IT FOUND A REASON, NOT A DEFECT.** Every earlier
round found something the product did or said wrongly. This one found something the
product had *decided* wrongly — a "no" recorded in a code comment with a
justification that the specification refutes on a page nobody had reason to open.
Round 2 asked half of the link question and got that answer. Round 4 asked it again.
➡️ **A REASON RECORDED IN ONE FILE AND REFUTED IN ANOTHER IS NOT A CONTRADICTION
ANYBODY WILL FIND.** A wrong line of code fails a test; a wrong *reason* closes a
question and then sits there, and the only thing that reopens it is a person asking
the same thing twice. **When a decision is a "no", write it where the evidence for
it lives** — the "no" was in `ui/copy.js` and the measurement that contradicts it
was in `PROTOCOL.md` §3.4.1, forty lines from where the answer belonged.

⭐⭐ **And the second question priced the first.** A spoken code and a long-lived
link are each defensible alone and **jointly unsound**, because both are governed by
one term: `L`'s entropy against the time an attacker has to grind it. Neither
section could see that on its own — §2.2 discusses length, §3 discusses lifetime,
and the product of the two is in neither. **Two features that share a parameter are
one decision, and nothing in a document reminds you which parameters are shared.**

### D-100. Resumable pairing: possible, costed, not built — and the recorded reason for "no" was false

**Feedback 1a and 2b, which are one question.** *"Is it possible to have a longer
working link if the other party is not easily reachable? … so that if the tab is
closed in the meanwhile the pairing can be resumed"* and *"Do I need to hold the tab
open? … the 'to be paired' links would be on some waiting list for me when I open
the tab again and give the 8 word passphrase again."*

⚠️⚠️ **The recorded answer was "no" and its reason was false.** `ui/copy.js` carried
this since round 2: storing the pairing private key durably *"would put a live key
on disk in a product whose §7.6 mode exists precisely so that nothing is written."*
**§3.4.1 says the opposite, in as many words** — *"The cost, stated: `L` reaches
disk. `sessionStorage` is persisted (§7.6)"*. The difference between the two stores
is **lifetime, not disk**. The second reason given — §3.3 requires the key discarded
when pairing completes — is satisfied by a durable record deleted at that same
moment, so it never argued against anything either.

⭐ **What is actually true, and it is more interesting than the false reason: a
longer-lived link does not make pairing asynchronous.** §3.6.1's commitment forbids
I revealing `I_pub` before J has claimed, and that is the step that stops a relaying
attacker grinding the six digits. So I's device MUST be online *after* J claims,
whatever the link's lifetime. **What he asked for is resumption on both ends**; the
long link is only its precondition. A friend can *start* tomorrow, and it finishes
the next time both have opened the page — which is a good feature, and a different
one from the one the question describes.

**Decision: not now, and the reason is scope, not safety.** §3 is the one path in
this product where a mistake is a man-in-the-middle, the tester round is next, and
this is the largest change anybody has proposed to it. §3.4.1a records the full cost
so the next person does not start from zero: `L` at rest for the link's life instead
of ten minutes; §7.6 cannot have the feature at all; §3.4.1's abandonment `DELETE`
becomes load-bearing; and **§2.2's spoken code can no longer be twelve characters**
(D-101). ⭐ What it does *not* cost is any security property of §3 — not the
commitment, not the SAS, not the tripwire, not `R`.

**Same-browser resumption is the version to build.** It is what the question asks
for (*"when I open the tab again and give the 8 word passphrase again"*), it stores
under the identity key like everything else, and it never touches the server.
Cross-device resumption would put `L` in the roster blob — a server-held ciphertext
holding a live link secret for a day — and that is a materially larger claim for a
case §MVP already excludes.

### D-101. The voice-readable code: sixteen characters, and the lifetime is the same parameter as the length

**Feedback 5.** *"Where did we land regarding an invite link that can be transmitted
via telephone conversation … Random A-Z capitals and 0-9 digits, KD8D-UK4Y-4EHU-U3FG
— how long would that need to be and is that a possibility?"*

**Where we landed:** specified in §2.2 since 0.2, **deferred to Phase 3**, and it is
in `ROADMAP.md`'s out-of-scope list for MVP. It has been confused once with §3.6's
six-digit comparison — different mechanism, different job — and the roadmap now
distinguishes them by name. ⭐ **The format instinct is right**: four groups of four
is exactly the shape, and §2.2's alphabet drops `0/O/1/I/L` because those are what a
listener mishears down a telephone.

⚠️⚠️ **And the length question has an answer that connects it to D-100.** §2.2 says
60 bits is safe *"only because of the short lifetime and server rate limiting"*.
**Only the first of those does the work.** `pairing_id = HKDF(L, …)` travels in the
request path, so the server — or a TLS terminator — can grind `L` **offline**, where
there is no request for a limiter to count. At 60 bits, a thousand GPUs cover about
**1 in 1000 of the keyspace in ten minutes and about 1 in 8 over a day.**

So: **sixteen characters, 80 bits, four groups of four.** At that length the
lifetime stops being load-bearing and the code can coexist with D-100's resumption.
Twelve characters is defensible *only* while the ten-minute TTL stands, and the
product cannot then have both of the things this round asked for. §2.2a carries the
arithmetic; §0.3's row is corrected (a dishonest server can recover a 60-bit `L` and
relay, not merely decline to rate-limit); and §2.3's *"the server cannot invert
`pairing_id`"* is now marked as true of the 128-bit link only.

### D-102. One name for the one thing: "invite link"

**Feedback 3, built.** *"It would be more understandable if we would call the link
always: 'Invite-link' or 'Invite link'."* Thirty-two sentences mentioned a link and
the product called it *"a link"*, *"the link"*, *"your link"* and *"somebody's
link"* — every one of them correct English and none of them a name. A person who has
never seen the product cannot tell which of those is the noun.

**The rule, which is not "never write link":** every sentence that *introduces* it
says **invite link**; a second mention inside the same sentence may say "the link",
because English needs the pronoun. `test/copy.mjs` enforces exactly that — a string
mentioning a link with no "invite" anywhere in it is a first mention that got missed
— with one deliberate exception, checked by name: **"haamu is a link-paired
messenger"**, where the word is not a noun. Spelled as two words, sentence case in
prose, capitalised only where it starts a label.

### D-103. The first markup this product has ever had, and it is not `innerHTML`

**Feedback 4, built.** He asked for three fragments of the opening explanation in
bold. Every sentence this client shows goes through `textContent`, so there was no
way to emphasise part of one.

⚠️⚠️ **Written the obvious way it does not degrade — it takes the page down.**
Measured today, in Chrome, against the real headers: `el.innerHTML += "<strong>…"`
raises *"Failed to set the 'innerHTML' property on 'Element': This document requires
'TrustedHTML' assignment"*, the boot block that renders the gate dies with it, and
**the gate does not appear at all**. That is the same policy that broke the deployed
site on 2026-08-12, when I wrote to Hannu that the empty string was carved out of
the spec. It is not.

So: `**` in the copy, `src/ui/emphasis.js` to split it, and one real `<strong>`
element node per marked run. ⭐ **The marker is a display bug everywhere except one
array** — the same two characters in any other string reach a person as two
asterisks — so the test asserts that only `product.what` contains one, that every
marker is closed, and that the three bold runs are the three fragments he named,
**checked as emphasised runs rather than as substrings**, because a check for the
words would pass just as well with the markup deleted.

Also in item 4, and worth its own line: *"What the server does see"* → **"The server
can see"**; the mailbox is named as **a generated id number** in both sentences that
mention it, because "mailbox number" is a thing a person can imagine being derived
from something of theirs; deletion is described from **the receiver's** side, since
both ends read that sentence and only one of them is "the other person"; and
*"carries them **but** cannot read them"*, where "and" had made two clauses in
opposition read as a list.

⚠️ He also cut *"and it is not nothing"* from the metadata sentence. The clause was
doing real work — three reassuring sentences with nothing after them is the product
overclaiming by omission — and the double negative is why it read badly, so it is
kept in the positive: **"That is metadata. This design cannot hide it."** The test
that required those exact words now requires the *property* instead, because a check
written against one wording turns a copy improvement into a failing suite.

---

## 2026-08-16 — Session 20 (the tester round: five to fifteen people, and the register was wrong)

**The round the whole project has been waiting for.** Everything from D-016 onwards
has been one man's first use, five times over; this is the first evidence from people
who did not build it, do not know what it is for, and had no reason to be kind. Two
of the three things it found are about **how the product talks**, not about what it
does — and one of those is a defect in a sentence that every previous round approved.

⭐ **Read the shape of the round before its items.** Rounds 1–5 found, in order:
prose defects, fewer and deeper defects once the copy gate became a test, a defect
already fixed one section over, a wrong *reason* rather than a wrong thing, and
findings hiding in the item that carried no complaint. **Round 6 found a wrong
REGISTER** — sentences that are true, checked, and defended by their own comment,
which nonetheless do not sound like a person wrote them. Nothing in this build could
ever have found that, for the same reason D-107 gives: every gate here compares a
string to a constant or a pattern, and none of them can hear a voice.

### D-108. Firefox 153, measured — D-105's open item closes and the 20× is gone

**D-105 shipped with an admitted gap:** *"there is no Firefox in this container, so
the 20× is explained and not measured."* The explanation was that ~86% of the old
solver's cost was the `await subtle.digest` crossing — the one term a conformant
engine may price differently — and that removing it should collapse Firefox's
outlier into Chrome's ordinary range. **That was a prediction, and it is now tested.**

| Firefox 153, same machine | §9.1 at the production twenty bits |
|---|---|
| before the fix (round 5) | `link 30329 ms` |
| after the fix (this round) | `proof 1262 ms` |

For scale, the two Chrome samples on comparable hardware are 887 ms and 1996 ms, so
Firefox now lands *between* them. ⚠️ **Be honest about one draw:** both numbers are
single samples from an exponential, and under a null of no change at all, seeing
30329 followed by 1262 is about **1 in 700** at the mean most favourable to that
null. That is suggestive on its own and conclusive only in combination with the
direct measurement of both inner loops and the batching control, which is exactly
the status a confirmed prediction should have.

⭐ **And the premise was never a fact about Firefox.** Hannu, unprompted: *"to my
feel and touch it has worked as fast as Chrome if not faster."* He is right, and the
correct statement of D-105 is not *"Firefox is slow at this"* but ***"our loop
charged an engine-dependent cost twenty times per microsecond of real work, and
Firefox was the engine that billed us honestly for it."*** The other engine was
hiding our defect, not out-performing it.

⚠️ Still not measured: a low-end Android at twenty bits after the fix. `proof` is the
row to ask for.

### D-109. The product says **KEY**, in capitals — and this reverses D-098

**Tester finding, adopted.** *"Every occurrence of 'passphrase' should be replaced
with 'KEY' because people understand that better. Random user would understand
'password' better but it is not technically correct."*

D-098 chose "passphrase" three days ago, on Hannu's own research and with a test that
walks every string and fails on the bare word "phrase". **That decision was reasoned
from the dictionary and this one is reasoned from users**, and where those two
disagree about a word, the users are the evidence. The clinching detail is not the
preference but what sits under it:

> ⭐⭐ **None of the testers distinguished *password*, *passphrase* and *key* at all.**
> To a layperson they are one thing under three names.

That changes what the word has to do. It is not competing on accuracy against other
candidates a reader can weigh — **there is no accurate choice, because the category
does not exist for these people**. So the product stops trying to pick the correct
term and instead names the thing: `KEY` is *our word for it*, and the explanation
lives one tap away (D-110) for the reader who wants it. The popup must therefore
**not** explain the difference between password, passphrase and key — that is a
distinction its reader does not hold — it says what this one thing does.

⚠️⚠️ **THE NAME COLLIDES WITH ITSELF AND THE CAPITALS ARE WHAT RESOLVE IT.** This is
a cryptographic product; the word "key" already means something here, and
`server.cannotRead` currently says the server holds *"one public key"* while the new
copy would say *"Server never gets the key"*. Read together, those two invite a
person to conclude the server holds theirs. So the rule is:

- **`KEY` in capitals is the user's eight words, and nothing else, ever.**
- **The bare lowercase word is swept out of user-facing copy entirely** — not
  merely kept apart from it. *"Server never gets the key"* becomes ***"Nothing that
  could open them ever reaches the server."***
- `test/copy.mjs` inverts D-098's check rather than deleting it (D-107): it fails on
  "passphrase", on the bare word "phrase", **and** on a loose lowercase "key".

Code identifiers are untouched — `PHRASE_WORDS`, `protocol/passphrase.js`, the
`phrase` export. D-001's lesson runs the other way here: a name baked into the
construction is not the name on the screen, and it does not have to be.

### D-110. Half wanted less to read and exactly as many wanted the information — so the surface is short and the detail is one tap away

**The most quoted item of the round, and it arrived as a genuine tie.** *"Half of the
testers said it is too much to read for somebody who just needs the app but does not
understand the technicals. And exactly as many said they want to have the info."*

⭐ **A tie between "too long" and "keep it all" is not a compromise problem — it is
the wrong question.** Averaging them produces a page that is still too long for the
first group and now incomplete for the second. Both are satisfied exactly, and only,
by putting them on different layers. Hannu's own framing, adopted verbatim: *"we
write texts on first page more simple and understandable for random visitors, but we
put links for popup or tooltip on key words, and that popup then gives a more
technical answer so that we do not lose the valuable info."*

⚠️ **It cannot be a tooltip, and the reason is mechanical: a phone has no hover.**
This is a messenger; the majority device has no pointer, so a hover-revealed panel is
a panel half the users can never open. Marked terms are therefore **buttons**, and
what they open **expands underneath the paragraph** rather than floating over it — no
overlay, no positioning arithmetic, the same behaviour on both device classes, the
reader keeps their place, and a screen reader gets a disclosure it already
understands.

⚠️ **The renderer extends `ui/emphasis.js` and may not reach for `innerHTML`** (D-103,
and it is measured: under this site's Trusted Types the page does not degrade, it
does not render at all).

⭐ **What this layer is FOR, so it does not become a junk drawer.** The expander holds
the sentence that is *true and unreadable* — the precision the surface sentence
spends to stay short. It is where *"the KEY never leaves this device"* gets its
footnote that a number worked out from it does travel, and is what the server files
the list under. **If a fact belongs on the surface, putting it in an expander is
hiding it; if a fact needs three clauses, putting it on the surface is the defect
this decision exists to fix.**

### D-111. "link-paired messenger" is retired, and it takes D-102's one exception with it

*"My idea of using 'link-paired messenger' was invalidated, several testers did not
understand that."* It was the opening clause of the first paragraph a first-time
reader met, and it was Hannu's own coinage — proposed by him, adopted by me without
testing it on anybody, and read by nobody who did not already know what it meant.

⚠️ **D-102 registered it as the single checked exception to the invite-link rule** —
"where it is not a noun" — so the check that *permits* it must go when the string
does. Removing the string alone would leave a test asserting the presence of a
sentence that no longer exists; removing both **tightens** the rule to no exceptions,
which is the correct direction and is only visible if you look (D-107).

⭐ `lpm` is unaffected and this changes nothing about it. D-001 chose the protocol
token precisely so that naming would be off the critical path, and this is that
decision paying out: a phrase the users rejected can be deleted in an afternoon
because it was never load-bearing anywhere.

### D-112. ⭐⭐⭐ A caution written to prevent overclaiming can read as a confession — and then it does the opposite job

**The finding of the round, and it is against two sentences this log has already
defended in writing.**

> Hannu: *"'This design cannot hide it.' My friends asked whether an AI wrote that.
> A non-technical person would not express themselves like that, and they start to
> wonder what the design should be hiding."*

And separately, of `verification.unverifiedWhat`: *"Do not use this, confused
everyone."* Set them beside each other:

- *"That is metadata. **This design cannot hide it.**"*
- *"**Nothing says anything is wrong**, and it is encrypted either way."*

**Same construction twice: an abstract subject, asserting what something is not.**
Both were written to be exact about a limit. Both are exact. D-103 explicitly
defended the first one four days ago — *"three reassuring sentences with nothing
after them is the product overclaiming by omission"* — and that reasoning is still
correct. **The sentence discharged the duty and failed the reader**, which is a
possibility the reasoning never considered.

➡️➡️ **A LIMIT MUST BE EXPLAINED, NOT ANNOUNCED.** *"This design cannot hide it"*
tells a layperson that there is a design, that it has intentions, and that hiding is
among them — so the sentence written to prevent an overclaim manufactures a suspicion
that no honest reading of the product supports. The repair keeps every factual
obligation and changes the register from confession to explanation:

> The server can see that some mailbox — a generated id number — received an
> encrypted message of some size, at some time. No readable text, no name, no email
> address. **That much cannot be hidden: it is what any server has to know to
> deliver a message at all.**

⭐ **The finding is the construction, not the two instances.** Both flagged sentences
share a shape I reach for whenever I am being careful, and the sweep is for the
shape: `ghost.notErased`'s *"This is not erasure"*, §7.8's *"unreachable is not
erased"*, `unlock.why`'s *"it is the design rather than a slow moment"*. Each is true.
Each announces a negative with an abstraction as its subject. **Where a sentence
exists to stop us claiming too much, write what IS the case and why, and let the
limit follow from it.**

⚠️ **And note which gate could have caught this: none of them.** D-107 said nothing in
a build can notice that two strings say the same thing; this is the neighbouring
class — **nothing in a build can notice that a true sentence sounds like a machine.**
Both are judgements about a reader, and both are why the tester round existed.

### D-113. §2.2's alphabet was chosen for the eye, and the testers just said the channel is the ear

**The spoken code is promoted to the next feature built** — tester-ordered, ahead of
resumable pairing (D-100), which follows it. The deciding evidence is not a
preference but a population the product currently cannot serve at all:

> *"Sending an invite link can be difficult for some persons: they do not have
> WhatsApp, or have the wrong email on that device."*

⭐ **That reframes D-101 from a convenience to a delivery channel.** A URL can only be
tapped; a sixteen-character code can be dictated, texted, written on paper or left in
a voice message. It is the only form of the secret that is channel-independent, and
that — not brevity — is why it has to exist.

⚠️⚠️ **AND THE ALPHABET IS WRONG FOR THE JOB, BY THE SAME MISTAKE AS D-018.** §2.2 is
titled *"Voice-readable variant"* and excludes `0 O 1 I L`. **Those are what a person
MISREADS off a screen.** What a person **MISHEARS on a telephone** is
`B C D E G P T V Z 3` — the English E-set — and every one of them is in the alphabet.
D-101's own summary of the exclusion, *"which are what a listener mishears"*, is
simply false and went unchallenged for three days.

**This is D-018 exactly, one artefact along**: a list's selection criterion is a claim
about a feature you must actually ship. EFF short list #2 was optimised for
autocomplete we never built; §2.2's alphabet is optimised for a reader looking at a
screen, and the testers have just told us the primary reader is a listener holding a
telephone. ⚠️ Note the failure is **safe** — a misheard code finds no pairing and
nothing leaks — which is precisely why it survived review: it degrades usability
only, in the one feature whose entire purpose is the people for whom nothing else
works.

**Three fixes were costed and Hannu chose the first:**

| | change | cost |
|---|---|---|
| ✅ **chosen** | keep 16 chars, print the spelling beside the code | presentation only — no protocol, no entropy |
| costed | 18 chars on a 22-character ear-safe alphabet | §2.2 changes; +2 characters; needs no words in any language |
| costed | 8 short words (`tiny8`, 82.7 bits, measured at 90% / 24.4 s) | §2.2 changes; ⚠️ would look identical to the KEY |

⭐ **The chosen fix is right partly because it is cheap to be wrong about.** Hannu
flagged the real risk himself — *"we will see how it goes for non-English
natives"* — and NATO spelling is English words. Because the line is presentation and
touches neither the protocol nor the entropy, a tester round that stumbles on
*"yankee"* costs nothing to act on: the fallback is row two, which removes language
from the problem entirely rather than translating it. **Row two stays costed, not
discarded.**

### D-114. A QR code, after the spoken code — and it is honest about which problem it solves

Accepted, queued third. ⭐ **It is unusually cheap here because we only ever DRAW
one**: the receiver scans with their phone's own camera application, which opens the
URL, so haamu needs no camera code, asks for no permission, and
`Permissions-Policy: camera=()` stays exactly as it is.

⚠️ **It does not solve the problem the testers reported.** Theirs is remote — a person
on the telephone with no channel that carries a link — and only the spoken code
answers that. QR answers the two-people-in-one-room case, which is a real case and is
also the one where §3.6.2's six digits are easiest to compare properly. Recorded so
that nobody later reads the queue and concludes the tester finding was addressed
twice.

---

## 2026-08-16 — Session 21 (building D-113: the section had been read three times and implemented none)

The tester round closed with the spoken code queued first. This session started
building it, and got as far as the alphabet before the section stopped being
implementable. ⭐⭐ **Both findings below were produced by the same act — writing the
constant — hours after three careful readings had rewritten the same eight lines.**

### D-115. ⭐⭐ §2.2's alphabet was 31 characters while the parenthesis beside it said 32 — and 31 is not a power of two

`ABCDEFGHJKMNPQRSTUVWXYZ23456789`. Twenty-six letters and ten digits is 36; the
exclusion set `0 O 1 I L` is **five**; 36 − 5 = **31**. The line has read *"(32 chars;
0/O/1/I/L excluded)"* since 2026-08-05, through the 2026-08-07 and 2026-08-09 outside
triages and through 0.9.5's own rewrite of the block one day ago.

**Sixteen characters of a 31-character alphabet is 79.27 bits, not 80**, and §2.2a's
exhaustion row is 2⁸¹·³ rather than the 2⁸² printed there. ⚠️ **The 0.73 bits are not
the finding.** Nothing in this product's threat model notices three quarters of a bit.
The finding is that **31 is not a power of two**, so there is no clean mapping between
the code and any number of bytes, and every round figure the section is written in —
5 bits per character, 80 bits, 16 characters, 10 bytes — is unreachable from the
alphabet the section actually specifies.

**Resolution: return `O`.** `0` is already excluded, so a displayed `O` has nothing
left to be confused with; the exclusion set becomes the four characters `0 1 I L`; the
alphabet is `ABCDEFGHJKMNOPQRSTUVWXYZ23456789`, 32 characters, exactly 80 bits. The
one-way `0 → O` fold in §2.2c catches the person who hears *"oscar"* and reaches for
the digit.

➡️➡️ **THIS IS D-113'S SHAPE ONE TURN LATER, AND THE PAIR IS THE LESSON.** D-113 found
a list whose stated **criterion** was a claim nobody had shipped — *"the characters a
listener mishears"*, describing a reader looking at a screen. D-115 finds a list whose
stated **size** was a claim nobody had counted. Both live in a parenthesis, both in the
same eight lines, both passed three reviews, and both were found the moment somebody
tried to build from them rather than read them.

⭐ **A parenthesis that states a property of the thing beside it is an assertion, and
it is the kind nothing checks** — not a test, not a compiler, not a reviewer, because
it reads as a courtesy to the reader rather than as a claim. `test/unit.mjs` now counts
the alphabet, asserts it is a power of two, and asserts the excluded set is absent; the
count is in the label, per the round-6 habit.

### D-116. The sixteen characters ARE `L` — because the document never said, and the two readings differ forever

§2.2 ends at the alphabet and hands the reader to `pairing_id = HKDF(L, …)`. §2.1
defines `L` as **16 bytes** from `getRandomValues`. §2.2 produces **16 characters**.
The step between them appears nowhere in the document, and the two available readings
— the characters *are* the secret, or the characters *spell* a 10-byte number — derive
**different `pairing_id`s from the same spoken code**, permanently and silently.

Exactly §0's case, so it was asked rather than invented. **Chosen: `L = ASCII(normalise(s))`.**

| | the letters are `L` | pack to 10 bytes |
|---|---|---|
| entropy | 80 bits | 80 bits |
| grinding cost | identical | identical |
| length of `L` | **16 bytes, unchanged** | a second legal length |
| `expectLength(L, 16)` in §3 | untouched, 6 call sites | all must learn about it |
| new code in the security path | none | a base32 codec |

**It is not a security choice** — the two are the same secret under two spellings — so
it was decided on surface area, and one option has none. ⚠️ The cost it does carry is
that **normalisation becomes security-critical**: two clients that normalise differently
produce a `pairing_id` that is not found, on both screens, with nothing to say why. So
the three rules are normative in §2.2c and exhaustive, and they are tested against
vectors rather than described.

### D-117. The code lives *under* the link, not beside it and not in front of it

The reported problem arrives **mid-flow**: a person presses "start a conversation",
gets a link, and only then discovers their friend has no WhatsApp and the wrong e-mail
on that device. Three placements were costed and the tester round had already decided
the principle.

- **A choice before the link** — two buttons where there is one. Rejected: this round's
  loudest finding was that the front of this app asks too much of somebody who just
  wants to send a message (D-110), and this adds a decision to the path everybody takes
  to solve a problem a minority has.
- **Both on one screen, always** — no choice and no restart, and it is the simplest
  screen by a distance. ⚠️ Rejected on a real, permanent cost: one screen means one
  secret, so **every invite link in the product drops from 128 bits to 80**. §2.2a says
  80 is sound at this lifetime — but it also notes that 128 bits is what makes §3.6's
  relay unavailable to a hostile server *at all*, and spending that margin to save a
  minority a button is the wrong trade.
- **✅ A quiet control beneath the link** — *"My friend cannot open a link"*. The common
  path is untouched. Pressing it abandons the pairing (§3.4.1's `DELETE`) and starts a
  fresh one as a code, at the cost of one more proof-of-work — **1262 ms measured on the
  slowest engine we have** (D-108), which is affordable precisely because D-105 was
  fixed first.

⭐ **This is D-110's two layers applied to a flow rather than to prose.** The default
serves the majority and says nothing; the second layer is one tap away and serves the
people for whom the default does not work. The same shape, two artefacts apart, chosen
for the same reason.

### D-118. ⭐⭐⭐ A second way in makes every sentence that named the first one a claim — and one screen cannot be told which

Found **after the deploy**, on a screenshot of the live site, by driving two real
browsers all the way through: initiator to a code, joiner typing it in lower case
with spaces for dashes, both to §3.6.2's digits. The pair had used a code, and the
verification screen said *"Read these six digits to the person you sent the invite
link to."* Two more strings on the same screen said the same thing.

⚠️ **And it was wrong along an older axis than the code.** *"You sent"* is false for
**every joiner there has ever been** — they received it. That is feedback 16's defect
verbatim, a sentence written for one role and shown to both, still live on the one
screen in this product whose entire job is to make somebody stop and choose
deliberately. Nobody reported it in six rounds, because each sentence reads correctly
on its own; **what makes it wrong is who is looking at it.**

⚠️⚠️ **IT CANNOT BE FIXED BY BRANCHING, AND THAT IS THE STRUCTURAL PART.** §3.6.2's
screen is reached twice — straight after pairing, where the kind is known, and again
from inside a conversation whenever the person is finally able to ask, which is
D-081's whole point. On the second route **nothing on the device records which of §2's
two secrets built the channel.** Storing it would be a schema change made to settle a
question about wording. ➡️ So every sentence on that screen must be true of both roles
and both kinds, and the fix is to name the other person by the product's own word for
them — *your friend* — which is true of both roles simultaneously.

**"the invitation" is the one new word, and it is a SUPERORDINATE.** With two ways in,
a category term stops being a convenience and becomes a requirement. It is not a
second name for the invite link any more than "conversation" is a second name for
Ghost mode, and it is admissible **only where the kind is genuinely unknown** —
everywhere the kind is known, the thing keeps its own name. `test/copy.mjs` now
enforces the rule directly: no string on §3.6.2's screen may say "invite link",
"code", "you sent" or "I sent".

⭐⭐ **Two D-081 checks failed on the fix, and both were right to exist and wrong in
how they were written.** They were pinned to the noun phrase — `/person you sent the
.*link to/` — rather than to the property, so a strictly better sentence broke them.
The property is *"a person is named, not a pair of screens"*, and that is what they
assert now. **A check written around the words fails on the fix; a check written
around the property survives it.** ⚠️ Note the direction of the danger: this pair
failed loudly, but a check pinned to words that a rewrite happens to preserve keeps
passing while guarding nothing.

➡️➡️ **The general rule this leaves: adding a second member to a category silently
converts every sentence naming the first member into a claim that may now be false.**
It is the sibling of `feedback_legal_text_drift` — that is prose going stale because a
CONSTANT moved; this is prose going stale because the WORLD gained an alternative, and
nothing in a build can enumerate the sentences that quietly assumed there was only
one.

---

## 2026-08-17 — Session 22 (feedback round 7: six items, and one of them was a question)

Hannu came back to the deployed spoken code and sent six items. Five are copy; one is a
question — *"how long is that metadata kept on the server and when deleted?"* ⭐⭐ **The
question was the most expensive item in the round.** Answering it needed no code at all,
and looking the answer up found a log on the box holding the two values this product
exists to keep apart. **Round 7's shape: the item that was not a complaint.**

⭐ Two things left open after round 6 were settled, and both cost nothing: **§2.2b's
English spelling words stay** (item 5), and the ⭐⭐ superordinate *"the invitation"* drew
no objection. **Item 5 closes §2.2b's costed remedy** — the ear-safe 22-character
alphabet at 18 characters for the same 80 bits is **declined, for a reason no amount of
analysis here would have produced**: *"two finnish speakers will use the Finnish
equivalents and all Finns know them. In that case those written on the page do not
disturb anybody."* ➡️ **The words are a prompt, not a script.** §2.2b was costed as
though the printed table had to be the thing said aloud; its real job is to remind two
people that a spelling alphabet exists, and each pair then uses whichever one they
share. **The remedy was priced against the wrong requirement.**

### D-119. ⭐⭐⭐ The D-112 repair worked, and moved the abstraction from the STANCE into the SYNTAX

Item 1, and it is about a sentence written **three days earlier to fix D-112**:

> *What a browser writes while a tab is open reaches your disk like anything else, and
> nothing a web page can do reaches back for it. So the conversation becomes impossible
> to open, rather than scrubbed off the disk.*

Hannu: *"I do not know if I understand this myself."* He then rewrote it in two short
sentences and got both facts across.

**D-112 was real and its fix was right.** The old opening — *"This is not erasure"* — is
an abstract subject announcing a negative, met before the reader has been told what the
thing IS, and reversing it made the limit fall out of an explanation instead of being
declared. ⚠️ **What the reversal cost is invisible in the register.** The subject of the
repaired sentence is a nine-word headless relative clause, and a reader has to hold all
nine before the verb arrives to learn what is being claimed. Every copy rule this
project enforces was satisfied: no jargon, no negative opening, no claim beyond §7.7,
one idea per sentence.

➡️➡️ **A defect in STANCE can be repaired into a defect in COMPREHENSION, and the two
are found by different instruments — the second one is a person saying "I do not
understand this".** No gate in this repository can weigh a subject clause. What made it
findable is that the author of the round is not the author of the copy.

⭐ **The fix keeps his register and restores one fact he dropped.** His middle sentence
was *"The webpage cannot prevent that"* — true, and a **different claim** from the one
this paragraph rests on. Not being able to *stop* the write is why bytes exist; not being
able to *reach back for* them is why "impossible to open" is the only guarantee left.
Both are said now, in his order and mostly his words: *"When this tab is open, the
browser writes on your device. A web page cannot stop that, and cannot reach back
afterwards to remove it. So the conversation is not scrubbed off your device, but it is
impossible to open."*

⚠️⚠️ **The check on that string then failed on the fix — under a comment claiming it
followed the property and not the words.** Three of its four clauses did. The fourth was
`/disk/`, and his rewrite says *"your device"*: the same residual, in the noun a phone
user actually thinks in. ➡️ **A note asserting that a check is property-shaped is not a
check that it is**, and three-quarters true is the hardest kind to catch, because the
comment persuades the reader not to read the predicate. Re-pointed and made *stricter* —
it now requires both halves of §7.6's honest pair where it used to accept either alone.

### D-120. ⭐⭐ The panel that raises the worry did not answer the question it raises

Item 2. Every number was already written down — §5.1.1's `created_at + 2 × EPOCH`, §5.4's
delete-on-collection — and `terms.server` states them **for messages**. The panel a
worried reader actually opens, `terms.metadata`, explained what metadata *means*, why a
server needs it and what is *not* in it, and never said how long any of it lasts.

➡️ **A reader does not go looking two panels over for the answer to the question the
panel in front of them just raised.** This is D-083's shape — the next question answered
somewhere other than where it was provoked — and it survived four rounds of review of
this exact surface because **the missing sentence had no wrong version to notice.**
`test/copy.mjs` now requires the metadata panel to name both the deletion trigger and
the floor, checked against the constant rather than against a transcribed number.

⚠️ **The new paragraph is deliberately a claim about the DATABASE and not about the
machine**, and a second check forbids widening it, because on the day it was written the
wider sentence would have been false — see D-121.

### D-121. ⭐⭐⭐ §3.2's logging commitment was true of the application and false of the box

Answering item 2 meant checking what is actually retained, which meant reading the
journal. `ARCHITECTURE.md` §3.2 is written as an operational commitment:

> Not logged: IP addresses beyond the rate-limiter's in-memory window (max 1 hour),
> `mailbox_id`, `roster_id`, `pairing_id`, or any request body.

**The application keeps that promise exactly.** Its own lines are aggregated per-route
counters — `msg=requests route="GET /api/mailbox/{id}/stream" status=200 n=2` — with the
identifier already reduced to `{id}` by the router pattern. The promise is broken one
layer up, by the reverse proxy in front of it: **215 lines in seven days**, at ERROR
level, each carrying `remote_ip` **and** a `uri` holding the real `mailbox_id` **and** the
stream token, kept in journald for weeks.

The mechanism is ordinary and permanent: §5.3's stream is Server-Sent Events, so every
one of them ends with the client going away mid-response, and the proxy logs *"aborting
with incomplete response"* each time. **Normal operation writes the record.**

⚠️ **Severity, honestly.** The stream token is spent — §5.3 gives it 30 seconds and one
use — so what sits in the log is a dead credential, and `roster_id` never appears. What
the log does hold is the one linkage this design exists to prevent: **a network identity
beside a mailbox identity, with a timestamp.** Two such lines say that one IP address was
reading one mailbox at two different times. §4.3's unlinkability is between epochs; it
does nothing against a log that names the IP.

➡️➡️ **The general finding: an operational commitment phrased about "the server" is a
claim about every process on the box, and the process that writes the logs is usually not
the one you wrote.** The application was audited four times. The proxy was configured for
TLS and routing and never read as a retention surface — its Caddyfile even carries an
approving note that there is *"no custom access-log file … operational logs minimal and
short-retention"*, which is true, and which is about the **access** log, while the leak
is in the **error** log nobody chose to enable.

⚠️ **§3.2 is corrected in place now, before any fix ships**, because a commitment that is
false on the box is worse than one that is narrow — it is the sentence that would be
quoted in answer to an official request. The fix is proposed and **not applied**: it
changes Caddy configuration shared with a live privsend, so it waits for its own
authorization.

### D-122. ⭐⭐ D-081 a third time, arriving as praise instead of as instruction

Item 6. The sentence removed:

> *The digits are the check that cannot be talked around.*

Hannu: *"That makes the user feel that they should check the digits specifically, when
they actually should check the person who has the digits."*

**True about the cryptography, wrong about the human, and the third rewrite of this
surface for the same reason.** D-081 removed *"they must match"*; D-118 removed *"the
person you sent the invite link to"*; this removes a sentence that **was not an
instruction at all.** It praised the mechanism, which is exactly how it survived two
passes aimed at this defect: nothing on the surface told the reader to trust the digits,
one sentence merely admired them — **and admiration is guidance.**

⭐⭐ **The property is a test now, stated so the sentence cannot return in other words:**
on the verification surface, every sentence that calls something a *check* must name the
person it is about. The paragraph keeps its ending on the weakness of the alternative and
stops, because the instruction was already given twice above it — Hannu's own reason for
cutting rather than replacing. ⚠️ The check carries a non-vacuity clause: if the one
sentence that *does* state the test ever disappeared, `every` over an empty list would
pass in silence.

### Also adopted from round 7

- **Item 3** — *"choose the one you can copy out most accurately"* → his *"choose the one
  easiest for you"*, with three words put back: **"…that is easiest for you to write
  down"**. ⚠️ "Easiest for you" leaves the criterion open, and the criterion a person
  reaches for unprompted is *easiest to remember* — D-020's measured failure, 42% recall
  against 88%. Naming the act the next screen tests keeps his register and closes that
  reading. **Flagged for him**: the bare form is one word away if he prefers it.
- **Item 4** — `terms.retype` replaced with his text: three paragraphs of mechanism for
  two of plain reason. ⭐ **What his version does that mine did not — it says what is at
  STAKE ("we cannot help you if you lose it") where mine said what the step is EVIDENCE
  OF, and it tells the reader where to put the KEY.** Mine explained the design to
  somebody who only wanted to know why they were being asked. ⚠️ One sentence of mine is
  gone and is **flagged for him**: *"The field clears when you do"* — nothing else says
  so, so an emptied field is now a small surprise.

---

## 2026-08-17 — Session 23 (building §2.1.2's QR symbol: three defects, and the decoder passed the worst one)

The second of the three things the testers ordered. §2.1.2 was written first, because
nothing in the document specified a QR route and §0 forbids inventing one in code; then
the encoder, ISO/IEC 18004 from scratch, because this client has no dependencies.

⭐⭐ **THE SHAPE OF THIS SESSION IS THAT EVERY WRONG THING WAS FOUND BY AN INSTRUMENT
THAT DID NOT SHARE THE MISTAKE, AND NOTHING ELSE WOULD HAVE FOUND ANY OF THEM.** A QR
symbol is the first artefact in this product whose failure is invisible: a wrong screen
is blank, a wrong request 401s, a wrong message does not arrive — a wrong symbol is a
square of black and white squares that no person can fault and no camera can read, and
the conclusion a user reaches is that their friend's phone is broken. So two independent
oracles were installed in the scratchpad before the first check was written: an
independent **encoder** (node-qrcode) for module-for-module comparison with the mask
forced on both sides, and an independent **decoder** (jsQR) reading rendered pixels.

### D-123. ⚠️⚠️ The format-information area was reserved one module too wide, and the DECODER PASSED IT

`drawFunctionPatterns` reserved the format field with two loops over `0..8`. The field
steps **around** the timing patterns — it occupies (8,0…5), (8,7), (8,8), (7,8), (5…0,8)
— so the loops cleared the two timing modules at **(8,6) and (6,8)** and nothing wrote
them back. Every symbol this file produced was non-conformant.

➡️➡️ **AND jsQR RETURNED THE EXACT PAYLOAD ANYWAY, ON EVERY CASE, INCLUDING VERSION 10.**
Format information carries its own BCH(15,5) code, so a decoder repairs that area and
reads on. **The defect was invisible to the strongest test that asks the question a user
asks.** It took the module-for-module comparison against the independent *encoder*, which
reported exactly two differing modules out of 841 — and two is the signature of one wrong
format bit, because the field is written twice, which is what sent me to look at the
right place immediately.

⭐ **A property that a robust reader repairs cannot be tested through that reader.** The
fix removes the reservation entirely: `drawFormatBits` writes the field and marks its own
modules, so it is the only thing that may touch them, and it now runs before the
codewords rather than after the mask. `test/qr.mjs` asserts (8,6) and (6,8) are dark for
every version and every mask, and reintroducing the two cleared modules fails 35 checks.

⚠️ **Two harness faults stood between the defect and the diagnosis, and both looked like
the encoder being wrong.** node-qrcode's `modules.get(row, col)` takes the row first, so
reading it as `(x, y)` transposes the matrix — 298 differences. And node-qrcode
**optimises segment modes**, mixing byte and alphanumeric runs, where §2.1.2 fixes byte
mode — 206 differences on a symbol that was valid. Only after forcing `mode: "byte"` on
the oracle did the count fall to two. ➡️ **Suspect the harness first: 160 failing checks
alongside six passing independent decodes is a statement about the checker.**

### D-124. A rule written as "the same rule as X" is worth exactly what X is worth

§2.1.2 rule 4 says the symbol must be cleared "at the same moment, and by the same rule
as the link's own text". Implementing that meant finding the rule — and there wasn't one.
`text("link", "")` was called in exactly **one** place, at the top of the *next* pairing.
A pairing that **succeeded**, was **cancelled**, or **failed** left the spent link sitting
in the DOM under the screen that replaced it, for the life of the document.

The secret is dead in all three paths (§3.4.1's DELETE has gone out, or the handshake
completed and `L` derives nothing further), so this is hygiene rather than a leak — ⭐
**which is exactly why it survived: nothing observable was ever wrong.** The existing
comment beside that one call even reasons correctly about why a finished secret should not
be left lying in the document; it was written for the switch-to-a-code path and never
generalised. Now `clearPairingSurface()` clears the link, the code, the spelling and the
symbol, from four exits.

➡️ **This is the second time in this product that writing a specification sentence about
an existing rule discovered the rule was narrower than the sentence** (D-121 was the
first, and larger: §3.2's logging commitment was true of `lpmd` and false of the box).
**A cross-reference is a claim about the thing referenced.**

### D-125. ⚠️⚠️ New copy reproduced, in one sentence, an ambiguity deleted three days earlier

The QR panel's caveat first ended *"If somebody else opens it instead of your friend, the
six digits on the next screen will not match."* **That is false in the dangerous
direction.** Somebody who photographs this screen and opens the link pairs with **this
device**, so their digits match ours perfectly; the person left holding nothing is the
friend. The sentence teaches a reader to trust matching digits, which is the one thing
§3.6.2 exists to prevent.

⭐⭐ **It is the twin of a sentence round 7 deleted** — *"that person has no digits at
all"* — for the same ambiguity, and `test/copy.mjs` carries the reasoning in a comment.
**I wrote the new one a few hundred lines below that comment, on the same afternoon I had
read it.** It was caught not by a test but by going to extend the D-081 guard and reading
what the guard was for.

➡️ **The copy gate's comments are this product's memory of sentences it has already
removed, and new prose on the same subject has to be written against that memory rather
than against the specification.** The specification says nothing false here; §3.6.2 is
correct and the panel still contradicted it. The replacement names no digits at all: the
invite link works once, so a stranger opening it first **locks the friend out**, and the
friend saying so is the signal. The gate now forbids the word "digits" anywhere on this
panel — a prohibition rather than a required phrase, because every wording that promises
a mismatch is wrong and there is no one right wording to demand.

### Also from this session, and each was a premise nobody had checked

- ⚠️ **Version 3 at level M holds 42 bytes, and the production payload is 42.** My own
  comment in `qr.js` said 53, which is level **L** — the wrong error correction level.
  Harmless (the version is computed, never assumed) and D-115's shape exactly: a stated
  capacity nobody had counted. **The symbol has zero margin**, so its size is a property
  of the host name's length; `haamu.app` happens to be short enough. One more character
  and it is a version 4.
- ⚠️⚠️ **"A dark palette is the next queued item" was wrong, and it understated the
  risk.** `app.css` has answered `prefers-color-scheme: dark` since long before this
  feature — the queued item is a *design pass* over a theme that already exists. So a
  symbol drawn in theme tokens would have shipped **inverted on day one** to every reader
  whose system asks for dark, not "later". The browser check runs with the dark preference
  emulated and asserts the pixels are still black on white; the screenshot is a dark page
  with a white symbol on it.
- ⭐ **A text-scan guard that forbids a word makes that word unsayable in the file it
  guards.** Rule 5's check scanned `qr.js` for `prefers-color-scheme` — and then failed on
  the comment explaining why the symbol must not follow it. The guard is about **code**,
  which is what it always meant, so it now strips comments first, with a non-vacuity
  clause asserting the stripped text still contains the drawing.
- **The localhost harness does not exercise production's symbol.**
  `http://127.0.0.1:8099/c#…` is 45 bytes and draws a version 4; production's 42 draws a
  version 3. Two of the browser checks failed on a correctly drawn symbol because they
  had 37 modules hardcoded. The module count is now asked for rather than assumed.

---

## 2026-08-17 — Session 24 (the QR code worked, and the tabs it left behind found a delivery stall)

Hannu tested §2.1.2 on Android. **The symbol scanned.** What he reported instead was the
shape of the thing around it: the camera application opened each scan in a **new tab**, each
tab asked for the KEY again, and messages from desktop → phone *"did not come or came with
delay"*. He was **certain messages had been lost**, then found later — after putting the KEY
into all three tabs — that *"probably all messages had arrived."*

⭐⭐⭐ **HE ASKED THE SMALLEST VERSION OF THE QUESTION — "I wonder if there is anything that
can be done about that, probably not?" — AND THE ANSWER WAS A DELIVERY BUG THAT HAS NOTHING
TO DO WITH QR CODES.** The tabs were the occasion, not the cause. This is
[[project_haamu_first_feedback]]'s pattern again and stronger: **the report that opens with
an apology for its own triviality has been the expensive one twice now.**

### D-126. ⚠️⚠️ A frozen leader keeps its Web Lock, so the tab in front delivers nothing

`flow/tabs.js` elects one tab with an **exclusive** Web Lock and releases it only when that
document **dies**. There was no `visibilitychange`, no `freeze`, no `pagehide` in the file.
`app.js:syncStreams` then says, correctly for a desktop: *"A follower wants nothing: the
leader is filling the same store on its behalf."*

**A phone freezes every tab that is not in front.** A frozen document keeps its lock — the
lock tracks a document's *existence*, not its *execution* — so the election's outcome
survives while its purpose does not. The tab the person is looking at, unlocked and with the
conversation open, opens nothing on behalf of a tab that fills nothing.

**Measured** (`scratchpad/browser-frozen-leader.mjs`, Chrome's own
`Page.setWebLifecycleState`, control leg first):

| | before | after |
|---|---|---|
| both tabs running | arrives | arrives |
| both awake, leadership handed over twice | — | arrives |
| **leader frozen** | **no arrival in 60 s**; the front tab never asked | **still no arrival in 60 s** — but it now leads, streams and **fetches** it |
| status line on the stalled tab | `another tab` | `live` |
| after thaw | arrives in both; counts equal | arrives in both; counts equal |

⛔⛔ **THE FIX IS NECESSARY AND NOT SUFFICIENT, AND THIS ENTRY MUST NOT BE READ AS CLOSING
HANNU'S REPORT.** After the change the front tab does everything the rule asks — takes the
lock, registers, streams, and its drains return `0, 0, 0, 0, 1, 0`, so **the message is
fetched** — and the screen still shows nothing for sixty seconds. ⭐ The freeze is necessary
to the residual failure and the handover is not: both tabs awake with leadership bounced
twice delivers normally. **A second defect lives behind this one and is not yet diagnosed**
(candidates: the frozen tab's still-open SSE connection on the same mailbox, and a
redelivery discarded as already-known — `storeIncoming` skips a seen `msgId` and returns 0,
which renders nothing and says nothing). ⚠️ I wrote the confident version of this table
before running the leg that disproved it; the correction is here rather than in a later
session because **a decision record that overstates a fix is worse than none.**

⭐ **Nothing was ever lost, exactly as §5.3.3 promises** — *"every failure on this path costs
live delivery and never a message"* — and message counts came out equal on all three
documents. ➡️ **But what a messenger loses when live delivery fails is the user's belief that
it works**, and no amount of eventual correctness buys that back. Hannu was right about what
he saw and wrong about what had happened, and the only way he could find out was to unlock
every tab he had.

⚠️⚠️ **THE SENTENCE THAT MADE IT INVISIBLE WAS IN ARCHITECTURE §4.2 AND IN A CODE COMMENT,
AND BOTH WERE TRUE.** §4.2: *"A follower is not a degraded client, and the interface must not
present it as one… a follower's messages arrive on disk whether or not anything tells it."*
`ui/copy.js`: *"A tab without it is NOT waiting and NOT degraded."* ➡️ **This is D-121's shape
a third time — a commitment that holds for one process state and not another** — and the
first where the difference is not a *mode* (§4.1's Messages row, §7.6's Ghost store) but
whether the other document is **still executing**. **A claim about what another process is
doing for you is a claim that it is still running.**

**The fix, on Hannu's ruling: leadership follows the visible tab.** A tab that becomes
visible **steals** the lock (`{ steal: true }`) rather than queueing — a queue cannot help
when the holder it waits for is frozen. A hidden tab does **not** stand down, because one
backgrounded desktop tab running alone is the only thing delivering and that case was always
right. The displaced tab is told by its request **rejecting**, which is the only notification
it gets. ARCHITECTURE §4.2.1 has the rule, the measurement and why the simpler "every visible
tab delivers its own conversation" was declined: it would make §5.4.3a's conditional-write
conflict routine instead of rare, to buy nothing on a phone where one tab is visible anyway.

### Two things the tests found in the fix, and one the fix found in the old code

- ⚠️⚠️ **My first implementation stole leadership unconditionally at construction, and
  `test/tabs.mjs` caught it**: opening five tabs handed leadership to all five in turn.
  Worse than untidy — **a tab opened in the BACKGROUND** (middle-click, session restore, a
  link opened behind the page) **would take delivery from the visible tab and then be frozen
  by the phone. That is D-126 with the tabs reversed**, and the same silent stall. A hidden
  tab now queues, exactly as every tab did before.
- ⚠️⚠️ **The suite's Web Locks model ignored `steal`, which would have made every new test
  meaningless.** An unknown option fell through to a plain request, and a plain request
  *queues* — the precise behaviour the fix replaces. The model implements it now in the
  spec's order: holders released and their promises **rejected** first, then the stealer
  granted ahead of the queue. ➡️ **A model that silently ignores an option it does not know
  is worse than one that rejects it.**
- ⚠️⚠️ **And the browser harness went vacuous the moment the fix worked.** Since a newly
  unlocked tab now takes leadership, freezing the *other* tab froze a follower — so the leg
  passed for a reason unrelated to the test. It now brings tab 1 to the front (taking
  leadership back), **asserts from the rendered status line that tab 1 really holds it**,
  freezes it, and only then switches to tab 2. ⭐ **A test that starts passing after a fix
  has to be re-read to check it still tests the same thing** — the fix can remove the
  precondition as easily as the defect.
- ⭐ **A latent hole one step further out, found by the same reading:** `capabilities.locks`
  was never consulted for delivery, so on a browser with **no** Web Locks `leader` could
  never become true and **no tab delivered anything at all** — while §4.2 has always said
  *"if neither exists, allow a second connection and accept the duplication."* Latent, not
  live (Web Locks is in every current browser and needs a secure context, which this product
  has; iOS Safari before 15.4 is the realistic case). Fixed by making the code do what the
  document already said.

### What could NOT be done, and it is worth writing down

Hannu's actual question was about the new tab. **It cannot be prevented from this side** —
the camera application hands the URL to the browser and the browser decides. A PWA install
would route scanned links into the app instead of a tab; that is Phase 2. So the answer
given was to remove the *consequence* rather than the tab: with leadership following the
front tab, how many tabs a scan leaves behind stops mattering.

⛔⛔ **THIS PARAGRAPH ALSO SAID THE HANDOVER "CANNOT WORK", AND THAT WAS WRONG — SEE
SESSION 25.** The claim was: *"handing the link over `BroadcastChannel` to the tab that is
already unlocked cannot work, because that tab is frozen and cannot answer."* It is built on
a true premise and does not follow from it. The tab that must answer is the one the person
is **not** looking at only in the case where the person has switched away from it; in the
case that produced the report — a scan opening a new tab *in front of* a tab that is still
running — the receiver is awake, and the handover is delivered and acted on. Measured
working the next day. ➡️ **A limitation that holds in one arrangement was written down as a
property of the mechanism**, which is the same shape as D-121 and, once again, closed a
question so that nothing looked at it for a day.

⚠️ **Still open, and smaller:** a second tab of an existing identity lands on the **whole
front gate** — including *"Set up a new KEY"* and *"I need to delete every conversation"* —
rather than on the KEY prompt. Measured while building the harness, not reported by him.

---

## 2026-08-17 — Session 25 (the stall was not in this client at all, and the answer was to stop making second clients)

### D-127. ⚠️⚠️⚠️ A frozen tab holds an IndexedDB transaction open, and every other tab waits sixty seconds

**The second defect §4.2.1 left open, and the one that produced Hannu's symptom.** Full
account and the decided rule: `ARCHITECTURE.md` §4.2.2.

⛔ **BOTH CANDIDATES NAMED IN §4.2.1 WERE WRONG, AND THEY WERE WRONG THE SAME WAY.** The
frozen tab's still-open SSE connection and `storeIncoming`'s already-known dedupe were each
arrived at by reading this client's source, and each was refuted by one measurement. What
was actually happening: the front tab fetched the message in **100 ms** and then could not
**write** it, because a `readonly` transaction on `conversation` held by the frozen tab
blocks every readwrite on that store, and a frozen document cannot run the callback that
would let its transaction finish. Chrome force-aborts it after about a minute — which is
where the sixty seconds comes from. ➡️ **When a stall survives every explanation the code
can offer, the next place to look is outside the code.**

**How it was pinned down, in the order that mattered:**

- ⭐ **Sampling the window instead of waiting it out.** The previous session measured the
  state *after* sixty seconds and therefore measured the moment the stall ENDED — the store
  read as responsive because by then it was. Sampling every five seconds showed it blocked
  from 4 s to 54 s and free at 59 s. **The same instrument, moved earlier, gave the opposite
  answer.**
- ⭐ **The lock timings named the shape before the cause**: the channel critical section was
  granted at 0.0 s and released at 60.0 s, with **no network request in flight** for any of
  it. That rules out everything transport-shaped in one line.
- ⭐⭐ **Causation, not correlation.** Freeze again, confirm blocked at 10 s, thaw — the
  store frees and the message appears **0.0 s later**.
- ⭐⭐ **Reproduced with no part of this client present** — two blank pages and one object
  store. It is Chrome, and saying so is what stopped the search for a bug in `flow/`.

⚠️⚠️ **THE OBVIOUS REPAIR IS REFUTED, WITH THE PRECONDITION ASSERTED.** `db.close()` when
the tab goes hidden leaves the other tab blocked for the full budget: `close()` aborts
nothing, it closes the connection *once every transaction has finished*, and the stuck one
never does. The handler ran and the call was made, so this is a refutation and not a harness
fault. ⚠️ Releasing it in the **`freeze` event** is **untested, not refuted** — that event
never fired under the instrument used, and nothing may be claimed about it in either
direction.

### The rule, and it is Hannu's

Asked to choose, he went after the new tab itself, and asked a question that changed the
shape of the answer: *"Would that mean that if a person has two tabs open... the page says
to the person that the tabs should unite? And then the person has after that only one tab
open and all conversation with that KEY there?"* — mostly yes, with one limit stated before
he chose: **a page cannot close another tab or bring one forward.** So a second tab becomes
a dead end that says where everything is, and offers to move it here. `ARCHITECTURE.md`
§4.2.2 carries the six rules.

⭐ **The button is the whole difference between a rule and a trap.** "It is open in another
tab" is a true sentence that leaves a person hunting through ten tabs on a phone.

**Measured end to end** (`scratchpad/browser-one-client.mjs`, all green): a second tab
declines to be a client; the live tab keeps delivering; a tab a QR scan opened hands its
invitation over and **does not consume it** (§2.1's link is single-use, so a rival attempt
would break the pairing that is running); the takeover works with the other tab frozen; and
a message after the takeover arrived in **0.3 s**, with the store measured unblocked at
that instant — against D-127's flat sixty.

### Three faults in my own harnesses, and each one nearly became a finding

- ⛔ **The first "0.3 s" proved nothing.** The leg froze the other tab 180 ms after a send,
  which on localhost was long enough for the whole delivery to finish — so it froze an
  **idle** tab, which cannot hold a transaction. The precondition caught it. **Aiming the
  freeze at a guessed delay is not the same as landing in the window**, and the fix was to
  trigger the freeze from the tab's own drain response and then, because aiming is still
  not hitting, **ask the store directly** rather than infer.
- ⛔ **"Does the frozen tab still answer" measures the debugger, not the page.** CDP will
  evaluate happily inside a frozen document.
- ⛔ **Two legs failed on two conversations.** The harness opened the second tab on a fresh
  invite, which paired a *second* conversation, and then measured delivery without saying
  which one it meant. Neither failure was about the product.

⚠️ **And one case is still unmeasured, named here rather than left implicit:** a live tab
**frozen but not yet discarded** while a new tab hands it an invitation. The attempt to
build it found only one `clients` lock held and no `leader` lock at all — Chrome had gone
past freezing and **discarded** those documents, which releases every lock, so the leg met a
different situation than the one it was for. `app.js` therefore **keeps** the link as well
as announcing it: if the notice was never heard, "Move it to this tab" follows the
invitation here. ➡️ **A notice is a hope; a notice plus a stash is a delivery.**

> ⛔⛔ **THE SENTENCE ABOVE IS WRONG AND IT SHIPPED — see D-128, one day later.** "A notice
> plus a stash is a delivery" is true of a notice. It is **false of a one-shot secret**,
> because the stash is a *second copy* of something that may be used once, and the case it
> was written for — the other tab never hears — is exactly the case that cannot be
> distinguished from the other tab hearing and consuming it. Hannu found it on the first
> attempt. ➡️ **A REDUNDANT COPY IS A REPAIR FOR A LOST MESSAGE AND A DEFECT FOR A SPENT
> ONE**, and the reasoning that produced it never asked which kind it was holding.

⚠️⚠️ **§4.2.2 DOES NOT CLOSE THE HAZARD, ONLY THE CASE HE MET.** One live client removes the
second tab and with it the commonest way a frozen document ends up holding the store. It
does nothing for a *single* live tab that is itself frozen — the person switches to another
app and comes back — and there the sixty seconds returns, still silent. That is the "let go,
and say so" work, and it is Hannu's chosen step 2.

---

## 2026-08-17 — Session 26 (his test of §4.2.2: four items, and the one I shipped yesterday was wrong)

Hannu tested the deployed build on his Android phone. **The delivery stall is gone** — *"Messages
came in fast and I had not problem with anything stalling"* — which is D-127 and §4.2.2 confirmed
on a real device and a real network, where the whole diagnosis had until then rested on a headless
browser. Four items came back with it. One is a defect in the change itself.

### D-128. ⚠️⚠️⚠️ Two documents each held a link that works once, and the one he was looking at lost

**What he saw.** *"When I read a QR code and page said 'there are others pages', I pressed the
'Move here' option but that said pairing cannot be done. But when I went to another tab the
pairing was possible there."*

**What it was.** §4.2.2 rule 3 as written yesterday: the arriving tab hands the invitation to the
live client **and keeps a copy**. The stash existed for a real reason — D-126 says the live tab may
be frozen and never hear the notice — and the reasoning recorded for it was *"a notice is a hope; a
notice plus a stash is a delivery."* His live tab was **not** frozen. It heard, and consumed §2.1's
single-use link. The copy this tab still held was by then spent, so pressing the button followed a
dead link and was refused — **and the refusal landed on the tab he was looking at, while the
pairing ran correctly on one he was not.**

**⭐⭐⭐ THE GENERAL FORM, AND IT IS THE REASON THIS IS A NUMBERED DECISION.** *A redundant copy is
a repair for a lost message and a defect for a spent one.* Duplication is the standard answer to
"the recipient may not be listening", and it is right whenever the thing duplicated can be
delivered twice with no harm. An invitation cannot. **Nothing in the reasoning that produced the
stash ever asked which kind of thing it was holding** — the argument was entirely about the
channel, and the object travelling down it was a one-shot secret the whole protocol is built
around. ⚠️ Note also what the stash was *defending*: a sentence. The panel said *"has been passed
to it"*, and the stash existed to keep that sentence true. **A copy kept in order to make a claim
honest is a strong signal the claim is the thing that is wrong.**

**⭐⭐ THE REPAIR IS NOT AN ACKNOWLEDGEMENT, IT IS HAVING NOTHING TO ACKNOWLEDGE.** The reflex fix
is to have the live tab announce *"I took it"* so the arriving tab drops its copy. That narrows the
race without closing it, and it adds a second message a frozen document can fail to hear — which is
the exact condition the stash was invented for, now load-bearing twice. §4.2.2 rule 3 is instead
**inverted**: an invitation takes over the tab it arrived in, and is never passed anywhere. One
document, one copy, no protocol to get right. ⭐ It is also what the person means — pointing a
camera at a code is an instruction addressed to the tab that opened, and that is the tab they are
looking at. Hannu chose this reading when it was put to him, in the same words he used the day
before: *"the tabs should unite."*

**Verified where the old build fails.** The browser harness leg now asserts that the scanned tab
reaches the pairing screen; on yesterday's build it shows `dormant`, so the assertion is
discriminating rather than decorative. ⚠️ And it does not stop at the screen: **two consumers of a
single-use secret do not both fail — one succeeds** — so "it is on the pairing screen" would have
passed on a build where the wrong tab won. The leg requires the pairing to **complete**, on both
sides, in the tab the scan opened. It does, and the displaced tab goes dormant.

⛔ **A wording was deleted, and the deletion is the point.** `copy.js` carried a second dormant
message for the QR case — *"the invitation you just opened has been passed to it"* — accurate for a
design that no longer exists. Left in place it would have been prose waiting to be believed by
whoever restored the branch it belonged to.

### The pairing limit was ten, and §9.2 had already argued against ten

*"I tried about 6 times to pair while testing… I had to switch internet connection to continue. I
think that limit is too low if somebody wants to chat with several friends."*

⚠️⚠️ **THE REFUTATION WAS TWO SENTENCES BELOW THE NUMBER, IN THE SAME SECTION.** §9.2 sets per-IP
limits, then spends three paragraphs establishing that a shared carrier address must not be charged
as though it were a person — *"thirty an hour shared across a carrier's NAT pool locks out the
thirty-first person"* — and names mobile concentration in Kerala as the reason. That argument was
applied to roster reads and **never carried across to the line above it**, where pairing creation
sat at ten on the same shared address. Raised to **30/hour**, on his decision.

⭐ **The counter was never the bound that mattered.** §5.1 charges a proof-of-work on every create,
and §9.1 sizes its own bucket at twice the highest creation limit — untouched by this change.
Tripling a per-hour count on an endpoint that already costs CPU per request moves an attacker's
cost by nothing, and moves the honest user off a limit they were hitting in ordinary use.
⚠️ Note what "six pairings" actually spends: switching to §2.2's spoken code **restarts** the
pairing and mints a second session, and an abandoned attempt has already been charged. The
user-visible count and the metered count are not the same number, which is why six felt like six
and metered like more than ten.

⭐ **A test now asserts the number, not only the mechanism.** The existing test proved that *some*
limit refuses, and would have passed contentedly for as long as the wrong figure stood.

### Two screens, and the second correction was the sharper one

*"The conversation list page often opens so that it is scrolled down and on mobiles the
conversations are above the top of the page."* Every screen is a panel in one document, so a panel
swap inherited the previous screen's scroll position — arriving at the list put the list above the
top of the window and the notes under it in view.

⭐ **His follow-up is the part a blanket fix would have broken:** *"when one conversation is opened
and the chat is rolling there then that should scroll to the bottom because the newest messages are
at the bottom."* "Always scroll to the top" is wrong for exactly one screen, and it is the screen
people spend their time on. **The bottom is the chat's top.** Two scrolls are involved and they are
different objects — the log box scrolls itself, the page scrolls around it — and both have to be at
the end for the newest message and the composer to be on screen together.

⚠️ **The preconditions are the whole test.** A page too short to scroll reports `scrollY === 0` for
reasons that have nothing to do with the fix, and a log with four messages in a box that holds
twelve is "scrolled to its end" under every possible implementation. Both legs assert that the
page could have been wrong before asserting that it is not.

### The two alternatives under the invite link, and the fix that would have gone the wrong way

*"These links are too invisible. Should be same size as the 'copy invite link' because these are
alternatives."* They were 0.85rem against the button's 1rem, inside a `<p class="note">` at
0.82rem.

⚠️ **`.linkish` declares `font: inherit` and then its own `font-size`, so deleting the override —
the obvious edit — would have made them SMALLER, not equal.** Reading the rule does not settle it;
`getComputedStyle` does, which is the same lesson as asserting the resolved value rather than the
input to the resolution. They stay underlined rather than becoming buttons: alternatives of equal
**size**, not of equal standing, since D-117's ordering is a tester finding and is not what was
reported wrong.

---

## 2026-08-18 — Session 27 (the QR holds; two more, and one of them is not a UI bug)

Hannu tested the QR code properly. **D-128 holds** — *"I did it 3 times and each time it went
correctly. Also if I was on a different tab in chrome or another app was on top."* That is the
§4.2.2 rewrite confirmed on a real device, in the three arrangements that broke it before.

Two items came back with it. The second is a protocol finding and is **open**.

### D-129. A conversation opened at its oldest message, and "not always" was the whole clue

**What he saw.** *"When opening an old conversation the messages that are scrolling are not always
scrolled to the bottom. It would be good if the scrolling conversation chain starts from the
bottom."*

**Cause.** `renderLog()` draws the history while the chat panel is still `display: none`. A hidden
element has no layout box at all — measured, forty messages: `scrollHeight 0, clientHeight 0` —
so the `scrollTop = scrollHeight` that `line()` performs for every message is **a no-op that does
not fail**. The whole history is drawn, every line of it asks to be scrolled to, and the box
arrives at the top. D-128's sibling in shape: the fix for the page scroll (§4.2.2 session) moved
the *page*, and the log is a separate scroll container inside it.

⭐⭐ **"Not always" is the part that had to be measured rather than read.** The box KEEPS the
offset it was left at earlier in the same page life — traced at the instant the panel is revealed,
on a build containing no scroll at all: **498px**. So a conversation opened, left and opened again
looks correct, because what is on screen is a **leftover**. Reload the app and there is no
leftover, and every conversation opens at its oldest message. That is exactly the reported case:
the OLD conversations, the ones he came back to.

⚠️⚠️ **AND IT IS WHY THE EXISTING CHECK PASSED ON THE BROKEN BUILD.** `browser-one-client.mjs`
asserts "the log sits at its end", ran against the unfixed client, and reported the property as
held — because it opened a conversation whose box still carried yesterday's offset. The probe
written to replace it passed on **both** builds too, until it reloaded the page first. ➡️ **A
stale value that happens to be correct is indistinguishable from a fix, unless the measurement
starts from a state that cannot carry one.** The reload is the precondition, not a detail of the
harness.

Fixed by scrolling the log **after** the panel is on show. Fails on the previous build
(`scrollTop 0` of a possible 522), passes on the new one, and passes against `haamu.app` itself.

### D-130. ⚠️⚠️⚠️ OPEN — "this conversation was restarted" on a conversation nobody restarted, and HIS OWN SEND is what turned the messages red

**What he saw.** *"This red notification in chat between messages: 'A message arrived on a
conversation that has since been restarted, so it can no longer be read.' comes when I have not
used that conversation for some time. Meaning chats from last night. It did not happen with new
chats I created today. In the old chats when I send from android a messages those do not arrive in
desktop until I send a message from desktop to android. After that all messages flow well but that
red notification arrives where there were missing messages."*

**Reproduced end to end against the real server, with nothing failing** — no network error, no
lost message, no clock problem (`repro-stale-sequence.mjs`, 14 checks):

| | |
|---|---|
| ① the peer sends | nothing arrives, and **nothing at all is shown** — §5.4.2 calls this transient on purpose, so the pre-key that would open the session is still allowed to turn up |
| ① … however often this device looks | still silent |
| ② he sends from the affected device | **this mints a new generation** (1 → 2), §6.3 |
| ③ the waiting messages turn red | `stale_generation`, refused, destroyed after three drains |
| ④ afterwards | everything flows, both directions |

⭐⭐⭐⭐ **THE ORDER IS THE FINDING: HIS OWN SEND IS WHAT TURNED THOSE MESSAGES RED.** They were
not refused when they arrived. They were waiting, correctly and silently, for a key that might
still come. His send raised the generation **past** them, which reclassified them from "wait" to
"refused" under rule 1 — and rule 1's own justification is that such a message *"can never become
readable"*, which was true of the messages the rule was written for and is true of these only
because this device moved the line after they were already queued.

**The precondition it needs** is that the device arrived without its Olm session state for that
channel while the roster generation — server-held, §7.3 — survived. That is §6.3's own *"cleared
storage, or device migration"* case.

⚠️ **WHAT DESTROYED THAT STATE IS NOT KNOWN AND MUST NOT BE GUESSED.** What can be ruled out from
the code: not §7.8's ordinary ending and not a deletion, because `ENDING_CLEARS` and
`forgetLocally` both take `MESSAGES` with them and his history is intact; and not a decryption
failure, because `records().read()` throws rather than returning an empty record. The remaining
candidates are not distinguishable without a reading from his device.

⚠️⚠️ **AND THERE IS A GAP IN THE DOCUMENT UNDERNEATH IT.** §6.3 rule 1 refuses on the stated
grounds that *"the peer will re-establish at the higher generation rather than resend on this
one"* — but **the peer has no way to learn that a higher generation exists.** The only carrier of
a generation is a message from the raised side, so until this device happens to send something,
every message the peer sends is refused and destroyed while the peer's own view reads
"Delivered" (§5.5). The manual repair Hannu found — *"until I send a message from desktop to
android"* — is the only repair the protocol has, and it is not written down anywhere as one.

📌 **Open, and the ruling is Hannu's** (README §0: a construction the document does not have is a
signal the document is wrong, not a licence to invent). Two separable questions:
1. **The cause** — what removed the session state. Needs a reading from the affected device.
2. **The silence in ①**, which is what actually cost him the morning: messages were arriving and
   waiting and the app said nothing. §5.4.2 requires that this not be **counted**; it says
   nothing about not being **shown**. That is a screen decision, not a protocol change.

### D-130a. ⛔ THIS EXPLAINS ONE OBSERVATION AND WAS WRITTEN AS THOUGH IT EXPLAINED ALL OF THEM — see D-131

⚠️⚠️ **CORRECTED THE SAME DAY, BY HANNU.** *"I had used Firefox for haamu testing for several
days with that KEY. The problems I reported earlier came all on Firefox. I switched only when you
asked me to look in the Console."* The browser switch was **my** doing — I asked him to open
DevTools — so the migration below explains the Chrome sessions and **cannot** explain the original
report, which predates the switch entirely.

➡️ **Exactly the failure mode `feedback_verify_before_claiming` names: a true explanation on file
absorbs the next observation that looks like it.** The section below is true and stays; what was
wrong was the heading calling it "THE CAUSE" and closing question 1. Question 1 is **open** and is
now D-131. Ask what an explanation PREDICTS and check the new observation is inside it: this one
predicts the fault only on a device that has never held the conversation, and Firefox had held it
for days.

### D-130a (as written, and true of the Chrome sessions). A device migration reached by an act nobody would call one

*"I had used Firefox on the desktop so when I now go to chrome with that KEY all conversations are
empty from messages."*

**That is the whole answer, and question 1 is closed.** A different browser is a different device:
its IndexedDB is its own. The KEY recovers the identity and the roster, which are **server-held**
(§7.3), and recovers **nothing else** — the Olm session state and the message log are device-local
by design. So the empty conversations are not a second symptom, they are the *same fact* as the
unreadable messages, seen from the other side.

⚠️⚠️ **§6.3 CALLS THIS "cleared storage, or device migration" AND NOTHING IN THE PRODUCT CALLS IT
ANYTHING.** Nobody describes opening a website in another browser as migrating a device. The
document's list of causes is written from the implementation's point of view — what happened to the
storage — and the user's list has one entry the document never names: *I opened it somewhere else.*
➡️ **A precondition stated in terms of its mechanism will not be recognised by the person who
triggers it.**

**Reproduced end to end in three real browsers** (`browser-migration.mjs`, and it now runs against
`haamu.app` itself): the conversation comes back empty; three messages from the peer arrive and
cannot be read; **nothing whatever is shown**; one message out repairs it; the earlier three then
turn red; and the sender's screen shows no sign of any of it at any point.

⭐ **And the lag he noticed is §5.4.2 being exactly right.** *"the red notification arrives... after
I had sent two messages in the other direction"* — each refusal must fail **three** drains before it
is staged, and a drain happens per delivery. The counter reaches three on the second delivery. The
notice trails the repair by design, which is why it reads as a consequence of his own fix.

⛔⛔ **THE MESSAGES ARE NOT RECOVERABLE AND THE FIX MUST NOT PRETEND OTHERWISE.** They were
encrypted to a ratchet that only ever existed in the other browser. That is §6.2's forward secrecy
working: the property that stops a seized device surrendering the past is the same property that
stops the new browser reading them. Eight of Hannu's messages are gone, permanently.

**What shipped (his ruling: "warn now, then automate").** No protocol change:
- a banner **above** the log — the log is empty in exactly this case, and a note under an empty box
  is a note nobody reads — leading with the **action** (*"Send a message to reconnect this
  conversation"*), with the reason and the cost under it;
- a count on the **list**, which is the screen somebody unlocking in a new browser lands on first;
- the refusal notice rewritten. It said *"on a conversation that has since been restarted"* to a
  person who had restarted nothing. ➡️ **A notice that names an event the reader cannot place sends
  them looking for the event.**

⚠️ **The generation is what separates a migration from a NEW PAIRING**, and without it the banner
would fire on every conversation the moment it was created — both have an empty session record. A
channel at generation 0 is simply new; a channel at 1 or more has had a session, and if this device
holds none of it then that session was elsewhere. ⭐ It clears itself, because the first send writes
the session it is computed from: nothing to dismiss, nothing to remember.

⚠️ **Two house rules caught the first draft of the copy, and both tests earned their place.** D-109
keeps the lowercase word "key" off the surface — KEY in capitals is the person's own words and the
collision is the entire reason the rule exists — so the prose says what the thing DOES. D-016b bans
the singular "they". Eight new browser checks; **all eight fail on the previous build.**

📌 **Still open: the automatic half.** A device that unlocks holding a conversation and none of its
state should announce itself rather than wait to be typed in, which collapses the loss window from
"until you send" to seconds. It needs a payload kind §6.7 does not have, and it makes the client
emit traffic the user did not cause — a metadata decision to take deliberately, with the protocol
written first.

⚠️⚠️ **AND THE DOCUMENT ALREADY KNEW THIS FAILURE, IN ONE PLACE ONLY.** §7.3.1a warns that a wipe
notice from a browser that has never held the conversations is *"refused by the recipient as
`stale_generation` — while the sender's own screen reports it as sent... The failure is silent at
both ends"*, and rules that such notices **MUST NOT** be reported as delivered. Every word of that
applies to ordinary messages and the document says it only about wipe notices. ➡️ Same shape as
D-093, quoted in §6.7.1 rule 4a: **a section describing something in the singular is not a licence
to implement it only where the singular appears** — and here it is not the implementation that read
it too narrowly, it is the specification that wrote it too narrowly.

### D-131. ⚠️⚠️ OPEN — the asymmetry, and the one thing a refusal PROVES

**What he measured**, over several conversations between the same two identities, deliberately both
ways round: *"if I continue a conversation from yesterday starting with a message from android to
desktop it does not come through until the desktop browser has sent something... But that problem
does not happen if I continue a conversation from yesterday from a desktop browser."*

**Measured here, and it is a NEGATIVE:** two conversations, a real break with both browsers CLOSED
and **nothing wiped** — persistent profiles, so both sides come back with full session state and
history — then one conversation resumed by each side. **Both directions worked**
(`browser-resume.mjs`). ➡️ **A break alone does not reproduce it.** Whatever the cause is, it is
not the passage of time and not the closing of a browser.

⭐⭐⭐⭐ **AND ONE LINE OF `protocol/session.js` NARROWS IT TO A SINGLE CONDITION.** `classify()`
tests the session table **before** it tests the generation:

```js
if (state.sessions[k]) return { action: DECRYPT, session: k };
if (envelope.generation < state.generation) return { action: REFUSE, reason: "stale_generation" };
```

**A message on a session this device HOLDS is decrypted whatever its generation.** So a
`stale_generation` refusal is not evidence of a generation gap alone — it is proof that **the
refusing device did not hold the session the sender was using.** A generation gap is necessary and
is not sufficient. ➡️ **In every case this symptom appears, the receiving side has lost its Olm
session state for that channel.** That is the fact to hunt, and it is one fact rather than a family.

⭐⭐ **The asymmetry then falls straight out, and it identifies which side is broken.** The side
that lost its state can still SEND — its first message is a pre-key at a higher generation, and
§6.3 rule 2 adopts a higher generation *unconditionally*. It cannot RECEIVE, because rule 1 refuses
everything the peer sends on the session it no longer has. So the direction that works points AWAY
from the damaged device: *desktop → android arrives* and *android → desktop does not* means **the
desktop is the side that lost its sessions.**

📌 **The instrument is already deployed.** D-130a's banner fires on exactly this condition — a
roster entry at generation ≥ 1 with an empty local session record. Whether it appears on a
conversation in a browser that has *never* migrated is a straight yes/no, and it is falsifiable
both ways: yes ⇒ session state is being lost on an ordinary device and that is the bug; no, with
the messages still refused ⇒ the deduction above is wrong and this reopens from the beginning.

---

## 2026-08-18 — Session 28 (his step 2: the half that cannot be built, and the half nobody had measured)

### D-132. ⛔ "Let go" is refuted; the store had to be given a word instead

**His chosen step after §4.2.2 was "let go, and say so".** The rule and the decided shape are in
`ARCHITECTURE.md` §4.2.3. This entry is what measurement did to the plan.

⛔ **THE FIRST HALF CANNOT BE BUILT, AND BOTH CANDIDATES ARE NOW CLOSED RATHER THAN ONE.** D-127
refuted `db.close()` on `visibilitychange` and was careful to record the `freeze` event as
*untested, not refuted* — so it was tested. On two blank pages, no part of this client present,
with the visible→hidden transition asserted before each leg:

| repair | handler ran? | the other tab's readwrite |
|---|---|---|
| none — the control | — | **blocked** past 20 s |
| close the connection in `freeze` | **fired 0×** | blocked |
| close the connection when `hidden` | fired 1×, connection closed | **blocked** |

➡️ **LETTING GO IS AN ACTION, AND A FROZEN DOCUMENT IS NOT RUNNING.** Every repair of this shape
must be taken *before* the freeze, and the only one available is not to be holding a transaction
at all. ⭐ Worth keeping as a general form: **a remedy that requires the broken party to do
something is not a remedy for a party that has stopped executing** — which is the third time this
family has caught this project out (D-126's frozen lock holder, D-127's stuck transaction, and now
its repair).

### ⭐⭐⭐ And the half that could be built was worth more than it sounded

§4.2.2 closed by saying the residual case is *"still silent"*. That was written from reasoning.
Measured in the running product — the blocker a same-origin page that is **not** an lpm client, so
no election can confound it:

| | |
|---|---|
| control, store free | the message arrives |
| precondition | a readwrite on `conversation` still waiting after 6 s |
| **the stall** | **40 s, nothing arrives** |
| **the screen** | status `live` · 0 red · 0 new messages · **identical to a working conversation** |
| causation | release the blocker → the held message lands, store free in **0 ms** |

⚠️⚠️ **THE REASON NOTHING REPORTED IT IS THAT A BLOCKED STORE MAKES THE DRAIN *WAIT*, NOT FAIL.**
IndexedDB raises `blocked` for a version upgrade and raises nothing at all for a transaction queued
behind another connection. `flow/message.js` does not throw, `flow/live.js` reports no failure, and
the status line goes on saying `live` — **truthfully, about the connection, which is not the thing
that is broken.** ➡️ **The one state this client had no word for was the one where everything it
monitors is healthy.** Every instrument it owns was pointed at the transport.

⭐ **The detector is a timer and it lives in `storage/db.js`, because the store is what is blocked.**
Five seconds, chosen against two numbers rather than by feel: D-127 sampled the block present from
4 s to 54 s, and a free store answers in 0 ms. It counts operations that are *individually* slow —
a single timer armed on the first outstanding request would fire during a busy second of fast
writes and announce a fault that is not there.

⭐⭐ **THE CENSUS DECIDES WHICH TRUE SENTENCE IS SAID, AND THAT IS THE PART I WOULD HAVE GOT WRONG
YESTERDAY.** Only another connection can hold a transaction for seconds — but *"another connection"*
and *"another tab of this app"* are not the same claim, and the first draft of this said the second
one unconditionally. The census already knows. Where it finds a sibling the client names the tab;
where it finds none, or cannot answer, it says the storage is busy and invents nothing.

⚠️ **No control is offered, and that is a deliberate departure from §4.2.2 rule 2** — where "the
button is the whole difference between a rule and a trap". Here no button could work: one document
cannot abort another's transaction, cannot close another tab, and a frozen tab hears no notice.
**An honest sentence with no control beats a control that does nothing.**

**Proved discriminating, which is this session's own lesson applied.** The same probe was run
against HEAD served on a second port: every precondition passed, `swap` passed, and all three new
assertions **failed** — *still "live" after 25.4 s*. On the new build the status changes in 5.2 s
with no sibling and 4.4 s with one, and returns to `live` when the store frees, so it is a level
and not a latch.

⚠️ **One risk was carried deliberately and then checked.** §4.2.3's timer wraps what `storage/db.js`
awaits, and that file's own header warns that awaiting anything which is not an IndexedDB request
inside a transaction **closes it**. So `swap`'s read is left unwrapped — the `put` has to be issued
out of that promise's resolution — and only the completion is timed, which loses nothing because a
store that cannot start a transaction cannot finish one either. The Node suites run against a Map
and cannot see this; a real message each way through a real Chrome store can, and does.

⚠️ **What this does NOT do, said here so it cannot be misremembered:** it does not shorten the sixty
seconds. It makes them legible. Whether a person meeting "waiting for another tab" is better served
than one meeting a silent stall is a question about people, and Hannu's devices answer it.

---

### D-133. ⭐⭐⭐ The ending destroys the session state, and its own copy promises otherwise

**Hannu's field round, 2026-08-18, and he supplied the cause without knowing it.** Reporting
on D-130a's banner he wrote: *"One reason for all this may be that I have used two KEY's and
three browsers and removed the KEY and put it back."*

⚠️⚠️ **`ENDING_CLEARS = [CONVERSATION, MESSAGES]`, AND `CONVERSATION` IS WHERE EVERY OLM
SESSION LIVES.** The roster is server-held and returns with the KEY; the session state is
device-local and does not. So *forget the KEY, type it back* **necessarily** leaves a browser
holding conversations it cannot receive on — a deduction from the source, not a guess about
his machine.

⭐⭐⭐ **AND THE ENDING'S OWN CONFIRM DIALOG SAYS THE OPPOSITE**, in `copy.ending.confirm`:

> *"No conversation is ended and nobody is told anything. They stay open for the other people,
> they stay on your other devices, and **they come back on this one when you type the KEY**."*

True of the conversation LIST. False of being able to RECEIVE, and false of the history.
➡️ **`feedback_legal_text_drift`'s worst class again: a true, tested sentence that is false
about the thing the person actually cares about.** Nothing in a build reads English, so this
survived every suite.

**Measured, and the important leg was a PREDICTION MADE BEFORE THE RUN**
(`scratchpad/probe-forget-key.mjs`, all green) — which matters because earlier the same day I
explained one of his reports with a condition my own diagnostic request had created, so a
mechanism that merely *fits* is worth nothing:

- press "Forget your KEY here", type the KEY back ⇒ **the list returns, the history does not,
  and the banner is up.** One control press. No browser switching, no DevTools.
- opening the conversation then sends the reconnect message **by itself, once**; the peer
  receives it; receiving works again.
- two messages the peer sent into the dead session draw **two red lines after a single
  post-reconnect delivery** — which the three-drain rule could not have produced.

⚠️⚠️ **WHAT THIS DOES NOT DO: it does not close D-131.** It explains the observations he
described today — which **he had already flagged as confounded by his own KEY switching**, and
that self-catch is the reason this entry is not a cause-closing one. His ORIGINAL report
predates the switching. Two things may be in play and they are not collapsed here.

⭐⭐ **HE ALSO REFUTED MY OWN LEAD BEFORE I COULD WRITE IT DOWN.** The Firefox-only pattern had
a plausible mechanism — the client never calls `navigator.storage.persist()`, Chrome
auto-grants persistence and Firefox does not — and his next round killed it in one line:
*"now also desktop chrome did it."* Eviction cannot hit two browsers on one machine. The lead
is dead; the missing `persist()` call is recorded as a separate open question, not a cause.

### The three changes his round produced

1. **His wording, verbatim**, for the banner and the red line. ⭐ The red line's singular form
   was chosen for a REASON rather than a preference: it is drawn once **per message** — he
   counted eight — so "one or more messages have been lost" would say "one or more" eight times
   over eight single messages. And *"please ask your friend to resend"* is the first version of
   that string that tells anyone what to do.
2. ⭐⭐ **Automatic reconnect on OPEN — his design, and cheaper than the one that was queued.**
   §6.7 needed no new payload kind: **sending anything at all is what builds the session**, so
   an ordinary message does it. On open rather than on unlock is his phrasing doing real work
   (*"at the same time when it writes that notification"*) — one message per conversation the
   person actually looks at, instead of a burst to peers they never meant to contact.
   ⚠️ **It cannot recover anything already lost**, and no care could: those messages were
   encrypted to a session that is gone, which is precisely what §6.2 buys.
3. ⭐⭐ **§5.4.2's line on the first drain, acknowledged on the third.** That sentence binds two
   things and only one needs the count — the count exists so a message is not **deleted** early,
   and §5.4.2's own table calls the three drains *"a formality that bounds it"* for this refusal
   class. Nothing asks for silence meanwhile. `staged` and `settle` are untouched, so every rule
   about what may be deleted is unchanged; the early line is **drawn and not stored**, so
   `renderLog` replaces it with the real entry the moment there is one.

⭐ **And the harness was wrong twice, in a session whose own lesson is to suspect it first** —
once sampling the screen before the auto-send resolved (the next two checks already proved it
worked), once matching against a string its own log-truncation had cut. Neither was a product
fault.

### D-164. ⛔⛔⛔⛔ The review sample was a fiction, so twenty-seven rounds reviewed a sentence the product cannot produce

**2026-08-25, from Hannu pressing both endings on his device and reading the screen.** Two
findings from one test, and the second one is the deeper.

**(a) The two endings looked the same.** He ran both and reported: *"Seems to be only that
the later removes the choice whether light or dark mode. … That is not a very big and needed
difference."* Measured against the live site he was nearly right. Every file is served
`no-store` and the origin sets **no cookies**, so two of `Clear-Site-Data`'s three words —
`"cache"` and `"cookies"` — reach nothing at all on haamu.app. What the thorough ending
genuinely takes beyond the ordinary one is: the colour and language choices, **any second
identity's records**, anything an older schema left behind, and §7.3.2's high-water mark —
which it **destroys** and the ordinary one deliberately keeps.

➡️ **A CONTROL THAT NAMES ITS MECHANISM IS COMPARED WITH ITS NEIGHBOUR ON THE MECHANISM.**
*"Clear this site's data"* read as a stronger version of the button beside it rather than as
a different job, so a person who had just deleted every message could see no reason for it.
The label now names the relationship — *"Delete my messages, and everything else haamu has
stored here"* — and the confirmation names what this one takes **and the other one leaves**.
⚠️ D-150's disclosure sentence about the rollback check is untouched and now has a test:
**shortening a true sentence is safe; deleting the only true sentence about a security
downgrade is not.**

**(b) And the notice he read it off was itself wrong, in Finnish, live.** After the thorough
ending his next unlock correctly showed §7.3.2's weak-freshness line — the high-water mark
was gone, exactly as designed — and it said:

> *"Sen mukaan se tallennettiin viimeksi **laitteella** 8/24/2026"* — *"it was last saved
> **on the device** 8/24/2026"*.

The slot holds a **date**. `list.unnamedOn` had the same fault: *"aloitettu laitteella
25.8.2026"*, *"started with the device 25.8.2026"*.

⭐⭐⭐⭐ **AND THE TRANSLATION WAS FAITHFUL. THE SAMPLE WAS THE DEFECT.**
`test/samples.mjs` gave both sentences the argument `"Pixel 6"`. The bilingual review sheet
is generated from that same table, so what twenty-seven rounds of Finnish review, both
translators, Hannu's own reading pass and **every prose rule in `test/copy.mjs`** actually
read was *"No name yet · started Pixel 6"* — a sentence this product cannot produce. A
translator handed that must supply a preposition to make it grammatical, and the correct one
for a device is *laitteella*. **The English was right, the Finnish was right for the sample,
and the sample was wrong.** It is the only wrong-kind sample in the table: all sixteen others
were swept and match their call sites.

➡️ `samples.mjs` exists because **a branch no sample argument reaches has no home to be
reviewed in** (D-156). ⭐⭐ **The next defect in is a sample of the WRONG KIND: the sentence
is reviewable, everybody reviews it, and what they review is a fiction.** ➡️ **A SAMPLE
ARGUMENT IS NOT AN EXAMPLE — IT IS A CLAIM ABOUT WHAT THE CALL SITE PASSES**, and until this
round nothing checked it against one.

**Pinned at three sides**, because either end alone stayed self-consistent for as long as the
defect existed: `test/copy.mjs` requires the samples for both paths to be date-shaped (canary:
`"Pixel 6"` is refused); `test/app-document.mjs` requires both call sites to pass
`toLocaleDateString()` (canary: a device-shaped argument is refused); `test/copy-fi.mjs`
requires that **no Finnish built sentence announces its slot as a device** — a rule about
POSITION, not a search for `laite`, which would report the eleven sentences where the word is
correct and is exactly how D-158's class keeps recurring.

⚠️ Hannu confirmed the repair as the native speaker: *"Both are good finnish. Exact
translation to english would be 'started on 25.8.2026' / 'saved last time on 25.8.2026'."*

⚠️ **One more thing my own patterns did wrong, twice now:** `[^)]*` cannot span a nested
paren, and both call sites contain one — `new Date((entry.created ?? 0) * 1000)`. The first
version of the call-site guard matched nothing and would have passed forever. The canary is
what found it.

📌 **Left open, deliberately, for Hannu:** the date itself is rendered with
`toLocaleDateString()` and no locale, so it follows the DEVICE's language rather than the
app's — his screen showed *8/24/2026* inside a Finnish sentence. That is a real
inconsistency in a product with its own language switch, but choosing a locale for English
readers is his call, not a bug fix.

### D-163. ⭐⭐⭐⭐ The gentle control had no button, and the destructive one promised to remove something never stored

**2026-08-25, from Hannu reading his own device test back to me.** D-162's fix worked: he
kept two conversations, pressed *"Forget my KEY on this browser"*, unlocked with the same
KEY, and the names came back with every message gone. He then said what nobody had said in
eighteen rounds of copy review:

> *"I actually could have expected that when I press 'Forget my KEY on this browser' that
> the messages come back when I put the key back. I would not have expected the messages go
> away because they are protected by the KEY. … I personally would want to remove my KEY
> from browser without loosing the messages, so that when I put the KEY back the messages
> are there. But if that is unsafe then not."*

**It is not unsafe. It already existed, and it had no button.** §4.3's lock (`flow/lock.js`,
`lockNow` in `app/app.js`) drops the derived key set, closes the database and **touches no
store** — put the KEY back and everything is there, messages included. It could be reached
only by leaving the tab idle for 30 minutes or backgrounded for 5. So the product ran the
gentle action on a timer and offered, as buttons, only the two that delete.

⭐⭐⭐ **THE CLASS IS "A MECHANISM WITH NO CONTROL", AND NO REVIEW THAT READS CODE CAN FIND
IT.** The lock was specified, implemented, unit-tested, honestly worded, and correct.
Nothing was wrong with it. **An absent button has no string to review, no branch to cover
and no line to read** — it is D-151's missing sentence one level up, and the three outside
slices of 2026-08-24 walked past it because a reviewer is given files. ➡️ **The question
that finds it is not "is this correct?" but "how does a person ASK for this?"**, put to
every mechanism a design offers, including the ones that work.

**And the second half, which is the same defect wearing the other face.** The control was
labelled *"Forget my KEY on this browser"*. §7.5's PRF record is the only thing that would
let a browser hold a KEY between sessions, and this client has **no `navigator.credentials`
call anywhere** — every unlock is the phrase and a full Argon2id. There was no KEY here to
forget. ➡️ **The half of the label a person reads first named the half that costs nothing,
and the deletion of every message on the device was not named at all.** PROTOCOL 0.9.24
turns that into a rule: a control must name what it DESTROYS before what it DROPS, and
"what the person loses" is read against the client's own storage rather than against §7.8's
list of what a client MAY store.

**And the confirmation had already been repaired once, for this, by this reader.** D-133
added *"Conversations come back, but without messages."* after Hannu forgot a KEY, typed it
back and reported what he saw. He met the same dialog again with that sentence in front of
him and reported the same surprise: *"the casual reader might think messages and
conversations are the same thing."* The paragraph above it was doing the damage — *"they
come back on this one when you type the KEY"* is true of conversations and false of
messages, and to a reader for whom a conversation CONTAINS its messages it says everything
comes back. ➡️ ⭐⭐ **A TRUE SENTENCE CANNOT REPAIR A SENTENCE THE READER HAS ALREADY
UNDERSTOOD DIFFERENTLY.** By the time the limit arrives the reader has a picture, and the
correction reads as a contradiction rather than as a qualification. The fix is not another
qualifier: it is to stop using the word that means both, and `test/copy.mjs` now holds the
rule as a rule — **every sentence promising the list comes back says in the same breath
that it is empty** — with the old pair as its canary, because both halves of it fail.

**Shipped.** A lock control above the two endings in its own group, with its note on the
screen rather than in a dialog (the choice is made before any dialog opens); a third lock
reason `MANUAL` that `dueToLock` may never return; the ending relabelled *"Delete my
messages from this browser, and forget my KEY"*; the confirmation rewritten loss-first; and
the two tab sentences swept with it, because they reported the half that costs nothing too.

⚠️⚠️ **`lockNow`'s ternary was one reason away from lying.** `reason === BLURRED ? blurred :
idle` is an exhaustive match over two values that **stops being one without changing** — the
manual reason would have inherited the `else` and told somebody who pressed a button one
second earlier that they had been idle for thirty minutes. It is now a lookup, built at call
time because `setLanguage` overwrites the strings in place.

⛔⛔ **AND ONE MUTATION SURVIVED, WHICH IS WHY THEY ARE RUN.** The new Finnish guard was
`/tyhj/i` — "does the Finnish confirmation still say the conversation comes back *tyhjä*?"
Deleting that sentence outright did not fail the build: `tyhj-` also opens *tyhjentämällä*
("by clearing"), which stands in the fourth paragraph of the same string, so the rule read
the sentence about clearing browser data and reported the empty-conversation sentence
present. ⭐⭐ **That is D-158's own lesson — a Finnish stem is not a word — arriving inside
the check whose comment cites D-158.** ➡️ **Citing a rule is not applying it.** What caught
it was not the reasoning; it was deleting the sentence and watching the suite stay green.

### D-162. ⛔⛔⛔⛔⛔ The ordinary ending deleted nothing, and the repair that broke it was hours old

**2026-08-24, from the second pass of review slice B — which is the only reason it was
found.** The slices were re-run against the repaired tree with the brief, the model and
the effort held constant, so the single thing that differed from the first pass was the
code. ⭐⭐⭐ **THE RE-RUN CAUGHT A REGRESSION THE SAME DAY'S REPAIR HAD INTRODUCED**, which
is the argument for re-reading after a fix rather than only before one.

**The defect.** §7.8 step 2 fills `local_key` with zeros. Step 3 then calls
`vault.endSession()`, which decides which stored records belong to this identity by
**opening them** — `opens(local_key, …)` on every row. Every open failed, the deletion
plan came back empty, `db.deleteAll([])` ran, and the ending page said it was done. A
Kept identity that ended ordinarily left its messages, its roster and its Olm pickles in
IndexedDB, and re-entering the eight words derived the same `local_key` and read them
all back.

**Measured rather than argued**, against the real vault and the real ending:

```
control  (key intact)   -> {"deleted":2,"left":0}
real order (key zeroed) -> {"deleted":0,"left":2}
```

⚠️⚠️ **AND IT WAS HOURS OLD.** Until this same day step 3 was `db.clear(ENDING_CLEARS)`,
which empties whole object stores and **needs no key** — so step 2's position was
harmless. The change that made deletion key-filtered was itself a correct repair: a
browser holding two identities lost BOTH when either one ended, which §7.8 forbids and
§7.2 makes possible. That repair is what made step 2 fatal. ➡️ **A STEP'S ORDER IS ONLY
SAFE RELATIVE TO WHAT THE OTHER STEPS NEED, AND THE STEP THAT CHANGED WAS NOT THIS ONE.**

⚠️⚠️ **AND THE DEVICE ROUND COULD NOT HAVE SEEN IT.** Hannu tested the ending the day
before and it worked: the control responded, the census ran, the ending page appeared,
`db.deleteAll` executed. All of that is true of an empty plan. **Nothing on screen
differs between deleting everything and deleting nothing** — the difference is only
visible in IndexedDB, or by unlocking again afterwards and finding the conversations
still there.

**Decided: plan, then wipe, then execute.** `vault.planEnding()` builds the list while
the key is live; §7.8 step 2a hands it across the overwrite; `endSession(prepared)`
spends it. ⭐ **Swapping steps 2 and 3 was rejected**: step 2 is deliberately before the
clear so that a clear which throws cannot leave the keys live, and buying deletion by
giving that up trades a silent failure for a louder one. Deferring only `local_key` was
rejected for the same reason — a clear that *hangs* would leave it live indefinitely.
The plan is record identifiers and no key material, so carrying it across the wipe hands
nothing to the interval, and §7.8 step 1 already stopped every writer, so the two local
operations now standing between selection and execution add no window.

⭐ **The bfcache repeat replays the prepared plan rather than building a new one.** It
runs by design after the keys are gone; a fresh plan there would be empty for exactly
the same reason, and its own comment already said the keys "may already be zeroed"
without drawing the consequence.

**Two guards, because one of them could not see the other's failure.** `test/ending.mjs`
now asserts an END STATE — the rows are actually gone — and `test/app-document.mjs`
asserts that all three `endings.endSession` call sites in `app/app.js` pass a
`prepareStorage`, since the flow test supplies its own and would pass while the
application handed step 3 a dead key. Four mutations, each watched failing: the plan
moved back after the wipe (3 failures), the vault ignoring the plan it was handed (3),
one call site reverted (2), and the pattern canary.

⛔⛔⛔ **AND THE LESSON IS AIMED AT THIS FILE'S OWN TEST.** `test/ending.mjs` opens by
saying the ORDER is the subject, that each individual step is easy to check and none of
them was where the defect was, and that the checks therefore **record the sequence and
assert on that**. That was right, and it is why the 0.8.13 defect cannot come back. It
is also why this one sailed through: **the sequence was correct.** Step 1 stopped the
writers, step 2 wiped, step 3 cleared, in that order, every time. ➡️ **A SEQUENCE
ASSERTION PROVES THE STEPS HAPPEN IN ORDER. IT CANNOT PROVE THAT A STEP STILL HAS WHAT
IT NEEDS WHEN ITS TURN ARRIVES** — and only the end state can say so.

**PROTOCOL 0.9.23** writes the constraint into §7.8 step 3, which had stated both halves
in different places and never in the same sentence.


### D-161. ⭐⭐⭐⭐ The guard met its first stranger the same day — and read his disk

**2026-08-24, hours after D-160 and the visibility flip.** D-160 closed with *"a guard meets its
first stranger in the repository it was not written in."* It met one that afternoon.

**Found by accident, which is the only reason it was found at all.** The first clone of the
now-public `hannu64/haamu-client` landed in a working scratchpad that happens to hold a stray
`e2e.sh`, and `./test.sh` **failed**. The scratchpad was the anomaly and not the repository — but
the defect underneath was real, and it was D-160's own guard.

`test/suite.mjs` decided which of the two trees it was in by reading `../../e2e.sh` and
`../../server`. In the monorepo `../../` is the project root, and reading it is reading ourselves.
**In the published client the client IS the root, so `../../` is whatever directory the reader
happened to clone into.**

```
~/src/server/          ← an unrelated project they already had
~/src/haamu-client/    ← git clone …
```

`./test.sh` → **exit 1**, two failures, reporting *"monorepo: server present, so e2e.sh must be
too"*. A developer with a `server/` directory beside their checkout — hardly exotic — watches the
test suite of a security product fail on first run for a reason that has nothing to do with its
code, **on the repository whose entire offer is that they can check it themselves**. Nothing was
broken. The guard was reading somebody else's disk.

⚠️⚠️ **AND IT WAS IN TWO PLACES, NOT ONE.** `test.sh` made the same decision the same way
(`if [ ! -d ../server ]`), so the same reader also reached the *"no Go toolchain here"* branch and
its `exit 1`. **The first fix repaired `suite.mjs` and `./test.sh` still exited 1** — the second
site surfaced only because the fix was checked by running the reader's whole command instead of the
one file that had been changed. ➡️ *A fix verified on the unit that was edited is verified on the
unit that was edited.*

**Decided: the published tree is recognised by something the publish step deliberately puts INSIDE
it** — `DECISIONS.md` at the client root, which `scripts/publish-client.sh` copies in from
system-docs and which the monorepo's own `client/` therefore never has. ⭐ It is matched by its
opening line and not by its name alone, the discipline `gen-vectors.mjs`'s exemption already uses:
a file that stops being the document it claimed stops being the marker. Once the marker has spoken,
**nothing above the root is read at all** — not even to report it. A stray `e2e.sh` would otherwise
be concatenated into `runners`, where it could mark a genuinely orphaned test as invoked: this
guard's own failure mode, arriving through the guard itself.

⚠️ **The old inference is kept as a second route rather than replaced**, so D-160 holds exactly as
written — an `e2e.sh` that goes missing FROM THE MONOREPO still fails loudly instead of silently
exempting every e2e suite. The marker only ever ADDS a way to be recognised, so no tree that passed
before can begin to fail.

**Three mutations, each watched failing.** Disabling the marker reproduced the original two
failures verbatim; an `isMarker` widened to accept any file was caught by its own canary; reverting
`test.sh`'s branch brought back the exact `go: go.mod file not found` and its exit 1. Four reader
environments now pass, including a parent holding **both** `server/` and `e2e.sh` — a directory
indistinguishable from a monorepo from the outside. Both broken monorepo shapes still fail.

⭐ **No served file changed**, so this needed no deploy: the stamp stayed `5ea53d9b1d1ead29`. The
repair is entirely in the two files a stranger runs.

➡️ **A TEST THAT READS ABOVE ITS OWN ROOT IS READING SOMEBODY ELSE'S DISK** — and in the tree that
most needs it to be right, it cannot tell the difference.


### D-160. ⭐⭐⭐ The client is published — and a guard written to catch an un-run test nearly exempted itself in the repository nobody could check it in

**2026-08-24.** `hannu64/haamu-client` exists: `client/` plus `DECISIONS.md`, **AGPL-3.0-only**,
mirrored from the private monorepo by `scripts/publish-client.sh` — privsend's proven clean-mirror
tool, adapted. The monorepo stays the single source of truth; no private commit message crosses
over. The server, the migrations and `deploy/` are **not** published.

**The server being closed concedes no security claim, and the README says so in those words.** It
receives a mailbox id, a public value and a ciphertext; the client is written on the assumption
that it is hostile. Everything an auditor would want — the derivations, the handshake, the ratchet,
what reaches disk, what leaves the device — is the half that is published.

### ⭐⭐⭐ What publishing is FOR changed, on the evidence, before a line was written

> *"even though 3 of my friends are IT professionals they are the most busy people… They are not
> lazy but overworked. So most of the reviewers are 'normal' people."*

The plan had assumed publication buys an **audit**. It does not: nobody in this panel is going to
read 125 files. What it buys is that *"not open source, so it cannot be proven"* stops being
unanswerable — and what an overworked reviewer will actually spend is **thirty seconds, once**.

➡️ **A VERIFICATION THAT TAKES THIRTY SECONDS BEATS AN AUDIT NOBODY HAS A WEEKEND FOR.** So the
public README leads with one command that compares every served file against `haamu.app`, not with
a tour of the source tree. It is possible only because `src/` has no build step (ARCHITECTURE §7.1,
and the reason it was a release blocker was never this) — and `dist/` is **committed in the public
repository though gitignored in the private one**, so the three WASM artefacts cost a hash to check
rather than a Rust toolchain. Three tiers, each cheaper than the last: hash the live bytes, diff
the published bytes, rebuild from pinned source.

### ⚠️ The README's own headline command failed on its first run, and neither cause was a fault

Go's `http.FileServer` answers `app/index.html` with a **301** to `app/`, and **an empty body has a
perfectly good hash** — so a content-only comparison reports a missing file as one that merely
"differs". The command now checks the status code before the bytes and follows the redirect, and
says why in the README, because the reader who pastes it needs to know which failures are real.
➡️ **A verification offered to a stranger has to be run as a stranger would run it.** Ours had only
ever run from a directory that also contained the server.

### ⭐⭐⭐ And the finding of the day: the anti-orphan guard was one line from exempting itself

`test/suite.mjs` exists because `test/theme.mjs` was green for three days while nothing invoked it
(D-154). In the published tree it **crashed**: it reads `../../e2e.sh`, and `e2e.sh` is not
published because the server is not. The obvious repair — tolerate a missing `e2e.sh` — is the
trap, and it is the same shape one level out:

> ⚠️⚠️ **Inferring "this must be the published client" from ONE missing file means that file going
> missing FROM THE MONOREPO silently exempts every end-to-end suite** — the guard quietly weakening
> at the exact moment it should shout.

So the tree's shape is **asserted, not inferred**: a tree has a server *and* an `e2e.sh`, or
neither, and anything else fails loudly. The exemption is then exactly the size of the absence —
only `e2e-*.mjs`, only where earned — so a *non*-e2e test that loses its runner line still fails in
the public repository, which is the one place a stranger runs `./test.sh` first.

**Both new checks were mutation-tested and both failed as required**: hiding `e2e.sh` from the
monorepo failed the shape check rather than silently exempting six suites, and commenting out
`node test/roster.mjs` in the published clone was caught by name. ⭐ `test.sh` itself also had to
learn the difference between *"the cross-implementation check cannot run here"* (published client —
report it and **exit 0**) and *"this machine has no Go"* (monorepo — still exit 1). A reviewer who
pastes `./test.sh` must not be told the suite failed when every client suite passed.

➡️ **A GUARD MEETS ITS FIRST STRANGER IN THE REPOSITORY IT WAS NOT WRITTEN IN.**


### D-159. ⭐⭐⭐⭐ The switch — and a check of my own that passed its mutation twice

**2026-08-24, step 4 of four, and the last.** Steps 1–3 shipped the language decision, the 308
Finnish sentences and the mechanism that puts them into `ui/copy.js`. **Nothing was wired to
anything**, deliberately: a page that stamps `lang="fi"` while every sentence on it is English is
worse than one that admits it is English. This wires it, and `haamu.app` has spoken Finnish since
`d3cbcfdaee75cd15`.

**Four lines of product, and one of them is not a line at all.**

1. `app/index.html` loads `app/lang-boot.js` in `<head>` — the language is decided **before the
   first paint**, because `app.css` now drops the masthead gloss on `html[lang="fi"]` and an
   attribute stamped later would show *haamu is Finnish for ghost* and then take it away. It is
   the one sentence **removed rather than translated**: it exists to explain the name to somebody
   who does not speak the language, and Hannu ruled it out of the Finnish entirely.
2. `app.js` calls `setLanguage()` at boot, before a sentence is written. `setLanguage("en")` costs
   nothing — `copy-language.js` returns at its first line when asked for what it already holds —
   which matters, because most visitors are English.
3. ⭐ **The hundred and twenty static `text()` calls became `paintCopy()`.** They were statements
   at module top level, which was right while the product had one language: a sentence written
   once is a sentence for the life of the document. The copy objects are mutable now, so every one
   of those lines is a **rendering** rather than a statement, and the control has to run them
   again. ⚠️ `langs.apply()` is called there too, next to `setLanguage`, even though the boot
   script already stamped the same value — not as a second opinion but as the opposite: the
   sentences and `<html lang>` now come from **one variable in one statement pair**, so a drift
   between the two implementations of the decision is a flash of the gloss instead of a screen
   reader reading Finnish aloud in an English voice.
4. The control, in the ⋮ menu beside the colours. ⚠️⚠️ **It never reloads.** `K_master` is in
   memory and nowhere else, so `location.reload()` would end the session and ask a signed-in
   person for their eight words *because they pressed a menu item*. `test/lang.mjs` asserts the
   absence of every form of navigation in `switchTo`, and the browser probe proves it from
   outside: a marker set on `window` before the press is still there after it.

⭐⭐ **The two options are the only strings in the product that are the same in both languages, and
that is the design.** A person reaching for this control is by definition somebody who cannot read
the language on the screen — that is why they are looking for it. Translating the options writes
the one word they need in the one language they cannot read: a Finn on an English page hunting for
*Suomi* and finding *Finnish*. Each language is named in itself. `test/copy-fi.mjs` exempts the
four identical strings **by path and by value**, so an exemption stops applying the moment the
sentence under it changes.

⭐⭐⭐ **`RERENDER` — one entry per screen, and `null` is an answer rather than a gap.** `paintCopy()`
owns most of the product, but **seventy-three element ids are written somewhere else**, when a
screen is entered or an event lands. A switch that repainted only the static block would leave
those seventy-three in the language the reader has just said they cannot read — *and leave them
looking finished*. ➡️ **A SCREEN WITH NO ENTRY WOULD HAVE NO HOME TO BE REVIEWED IN** — D-156's
finding one layer out. So the table is exhaustive over `SCREENS`, `test/lang.mjs` fails if the two
disagree, and `only()` hides the control on the seven screens that answer `null`. Each says why,
and one of them is a **real fault rather than caution**: `steps` holds the *rendered strings* and
`markStep` finds the current one with `steps.indexOf`, so a switch mid-pairing would silently
unhighlight every step. Keying the steps by name belongs to whoever next touches §3.

⚠️⚠️⚠️ **AND THE FINDING OF THE DAY IS ABOUT MY OWN NEW CHECK, WHICH PASSED ITS MUTATION TWICE.**
The all-or-nothing guard needed a fourth half for `app/ended.js`. I wrote it, commented the call
out, and watched it go on passing:

1. `/setLanguage\(/.test(src)` — satisfied by the **import line**, and by a call with `//` in front
   of it. That is D-154's mention-versus-invocation exactly, one day old, in code I had written
   that hour. Knowing the lesson did not stop me writing the bug; running the mutation did.
2. The same thing with comments and imports excluded — **still passed**, because `switchTo()`
   calls `setLanguage` too. The file went on containing an invocation while the one that mattered
   had gone. ➡️ **A CHECK THAT ASKS WHETHER A CALL EXISTS CANNOT TELL YOU WHETHER THE CALL THAT
   MATTERS EXISTS.** It anchors on column zero now: the boot call is at module top level in both
   files and every other call in the product is inside a function, so the indentation *is* the
   difference between "this document is put into its language as it opens" and "something,
   somewhere, can change the language".

⭐⭐⭐ **`app/ended.html` was the last English page, and nothing could have found it.** §7.8 step 4's
landing page: nothing links there, and the only way to reach it is to end a session and mean it —
so it appears in no walkthrough, no screenshot and no round of feedback. A Finn would have read the
whole product in Finnish and then been told **in English** what had just happened to their
conversations. ➡️ **A PAGE YOU CAN ONLY REACH BY DESTROYING SOMETHING IS A PAGE NOBODY REVIEWS.**
It needs no boot script, and the difference is real rather than an omission: it has no gloss and no
static sentence at all — both panels are empty until the module fills them — so nothing can flash
and a deferred module is early enough.

⚠️ **The probe reported four failures with nothing wrong.** Its ending-page section ran in the same
browser profile as its control section, whose last act was to press *English* — so `resolve()`
found a **stored choice** and correctly returned English to a Finnish browser. The product was
right and the instrument was wrong. ➡️ **A PROBE THAT INHERITS STATE FROM THE PROBE BEFORE IT IS
TESTING A SITUATION NOBODY CHOSE.** That ordering is now a deliberate check of its own.

⭐ **And D-154's own probe was written to fail.** `probe-d154-live.mjs`'s last four checks asserted
the deliberately-unwired state as *the current truth* rather than as a TODO, so that a run of it
said which step the live site was on. It was used exactly that way: deploy, run, read four
failures as the confirmation, then reverse them. Anything that un-wires the switch fails there
from the other side.

**Deployed 2026-08-24**, client only, in the order the *mix* requires rather than the order the
endpoint requires — `haamu.app` sends `no-store` and has no service worker, so a page loading
mid-deploy is assembled from old and new files. `copy.js` → `copy.fi.js` → `app.css` →
**`index.html` → `app.js`** → `ended.js` → `build.js`. The markup goes before the caller: new
`app.js` against old `index.html` cannot find `#lang-en` and the application does not boot, while
old `app.js` against new `index.html` merely stamps `lang="fi"` over English text for a few
seconds. 1084 checks green, 68 browser assertions green against production, 62 served files
byte-compared over HTTPS with 0 wrong. Rollback at `/root/lpm-rollback-d2301fa/`.

### D-158. ⭐⭐⭐⭐ haamu in Finnish — 308 sentences, and a switch that replaces them in place rather than 282 call sites

**2026-08-23, step 2 of shipping the Finnish.** The translation existed as a JSON sheet and six
Python layers in `lpm-probes`, which is a review artefact and not a product. This makes it one.

**`client/src/ui/copy.fi.js`** — 285 sentences and 13 functions, flat, keyed by the same path
`copy.js` keeps each one under and the same key twenty-seven rounds of review used. Generated once
from the merged layers and then verified back against them: 308 renderings, 0 differences. From
its first commit **the Finnish has one home, exactly as the English has one**; the layers are
history and the generator writes to a scratch path so it can never be run over a hand edit, which
is how a repair was lost once already.

⭐⭐ **THE NUMBERS ARE TYPED IN THE FINNISH, AND THAT IS THE INTERESTING DECISION.** Every number
in `copy.js` is interpolated from its constant, because prose that describes a constant is checked
by nothing. `copy.fi.js` does the opposite — *"7 päivää"*, *"16 merkkiä"*, *"30 minuutin"* — and
gets the same guarantee more cheaply: **the gate requires every number in a Finnish sentence to
agree with the number in the English sentence at the same path.** The Finnish cannot drift from the
constant because it cannot drift from the English, which cannot drift from the constant. And a Finn
reviewing the translation reads sentences instead of `${plural(days(QUARANTINE_DAYS))}`.

⚠️ Time units are normalised to seconds before comparing, because the English says *"1 day"* where
the Finnish says *"24 h"* — the same constant, and a choice the Finnish reviewers made because
*päivä* is also the daylight half of one. Comparing digits would fail a translation that is exactly
right; comparing durations still fails the moment the constant moves.

⭐⭐⭐ **AND IT MEANS THE FINNISH INHERITS D-153 WITH NO FINNISH IN THE RULE.** The obvious way to
check *a quantity is a digit* in the second language is a list of Finnish numerals, and it is a
trap twice over: they inflect, so the list is of *kahden*, *kolmella*, *neljäntoista*; and **a
Finnish stem is not a word**, so `yhte-` collects *yhteys* (connection) and *yhteystiedot*
(contacts) beside *yhtä*. The first draft reported four sentences for numerals none of them
contained. The agreement check already says it: a spelled Finnish number is a number the English
has and the Finnish does not.

⚠️⚠️ **THE STEM TRAP CAUGHT ME THREE TIMES IN ONE FILE**, and the third one is the one to remember.
A ported forbidden-claims pattern, `/nollat(a|aan|tu)/` for §7.7's zeroization, fired on

> *"…eikä mitään tapaa **nollata** sitä"* — which translates *"and no way to **reset** it."*

**Nollata is Finnish for both "zero" and "reset".** ➡️ **A word that translates one English word in
one sentence translates a different one in the next**, so a rule ported by its verb finds sentences
that say something else. The pattern carries the object now. Same for `takaa`, which is *guarantees*
and also the postposition *from behind* — and *AVAIMESI takaa* is on half the screens in this
product.

**The switch.** `client/src/ui/copy-language.js`. `import * as copy` gives a namespace whose
PROPERTIES are read-only and whose OBJECTS are not: `copy.chat = …` is refused by the language,
`copy.chat.send = …` is an ordinary write. Every sentence lives under one of the twenty-two object
exports — checked, not assumed — so all 282 call sites are untouched. ⚠️ The alternative, a
`t("path")` lookup, is the right shape for a product designed bilingual and the wrong one here: it
means editing 282 lines of `app.js` to ship a translation, and **every one of them is a chance to
put the wrong sentence on a screen** in a product where the sentences are warnings.

⚠️⚠️ **THE ENGLISH IS CAPTURED ON THE WAY PAST, WHICH IS WHAT MAKES IT REVERSIBLE — AND REVERSIBLE
WITHOUT A RELOAD IS THE WHOLE POINT.** `K_master` is in memory and nowhere else, so a reload asks a
signed-in person for their eight words again: a language toggle that logs you out is not a language
toggle. Everything is synchronous and in-memory for that reason, and the gate switches three times
each way, because a switch that only works once has captured the Finnish as though it were the
English.

⭐ **The payload is measured, not asserted.** `copy.fi.js` is 44 KB on disk and **14.5 KB over the
wire** (Caddy gzips this tree; `copy.js` beside it is 58 KB compressed), and `haamu.app` sends
`cache-control: no-store`, so it is paid on every load. A dynamic `import()` would spend nothing on
an English reader — and is deliberately not what this does, because the people this round is for
are the Finnish ones, and because it would put an `await` in the boot path and in the switch, the
two places D-154 spent its effort keeping free of a flash. The number to beat is written in the
file.

**Still not wired, and now three ways at once.** `test/lang.mjs`'s all-or-nothing check has a third
half: the boot script, the `html[lang="fi"]` CSS rule and the call that translates the copy must be
in one state. All three false today. ⚠️ **The thing that remembers has to be the thing that fails.**

⭐⭐ **And one more instrument, from D-154's own lesson.** `test/suite.mjs` asserts that every file
in `test/` importing the harness is *invoked* by `test.sh` or `e2e.sh` — the failure that let
`theme.mjs` pass eighteen checks for three days while nothing ran it. ⚠️⚠️ Its first version asked
`runners.includes(name)` and **the mutation test did not fail**: commenting out `node
test/theme.mjs` left the words in the file, so the check was satisfied by a MENTION rather than by
an INVOCATION — the same distinction it exists to make, one level in, and not hypothetical, since
both runners have comments naming test files. It matches the line that runs it now. One file
exempts itself, by the words **RUN ONCE** in its own header rather than by being listed:
`gen-vectors.mjs` must not be re-run, and that is the one thing its header forbids.

### D-158a. His read of the thirteen: the Finnish singular says less than the English

**2026-08-24.** He read the thirteen runtime-built sentences — the one thing he had agreed to
check — and changed exactly one word's worth of one of them:

> *"This does not need `sinä` and can be `1 keskustelu ei voi vastaanottaa, ennen kuin lähetät
> viestin.` Otherwise the 13 sentences were correct."*

The English singular is *"until you send a message **in it**"*; the Finnish had *lähetät **siinä**
viestin* and now stops at *lähetät viestin*. ⭐ At one conversation there is nowhere else the
message could go, and Finnish does not need the locative to say so. **The plural keeps *kussakin
niistä***, because at three, *"send a message"* without *"in each of them"* is a different
instruction — the ruling was about the singular and applies there.

➡️ **THE TWO BRANCHES ARE NO LONGER A TRANSLATION OF THE SAME SHAPE, AND THAT IS THE POINT.** The
version he corrected was built by mirroring the English clause for clause, on the reasoning that
the English distinguishes *in it* from *in each* deliberately — true of the English, and not a
reason for Finnish to carry a word it does not need. **A sentence that mirrors its source clause
for clause is a sentence written in the source language with the target language's words.** The
gate cannot see this: nothing it checks compares clause structure, and nothing should.

⚠️ Twelve of thirteen passed unchanged, which is the first time a Finnish round has come back
nearly clean — and the reason is worth recording: these were written as GRAMMAR rather than
translated as sentences, from rules (nominative at one, partitive above; genitive before a
postposition) rather than from a source string. The one correction was not a grammar error.

### D-157. ⭐⭐ Two paths to one sentence — D-152 fixed that shape in the instrument and left it standing in the module

**2026-08-23, the last thing before the Finnish content.** §5.2's clock warning was reachable two
ways: `copy.clockSkew(seconds)`, exported at the foot of `copy.js`, and
`copy.roster.failure.clock_skew(seconds)`, which is a one-line arrow that calls it. `app.js` used
the first from the chat view and the second from the unlock and list screens.

**That is D-149's defect exactly** — *a sentence that appears on two screens is one sentence with
two homes* — and D-152 found it, wrote it down, and fixed **the copy of it in the review
instrument**: `extract-copy-en.mjs` was pulling the same sentence out under two paths and
translating it twice. The fix there was an `ALIASES` set naming `clockSkew` so the walker would
skip it. ⚠️⚠️ **A workaround that hides a duplicate is not a fix for the duplicate**, and the one
in the module went on standing, with a comment explaining why it was fine.

⭐ **The Finnish is what made it load-bearing.** The language override reaches sentences by path.
An export that no path names is a sentence the override cannot see — so `copy.clockSkew` would
have gone on saying *"This device's clock is about 3 minutes ahead of the server"* on a page
otherwise entirely in Finnish, on the one screen a person reaches while something is already
wrong. The only reason it had not caused a defect yet is that there was no second language to lose
it in. ➡️ **A duplicate is harmless exactly until something has to enumerate the originals.**

`clockSkew` is private now; `roster.failure.clock_skew` is the one path in; `app.js` calls it
there. The gate's old check compared the two exports for equality — a check that two homes agree,
which is the wrong question — and now asserts instead that nothing outside `copy.js` can name the
private one. `ALIASES` is kept and empty, because an empty set is an invitation to ask why rather
than to add to it. ⚠️ The extracted sheet is byte-identical before and after, which is what a
refactor should be able to prove.

### D-156. ⭐⭐⭐⭐ The completeness check counted paths, and a reader meets branches — "298 of 298" was a true statement about the wrong population

**2026-08-23, still opening step 2.** D-155 looked at what the gate could not see about a
sentence. This looks at what neither the gate nor twenty-seven rounds of review could see about a
sentence's *other forms*.

`copy.js` has thirteen sentences assembled at runtime, and several of them branch: a singular
form, a plural form, or — in one case — a different sentence entirely. **The review sheet rendered
each PATH once, with one sample argument.** So the translation closed at *"298 of 298 strings, no
Finnish missing"*, `build-copy-fi.py` printed `problems: 0`, and both were telling the truth about
a population that leaves out ten of the sentences a person can actually be shown:

| never on any sheet | why it was invisible |
|---|---|
| *"no more sets — pick one of these"* | `phrase.setsLeft` was sampled at 4, never at 0 — and this is not a variant of anything, it is its own sentence |
| *"1 conversation is missing from the list…"* | `list.unexplained` sampled at 2 |
| *"1 conversation cannot receive…"* | `chat.reconnect.some` sampled at 3 |
| *"…with 1 conversation."* | `list.noHistory` sampled at 4 |
| *"1 conversation deleted, and the other person was told in 1 of them."* | `panic.told` sampled at (3, 5) |
| *"…about 2 hours **behind** the server…"* | `clock_skew` sampled at +200 seconds: one unit, one direction, of four |

⚠️⚠️ **AND ONE OF THEM WAS WRONG IN ENGLISH, ON WHAT IS ALMOST CERTAINLY ITS COMMONEST READING.**
`deletion.suspect` had no singular branch at all, so §7.3.1a's quarantine notice read

> ***"1 conversations were deleted from another device."***

`renderQuarantine` passes `pending.length`, and one conversation deleted from one other device is
the ordinary shape of that event. ➡️ **The branch nobody had ever rendered was the branch nearly
everybody sees.** It survived the tester round, twenty-seven translation rounds, two Finnish
readers and 198 checks, because every instrument pointed at it rendered it at n = 3.

➡️ **A BRANCH NO SAMPLE ARGUMENT REACHES HAS NO HOME TO BE REVIEWED IN.** That is D-151's finding
— *a missing sentence has no home to be reviewed in* — one level down: there the sentence did not
exist, here it exists, ships, and is unreachable by the instrument. ⭐ And it is D-155's shape
again in a third place: the check was true of what it measured and the measurement was of
something nobody had chosen.

**What is in place now.** `client/test/samples.mjs`, a new file with one job:

- `SAMPLES` — the argument lists per path, **owned in the client tree and imported by both
  consumers**. `test/copy.mjs` renders every prose rule over them, so the forbidden-claims scan,
  D-016b's "they" allowlist and D-155's spelled-quantity check now see the *behind* branch for the
  first time. `extract-copy-en.mjs` builds the translators' sheet from the same table. ⭐ What a
  reviewer is shown and what the gate checks are the same set of sentences, or the build fails.
- `literalsOf(fn)` — a function's own static text, read off `fn.toString()` and split on the
  template's `${…}` holes. **A branch is a different string literal**, so a literal that appears
  in none of the renderings is a branch no sample reaches — coverage without a coverage tool.
  ⚠️ Double-quoted strings only: an apostrophe inside a template (*"This device's clock"*) makes a
  single-quote scanner invent a literal spanning half the sentence and report it unreached
  forever. The codebase is double-quoted throughout, so the failure direction is a missed literal
  rather than a false one.
- `coverage()` — returns unreached text, functions with no samples, and samples for a path that is
  gone. All three are checked, and the extractor refuses to emit a sheet when any is non-empty.

The sheet is 308 rows where it was 298, and `build-copy-fi.py` now reports the ten missing Finnish
sentences it had been silent about. ⚠️ Mutation-tested before being believed, per D-154: adding an
unreachable ternary to `list.unnamedOn` failed the coverage check, and deleting its sample entry
failed the missing-samples check. Restores proved with `sha256sum`.

### D-155. ⭐⭐⭐ A sweep for the mechanism is not a sweep for the rule — D-153's ruling had never been checked in the direction it was made

**2026-08-23, opening step 2 of the Finnish.** Before writing ~300 Finnish sentences the gate they
would pass through was worth a look, because the Finnish will inherit whatever the English gate
cannot see. It could not see this.

**D-153 ruled that a quantity is a digit, in both languages.** The only check in `test/copy.mjs`
that is about numbers is the stray-digit scan, and it enforces the *opposite* direction: no digit
that a constant did not put there. ⚠️⚠️ **Nothing checked that a quantity is a digit.** A number
written out as a word — the exact thing the ruling forbids — passed every one of the 195 checks.

⭐⭐⭐ **And one had been passing for three days.** `chat.reconnect.some` renders

> *"One conversation cannot receive until you send a message in it."*

at n = 1, and `` `${n} conversations cannot receive…` `` at every other n. One sentence, two
notations, chosen by the reader's own number — which is **word for word the defect D-153 was
about**, still live in the round that fixed it.

➡️ **THE REASON IT SURVIVED IS THE FINDING.** D-153 swept by searching for `spell(`, the helper
that had been doing the spelling, and repaired all 32 of its call sites. This branch had never
called it: the plural half already interpolated `${n}`, and the singular half was a word somebody
typed by hand in D-130, months earlier. **Deleting the helper made the rule true everywhere the
helper had been, and nowhere else.** A sweep for the mechanism is not a sweep for the rule — and
the population it lands on is chosen by the mechanism's history, which is to say by nobody.

It is D-153's own lesson one turn further out. That round learned *a check can pass on a property
nobody chose*; this one is the same sentence with **fix** in place of **check**.

**What the gate does now.** Two checks, deliberately not one:

1. **No sentence spells a quantity** — the words *two* … *hundred*, over every rendered string.
   ⭐ One exemption, and it is a NAME rather than a count: Hannu ruled the verification check is
   called **six digits** and stays spelled. It is exempted as the PHRASE, so a future *"six days"*
   is still caught; exempting the word would have opened the whole numeral.
2. **A sentence BUILT from a count does not spell it "one" either** — restricted to built
   sentences, because "one" is a different word in a fixed one. *"only one tab"*, *"pick one of
   these"*, *"a new one"*: forty of them, all the determiner sense Hannu's ruling explicitly
   leaves alone, and an allowlist of forty is longer than the rule it protects. In a sentence
   assembled from a count there is no ambiguity — the number is the subject by construction. That
   split is what `everySentence()`'s new third element, `"typed"` or `"built"`, exists for.

Three exemptions in check 2, each matched on its surrounding words rather than on the number, so
that rewording the sentence makes it stray again — the discipline D-152 paid for when an exemption
outlived its subject.

⚠️ **Both checks were mutation-tested before being believed**, which is D-154's rule: putting the
spelled singular back failed check 2, and typing *"Kept for seven days"* into
`deletion.quarantineWindow` failed check 1. A check nobody has watched fail is a check nobody has
tested. Each restore was proven with `sha256sum` against a copy, never `git checkout`.

⭐ **Why this is the right first move of step 2 rather than a detour.** The Finnish half of the
gate is step 3, and it will be built by pointing the same rules at the second language — where the
worklist's own regex already found 40 spelled numerals. Writing the content first and the rule
afterwards is how you get a translation that agrees with a gate written to accept it.

### D-154. The interface language, built as a copy of the theme — and a guard that had never once run

**2026-08-23, step 1 of shipping the Finnish.** The translation has been complete for two days
(298/298) and deployed nowhere: `haamu.app` is `<html lang="en">`, `/fi` 404s, and the only
Finnish byte on the site is the masthead gloss. Hannu went looking for it on the live site —
*"how do I get to the finnish version of haamu.app, I did not notice a link etc choice?"* — and
then made the product call:

> *"the ones that are not fluent go past words they do not understand and just click forward.
> That is typical human behaviour… they are normal lazy people who try to be as productive as
> they can… My estimate: the feedback without Finnish language may be even 75% less in volume."*

⭐ **The language is part of the instrument, not polish on it.** Every sentence in this product
is a warning, a consequence or a promise — exactly the sentences a non-fluent reader skips. So
English in the friends round would not merely reduce the feedback, it would change its KIND:
complaints about buttons instead of whether the security story lands.

#### ⭐⭐ Why this is allowed to exist at all, given §0

`PROTOCOL.md` §0 says that an implementation needing a construction the spec does not contain is
a signal the spec is wrong — stop and ask, do not invent. The spec says nothing about language.

**But it says nothing about the theme either, and `ui/theme.js` has been here since D-139.** A
remembered interface preference with all four hard parts already answered: where it is stored,
what happens when the browser refuses storage, what Ghost mode does with it, and which of §7.8's
two endings takes it. ➡️ So `src/ui/lang.js` is a **copy of an existing shape**, not a new
construction, and every departure from `theme.js` is marked in the file with its reason. **I
nearly missed this by measuring the wrong thing** — I first told Hannu there was "no locale
mechanism at all", which was true of i18n and false of the question that mattered, *is there a
remembered interface preference*.

#### The four inputs, in order, and the two that are not obvious

1. **A choice made in this document** — the most recent thing the person did.
2. **The address.** `/fi` beats a stored choice.
3. **The stored choice.**
4. **The browser's own list**, then English.

⭐ **`/fi` is Hannu's, and it is not tidiness.** He wants a plain thing he can paste into a
message so that *a Finn holding a phone set to English* still lands in Finnish — precisely the
case sniffing `navigator.languages` cannot serve, because there the browser is the thing that is
wrong about the reader. It is a **server route**, not a redirect: a redirect would mean the
address he pastes is not the address his friend ends up on. `/fi/` answers too — somebody
retyping an address from a message adds a trailing slash about as often as not, and a 404 there
is the whole feature failing in the one situation it exists for.

⚠️ **The address beats the stored choice, and does not overwrite it.** The address was tapped
just now; the stored choice was made at some earlier time. Not overwriting is what makes the link
safe to send to anybody: it works the same way whatever the reader already has, and coming back
through the front door returns them to their own choice. The one place those two can contradict
each other is handled where it happens — choosing *English* while standing on `/fi` drops the
`/fi` with `history.replaceState`, ⚠️ **never a navigation, because a reload throws away
`K_master` and asks a signed-in person for their eight words again.**

#### Three departures from `theme.js`, all deliberate

| | |
|---|---|
| **Two choices, not three** | The theme offers "follow the phone" because dark mode follows the time of day and a person may want to be dragged along. **A language does not change at dusk.** Nobody thinks *I would like to follow my browser*; they think *English* or *Suomi*. The absence of a stored value is the state before a choice, not a choice. |
| **The in-document choice is set on the ordinary path too** | In `theme.js` a non-Ghost choice clears `volatile` and lets storage answer later reads. Here that is a bug, because storage is not the only other input: somebody pressing *English* on `/fi` would be answered by the ADDRESS on the very next read. |
| **It touches the address bar** | See above. `theme.js` has nothing to correct. |

#### ⚠️⚠️ `fil` is Filipino

`startsWith("fi")` is the obvious line and it hands every Filipino phone — some 45 million
speakers — a Finnish interface. BCP 47 delimits subtags with `-`, so the test is `fi` exactly or
a tag beginning `fi-`. It is in the matrix below **because it is the line both files would
otherwise have contained.**

#### ⭐⭐⭐ The guard had to be a different KIND of guard, because the duplication is bigger

`app/lang-boot.js` exists for `app/theme-boot.js`'s three reasons — §6's `script-src 'self'`, the
Go CSP test that fails the build on any `<script>` without a `src`, and `type="module"` being
deferred by definition. But what it duplicates is not a string. **`theme-boot.js` copies one
literal, so `test/theme.mjs` compares two literals and is done. `lang-boot.js` copies a DECISION**
— four inputs, a deliberate order, a delimiter test inside one of them — **and two implementations
of a decision can agree on every literal in both files and still disagree on an answer.**

So `test/lang.mjs` does not compare text. It wraps the boot script's source in a function with
`location`, `localStorage`, `navigator` and `document` as parameters, runs it and the module
against **the same 576 situations** (8 stored states × 8 addresses × 9 browsers), and fails on any
disagreement. Both classes of drift were confirmed catchable by mutation before the file was
trusted: replacing the delimiter test with a prefix test fails it, and demoting the address below
storage fails it.

⭐ And the count in that sentence is not prose. Both source files state the size of the matrix in
a comment, and the test asserts both against the number the code computes — D-153's lesson, one
layer down: a count written into a comment is a copy of a decision made somewhere else.

#### ⛔⛔ The finding: `test/theme.mjs` had never been run

Added 2026-08-20 with D-139 and referenced by **no script, no CI job and no document** — not
`client/test.sh`, not the Go build, nowhere. It passes (18 checks), and it has passed unobserved
for three days while guarding two things whose whole documented danger is that they fail
*silently*: a `THEME_KEY` that drifts stops finding the preference and looks exactly like never
having set one, and a dark palette written out twice gives two different dark themes depending on
whether the person used the switch.

➡️ **A guard that is never invoked is not a weaker guard than one that is; it is the same as not
having written it.** Found only by going to add the line beside it. Both are now in `test.sh`.
See `feedback_verify_before_claiming`.

#### What this decision does NOT yet include

The mechanism only. `app/index.html` does **not** load the boot script yet and `app.css` does not
know what `lang="fi"` means, because `ui/copy.js` has no Finnish in it — **a page that stamps
`lang="fi"` while every sentence on it is English is worse than a page that admits it is
English.** ⭐ So `test/lang.mjs` asserts the two halves are in the *same state* rather than
asserting they are wired: neither passes, both passes, one alone fails. The remaining steps are
the Finnish content, the Finnish half of the copy gate (Finnish will not ship ungated), and the
switch.

### D-153. ⭐⭐⭐⭐⭐ A quantity is a digit — and the check that was supposed to catch typed numbers had been passing because of the spelling, not because of the rule

**2026-08-23, the day after D-151 and D-152, and it undoes half of D-152.** Asked how the
Finnish should spell its number words, Hannu answered about both languages at once:

> *"I would suggest that numbers or amounts in text are written with numbers not letters.
> Like: there are 3 messages waiting, 2 conversation were deleted. 6 digits need to be
> checked. Nobody will complain about that. At least in Finnish but I think that would be
> better like that also in english. That would be understandable and faster readable to
> everyone. I strongly recommend using numbers instead of words to describe amounts."*

`ui/copy.js` (the `WORD` lookup and `spell` deleted, `caps` deleted with them, 32 rendered
sentences changed, three reworded), `test/copy.mjs` (195 checks from 193, and one of them
rebuilt from scratch), the extractor's helper set.

#### ⭐⭐ He had already ruled this once, in round 6, for one screen

The gate paragraph was changed then to render its word count as a digit — *"8 words"* —
and the reasoning was written into `test/copy.mjs`: *"these four are scanned rather than
read, and '8' survives a glance where 'eight' does not."* Nothing carried it anywhere
else. So for months the product said **8 words** on the opening page and ***Ten words*** in
the phrase note: one kind of fact, two notations, decided by which round happened to touch
which screen.

➡️ **A RULING APPLIED WHERE IT WAS MADE AND NOWHERE ELSE IS A RULING THAT HAS NOT BEEN
APPLIED.** Round 6 recorded its reasoning carefully and scoped it to the sentence in front
of it, which is exactly how a house rule fails to become one.

#### ⭐⭐ And the lookup table was already broken, for counts specifically

`WORD` held 0–16, 20, 30, 45, 60 — *"every entry is here because some constant in this
build currently lands on it"* — and fell through to `String(n)` for anything else. The
comment defending that fall-through was written about **constants**, where it is true: a
threshold somebody edits either has a word or obviously does not.

It was never true of a **count**. `list.unexplained` takes however many conversations are
actually missing. So the product said *"Sixteen conversations are missing"* at sixteen and
*"17 conversations are missing"* at seventeen — one sentence, two forms, and which form a
person met was decided by the size of their own number. Both are correct English, which is
why no review would ever have caught it; there was no wrong sentence to find.

➡️ **A JUSTIFICATION WRITTEN ABOUT ONE KIND OF INPUT QUIETLY COVERS EVERY KIND OF INPUT.**
The same shape as D-152's exemption comment, one day later and in the same file.

#### ⭐⭐⭐ The finding: the stray-digit check was passing for the wrong reason

`test/copy.mjs` has carried a check since §8 — *"no digit is typed into a sentence that a
constant did not put there"* — and its comment said it scanned **the literal strings only**,
because *"a template's digits arrive from its caller by construction."*

That was not what it did. It walked the **evaluated module**, where a template literal has
already become an ordinary string: `lock.idle` arrived as finished prose carrying no record
of where its number came from. The check could not make the distinction its own name
claimed. It passed anyway — because every interpolated number was a WORD, so no digit ever
reached the scan.

**The spelling was doing the discriminating.** Removing it failed the check 22 times in one
run, which is the first time the check told the truth about itself.

➡️ **A CHECK CAN PASS FOR YEARS ON A PROPERTY NOBODY CHOSE, AND CHANGING THAT PROPERTY IS
THE ONLY WAY TO FIND OUT.** The give-away was in writing the whole time: a comment that
describes a mechanism the code does not have.

It now reads the **source** of `copy.js` with a scanner that removes `${…}` regions, so a
digit a constant put there is absent from what it reads and a digit somebody typed is
present. That is the actual rule, tested directly, and it no longer depends on notation.
Two smaller things fell out of writing it: `\b` matters (without it the scan reports the 2
in *"Argon2id"*), and an exemption must match **the fragment, not the sentence** —
`codeShort` is built from two adjoining literals and the split falls between *"no code "*
and *"contains"*.

#### What it cost D-152, one day old

D-152 capitalised four warnings that opened on a lowercase number word. All four now open
on a digit, so the defect stays fixed and `caps` has no work left; it is deleted. The
capital/fragment distinction D-152 drew — warnings capitalised, `phrase.setsLeft` left
lowercase — has dissolved and is not re-asserted. D-152's real finding, the clock sentence
living outside the copy gate, is untouched.

➡️ **THE FIX WAS UNDONE AND THE FINDING WAS NOT.** Worth separating when a decision is
reversed this fast: what D-152 *found* was a defect nobody had seen in twenty-seven rounds;
what it *chose* was one of several repairs, and a better one arrived the next day.

#### The three sentences that could not be converted, and why

Making the computed numbers digits left typed number words beside them:
*"This invite link works once, for one person, for **1** day."* One fact, two notations,
inside one breath — the very shape the ruling removes — and the notation decided by which
half came from a constant, which is an accident rather than a decision.

Hannu was shown all three ways out and chose the one that **removes the collision instead
of ruling on it**: the person and the duration now say themselves in separate sentences.
*"This invite link works once, and only for the person you send it to. It lasts 1 day."*
The two facts testers got wrong — ONCE, and ONE PERSON — still lead the sentence.

He also ruled on the two edges: a typed count that answers *how many* becomes a digit
(*"2 devices disagreed"*, *"It holds 3 things"*), while **"six digits" stays written out**
— it is the name of the verification check, with its own glossary entry and a button, not
a count the reader acts on. And *"one"* meaning *a single* or *the one that* stays a word
throughout: *"Only one tab can work properly"*, *"pick one of these"*.

#### Why it matters beyond the notation

This was asked as a Finnish question and answered as a product one. A Finnish numeral
**inflects** — *kahden*, *kolmella* — so a Finnish word table would have had to carry
cases rather than words, in a language where a wrong case is not a style slip but a
different sentence. Deleting the number words removes the largest single obstacle to
the Finnish shipping at all, and it removes it from the English too.

### D-152. ⭐⭐⭐⭐⭐ The last sentence outside the copy gate was written twice and rendered two ways — and four warnings had opened with a small letter since the beginning

**2026-08-23, the same day as D-151 and answering the two questions it left him.
`ui/copy.js` (a helper, four strings capitalised, §5.2's sentence rewritten to take a
number), `flow/roster.js` and `flow/mailbox.js` (they stop writing English),
`app/app.js` (two call sites), `test/copy.mjs` (192 checks from 185),
`test/e2e-mailbox.mjs`, and the extractor, which lost a duplicate path.
Client suite and e2e green.**

⭐⭐⭐⭐ **§5.2's SENTENCE WAS THE ONE PIECE OF ENGLISH D-083 DID NOT COVER, AND IT EXISTED
IN TWO COPIES.** *"this device's clock is about three minutes ahead of the server, which
stops it connecting"* was built inside `flow/roster.js` and, byte for byte, inside
`flow/mailbox.js`. Nothing could have caught a drift between them, and **nothing had ever
reviewed either**: not the copy gate, not a contact sheet, not a term page, not the
translation — because every instrument this project owns reads that one module.
➡️ **A gate with one exception has no way to tell you the exception moved.**

⚠️⚠️ **AND THE TWO COPIES HAD ALREADY PRODUCED TWO SENTENCES ON TWO SCREENS.** On the
unlock and list screens `describeIdentity` handed the text to `clockSkew`, which
capitalised it and appended *"Set this device's clock to the right time…"*. Inside a
conversation, `app.js` printed `failure.message` raw: the same failure, lowercase, **with
no advice at all**. One sentence with two homes and two registers — D-149's class, hiding
in the one place D-149's instruments could not look. Hannu ruled that both screens say the
one thing. **The flow modules now carry `failure.skew`, a number in seconds, and every word
lives in `ui/copy.js`.** A new check reads both flow modules and `app.js` and fails if any
of them contains prose about a clock.

⭐⭐ **THE MOVE'S OWN CHECK IMMEDIATELY FOUND A SECOND DEFECT.** With the sentence inside
the module, the extractor emitted it **twice** — once as the top-level `clockSkew` export
and once through `roster.failure.clock_skew` — so the review sheet had carried the same
sentence under two paths and the Finnish had translated it twice, identically, by luck.
➡️ **Two paths for one sentence is two homes for one sentence, one layer down**: the same
defect in the instrument rather than in the product. 298 strings now, from 299.

⭐⭐⭐ **AND A DECLARED NUMBER IS SPELLED WHILE A MEASURED NUMBER IS A DIGIT.** The obvious
move on arrival was to run the offset through `spell`, like every other number in the file.
It is wrong: `WORD` is sparse **because every entry earns its place from a constant** — it
has sixteen and twenty and thirty and sixty and nothing between — so the same sentence
would read *"about three minutes"* at one reading and *"about 17 minutes"* at the next.
**Half words and half digits, unpredictably, is worse than either.** The offset prints as a
digit at every reading, and turns to hours above an hour so that a phone with the wrong
date does not report *"about 1440 minutes"*. Nothing is loosened: the stray-digit check
scans literal strings, and this digit arrives at runtime from a measurement.

⚠️ **THE e2e TEST WAS TESTING THE COPY AND NOBODY HAD NOTICED.** `test/e2e-mailbox.mjs` is
the only place in the project where §5.2's real path runs against a real `Date` header, and
its assertion read `failure.message` — so a test of the flow module was also the only test
of that sentence, in a file no copy instrument reads. It now checks the number on the
failure and the sentence `ui/copy.js` builds from it, separately. ➡️ **When a module writes
its own prose, its unit test silently becomes the copy review.**

⭐⭐ **FOUR SENTENCES HAD OPENED ON A LOWERCASE WORD SINCE THE BEGINNING, AND THE FINNISH
NEVER HAD.** `spell` returns a lowercase word and `deletion.suspect`, `list.unexplained`,
`panic.told` and `phrase.longPhraseNote` all start with one — *"three conversations were
deleted from another device."* Three of the four are warnings, and a warning that opens
small reads as the tail of something else to somebody skimming a list. **The Finnish had
capitalised all four by hand in its first draft**, so the two languages had disagreed about
this from the day the translation existed and nobody had compared them until D-150 put them
side by side. ⚠️ `phrase.setsLeft` is the control and stays lowercase — *"four more sets
available"* is a status fragment beside a control, not a sentence, and it is lowercase in
Finnish too. Both halves are pinned so that a future sweep can do neither.

### D-151. ⭐⭐⭐⭐⭐ Round 27: the second reading of a repaired sentence is a different sentence — and a control whose only reply was its refusal

**2026-08-23, hours after D-150. Hannu read what round 26 shipped and closed the translation
list with it: *"I think we do not need to go through this translation list anymore here. There
will anyway be other and more feedback once I have asked several friends to use haamu."*
`ui/copy.js` (four strings changed, two added), `app/app.js` + `app/index.html` (a behaviour
change, the first in this sequence of rounds), `test/copy.mjs` (two re-pointed, two added, one
allowlist entry — 185 from 183), two new probes, and `lpm-probes/fi-5.py` (eighteen Finnish
strings changed, two added). Client suite green; both probes pass.**

⭐⭐⭐⭐ **THE SAME TWO SENTENCES FAILED A THIRD READING, AND THE FAULT HAD MOVED.** D-150
took `deletion.trace` and `panic.keeps` off the screen they are not drawn on and put them
"behind your KEY". He read the repair and found what the repair now implied: *"it means that
the user could later check with the KEY when any conversation was deleted. But I do not think
that is possible."* He is right — nothing ever reads a tombstone back out. So the round-26
wording said WHERE truthfully and said RETRIEVABLE BY YOU by accident. ➡️ **The second
reading of a repaired sentence is a different sentence**, because the reader who takes it is
somebody who has already accepted the repair and is therefore looking somewhere new. D-150's
own lesson was that a disclosure can be true of the data and false of the word it uses; this
is that lesson one layer down, and the layer is where a repair puts it.

⚠️⚠️ **AND HIS REPAIR WAS ONE PHRASE FROM BEING THE FORBIDDEN ONE.** He proposed *"The date
of the deleted conversation is saved behind your key but it is not shown to anybody."* The
shape is his and it ships. *"Not shown to anybody"* does not: a reader takes it as **nobody
can ever see it**, and §7.3.1a exists because that is false — a roster compelled open shows
every one of these to whoever holds it, indefinitely, which is the whole reason the section
says the residual must be disclosed. It says **"It is not shown on any screen"**, which is
true, is narrower, and is the exact answer to the question he asked. `test/copy.mjs` now
forbids `anybody|anyone|nobody|no one` in either of the two. ⭐ **A user's correction can be
right about the defect and wrong about the fix**, and the register to keep is his.

⭐⭐⭐ **THE CONTROL WITH NO SUCCESS STATE, FOUND BY SOMEBODY ASKING WHAT IT WAS FOR.** *"I
have forgotten what is the purpose of this: nav.checkForChanges. I have never noticed anything
happening from pressing that?"* §7.3.3 case 5 fetched the roster, merged it, and redrew a list
that in the ordinary case is identical — so **the only reply the button had ever had was its
refusal**, `roster.failure.access_rule`, on a second press inside the hour. A control whose one
visible answer is an error teaches the person holding it that it is broken. Twenty-seven rounds
of copy review never reached it: ➡️ **a missing sentence has no home to be reviewed in.** Every
instrument this project has — the copy gate, the sheet, the term pages, the translation — reads
strings, and this defect was the absence of one. `nav.checked` and `nav.checkedChanged` are the
two outcomes, and all three replies now share `#check-note` beneath the button.

⚠️⚠️ **THE PROBE WRITTEN TO DEMONSTRATE THE COLLISION REFUTED IT.** The comment I wrote said
the refusal had been overwriting §7.3.2's weak-freshness notice in `#home-note`. §7.3.3's
once-an-hour is enforced **client-side, per device** (`lastUserCheck` in `flow/roster.js`), so a
browser new enough to be showing that notice has never checked and cannot be refused — the
probe set the collision up twice and got a success both times. What does collide is any check
that **fails**, which the rewritten probe produces by aborting the request, and which is now
measured: the notice survives. ➡️ **A mechanism I have not read is a mechanism I am describing
from its name**, and the description was in a comment that would have outlived me.

⭐⭐ **`chat.reconnect.why`'s LAST SENTENCE IS GONE ON THE THIRD ASKING.** He dropped it in
round 25 and D-148's note kept it because he had not complained; he dropped it again in round
26, that went back as a question, and he kept it; he met it a third time in Finnish and asked
for it out — *"I do not think they tell anything the user really has to know. And even I feel
those are difficult to fully grasp how that can be."* The argument for keeping it was that it
is the one fact the reader cannot discover for themselves. That was true and insufficient:
**a fact nobody can hold is not disclosed by being printed**, and the person who could not
hold it wrote the two sentences above it. Twice was evidence. **Three askings is the answer.**

⚠️ **FOUR SMALLER RULINGS, AND TWO OF THEM SPLIT THE LANGUAGES ON PURPOSE.** (1) `pairing.toCode`
now names the outcome as well as the situation — *"show a code I can read or send"*, both verbs
exact against `code.isOnce` — which is the one place the label rule bends, because what is
behind this button is a construction the product has never mentioned. (2) Finnish **lopeta**
replaces **päätä** in all eleven places, a call he delegated with his reasoning: *päättää* also
means to decide, *lopettaa* has one meaning, and the ending it names is final. One verb for one
act, including the intransitive forms. (3) The three-item list in `server.cannotRead` keeps its
semicolons in English, where the first item carries its own comma, and takes commas in Finnish,
where *eli* removes the clause that would have needed them — his rule, and the same divergence
as 24 h. (4) `product.what.1` keeps *identiteetti* in Finnish: he reversed his own round-26
ruling for this string and not for `unlock.notFound`, which is right — a KEY *being* an identity
on the welcome page is not the same sentence as a KEY *having* one on the screen where somebody
has just failed to get in.

### D-150. ⭐⭐⭐⭐⭐ Round 26: the review came back through a translation, and what it found was a disclosure that was true of the data and false of the word it used

**2026-08-23. Hannu's Finnish reviewers went through the whole 297-string sheet and returned
about thirty items. `ui/copy.js` (twenty strings), `test/copy.mjs` (three re-pointed, one
allowlist entry added, seven checks added — 183 from 178), and the Finnish sources in
`lpm-probes/`. Client suite green.**

⚠️ **THE ROUND'S SHAPE IS NEW AND IT IS THE POINT.** Rounds 18–25 were people looking at
screens. This one was people looking at *sentences in their own language*, with the English
underneath — and it found a different class. **A translation is a reading with no memory of
what the sentence was trying to say.** The reviewer cannot fill a gap from having watched it
being built, so a sentence that only works because you already know what it means fails
visibly. Five of the round's items are of that kind, and none of them could have been found
by rereading the English.

⭐⭐⭐ **THE DEEPEST ITEM WAS A QUESTION, NOT A CORRECTION.** *"I have not noticed that a
deleted conversation would remain in the list with some remark?"* Three sentences —
`deletion.trace`, `panic.keeps` and `roster.failure.roster_full` — said the LIST records a
deletion and the day. `openHome()` draws `roster.channels()`, and **a tombstone is not a
channel**: the record is real, permanent, 128 bits of `root_hash` plus a UTC day, merged to
every device — and it is drawn on no screen at all. So every one of the three was true of the
data and **false of the word it used for it**, and the word they used was the reader's word for
the screen in front of them.

➡️ **A DISCLOSURE CAN BE TRUE OF THE DATA AND FALSE OF THE WORD IT USES FOR IT.** No check
could catch this: §7.3.1a's requirement is that the residual be *stated*, and it was stated.
The three now say "stays behind your KEY" — naming where the record is rather than denying a
screen it is not on, which also avoids re-adding the permanence clause D-149 cut twice.
⚠️ And `roster_full` was the third home and was **not in D-149's pair check**. It is a trio now.

⭐⭐ **THE INSTRUMENTS WERE THE OTHER FINDING, THREE TIMES OVER.** Draft 1's extraction and its
merge were both typed straight into a shell, so the two steps that turn the product into the
reviewers' artefact were the two steps nobody could repeat — discovered the next morning by
needing them. Both are files now (`extract-copy-en.mjs`, `build-copy-fi.py`). ⚠️⚠️ **And the
rebuild silently reverted a deliberate repair**: four Finnish sentences had been capitalised by
hand in the output JSON, in no source, so regenerating undid it. It showed as a diff of 39
where 36 was expected. ➡️ **A repair that lives only in the artefact is a repair the next build
removes** — and the way it announced itself was a count that did not match.

⚠️ **THREE OF HIS OWN CORRECTIONS DID NOT SURVIVE CONTACT WITH THE CODE, AND SAYING SO IS THE
JOB.** (1) `ending.confirm` was to end *"Empty browser cache to remove those traces"* — the
cache is not where any of it is, and he had ruled on this same sentence in round 24 for
`ghost.notErased` and accepted *"clear this site's data in your browser settings"*; **the same
sentence in a second place gets the same words**, which is D-148's lesson arriving as a
prediction rather than as a post-mortem. (2) `commitment_mismatch` was to read *"Something is
mixing up"* in place of *"This is an attempted substitution"* — the one screen that tells a
person they are being attacked, and "mixing up" reads as a glitch; it says "interfering with"
now, which is his register without the retreat. (3) `ending.thoroughConfirm`'s shortening
dropped the only sentence about the high-water-mark reset, which is the security downgrade the
control exists to disclose. **Shortening a true sentence is safe; deleting the only true
sentence about a downgrade is not.**

⭐ **AND FOUR DECISIONS WENT BACK TO HIM RATHER THAN BEING TAKEN.** One of them was
`chat.reconnect.why`'s last sentence, which he had dropped once before and which D-148's note
kept on the grounds that he had not complained about it. He dropped it again. **Twice is
evidence, not repetition** — so it went back as a question, and he kept it. The note that
justified keeping it unilaterally the first time was the thing that needed revisiting.

⚠️ **WHAT THE TRANSLATION FOUND IN THE ENGLISH, CORRECTED.** D-149's note recorded *three*
sentences reaching the screen with a lowercase first word. There are **five** — 13 strings start
lowercase, and eight of those are fragments or the `haamu` logo and are right. Published as
"three" yesterday without counting, which is the "171 checks" mistake exactly one day later.
Also: `unlock.memory`'s "128 MiB" was **typed**, the only number in `copy.js` that was not read
from a constant (his simplification removed it), and `access_rule`'s "once an hour" is prose
with no grammatical interpolation — bound to `USER_CHECK_INTERVAL_S` by a check instead.

⭐ **The copy gate refused his numbered list.** He asked for *"It holds 1) a mailbox, 2) one
public value, and 3) the scrambled message"*; `test/copy.mjs` forbids a digit no constant put
there and does not know a list marker from a quantity — **which is the right way round for a
check whose job is to catch a typed "24 hours"**. It reads "three things:" with semicolons.

⚠️ **One Finnish item was a fact, not a register.** *arvottu* (drawn by lot) was used for the
mailbox id in five places. `mailbox_id = Trunc128(SHA256("lpm-mailbox-id-v1" ‖ pk))` — it is
**computed**, deterministically, because both devices must arrive at the same number. It is
*luotu* now. In `terms.mailbox.body.0` the old word sat one clause from *"sitä ei lasketa"* —
*drawn at random: it is not computed* — which read as denying it is computed at all.

⭐ **English kept "one day" and Finnish took "24 h".** He offered 24h for both. `span()` renders
the message TTL and the invite-link TTL from one function, so English would have been all six
sentences or none, including the gate sentence approved the day before. **A translation does not
have to match word for word; a product does have to match itself.**

### D-149. ⭐⭐⭐⭐ Round 25: two of the eight were not shortenings at all — a button answering the wrong question, and a verb the source knew about and the label did not

**2026-08-22, the second batch from the same two readers, hours after D-148. `ui/copy.js`
(nine strings), `test/copy.mjs` (two allowlist entries removed, six checks added). Client
suite green: 178 copy checks. `lpm` build `7e36ce6047bcce8c`.**

⭐ **Six of the eight are D-148's class continuing** — a clause the screen already implies, a
word nobody says, a reassurance answering a doubt the screen had not raised:

| string | cut | what it had been doing |
|---|---|---|
| `phrase.choose` | *"Pick one. They are all equally good — "* | reassurance visible from six equal boxes; it also said "pick" and then "choose" |
| `unlock.working` | *"on purpose"* | defending a wait against a reading the screen's own `why` already answers |
| `panic.keeps` **and `deletion.trace`** | *"That part cannot be removed."* | permanence added to a fact already in the present tense |
| `lock.coveredWhat` | *"so there is nothing to ask for"* → *"to protect the conversation"* | described the MECHANISM and left the reader to derive the consequence |
| `openLink.orCode` | → *"Dashes, spaces or capitals do not matter."* | said less than the code actually tolerates |
| `pairing.keepOpen.kept` | *"stays openable"* → *"works"* | a word nobody says, in the paragraph read while waiting |

⚠️ **`openLink.orCode` NOW CLAIMS MORE, AND THE CLAIM WAS CHECKED BEFORE IT WAS WRITTEN.**
`normalise()` upper-cases and then keeps only what is in `CODE_ALPHABET`, so spaces, dashes and
every other stray character are dropped — **verified by running it on spaced, hyphenated,
lower-cased and punctuated inputs, sixteen characters out of each.** Saying "spaces" is not a
new promise; it is a promise the code was already keeping silently. ⭐ *A copy change that
widens a claim is a claim to test, not a sentence to write.*

⚠️ **`pairing.keepOpen.kept` lost "openable" TWICE and only one was in the batch.** Leaving the
second would have kept the odd word in the paragraph it had just been cut from, which reads
worse than either version. Flagged to him rather than done quietly.

---

#### ⭐⭐⭐ The one that is not a shortening: the answer button was answering the wrong question

§3.6.2's confirming answer read **"We compared them and they are the same"**.

> Hannu: *"Is not good because the user should compare if it is the friend."*

**He is right, and D-125 is the reason it matters.** Matching digits are not the finding.
**Whoever completes the handshake sees digits that match** — including somebody who stole the
invitation, whose SAS agrees with ours perfectly, because they paired with this device. The
digits are the INSTRUMENT; the question is *who is at the other end*, and the button was
reporting the instrument's reading as though it were the answer.

D-148 had already changed the prompt above it to **"Make ABSOLUTELY sure that person is your
friend"**. ⭐ **The batch that raised the question left the answer contradicting it**, which is
the ordinary consequence of editing a screen one string at a time. Now:

> **"Absolutely sure — it is my friend."**

⚠️ **The new check is shaped as a REFUSAL, not a match**: there are many good ways to say *it is
my friend* and exactly one bad one — reporting that two numbers agree. `/friend|person/` and
**not** `/same|match|compared/`.

---

#### ⭐⭐ The other one: a verb that lived in the source comment and not on the button

`ghost.end` said **"End this conversation"**. The comment directly above it has said, since it
was written: *"with no list to delete from, deleting this conversation and ending the session
are the same act, so there is one button."*

➡️ **The file knew the button deletes. The button did not say so.** A reader can take "end" for
closing, leaving, or hanging up — none of which lose anything — and this is the one press in
Ghost mode that cannot be undone. Now **"End and delete this conversation"**.

⚠️⚠️ **"delete" AND NOT HANNU'S "clear", AND THE REASON IS ON THE NEXT SCREEN.** He asked for
*"End and clear this conversation… or any other wording that means that it is then lost"*.
**"Clear" reads as scrubbing, and `ghost.notErased` on this same mode's terms screen says
explicitly that the conversation is NOT scrubbed off the device** — only made impossible to
open. "Delete" is what the rest of the product calls removing a conversation and is exactly as
strong as §7.8 permits. A third check now refuses `scrub|wipe|erase|shred` in either string.

⭐ **And his parenthesis — *"(or is it?)"* — has a real answer, which is why the label could be
strengthened at all.** In Ghost mode it genuinely is lost: no KEY and no copy anywhere else, so
nothing can reopen it. The friend keeps their own copy, and the bytes on the device are not
scrubbed but are unopenable. **All three facts are already in `endConfirm` and `notErased`.**
Had any of them been otherwise, the honest fix would have been to weaken the button, not
strengthen it.

⚠️ **`endConfirm` now opens with the button's own words, and a check enforces it.** A
confirmation whose first words differ from the control that opened it makes a person wonder
whether they pressed what they meant to — and nothing else in a build would ever fail.

---

#### ⭐⭐ A SENTENCE THAT APPEARS ON TWO SCREENS IS ONE SENTENCE WITH TWO HOMES

*"That part cannot be removed."* stood at the end of **both** §7.3.1a disclosures — the
single-conversation confirmation (`deletion.trace`) and the panic confirmation (`panic.keeps`).
Hannu's batch named one. ⚠️ **I cut only that one and flagged the twin**, on the reasoning that
he had not seen the other screen; he then ruled on it — *"the other can also be removed"* — and
both are now identical again.

➡️ **For the hours in between, the product made one disclosure in two registers and nothing
could fail.** That is the whole subject of `feedback_legal_text_drift`, arriving inside the very
round that is supposed to be watching for it. ⭐ **Hannu ruled on the SENTENCE; I had scoped his
ruling to the SCREEN.** Not extending a ruling past what he has seen is the right default — the
mistake was leaving the gap open rather than closing it in the same message.

**Now enforced rather than remembered:** a check asserts that both carry the residual (singular
and plural forms) and that **neither may take the removed clause back on its own.** §7.3.1a is
satisfied by what remains in both — each states what the list keeps, which is the thing the
section forbids denying.

---

#### ⭐ What this round says about the last one

**D-148 shipped hours earlier and this batch found eight more things on the same seventeen
screens.** Neither round exhausted the sheet, and the second round found the two DEEPEST items
— both of them semantic, both invisible to a reader who has not already been over the screens
once. ➡️ **A contact-sheet review is not a single pass with a fixed yield. The first pass clears
the surface and is what makes the second pass possible.** Budget for at least two.

### D-148. ⭐⭐⭐⭐ Thirteen cuts from the first review with two readers — and one of them is a class: an instruction whose condition excludes the person reading it

**2026-08-22, round 24. `ui/copy.js` (thirteen strings, two keys deleted), `app/index.html`
(two elements deleted, one button demoted to `.linkish`), `app/app.js` (two render calls),
`test/copy.mjs` (three checks re-pointed, one deleted, two added). Client suite green:
172 copy checks, all suites passing. `lpm` build `719185a7fa5bd6fa`.**

⚠️⚠️ **THE ROUND IS STRUCTURALLY NEW AND THAT MATTERS MORE THAN ANY ONE CHANGE.** Twenty-three
rounds of feedback have come from one person, using the product on his own phone, in a flow.
This one came from **two people reading the screens as PICTURES** — the contact sheet built
the day before, seventeen screens on one page, seven of them failure states neither of them
could have caused on purpose.

➡️ **That instrument sees a different class of defect and is blind to a different class.** Ten
of the thirteen findings are about a sentence that is one clause too long, a word that repeats
what the sentence before it said, or a control that is louder than the advice above it — all
things you see when screens sit side by side and cannot see while you are inside one. **Nothing
in the batch is about sequence or timing**, which is what a flow review finds and this one
structurally could not.

⭐ **And the most-repeated verdict was not "this is wrong", it was "this is one clause too
long".** Every rule in this project's copy file was written to stop an overclaim, a register
failure, or a word collision. None of them was ever a length rule, and the sentences that
failed here passed all of them.

---

#### The one that is a class, not an instance

`lock.coveredWhat` ended: *"If the device is not in your hands, end the conversation."*

> Hannu: *"How can the user read that if the device is not in the users hands?"*

**The advice is addressed to somebody who, by its own premise, is not looking at the screen.**
Whoever IS reading it is either holding the device — in which case the condition is false — or
is the person who took it. It is not merely useless; it tells the wrong reader what the owner
would want done.

⭐ **The general form: an instruction is read at a MOMENT, and a sentence whose condition
excludes that moment reaches nobody.** It is the neighbour of D-112 — that rule is about what a
sentence SOUNDS like, this is about who is in front of it — and no check in this project could
have found it, because every one of them reads a string without a reader.

⚠️ **The control it pointed at is still there.** `#covered` carries "End this conversation"
as its second button, so the ACTION survived the sentence; only the instruction went. That is
the reason the cut is safe and it was verified on the photograph, not assumed.

---

#### The other twelve, by what kind of thing was wrong

**Said twice (4).** `panic.otherSide` promised the other people are told *"and they keep their
own copies of them"* one sentence before *"this does not delete anything on their devices"* —
the same fact, twice, on a screen somebody reads in a panic. `panic.survives` explained why the
KEY cannot be deleted to a reader who has just been told it survives. `unlock.why` said what the
Argon2id second BUYS, on a screen whose other sentence already says the wait is deliberate.
`qr.room` explained that a friend saying *"it does not work"* is what tells you — after the
sentence that already says the friend will not be able to open it.

**Explaining a mechanism nobody needs (2).** `ghost.duplicatedWhy` — *"Duplicating a tab copies
what the conversation is stored in, and the two copies cannot be kept in step"* — verdict *"too
complicated and not needed"*. **Deleted outright**, and the property it carried (WHICH tab
works) moved into `ghost.duplicated`, which now names the button underneath it in quotes.
`pairing.sasMismatch` — *"If they do not match, stop"* — was prose instructing a reader to do
what the button beside it does; three answers are on that screen and one of them IS "they do
not match".

**Too quiet for what is at stake (1).** `pairing.sasWhat` now reads **"Make ABSOLUTELY sure
that person is your friend"**. This is the one screen where a person is asked to catch an
attacker and *"Make sure"* is the register of a checklist. ⚠️ D-109 is untouched: its rule is
about the WORD "key", and **KEY** in capitals remains the user's eight words and nothing else.

**Vague where a reader needed a place (2).** `tabs.dormantBody` said *"somewhere else in this
browser"* — deliberately vague, and vague in the wrong direction: two readers could not tell
where to look, while the control underneath had said **tab** since it was written. Naming the
tab tells a person where to go. ⚠️ The older rule still holds and the new sentence still obeys
it: it does not say *you opened a second tab*, because most people who reach this screen did
not knowingly open anything. `tabs.useHere` gained its noun — "Move **the conversation** to this
tab" — because "it" had two candidates on a screen whose subject changes twice.

**A control louder than the advice above it (1).** `#use-here` was a filled button, deliberately
not `secondary`, on the argument that it is the only thing to do on that screen and must not be
a dead end. **Both readers read it the other way**: the loudest thing on the screen was the
shortcut PAST the advice the screen had just given, so it invited the press instead of the
search. It is `.linkish` now — the same treatment every other *"or do this instead"* in this
product gets, and the class was already excluded from the pill rule, so nothing else moved.

**Two shortened, one renamed (2).** `ghost.notErased` is Hannu's own shorter sentence coming
back — the *"cannot reach back afterwards"* clause was restored in an earlier round and did not
survive a second reading. ⚠️ It is SUPPORT, not a claim-limiter: nothing claims erasure with it
gone, so §7.6 is satisfied either way. `pairing.code.replacedLink` is now *"The invite link is
cancelled. This code opens the conversation now."*

**And one on the gate (1).** `product.what[2]` ends *"Old conversations are saved behind your
KEY."* — see the open question below, because that sentence now stands closer to a fact it does
not mention.

---

#### ⚠️⚠️ The one place his wording was NOT used verbatim, and why

He asked for: *"If you want: Empty your browser cache."*

**The cache is the one store this paragraph is not about.** On Chrome, "Cached images and
files" is a different checkbox from "Cookies and site data", and clearing it leaves every byte
`ghost.notErased` describes exactly where it was. **An instruction that names the wrong control
is worse than no instruction**, and it would be worse on the one screen whose whole subject is
*you cannot make this go away*. So the sentence keeps his shape and names **site data**:

> *"If you want: clear this site's data in your browser settings."*

⭐ It still promises nothing about the bytes being gone — *"not scrubbed off your device"* two
clauses earlier is what stops it, and that is the sentence §7.6 constrains.

---

#### What happened to the checks, which is the part worth keeping

**Three were RE-POINTED and one was DELETED, and the difference between those is the whole
D-107 rule.** A check follows the PROPERTY, not the words:

- `ghost.duplicatedWhy` → `ghost.duplicated`. A person on that screen must still be told which
  tab works; the sentence moved, so the check moved with it.
- `panic.otherSide`: `/keep their own copies/` → `/does not delete anything on their devices/`.
  Same fact, different clause, check re-aimed at the surviving one.
- `pairing.code.replacedLink`: `/stopped working/` → `/cancelled/` **and** `/invite link/`,
  because the naming rule is the half that must not drift.
- ⛔ **`/end the conversation/i` on `lock.coveredWhat` was DELETED, and that is the unusual
  one.** There is no property left to move. The check was enforcing an instruction that reaches
  nobody — **a test that was wrong to pass**, and D-107 does not apply to content that should
  never have been there.

⭐⭐ **And D-016b's allowlist-rot guard did its job, which was verified rather than assumed.**
Three paths — `product.what.2`, `ghost.duplicated`, `pairing.sasMismatch` — no longer contain
"they" or "them", so their allowlist entries became permissions lying around for whatever gets
written at those keys next. They were removed; **and the guard was then proved to fire by
putting one back and watching the suite fail with its name**, rather than by reading the code
that implements it.

---

#### ⚠️ Open, raised by him in the same message and not yet answered in the product

> *"I did not notice that it states anywhere how long the messages are saved in your
> conversations?"*

**It is stated, and not where a person decides.** `chat.ttl` — *"Messages disappear from this
device 24 hours after you receive them"* — is a system line INSIDE a conversation, and the
server side (mailbox recycled after fourteen days) is in the `mailbox` term and on the Ghost
screen. **No screen on the wizard says it**, so nobody learns it before they commit.

⚠️⚠️ **And this round's own gate sentence had just walked into it.** *"Old conversations are
saved behind your KEY"* is true of the CONVERSATION and, standing alone, reads as a promise
about its MESSAGES, which are gone in a day. The wrong reading was the reassuring one.

✅ **FIXED IN THE SAME ROUND, in his words:** the gate paragraph now ends *"Old conversations
are saved behind your KEY. The messages auto-delete after one day."* ⚠️ **"one day" is
`${span(MESSAGE_TTL_S)}` and not a typed phrase** — the same constant `chat.ttl` spells in
hours, so a change to §5's TTL that reached only one of them would leave two true-looking
sentences disagreeing on screens a person meets ten minutes apart. **Both units are now
checked, in one block, against the one constant.**

⚠️ **Two residuals are deliberately NOT on the gate**: the delete happens on THIS device and is
actioned at the next open, and the other person's copy runs its own clock. Both are in
`chat.ttl`, where a person can act on them. A gate carrying them would be the paragraph this
round was cutting. ⭐ **This is the first retention promise the product makes before a person
commits to anything** — every other one is downstream of a decision already taken.

> *"How big task would it be to translate these to Finnish?"*

Recorded, not decided. **283 strings, 4,440 words, and `index.html` holds eleven words of
English in total** — D-083's copy gate means there is genuinely one file to translate. The
translation is the small half. The large half is `plural()` (which appends an English "s" where
Finnish wants nominative singular for 1 and partitive for the rest), `spell()`, the **17
sentences built at runtime** — several of which need whole-sentence Finnish templates rather
than a swapped noun, because the case ending depends on position — and **172 English-shaped
copy checks**, which would leave a Finnish copy shipping with no coverage in the one file that
exists because prose drifts from its constants.

**Two of the four costs were struck by Hannu on the day, and both are now settled:**

- ⛔ **The 1296-word KEY list is not translated, and never was going to be.** `deriveMaster`
  hashes the canonical TEXT of the words, so a Finnish list is a different identity space, not
  a translation of this one — it would break every identity that exists. Finnish speakers keep
  typing English KEY words. Hannu: *"Correct — I never intended the translation of…"*
- ⛔ **§2.2b's spelling alphabet stays out of the Finnish version entirely.** Hannu: *"Finns can
  handle that by themselves."* ⭐ And it is the right call for a reason beyond effort: the
  alphabet is spoken BETWEEN two people, so two users on different UI languages reading
  different alphabets at each other is a failure the single English table cannot have. The
  constraint that matters — a code never contains I, L or 1 — is arithmetic on `CODE_ALPHABET`
  and is language-independent.

⚠️ **The standing caution, recorded once:** translating doubles the cost of every future copy
change — this round's thirteen would have been twenty-six — and the wizard has moved in all
twenty-four feedback rounds so far. Against that: if the testers are Finnish and the question is
*is the KEY too much hassle*, English copy is a confound and the round would measure reading
difficulty instead. **Draft the bilingual sheet first, implement after his reviewers report.**

### D-147. ⭐⭐⭐⭐ The guard that recovered your own claim was asking the wrong key — and nothing could fail until the retry arrived to ask it

**2026-08-21, round 23. `PROTOCOL.md` 0.9.20 (§3.4.1b rule 11 gains the write bullet rule 10
had been missing); `flow/pair.js` gains `writeRetrying` and applies it to all three §3 writes.
Chosen by Hannu in round 20 — "Retry, with an ownership check" — and deferred twice since,
both times deliberately.**

Rule 10 says retry a transport failure a bounded number of times *before surfacing it at all*.
D-143 taught that to every **read** in §3. The three **writes** were left alone, with the
reason written into the source in capitals: a transport failure cannot tell *"never arrived"*
from *"arrived, answer lost"*, so a blind retry of the claim lands twice, and a second claim
under one `L` is §3.5's intrusion alarm — **the only alarm this product has, fired at somebody
whose pairing is perfectly fine.**

⭐ **The construction that makes it safe was already in the file, doing this exact job at one
call site.** Every §3 write leaves on the server a value only the writing device could have
produced — `commit` for §3.1, `J_pub` for §3.2, `I_pub` for §3.3. So *"did my write land?"* is
not a question the transport can answer and **is** a question the protocol can. Ask before
retrying; a match means it landed and no second write is sent.

⚠️⚠️ **AND THE ONE CALL SITE WAS ASKING THE WRONG KEY.**

```js
if (heldHere && (await claimIsOurs(api, idPath, heldHere.privateKey, signal))) {
```

`heldHere` is the record read at the *top of the call*. A first-time joiner has none — so
`heldHere &&` short-circuits, the ownership check never runs, and §3.5's alarm fires. The
comparison it should make is against `publicKey`, **the key this attempt just saved**, which is
the same value wherever `heldHere` exists and exists in every case where it does not.

⭐⭐⭐ **THE GENERAL FORM. The condition on that guard was inherited from the STORY THAT
PRODUCED IT, not from the QUESTION IT ANSWERS.** The guard was written (2026-08-18) for a
device re-opening its own invite link — a *resumption* — so it was conditioned on holding a
resumption record. But its question is "is this claim mine?", and the thing that answers that
is a key, not a record. **The `heldHere &&` was provenance, not logic**, and it narrowed a
sound test to the one case that had been on the writer's mind.

⚠️ **It was latent, not live, and that is the interesting part.** Without a retry the `POST` is
sent once and cannot land twice, so a `409` really did mean somebody else — the guard was
never *wrong*, only never *exercised* on the path where it was too narrow. **The retry is not
what broke it; the retry is what would have been the first thing to ask.** A precondition, not
a tidy-up beside the feature — which is why it is in this entry and not a footnote to it.

**Built at all three writes, not just the claim.** The claim is the one carrying the alarm and
the one Hannu was asked about; the create and the reveal are the same construction with the
same comparator, and a dropout does not choose which request it lands on. D-143's finding was
*rule 10 implemented where it was noticed rather than where it applies* — doing only the claim
here would have been that same shape, recorded and then repeated.

⚠️ **`worthRetrying` is unchanged, and deliberately: a `409` is still never worth repeating.**
`writeRetrying` does not retry a `409` — it re-**reads** it. The distinction is the whole
safety argument: the check can only ever *suppress* a refusal, never raise one, so every
uncertainty — a failed read, an absent field, a key that will not decode — resolves to "not
mine" and the alarm survives. A stranger's claim carries a different `J_pub` and can never
match.

⚠️ **No ladder inside the ladder.** The ownership read is a bare `api.get`, where every other
§3 read is wrapped. Nesting rule 10's budget inside itself is not twice as patient — it is five
attempts of twelve and a half seconds, a minute of silence under a screen still saying the
pairing is going.

**Eleven new assertions, and the two that matter are the negative ones**: three armed losses
spend the CAS exactly **once** (the retry asks and never re-sends), and a stranger claiming
*inside the retry window* still raises `already_claimed`.

⭐⭐ **AND THE HARNESS WAS WRONG TWICE AGAIN, BOTH TIMES LOOKING EXACTLY LIKE THE PRODUCT
WRITING TWICE.** The count that was going to prove "published exactly once" read **2**:

- it counted **every** POST the side made, and the initiator posts a create *and* a reveal.
  **A counter that spans two endpoints cannot answer a question about one of them.**
- it incremented when a loss was *armed* rather than when one *happened*, so a request the
  server **refused** was recorded as a dropped answer — a thing that cannot occur.
  **Counting the arming of a fault is not counting the fault.**

Two instrument faults, zero product faults, in a session whose standing instruction is to
suspect the harness first. That is now the base rate across three consecutive rounds.

### D-146. ⭐⭐⭐⭐⭐ The message he reported as lost had arrived — a true notice, drawn two drains late, under the message it was not about

**2026-08-21, round 22. `PROTOCOL.md` 0.9.19 (§5.4.2's third row: three drains → one);
`flow/message.js` stages a terminal refusal instead of counting it. Reproduced,
measured, and proved both ways.**

Hannu, testing Phase 2:

> *"in old conversations when I opened those there came and was sent the 'Reconnecting old
> conversation.' But eventhough that was sent and came through both ways **the first real
> message usually went lost** and there came this red: 'A message is lost. It arrived before
> this conversation was re-established — please ask your friend to resend.' … but after that
> everything worked smoothly and very fast"*

**Nothing was lost.** Measured, with stranded ciphertext in the mailbox and both devices
migrated:

```
drain 1   the stranded message is refused, counted to 1   — nothing shown
drain 2   HIS FIRST REAL MESSAGE ARRIVES, clean           — nothing shown
drain 3   the count reaches three, the failure is staged  — "A message is lost"
```

The red line is about a message **his friend sent days earlier**, to a session his browser
no longer had. It appeared one drain after his own, so it read as a verdict on his own.

⭐⭐⭐ **AN UNDECRYPTABLE MESSAGE CARRIES NO READABLE TIMESTAMP, SO ITS NOTICE CAN ONLY EVER
BE DRAWN AT "NOW".** That is not a rendering choice and there is no fixing it in the log:
the client cannot know when the thing it could not read was sent. It follows that **WHEN the
notice is drawn is the whole of what it appears to be about** — and two drains of delay were
enough to change its subject from *"you have opened an old conversation and these are gone"*
to *"the thing you just pressed send on"*.

⚠️⚠️ **THE DEFECT WAS A SENTENCE §5.4.2 WROTE ABOUT ITS OWN RULE.** The table read:

> *"it is refused without being tried and can never become readable, so the three drains are
> **a formality that bounds it**. Without them it would sit in the mailbox for a fortnight."*

Every clause is true. The conclusion does not follow. **A formality with a two-drain latency
is not a formality when a notice hangs off it.** ➡️ *A cost accounted for in one unit, by a
rule that is spent in two* — the bound on the mailbox was real, was measured and was stated;
what nobody asked is what the same three drains cost anywhere else. ⭐ And the fix
**strengthens** the bound it replaces: the ciphertext is now fetched once before being
acknowledged rather than three times.

⚠️ The three-failure limit is untouched for `UNDECRYPTABLE` — a failure **against** an
established session — which is §5.4.2's genuine case and the branch where a withheld pre-key
could otherwise be turned into a destruction primitive. That argument was never about a
message refused before it was tried.

⚠️⚠️ **AND THE CLIENT WAS ALREADY DRAWING IT ON DRAIN ONE, WHICH MADE IT WORSE RATHER THAN
BETTER.** `app.js`'s `onRefused` draws a provisional line immediately — with a comment saying
so. `renderLog` then calls `replaceChildren()` and clears `refusedShown`, so the line is
**wiped** by the next rebuild and only becomes durable when the count reaches three. The
person sees it, loses it, and gets it back two drains later in a different place. A
provisional statement with a correct lifetime, whose correct lifetime was the problem.

⭐⭐ **THREE REPRODUCTIONS FAILED BEFORE THE RIGHT ONE, AND "USUALLY" IS WHAT MISLED ME.**
That word says *intermittent*, so I went looking for a race: seven causally-distinct
interleavings of a two-sided reconnect driven headlessly, and four browser variants (wait,
send-immediately, both-send-at-once, migrate-twice). **All eleven came back clean.** The
missing ingredient was not timing at all — it was **stranded ciphertext**, the thing that
actually makes a conversation *old*: his friend had kept sending for days to a session that
no longer existed anywhere. The intermittency was only whether a given conversation had any.
➡️ *"Usually" can mean "when a precondition happens to hold", and reading it as
nondeterminism sends you looking for the wrong kind of cause.*

⭐ **THE SUITE CAUGHT THE CHANGE, WHICH IS THE WHOLE REASON RULES ARE WRITTEN AS ASSERTIONS.**
`e2e-message.mjs` already asserted `attempts: 3` after `MAX_DECRYPT_FAILURES` drains — the old
rule, written down — and it failed the moment the new one shipped. The new assertion was then
run against a saved copy of the previous `flow/message.js` and fails there with exactly the
right line (*"reported on the FIRST drain, not the third" — got nothing*), so it discriminates
in both directions. ⛔ The restore was done from that saved copy and proved with `sha256sum`,
never with `git checkout`.

⚠️ **ONE THING THE TEST'S FIRST DRAFT GOT WRONG, AND IT IS WORTH KEEPING:** it asserted that
the peer's next message would be at the new generation, and got the old one. That is not a
defect — it is `copy.chat.reconnect.cost` as an assertion. The banner says *"before you send a
new message you cannot receive messages from your friend"*; the mirror is that **until you
RECEIVE theirs, you are still talking to a session that is gone.** In the running app the
drain loop closes that in a second. In a test, nothing happens that is not written down.

### D-145. ⭐⭐⭐⭐ Phase 2 of the design pass — and the comment that had been standing in its way was one this project wrote itself

**2026-08-21, round 21. `app/app.css` and `app/index.html`; no copy string changed and no
protocol section touched. Photographed at 411×751 — the phone in Hannu's own diagnostics —
before and after, by `probe-phase2-screens.mjs`.**

D-139 restyled the shell, the conversation list and the chat, and left the seventeen wizard
screens with a note explaining why they were harder:

> *"They are the setup and pairing wizards and WhatsApp has no analogue for any of them, so
> 'look like WhatsApp' will not be the whole answer there either."*

**That is wrong, and it is the reason these screens went a week without a direction.** WhatsApp
has an exact analogue and it is its **registration flow** — enter your number, type the code we
sent, choose a name. Every screen in it is a title, one instruction, one control, and the
alternatives set quietly underneath, which is the shape of all seventeen of these.

⭐⭐ **THE COMPARISON HAD BEEN MADE AT THE WRONG LEVEL OF THE THING.** Screen to screen the
comment is true: nothing in WhatsApp looks like *"write down these eight words"*. Flow to flow
it is false, and the flow is the level the answer lives at — the screen that asks you to write
down a passphrase has the same *shape* as the one asking for an SMS code, and shape is what a
design pass is about. Nothing was sloppy: a correct observation about screens was recorded as a
conclusion about the product. ⬅️ The same family as D-139's own finding, *a reason recorded
more broadly than the observation that produced it*, one level up — and it governed the design
for a week exactly as that one did.

**What was actually wrong, measured rather than admired** (411×751, the panel's own height
against a 695px content area):

| | | |
|---|---|---|
| four screens taller than the phone | gate 849, ghost 836, panic 717, QR 1001 | and nothing says so |
| `.note` at 0.82rem | four jobs, one look | one of the jobs is *instructions* |
| `.panel` | `--panel` is `#ffffff`, so is `--bg` | padding calling itself a surface |
| prose at 46rem on desktop | ≈95 characters a line | his own screen is 2317px wide |
| `.steps` | the quietest element on its screen | it is the one that says what is happening |

⚠️ **The gate's overflow is not a cosmetic point.** The three doors below its two buttons are
Ghost mode, paste-a-link, and §7.3.1a's panic action — and §7.3.1a *requires* that last one to
be reachable from a device the user has never used before. It is reachable and it is invisible.

**What changed.** A 32rem centred column (≈62 characters; on a 411px phone it never binds, so
the rule is invisible on the device that finds the bugs and fixes the one he looks at all day).
`.panel h2` to 1.25rem, scoped so the list's tiny uppercase `.listlabel` is untouched. `.note`
to 0.875rem at 1.45 leading. A 44px floor on the wizard's controls, pills for actions and
rounded rectangles for choices — **which is WhatsApp's own split, not an inconsistency**. The
KEY given the accent ground it has always deserved. `.panel.alarm` tinted, `.banner.alarm` left
alone.

⭐⭐ **THE LEAD, AND THE SPLIT THAT FELL OUT OF MEASURING IT.** Every one of these screens
already opens with its instruction and on most of them it was set as body text —
*"Read these six digits to your friend"* rendered exactly like the three paragraphs of caveat
under it. `.lead` promotes what is already written; **not one copy string changed.** The first
pass marked whatever paragraph came first, thirteen of them, and §7.3.1a's panic screen then
opened with **282 characters at 1.1rem** — seven lines of explanation dressed as an instruction.
Counting the characters is what caught it: the survivors are 14–91, the ones removed 121–282,
and about 110 is two lines on a 411px phone.

➡️ **And the rule fell out of the count rather than being imposed on it.** The seven screens
that **ask** carry a lead. The seven that **report** — Ghost's terms, a dormant tab, a
duplicate, a tripwire, a failure, a pasted link, a covered screen — have a heading and prose
and want no lead at all. *A screen that is telling you something already has a heading.* I had
reached for "the first paragraph", which is what a lead usually is, and would have shipped
seven of them wrong.

⚠️ **THE FOURTH INSTANCE OF THE TRAP THIS STYLESHEET HAS NAMED THREE TIMES.** `.panel
button:not(.term):not(.linkish)` is (0,3,1) and sits later in the file than `button.term` at
(0,1,1). Without those two `:not()`s every marked word inside a paragraph — `button.term` is an
inline control a reader can press — becomes a 44px green pill mid-sentence, and every text
alternative under a control becomes a second button. `.rows` caught this twice by painting from
a *layout* container; a **screen** container paints just as hard. The gate's computed styles are
asserted with `getComputedStyle` in the probe, never with a class list.

⭐ **`.steps`: done is the default and pending is the override, and CSS forced that.** `app.js`
marks only the current step. CSS can say *the siblings after this one* and has no way at all to
say *the ones before it* — so every step is painted finished and `.on` and `.on ~ li` take
theirs back. Adding a second class in `app.js` would put the same fact in two places. ⚠️ The
three marks are drawn with `border-radius` and `box-shadow`, not with characters: round 20 had
to check one glyph on one device before it could be trusted, and this would have been three.

⭐⭐ **`#working` had no motion at all, and its own copy said why that was wrong.**
`copy.unlock.working` carries the comment *"a screen that looks frozen for a second is a screen
people press again"*, above a screen that showed *"Opening — this takes a moment on purpose"*
and then did nothing, before an Argon2id that D-034 measured at 1.17 s on a decade-old Android,
on **every** unlock while §7.5's PRF is absent. It now has a bar — animated with `transform`
alone, because **this is the one screen in the product whose main thread is deliberately
blocked**, and a transform is handed to the compositor. Script, or an animation of `width`,
would freeze on the first frame of the wait it exists to cover. ⚠️ Its reduced-motion rule is
its own and not the global one: that rule sets `animation-duration: 0.01ms`, which would leave
a progress bar parked at 40% — an indicator making a false claim.

⭐⭐ **AND TINTING THE ALARM PANEL MOVED THE GROUND OUT FROM UNDER THE TEXT ON IT.**
`probe-phase2-contrast.mjs` measures every new surface at both themes from
`getComputedStyle`, and it failed on one: `.note` reads 4.65:1 on white and **4.06:1 on
`--alarm-soft`** — the tint costs about half a point, and that put §7.3.1a's three
explanatory notes, on the screen that wipes every conversation the person has, under the
4.5:1 line. Fixed with a second muted ink declared in all four palette blocks
(`--muted-on-alarm`, 4.99:1 there and 5.71:1 on white); the dark theme already cleared it
at 5.43:1 and is redeclared to its own value rather than left to the light block, per this
file's own rule.

➡️ **Nothing about it was visible.** The tint is pale, the grey looks like grey, and the
change that caused it — a background on a container — is three properties away from the
text it broke. **A contrast probe is not a formality on a design pass; it is the only
witness to what a new ground does to old ink.** ⚠️ And it was written *before* the tint
landed, which is the only reason it could catch it: a probe written after the change
would have been written to pass.

⚠️⚠️ **THE COST IS REAL AND IS NOT PAID OFF.** Readable notes and a 44px floor make screens
taller, and a tightening pass got about 30px per screen back but not the rest:

```
              before   after
gate            849  →   891
ghost           836  →   950     note-heavy: five blocks of it
panic           717  →   788
progress/qr    1001  →  1078
progress/link   560  →   631
setup           608  →   637
working         186  →   242     the bar, which is the whole point of it
verify          495  →   490     the only one that shrank
```

The gate is 891px on a 695px content area. **No amount of typographic tuning fixes a 28%
overflow — that is a copy-length property**, and the copy has been through twenty rounds of
testing and is not mine to shorten. It is stated here as an open question for Hannu with the
numbers attached, not resolved quietly in either direction. The trade was taken deliberately in
one place: 0.82rem → 0.875rem on the text carrying the instructions, for a reader who is 62 and
on a 411px phone.

### D-144. ⭐⭐⭐⭐⭐ `whenVisible` waited on an event, and an event that never arrives is forever — the defect that was actually breaking his pairing, after two rounds spent on its neighbours

**2026-08-21, round 20, third fix of the same day and the only one that was the bug.
`flow/pair.js`: `whenVisible` polls `document.visibilityState` instead of trusting
`visibilitychange`. `test/visibility.mjs` proves it both ways. Field-confirmed by Hannu the
same evening. No `PROTOCOL.md` change — rule 11 was right; the implementation of it was not.**

**What made this findable was a clause in his report, and what it did was rule out my
hypothesis.** He wrote: *"it does not work even if I come back to the pairing screen and wait
there."* D-140, D-141 and D-143 were all, in different ways, about a document that was
**hidden**. One sentence from the person holding the phone excluded the entire family. The
second half he supplied unprompted: same desktop, same invite, **Android Chrome fails and
Android Firefox works** — a controlled experiment with one variable, run by the reporter.

**The signal was an absence.** Both panels read `problem none`, and the desktop's read
`link —`. Nothing had errored and nothing had claimed. That combination is not a failure at
all; it is something **parked**. A screen that says *"Waiting for your friend to open it"*
while the code behind it has stopped waiting looks exactly like a screen that is waiting.

`whenVisible` returned a promise that settled from a `visibilitychange` listener and from
nothing else. Android Chrome freezes a backgrounded tab and later restores it, and a restore
does not reliably deliver that transition to a listener registered **before** the freeze. The
promise never settled. There is no timeout on it, no error path, nothing to report — the poll
simply never resumed, on a document the person was looking at.

It also explains the recovery he had already found for himself. *"Remove the KEY, enter it
again, CARRY ON"* worked every single time because a **fresh** call on an already-visible
document takes the `Promise.resolve()` line at the top and never needs the event at all.

⚠️⚠️ **I widened this three times while fixing other things.** D-140 put `whenVisible`
inside the retry ladder. D-141 built the visible-time clock beside it. D-143 wrapped five more
reads in it. Each was correct in isolation; each one made a single missed event fatal to more
of the flow. **A dependency that cannot fail loudly gets quietly load-bearing** — nothing in
review flags it, because at every step the thing being added is right and the thing being
depended on has never once been seen to fail.

**The fix is not a better event. It is not trusting one.** `visibilityState` is the truth; the
event is only a hint that the truth changed. `whenVisible` now polls that state every second
as well as listening for the hint, adds `pageshow` and `focus`, and re-checks once after
registering — closing the gap between the read and the listener. A frozen document runs no
timers, so the poll costs nothing while the tab is away and fires on the first tick after it
runs again.

**Both directions are tested.** `test/visibility.mjs` has a `fakeDoc()` with two verbs:
`go(state)` dispatches the event, and `silently(state)` changes the state and dispatches
**nothing**. The `silently` case throws *"never woke"* against the event-only implementation
and passes against this one. A test that only proves the fix works would not have distinguished
these two versions at all.

⭐ **And the general form, which is why this is five stars and not four:** *the neighbourhood
of a bug can be genuinely defective.* D-140 was real and field-confirmed. D-141 was real. D-143
was real. All three were fixed, all three shipped, and none of them was **this**. Being right
about a defect is not evidence of having found the one that was reported.

### D-143. ⭐⭐⭐⭐ Rule 10's retry existed at one call site and not at its five neighbours — found from a field report the build stamp had already qualified

**2026-08-21, round 20, same day as D-142. `PROTOCOL.md` 0.9.18; `flow/pair.js` gains
`retrying`/`readRetrying` and five bare reads now use them. Found from Hannu's diagnostics
capture, not from a stack trace.**

He reported a pairing that failed on the desktop with *"The pairing was interrupted …
reason: offline"*, and added: **"that came quite fast."** The diagnostics he pasted did the
rest of the work:

```
build   9b61457b8a287bd1, asking the server      ← the stamp, hung
link    20 ms, opening it
problem offline ×1, 26 s ago
```

⭐⭐ **`link 20 ms, opening it` IS SET ON THE `claimed` EVENT, SO HIS CLAIM SUCCEEDED** —
which is also why re-using the same code worked: the 409 path recognised the claim as his
own. Rule 10 kept the record and the recovery worked exactly as designed. **The defect was
not that it failed; it was that it gave up after one try.**

⭐⭐⭐ **THE LADDER WAS IN `readStatus` AND NOWHERE ELSE.** Rule 10 says a client SHOULD
retry a transport failure a bounded number of times *before surfacing it at all*. Five
requests had no ladder: the joiner's fetch of the offer, both resumption reads, and the
initiator's tripwire re-read. One blip on any of them is a failed pairing on screen.

⚠️⚠️ **AND THE WRITES ARE LEFT ALONE, ON PURPOSE.** A transport failure cannot tell "never
arrived" from "arrived, answer lost", so a blind retry of `POST {id}/claim` can read as a
second holder of `L` and fire §3.5's alarm at somebody whose pairing is fine. **That alarm
has to mean something on the day it matters.** README §0: *if an implementation appears to
need a construction not in this document, that is a signal the spec is wrong — stop and
ask, do not invent.* So 0.9.18 names it as an open question and forbids it meanwhile.

⭐ **THE BUILD STAMP EARNED ITSELF ON ITS FIRST FIELD USE, TWICE.** It said `the current
build` on the phone, which removed "was he running the fix?" from the investigation in one
line. And on the desktop it hung at `asking the server` — **my own defect, a `fetch` with
no timeout**, which is worst exactly when the network is sick, which is exactly when the
line is worth reading. Now capped at 4 s. An instrument's first real outing is where you
find out which of its answers it cannot give.

### D-142. ⭐⭐⭐⭐ The diagnostics panel says which build is running, because "hash-verified on the server" was being reported as "the user is running it"

**2026-08-21, round 20. New `client/app/build.js` (generated), `client/stamp.sh`,
`client/test/build.mjs`; one line added to `renderDiagnostics`. Verified both ways in a
real browser.**

On 2026-08-20 I deployed D-140's pairing fix, verified the five served files by hash from
this container, and told Hannu it was live. He tested it, it failed, and he said so. I
opened my reply with *"The fix didn't work"* and spent the evening building three more
probe arms. **It had worked.** What had happened is that Android Chrome restored his
backgrounded tab from saved state without re-fetching anything, so he was running the
previous client against the new server — and neither of us could see that, so we both
spent hours reasoning about code that was not executing.

⚠️⚠️ **THE DEFECT IS IN MY VERIFICATION, NOT IN THE APP.** `curl` from this container
opens a fresh connection with no cache, no service worker and no restored tab. It proves
what the **server holds**. It says nothing whatever about the document a person is
looking at, and I had been reporting the two as one claim for weeks. Hannu had even named
the pattern himself — *"maybe once a week I notice this lag in some fix"* — and I had
filed it as a curiosity rather than as the instrument gap it was.

**Only the page can close that gap**, so the comparison is made by the page: the stamp
compiled into the running code, against the same file fetched fresh with `no-store`. A
mismatch is the document telling on itself.

⭐⭐ **THE STAMP IS DERIVED, NEVER TYPED, AND THAT IS THE WHOLE DESIGN.** A hand-written
version string that somebody forgets to bump reports "current" while the page is stale —
it would fail in exactly the situation it exists for, silently, and **an instrument that
reports SOMETHING is the hardest kind of broken to notice.** So `stamp.sh` hashes the 57
files that actually ship (contents *and* names, so a rename moves it too), and
`test/build.mjs` fails the suite while `build.js` disagrees with the tree. Forgetting is
made impossible rather than discouraged.

⭐ **Three answers, not two.** "current", "OLD — the server has X", and "could not reach
the server to compare" are different situations. Rendering an unreachable server as
"current" would rebuild the very fault this removes.

⚠️ **Verified both ways, because a freshness check that can only say "current" is
decoration.** A page was left open, a served file was changed underneath it, and the
panel was read again without reloading: `9b61457b8a287bd1 — OLD. The server has
d9adb4f1a81c6281. Reload this page.` — then `d9adb4f1a81c6281, the current build` after
the reload.

**Cost:** one same-origin GET of one static file, only when the panel is opened, carrying
no identifier and storing nothing. It is the only request this client makes for a reader
rather than for the protocol.

📌 **seku.chat and privis.app need this more than haamu does and do not have it.** Both
serve `sw.js` with a 200; a service worker hands out the old bundle on the load after a
deploy and the new one only on the load after that. haamu sends `no-store` everywhere and
registers no worker, which is why its staleness needs a restored tab to happen at all.

### D-141. ⭐⭐⭐ A bound described as "active" that nothing ever gave a clock — and a mechanism whose first explanation was refuted by its first measurement

**2026-08-21, round 20. `PROTOCOL.md` 0.9.17 adds a fifth bullet to §3.4.1b rule 11;
`flow/pair.js` gains `visibleClock` and `pollStatus` uses it. Found by reading, not by a
report. Measured both ways in `~/lpm-probes/probe-visible-budget.mjs`, and the first two
versions of that probe REFUTED it.**

Rule 11 has always bounded **active** polling — the word is in the rule as written, and
it is doing real work: the point of the bound is to stop a page watching for ever, not to
punish somebody for leaving the application. Nothing anywhere said what measures
"active". `pollStatus` therefore measured it the obvious way:

```js
const sliceStart = Date.now();
…
await sleep(POLL_INTERVAL_MS, signal);
watched += Date.now() - sliceStart;
```

⚠️⚠️ **THE PROMISE WAS WRITTEN IN THE COMMENT DIRECTLY ABOVE THE CODE THAT BROKE IT.**
*"It counts only time spent WATCHING, so a tab left in the background for an hour comes
back with its ten minutes intact."* That sentence sat four lines above a wall clock. **A
comment is not a mechanism**, and this one had been read — by me, several times, in the
round that fixed D-140 — as if it were.

⭐⭐⭐ **AND THEN THE MEASUREMENT REFUTED MY ACCOUNT OF IT.** Reasoning from the source, I
wrote that the absence would be billed almost always: during the 750 ms sleep, or with a
request in flight. The probe said otherwise, twice. Every slice across a real
twenty-second absence came back **751–752 ms** — frozen, hidden, or offline alike:

```
+3.8s  [WATCHED] +752 ms -> 3007 ms, hidden=false
+4.5s  [WATCHED] +752 ms -> 3759 ms, hidden=true      ← tab goes away here
+24.9s [WATCHED] +752 ms -> 4511 ms, hidden=false     ← and comes back. 752, not 20 000.
```

The loop's park point sits at the **top**, above the accounting, and a hidden tab's
throttled timer still fires — so within about a second of leaving, the loop reaches that
park and waits there, outside the slice. A socket that fails **fast** does the same thing
one `continue` sooner. The bug was real; my explanation of it was wrong, and I would have
shipped that explanation into this file had the probe not contradicted it.

⭐⭐⭐ **WHAT ACTUALLY BILLS AN ABSENCE IS A REQUEST THAT HANGS.** One `/status` that
nobody ever answers holds `readStatus` awaiting **inside** the slice for as long as the
person is gone. That is not a laboratory condition: it is what a phone leaves behind when
it switches application and drops off Wi-Fi — a half-open socket nobody answers until TCP
gives up. Held open deliberately, the old code read

```
+25.7s [WATCHED] +21996 ms -> 25007 ms      → "this page has stopped waiting"
```

and the new code, same arm, reads `4690 ms` and keeps waiting. **Both ways, with both
negative arms kept**, because the two arms that did *not* reproduce are the evidence for
how narrow the path is — and are the reason this entry does not claim more than it can.

⭐ **It is D-140 again, one statement further down.** Rule 11 was taught to the loop's
parking and not to the accumulator wrapped around it, exactly as it had been taught to
the polling and not to the retry ladder. Three consecutive defects now trace to D-137's
own recorded lesson — *a specification's silence gets implemented anyway* — and the gap
has narrowed each time: two rules in one decision (D-140), then a rule and the four lines
inside its own loop (D-141). **Adjacency is not composition, and proximity is not
protection: the closer two mechanisms sit, the more obviously they compose and the less
likely anybody is to write down that they do.**

➡️ **What to do differently.** When a bound is described by an adjective — *active*,
*idle*, *recent*, *consecutive* — the adjective is a measurement and the specification
owes it a clock. Ask what instrument reads it, and whether that instrument stops when the
adjective stops being true.

⚠️ **What this is NOT.** No field report produced this, and no user has been shown to have
hit it. Hannu's round-19 pairing failures were D-140 and are fixed and confirmed. This is
a latent defect found by reading the code that D-140 changed, on a path that needs a hung
socket to reach. It is recorded at three stars rather than four for that reason.

### D-140. ⭐⭐⭐⭐ Two rules written in one decision, about one endpoint, that still did not compose — and a defect whose only variable belonged to the platform

**2026-08-20, round 19. `PROTOCOL.md` 0.9.16 adds a fourth bullet to §3.4.1b rule 11;
`flow/pair.js` `readStatus` rewritten. Found by a field report, reproduced in
`probe-hidden-claim`, measured both ways.**

Hannu paired an Android phone to a desktop browser and it hung on *"Waiting for the
other person"*, indefinitely, several times. His own bracket is the whole diagnosis, and
he produced it before I asked for one:

> *"If I write the code into the desktop browser without ever leaving the android haamu
> screen it works."* — the control, and it passes.
> *"Even if I come back to the android haamu screen before pasting, it once paired
> successfully immediately but other times not."* — the arm, and it is flaky.
> *"But if I back out of haamu and come back and type KEY again then I have the CARRY ON
> button and pairing is successful."* — a reload always fixes it.

#### The mechanism

Rule 11 says a client MUST NOT poll while its document is hidden. `pollStatus` obeys it:
it parks on `whenVisible()` between ticks, and `probe-rule10-rule11` arm D proves a
hidden tab makes zero requests and resumes when shown. **That probe passes and always
did.** What it never once did was let a claim *land while the tab was away* — it hides an
initiator with nothing happening on the other side, so "polling resumes" was tested and
"the pairing completes" was not. Two different claims; only one of them had a test.

The request already in flight when the tab hides dies with the tab. Rule 10's bounded
retry then fires four times — 500, 1500, 3500, 7000 ms — **against a dead socket, behind
a hidden document, in twelve and a half seconds**, after which `readStatus` throws and
the wait is over. Rule 10 classified it correctly as transient and kept the record, so
nothing was lost; but the pairing had been ended by the person switching applications,
and the screen went on saying *"Waiting for your friend to open it."*

#### ⭐⭐⭐ The finding: adjacency is not composition

**Rules 10 and 11 were written by the same decision, in the same edit, about the same
endpoint.** D-137 added both. Its own recorded lesson was that *a specification's silence
gets implemented anyway* — and the silence that bit here is the one D-137 itself left,
between its own two rules, on the question of whether a retry counts as a poll.

⚠️ **NO GATE CATCHES THIS, AND THE REASON IS STRUCTURAL.** A missing composition rule
fails no test, contradicts no section, and survives a careful reading of either rule
alone — because nothing is wrong with either rule alone. It is not a stale claim
(D-104), not a claim recorded too widely (D-139), and not a silent normative section
(D-137). It is **two correct sentences with no third sentence about their meeting**, and
the implementation supplies that third sentence by accident, silently, once.

➡️ **When one edit adds two rules that touch the same operation, the edit is not finished
until it says how they compose.** Ask specifically: *does the second rule's prohibition
reach the first rule's retries, timers and backoffs?*

#### ⭐⭐ The second finding: a symptom with no user-visible variable

The defect was intermittent to the only person who could see it, and **nothing he did
caused the variation.** Whether Chrome on Android *froze* the tab or merely *hid* it
decided whether the pairing survived — frozen, the retry timers cannot run, so the budget
is never spent and the pairing completes; merely hidden, they run and kill it. Arms G and
H of `probe-hidden-claim` are the same twenty-five seconds and differ in nothing else:
**5/5 stuck against 5/5 paired**, discriminating on that alone.

➡️ **A user-visible symptom with no user-visible variable means the variable belongs to
the platform.** Look there first, and do not spend the reporter's credibility on the word
"intermittent".

#### ⚠️ And the probe that nearly hid it

The first reproduction reported `I still reads: "Show timings"` for both sides — which is
`#diagfoot`, the last child of the scroller on *every* screen. `#failcode` and `#failmsg`
were on the page throughout and were never read. **An instrument that reports *something*
is the hardest kind of broken to notice**, and this is the same fault as the composer
assertion that passed at 627px of 880px the day before (D-139).

⚠️ Its closing summary also went on printing *"the ladder is NOT the mechanism"* after
the fix made every arm pass — a stale conclusion, in confident capitals, that had been
true when written. **The result that means anything is the pair**, measured both ways,
and the probe now says that in place of the boast.

### D-139. ⭐⭐⭐⭐ A reason recorded more broadly than the observation that produced it — and a feature nobody could report on because nothing named it

**2026-08-20, the design pass. `PROTOCOL.md` 0.9.15 adds §7.9; `app.css` rewritten;
the conversation list and the conversation restyled; a three-way theme switch built.
ROADMAP step 33. Phase 1 of two.**

Hannu asked for two things: a dark mode, and *"the layout and look and feel like
whatsapp mobile app… the more it resembles WA the better the users feel"*. He was
explicit about his own standing to judge it — *"we have to keep in mind that I do
not have any good taste. I just look if the contrast is fine and not jumping in the
users face too much"* — and about the reasoning: *"let's trust in WhatsApp design
because they have used millions in the design and feedback and testing"*.

#### ⭐⭐⭐ The finding that outlives the feature: dark mode already existed

`app.css` has answered `prefers-color-scheme: dark` since before the QR symbol was
built. Hannu has tested this product on a phone most days for a month and had never
seen it:

> *"I use haamu mainly on desktop browser so there I do not have the dark mode. I now
> checked that in my phone there is dark mode but I had not paid attention to that
> even though I tested a lot."*

➡️ **A BEHAVIOUR WITH NO CONTROL AND NO NAME IS ONE NOBODY CAN REPORT ON, INCLUDING
THE PERSON DOING THE TESTING.** The request was never for a feature that was
missing. It was that the product never said the word, so there was nothing to have
an opinion about. **The switch is worth more than the theme it switches**, and its
first item is called *"System default"* rather than *"Automatic"* for exactly that
reason: it names the thing that has been deciding all along.

⚠️ This is D-137's shape one layer out. There, a specification's silence got
implemented anyway. Here, an implementation's silence got *tested* anyway — for a
month, by somebody thorough, who could not see the half of the product he was in.

#### ⭐⭐⭐⭐⭐ And the reversal: D-104's reason was broader than D-104's evidence

Round 5 item 5 (2026-08-13) took the accent FILL off the outgoing bubble, and the
comment recorded in `app.css` read: *"a filled green bubble on every single thing the
user had ever said was the loudest element on the screen, spent on the half of the
conversation they already know."* Stated as a fact about filled bubbles. It is not
one. Hannu, today, unprompted:

> *"that I asked to take the strong green bubble off was because I used haamu at that
> time only on desktop where it was strong green on totally white background and that
> was a bit heavy… on my mobile when I look at WA that is on dark mode the strong
> green in sent bubble looks fine."*

The observation was **one deep saturated green (`#1d5c4f`), on a white page, on a
desktop.** The comment generalised it to every green on every ground, and that
generalisation governed the design for a week — including the decision, taken twice,
not to look at WhatsApp's own values.

➡️ **WHEN A FINDING IS WRITTEN DOWN, WRITE DOWN WHAT WAS IN FRONT OF THE PERSON WHEN
THEY MADE IT.** A finding without its conditions is a rule; a finding with them is
evidence. Nothing here was wrong when it was written — it simply claimed more than
had been seen, and **no gate catches a claim that is merely too wide**: it does not
contradict anything, it does not fail a test, and it reads as a principle.

⭐ The vindication is arithmetic: WhatsApp's light outgoing bubble is `#d9fdd3`, a
pale mint with near-black text at **15.75:1**, which is *quieter* than what D-104
replaced the deep green with. Going "full WhatsApp" did not reinstate what he
complained about. It fixed it.

#### What was decided

| | Decision | Because |
|---|---|---|
| Bubbles | **Full WhatsApp** — filled outgoing, neutral incoming, at WhatsApp's own hex values | Hannu's call, on the evidence above |
| Scope | **Whole app, phased.** Phase 1 = shell + list + conversation; Phase 2 = the seventeen wizard screens | So he tests the shell before it is spent on screens WhatsApp has no analogue for |
| Theme | **Three-way switch** — System default / Light / Dark, in the bar's overflow menu | WhatsApp's own set; and the switch is the point (see above) |
| Where it lives | `localStorage`, in the clear, never in Ghost mode, cleared by §7.8's THOROUGH ending only | New §7.9 — the specification had nothing to say and §0 forbids inventing quietly |

#### ⚠️ Four consequences recorded rather than discovered later

1. **The two-hue axis is narrower.** D-104's `--second` (violet) meant *not you* and
   its most visible instance was the incoming bubble. WhatsApp's is neutral, so
   violet now has one caller (`.choice.other`). Accepted, not overlooked.
2. **D-104's strength rule changed its mechanism.** *"A filled accent is the one
   action on a screen"* cannot survive a filled bubble on every outgoing message.
   WhatsApp separates them by **shape**: the send control is a circle. The rule
   holds; take the roundness off `.send` and it fails again, silently.
3. ⚠️⚠️ **The `.rows` trap was met a third time and caught before shipping.**
   `.menu button` and `button.danger` are both (0,1,1) and the menu rule is written
   first, so *"Delete this conversation"* would have rendered as an ordinary grey row
   — exactly as §3.6.2's red answer and the gate's accent fill did. The probe now
   asserts its computed colour against `--alarm`.
4. **`.hidden` became `!important`.** The new shell paints screens with flex, and the
   old rule won only on specificity and source order — which required every other
   rule in the file to be written weakly, and two comments to say so. A utility whose
   entire job is to win should say so once.

#### ⭐ Two measurements that a design review would not have produced

- **The composer sat at 627px of an 880px window.** Three controls and a paragraph
  under it — a quarter of the conversation screen, with the one control a person
  touches constantly pushed out of a thumb's reach. They went into the bar's menu;
  the composer is now at 880 of 880. ⚠️ **The first assertion I wrote was "the
  composer is on screen", and it PASSED at 627.** A probe that measures the wrong
  property is a probe that certifies the defect.
- **The floating button sat on top of *"Forget my KEY, and clear this site's data"*** —
  a destructive control, half-covered, on the screen somebody reaches when they want
  to be careful. WhatsApp's list has nothing underneath it; this one does.

#### Verified

Contrast computed from `getComputedStyle` in a real browser, not from the source:
light **15.75:1** / **17.46:1**, dark **6.77:1** / **12.13:1**. Both themes, the
switch in both directions against an emulated phone, three widths, a real pairing
with real messages. `test/theme.mjs` is new and guards the two duplications this
feature could not avoid — the storage key that a render-blocking classic script
cannot import, and the dark palette that CSS has no way to write once.

### D-138. ⭐⭐⭐⭐ The record and the screen classified the same error by different rules — and a sentence that names a CAUSE goes wrong the moment it gets a second caller

**2026-08-20, hours after D-137 deployed. `PROTOCOL.md` §3.4.1b rule 10 (interface
clause), and three client fixes. Found by Hannu against the deployed build, testing the
two things I asked him to test.** Feedback round 16.

⚠️⚠️ **HE FOUND BOTH BY DOING EXACTLY WHAT I ASKED AND PAYING MORE ATTENTION THAN I
DID.** His first report mixed the sequence up and said so; he then **re-ran the whole
eleven-minute test to be sure**, and the second report is precise enough to fix from.

---

**1. ⭐⭐⭐ A RECOVERABLE INTERRUPTION ANNOUNCED AS A FAILED PAIRING.** He took the
network away for sixteen to twenty seconds — past the 12.5 s retry budget — and got
**"Pairing did not complete"** in an alarm panel, over *"Something went wrong before the
pairing completed."* **Rule 10 had kept the record and the pairing was entirely
recoverable, which he then proved by recovering it** — after pressing the conversations
button several times and both parties re-entering their keys, none of which the screen
had told him to do.

➡️ **THE CAUSE: ONE DECISION WITH TWO CONSUMERS, AND EACH HELD ITS OWN COPY.** The store
asked `endsThePairing(err)`. The panel asked `err.reason === "still_waiting"` — the one
non-terminal case that existed on the morning it was written. **A dropped network is
also non-terminal, and nothing made the second condition track the first.** Now both ask
the same function, and rule 10 says normatively that they must.

⚠️ **A `NetworkError` also carried no `reason` at all**, so the copy table missed and
the generic sentence answered. ⭐ **This is the third time this table has been caught
missing a case** — feedback 13 was the same table missing `429`. ➡️ *A lookup keyed by
an error reason fails silently on the reason nobody thought of, and the reasons nobody
thinks of are the ones the NETWORK raises, because the server never gets to name them.*

**2. ⭐⭐⭐⭐⭐ "THIS BROWSER CLOSED BEFORE THAT HAPPENED" — SAID TO A MAN WATCHING THE
SCREEN.** At the ten-minute mark rule 11 offered to carry on, using
`copy.pairing.resume.made`, which explains the situation by naming its cause. **That
sentence was written for the unlock screen, where closing is what happened.** D-137's
own change gave it a second caller where the browser had not closed.

➡️➡️ **THE SENTENCE DID NOT CHANGE. WHAT CHANGED IS WHO REACHES IT. That is D-135's
finding, for the third time in three days — and this instance was created by the commit
that recorded D-135's finding.** I wrote *"ask who can now reach it"* into two documents
and a memory file on the morning of 2026-08-20, and shipped this the same afternoon.

⭐⭐⭐ **THE GENERALISATION IS SHARPER THAN D-135's.** Not every rule is equally exposed:
**a sentence that explains WHY is a sentence with an audience**, because a cause is only
a cause for the caller whose cause it is. A sentence that states only what is true —
*the invite link is still good, this browser still has what it needs* — survives a new
caller. ➡️ **Explanatory copy is the copy to re-read when a caller is added; descriptive
copy usually is not.**

**3. ⚠️ A NOTICE THAT OUTLIVED ITS SCREEN.** *"The other person has been told that you
ended the conversation"* — correct on the list where it is raised — was still on screen
when he started a pairing, where it reads as a statement about the invite link he was
making. `notice()` appends outside `SCREENS` and `only()` never touched it. **Older than
either of the above and nothing to do with §3.** Same shape though: **true where raised,
false where read.**

⚠️ The fix clears exactly one notice id on leaving the list, deliberately: the roster
warnings re-raise on every render, the offers are live, and the busy notices describe a
condition that is still true. **`purged` is the obvious next candidate and was left
alone until somebody looks at it** — a wider sweep is a change to panels nobody has
re-tested.

---

⭐⭐ **WHAT THE TEST DESIGN GOT RIGHT AND WHAT IT MISSED.** My probe blipped the network
for **six seconds**; the retry budget is **12.5**. Hannu tried **nine** and then
**sixteen to twenty** — **he bracketed the boundary and I had only ever tested inside
it.** ➡️ *When a fix introduces a threshold, the test that matters is the one that
crosses it.* Both sides are now probed, with the short blip as the control.

---

#### D-138 addendum, round 17 the same evening — and it is the FOURTH instance of one shape in one day

**PROTOCOL 0.9.14.** *"Sadly I had lost the invite link/code at that point in time."*

⚠️⚠️ **THE INTERRUPTION SWEPT AWAY THE ONE THING HE STILL NEEDED.** `failWith` called
`clearPairingSurface()` on every exit from §3, under a comment reading *"this is an exit
from the link screen too, **and the link on it is dead**"* (D-124). **That was true of
every exit that existed when it was written.** Rule 10 made some exits survivable that
morning; nothing asked this line whether it still applied.

⚠️ **And the clear is irreversible.** Rule 7's resumption re-enters the flow *at the
wait* and emits no secret — the link is emitted only by `initiate`. **There is no later
screen that can put it back**, so the pairing survived in full while the only copy of
the thing he had to send somebody did not. Now a non-terminal interruption keeps him on
the invite-link screen entirely, with the explanation and the two buttons as a notice.

⭐⭐⭐ **FOUR TIMES IN ONE DAY, THE SAME SHAPE:** §3.5's alarm (D-135), the failure panel
(D-138), `resume.made`'s *"this browser closed"* (D-138), and now `clearPairingSurface`.
**Every one was correct when written. Every one was made wrong by a change that added a
PATH to it rather than editing it.**

➡️➡️ **THE REGISTER OF WHAT A CHANGE TOUCHES IS NOT THE LINES IT EDITS — IT IS THE LINES
IT MAKES REACHABLE.** A diff shows the first list. A test run shows the first list. A
review reads the first list. **Nothing anywhere shows the second**, which is why a user
found all four.

⭐ **What I could NOT reproduce**, and say so rather than quietly fix: his *"going to
conversations, the CARRY ON is not immediately there."* A browser probe shows the offer
surviving that navigation. Either something differs on a phone or that tab was still
running the morning's build — **his 14-second timing says it was not**, since the
pre-fix client failed on the first poll. **Recorded as unreproduced, not as absent.**

### D-137. ⭐⭐⭐ A specification's SILENCE gets implemented anyway — and the guess was written down where no review looks

**2026-08-20. `PROTOCOL.md` §3.4.1b rules 6, 10 and 11, and §9.2. Raised by Hannu at
feedback round 13 as "carry on where I left off", measured 2026-08-20, decided by Hannu
the same day.** Three defects, one cause each, none of them a bug in the ordinary sense
— **every one is a behaviour the document never specified and the implementation
therefore had to invent.**

⚠️ **THE MEASUREMENT CAME BEFORE THE ARGUMENT, AND IT HAD A NEGATIVE CONTROL.** Real
Chrome, real IndexedDB, the real Go server on `:8099`, the throwaway Postgres on
`:5433`. The control arm differed in exactly one variable — no network blip — and ran
the same waits, the same reload and the same unlock:

| arm | one variable | result |
|---|---|---|
| **CONTROL** | no blip | record intact · carry-on offered |
| **A** | six-second offline blip | **record destroyed · no carry-on offered** |
| **B** | was the abandonment `DELETE` sent? | **no** — server still answers `{"status":200,"state":"open"}` |
| **C** | poll rate | 13 polls in 10 s, 752 ms apart, **nothing stops it but the TTL** |

⭐ Arithmetic, labelled as arithmetic and not measured: ~114,894 polls over 24 h against
~798 at ten minutes. **144×, which is D-136's factor exactly.**

---

**What each one actually was.**

**A — the record's life was bounded by the ATTEMPT, not by the pairing.** §3.4.1b names
three occasions for discarding the record: expiry (rule 4), replacement (rule 5),
abandonment (rule 6). **It never says what happens when an attempt simply fails.** The
client had to do something, chose *discard*, and put its reasoning in a source comment:
*"a record kept past a failure is a live link secret at rest with nothing left to do."*
That sentence is **true of a terminal failure and false of a transient one**, and the
code applied it to both. ➡️ Rule 10 now splits them, and makes the unclassifiable case
transient — because deleting in error destroys the only private key matching a
published commitment and **nobody can recover it**, while keeping in error leaves
something sealed (rule 3), expiry-bounded (rule 4) and cancellable (rule 6). The two
mistakes are not the same size.

⚠️⚠️ **A's SYMPTOM IS BACKWARDS, WHICH IS WHY IT SAT THERE.** The record survived the
browser being **killed** — no unwind runs, so nothing deleted it — and was destroyed by
**six seconds offline** with the pairing still valid for hours. The hardest failure was
survivable; the softest was not. Nobody tests in that direction. On a phone, wifi →
cellular *is* the softest one.

**B — rule 6's occasions were all about tidiness, never about going wrong.** Leaving a
screen, discarding an expired record, replacing one. "The pairing ended in an error" is
on none of them, so no `DELETE` was sent and the link stayed claimable for a day with
nobody able to finish it. ➡️ Rule 6 gains rule 10's occasion, **role-qualified to the
initiator**: a J holding an offer that failed `mac_I` is not a party to that session,
and one already claimed is carrying §3.5's evidence the initiator is still entitled to
read. **Deleting either destroys another party's state on a guess.**

⚠️ The ordering trap is now normative too: `pairing_id` derives from `L`, which is *in
the record being discarded*, so the `DELETE` must be prepared before the clear. An
implementation that clears first has thrown away the only input to the request it owes.

**C — the poll read its bound off the only number in scope.** §3.3 and §3.4 say "poll
`/status`" and never say for how long, so the deadline became the session TTL. At ten
minutes those were the same number; since D-136 they differ by 144×. ➡️ Rule 11 bounds
*active* polling (ten minutes recommended — the entire pre-D-136 pairing window), stops
it entirely while the document is hidden, and then rests on the carry-on offer.
**The link is untouched: the session stays claimable for its full TTL, only the watching
stops.** Backoff was considered and rejected — it puts the added delay at the one moment
both users are together and looking.

---

⭐⭐⭐ **THE FINDING. A SPECIFICATION'S SILENCE IS NOT A GAP IN THE PRODUCT, IT IS AN
UNREVIEWED DECISION IN THE CODE.** Something had to happen when the pairing failed, so
something does — chosen by whoever wrote the `finally`, argued in a comment, consistent
with itself, covered by passing tests, and **present in no document.** There is no gate
for this. A correctness review reads the code against the spec and finds no conflict,
*because the spec says nothing to conflict with.*

➡️ **A normative section owes an account of its failure paths, not only of its happy
one.** Rules 4, 5 and 6 were all about a pairing ending tidily. Not one was about a
pairing going wrong — which is the only branch a user meets on a bad train.

⚠️⚠️ **AND D-136's BLAST RADIUS IS FOUR, NOT THREE — the fourth is on the SERVER.**
`server/internal/api/router.go` exempts §3's reads from per-IP rate limiting, and
records the size of that concession in a comment: *"both roles poll for up to ten
minutes, and the sessions they poll are bounded by the TTL."* D-136 raised the TTL to
a day, touched `internal/store/pairing.go`, and **never touched the router** — the file
was last edited two days before. So a **wrong reason** sat above a live exemption for a
day, and the next person to reason from it would have reasoned from a false premise.

⭐ **The exemption is still right; a per-IP counter there would fire on the honest
resumed session and on nobody else.** What was wrong is that the number it was granted
against had silently become someone else's. §9.2 now states the exemption — it had
never mentioned it at all — and names rule 11 as the bound it had been relying on
without anyone writing that bound down.

➡️➡️ **The security question about D-136 was asked properly and answered properly**
(§2.2a's arithmetic, D-101's sixteen-character precondition, and §2.2a's own 24-hour
column). **The OPERATIONAL question was never asked at all**, and the constant walked
into a failure policy, a loop bound, a poll budget and a rate-limit exemption. Three of
those four cite no constant anywhere. **A constant's citations are not its blast
radius.**

---

### D-136. The invite link lives a day, and the creator is told so

**2026-08-19. `PROTOCOL.md` §1 and §3.4.1b rule 9. Asked for by Hannu, and it is the
second half of what round 4 asked for.** `store.PairingTTL` 10 min → 24 h,
`PAIRING_TTL_SECONDS` 600 → 86400.

⭐ **The precondition was already met and the arithmetic was already done.** Rule 9
permits raising the TTL only at §2.2's sixteen characters (§2.2a, D-101), and sixteen
is the built length. §2.2a's own table carries the 24-hour column: 16 chars (80 bits)
is ~1 in 6 × 10⁶ of the keyspace to a thousand GPUs over a day. **The decision to make
was therefore not "is this safe" — that was settled when the code was lengthened — but
"who has to be told".**

⚠️⚠️ **THE HAZARD IS REAL AND IT IS NOT CRYPTOGRAPHIC.** §3.4.1a named it:
*"A day-long link that the user forgets is a day-long claimable secret."* The
abandonment `DELETE` cannot be sent from `pagehide` (`sendBeacon` is POST-only; a
`fetch` from an unloading page is unreliable on mobile — which is the case that
matters), so a creator who closes the browser leaves the link claimable for the rest of
the day. **Nothing on the server can fix this; the only party who can end the link
early is the person holding it.** Hence Hannu's condition on the change — *"it needs to
be told to the creator"* — which is not a copy preference but the mitigation.

⭐⭐⭐ **AND WRITING THAT SENTENCE FOUND ONE THAT HAD BEEN FALSE SINCE THAT MORNING.**
The link screen said *"Keep this tab open… close it and the invite link cannot be
finished, and you will both need a new one."* True for as long as the pairing lived in
`sessionStorage`; false the moment D-134's record survived the tab. Its own comment
read *"until it is built this sentence is the fix"* — it was built, and the sentence
stayed. ➡️ **A feature does not update the prose describing it, and prose stating what
the product CANNOT do is the kind with an expiry date.**

⭐⭐ **The repair is two strings, because it is two modes.** Ghost writes nothing
durable (§3.4.1b rule 2), so the old warning is still exactly right there; Kept now
says the opposite. One string could only have been right for one of them — and the
copy gate's assertion had to be split the same way, with the Kept half asserting the
negation of what it used to demand.

⚠️ **`spell()` has no word past sixty, and that is why the unit changed rather than
the number.** Every sentence said `plural(minutes(TTL), "minute")`, which at 86400
would have read *"1440 minutes"* — digits, visibly wrong, rather than a confident wrong
word. That lookup table failing loudly is what made the change safe to make. A `span()`
helper now chooses the unit, on exact divisions only: *"about a day"* is a different
promise from the one the constant makes.

⭐ **What did NOT need changing, and why it is worth recording**: §3.6.1's commitment
means the SAS grinding attack is not bounded by the clock. Each attempt costs a whole
fresh pairing that both users watch fail, so a day of wall-clock buys an attacker no
extra attempts against one pairing. The lifetime-sensitive quantity was always §2.2's
code, and D-101 settled it separately.

### D-135. Opening your own invite link is a resumption, not an interception — and §3.5's alarm was written for the joiner

**2026-08-19. `PROTOCOL.md` §3.4.1b rule 7 and §3.5. Reported by Hannu against the
deployed build, within the hour of the deploy.** Shipped as `lpm 7928340`.

An initiator whose tab had closed, reopening its **own** invite link, was told
*"Somebody else opened this invite link before you… Treat the invite link as
compromised."* The friend's legitimate claim — the thing sending somebody a link is
**for** — was rendered as interception, to the person who created the link.

⭐⭐⭐ **THE RULE WAS CORRECT AND IT WAS ABOUT SOMEBODY ELSE.** §3.5's closing block
opens *"The same machinery answers the question a joiner asks on arrival"* and reasons
throughout about J: J may find the session already `CLAIMED`; if the accepted claim's
MAC verifies, someone holding `L` got there first. **Every word of that is true of a
joiner.** The client ran it for whoever opened a link — and until the day before, that
could only ever *be* a joiner. An initiator whose tab had closed held no record and
could not reach the screen at all.

➡️➡️ **D-134 DID NOT INTRODUCE THIS DEFECT. IT MADE AN EXISTING ROLE-SCOPED RULE
REACHABLE BY THE ROLE IT WAS NEVER WRITTEN FOR.** The same shape as D-087 (a rule
written for one of two *modes*, obeyed in both) and round 1's joiner notice (a sentence
written for one *role*, shown to both) — the third instance, and the first where the new
reachability arrived with a feature shipped the same week. ⚠️ **So the question a new
feature owes every rule it touches is not "is this rule still correct" — it is "who can
now reach it".** §3.5 was as correct on the day it broke as on the day it was written.

⚠️ **`claimIsOurs` does not reach it, and that is the whole difficulty.** The fix
shipped hours earlier asked *whose CLAIM is this* and answered with `mac_J`. Here the
claim really is somebody else's, correctly, and its MAC really does verify — a valid MAC
only proves somebody held `L`, and the legitimate joiner does. The discriminator is not
whose claim it is but **whose LINK it is**, and the answer was already on the device: a
§3.4.1b record with role I for the same `L`. Rule 7 then applies unchanged — such a
device is a resumed I and *"continues at §3.3"*.

⭐ **It runs BEFORE the `GET`, and that is load-bearing.** A resumed I recomputes its
commitment from its own stored key. Reading `commit` off the offer would verify the
friend's claim against a value the **server** chose, which is the substitution §3.6.1
exists to stop.

⚠️⚠️ **AND THE REPORTED HALF WAS THE CHEAP HALF.** With no claim yet on the session, the
old path fell through and the device **claimed its own offer** — overwriting the I
record with a J one, destroying the only private key matching the published commitment,
and leaving the pairing unfinishable **by either side, silently, with nothing on
screen**. Rule 7 already forbade exactly this (*"Neither re-creates nor re-claims"*);
nothing had been able to reach it before. ➡️ **A silent sibling found by re-reading the
rule the reported bug pointed at — the reported symptom was the loud one, not the worst
one.**

Also closed in the same branch: a superseded *"Carry on"* offer is now cleared when a
pairing starts by any other route. A real-browser probe found the completed six digits
sitting under a live *"Cancel that invite link"*, which would have sent §3.4.1's
abandonment `DELETE` for a pairing that had already finished.

**Both directions sabotage-proved**: forcing the check false reproduces his sentence
verbatim; forcing it true fails loudly with `claim_forged`, because §3.3's checks are
against the device's own key. 243 assertions pass.

⚠️ **Why this entry is dated a day late, which is a finding of its own.** The change
shipped with its entire rationale **in a git commit message and nowhere in this
register**, which ran 134 → 136 for a day. A gap in the numbering reads as a *deletion*,
and a rationale in a commit message is not in the document §0 makes normative. That is
`feedback_legal_text_drift`'s class with the direction reversed — not prose going stale
after the code, but **prose never written at all**, which no gate can detect because
there is no sentence for it to check.

### D-134. Resumable pairing is decided: same browser, sealed record — and the durable store is LESS exposed than the ephemeral one

**2026-08-18. This supersedes D-100's "not now" and is specified in `PROTOCOL.md`
§3.4.1b (protocol 0.9.10).** D-100 costed the feature on 2026-08-13 and declined it
for scope: the first tester round was next, and §3 is the one path in this product
where a mistake is a man-in-the-middle. That round has happened — eleven of them, in
the event — and the reason for waiting is spent.

⚠️ **What is decided is narrower than what D-100 costed.** Same browser only, Kept
mode only, the existing ten-minute TTL, no new message and no new endpoint. The
day-long link is a **separate** change (one server constant) and is deliberately not
taken here, because §3.4.1a's point 1 established that the two are separable: a
longer link does not make pairing asynchronous, since §3.6.1 forbids I revealing
before J has claimed. **A longer link lets the friend *start* sooner; resumption is
what lets either side *finish* later, and it is the half that needed a decision.**

⭐⭐ **The finding that decided it: moving the record to durable storage REDUCES the
exposure, which is the opposite of how it sounds.** §3.4.1 puts `L` and a live
private key in `sessionStorage` — which is persisted, in plaintext, on disk, for the
whole pairing window. §3.4.1b puts the same record in IndexedDB sealed under
`local_key`, and `local_key` derives from a memory-only `K_master`. So a closed
browser holds a link secret **it cannot read until the passphrase is typed back in.**

⚠️⚠️ **This is the second time this exact question has been answered by reading
§3.4.1 rather than by reasoning about it.** D-100 found that the client's copy had
refused resumable pairing on the grounds that it *"would put a live key on disk"* —
while §3.4.1 said in as many words that `L` reaches disk today. The refusal was
wrong then for the same reason the intuition is wrong now: **the ephemeral store was
never ephemeral on disk, and the difference between the two stores is lifetime and
encryption, not disk.** ➡️ *A reason that has been refuted once in a document will
be believed again by the next person who does not open that document.*

**What the decision costs, stated:**

- `L` at rest for the pairing's life — but **sealed**, where it was plaintext.
- **§7.6 Ghost cannot have it**, so this is the one feature that differs between the
  two modes, and §3.4.1b requires the interface not to offer it there. A control
  that silently does nothing is worse than no control.
- **§3.4.1's abandonment `DELETE` becomes load-bearing**, so §3.4.1b restates it as
  MUST/SHOULD rules rather than advice.
- The `conversation` store, **not** `durable`: a pairing in progress is conversation
  state and §7.8's ending must take it. `durable` is the store an ending spares, and
  a live link secret must never be in it.

**What it does not cost:** the commitment, the SAS, the tripwire, `R`'s derivation.
§3.4.1a point 4 established that every one of them is indifferent to where the two
secrets waited, and §3.4.1b relies on exactly that and adds nothing to §3's wire.

⚠️ **One hazard is new and is written into §3.4.1b as a MUST NOT**: a resumed I must
not re-`POST` its offer and a resumed J must not re-claim. The server would refuse,
and a client that reads that refusal as *start over* spends a link that was still
good — worse, `already_claimed` in answer to a client's **own** earlier claim would
raise §3.5's tripwire against itself, and an alarm that cries wolf is an alarm the
user learns to dismiss.

---

## Assigned to Claude Code

Hannu: *"'shared mailbox eats its own messages' and 'forward-secrecy claim' I am
unable to solve or recommend so it will be your tasks."*

| Item | Status | Notes |
|---|---|---|
| **REVIEW B1** — directional mailboxes | ✅ **Done** — PROTOCOL 0.2 | `lpm-mailbox-i2j-v1` / `lpm-mailbox-j2i-v1`, with matching `lpm-mbauth-*` seeds. Roles were already fixed at pairing and stored in the roster, so it added no state. Written into §4.2, §4.3, §5.1 and §6.4. |
| **REVIEW B2** — forward-secrecy claim | ✅✅ **DONE AND MEASURED 2026-08-08 — the gate is lifted** | §6.2 states what is true, and it is now a measurement rather than a derivation (`SPIKE_RESULTS.md`, D-033): `R` plus stored ciphertext decrypts *backwards* through **the initiator's whole sending chain 0 — 2000 of 2004 messages when chain 0 was 2000 long — and nothing after it.** ⚠️ The "shrinks the exposure from ~two turns to one" claim written here on 2026-08-04 was **wrong**: `eph` is not Olm's initial ratchet key, so it never shrank anything, and its `eph_pub` wire field is deleted. The property held for a different reason than we thought. **Open item 8 CLOSED**, and §6.2 now carries the public sentence it licenses. |
| **REVIEW B3** — PoW budget | ✅ **Done, and the proposed fix was rejected** | 7-day epochs (÷7) minus directional mailboxes (×2) = 3.5× fewer solves: 20 per week for a 10-channel user, spread evenly by the per-channel offset. Affordable, so PoW stands. The "authorise epoch `e` by signing with epoch `e-1`'s key" idea is **rejected** — it hands the server a logged *proof* that two mailboxes are the same channel, converting §4.3's cryptographic unlinkability into something it can record directly, and it needs a PoW fallback for dormant channels anyway. |
| Fold accepted items into PROTOCOL.md | ✅ **Done 2026-08-04 — PROTOCOL.md is now v0.2** | One pass, as planned. Full change list in `PROTOCOL.md` §13. `ARCHITECTURE.md` and `ROADMAP.md` updated to match: the dead Supabase-idle-cost premise replaced with the honest shape argument, "self-hosted" struck for EU-hosted, the duplicate 7-day reaper removed, the `status` endpoint added, Phase 0.5 written in as a phase, and the standing-decisions table extended. Two new defects surfaced during the fold — see D-011. |
