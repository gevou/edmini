#!/usr/bin/env bash
# Bring up edmini's infrastructure in one command, idempotently:
#   1. ensure Discord guild + channel exist (bootstrap, if ids missing)
#   2. ensure a Supabase project exists (provision, if SUPABASE_DB_URL missing)
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

if [ -z "${EDMINI_BUS_CHANNEL_ID:-}" ]; then
  echo "▶ Discord (bootstrap guild + channel)"; "$HERE/discord/bootstrap.sh"
else
  echo "▶ Discord: bus channel already provisioned ($EDMINI_BUS_CHANNEL_ID)"
fi

echo ""
if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "▶ Supabase (provision project)"; "$HERE/supabase/provision.sh"
else
  echo "▶ Supabase: project already provisioned"
fi

echo ""; echo "▶ Hermes (configure Discord bus)"; "$HERE/hermes/configure.sh"
echo ""; echo "▶ Supabase (apply ledger migrations)"; "$HERE/supabase/apply.sh"
echo ""; echo "▶ Status"; "$HERE/hermes/status.sh" || true
echo ""
ok "Infra up. Next: run the app (pnpm dev) and the bus worker (pnpm worker)."
