#!/usr/bin/env bash
# Build the X25519/Ed25519 fallback module reproducibly.
#
# Same discipline as `client/wasm/build.sh` and `client/argon2/build.sh`, for the
# reason `ARCHITECTURE.md` §7.1 gives ("a build that is not reproducible is a
# release blocker") and one this artefact adds: it is the ONLY implementation of
# §0.2's two curves on the devices that run it. Nobody using it has a second
# opinion available, so "these are the bytes, and here is how you get them again"
# is the whole of what a reader can check.
#
# What makes a build reproducible, asserted rather than assumed:
#
#   1. the compiler       — rust-toolchain.toml, asserted below
#   2. the dependencies   — Cargo.lock + `--locked`, with the two that matter
#                           asserted by name
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
want_x=$(grep -oP 'x25519-dalek = \{ version = "=\K[^"]+' Cargo.toml)
want_ed=$(grep -oP 'ed25519-dalek = \{ version = "=\K[^"]+' Cargo.toml)

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

locked () {  # locked <crate name> — the version Cargo.lock actually pins
  grep -A1 "name = \"$1\"" Cargo.lock | grep -oP 'version = "\K[^"]+'
}

echo "pinned toolchain:"
assert rustc         "$want_rust" "$(rustc --version | cut -d' ' -f2)"
assert wasm-opt      "$want_opt"  "$(wasm-opt --version | sed -E 's/.*version ([0-9]+).*/\1/')"
assert x25519-dalek  "$want_x"    "$(locked x25519-dalek)"
assert ed25519-dalek "$want_ed"   "$(locked ed25519-dalek)"

CARGO_HOME_DIR="${CARGO_HOME:-$HOME/.cargo}"
export RUSTFLAGS="--remap-path-prefix=$PWD=/lpm/client/curve --remap-path-prefix=$CARGO_HOME_DIR=/cargo"

echo
echo "cargo build --locked --release --target wasm32-unknown-unknown"
cargo build --locked --release --target wasm32-unknown-unknown

RAW=target/wasm32-unknown-unknown/release/lpm_curve_wasm.wasm
rm -rf dist && mkdir -p dist

# The same two extensions the other artefacts enable, so that all three run
# wherever any of them does. Nothing here needs threads or bulk memory in
# particular — the buffers are static and there is no allocator — but a module
# built with a different feature set is a module with a different support floor,
# and one floor for three artefacts is easier to be right about than three.
wasm-opt -Oz --enable-bulk-memory --enable-sign-ext -o dist/lpm_curve.wasm "$RAW"

# ⚠️ An empty import list is a security property (see Cargo.toml), and it is
# checked HERE as well as in `test/curve.mjs` — because this is the step that
# produces the shipped bytes, and a test can be skipped by running the wrong
# command. A module with imports never reaches `dist/`.
imports=$(node -e '
  const b = require("fs").readFileSync("dist/lpm_curve.wasm");
  const names = WebAssembly.Module.imports(new WebAssembly.Module(b))
    .map((i) => `${i.module}.${i.name}`);
  process.stdout.write(names.join(" "));
')
if [[ -n "$imports" ]]; then
  echo "FAIL  the module imports something, and it must import nothing:" >&2
  echo "      $imports" >&2
  exit 1
fi
echo "  imports        none"

echo
( cd dist && sha256sum lpm_curve.wasm ) > SHA256SUMS.new

if [[ $RECORD == 1 ]]; then
  mv SHA256SUMS.new SHA256SUMS
  echo "recorded SHA256SUMS:"
  sed 's/^/  /' SHA256SUMS
elif [[ -f SHA256SUMS ]]; then
  if diff -u SHA256SUMS SHA256SUMS.new > /tmp/lpm-curve-hash.diff; then
    rm -f SHA256SUMS.new /tmp/lpm-curve-hash.diff
    echo "reproducible: the artefact matches the committed SHA256SUMS"
    sed 's/^/  /' SHA256SUMS
  else
    echo "FAIL  the build does not reproduce the committed SHA256SUMS" >&2
    sed 's/^/      /' /tmp/lpm-curve-hash.diff >&2
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
