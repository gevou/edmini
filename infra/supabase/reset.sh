#!/usr/bin/env bash
# Reset the edmini ledger: DROP the ledger objects, then re-apply migrations.
# DESTRUCTIVE — wipes all ledger events. Scoped to edmini objects only (not the whole DB).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ENV="$HERE/project.env"
[ -f "$PROJECT_ENV" ] || { echo "✗ Missing $PROJECT_ENV"; exit 1; }
# shellcheck disable=SC1090
set -a; source "$PROJECT_ENV"; set +a
: "${SUPABASE_DB_URL:?reset.sh requires SUPABASE_DB_URL (psql) in project.env}"
command -v psql >/dev/null 2>&1 || { echo "✗ psql not found."; exit 1; }

read -r -p "⚠️  This DROPS the edmini ledger (all events lost). Continue? [y/N] " ans
[ "${ans:-N}" = "y" ] || [ "${ans:-N}" = "Y" ] || { echo "Aborted."; exit 0; }

echo "• Dropping ledger objects…"
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 <<'SQL'
drop view if exists public.runs;
drop table if exists public.events cascade;
drop function if exists public.events_no_mutate() cascade;
SQL

echo "• Re-applying migrations…"
"$HERE/apply.sh"
echo "✓ Ledger reset complete."
