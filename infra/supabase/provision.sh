#!/usr/bin/env bash
# Auto-create a hosted Supabase project from a Personal Access Token, then write its connection
# details into infra/supabase/project.env. Idempotent: if SUPABASE_DB_URL is already set, skips.
#
# Inputs (infra/supabase/project.env): SUPABASE_ACCESS_TOKEN (required).
# Optional: SUPABASE_ORG_ID (else first org), SUPABASE_REGION (us-east-1), SUPABASE_PROJECT_NAME
# (edmini-ledger), SUPABASE_DB_PASSWORD (else generated).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/../lib.sh"
ENVF="$HERE/project.env"
load_env "$ENVF"

command -v supabase >/dev/null || die "supabase CLI required (brew install supabase/tap/supabase)"
command -v jq >/dev/null || die "jq required"

if [ -n "${SUPABASE_DB_URL:-}" ]; then ok "SUPABASE_DB_URL already set — skipping project creation."; exit 0; fi
: "${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN (Personal Access Token) in $ENVF}"
export SUPABASE_ACCESS_TOKEN

REGION="${SUPABASE_REGION:-us-east-1}"
NAME="${SUPABASE_PROJECT_NAME:-edmini-ledger}"
ORG="${SUPABASE_ORG_ID:-$(supabase orgs list -o json | jq -r '.[0].id // empty')}"
[ -n "$ORG" ] || die "No organization found; set SUPABASE_ORG_ID in $ENVF"
PW="${SUPABASE_DB_PASSWORD:-$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | cut -c1-24)}"

note "Creating Supabase project '$NAME' in org $ORG ($REGION)…"
out="$(supabase projects create "$NAME" --org-id "$ORG" --db-password "$PW" --region "$REGION" -o json --yes 2>/dev/null)" || true
REF="$(echo "${out:-}" | jq -r '.id // .ref // empty' 2>/dev/null || true)"
[ -n "$REF" ] || REF="$(supabase projects list -o json | jq -r --arg n "$NAME" '[.[]|select(.name==$n)][-1].id // empty')"
[ -n "$REF" ] || die "Could not determine project ref after create. Output: ${out:-<none>}"
ok "Project ref: $REF"

note "Waiting for project to become healthy (this takes a few minutes)…"
for _ in $(seq 1 60); do
  st="$(supabase projects list -o json | jq -r --arg r "$REF" '.[]|select(.id==$r)|.status // empty')"
  [ "$st" = "ACTIVE_HEALTHY" ] && { ok "Project healthy."; break; }
  sleep 10
done

# Session-pooler connection string (IPv4-friendly; port 5432 = session mode, needed for DDL).
DBURL="postgresql://postgres.${REF}:${PW}@aws-0-${REGION}.pooler.supabase.com:5432/postgres"

upsert_env "$ENVF" SUPABASE_PROJECT_REF "$REF"
upsert_env "$ENVF" SUPABASE_DB_PASSWORD "$PW"
upsert_env "$ENVF" SUPABASE_URL "https://${REF}.supabase.co"
upsert_env "$ENVF" SUPABASE_DB_URL "$DBURL"

ok "Wrote connection details to $ENVF"
echo "  If apply/preflight can't connect, paste the exact 'Session pooler' URI from"
echo "  Dashboard → Project Settings → Database into SUPABASE_DB_URL in $ENVF (rare fallback)."
