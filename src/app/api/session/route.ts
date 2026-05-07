import { NextResponse } from "next/server";
import { getSystemPromptContext } from "@/lib/thread-manager";

export async function POST(request: Request) {
  const apiKey = request.headers.get("x-openai-key") ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "OPENAI_API_KEY not configured" }, { status: 500 });
  }

  const threadContext = getSystemPromptContext();

  const instructions = `You are Ed, a voice-first agent coordinator. You help George manage multiple parallel workstreams through natural conversation.

Current threads:
${threadContext}

When George speaks, figure out which thread he's referring to from context — don't ask him to specify unless it's genuinely ambiguous. Summarize thread states when asked "what's happening" or similar. Update thread status based on decisions made in conversation.

Keep responses concise and conversational — you're a colleague, not a butler.

# Tool use

When George expresses a TASK intent (schedule, send, query, update, dispatch — anything beyond casual conversation), call the \`classify_and_route\` function with his transcript. While the function runs, give a short verbal acknowledgment (e.g. "got it, working on that") so he doesn't feel ignored. Use the function's result to inform your next response.

If George says "wait", "no", "stop", "change that to…", or otherwise revokes a recent task, call \`cancel_pending_action\` with the most recent actionId you received.

Do NOT call tools for casual conversation, status questions, or thread summaries — those stay in voice. Tools are for actions with side effects.`;

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
            description:
              "Optional brief context about the surrounding conversation.",
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
