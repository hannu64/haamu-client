#!/usr/bin/env bash
# Write `app/build.js` from the bytes that actually ship.
#
# ⭐⭐ WHY THIS EXISTS. On 2026-08-20 a pairing fix was deployed, hash-verified on the
# server, and reported to the tester as done. He tried it, it failed, and he said so —
# and I believed him and spent an evening building probes for a bug I had already
# fixed. It had worked. His Android had restored a backgrounded tab without re-fetching
# anything, so he was looking at the OLD client while the server held the new one.
# Neither of us could tell, because nothing on the screen said which build was running.
#
# ⚠️⚠️ THE STAMP MUST BE DERIVED AND NOT TYPED. A hand-written version string that
# somebody forgets to bump reads "current" while the page is stale — an instrument that
# reports SOMETHING is the hardest kind of broken to notice, and it would fail in
# exactly the situation it was built for. So it is a hash of the served tree, and
# `test/build.mjs` refuses to pass while it is out of date.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
cd "$here"

# The served set, and only it: `test/`, the Rust `target/` directories and the shell
# scripts are not deployed, so a change in them is not a change the browser can see.
# `build.js` is excluded because a file cannot contain a hash of itself.
served_files() {
    find app src argon2/dist curve/dist wasm/dist -type f ! -name build.js | LC_ALL=C sort
}

# The names are hashed with the contents, so a renamed file is a new build too.
compute() {
    served_files | xargs sha256sum | sha256sum | cut -c1-16
}

write() {
    cat > app/build.js <<JS
/**
 * GENERATED FILE — do not edit by hand. Run \`client/stamp.sh\`.
 *
 * The first 16 hex of a hash over every file this client serves. It has no meaning on
 * its own; its whole job is to be DIFFERENT after a deploy, so that a page can fetch
 * this same file fresh and find out whether the code it is running is the code the
 * server currently has. See \`buildLine()\` in \`app/app.js\`, and \`stamp.sh\` for why.
 */
export const BUILD = "$1";
JS
}

case "${1:-write}" in
    print) compute ;;
    write)
        s="$(compute)"
        write "$s"
        # Adding build.js does not change the hash — it is excluded from the set — so
        # one pass is enough and a second would print the same answer.
        echo "$s"
        ;;
    *)
        echo "usage: stamp.sh [write|print]" >&2
        exit 2
        ;;
esac
