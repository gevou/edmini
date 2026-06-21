import { NextResponse } from "next/server";
import { getTopics } from "@/lib/topic-manager";
import { classifyTopic } from "@/lib/classify-topic";

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
  const topics = getTopics();

  console.log(`[classify route] ${topics.length} topics loaded, apiKey header: ${apiKey ? "present" : "absent"}, OPENAI_API_KEY env: ${process.env.OPENAI_API_KEY ? "set" : "NOT SET"}`);

  let topicId: string;
  try {
    topicId = await classifyTopic(body.utterance, topics, apiKey);
  } catch (err) {
    console.error("[classify route] classifyTopic threw:", err);
    topicId = "general";
  }

  return NextResponse.json({ topicId, confidence: topicId === "general" ? 0 : 0.85 });
}
