#!/usr/bin/env bash
# Provision the Discord side of the bus.
#
# NOTE: bots CANNOT create servers (Discord returns code 20001 "Bots cannot use this endpoint"),
# so you create or pick ONE server and add both bots to it via the invite URLs this prints. The
# script then auto-detects the server both bots share and creates the #<channel> there.
#
# Inputs (infra/hermes/project.env): DISCORD_BOT_TOKEN (Hermes), EDMINI_DISCORD_BOT_TOKEN (edmini),
# EDMINI_BUS_CHANNEL, optional EDMINI_GUILD_ID. Idempotent.
# Exit codes: 0 = channel ready; 3 = waiting for you to add the bots to a server.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/../lib.sh"
ENVF="$HERE/../hermes/project.env"
load_env "$ENVF"
API="https://discord.com/api/v10"

command -v jq >/dev/null || die "jq required"
: "${DISCORD_BOT_TOKEN:?Hermes DISCORD_BOT_TOKEN missing in $ENVF}"
: "${EDMINI_DISCORD_BOT_TOKEN:?EDMINI_DISCORD_BOT_TOKEN missing in $ENVF}"
: "${EDMINI_BUS_CHANNEL:=edmini-bus}"

# Discord REST call that surfaces API errors (instead of an opaque curl failure). Token via $1.
dcall() { # token method url [json]
  local tok="$1" method="$2" url="$3" data="${4:-}" resp code body
  if [ -n "$data" ]; then
    resp="$(curl -sS -w $'\n%{http_code}' -X "$method" -H "Authorization: Bot $tok" \
      -H 'Content-Type: application/json' -d "$data" "$url")"
  else
    resp="$(curl -sS -w $'\n%{http_code}' -H "Authorization: Bot $tok" "$url")"
  fi
  code="$(printf '%s' "$resp" | tail -1)"; code="${code:-000}"
  body="$(printf '%s' "$resp" | sed '$d')"
  if [ "$code" -lt 200 ] || [ "$code" -ge 300 ]; then
    die "Discord $method ${url##*/} → HTTP $code: $(printf '%s' "$body" | jq -r '.message // tostring' 2>/dev/null)"
  fi
  printf '%s' "$body"
}

hname="$(dcall "$DISCORD_BOT_TOKEN" GET "$API/users/@me" | jq -r '.username')"
happ="$(dcall "$DISCORD_BOT_TOKEN" GET "$API/oauth2/applications/@me" | jq -r '.id')"
ename="$(dcall "$EDMINI_DISCORD_BOT_TOKEN" GET "$API/users/@me" | jq -r '.username')"
eapp="$(dcall "$EDMINI_DISCORD_BOT_TOKEN" GET "$API/oauth2/applications/@me" | jq -r '.id')"
note "bots: $hname + $ename"

# permissions=8 (Administrator) — pragmatic on a dedicated project server.
hinvite="https://discord.com/oauth2/authorize?client_id=$happ&scope=bot&permissions=8"
einvite="https://discord.com/oauth2/authorize?client_id=$eapp&scope=bot&permissions=8"

GID="${EDMINI_GUILD_ID:-}"
if [ -z "$GID" ]; then
  hg="$(dcall "$DISCORD_BOT_TOKEN" GET "$API/users/@me/guilds" | jq -r '.[].id' | sort)"
  eg="$(dcall "$EDMINI_DISCORD_BOT_TOKEN" GET "$API/users/@me/guilds" | jq -r '.[].id' | sort)"
  common="$(comm -12 <(printf '%s\n' "$hg") <(printf '%s\n' "$eg") | grep -v '^$' || true)"
  n="$(printf '%s\n' "$common" | grep -c . || true)"
  if [ "$n" = "1" ]; then
    GID="$(printf '%s\n' "$common" | head -1)"
    ok "Detected the server both bots share: $GID"
  elif [ "$n" = "0" ]; then
    echo ""
    echo "──────────────────────────────────────────────────────────────"
    echo "Add both bots to ONE Discord server, then re-run ./infra/up.sh"
    echo ""
    echo "  1. In Discord: '+' (left rail) → Create My Own → name it (e.g. edmini)."
    echo "  2. Open BOTH invite URLs and pick that same server:"
    echo "       $hname:  $hinvite"
    echo "       $ename:  $einvite"
    echo "  3. Make sure MESSAGE CONTENT INTENT is ON for both bots (Dev Portal → Bot)."
    echo "──────────────────────────────────────────────────────────────"
    exit 3
  else
    die "Both bots share multiple servers — set EDMINI_GUILD_ID in $ENVF to one of: $(printf '%s' "$common" | tr '\n' ' ')"
  fi
fi

# Find or create the bus channel (Hermes bot; Administrator covers Manage Channels).
CID="$(dcall "$DISCORD_BOT_TOKEN" GET "$API/guilds/$GID/channels" \
  | jq -r --arg n "$EDMINI_BUS_CHANNEL" '.[]|select(.type==0 and .name==$n)|.id' | head -1)"
if [ -z "$CID" ] || [ "$CID" = null ]; then
  CID="$(dcall "$DISCORD_BOT_TOKEN" POST "$API/guilds/$GID/channels" \
    "$(jq -n --arg n "$EDMINI_BUS_CHANNEL" '{name:$n,type:0}')" | jq -r '.id')"
  ok "Created #$EDMINI_BUS_CHANNEL ($CID)"
else
  note "#$EDMINI_BUS_CHANNEL already exists ($CID)"
fi

upsert_env "$ENVF" EDMINI_GUILD_ID "$GID"
upsert_env "$ENVF" EDMINI_BUS_CHANNEL_ID "$CID"
ok "Discord bus ready: guild $GID, #$EDMINI_BUS_CHANNEL ($CID)"
echo "(Reminder: MESSAGE CONTENT INTENT must be ON for both bots.)"
