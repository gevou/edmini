import { NextResponse } from "next/server";
import { getTopics, createTopic, resetTopics } from "@/lib/topic-manager";

export async function GET() {
  return NextResponse.json(getTopics());
}

export async function DELETE() {
  resetTopics();
  return NextResponse.json({ ok: true });
}

export async function POST(request: Request) {
  const body = await request.json();
  if (!body.name || !body.status || !body.category || !body.summary) {
    return NextResponse.json({ error: "name, status, category, summary required" }, { status: 400 });
  }
  const topic = createTopic(body);
  return NextResponse.json(topic, { status: 201 });
}
