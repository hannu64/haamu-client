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
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { check, equal, section, done } from "./harness.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const runners = read("../test.sh") + read("../../e2e.sh");

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
const orphans = asserting.filter((f) => !invoked(f) && !runOnce(f));

equal("⭐⭐⭐ no test file is left out of `test.sh` and `e2e.sh` (D-154)", orphans.join(", "), "");
check(
  "⚠️ and this file is one of the ones that is run, or it could not say so",
  invoked("suite.mjs"),
  `${asserting.length} test files of ${files.length}, all named by a runner`
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
