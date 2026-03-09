#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"

echo "[safety] Verifying duplicate web tree is absent..."
if [ -d "web/web" ]; then
  echo "ERROR: duplicate web/web directory exists"
  exit 1
fi

echo "[safety] Verifying no tracked files under web/web..."
if git ls-files "web/web" | grep -q .; then
  echo "ERROR: tracked files found under web/web"
  exit 1
fi

echo "[safety] Building canonical web app..."
cd "$ROOT_DIR/web"
npm ci
npm run build

echo "[safety] All checks passed."
