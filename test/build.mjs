/* The build stamp against the bytes it claims to describe.
 *
 * ⚠️⚠️ THIS GUARD IS THE WHOLE FEATURE. `app/build.js` exists so that a tester's
 * diagnostics panel can say whether the page in front of them is the code the server
 * has. A stamp that somebody forgot to regenerate says "current" while the page is
 * stale — which is not a smaller version of the same instrument, it is the instrument
 * lying in precisely the case it was built for. Nothing else in this suite can catch
 * that, because a stale stamp breaks no behaviour and no test that reads behaviour.
 *
 * ⭐ So the rule is mechanical: the suite does not pass while `app/build.js` disagrees
 * with `stamp.sh`. Forgetting is then impossible rather than merely discouraged, and
 * the failure names the one command that fixes it.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { check, equal, section, done } from "./harness.mjs";
import { BUILD } from "../app/build.js";

const scriptPath = fileURLToPath(new URL("../stamp.sh", import.meta.url));

section("the stamp is a plausible stamp at all");
check("`BUILD` is 16 hex characters", /^[0-9a-f]{16}$/.test(BUILD), `got "${BUILD}"`);

section("the stamp matches the tree it is a stamp of");
const computed = execFileSync(scriptPath, ["print"], { encoding: "utf8" }).trim();
equal("`app/build.js` is up to date  (fix: run `client/stamp.sh`)", BUILD, computed);

/**
 * ⭐ The stamp has to CHANGE when the served bytes change, or the freshness check in
 * the diagnostics panel compares two equal values for ever and reports "current" no
 * matter what. Editing a served file for real is not something a test may do, so the
 * property is asserted where it comes from: the hash covers file CONTENTS and file
 * NAMES, so both an edit and a rename move it.
 */
section("and it is a hash of contents and names, not of a file list");
const listing = execFileSync("/bin/sh", ["-c", `cd "$(dirname "${scriptPath}")" && sed -n '/^compute()/,/^}/p' stamp.sh`], {
  encoding: "utf8",
});
check("names are hashed with contents (`sha256sum` per file, then over that)", /xargs sha256sum \| sha256sum/.test(listing), listing.trim());

section("the generated file is generated, and says so");
const source = execFileSync("/bin/cat", [fileURLToPath(new URL("../app/build.js", import.meta.url))], { encoding: "utf8" });
check("it warns against hand editing", /do not edit by hand/i.test(source));
check("it names the script that writes it", /stamp\.sh/.test(source));

done();
