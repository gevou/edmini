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

Keep responses concise and conversational — you're a colleague, not a butler.`;

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
