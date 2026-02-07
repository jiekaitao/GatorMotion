import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getStreak, getTodayAssignment } from "@/lib/db-helpers";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const streak = await getStreak(session.userId);
  const todayAssignment = await getTodayAssignment(session.userId);

  const todayProgress = todayAssignment
    ? {
        total: todayAssignment.exercises.length,
        completed: todayAssignment.exercises.filter((e) => e.completed).length,
        allDone: todayAssignment.allCompleted,
      }
    : null;

  return NextResponse.json({ streak, todayProgress });
}
