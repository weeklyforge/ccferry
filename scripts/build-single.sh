#!/usr/bin/env bash
# Build a self-contained single executable (Bun compile, spec D5').
# Usage: scripts/build-single.sh <client|cloud> [bun-target]
#   bun-target: optional cross-compile target, e.g. bun-linux-x64 when
#   building the cloud exe on a Windows dev box for a Linux server.
#   Client sidecar staging follows the target platform when given.
set -euo pipefail
target="${1:?usage: build-single.sh <client|cloud> [bun-target]}"
bun_target="${2:-}"
mkdir -p dist-single
cd "packages/$target"
if [ -n "$bun_target" ]; then
  bun build --compile --target "$bun_target" "src/main.ts" --outfile "../../dist-single/ccferry-$target"
else
  bun build --compile "src/main.ts" --outfile "../../dist-single/ccferry-$target"
fi
if [ "$target" = "client" ]; then
  # The agent SDK's native CLI cannot be embedded by bun --compile; ship it
  # as a sibling file — the driver finds it beside its own exe at runtime.
  # The platform package has no exports map, so resolve the SDK entry and
  # walk to its pnpm sibling instead of require.resolve on the platform id.
  if [ -n "$bun_target" ]; then
    platform="${bun_target#bun-}"   # e.g. bun-linux-x64 -> linux-x64
  else
    platform="$(node -e 'console.log(process.platform==="win32"?"win32-x64":process.platform==="darwin"?(process.arch==="arm64"?"darwin-arm64":"darwin-x64"):(process.arch==="arm64"?"linux-arm64":"linux-x64"))')"
  fi
  binname="$(node -e 'console.log(process.platform==="win32"?"claude.exe":"claude")')"
  if [ -n "$bun_target" ] && [ "$platform" != "$(node -e 'console.log(process.platform==="win32"?"win32-x64":process.platform==="darwin"?(process.arch==="arm64"?"darwin-arm64":"darwin-x64"):(process.arch==="arm64"?"linux-arm64":"linux-x64"))')" ]; then
    binname="$(node -e 'console.log("'"$platform"'"==="win32-x64"?"claude.exe":"claude")')"
  fi
  sdk_main="$(node -e "console.log(require.resolve('@anthropic-ai/claude-agent-sdk'))")"
  exe="$(dirname "$(dirname "$sdk_main")")/claude-agent-sdk-$platform/$binname"
  [ -f "$exe" ] || { echo "error: native CLI binary not found at $exe" >&2; exit 1; }
  cp "$exe" "../../dist-single/"
  echo "staged $binname next to the exe"
fi
echo "built dist-single/ccferry-$target"
