#!/usr/bin/env bash
# Validate that everything needed by the infra is reachable. Non-destructive. Exits non-zero on any fail.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib.sh"
load_env "$HERE/hermes/project.env"
load_env "$HERE/supabase/project.env"
API="https://discord.com/api/v10"
fails=0

check() { if eval "$2" >/dev/null 2>&1; then ok "$1"; else echo "✗ $1"; fails=$((fails+1)); fi; }

echo "── Discord ──"
check "Hermes bot token valid"  "curl -fsS -H 'Authorization: Bot ${DISCORD_BOT_TOKEN:-}' $API/users/@me"
check "edmini bot token valid"  "curl -fsS -H 'Authorization: Bot ${EDMINI_DISCORD_BOT_TOKEN:-}' $API/users/@me"
if [ -n "${EDMINI_BUS_CHANNEL_ID:-}" ]; then
  check "bus channel reachable (Hermes)" "curl -fsS -H 'Authorization: Bot ${DISCORD_BOT_TOKEN:-}' $API/channels/$EDMINI_BUS_CHANNEL_ID"
else
  echo "• bus channel id not set yet (run discord/bootstrap.sh)"
fi
echo "  (Message Content intent can't be checked via REST — make sure it's ON for both bots.)"

echo "── Supabase ──"
if [ -n "${SUPABASE_DB_URL:-}" ] && command -v psql >/dev/null; then
  check "ledger DB reachable" "psql '$SUPABASE_DB_URL' -tAc 'select 1'"
  check "events table exists" "psql '$SUPABASE_DB_URL' -tAc \"select to_regclass('public.events')\" | grep -q events"
else
  echo "• SUPABASE_DB_URL not set yet (run supabase/provision.sh) or psql missing"
  fails=$((fails+1))
fi

echo "── Hermes ──"
check "hermes on PATH" "command -v hermes"
check "gateway service present" "hermes gateway status"

echo ""
[ "$fails" -eq 0 ] && { ok "preflight passed"; exit 0; } || { echo "✗ preflight: $fails problem(s)"; exit 1; }
