#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-run}"
case "$MODE" in run|--verify|--debug|--logs|--telemetry) ;; *) echo "usage: $0 [--verify|--debug|--logs|--telemetry]" >&2; exit 2 ;; esac
# Only the native UI is relaunched; the independently owned task service stays alive.
pkill -x HelmDesk >/dev/null 2>&1 || true
"$ROOT_DIR/script/package_macos.sh"
APP="$ROOT_DIR/dist/HelmDesk.app"
if [[ "$MODE" == --debug ]]; then exec lldb -- "$APP/Contents/MacOS/HelmDesk"; fi
/usr/bin/open -n --env "HELMDESK_DATA_DIR=${HELMDESK_DATA_DIR:-$ROOT_DIR/.helmdesk}" "$APP"
case "$MODE" in
  --verify) sleep 2; pgrep -x HelmDesk >/dev/null; echo 'HelmDesk GUI process is running.' ;;
  --logs) exec /usr/bin/log stream --info --style compact --predicate 'process == "HelmDesk"' ;;
  --telemetry) exec /usr/bin/log stream --info --style compact --predicate 'subsystem == "cn.helmdesk.mac"' ;;
esac
