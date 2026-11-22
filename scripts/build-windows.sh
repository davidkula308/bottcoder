#!/usr/bin/env bash
# Builds the Windows app (zip + installer) from a clean staging folder outside the project.
# Needs: @electron/packager and @vscode/vsce in $TOOLS, makensis on PATH (nix shell nixpkgs#nsis).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOOLS="${TOOLS:-/tmp/pkgtools}"
OUT="${OUT:-/tmp/ns-out}"
VERSION="${VERSION:-1.3.6}"
NOTES="${NOTES:-Typing never stalls: time limits for VS Code, the add-on, real keystrokes and silent AI replies.}"
ELECTRON="${ELECTRON:-33.4.11}"

cd "$ROOT"
npx vite build -c vite.electron.config.ts
( rm -rf /tmp/vsix && cp -r vscode-extension /tmp/vsix && cd /tmp/vsix && "$TOOLS/node_modules/.bin/vsce" package --allow-missing-repository --skip-license -o "$ROOT/electron/nightshift-live.vsix" )

STAGE=/tmp/ns-stage
rm -rf "$STAGE" && mkdir -p "$STAGE/electron" "$STAGE/dist-electron"
cp electron/main.cjs electron/preload.cjs electron/typer.ps1 electron/icon.png electron/icon.ico electron/nightshift-live.vsix "$STAGE/electron/"
cp -r dist-electron/renderer "$STAGE/dist-electron/"
cat > "$STAGE/package.json" <<JSON
{ "name": "nightshift-coder", "productName": "NightShift Coder", "version": "$VERSION", "description": "Offline AI coding bot", "main": "electron/main.cjs", "author": "NightShift Coder", "license": "MIT" }
JSON
# The same staged files become the in-app update feed (served from the published site at /updates).
node "$ROOT/scripts/make-update-feed.mjs" "$STAGE" "$VERSION" "$NOTES"

# --no-asar: typer.ps1 and the add-on file must stay real files on disk.
"$TOOLS/node_modules/.bin/electron-packager" "$STAGE" "NightShift Coder" --platform=win32 --arch=x64 \
  --electron-version="$ELECTRON" --icon="$ROOT/electron/icon.ico" --app-version="$VERSION" \
  --win32metadata.ProductName="NightShift Coder" --win32metadata.FileDescription="NightShift Coder" \
  --out="$OUT" --overwrite --no-asar

makensis -V2 -DSRC="$OUT/NightShift Coder-win32-x64" -DOUT="$OUT/NightShift-Coder-Setup-$VERSION.exe" -DVERSION="$VERSION" "$ROOT/installer/nightshift.nsi"
echo "Built: $OUT/NightShift-Coder-Setup-$VERSION.exe"
