#!/usr/bin/env bash
# Build the Argon2id module reproducibly.
#
# Same discipline as `client/wasm/build.sh` and for the same reason
# (`ARCHITECTURE.md` §7.1: "a build that is not reproducible is a release
# blocker"). This artefact deserves it at least as much as the Olm wrapper does:
# it is the function that turns a person's phrase into every key they own, and a
# byte of drift in it is a lost roster.
#
# What makes a build reproducible, asserted rather than assumed:
#
#   1. the compiler       — rust-toolchain.toml, asserted below
#   2. the dependencies   — Cargo.lock + `--locked`
#   3. the post-processor — wasm-opt, pinned by version here
#   4. absolute paths     — --remap-path-prefix, because panic locations from
#                           this crate and from ~/.cargo end up in the binary
#   5. the clock          — SOURCE_DATE_EPOCH
#
# There is no wasm-bindgen step, deliberately — see Cargo.toml.
#
# Usage:
#   ./build.sh            build, then verify against the committed SHA256SUMS
#   ./build.sh --record   build, then WRITE SHA256SUMS (intentional changes only)

set -euo pipefail
cd "$(dirname "$0")"

RECORD=0
[[ "${1:-}" == "--record" ]] && RECORD=1

export SOURCE_DATE_EPOCH=0

want_rust=$(grep -oP 'channel\s*=\s*"\K[^"]+' rust-toolchain.toml)
want_opt=131          # binaryen; `wasm-opt --version` prints "wasm-opt version N"
want_argon2=$(grep -oP 'argon2 = \{ version = "=\K[^"]+' Cargo.toml)

have () { command -v "$1" >/dev/null 2>&1 || { echo "missing tool: $1" >&2; exit 1; }; }
have cargo; have rustc; have wasm-opt; have sha256sum

assert () {  # assert <what> <want> <have>
  if [[ "$2" != "$3" ]]; then
    echo "FAIL  $1 is $3, this build is pinned to $2" >&2
    echo "      A hash recorded by a different toolchain records nothing." >&2
    exit 1
  fi
  printf '  %-14s %s\n' "$1" "$3"
}

echo "pinned toolchain:"
assert rustc    "$want_rust"   "$(rustc --version | cut -d' ' -f2)"
assert wasm-opt "$want_opt"    "$(wasm-opt --version | sed -E 's/.*version ([0-9]+).*/\1/')"
assert argon2   "$want_argon2" \
  "$(grep -A1 'name = "argon2"' Cargo.lock | grep -oP 'version = "\K[^"]+')"

CARGO_HOME_DIR="${CARGO_HOME:-$HOME/.cargo}"
export RUSTFLAGS="--remap-path-prefix=$PWD=/lpm/client/argon2 --remap-path-prefix=$CARGO_HOME_DIR=/cargo"

echo
echo "cargo build --locked --release --target wasm32-unknown-unknown"
cargo build --locked --release --target wasm32-unknown-unknown

RAW=target/wasm32-unknown-unknown/release/lpm_argon2_wasm.wasm
rm -rf dist && mkdir -p dist

# ⚠️ The Argon2 block array is one 128 MiB allocation, so the module needs bulk
# memory; sign-ext matches the Olm wrapper's build and is supported everywhere
# this client runs. Nothing here needs threads, and §7.2's `p=1` is why: the
# common WASM builds do not parallelise `p` anyway.
wasm-opt -Oz --enable-bulk-memory --enable-sign-ext -o dist/lpm_argon2.wasm "$RAW"

echo
( cd dist && sha256sum lpm_argon2.wasm ) > SHA256SUMS.new

if [[ $RECORD == 1 ]]; then
  mv SHA256SUMS.new SHA256SUMS
  echo "recorded SHA256SUMS:"
  sed 's/^/  /' SHA256SUMS
elif [[ -f SHA256SUMS ]]; then
  if diff -u SHA256SUMS SHA256SUMS.new > /tmp/lpm-argon2-hash.diff; then
    rm -f SHA256SUMS.new /tmp/lpm-argon2-hash.diff
    echo "reproducible: the artefact matches the committed SHA256SUMS"
    sed 's/^/  /' SHA256SUMS
  else
    echo "FAIL  the build does not reproduce the committed SHA256SUMS" >&2
    sed 's/^/      /' /tmp/lpm-argon2-hash.diff >&2
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
