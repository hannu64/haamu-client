#!/usr/bin/env bash
# Build reproducibly, then check that artefact.
#
# The order matters for the same reason it does in `client/wasm/test.sh` and
# `client/argon2/test.sh`: a test that runs against a stale `dist/` is a test of
# something that is not shipping.

set -euo pipefail
cd "$(dirname "$0")"

./build.sh "$@"
echo
node test/curve.mjs
