import { NextResponse } from "next/server";
import { getConversationLog } from "@/lib/conversation-log";

export async function GET() {
  return NextResponse.json(getConversationLog());
}
