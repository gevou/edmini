#!/usr/bin/env bash
# Project PreCompact hook (edmini) — auto-append a narrative journal entry to
# PROJECT_JOURNAL.md before context compaction, using the session transcript.
#
# Authorized by the user (2026-06-17) to make journaling fully hands-off.
# Complements the global journaling hooks (which nudge /journal on Stop and are
# commit-centric). This one is transcript-aware so it captures the DISCUSSION and
# DECISIONS that would otherwise be lost at compaction. Always exits 0.
set -uo pipefail

INPUT=$(cat 2>/dev/null || echo "")
TRANSCRIPT_PATH=$(printf '%s' "$INPUT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('transcript_path',''))" 2>/dev/null || echo "")

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
JOURNAL="$REPO_ROOT/PROJECT_JOURNAL.md"
[ -f "$JOURNAL" ] || exit 0
command -v claude >/dev/null 2>&1 || exit 0

# Debounce: skip if the journal was written in the last 20 min (avoid double entries
# right after a manual/in-session journal write).
MTIME=$(stat -f %m "$JOURNAL" 2>/dev/null || echo 0)
NOW=$(date +%s)
[ $(( NOW - MTIME )) -lt 1200 ] && exit 0

TRANSCRIPT_TAIL=""
if [ -n "$TRANSCRIPT_PATH" ] && [ -f "$TRANSCRIPT_PATH" ]; then
  TRANSCRIPT_TAIL=$(tail -400 "$TRANSCRIPT_PATH" 2>/dev/null || echo "")
fi
[ -z "$TRANSCRIPT_TAIL" ] && exit 0

TODAY=$(date '+%Y-%m-%d')
BRANCH=$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")

ENTRY=$(claude -p "You are appending ONE entry to PROJECT_JOURNAL.md for the project 'edmini' (a voice agent that supervises autonomous executors over a Discord bus + Supabase ledger).

Goal: a RICH, DETAILED record that captures raw material to tell stories from LATER — this is NOT the finished blog post. Detail over brevity: do not over-condense; capturing the specifics matters more than length.

Capture the SPECIFICS of this session: the actual decisions and the reasoning behind them, alternatives weighed, dead ends, surprises, and the concrete changes — file paths, key code snippets (fenced), commands, results/output, and small mermaid diagrams for architecture/flow/data. Where a moment turned on something said, QUOTE it directly from the transcript (the user's words, or a key exchange) instead of paraphrasing generically.

Narrative is welcome WHEN it describes something specific (a real decision, change, exchange, or problem). Avoid generic or dramatized filler not tied to specifics, and don't pre-write a polished article — leave the shaping for later.

From the session transcript below, write a single entry as Markdown — use fenced blocks for code/mermaid, but do NOT wrap the whole entry in one code fence. Begin with this exact heading; organize however best fits (sections, prose, quotes, snippets):

### $TODAY — <specific title>

Include when present: what changed (files/components/commits); decisions + reasoning + alternatives; direct quotes of pivotal dialog; code snippets / diagrams; verification (commands + results); gotchas + fixes; open/next.

---

If nothing substantive happened this session, output the single word: SKIP

SESSION TRANSCRIPT (tail):
$TRANSCRIPT_TAIL" 2>/dev/null || echo "")

[ -z "$ENTRY" ] && exit 0
printf '%s' "$ENTRY" | grep -qx "SKIP" && exit 0

# Insert the entry right after the "## Journal Entries" header (newest first).
ENTRY_FILE=$(mktemp) || exit 0
printf '%s\n' "$ENTRY" > "$ENTRY_FILE"
TMP=$(mktemp) || { rm -f "$ENTRY_FILE"; exit 0; }
awk -v ef="$ENTRY_FILE" '
  { print }
  /^## Journal Entries[[:space:]]*$/ && !inserted {
    print ""
    while ((getline line < ef) > 0) print line
    close(ef)
    inserted=1
  }
' "$JOURNAL" > "$TMP" 2>/dev/null && mv "$TMP" "$JOURNAL" 2>/dev/null || rm -f "$TMP"
rm -f "$ENTRY_FILE"

exit 0
