#!/usr/bin/env bash
# Bring up edmini's infrastructure in one command, idempotently:
#   1. provision the Supabase project (if SUPABASE_DB_URL missing)
#   2. provision the Discord channel — needs you to add both bots to a server on first run
#   3. configure Hermes for the bus + apply the ledger migrations
#   4. show status
# Safe to re-run. For first-time secret collection, use ./infra/init.sh instead.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib.sh"
ensure_op || true   # prompt `op signin` up front if needed; load_env enforces when op:// refs are used
load_env "$HERE/hermes/project.env"
load_env "$HERE/supabase/project.env"

echo "════════ edmini infra up ════════"

# 1. Supabase — independent of Discord.
if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "▶ Supabase (provision project)"; "$HERE/supabase/provision.sh"
  load_env "$HERE/supabase/project.env"
else
  echo "▶ Supabase: project already provisioned"
fi

# 2. Discord — bots can't create servers, so first run prints invite URLs and exits 3.
echo ""
if [ -z "${EDMINI_BUS_CHANNEL_ID:-}" ]; then
  echo "▶ Discord (bootstrap channel)"
  rc=0; "$HERE/discord/bootstrap.sh" || rc=$?
  if [ "$rc" = 3 ]; then
    echo ""; note "Add both bots to a server (links above), then re-run ./infra/up.sh."
    exit 0
  elif [ "$rc" != 0 ]; then
    exit "$rc"
  fi
  load_env "$HERE/hermes/project.env"
else
  echo "▶ Discord: bus channel already provisioned ($EDMINI_BUS_CHANNEL_ID)"
fi

# 3. Configure + apply (only reached once both Supabase and Discord are ready).
echo ""; echo "▶ Hermes (configure Discord bus)"; "$HERE/hermes/configure.sh"
echo ""; echo "▶ Supabase (apply ledger migrations)"; "$HERE/supabase/apply.sh"
echo ""; echo "▶ Status"; "$HERE/hermes/status.sh" || true
echo ""
ok "Infra up. Next: run the app (pnpm dev) and the bus worker (pnpm worker)."
