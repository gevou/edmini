import { NextResponse } from "next/server";
import { getThreads } from "@/lib/thread-manager";
import { classifyThread } from "@/lib/classify-thread";

export async function POST(request: Request) {
  let body: { utterance?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  if (!body.utterance) {
    return NextResponse.json({ error: "utterance required" }, { status: 400 });
  }

  const apiKey = request.headers.get("x-openai-key") ?? undefined;
  const threads = getThreads();

  console.log(`[classify route] ${threads.length} threads loaded, apiKey header: ${apiKey ? "present" : "absent"}, OPENAI_API_KEY env: ${process.env.OPENAI_API_KEY ? "set" : "NOT SET"}`);

  let threadId: string;
  try {
    threadId = await classifyThread(body.utterance, threads, apiKey);
  } catch (err) {
    console.error("[classify route] classifyThread threw:", err);
    threadId = "general";
  }

  return NextResponse.json({ threadId, confidence: threadId === "general" ? 0 : 0.85 });
}
