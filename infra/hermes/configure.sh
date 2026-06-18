#!/usr/bin/env bash
# Configure the local, project-dedicated Hermes to use a Discord channel as the edmini bus.
#
# Idempotent. Manages ONLY a delimited "edmini-managed" block in ~/.hermes/.env and always backs
# the file up first. Restarts the Hermes gateway service at the end. Never prints the bot token.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ENV="$HERE/project.env"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
ENV_FILE="$HERMES_HOME/.env"
MARK_START="# >>> edmini-managed (configure.sh — do not edit by hand) >>>"
MARK_END="# <<< edmini-managed <<<"

command -v hermes >/dev/null 2>&1 || { echo "✗ 'hermes' not on PATH. Install Hermes first."; exit 1; }
[ -f "$PROJECT_ENV" ] || { echo "✗ Missing $PROJECT_ENV — copy project.env.example to project.env and fill it in."; exit 1; }
[ -f "$ENV_FILE" ] || { echo "✗ $ENV_FILE not found — is Hermes initialised? Try 'hermes setup'."; exit 1; }

# Load project config (no export of secrets to child logs).
set -a; # shellcheck disable=SC1090
source "$PROJECT_ENV"; set +a

: "${DISCORD_BOT_TOKEN:?Set DISCORD_BOT_TOKEN in project.env}"
: "${EDMINI_BUS_CHANNEL:?Set EDMINI_BUS_CHANNEL in project.env}"
DISCORD_ALLOW_BOTS="${DISCORD_ALLOW_BOTS:-true}"
CHANNEL_REF="${EDMINI_BUS_CHANNEL_ID:-$EDMINI_BUS_CHANNEL}"

# Back up ~/.hermes/.env (timestamped).
BACKUP="$ENV_FILE.bak.$(date +%Y%m%d_%H%M%S)"
cp "$ENV_FILE" "$BACKUP"
echo "• Backed up $ENV_FILE → $BACKUP"

# Strip any existing edmini-managed block, then append a fresh one.
tmp="$(mktemp)"
awk -v s="$MARK_START" -v e="$MARK_END" '
  $0==s {skip=1; next}
  $0==e {skip=0; next}
  skip!=1 {print}
' "$ENV_FILE" > "$tmp"

{
  cat "$tmp"
  echo "$MARK_START"
  echo "DISCORD_BOT_TOKEN=$DISCORD_BOT_TOKEN"
  echo "DISCORD_ALLOW_BOTS=$DISCORD_ALLOW_BOTS"
  echo "DISCORD_HOME_CHANNEL_NAME=$EDMINI_BUS_CHANNEL"
  [ -n "${EDMINI_BUS_CHANNEL_ID:-}" ] && echo "DISCORD_HOME_CHANNEL=$EDMINI_BUS_CHANNEL_ID"
  echo "DISCORD_ALLOWED_CHANNELS=$CHANNEL_REF"
  echo "DISCORD_FREE_RESPONSE_CHANNELS=$CHANNEL_REF"
  echo "DISCORD_AUTO_THREAD=true"
  echo "$MARK_END"
} > "$ENV_FILE"
rm -f "$tmp"
echo "• Wrote edmini-managed Discord block to $ENV_FILE (bus channel: #$EDMINI_BUS_CHANNEL, allow_bots=$DISCORD_ALLOW_BOTS)"

# Restart the gateway so it picks up the new platform config.
echo "• Restarting Hermes gateway…"
hermes gateway restart || { echo "✗ gateway restart failed — check 'hermes gateway status'"; exit 1; }

echo "✓ Hermes configured for the edmini Discord bus."
echo "  Verify:  hermes send --list discord    (or ./infra/hermes/status.sh)"
