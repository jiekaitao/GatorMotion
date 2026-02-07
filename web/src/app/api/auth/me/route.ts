import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getStreak } from "@/lib/db-helpers";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const streak = await getStreak(session.userId);

  return NextResponse.json({
    user: {
      id: session.userId,
      email: session.email,
      name: session.name,
      role: session.role,
    },
    streak: {
      currentStreak: streak.currentStreak,
      longestStreak: streak.longestStreak,
      lastCompletedDate: streak.lastCompletedDate,
    },
  });
}
