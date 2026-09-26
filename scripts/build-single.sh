#!/usr/bin/env bash
# Build a self-contained single executable (Bun compile, spec D5').
# Usage: scripts/build-single.sh <client|cloud>
set -euo pipefail
target="${1:?usage: build-single.sh <client|cloud>}"
mkdir -p dist-single
cd "packages/$target"
bun build --compile "src/main.ts" --outfile "../../dist-single/ccferry-$target"
echo "built dist-single/ccferry-$target"
