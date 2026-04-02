#!/usr/bin/env bash
set -euo pipefail

# Build a clean .zip for Chrome Web Store upload
# Usage: bash scripts/build-zip.sh
# Works on both Unix (zip) and Windows (PowerShell fallback)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$ROOT_DIR"

VERSION=$(node -p "require('./package.json').version")
OUT="canvas-notion-sync-v${VERSION}.zip"

# Remove old build if it exists
rm -f "$OUT"

# Files and directories to include
INCLUDE=(
  manifest.json
  background.js
  content-script.js
  popup.html
  popup.js
  icons/icon16.png
  icons/icon48.png
  icons/icon128.png
)

if command -v zip &>/dev/null; then
  zip -r "$OUT" "${INCLUDE[@]}" src/ -x "src/**/*.test.js" "src/**/__mocks__/*"
else
  # Windows fallback using PowerShell
  WIN_OUT=$(pwd -W)/"$OUT"
  WIN_ROOT=$(pwd -W)
  powershell.exe -NoProfile -Command "
    \$root = '$WIN_ROOT'
    \$files = @(
      'manifest.json',
      'background.js',
      'content-script.js',
      'popup.html',
      'popup.js',
      'icons\\icon16.png',
      'icons\\icon48.png',
      'icons\\icon128.png'
    )
    \$tempDir = Join-Path \$env:TEMP 'cns-build'
    if (Test-Path \$tempDir) { Remove-Item \$tempDir -Recurse -Force }
    New-Item \$tempDir -ItemType Directory | Out-Null

    foreach (\$f in \$files) {
      \$dest = Join-Path \$tempDir \$f
      \$destDir = Split-Path \$dest -Parent
      if (!(Test-Path \$destDir)) { New-Item \$destDir -ItemType Directory -Force | Out-Null }
      Copy-Item (Join-Path \$root \$f) \$dest
    }

    \$srcDir = Join-Path \$root 'src'
    \$destSrc = Join-Path \$tempDir 'src'
    Copy-Item \$srcDir \$destSrc -Recurse
    Get-ChildItem \$destSrc -Recurse -Filter '*.test.js' | Remove-Item -Force
    Get-ChildItem \$destSrc -Recurse -Directory -Filter '__mocks__' | Remove-Item -Recurse -Force

    Compress-Archive -Path (Join-Path \$tempDir '*') -DestinationPath '$WIN_OUT' -Force
    Remove-Item \$tempDir -Recurse -Force
  "
fi

echo ""
echo "Built: $OUT"
ls -lh "$OUT" | awk '{print "Size:  " $5}'
