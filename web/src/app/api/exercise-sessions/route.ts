import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  createExerciseSession,
  getExerciseSession,
  getExerciseSessionsByUser,
} from "@/lib/db-helpers";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json();
  const {
    assignmentId,
    exerciseId,
    exerciseName,
    exerciseKey,
    sets,
    reps,
    completedReps,
    durationMs,
    repTimestamps,
    painEvents,
    formDistribution,
    rmsHistory,
    coachingInterventions,
  } = body;

  if (!assignmentId || !exerciseId) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const id = await createExerciseSession({
    userId: session.userId,
    assignmentId,
    exerciseId,
    exerciseName: exerciseName || "Exercise",
    exerciseKey: exerciseKey || undefined,
    sets: sets || 1,
    reps: reps || 0,
    completedReps: completedReps || 0,
    durationMs: durationMs || 0,
    repTimestamps: repTimestamps || [],
    painEvents: painEvents || [],
    formDistribution: formDistribution || { good: 0, warning: 0, neutral: 0 },
    rmsHistory: rmsHistory || undefined,
    coachingInterventions: coachingInterventions || undefined,
  });

  return NextResponse.json({ sessionId: id.toString() });
}

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const userId = searchParams.get("userId");

  if (id) {
    const exerciseSession = await getExerciseSession(id);
    if (!exerciseSession) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ session: exerciseSession });
  }

  const targetUserId = userId || session.userId;
  const sessions = await getExerciseSessionsByUser(targetUserId);
  return NextResponse.json({ sessions });
}
