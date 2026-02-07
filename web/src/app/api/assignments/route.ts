import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  getTodayAssignment,
  createAssignment,
  getUserAssignments,
} from "@/lib/db-helpers";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const view = searchParams.get("view");

  if (view === "today") {
    const assignment = await getTodayAssignment(session.userId);
    return NextResponse.json({ assignment });
  }

  const assignments = await getUserAssignments(session.userId);
  return NextResponse.json({ assignments });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json();
  const { userId, date, exercises } = body;

  const targetUserId = userId || session.userId;
  const targetDate = date || new Date().toISOString().split("T")[0];

  if (!exercises || !Array.isArray(exercises) || exercises.length === 0) {
    return NextResponse.json(
      { error: "At least one exercise is required" },
      { status: 400 }
    );
  }

  const id = await createAssignment({
    userId: targetUserId,
    date: targetDate,
    exercises: exercises.map((ex: { exerciseId: string; exerciseName: string; sets?: number; reps?: number; holdSec?: number }) => ({
      exerciseId: ex.exerciseId,
      exerciseName: ex.exerciseName || "Exercise",
      sets: ex.sets || 3,
      reps: ex.reps || 10,
      holdSec: ex.holdSec || 0,
      completed: false,
    })),
  });

  return NextResponse.json({ success: true, id: id.toString() });
}
