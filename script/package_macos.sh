#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
NODE_BIN="$(command -v node)"
"$NODE_BIN" -e 'if(Number(process.versions.node.split(".")[0])<24)throw Error("Node.js 24+ required")'
[[ "$(uname -s)" == Darwin ]] || { echo 'macOS is required' >&2; exit 1; }
npm run build
# Keep SwiftPM's extended-attribute/linker work outside protected Desktop folders.
WORKSPACE_ID="$(printf '%s' "$ROOT_DIR" | shasum -a 256 | cut -c1-16)"
SWIFT_SCRATCH="${HELMDESK_SWIFT_SCRATCH_PATH:-$HOME/Library/Caches/HelmDesk/SwiftPM/$WORKSPACE_ID}"
swift build --package-path native --scratch-path "$SWIFT_SCRATCH" --product HelmDesk
BUILD_DIR="$(swift build --package-path native --scratch-path "$SWIFT_SCRATCH" --show-bin-path)"
APP_BUNDLE="$ROOT_DIR/dist/HelmDesk.app"
STAGE="$ROOT_DIR/dist/.HelmDesk-stage-$$.app"
ICON_STAGE="$(mktemp -d "$ROOT_DIR/dist/.HelmDesk-icon-XXXXXX")"
trap 'rm -rf "$STAGE" "$ICON_STAGE"' EXIT
mkdir -p "$STAGE/Contents/MacOS" "$STAGE/Contents/Resources/runtime" "$STAGE/Contents/Resources/service/web"
swift script/generate_icon.swift "$ICON_STAGE"
cmp "$ICON_STAGE/HelmDesk.svg" web/public/assets/helmdesk.svg
iconutil -c icns "$ICON_STAGE/HelmDesk.iconset" -o "$STAGE/Contents/Resources/HelmDesk.icns"
cp "$BUILD_DIR/HelmDesk" "$STAGE/Contents/MacOS/HelmDesk"
cp "$NODE_BIN" "$STAGE/Contents/Resources/runtime/node"
npx tsc --outDir "$STAGE/Contents/Resources/service/dist" --sourceMap false
cp -R web/dist "$STAGE/Contents/Resources/service/web/dist"
cp package.json package-lock.json .npmrc "$STAGE/Contents/Resources/service/"
(cd "$STAGE/Contents/Resources/service" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund)
cp THIRD_PARTY_NOTICES.md "$STAGE/Contents/Resources/"
[[ "$("$NODE_BIN" -p process.version)" == "$(cat native/Resources/Node-VERSION)" ]] || { echo 'Update the checked-in Node license/version before packaging another Node version.' >&2; exit 1; }
cp native/Resources/Node-LICENSE.txt "$STAGE/Contents/Resources/runtime/LICENSE"
cp native/Resources/Node-VERSION "$STAGE/Contents/Resources/runtime/VERSION"
cp native/Resources/Info.plist "$STAGE/Contents/Info.plist"
node scripts/audit-macos-bundle.mjs "$STAGE" --write
codesign --force --sign - "$STAGE/Contents/Resources/runtime/node"
codesign --force --sign - "$STAGE"
codesign --verify --deep --strict "$STAGE"
node scripts/audit-macos-bundle.mjs "$STAGE"
if [[ -e "$APP_BUNDLE" ]]; then
  BACKUP="$ROOT_DIR/dist/previous/HelmDesk-$(date +%Y%m%d-%H%M%S).app"
  mkdir -p "$(dirname "$BACKUP")"
  mv "$APP_BUNDLE" "$BACKUP"
fi
mv "$STAGE" "$APP_BUNDLE"
printf 'Built %s\nLocal ad-hoc signature; not notarized.\n' "$APP_BUNDLE"
