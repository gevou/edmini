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
# Prefer the channel ID (robust right after a gateway restart, before name discovery populates).
TARGET="discord:#${EDMINI_BUS_CHANNEL}"
[ -n "${EDMINI_BUS_CHANNEL_ID:-}" ] && TARGET="discord:${EDMINI_BUS_CHANNEL_ID}"
echo "• Sending to $TARGET …"
hermes send --to "$TARGET" "$MSG"
echo "✓ Sent. Check the channel."
