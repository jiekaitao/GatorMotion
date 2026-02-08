import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createInvite, getInvitesByTherapist, findUserByUsername, getPatientsByTherapist } from "@/lib/db-helpers";

// GET: List invites for logged-in therapist
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "therapist") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const invites = await getInvitesByTherapist(session.userId);
  return NextResponse.json({ invites });
}

// POST: Therapist creates an invite by patient username
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "therapist") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { username } = await req.json();

  if (!username || typeof username !== "string") {
    return NextResponse.json({ error: "Patient username is required" }, { status: 400 });
  }

  // Look up patient by username
  const patient = await findUserByUsername(username.trim().toLowerCase());
  if (!patient) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  if (patient.role !== "patient") {
    return NextResponse.json({ error: "That user is not a patient" }, { status: 400 });
  }

  // Check if already linked
  if (patient.therapistIds?.includes(session.userId)) {
    return NextResponse.json({ error: "This patient is already linked to you" }, { status: 400 });
  }

  await createInvite({
    therapistId: session.userId,
    therapistName: session.name,
    patientId: patient._id.toString(),
    patientUsername: patient.username,
  });

  return NextResponse.json({ success: true });
}
