#!/usr/bin/env bash
# Rebuild vscode-diff Next, install into VS Code (Linux / macOS).
# Mirrors update-extension.ps1 for Unix hosts.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

DEV_HOST=0
NO_RESTART=0
SKIP_INSTALL=0
CODE_CMD="${CODE_CMD:-code}"
WORKSPACE="$ROOT"

usage() {
  cat <<'EOF'
Usage: ./update-extension.sh [options]

  --dev-host       Compile and open Extension Development Host (no VSIX)
  --no-restart     Install VSIX; do not kill/relaunch VS Code
  --skip-install   Compile + package only
  --code <cmd>     VS Code CLI (default: code)
  --workspace <p>  Folder to reopen after restart (default: this repo)
  -h, --help       Show this help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dev-host) DEV_HOST=1; shift ;;
    --no-restart) NO_RESTART=1; shift ;;
    --skip-install) SKIP_INSTALL=1; shift ;;
    --code) CODE_CMD="$2"; shift 2 ;;
    --workspace) WORKSPACE="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Command not found: $1" >&2
    exit 1
  }
}

need_cmd npm
need_cmd "$CODE_CMD"

if [[ ! -d node_modules ]]; then
  echo "==> npm install"
  npm install
fi

VERSION="$(node -p "require('./package.json').version")"
NAME="$(node -p "require('./package.json').name")"
VSIX="$ROOT/${NAME}-${VERSION}.vsix"

echo "==> Compile (tsc)"
npm run compile

if [[ "$DEV_HOST" -eq 1 ]]; then
  echo "==> Open Extension Development Host"
  "$CODE_CMD" --extensionDevelopmentPath="$ROOT" "$ROOT" || true
  echo "Dev loop: npm run watch · Extension Host: Reload Window"
  exit 0
fi

echo "==> Package VSIX"
if [[ -x "$ROOT/node_modules/.bin/vsce" ]]; then
  "$ROOT/node_modules/.bin/vsce" package
else
  npx --yes @vscode/vsce package
fi

if [[ ! -f "$VSIX" ]]; then
  VSIX="$(ls -t "$ROOT"/*.vsix 2>/dev/null | head -n1 || true)"
fi
if [[ -z "${VSIX:-}" || ! -f "$VSIX" ]]; then
  echo "VSIX not found after package." >&2
  exit 1
fi
echo "VSIX: $VSIX"

if [[ "$SKIP_INSTALL" -eq 1 ]]; then
  echo "Packaged only: $VSIX"
  exit 0
fi

echo "==> Install extension ($CODE_CMD)"
"$CODE_CMD" --install-extension "$VSIX" --force

if [[ "$NO_RESTART" -eq 1 ]]; then
  echo "Installed. Reload Window in VS Code (Cmd/Ctrl+R)."
  exit 0
fi

echo "==> Restart VS Code"
# Best-effort: quit Code so the next launch picks up the new extension files.
if command -v osascript >/dev/null 2>&1; then
  osascript -e 'quit app "Visual Studio Code"' 2>/dev/null || true
elif command -v pkill >/dev/null 2>&1; then
  pkill -x code 2>/dev/null || pkill -f "Visual Studio Code" 2>/dev/null || true
fi
sleep 1
"$CODE_CMD" "$WORKSPACE" &
echo "Installed + restarted. Extension: RicardoFrantz.diff-next  VSIX: $(basename "$VSIX")"
