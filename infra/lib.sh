#!/usr/bin/env bash
# Shared helpers for edmini infra scripts. Source this; don't execute.

# Upsert KEY=VALUE into an env file (replace existing line or append). Value used verbatim.
upsert_env() {
  local f="$1" k="$2" v="$3" tmp
  touch "$f"
  tmp="$(mktemp)"
  grep -vE "^${k}=" "$f" > "$tmp" 2>/dev/null || true
  printf '%s=%s\n' "$k" "$v" >> "$tmp"
  mv "$tmp" "$f"
}

# Load an env file if it exists (exports all keys). Any value of the form `op://vault/item/field`
# is resolved through the 1Password CLI at runtime, so secrets never need to sit raw on disk.
load_env() {
  local f="$1" refs line k v real
  [ -f "$f" ] || return 0
  set -a; # shellcheck disable=SC1090
  source "$f"; set +a
  refs="$(grep -E '^[A-Za-z_][A-Za-z0-9_]*=op://' "$f" 2>/dev/null || true)"
  [ -n "$refs" ] || return 0
  command -v op >/dev/null 2>&1 || die "$f uses op:// references but the 1Password CLI 'op' is not installed."
  ensure_op || true   # best-effort interactive sign-in; the `op read` below is the real gate
  while IFS= read -r line; do
    k="${line%%=*}"; v="${line#*=}"
    real="$(op read "$v" 2>/dev/null)" || die "could not read $k from 1Password ($v) — check the item exists and CLI access is enabled (1Password → Settings → Developer → Integrate with 1Password CLI), then approve the unlock prompt."
    export "$k=$real"
  done <<< "$refs"
}

# Store a secret in 1Password (create or update) and echo its op:// reference.
# Args: <vault> <item-title> <value>. Uses the 'API Credential' category's `credential` field.
op_put() {
  local vault="$1" item="$2" value="$3"
  if op item get "$item" --vault "$vault" >/dev/null 2>&1; then
    op item edit "$item" --vault "$vault" "credential=$value" >/dev/null
  else
    op item create --category "API Credential" --title "$item" --vault "$vault" "credential=$value" >/dev/null
  fi
  printf 'op://%s/%s/credential' "$vault" "$item"
}

die() { echo "✗ $*" >&2; exit 1; }
note() { echo "• $*"; }
ok() { echo "✓ $*"; }

# Ensure the 1Password CLI has a usable session. No-op if op isn't installed (refs optional) or
# already signed in (e.g. via the desktop app integration, which uses biometrics per command).
# If signed out and we're in an interactive terminal, runs `op signin`. Returns non-zero if it
# still isn't usable (callers that actually need op:// refs then fail with a clear message).
ensure_op() {
  command -v op >/dev/null 2>&1 || return 0
  op whoami >/dev/null 2>&1 && return 0
  if [ -t 0 ]; then
    note "1Password CLI not signed in — running 'op signin'…"
    eval "$(op signin 2>/dev/null)" 2>/dev/null || true
    op whoami >/dev/null 2>&1 && { ok "1Password signed in."; return 0; }
  fi
  return 1
}
