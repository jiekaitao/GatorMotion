import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { findUserById, getTodayAssignment, getUserAssignments } from "@/lib/db-helpers";

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

  // Verify therapist-patient relationship
  if (!patient.therapistIds?.includes(session.userId)) {
    return NextResponse.json({ error: "Not your patient" }, { status: 403 });
  }

  const todayAssignment = await getTodayAssignment(id);
  const assignmentHistory = await getUserAssignments(id);

  return NextResponse.json({
    patient: {
      _id: patient._id.toString(),
      name: patient.name,
      username: patient.username,
      role: patient.role,
      createdAt: patient.createdAt,
    },
    todayAssignment,
    history: assignmentHistory.map((a) => ({
      _id: a._id.toString(),
      date: a.date,
      exercises: a.exercises,
      allCompleted: a.allCompleted,
    })),
  });
}
