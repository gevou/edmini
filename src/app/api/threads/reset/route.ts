import { NextResponse } from "next/server";
import { resetThreads } from "@/lib/thread-manager";

export async function DELETE() {
  resetThreads();
  return NextResponse.json({ ok: true });
}
