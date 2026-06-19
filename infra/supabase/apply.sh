#!/usr/bin/env bash
# Apply the edmini ledger migrations to Supabase.
# Prefers the Management API SQL endpoint (no connection string needed — robust against pooler/IPv6
# quirks); falls back to psql against SUPABASE_DB_URL.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/../lib.sh"
ENVF="$HERE/project.env"
MIGRATIONS="$HERE/migrations"
[ -f "$ENVF" ] || die "Missing $ENVF — copy project.env.example and fill it in."
load_env "$ENVF"   # resolves op:// refs (e.g. SUPABASE_ACCESS_TOKEN)
command -v jq >/dev/null || die "jq required"

apply_via_api() {
  local ref="$1" f code resp body
  for f in "$MIGRATIONS"/*.sql; do
    note "Applying $(basename "$f") via Management API…"
    resp="$(curl -sS -w $'\n%{http_code}' -X POST \
      "https://api.supabase.com/v1/projects/$ref/database/query" \
      -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H 'Content-Type: application/json' \
      -d "$(jq -Rs '{query: .}' < "$f")")"
    code="$(printf '%s' "$resp" | tail -1)"; body="$(printf '%s' "$resp" | sed '$d')"
    case "$code" in 2*) : ;; *) die "Management API apply failed (HTTP $code): $(printf '%s' "$body" | jq -r '.message // tostring' 2>/dev/null)";; esac
  done
  ok "Ledger migrations applied (Management API)."
}

apply_via_psql() {
  command -v psql >/dev/null || die "psql not found (brew install libpq)."
  local f
  for f in "$MIGRATIONS"/*.sql; do
    note "Applying $(basename "$f") via psql…"
    psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$f"
  done
  ok "Ledger migrations applied (psql)."
}

if [ -n "${SUPABASE_ACCESS_TOKEN:-}" ] && [ -n "${SUPABASE_PROJECT_REF:-}" ]; then
  apply_via_api "$SUPABASE_PROJECT_REF"
elif [ -n "${SUPABASE_DB_URL:-}" ]; then
  apply_via_psql
else
  die "Need SUPABASE_ACCESS_TOKEN+SUPABASE_PROJECT_REF (API) or SUPABASE_DB_URL (psql) in $ENVF. Run provision.sh first."
fi
