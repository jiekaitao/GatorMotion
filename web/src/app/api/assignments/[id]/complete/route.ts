import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { completeExerciseInAssignment, incrementStreak } from "@/lib/db-helpers";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { id: assignmentId } = await params;
  const body = await req.json();
  const { exerciseId } = body;

  if (!exerciseId) {
    return NextResponse.json(
      { error: "exerciseId is required" },
      { status: 400 }
    );
  }

  const result = await completeExerciseInAssignment(assignmentId, exerciseId);
  if (!result) {
    return NextResponse.json(
      { error: "Assignment not found" },
      { status: 404 }
    );
  }

  let streak = null;
  if (result.allCompleted) {
    const today = new Date().toISOString().split("T")[0];
    streak = await incrementStreak(session.userId, today);
  }

  return NextResponse.json({
    success: true,
    allCompleted: result.allCompleted,
    exercises: result.exercises,
    streak: streak
      ? {
          currentStreak: streak.currentStreak,
          longestStreak: streak.longestStreak,
        }
      : null,
  });
}
