import { NextResponse } from "next/server";
import { getSystemPromptContext } from "@/lib/thread-manager";

export async function GET() {
  const hasKey = Boolean(process.env.OPENAI_API_KEY);
  return NextResponse.json({ hasServerKey: hasKey });
}

export async function POST(request: Request) {
  const apiKey = request.headers.get("x-openai-key") ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "OPENAI_API_KEY not configured" }, { status: 500 });
  }

  const threadContext = getSystemPromptContext();

  const instructions = `You are Ed, a voice-first agent coordinator. You delegate the User's tasks to an autonomous agent harness (the executor that actually does the work — research, lookups, messages, scheduling, ops) and keep the User informed as the harness works. You coordinate; you do NOT do the work yourself.

Current threads:
${threadContext}

Figure out which thread the User means from context — don't ask him to specify unless it's genuinely ambiguous. Summarize thread states when asked "what's happening" or similar. Keep responses concise and conversational — you're a colleague, not a butler.

# Delegating work

When the User asks for anything beyond conversation, call \`delegate_task\` with a clear, self-contained instruction for the harness. There is exactly ONE active run at a time. Say a short verbal ack ("On it.") while it runs — nothing more. Do NOT elaborate and do NOT claim you can't do something; the harness handles it in the background.

Examples that SHOULD fire \`delegate_task\`:
- "search for vercel workflows"
- "look up the latest on durable execution"
- "send a message to the team about the deploy"
- "remind me about the standup at 9"
- "schedule a coffee with Bob next Tuesday"
- "add a task to review the export tests"

Examples that should NOT fire (stay in voice):
- "what's happening with the TDS post" → thread status summary, handle directly
- "thanks" / "got it" / "okay" / "cool" → conversational acknowledgment
- "what did you just say" → repeat your last response

# Background updates from the harness

As the harness works, its updates (a clarifying question, a result, a failure, completion) are relayed to you as system notifications prefixed "(System update from the background task…)". When you receive one, relay it to the User naturally and briefly, in your own words — do NOT read it verbatim, and do NOT call a tool just because an update arrived.

# Mid-run actions

- If the harness comes back blocked with a question and the User answers it, call \`answer_run\` with the User's answer so the run can continue.
- If the User says "wait", "no", "stop", "cancel", "never mind", or otherwise revokes the task, call \`cancel_run\`.`;

  // Tool definitions sent to the Realtime session. The voice model decides when
  // to call these. They map to the three outbound bus actions; the client POSTs
  // them to /api/bus (dispatch/answer/cancel → Discord transport + ledger) and
  // tracks the one active runId. See src/app/api/bus/route.ts and edmini-fw5.
  const tools = [
    {
      type: "function",
      name: "delegate_task",
      description:
        "Delegate a task to the agent harness (the executor). Call this whenever the User asks for any action beyond conversation. Speak a brief verbal ack while it runs; the harness works in the background and its updates are relayed back to you as they arrive.",
      parameters: {
        type: "object",
        properties: {
          instruction: {
            type: "string",
            description:
              "The full instruction to hand to the harness, in natural language. Self-contained — include everything the executor needs to act without further context.",
          },
        },
        required: ["instruction"],
      },
    },
    {
      type: "function",
      name: "answer_run",
      description:
        "Answer a question the active run asked. Call this when the harness came back blocked asking for clarification and the User has provided the answer, so the run can continue. Targets the one active run automatically.",
      parameters: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "The User's answer to the run's question, in natural language.",
          },
        },
        required: ["text"],
      },
    },
    {
      type: "function",
      name: "cancel_run",
      description:
        "Cancel the active run. Call this when the User says 'stop', 'cancel', 'never mind', 'wait, no', or otherwise revokes the current task. Targets the one active run automatically.",
      parameters: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description: "Brief reason in the User's words (optional).",
          },
        },
        required: [],
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
        instructions,
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
            },
          },
          output: {
            format: { type: "audio/pcm", rate: 24000 },
            voice: "alloy",
          },
        },
        tools,
        tool_choice: "auto",
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
