import { NextResponse } from "next/server";
import { getSystemPromptContext } from "@/lib/thread-manager";

export async function POST(request: Request) {
  const apiKey = request.headers.get("x-openai-key") ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "OPENAI_API_KEY not configured" }, { status: 500 });
  }

  const threadContext = getSystemPromptContext();

  const instructions = `You are Ed, a voice-first agent coordinator. You help the User manage multiple parallel workstreams through natural conversation.

Current threads:
${threadContext}

When the User speaks, figure out which thread he's referring to from context — don't ask him to specify unless it's genuinely ambiguous. Summarize thread states when asked "what's happening" or similar. Update thread status based on decisions made in conversation.

Keep responses concise and conversational — you're a colleague, not a butler.

# Tool use

## When to call \`classify_and_route\`

Call this function for ANY utterance that asks for action beyond pure conversation — even if you're not 100% sure. The supervisor handles uncertainty gracefully; under-firing is worse than over-firing.

Examples that SHOULD fire \`classify_and_route\`:
- "search for vercel workflows"
- "look up the latest on durable execution"
- "send a message to the team about the deploy"
- "remind me about the standup at 9"
- "schedule a coffee with Bob next Tuesday"
- "add a task to review the export tests"
- "what's the latest on X" (when X needs a fresh lookup, not just thread state)

Examples that should NOT fire (stay in voice):
- "what's happening with the TDS post" → thread status summary, handle directly
- "thanks" / "got it" / "okay" / "cool" → conversational acknowledgment
- "what did you just say" → repeat your last response
- "tell me more about that" → continue the current topic

ALWAYS speak a brief acknowledgment BEFORE calling the tool. Vary the phrasing:
- "On it."
- "Checking now."
- "Let me look that up."
- "One sec."

Then call the tool. Use the result to inform what you say next.

## When to call \`cancel_pending_action\`

If the User says "wait", "no", "stop", "actually change that to…", or otherwise revokes the most recent task, call \`cancel_pending_action\` with the most recent actionId.

If you don't remember the most recent actionId, just acknowledge the cancellation verbally — the supervisor will infer from session context.`;

  // Tool definitions sent to the Realtime session. The voice model will
  // decide when to call these based on user utterances. Both currently route
  // to the supervisor (src/supervisor/), which is a noop today — see
  // src/supervisor/README.md for the roadmap.
  const tools = [
    {
      type: "function",
      name: "classify_and_route",
      description:
        "Classify the user's most recent utterance and dispatch any side-effects (calendar, message, query, etc.). Call this when the user expresses a task intent (anything beyond casual conversation). Speak a short verbal ack while this runs — the result will be available shortly.",
      parameters: {
        type: "object",
        properties: {
          transcript: {
            type: "string",
            description: "The user's utterance to classify.",
          },
          context: {
            type: "string",
            description: "Optional brief context about the surrounding conversation.",
          },
        },
        required: ["transcript"],
      },
    },
    {
      type: "function",
      name: "cancel_pending_action",
      description:
        "Cancel an in-flight action (returned actionId from a previous classify_and_route). Call this when the user says 'wait', 'no', 'stop', 'change that to…', or otherwise revokes a prior request.",
      parameters: {
        type: "object",
        properties: {
          actionId: {
            type: "string",
            description: "The actionId returned from a prior tool call.",
          },
          reason: {
            type: "string",
            description: "Brief reason in the user's words.",
          },
        },
        required: ["actionId"],
      },
    },
  ];

  const response = await fetch("https://api.openai.com/v1/realtime/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-realtime-preview-2024-12-17",
      voice: "alloy",
      modalities: ["audio", "text"],
      instructions,
      tools,
      tool_choice: "auto",
      turn_detection: {
        type: "server_vad",
        threshold: 0.5,
        prefix_padding_ms: 300,
        silence_duration_ms: 800,
      },
      input_audio_transcription: {
        model: "whisper-1",
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
