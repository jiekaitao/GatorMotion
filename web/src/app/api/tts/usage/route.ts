import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getTtsUsageStats } from "@/lib/tts-helpers";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const stats = await getTtsUsageStats(session.userId);
  return NextResponse.json(stats);
}
