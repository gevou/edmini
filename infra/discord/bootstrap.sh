#!/usr/bin/env bash
# Auto-provision the Discord side of the bus using bot tokens only (no manual server/channel work):
#   - create a dedicated guild with the Hermes bot (if it's in <10 guilds), or reuse EDMINI_GUILD_ID
#   - create the #<EDMINI_BUS_CHANNEL> text channel if missing
#   - print the ONE invite URL needed (for the edmini bot) — the Hermes bot owns the guild already
#   - write EDMINI_GUILD_ID + EDMINI_BUS_CHANNEL_ID back into infra/hermes/project.env
#
# Inputs (infra/hermes/project.env): DISCORD_BOT_TOKEN (Hermes), EDMINI_DISCORD_BOT_TOKEN (edmini),
# EDMINI_BUS_CHANNEL, optional EDMINI_GUILD_ID. Idempotent.
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
H=(-H "Authorization: Bot $DISCORD_BOT_TOKEN")

# Validate the Hermes bot token.
who="$(curl -fsS "${H[@]}" "$API/users/@me" | jq -r '.username // empty')" || die "Hermes bot token rejected by Discord"
note "Hermes bot: $who"

# Guild: reuse or create.
if [ -n "${EDMINI_GUILD_ID:-}" ]; then
  GID="$EDMINI_GUILD_ID"; note "Using existing guild $GID"
else
  cnt="$(curl -fsS "${H[@]}" "$API/users/@me/guilds" | jq 'length')"
  [ "$cnt" -ge 10 ] && die "Hermes bot is in $cnt guilds; Discord blocks bot guild-creation at >=10. Set EDMINI_GUILD_ID to an existing server in $ENVF."
  g="$(curl -fsS -X POST "${H[@]}" -H 'Content-Type: application/json' -d '{"name":"edmini"}' "$API/guilds")"
  GID="$(echo "$g" | jq -r '.id // empty')"; [ -n "$GID" ] || die "guild create failed: $g"
  ok "Created dedicated guild 'edmini' ($GID)"
fi

# Channel: find or create.
CID="$(curl -fsS "${H[@]}" "$API/guilds/$GID/channels" | jq -r --arg n "$EDMINI_BUS_CHANNEL" '.[]|select(.type==0 and .name==$n)|.id' | head -1)"
if [ -z "$CID" ] || [ "$CID" = null ]; then
  body="$(jq -n --arg n "$EDMINI_BUS_CHANNEL" '{name:$n,type:0}')"
  c="$(curl -fsS -X POST "${H[@]}" -H 'Content-Type: application/json' -d "$body" "$API/guilds/$GID/channels")"
  CID="$(echo "$c" | jq -r '.id // empty')"; [ -n "$CID" ] || die "channel create failed: $c"
  ok "Created #$EDMINI_BUS_CHANNEL ($CID)"
else
  note "#$EDMINI_BUS_CHANNEL already exists ($CID)"
fi

# Persist ids for configure.sh.
upsert_env "$ENVF" EDMINI_GUILD_ID "$GID"
upsert_env "$ENVF" EDMINI_BUS_CHANNEL_ID "$CID"

# Invite URL for the edmini bot (derive its application id from its token).
eapp="$(curl -fsS -H "Authorization: Bot $EDMINI_DISCORD_BOT_TOKEN" "$API/oauth2/applications/@me" | jq -r '.id // empty')" \
  || die "edmini bot token rejected by Discord"
# permissions=8 (Administrator) — pragmatic on a dedicated, throwaway project guild.
INVITE="https://discord.com/oauth2/authorize?client_id=$eapp&scope=bot&permissions=8&guild_id=$GID"

echo ""
ok "Discord bus ready: guild $GID, #$EDMINI_BUS_CHANNEL ($CID)"
echo "──────────────────────────────────────────────────────────────"
echo "ONE manual click left — add the edmini bot to the server:"
echo "  $INVITE"
echo "──────────────────────────────────────────────────────────────"
echo "(Reminder: enable the MESSAGE CONTENT INTENT on BOTH bots in the Developer Portal.)"
