import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { getSession } from "@/lib/auth";
import { createInvite, getInvitesByTherapist, findUserByEmail, acceptInvite } from "@/lib/db-helpers";
import { sendInviteEmail } from "@/lib/email";

// GET: List invites for logged-in therapist
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "therapist") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const invites = await getInvitesByTherapist(session.userId);
  return NextResponse.json({ invites });
}

// POST: Therapist creates an invite and sends email
// If the patient already has an account, auto-links them immediately
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "therapist") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { patientEmail } = await req.json();

  if (!patientEmail || typeof patientEmail !== "string") {
    return NextResponse.json({ error: "Patient email is required" }, { status: 400 });
  }

  // Check if patient already exists
  const existingUser = await findUserByEmail(patientEmail);

  if (existingUser) {
    // Don't link therapists to other therapists
    if (existingUser.role === "therapist") {
      return NextResponse.json({ error: "That email belongs to a therapist account" }, { status: 400 });
    }

    // Already linked to this therapist
    if (existingUser.therapistId === session.userId) {
      return NextResponse.json({ error: "This patient is already linked to you" }, { status: 409 });
    }

    // Create invite and immediately accept it (auto-link)
    const { token } = await createInvite({
      therapistId: session.userId,
      therapistName: session.name,
      patientEmail,
    });
    await acceptInvite(token, existingUser._id.toString());

    return NextResponse.json({
      success: true,
      token,
      autoLinked: true,
      message: `${existingUser.name} has been linked to your account`,
    });
  }

  // New patient — create invite and send email
  const { token } = await createInvite({
    therapistId: session.userId,
    therapistName: session.name,
    patientEmail,
  });

  // Build invite link from request origin
  const headerList = await headers();
  const host = headerList.get("host") || "localhost:3000";
  const protocol = headerList.get("x-forwarded-proto") || "http";
  const inviteLink = `${protocol}://${host}/register/invite/${token}`;

  // Send email
  try {
    await sendInviteEmail({
      to: patientEmail,
      therapistName: session.name,
      inviteLink,
    });
  } catch (err) {
    console.error("Email send failed:", err);
  }

  return NextResponse.json({ success: true, token, autoLinked: false });
}
