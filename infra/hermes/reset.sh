#!/usr/bin/env bash
# Reset the project-dedicated Hermes to a clean, known configuration.
#
# Safe by default: takes a full Hermes backup (zip), then re-applies the edmini config and restarts.
# Pass --hard to ALSO prune session history for a clean slate (prompts for confirmation).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HARD=0
[ "${1:-}" = "--hard" ] && HARD=1

command -v hermes >/dev/null 2>&1 || { echo "✗ 'hermes' not on PATH."; exit 1; }

echo "• Backing up Hermes home (hermes backup)…"
hermes backup || echo "  (backup step reported an issue; continuing)"

if [ "$HARD" = 1 ]; then
  read -r -p "⚠️  --hard will prune Hermes session history. Continue? [y/N] " ans
  if [ "${ans:-N}" = "y" ] || [ "${ans:-N}" = "Y" ]; then
    # Conservative: use documented subcommands; ignore if flags differ across versions.
    hermes sessions prune 2>/dev/null || echo "  (sessions prune skipped — run 'hermes sessions --help')"
    hermes checkpoints clear 2>/dev/null || true
  else
    echo "  Skipping hard wipe."
  fi
fi

echo "• Re-applying edmini configuration…"
"$HERE/configure.sh"

echo "✓ Hermes reset complete."
