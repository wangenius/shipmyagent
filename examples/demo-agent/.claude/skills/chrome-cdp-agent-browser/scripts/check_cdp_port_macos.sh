#!/usr/bin/env bash
set -euo pipefail

port="${1:-9222}"

if ! command -v lsof >/dev/null 2>&1; then
  echo "lsof not found"
  exit 2
fi

lsof -nP -iTCP:"$port" -sTCP:LISTEN || true

