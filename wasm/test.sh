#!/usr/bin/env bash
# Build reproducibly, then run both suites against the artefact that was built.
#
# Order matters. `upgrade.mjs` runs LAST and is the one to read on a dependency
# bump: `e2e.mjs` will pass a broken derivation, because every check in it talks
# only to this build. Measured — with §6.2's HKDF output reversed, e2e passed
# 25/25 and upgrade caught it on the frozen ciphertext.

set -euo pipefail
cd "$(dirname "$0")"

./build.sh "$@"
echo
node test/e2e.mjs
echo
node test/upgrade.mjs
