#!/usr/bin/env bash
# Guided first-time setup. Collects the irreducible secrets, then automates the rest.
#
# You provide (once): 2 Discord bot tokens (Hermes + edmini, Message Content intent ON) and a
# Supabase Personal Access Token. Everything else — guild, channel, project, migrations, Hermes
# config — is automated. Re-runnable: existing values are kept.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$HERE/lib.sh"
HE="$HERE/hermes/project.env"; SE="$HERE/supabase/project.env"
[ -f "$HE" ] || cp "$HERE/hermes/project.env.example" "$HE"
[ -f "$SE" ] || cp "$HERE/supabase/project.env.example" "$SE"
load_env "$HE"; load_env "$SE"

# 1Password: if the op CLI is connected, store secrets there and keep only op:// refs on disk.
USE_OP=0
if command -v op >/dev/null 2>&1 && op whoami >/dev/null 2>&1; then
  USE_OP=1; OP_VAULT="${OP_VAULT:-Private}"
  echo "🔐 1Password connected → secrets stored in vault '$OP_VAULT' (only op:// refs land on disk)."
else
  echo "ℹ️  1Password CLI not connected → secrets stored as raw values in gitignored project.env."
  echo "    (To use 1Password: enable the desktop app's CLI integration or 'op account add', then re-run.)"
fi

ask_secret() { # var file prompt op_item
  local var="$1" file="$2" prompt="$3" item="$4" cur val ref
  cur="$(grep -E "^$var=" "$file" | tail -1 | cut -d= -f2-)"
  if [ -n "$cur" ]; then echo "  $var already set — keeping."; return; fi
  printf "  %s (value, or paste an op:// reference): " "$prompt"; read -rs val; echo
  [ -n "$val" ] || { echo "  (skipped)"; return; }
  if [ "${val:0:5}" = "op://" ]; then upsert_env "$file" "$var" "$val"; echo "  → stored op:// reference."; return; fi
  if [ "$USE_OP" = 1 ]; then
    ref="$(op_put "$OP_VAULT" "$item" "$val")"; upsert_env "$file" "$var" "$ref"; echo "  → saved to 1Password ($ref)."
  else
    upsert_env "$file" "$var" "$val"
  fi
}

echo "════════ edmini infra init ════════"
echo "Discord (create 2 bots in the Developer Portal, enable MESSAGE CONTENT INTENT on each):"
ask_secret DISCORD_BOT_TOKEN        "$HE" "Hermes bot token" "edmini-hermes-bot"
ask_secret EDMINI_DISCORD_BOT_TOKEN "$HE" "edmini bot token" "edmini-discord-bot"
grep -qE '^EDMINI_BUS_CHANNEL=' "$HE" || upsert_env "$HE" EDMINI_BUS_CHANNEL edmini-bus
echo "Supabase (create a Personal Access Token at supabase.com/dashboard/account/tokens):"
ask_secret SUPABASE_ACCESS_TOKEN    "$SE" "Supabase access token (PAT)" "edmini-supabase-pat"

echo ""; echo "▶ Provisioning Discord guild + channel…"
"$HERE/discord/bootstrap.sh"
echo ""; read -r -p "Click the invite URL above to add the edmini bot, then press Enter to continue… " _

echo ""; echo "▶ Provisioning Supabase project…"
"$HERE/supabase/provision.sh"

echo ""; echo "▶ Bringing infra up (configure Hermes + apply ledger)…"
"$HERE/up.sh"

echo ""; echo "▶ Preflight…"
"$HERE/preflight.sh" || echo "(preflight reported issues — see above)"
echo "✓ init complete."
