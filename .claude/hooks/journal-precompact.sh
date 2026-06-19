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

Write a PRAGMATIC, FACTUAL engineering-log entry — detail over style. Capture raw material (what changed, why, how it was verified) so it can be repurposed later. Do NOT dramatize, editorialize, or write essay/narrative prose. Neutral tone, dense with specifics. INCLUDE concrete artifacts: file paths, key code snippets (in fenced code blocks), commands, results/output, and small mermaid diagrams for architecture/flow/data when they help. Prefer structured sections + bullets over paragraphs.

From the session transcript below, write a single entry as Markdown — use fenced blocks for code/mermaid, but do NOT wrap the whole entry in one code fence. Begin with this exact heading and use whichever sections apply:

### $TODAY — <concise factual title>

- **What changed** — files added/modified, components, commit hashes.
- **Decisions** — choice + brief factual reason + alternatives considered.
- **Code / diagrams** — key snippets and/or a small mermaid diagram.
- **Verification** — commands run + results (tests, smoke, live checks).
- **Gotchas** — concrete issues + fixes.
- **Open / next** — what's pending.

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
