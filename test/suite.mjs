/* Does anything actually run the checks in this directory?
 *
 * ⚠️⚠️ THIS EXISTS BECAUSE THE ANSWER WAS ONCE NO, FOR THREE DAYS. `test/theme.mjs` was
 * written with D-139, asserted eighteen true things about the theme, and was named by no
 * script, no CI job and no document. It was found by accident, while adding the line
 * beside where its own line should have been. ➡️ **A GUARD THAT IS NEVER INVOKED IS THE
 * SAME AS NOT HAVING WRITTEN IT**, and a green suite is evidence only about the checks
 * that ran.
 *
 * So: every file in `test/` that is a test must be named by `test.sh` or by `e2e.sh`.
 *
 * ⭐ A TEST IS A FILE THAT IMPORTS THE HARNESS, which is a better question than "does it
 * contain `check(`" — the first version asked the second, and reported `harness.mjs`
 * itself, which is where `check` is DEFINED. Recognising them by what they import means a
 * helper that grows its first assertion becomes a test that has to be run, and nothing has
 * to be listed here: `derive.mjs` is a second implementation of the derivations that
 * `gen-vectors.mjs` reads, `samples.mjs` is a table, `harness.mjs` is the reporter.
 *
 * ⚠️ ONE FILE IS EXEMPT AND IT SAYS SO ITSELF. `gen-vectors.mjs` imports the harness but is
 * a run-once generator: regenerating the frozen vectors to make a failing test pass is the
 * one thing its own header forbids, so a runner must NOT call it. It is recognised by the
 * words **RUN ONCE** in its first lines rather than by being named here — the same
 * discipline `test/copy.mjs` uses for its exemptions, where matching the surrounding words
 * makes the exemption rot the moment the file stops being what it claimed.
 *
 * ⚠️ AND THIS FILE NAMES ITSELF. A checker that a runner forgot is the very thing it is for.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { check, equal, section, done } from "./harness.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
/* ⚠️⚠️ THE PUBLISHED CLIENT HAS NO `../../e2e.sh`, AND THE EXEMPTION THAT BUYS HAS TO BE
 * EXACTLY THE SIZE OF THE ABSENCE. `hannu64/haamu-client` ships `client/` alone: the
 * end-to-end suites are driven by the monorepo's `e2e.sh`, which is not published because
 * the SERVER is not published. So in that repository the `e2e-*.mjs` files are correctly
 * invoked by nothing — and every OTHER test must still be named by `test.sh`, or this
 * guard has been talked out of the job it exists for.
 *
 * ⚠️⚠️ AND THE SHAPE OF THE TREE IS ASSERTED RATHER THAN INFERRED FROM ONE FILE. Deciding
 * "we must be the published client" from a missing `e2e.sh` alone means that `e2e.sh`
 * going missing FROM THE MONOREPO would silently exempt every e2e suite — the guard
 * quietly weakening at the exact moment it should shout. A tree is one of two shapes, and
 * anything else fails below.
 */
const readIf = (p) => { try { return read(p); } catch { return null; } };

/* ⛔⛔ AND THE QUESTION IS ASKED FROM INSIDE THE TREE FIRST, BECAUSE `../../` IS NOT PART OF
 * THE PUBLISHED REPOSITORY AT ALL. In the monorepo `../../` is the project root and reading
 * it is reading ourselves. In `hannu64/haamu-client` the client IS the root, so `../../` is
 * whatever directory the reader happened to clone into. A stranger who runs
 *
 *     ~/src/server/            ← an unrelated project they already had
 *     ~/src/haamu-client/      ← git clone …
 *
 * was told *"monorepo: server present, so e2e.sh must be too"* and watched the test suite of
 * a security product fail on first run for a reason that has nothing to do with its code —
 * on a repository whose entire offer is *verify this yourself* (D-161). ➡️ **A TEST THAT
 * READS ABOVE ITS OWN ROOT IS READING SOMEBODY ELSE'S DISK**, and in the tree that most
 * needs it to be right it cannot tell the difference.
 *
 * So the published tree is recognised by something the publish step deliberately puts INSIDE
 * it: `DECISIONS.md` at the client root, which `scripts/publish-client.sh` copies in from
 * system-docs and which the monorepo's own `client/` therefore never has. ⭐ It is matched by
 * what it SAYS and not merely by its name — the same discipline `gen-vectors.mjs`'s exemption
 * uses, where a file that stops being the document it claimed stops being the marker.
 */
const isMarker = (text) => text !== null && /^# DECISIONS\.md\s/.test(text);
const PUBLISHED_BY_MARKER = isMarker(readIf("../DECISIONS.md"));

/* ⚠️⚠️ THE OLD INFERENCE IS KEPT AS A SECOND ROUTE RATHER THAN REPLACED. If the marker is
 * absent the tree must still be one of the two shapes, so D-160 holds exactly as it did: an
 * `e2e.sh` that goes missing FROM THE MONOREPO still fails loudly below instead of silently
 * exempting every e2e suite. The marker only ever ADDS a way to be recognised, so no tree
 * that passed before can start failing.
 *
 * ⚠️ And once the marker has spoken, NOTHING above the root is read — not even to report it.
 * A stray `e2e.sh` in the reader's own directory would otherwise be concatenated into
 * `runners` below, where it could mark a genuinely orphaned test as invoked: the failure
 * mode this guard exists to prevent, arriving through the guard itself.
 */
const e2eRunner = PUBLISHED_BY_MARKER ? null : readIf("../../e2e.sh");
const hasServer = PUBLISHED_BY_MARKER ? false : existsSync(new URL("../../server", import.meta.url));
const PUBLISHED = PUBLISHED_BY_MARKER || (!hasServer && e2eRunner === null);
const runners = read("../test.sh") + (e2eRunner ?? "");

/**
 * Is this file INVOKED, as opposed to merely mentioned?
 *
 * ⚠️⚠️ THE FIRST VERSION ASKED `runners.includes(name)` AND THAT WAS THE SAME MISTAKE ONE
 * LEVEL IN. Commenting out `node test/theme.mjs` left the words `test/theme.mjs` in the
 * file, so the check went on passing — **satisfied by a mention rather than by an
 * invocation**, which is precisely the distinction it exists to make. Both runners have
 * comments naming test files, several of them written in the same hour as this check, so
 * it was not a hypothetical. ➡️ A check for whether something RUNS has to look at the line
 * that runs it.
 */
const invoked = (name) => new RegExp(`^[^#\n]*\\bnode (client/)?test/${name.replace(".", "\\.")}\\b`, "m").test(runners);

section("every check in this directory is run by something");

const files = readdirSync(here).filter((f) => f.endsWith(".mjs"));
const asserting = files.filter((f) => /from "\.\/harness\.mjs"/.test(readFileSync(here + f, "utf8")));
const runOnce = (f) => /RUN ONCE/.test(readFileSync(here + f, "utf8").slice(0, 400));
const drivenByE2E = (f) => f.startsWith("e2e-");
const orphans = asserting.filter((f) => !invoked(f) && !runOnce(f) && !(PUBLISHED && drivenByE2E(f)));

equal("⭐⭐⭐ no test file is left out of `test.sh` and `e2e.sh` (D-154)", orphans.join(", "), "");
check(
  "⚠️ and this file is one of the ones that is run, or it could not say so",
  invoked("suite.mjs"),
  `${asserting.length} test files of ${files.length}, all named by a runner`
);

check(
  "⚠️⚠️ the tree is one of the two shapes it is allowed to be (D-160)",
  PUBLISHED || (hasServer && e2eRunner !== null),
  PUBLISHED_BY_MARKER
    ? "published client: recognised from INSIDE, and nothing above the root was read (D-161)"
    : hasServer
      ? "monorepo: server present, so e2e.sh must be too"
      : "published client: no server, so no e2e.sh — every e2e suite is driven from the monorepo"
);

/* ⭐ THE GUARD ON THE MARKER, AND IT IS ASKED BOTH HALVES OF THE QUESTION. A discriminator
 * that quietly stopped discriminating would hand EVERY tree the published tree's exemption,
 * which is the one outcome worse than the bug it was written to fix. The current tree only
 * ever exercises one half of it, so the other half is put to it here on strings this file
 * owns — the same reason `test/copy.mjs` carries a canary beside each of its exclusions.
 */
check(
  "⚠️⚠️ the marker is matched by what the document SAYS, not by its name (D-161)",
  isMarker("# DECISIONS.md\n\n**Decision log** — link-paired") &&
    !isMarker("# Decisions\n") && !isMarker("## DECISIONS.md\n") && !isMarker("") && !isMarker(null),
  "recognises the real opening; refuses a look-alike, a demoted heading, an empty file and an absent one"
);
check(
  "⚠️ the e2e exemption is taken only where it is earned, and covers only e2e files",
  !PUBLISHED || asserting.filter((f) => !invoked(f) && !runOnce(f)).every(drivenByE2E),
  PUBLISHED ? "published client" : "monorepo — no exemption applied at all"
);

// ⭐ The guard on the guard, twice. If the directory listing or the assertion pattern ever
// stopped matching, the check above would pass on an empty list and say nothing at all.
check(
  "⚠️ there are test files to find, and helpers correctly not counted among them",
  asserting.length > 15 && files.length > asserting.length,
  `${files.length - asserting.length} helpers: ${files.filter((f) => !asserting.includes(f)).join(", ")}`
);

// ⭐ The exemption has to still be the file it was written for. If `gen-vectors.mjs` ever
// loses that header, or somebody adds the words to a real test, this says so.
equal(
  "⚠️ exactly one file exempts itself, and it is the generator that must not be re-run",
  asserting.filter(runOnce).join(", "),
  "gen-vectors.mjs"
);

done();
