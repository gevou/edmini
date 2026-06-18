#!/usr/bin/env bash
# Apply the edmini ledger migrations to Supabase.
# Prefers psql against SUPABASE_DB_URL; falls back to the Supabase CLI (db push) if set up.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ENV="$HERE/project.env"
MIGRATIONS="$HERE/migrations"
[ -f "$PROJECT_ENV" ] || { echo "✗ Missing $PROJECT_ENV — copy project.env.example and fill it in."; exit 1; }
# shellcheck disable=SC1090
set -a; source "$PROJECT_ENV"; set +a

if [ -n "${SUPABASE_DB_URL:-}" ]; then
  command -v psql >/dev/null 2>&1 || { echo "✗ psql not found. Install libpq (e.g. 'brew install libpq')."; exit 1; }
  for f in "$MIGRATIONS"/*.sql; do
    echo "• Applying $(basename "$f") via psql…"
    psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$f"
  done
  echo "✓ Ledger migrations applied."
elif command -v supabase >/dev/null 2>&1; then
  echo "• SUPABASE_DB_URL unset; using Supabase CLI (supabase db push)…"
  ( cd "$HERE" && supabase db push )
  echo "✓ Ledger migrations applied via CLI."
else
  echo "✗ No way to apply migrations: set SUPABASE_DB_URL in project.env, or install the Supabase CLI."
  exit 1
fi
