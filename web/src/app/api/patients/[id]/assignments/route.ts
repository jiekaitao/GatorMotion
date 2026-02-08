import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { findUserById, getUserAssignments } from "@/lib/db-helpers";

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

  const assignments = await getUserAssignments(id);
  return NextResponse.json({ assignments });
}
