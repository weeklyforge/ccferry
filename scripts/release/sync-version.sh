#!/usr/bin/env bash
# Single source of version truth: root package.json "version".
# Propagates to both backend packages and the mobile pubspec (versionCode
# maps major*10000+minor*100+patch so it stays a strictly increasing int
# across the 0.x line).
# Usage: scripts/release/sync-version.sh [new-version]   (no arg = re-sync only)
set -euo pipefail
repo="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$repo"

if [ $# -gt 0 ]; then
  node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.version=process.argv[1];fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n')" "$1"
fi

version="$(node -p "require('./package.json').version")"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "error: unparsable version $version" >&2; exit 1; }
IFS=. read -r major minor patch <<<"$version"
code=$(( major * 10000 + minor * 100 + patch ))

for pkg in packages/client packages/cloud; do
  node -e "const fs=require('fs');const p='$pkg/package.json';const j=JSON.parse(fs.readFileSync(p,'utf8'));j.version='$version';fs.writeFileSync(p,JSON.stringify(j,null,2)+'\n')" "$pkg"
done
node -e "const fs=require('fs');const p='apps/mobile/pubspec.yaml';fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace(/^version: .*$/m,'version: $version+$code'))"

echo "version $version everywhere (mobile versionCode $code)"
