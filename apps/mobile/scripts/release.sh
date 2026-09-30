#!/usr/bin/env bash
# Publish a release: build the apk, hash it, and upload the apk plus update
# metadata to GitHub Releases. Usage:
#   scripts/release.sh "<release notes>"
# The version comes from pubspec.yaml (X.Y.Z+N); N (versionCode) must be
# strictly greater than the currently published metadata.
set -euo pipefail
cd "$(dirname "$0")/.."

REPO="fetaoily/ccferry"
META_URL="https://github.com/$REPO/releases/latest/download/latest.json"
APK="build/app/outputs/flutter-apk/app-release.apk"

die() { echo "error: $*" >&2; exit 1; }

NOTES="${1:-}"
[ -n "$NOTES" ] || die "usage: release.sh \"<release notes>\""
case "$NOTES" in *'"'*) die "release notes must not contain double quotes (json escaping)";; esac

# 1. Version from pubspec.
spec=$(grep -E '^version:' pubspec.yaml | head -n1 | sed -E 's/^version:[[:space:]]*//')
name=${spec%+*}
code=${spec##*+}
printf '%s' "$name" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' || die "unparsable pubspec version: $spec"
printf '%s' "$code" | grep -Eq '^[0-9]+$' || die "unparsable pubspec versionCode: $spec"

# 2. versionCode must increase over what is published.
remote=$(curl -fsSL "$META_URL" 2>/dev/null || true)
if [ -n "$remote" ]; then
  remote_code=$(printf '%s' "$remote" | grep -oE '"versionCode":[[:space:]]*[0-9]+' | grep -oE '[0-9]+' | tail -n1)
  [ -n "$remote_code" ] || die "cannot parse versionCode from the published latest.json"
  [ "$code" -gt "$remote_code" ] || die "versionCode $code must be greater than the published $remote_code (bump the +N in pubspec.yaml)"
fi

# 3. The tag must be new.
gh release view "v$name" --repo "$REPO" >/dev/null 2>&1 && die "release v$name already exists"

# 4. Build.
flutter build apk --release

# 5. Hash and stage assets under their published names.
sha=$(sha256sum "$APK" | cut -d' ' -f1)
stage=$(mktemp -d)
cp "$APK" "$stage/ccferry.apk"
cat > "$stage/latest.json" <<EOF
{
  "version": "$name",
  "versionCode": $code,
  "sha256": "$sha",
  "apk": "ccferry.apk",
  "notes": "$NOTES"
}
EOF

# 6. Publish.
gh release create "v$name" --repo "$REPO" --title "$name" --notes "$NOTES" \
  "$stage/ccferry.apk" "$stage/latest.json"
echo "published v$name (versionCode $code, sha256 $sha)"
