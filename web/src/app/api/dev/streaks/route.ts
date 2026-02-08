import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";
import { getStreak, incrementStreak, setStreakManual } from "@/lib/db-helpers";

// Dev-only: manipulate streaks for testing
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId");

  if (!userId) {
    // List all streaks
    const db = await getDb();
    const streaks = await db.collection("streaks").find().toArray();
    return NextResponse.json({ streaks });
  }

  const streak = await getStreak(userId);
  return NextResponse.json({ streak });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { action, userId, date, currentStreak, history } = body;

  if (!userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 });
  }

  if (action === "increment") {
    const targetDate = date || new Date().toISOString().split("T")[0];
    const streak = await incrementStreak(userId, targetDate);
    return NextResponse.json({ success: true, streak });
  }

  if (action === "set") {
    await setStreakManual(userId, currentStreak || 0, history || []);
    const streak = await getStreak(userId);
    return NextResponse.json({ success: true, streak });
  }

  if (action === "reset") {
    await setStreakManual(userId, 0, []);
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
