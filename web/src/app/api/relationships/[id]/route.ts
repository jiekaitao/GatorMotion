import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { removeRelationship } from "@/lib/db-helpers";

// DELETE: Remove a PT-patient relationship
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  let removed = false;
  if (session.role === "patient") {
    // Patient removing a therapist: id is the therapistId
    removed = await removeRelationship(session.userId, id);
  } else if (session.role === "therapist") {
    // Therapist removing a patient: id is the patientId
    removed = await removeRelationship(id, session.userId);
  }

  if (!removed) {
    return NextResponse.json({ error: "Relationship not found" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
