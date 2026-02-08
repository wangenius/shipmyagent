#!/usr/bin/env bash
set -euo pipefail

port="${1:-9222}"
# Default to a project-local profile directory for repeatability.
# Assumes you run the script from your repo root (recommended).
user_data_dir="${2:-$(pwd)/.secrets/chrome-cdp-profile}"
start_url="${3:-about:blank}"

mkdir -p "$user_data_dir"

open -na "Google Chrome" --args \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port="$port" \
  --user-data-dir="$user_data_dir" \
  --no-first-run \
  --no-default-browser-check \
  --disable-popup-blocking \
  "$start_url"

echo "Started Chrome with CDP on 127.0.0.1:${port}"
echo "User data dir: ${user_data_dir}"
