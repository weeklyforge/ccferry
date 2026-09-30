#!/usr/bin/env bash
# Stage an install ROOT for one (product, platform) build.
# Every packaging format (tar.gz/zip, deb, rpm, pacman, pkg, inno) consumes
# this layout so file placement has a single source of truth.
#
# Usage: stage.sh <client|cloud> <platform-id> <out-root> [--mac] [<sidecar-src>]
#   platform-id  win32-x64 | win32-arm64 | linux-x64 | linux-arm64
#                linux-x64-musl | linux-arm64-musl | darwin-x64 | darwin-arm64
#   --mac        darwin layout: /usr/local/ccferry + /Library/LaunchAgents
#                (default is the POSIX layout: /usr[/lib]/ccferry + systemd)
#   sidecar-src  client only: path to the claude(.exe) native binary
set -euo pipefail
product="${1:?usage: stage.sh <client|cloud> <platform-id> <out-root> [--mac] [<sidecar-src>]}"
platform="${2:?missing platform-id}"
root="${3:?missing out-root}"
mac=0
sidecar=""
shift 3
while [ $# -gt 0 ]; do
  case "$1" in
    --mac) mac=1 ;;
    *) sidecar="$1" ;;
  esac
  shift
done

# Portable install helper: BSD install (macOS) lacks GNU install's -D.
put() { # <src> <dst>
  mkdir -p "$(dirname "$2")"
  cp "$1" "$2"
}

repo="$(cd "$(dirname "$0")/../.." && pwd)"
name="ccferry-$product"
exe="$name"
binname=claude
case "$platform" in
  win32-*) exe="$name.exe"; binname=claude.exe ;;
esac
built="$repo/dist-single/$name-$platform"
# Note: bun appends .exe only on Windows hosts; MSYS bash resolves the bare
# name to the .exe sibling there, and Linux/macOS runners match exactly.
[ -f "$built" ] || { echo "error: build artifact not found: $built (run bun build first)" >&2; exit 1; }

if [ "$mac" = 1 ]; then
  # ---- darwin layout (pkgbuild --root / tar.gz) --------------------------
  [ "$product" = client ] || { echo "error: --mac layout is client-only (cloud ships as tgz)" >&2; exit 1; }
  put "$built" "$root/usr/local/ccferry/$exe"
  [ -n "$sidecar" ] && put "$sidecar" "$root/usr/local/ccferry/$binname"
  put "$repo/scripts/package/templates/com.ccferry.daemon.plist" \
    "$root/Library/LaunchAgents/com.ccferry.daemon.plist"
  put "$repo/scripts/package/templates/README-client.txt" "$root/usr/local/ccferry/README.txt"
  exit 0
fi

if [ "$platform" = win32-x64 ] || [ "$platform" = win32-arm64 ]; then
  # ---- windows portable layout (zip / inno source dir) -------------------
  put "$built" "$root/$exe"
  [ -n "$sidecar" ] && put "$sidecar" "$root/$binname"
  put "$repo/scripts/package/templates/README-client.txt" "$root/README.txt"
  exit 0
fi

# ---- POSIX layout (tar.gz / deb data / rpm / pacman) ----------------------
if [ "$product" = cloud ]; then
  put "$built" "$root/usr/bin/$name"
  put "$repo/scripts/package/templates/ccferry-cloud.service" \
    "$root/lib/systemd/system/ccferry-cloud.service"
  put "$repo/scripts/package/templates/cloud.env.template" \
    "$root/etc/ccferry/cloud.env.template"
else
  put "$built" "$root/usr/lib/ccferry/$name"
  [ -n "$sidecar" ] && put "$sidecar" "$root/usr/lib/ccferry/$binname"
  mkdir -p "$root/usr/bin"
  printf '#!/bin/sh\nexec /usr/lib/ccferry/%s "$@"\n' "$name" > "$root/usr/bin/$name"
  chmod 755 "$root/usr/bin/$name"
  put "$repo/scripts/package/templates/ccferry-client-user.service" \
    "$root/usr/share/ccferry/systemd/ccferry.service"
fi
put "$repo/scripts/package/templates/README-$product.txt" \
  "$root/usr/share/doc/$name/README.txt"
