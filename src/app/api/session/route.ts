import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const clientKey = request.headers.get("x-openai-key");
  const apiKey = clientKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "No API key provided" }, { status: 401 });
  }

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
      instructions:
        "You are Ed, a warm and thoughtful conversational AI. Speak naturally and concisely. Listen carefully and respond with genuine interest. Keep replies short — this is a voice conversation.",
      turn_detection: {
        type: "server_vad",
        threshold: 0.5,
        prefix_padding_ms: 300,
        silence_duration_ms: 2000,
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
