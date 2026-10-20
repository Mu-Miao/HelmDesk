#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP="$ROOT_DIR/dist/HelmDesk.app"
codesign --verify --deep --strict "$APP"
DESTINATION="$HOME/Applications/HelmDesk.app"
mkdir -p "$HOME/Applications"
STAGE="$(mktemp -d "$HOME/Applications/.HelmDesk-install-XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
ditto "$APP" "$STAGE/HelmDesk.app"
codesign --verify --deep --strict "$STAGE/HelmDesk.app"
if [[ -e "$DESTINATION" ]]; then
  IDENTIFIER="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$DESTINATION/Contents/Info.plist" 2>/dev/null || true)"
  [[ "$IDENTIFIER" == cn.helmdesk.mac ]] || { echo 'Refusing to replace an unrelated existing application.' >&2; exit 1; }
  BACKUP="$HOME/Library/Application Support/HelmDesk-AppBackups/HelmDesk-$(date +%Y%m%d-%H%M%S).app"
  mkdir -p "$(dirname "$BACKUP")"
  mv "$DESTINATION" "$BACKUP"
fi
mv "$STAGE/HelmDesk.app" "$DESTINATION"
printf 'Installed %s\nExisting task data and background service were not moved.\n' "$DESTINATION"
