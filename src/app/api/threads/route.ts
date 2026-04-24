import { NextResponse } from "next/server";
import { getThreads, createThread } from "@/lib/thread-manager";

export async function GET() {
  return NextResponse.json(getThreads());
}

export async function POST(request: Request) {
  const body = await request.json();
  if (!body.name || !body.status || !body.category || !body.summary) {
    return NextResponse.json({ error: "name, status, category, summary required" }, { status: 400 });
  }
  const thread = createThread(body);
  return NextResponse.json(thread, { status: 201 });
}
