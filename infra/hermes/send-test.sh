#!/usr/bin/env bash
# Post a test line to the bus channel via Hermes's scriptable `send` (no LLM, no agent loop).
# Usage: ./send-test.sh ["message"]
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ENV="$HERE/project.env"
[ -f "$PROJECT_ENV" ] || { echo "✗ Missing $PROJECT_ENV"; exit 1; }
# shellcheck disable=SC1090
set -a; source "$PROJECT_ENV"; set +a
: "${EDMINI_BUS_CHANNEL:?Set EDMINI_BUS_CHANNEL in project.env}"

MSG="${1:-edmini infra send-test $(date '+%H:%M:%S')}"
echo "• Sending to discord:#$EDMINI_BUS_CHANNEL …"
hermes send --to "discord:#${EDMINI_BUS_CHANNEL}" "$MSG"
echo "✓ Sent. Check the channel."
