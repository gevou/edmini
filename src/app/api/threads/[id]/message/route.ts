import { NextResponse } from "next/server";
import { addMessage } from "@/lib/thread-manager";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json();
  if (!body.role || !body.content) {
    return NextResponse.json({ error: "role and content required" }, { status: 400 });
  }
  if (body.role !== "user" && body.role !== "ed") {
    return NextResponse.json({ error: "role must be 'user' or 'ed'" }, { status: 400 });
  }
  const thread = addMessage(id, body.role, body.content);
  if (!thread) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(thread);
}
