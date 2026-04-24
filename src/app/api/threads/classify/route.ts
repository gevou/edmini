import { NextResponse } from "next/server";
import { getThreads } from "@/lib/thread-manager";
import { classifyThread } from "@/lib/classify-thread";

export async function POST(request: Request) {
  const body = await request.json();
  if (!body.utterance) {
    return NextResponse.json({ error: "utterance required" }, { status: 400 });
  }
  const apiKey = request.headers.get("x-openai-key") ?? undefined;
  const threads = getThreads();
  const threadId = await classifyThread(body.utterance as string, threads, apiKey);
  const confidence = threadId === "general" ? 0 : 0.85;
  return NextResponse.json({ threadId, confidence });
}
