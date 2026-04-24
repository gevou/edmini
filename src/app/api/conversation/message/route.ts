import { NextResponse } from "next/server";
import { appendConversationMessage } from "@/lib/conversation-log";

export async function POST(request: Request) {
  const body = await request.json();
  if (!body.role || !body.content || typeof body.timestamp !== "number") {
    return NextResponse.json({ error: "role, content, timestamp required" }, { status: 400 });
  }
  appendConversationMessage({ role: body.role, content: body.content, timestamp: body.timestamp });
  return NextResponse.json({ ok: true }, { status: 201 });
}
