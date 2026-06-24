import { NextResponse } from "next/server";
import { getSystemPromptContext } from "@/lib/topic-manager";
import { ledgerFromEnv } from "@/lib/ledger-supabase";
import { recentConversation, labelsByRun, projectRuns } from "@/lib/ledger";

export async function GET() {
  const hasKey = Boolean(process.env.OPENAI_API_KEY);
  return NextResponse.json({ hasServerKey: hasKey });
}

export async function POST(request: Request) {
  let grading = false;
  let userName: string | undefined;
  try {
    const b = (await request.clone().json()) as { grading?: boolean; userName?: string };
    grading = Boolean(b.grading);
    if (typeof b.userName === "string" && b.userName.trim()) userName = b.userName.trim().slice(0, 40);
  } catch { /* no body */ }

  const apiKey = request.headers.get("x-openai-key") ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "OPENAI_API_KEY not configured" }, { status: 500 });
  }

  const topicContext = getSystemPromptContext();

  let historyBlock = "";
  try {
    const events = await ledgerFromEnv({ serviceRole: true }).snapshot({ limit: 200 });
    const convo = recentConversation(events, 12)
      .map((e) => {
        // Attribute an enrolled non-principal turn by name (q1e), so Ed recalls "Roger said X" not "User".
        const speaker = typeof e.payload.speaker === "string" ? e.payload.speaker : null;
        const who = e.source === "user" ? (speaker ?? "User") : "Ed";
        const text = typeof e.payload.text === "string" ? e.payload.text : "";
        return text ? `- ${who}: ${text}` : "";
      })
      .filter(Boolean);
    const labels = labelsByRun(events);
    const runs = projectRuns(events)
      .slice(-8)
      .map((r) => {
        const status =
          r.lastRunKind === "run_failed" ? "failed"
            : r.lastRunKind === "run_done" ? "done"
              : r.lastRunKind === "run_blocked" ? "blocked" : "active";
        return `- '${labels.get(r.runId) ?? r.runId}' — ${status}`;
      });
    if (convo.length || runs.length) {
      historyBlock = `\n\n## Recent history\n(From the ledger — your memory of recent turns and runs. Reference it; if the User points at something older, call search_history.)\n${
        convo.length ? `\nRecent conversation:\n${convo.join("\n")}` : ""
      }${runs.length ? `\n\nRecent runs:\n${runs.join("\n")}` : ""}`;
    }
  } catch { /* fail open — no history block */ }

  const instructions = `You are Edmini (you also answer to "Ed"), a voice-first agent coordinator. When asked your name, say Edmini. You delegate the User's tasks to an autonomous agent harness (the executor that actually does the work — research, lookups, messages, scheduling, ops) and keep the User informed as the harness works. You coordinate; you do NOT do the work yourself.

Current topics:
${topicContext}

Figure out which topic the User means from context — don't ask him to specify unless it's genuinely ambiguous. Summarize topic states when asked "what's happening" or similar. Keep responses concise and conversational — you're a colleague, not a butler.

# Delegating work

When the User asks for something beyond conversation, you delegate it with \`delegate_task\` — a clear, self-contained instruction AND a short \`label\` (a one or two word handle, e.g. "export", "vercel-research", "standup"). You can run MANY tasks at once; each gets its own label, which you reuse whenever you refer to it later.

**Clarify and confirm BEFORE you delegate — do not jump into action:**
- If anything about the request is ambiguous, underspecified, or you're not sure what the User means, ASK a clarifying question first. Never guess and dispatch.
- Unless the request is short and crystal clear, briefly **confirm what you're about to delegate and wait for the User's yes** before calling \`delegate_task\` — e.g. "So you want the agent to create a kanban board for the service-design project — go ahead?". Delegating the wrong thing wastes a real run; a one-line check is cheap.
- Only delegate directly (with a quick "On it.") when the request is simple and unambiguous.

Once you DO delegate, say a short ack and nothing more; the harness handles it in the background and its updates come back to you.

Examples that SHOULD fire \`delegate_task\`:
- "search for vercel workflows" → label "vercel-workflows"
- "look up the latest on durable execution" → label "durable-execution"
- "send a message to the team about the deploy" → label "deploy-msg"
- "remind me about the standup at 9" → label "standup"

Examples that should NOT fire (stay in voice):
- "what's happening with the export" → run status summary, handle directly
- "thanks" / "got it" / "okay" / "cool" → conversational acknowledgment
- "what did you just say" → repeat your last response

# Background updates from the harness

Each run works in the background. Its updates are relayed to you as system notifications that NAME the run by its label, e.g. "(System update — run 'export': …)". Relay each to the User naturally and briefly, in your own words, mentioning which task it's about when more than one is in flight. Do NOT read it verbatim, and do NOT call a tool just because an update arrived.

**Be faithful — never get ahead of the agent. This is critical:**
- Relay ONLY what the update actually says. Do NOT invent or assume details, statuses, names, slugs, links, numbers, or confirmations the agent did not give you.
- **Distinguish progress from completion.** An update tagged "reported" is the agent still WORKING — a step or partial result, NOT done. An update tagged "finished"/"done" is completion. **Never say a task is done, created, set up, ready, or successful until you receive a completion ("finished") update for that run.** Until then, if asked, say the agent is still working on it.
- If an update looks like an intermediate step (e.g. loading a tool, listing options) or is unclear, treat it as progress ("it's working on it") — do not guess the outcome or announce success.
- It is always better to under-claim ("the agent is on it, I'll confirm when it's done") than to claim something finished that hasn't been confirmed.

# Mid-run actions (always identify the run by its label)

- If a run comes back blocked with a question and the User answers it, call \`answer_run\` with that run's \`label\` and the User's answer so the run can continue.
- If the User revokes a task ("stop", "cancel", "never mind", "drop the export one"), call \`cancel_run\` with that run's \`label\`. Infer which label the User means from context.`;

  const userLine = userName
    ? `\n\nYou are speaking with **${userName}** (their enrolled voice). Address them by name naturally when it fits — don't overuse it.`
    : "";
  const instructionsWithHistory = instructions + userLine + historyBlock;

  // Tool definitions sent to the Realtime session. The voice model decides when
  // to call these. They map to the three outbound bus actions; the client POSTs
  // them to /api/bus (dispatch/answer/cancel → Discord transport + ledger) and
  // tracks N concurrent runs by label in a run registry. See src/app/api/bus/
  // route.ts, src/lib/voice/run-registry.ts, and edmini-9ex.
  const tools = [
    {
      type: "function",
      name: "delegate_task",
      description:
        "Delegate a task to the agent harness (the executor). Call this whenever the User asks for any action beyond conversation. Many tasks can run at once. Speak a brief verbal ack while it runs; the harness works in the background and its updates are relayed back to you (tagged by label) as they arrive.",
      parameters: {
        type: "object",
        properties: {
          instruction: {
            type: "string",
            description:
              "The full instruction to hand to the harness, in natural language. Self-contained — include everything the executor needs to act without further context.",
          },
          label: {
            type: "string",
            description:
              "A short one or two word handle for this task (e.g. 'export', 'vercel-research'). Used to refer to the run later in answer_run/cancel_run and in the updates relayed back to you. Pick something distinct and memorable.",
          },
        },
        required: ["instruction", "label"],
      },
    },
    {
      type: "function",
      name: "answer_run",
      description:
        "Answer a question a blocked run asked. Call this when a run came back blocked asking for clarification and the User has provided the answer, so that run can continue.",
      parameters: {
        type: "object",
        properties: {
          label: {
            type: "string",
            description: "The label of the run being answered (the one that asked the question).",
          },
          text: {
            type: "string",
            description: "The User's answer to the run's question, in natural language.",
          },
        },
        required: ["label", "text"],
      },
    },
    {
      type: "function",
      name: "cancel_run",
      description:
        "Cancel a run. Call this when the User says 'stop', 'cancel', 'never mind', 'drop the X one', or otherwise revokes a task. Identify which run by its label.",
      parameters: {
        type: "object",
        properties: {
          label: {
            type: "string",
            description: "The label of the run to cancel (infer which one the User means from context).",
          },
          reason: {
            type: "string",
            description: "Brief reason in the User's words (optional).",
          },
        },
        required: ["label"],
      },
    },
    {
      type: "function",
      name: "search_history",
      description:
        "Search the conversation/run ledger for older context when the User refers to something not in your Recent history, or to follow a run's provenance. Returns raw events; read them and answer faithfully. Each result may carry prevRunId — re-call with that runId to walk a run's lineage one hop at a time.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "Free-text to match in event payloads." },
          runId: { type: "string", description: "Restrict to one run (opaque id from a prior result)." },
          since: { type: "string", description: "ISO timestamp lower bound." },
          until: { type: "string", description: "ISO timestamp upper bound." },
          source: { type: "string", enum: ["user", "edmini", "harness"], description: "Who emitted the event." },
          limit: { type: "number", description: "Max events to return (default 30, max 100)." },
        },
      },
    },
  ];

  const response = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      expires_after: { anchor: "created_at", seconds: 600 },
      session: {
        type: "realtime",
        model: "gpt-realtime",
        instructions: instructionsWithHistory,
        output_modalities: ["audio"],
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 24000 },
            transcription: { model: "whisper-1" },
            turn_detection: {
              type: "server_vad",
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 800,
              ...(grading ? { create_response: false } : {}),
            },
          },
          output: {
            format: { type: "audio/pcm", rate: 24000 },
            voice: "alloy",
          },
        },
        tools,
        tool_choice: "auto",
        // Request per-token transcription logprobs (edmini-put). The not-enrolled pass-through path uses
        // them to reject non-speech whisper hallucinations (e.g. a system beep → "Bye-bye") before they
        // become a phantom response or a fake ledger turn. Session-level field per the GA Realtime spec.
        include: ["item.input_audio_transcription.logprobs"],
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    return NextResponse.json({ error }, { status: response.status });
  }

  const data = await response.json();
  return NextResponse.json(data);
}
