#!/usr/bin/env bash
# Every check on the client crypto module, in the order that a failure is easiest
# to read: primitives first, then behaviour, then the frozen answers, then the
# other implementation.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
cd "$here"

echo "=== rfc.mjs — the primitives against published test vectors ==="
node test/rfc.mjs

echo
echo "=== unit.mjs — the refusals and bounds checks ==="
node test/unit.mjs

echo
echo "=== session.mjs — §6.3's session rules and §6.7's payload ==="
# No server, no WASM, no clock: the awkward cases — a simultaneous split, a device
# whose own state is gone, a generation that went backwards — are pure functions
# here and scenarios everywhere else. The parts that need real ciphertext are in
# ../e2e.sh.
node test/session.mjs

echo
echo "=== binding.mjs — §6.7.2, over a hostile mailbox with no server ==="
# ⚠️⚠️ THE ONLY THING FAKED HERE IS THE TRANSPORT, and that is what lets a security
# property be guarded where a stranger will actually run it. `e2e-message.mjs` proves
# the honest path against the real Go server and CANNOT run in the published client
# repository — there is no `../server` there, and the tail of this script says so and
# exits 0. A generation the server rewrote in transit must never reach the roster; that
# rule would otherwise be guarded only in a file the public repository skips.
node test/binding.mjs

echo
echo "=== relay.mjs — I2, the property no single review slice could see ==="
# ⚠️⚠️ I2 came back "UNPROVEN IN THIS SLICE" from all three reviewers of 2026-08-24,
# each blind to a different quarter of it. The pass that followed found the property
# WAS tested — in `e2e-pair.mjs`, which needs ../server and is skipped in the
# published tree. haamu's strongest claim was guarded only where a stranger who
# clones the public repository never runs it. This is that proof, as arithmetic.
node test/relay.mjs

echo
echo "=== inflight.mjs — §3.4.1b, when the browser refuses to save the record ==="
# ⚠️ Same reason as `binding.mjs` above: the real `initiate` runs against a fake api,
# so the property — that a device which could not save its half of a pairing SAYS so
# before the other party is committed — is guarded in a file a stranger who clones the
# public repository actually runs. `e2e-pair.mjs` needs ../server and is skipped there.
node test/inflight.mjs

echo
echo "=== stream.mjs — §5.3's transport policy ==="
# No browser, no server, no clock: a network that accepts connections and drops
# them two seconds later, a socket that is open and black-holed, and an epoch
# boundary that arrives once a week are each a number here and a scenario nobody
# can arrange in ../e2e.sh.
node test/stream.mjs

echo
echo "=== roster.mjs — §7.3's merge rules, freshness and padding ==="
# No server and no key derivation: the cases that matter here are two rosters that
# disagree, which is a scenario nobody can arrange against a live server on demand
# — and which ../e2e.sh cannot distinguish from the compare-and-swap loop doing the
# same job by another route. See the file header.
node test/roster.mjs

echo
echo "=== elsewhere.mjs — D-168, a second holder of the KEY, over a faked transport ==="
# ⚠️⚠️ THE TRANSPORT IS THE ONLY FAKE, for `binding.mjs`'s reason: `e2e-roster.mjs`
# proves the same path against the real Go server and cannot run in the published
# client repository, which ships no `../server`. What this product says about two
# devices on one KEY is the whole answer to the fault Hannu measured on 2026-08-26,
# and a guard a stranger's `./test.sh` skips is a guard for nobody.
node test/elsewhere.mjs

echo
echo "=== storage.mjs — what reaches disk, and under which key ==="
# No browser: `storage/db.js` ships a Map-backed handle with IndexedDB's own key
# ordering, so the layer that decides what is encrypted, under which key and into
# which store is tested here rather than once, slowly, inside Chrome.
node test/storage.mjs

echo
echo "=== tabs.mjs — §4.2's election, and §7.8 step 3's census ==="
# No browser: Web Locks and BroadcastChannel are modelled, which is honest about
# what this can show. It checks the POLICY — who leads, who is counted, and what an
# ending may CLAIM when the browser cannot answer "who else is running?". The
# platform guarantees underneath it (that a readwrite transaction is isolated
# across documents, that a lock is released when a tab is closed) are the browser's
# to keep, and `test/browser-tabs.mjs` is where they are asked for.
node test/tabs.mjs

echo
echo "=== ghost.mjs — §7.6's storage rule, and the item its list omitted ==="
# ⭐ No browser, and here that is the point rather than a limitation. A browser test
# watches a Ghost conversation work — and it works exactly as well with the message
# log in IndexedDB, which is the defect (D-072). What has to be asserted is WHERE
# the bytes went, and the cheapest place to see that is a Map with the keys still in
# it. The one thing this cannot show is that a browser really clones
# `sessionStorage` when a tab is duplicated; that is the platform's to keep.
node test/ghost.mjs

echo
echo "=== ending.mjs — §7.8's ORDER, §7.7's overwrite, §4.3's lock ==="
# ⚠️ The order is the subject, not the steps. Each step of §7.8 is easy to check and
# none of them is where the defect was: the ending cleared the database while the
# things that write to it were still running. A suite that ran the steps and
# asserted the end state would pass on the broken order, so these record the
# SEQUENCE and assert on that.
node test/ending.mjs

echo
echo "=== visibility.mjs — §3.4.1b rule 11, which has now been missed twice ==="
# ⚠️ D-140 taught rule 11 to the poll and not to the retry ladder; D-141 taught it to
# the parking and not to the budget wrapped around it. Both were bugs in how two
# correct mechanisms meet, and neither is visible in either mechanism alone. This pins
# the rule itself to something executable.
node test/visibility.mjs

echo
echo "=== theme.mjs — D-139's two duplications ==="
# ⚠️⚠️ THIS LINE WAS MISSING FROM 2026-08-20 UNTIL 2026-08-23, and the file was
# green the whole time because nothing ran it. `test/theme.mjs` was written to
# guard two copies that do not throw when they drift — `THEME_KEY` in a
# render-blocking script that cannot import it, and the dark palette written out
# twice because CSS cannot express it once — and it sat in `test/` referenced by
# no script, no CI job and no document. A guard that is never invoked is not a
# weaker guard than one that is; it is the same as not having written it.
# ⭐ Found while adding the line below it. See `feedback_verify_before_claiming`.
node test/theme.mjs

echo
echo "=== lang.mjs — D-154's boot script against the module it copies ==="
# ⭐ The theme's boot script copies a STRING, so its guard compares two literals.
# The language's boot script copies a DECISION with four inputs in a deliberate
# order, and two implementations of a decision can agree on every literal and
# still disagree on an answer. So this one runs both against the same matrix of
# browsers, addresses and stored choices and compares the conclusions.

node test/lang.mjs

echo
echo "=== copy.mjs — the prose against the constants it describes ==="
# ⭐ Nothing else in a build reads English. A number in a sentence is a copy of a
# decision made in another file, and PROTOCOL.md §8 has already shipped one that
# said "7 days" when the retention it described was 7 to 14.
node test/copy.mjs

echo
echo "=== copy-fi.mjs — the Finnish against the English it translates ==="
# ⭐⭐ It is deliberately not a second copy of the file above. Most of what the English
# gate checks, the Finnish inherits by AGREEING with an English sentence that has already
# been held to it — D-153's digits above all: if the English renders a number and the
# Finnish spells it out, the two disagree about numbers and this fails, with no Finnish
# numeral list to get wrong. What is here is what genuinely differs between the languages.
node test/copy-fi.mjs

echo
echo "=== app-document.mjs — the rules that exist because the app touches the document ==="
# ⚠️⚠️ THESE RULES HAD NO HOME AND THAT IS WHY THEY WERE BROKEN. `flow/*.js` never
# touches the document by design, so no flow suite can reach them; `copy.mjs` is about
# sentences; the `e2e-*` suites need a server and are exempted in the published tree, so
# a guard placed there would not run for somebody who clones the public repository and
# types `./test.sh`. The 2026-08-24 outside review found two defects sitting in exactly
# that gap — §2.1's strip of the invite link, and the ending page's title.
node test/app-document.mjs

echo
echo "=== suite.mjs — is anything running the checks in test/? ==="
# ⚠️⚠️ D-154: `test/theme.mjs` passed 18 checks for three days while no script, no CI job
# and no document named it. A green suite is evidence only about the checks that ran, so
# this asserts that every file in test/ making an assertion is named by a runner — and
# names itself, because a checker a runner forgot is the exact thing it is for.
node test/suite.mjs

echo
echo "=== build.mjs — the build stamp against the bytes it describes ==="
# ⭐ Cheap, and it guards the one thing no behavioural test can see. `app/build.js`
# tells a tester's diagnostics panel which build is in front of them; a stamp nobody
# regenerated reports "current" while the page is stale, which is worse than having no
# stamp at all. This fails until `client/stamp.sh` has been run.
node test/build.mjs

echo
echo "=== qr.mjs — §2.1.2's symbol, where a wrong number cannot be seen ==="
# ⚠️ A BROKEN QR SYMBOL LOOKS EXACTLY LIKE A WORKING ONE. Everything else in this client
# fails visibly when it is wrong; a symbol with one bad format bit is a square of black
# and white squares that nobody can fault and no camera can read. So these checks are on
# the module matrix, and the frozen digest at the end of that file was taken only after
# an independent encoder and an independent decoder had both agreed with it — the header
# says where they live and why they cannot live here.
node test/qr.mjs

echo
echo "=== vectors.mjs — the frozen protocol vectors ==="
node test/vectors.mjs

echo
echo "=== the server, on the same frozen vectors ==="
# ⭐ This is the check that matters most, and it is the only one that a second
# implementation can fail. PROTOCOL.md §5.2 spends a page on client and server
# building the canonical signing string differently: every request 401s,
# intermittently at first. Two languages agreeing on a frozen file is what rules
# it out.
# ⚠️⚠️ TWO REASONS THIS CAN BE ABSENT, AND THEY ARE NOT THE SAME REASON.
#
#   · `DECISIONS.md` at the root, or no `../server` — you are in the PUBLIC client
#     repository (haamu-client).
#     The server is not published, so this check cannot be run here and its
#     absence is expected. Everything above it did run: this is a complete pass
#     of the client. Reported and exit 0, because a reviewer who pastes
#     `./test.sh` must not be told the suite failed when it did not.
#
#   · `../server` exists but no Go — you are in the monorepo, on a machine that
#     cannot run the one check a second implementation can fail. That IS a
#     failure: §5.2's whole point is that client and server can agree with
#     themselves and disagree with each other. Exit 1, as before.
# ⛔⛔ AND WHICH OF THE TWO THIS IS, IS ASKED FROM INSIDE THE TREE FIRST (D-161). `../server`
# is the project root in the monorepo and SOMEBODY ELSE'S DIRECTORY in the published client,
# where this script sits at the root. A reader who cloned next to an unrelated `server/` was
# sent down the second branch and told the suite had failed — on the repository whose whole
# offer is that they can check it themselves. The published tree is therefore recognised by
# what `scripts/publish-client.sh` deliberately puts IN it, matched by its opening line and
# not merely by its name; `../server` stays as the second route, so nothing that passed
# before can start failing. `test/suite.mjs` makes the same distinction, for the same reason.
if [ -f DECISIONS.md ] && head -n 1 DECISIONS.md | grep -q '^# DECISIONS\.md[[:space:]]*$'; then
    published=yes
elif [ ! -d ../server ]; then
    published=yes
else
    published=no
fi

if [ "$published" = yes ]; then
    echo "  NOT AVAILABLE HERE: the server is not part of this repository."
    echo "  §5.2's cross-implementation check runs in the private monorepo, where"
    echo "  the Go server reads the same frozen file: client/test/vectors/lpm.json."
    echo "  Every client suite above passed."
    echo
    echo "all client suites passed"
    exit 0
elif command -v go >/dev/null 2>&1; then
    ( cd ../server && go test ./internal/api/ -run TestProtocolVectors -count=1 )
else
    echo "  SKIPPED: no Go toolchain here." >&2
    echo "  The client alone cannot prove §5.2 interoperates. Run this before shipping." >&2
    exit 1
fi

echo
echo "all suites passed"
