import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { findUserById, getPatientActivitySummary } from "@/lib/db-helpers";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || session.role !== "therapist") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const patient = await findUserById(id);
  if (!patient) {
    return NextResponse.json({ error: "Patient not found" }, { status: 404 });
  }

  if (!patient.therapistIds?.includes(session.userId)) {
    return NextResponse.json({ error: "Not your patient" }, { status: 403 });
  }

  const { sessions, assignments, streak } = await getPatientActivitySummary(id);

  return NextResponse.json({
    sessions: sessions.map((s) => ({
      ...s,
      _id: s._id.toString(),
    })),
    assignments: assignments.map((a) => ({
      ...a,
      _id: a._id.toString(),
    })),
    streak: {
      currentStreak: streak.currentStreak,
      longestStreak: streak.longestStreak,
      lastCompletedDate: streak.lastCompletedDate,
      history: streak.history,
    },
  });
}
