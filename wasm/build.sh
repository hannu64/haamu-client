#!/usr/bin/env bash
# Build the LPM Olm wrapper reproducibly.
#
# `ARCHITECTURE.md` §7.1: "Anyone cloning the GitHub repo at a given tag must
# produce a byte-identical bundle... a build that is not reproducible is a
# release blocker." The `.wasm` is the largest artefact in the client and the one
# that performs every cryptographic operation, so it is the file that most needs
# this and the hardest one to get.
#
# Three things make a build reproducible and this script asserts all three rather
# than assuming them, because a recorded hash produced by an unknown toolchain
# records nothing:
#
#   1. the compiler       — rust-toolchain.toml, asserted below
#   2. the dependencies   — Cargo.lock + `--locked`
#   3. the post-processors— wasm-bindgen and wasm-opt, pinned by version here
#
# and two things that would otherwise vary per machine are pinned by hand:
#
#   4. absolute paths     — --remap-path-prefix, because panic locations from
#                           this crate and from ~/.cargo end up in the binary
#   5. the clock          — SOURCE_DATE_EPOCH
#
# Usage:
#   ./build.sh            build, then verify against the committed SHA256SUMS
#   ./build.sh --record   build, then WRITE SHA256SUMS (intentional changes only)

set -euo pipefail
cd "$(dirname "$0")"

RECORD=0
[[ "${1:-}" == "--record" ]] && RECORD=1

# The wrapper is not a source of history, so a fixed epoch is honest here: the
# artefact depends on the source, not on when it was built.
export SOURCE_DATE_EPOCH=0

# --- 1..3: assert the toolchain -------------------------------------------
want_rust=$(grep -oP 'channel\s*=\s*"\K[^"]+' rust-toolchain.toml)
want_bindgen=$(grep -oP 'wasm-bindgen = "=\K[^"]+' Cargo.toml)
want_opt=131          # binaryen; `wasm-opt --version` prints "wasm-opt version N"
want_vodozemac=$(grep -oP 'vodozemac = \{ version = "=\K[^"]+' Cargo.toml)

have () { command -v "$1" >/dev/null 2>&1 || { echo "missing tool: $1" >&2; exit 1; }; }
have cargo; have rustc; have wasm-bindgen; have wasm-opt; have sha256sum

assert () {  # assert <what> <want> <have>
  if [[ "$2" != "$3" ]]; then
    echo "FAIL  $1 is $3, this build is pinned to $2" >&2
    echo "      A hash recorded by a different toolchain records nothing." >&2
    exit 1
  fi
  printf '  %-14s %s\n' "$1" "$3"
}

echo "pinned toolchain:"
assert rustc      "$want_rust"     "$(rustc --version | cut -d' ' -f2)"
assert wasm-bindgen "$want_bindgen" "$(wasm-bindgen --version | cut -d' ' -f2)"
assert wasm-opt   "$want_opt"      "$(wasm-opt --version | sed -E 's/.*version ([0-9]+).*/\1/')"
assert vodozemac  "$want_vodozemac" \
  "$(grep -A1 'name = "vodozemac"' Cargo.lock | grep -oP 'version = "\K[^"]+')"

# --- 4: absolute paths out of the binary ----------------------------------
# Panic locations from this crate and from every dependency are string data in
# the module. Without these two, two people building identical source at
# different paths get different bytes.
CARGO_HOME_DIR="${CARGO_HOME:-$HOME/.cargo}"
export RUSTFLAGS="--remap-path-prefix=$PWD=/lpm/client/wasm --remap-path-prefix=$CARGO_HOME_DIR=/cargo"

echo
echo "cargo build --locked --release --target wasm32-unknown-unknown"
cargo build --locked --release --target wasm32-unknown-unknown

RAW=target/wasm32-unknown-unknown/release/lpm_olm_wasm.wasm
rm -rf dist && mkdir -p dist

# --- the web target, and only the web target ------------------------------
# ⚠️ wasm-bindgen rewrites the module differently per target, so a `nodejs` build
# and a `web` build are DIFFERENT BYTES. Building both would mean the tests
# exercise one artefact and the client serves another — and the whole point of
# §7.1 is that the shipped bytes are the checked bytes. So only `web` is built,
# and `test/harness.mjs` drives that exact file from Node.
wasm-bindgen --target web --out-dir dist --out-name lpm_olm_wasm "$RAW"

# wasm-opt after wasm-bindgen, never before: wasm-bindgen needs the custom
# section that carries the bindings, and -Oz would drop it.
wasm-opt -Oz --enable-bulk-memory --enable-sign-ext \
  -o dist/lpm_olm_wasm_bg.wasm.opt dist/lpm_olm_wasm_bg.wasm
mv dist/lpm_olm_wasm_bg.wasm.opt dist/lpm_olm_wasm_bg.wasm

# wasm-bindgen also emits .d.ts and a snippets dir we do not use; keep the two
# files the client actually loads so the manifest cannot drift from reality.
find dist -mindepth 1 ! -name lpm_olm_wasm.js ! -name lpm_olm_wasm_bg.wasm \
  ! -name lpm_olm_wasm.d.ts -delete

echo
( cd dist && sha256sum lpm_olm_wasm_bg.wasm lpm_olm_wasm.js ) > SHA256SUMS.new

if [[ $RECORD == 1 ]]; then
  mv SHA256SUMS.new SHA256SUMS
  echo "recorded SHA256SUMS:"
  sed 's/^/  /' SHA256SUMS
elif [[ -f SHA256SUMS ]]; then
  if diff -u SHA256SUMS SHA256SUMS.new > /tmp/lpm-wasm-hash.diff; then
    rm -f SHA256SUMS.new /tmp/lpm-wasm-hash.diff
    echo "reproducible: artefacts match the committed SHA256SUMS"
    sed 's/^/  /' SHA256SUMS
  else
    echo "FAIL  the build does not reproduce the committed SHA256SUMS" >&2
    sed 's/^/      /' /tmp/lpm-wasm-hash.diff >&2
    echo "      If the change was intended, rerun with --record." >&2
    exit 1
  fi
else
  mv SHA256SUMS.new SHA256SUMS
  echo "no SHA256SUMS existed; recorded:"
  sed 's/^/  /' SHA256SUMS
fi

echo
ls -l dist | sed 's/^/  /'
