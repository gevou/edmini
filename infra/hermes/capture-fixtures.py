#!/usr/bin/env python3
"""
Capture Hermes bus fixtures for the inbound interpreter (beads edmini-pmo / edmini-dze).

Posts a set of varied prompts to #edmini-bus AS the edmini bot (Discord REST), polls for EdHermes's
replies, and writes them to src/lib/bus/__fixtures__/hermes-messages.json. Also verifies the
production sender path (edmini bot -> Hermes), not just human -> Hermes.

Secrets: the edmini bot token is read at runtime from 1Password (op read). Never printed.
Run: python3 infra/hermes/capture-fixtures.py
"""
import json, os, subprocess, sys, time, urllib.request, urllib.error

CHANNEL_ID = "1517068895578620026"
HERMES_USERNAME = "EdHermes"
API = "https://discord.com/api/v10"
FIXTURES = os.path.join(os.path.dirname(__file__), "..", "..", "src", "lib", "bus", "__fixtures__", "hermes-messages.json")

PROMPTS = [
    "What is 17 multiplied by 43?",
    "Schedule a meeting for me tomorrow.",          # ambiguous -> expect a clarifying question
    "List three prime numbers between 50 and 100.",
    "Give me a two-line poem about debugging.",
    "What can you help me with? One sentence.",
    "What is the capital of France and its population?",
]

def op_read(ref):
    return subprocess.check_output(["op", "read", ref], text=True).strip()

TOKEN = op_read("op://Private/edmini-discord-bot/credential")
HEADERS = {"Authorization": f"Bot {TOKEN}", "Content-Type": "application/json",
           "User-Agent": "DiscordBot (https://github.com/gevou/edmini, 0.1)"}

def api(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, headers=HEADERS, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code}: {e.read().decode()[:200]}", file=sys.stderr)
        raise

def latest_id():
    msgs = api("GET", f"/channels/{CHANNEL_ID}/messages?limit=1")
    return msgs[0]["id"] if msgs else "0"

def post(content):
    return api("POST", f"/channels/{CHANNEL_ID}/messages", {"content": content})["id"]

def wait_for_hermes(after_id, timeout=90, interval=6):
    """Return concatenated EdHermes message text posted after after_id, or '' on timeout."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        time.sleep(interval)
        msgs = api("GET", f"/channels/{CHANNEL_ID}/messages?after={after_id}&limit=25")
        hermes = [m["content"] for m in reversed(msgs)
                  if m.get("author", {}).get("username") == HERMES_USERNAME and m.get("content")]
        if hermes:
            return "\n".join(hermes)
    return ""

def main():
    captured = []
    for p in PROMPTS:
        print(f"→ posting: {p}")
        mid = post(p)
        reply = wait_for_hermes(mid)
        print(f"  ← {'(no reply within timeout)' if not reply else reply[:120]}")
        captured.append({"prompt": p, "hermes": reply or None, "kind": None, "ts": None})
        time.sleep(2)

    # Merge: keep existing real (non-null) fixtures, drop null placeholders, append new.
    existing = []
    if os.path.exists(FIXTURES):
        try:
            existing = [e for e in json.load(open(FIXTURES)) if e.get("hermes")]
        except Exception:
            existing = []
    out = existing + captured
    os.makedirs(os.path.dirname(FIXTURES), exist_ok=True)
    json.dump(out, open(FIXTURES, "w"), indent=2, ensure_ascii=False)
    replied = sum(1 for c in captured if c["hermes"])
    print(f"\nDONE: {replied}/{len(PROMPTS)} prompts got a reply. Wrote {len(out)} fixtures to {os.path.relpath(FIXTURES)}")

if __name__ == "__main__":
    main()
