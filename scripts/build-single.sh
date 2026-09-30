#!/usr/bin/env bash
# Build a self-contained single executable (Bun compile, spec D5').
# Usage: scripts/build-single.sh <client|cloud>
set -euo pipefail
target="${1:?usage: build-single.sh <client|cloud>}"
mkdir -p dist-single
cd "packages/$target"
bun build --compile "src/main.ts" --outfile "../../dist-single/ccferry-$target"
if [ "$target" = "client" ]; then
  # The agent SDK's native CLI cannot be embedded by bun --compile; ship it
  # as a sibling file — the driver finds it beside its own exe at runtime.
  # The platform package has no exports map, so resolve the SDK entry and
  # walk to its pnpm sibling instead of require.resolve on the platform id.
  platform="$(node -e 'console.log(process.platform==="win32"?"win32-x64":process.platform==="darwin"?(process.arch==="arm64"?"darwin-arm64":"darwin-x64"):(process.arch==="arm64"?"linux-arm64":"linux-x64"))')"
  binname="$(node -e 'console.log(process.platform==="win32"?"claude.exe":"claude")')"
  sdk_main="$(node -e "console.log(require.resolve('@anthropic-ai/claude-agent-sdk'))")"
  exe="$(dirname "$(dirname "$sdk_main")")/claude-agent-sdk-$platform/$binname"
  [ -f "$exe" ] || { echo "error: native CLI binary not found at $exe" >&2; exit 1; }
  cp "$exe" "../../dist-single/"
  echo "staged $binname next to the exe"
fi
echo "built dist-single/ccferry-$target"
