#!/usr/bin/env bash
# Quick health check of the project-dedicated Hermes + Discord bus.
set -uo pipefail
command -v hermes >/dev/null 2>&1 || { echo "✗ 'hermes' not on PATH."; exit 1; }

echo "=== hermes gateway status ==="
hermes gateway status 2>&1 | sed -n '1,12p'
echo ""
echo "=== discord targets ==="
hermes send --list discord 2>&1 | head -20
echo ""
echo "=== hermes doctor (summary) ==="
hermes doctor 2>&1 | tail -20
