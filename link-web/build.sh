#!/bin/sh
# Build public/link/wgcore.wasm: wgcore (vendor/, copied from WonderswanCartDumper wondergate/core) for the
# browser Link. Needs clang with the wasm32 target, wasm-ld (brew install lld), and wasm-opt (brew install
# binaryen). The output is committed, so CI doesn't need these.
set -eu
cd "$(dirname "$0")"
OUT=../public/link/wgcore.wasm
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
clang --target=wasm32 -std=c99 -O2 -ffreestanding -nostdlib -fno-builtin -Iinclude -Wall -Wno-unused-parameter \
  -fuse-ld="$(command -v wasm-ld)" -Wl,--no-entry -Wl,--allow-undefined -Wl,--export=memory \
  -o "$TMP/raw.wasm" vendor/wg.c libc.c glue.c
wasm-opt -O2 --asyncify --pass-arg=asyncify-imports@env.js_sock_recv -o "$OUT" "$TMP/raw.wasm"
echo "$(wc -c < "$OUT" | tr -d ' ') bytes -> $OUT"
