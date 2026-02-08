#!/usr/bin/env bash
set -euo pipefail

user_data_dir="${1:-$(pwd)/.secrets/chrome-cdp-profile}"

if ! command -v pgrep >/dev/null 2>&1; then
  echo "pgrep not found"
  exit 2
fi

# Kill only Chrome processes that were launched with this specific user-data-dir.
pids="$(pgrep -f "Google Chrome.*--user-data-dir=${user_data_dir}" || true)"
if [ -z "$pids" ]; then
  echo "No Chrome processes found for user-data-dir=${user_data_dir}"
  exit 0
fi

echo "$pids" | xargs -n 1 kill -TERM
echo "Sent TERM to Chrome pids for user-data-dir=${user_data_dir}"
