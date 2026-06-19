#!/usr/bin/env bash
# Auto-create a hosted Supabase project from a Personal Access Token, then write its connection
# details into infra/supabase/project.env. Idempotent: if SUPABASE_DB_URL is already set, skips;
# if a project with the target name already exists, reuses it.
#
# Inputs (infra/supabase/project.env): SUPABASE_ACCESS_TOKEN (required).
# Optional: SUPABASE_ORG_ID (else first org), SUPABASE_REGION (us-east-1), SUPABASE_PROJECT_NAME
# (edmini-ledger), SUPABASE_DB_PASSWORD (else generated and saved).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/../lib.sh"
ENVF="$HERE/project.env"
load_env "$ENVF"

command -v supabase >/dev/null || die "supabase CLI required (brew install supabase/tap/supabase)"
command -v jq >/dev/null || die "jq required"
[ -n "${SUPABASE_DB_URL:-}" ] && { ok "SUPABASE_DB_URL already set — skipping project creation."; exit 0; }
: "${SUPABASE_ACCESS_TOKEN:?Set SUPABASE_ACCESS_TOKEN (Personal Access Token) in $ENVF}"
export SUPABASE_ACCESS_TOKEN

# Strip the Supabase CLI's noise lines so JSON parses cleanly.
clean() { grep -vE 'new version of Supabase CLI|recommend updating|Cannot find project ref'; }

REGION="${SUPABASE_REGION:-us-east-1}"
NAME="${SUPABASE_PROJECT_NAME:-edmini-ledger}"
ORG="${SUPABASE_ORG_ID:-$(supabase orgs list -o json 2>/dev/null | clean | jq -r '.[0].id // empty')}"
[ -n "$ORG" ] || die "No organization found; set SUPABASE_ORG_ID in $ENVF"

# Persist the DB password up front so a retry after a partial failure can reuse it.
PW="${SUPABASE_DB_PASSWORD:-$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | cut -c1-24)}"
upsert_env "$ENVF" SUPABASE_DB_PASSWORD "$PW"

# Reuse a same-named project if one already exists (idempotent re-run).
REF="$(supabase projects list -o json 2>/dev/null | clean | jq -r --arg n "$NAME" '[.[]|select(.name==$n)][-1].id // empty')"
if [ -n "$REF" ]; then
  note "Reusing existing project '$NAME' ($REF)."
else
  note "Creating Supabase project '$NAME' in org $ORG ($REGION)…"
  out="$(supabase projects create "$NAME" --org-id "$ORG" --db-password "$PW" --region "$REGION" -o json --yes 2>&1 || true)"
  REF="$(printf '%s' "$out" | clean | sed -n '/[{[]/,$p' | jq -r '.id // .ref // empty' 2>/dev/null || true)"
  [ -n "$REF" ] || REF="$(supabase projects list -o json 2>/dev/null | clean | jq -r --arg n "$NAME" '[.[]|select(.name==$n)][-1].id // empty')"
  [ -n "$REF" ] || die "project create failed:
$(printf '%s' "$out" | clean | tail -8)"
  ok "Created project ref: $REF"
fi

note "Waiting for the project to become healthy (a few minutes)…"
for _ in $(seq 1 60); do
  st="$(curl -sS -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" "https://api.supabase.com/v1/projects/$REF" | jq -r '.status // empty' 2>/dev/null || true)"
  [ "$st" = "ACTIVE_HEALTHY" ] && { ok "Project healthy."; break; }
  sleep 10
done

# Fetch the REAL pooler host/port/user from the Management API — the subdomain is not always
# aws-0-<region> (this project's is aws-1-…), so constructing it is unreliable. Fall back if needed.
pooler="$(curl -sS -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" "https://api.supabase.com/v1/projects/$REF/config/database/pooler" 2>/dev/null || true)"
PHOST="$(printf '%s' "$pooler" | jq -r '.[0].db_host // empty' 2>/dev/null || true)"
PPORT="$(printf '%s' "$pooler" | jq -r '.[0].db_port // empty' 2>/dev/null || true)"
PUSER="$(printf '%s' "$pooler" | jq -r '.[0].db_user // empty' 2>/dev/null || true)"
if [ -n "$PHOST" ] && [ -n "$PUSER" ]; then
  DBURL="postgresql://${PUSER}:${PW}@${PHOST}:${PPORT:-6543}/postgres"
else
  DBURL="postgresql://postgres.${REF}:${PW}@aws-0-${REGION}.pooler.supabase.com:5432/postgres"
fi

upsert_env "$ENVF" SUPABASE_PROJECT_REF "$REF"
upsert_env "$ENVF" SUPABASE_URL "https://${REF}.supabase.co"
upsert_env "$ENVF" SUPABASE_DB_URL "$DBURL"

ok "Wrote connection details to $ENVF (ref $REF)."
echo "  If apply/preflight can't connect, paste the exact 'Session pooler' URI from"
echo "  Dashboard → Project Settings → Database into SUPABASE_DB_URL in $ENVF."
