#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
case "${1:-}" in --skip-build) ;; '') ./script/package_macos.sh ;; *) echo 'usage: distribute_macos.sh [--skip-build]' >&2; exit 2 ;; esac
APP="$ROOT_DIR/dist/HelmDesk.app"
codesign --verify --deep --strict "$APP"
node scripts/audit-macos-bundle.mjs "$APP"
VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist")"
ARCH="$(/usr/bin/lipo -archs "$APP/Contents/MacOS/HelmDesk" | tr ' ' '-')"
NAME="HelmDesk-$VERSION-macos-$ARCH-local"
mkdir -p dist/releases
STAGE="$(mktemp -d "$ROOT_DIR/dist/releases/.distribution-XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
ditto -c -k --sequesterRsrc --keepParent "$APP" "$STAGE/$NAME.zip"
cp "$APP/Contents/Resources/Components.json" "$STAGE/$NAME-components.json"
cp docs/macos-install.md "$STAGE/INSTALL.md"
# Do not include private repository state in the disk image.
DMG_ROOT="$STAGE/.dmg-root"
mkdir -p "$DMG_ROOT"
ditto "$APP" "$DMG_ROOT/HelmDesk.app"
ln -s /Applications "$DMG_ROOT/Applications"
cp "$STAGE/INSTALL.md" "$DMG_ROOT/INSTALL.md"
hdiutil create -quiet -volname "HelmDesk $VERSION" -srcfolder "$DMG_ROOT" -fs HFS+ -format UDZO "$STAGE/$NAME-unsigned.dmg"
hdiutil verify -quiet "$STAGE/$NAME-unsigned.dmg"
rm -rf "$DMG_ROOT"
(cd "$STAGE" && shasum -a 256 "$NAME-unsigned.dmg" "$NAME.zip" "$NAME-components.json" INSTALL.md > SHA256SUMS)
if [[ -e "dist/releases/$NAME" ]]; then mv "dist/releases/$NAME" "dist/releases/$NAME-previous-$(date +%s)"; fi
mv "$STAGE" "dist/releases/$NAME"
printf 'Local distribution: %s/dist/releases/%s\nDMG unsigned; app ad-hoc signed only. No Developer ID signature or notarization.\n' "$ROOT_DIR" "$NAME"
