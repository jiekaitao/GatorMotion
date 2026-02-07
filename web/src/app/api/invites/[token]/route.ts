import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { findInviteByToken, revokeInvite } from "@/lib/db-helpers";

// GET: Public — validate token, return invite details for signup form
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const invite = await findInviteByToken(token);

  if (!invite) {
    return NextResponse.json({ error: "Invite not found" }, { status: 404 });
  }

  if (invite.status !== "pending") {
    return NextResponse.json({ error: `Invite is ${invite.status}` }, { status: 410 });
  }

  if (new Date() > invite.expiresAt) {
    return NextResponse.json({ error: "Invite has expired" }, { status: 410 });
  }

  return NextResponse.json({
    therapistName: invite.therapistName,
    patientEmail: invite.patientEmail,
    status: invite.status,
  });
}

// DELETE: Therapist revokes invite
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const session = await getSession();
  if (!session || session.role !== "therapist") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { token } = await params;
  const revoked = await revokeInvite(token, session.userId);

  if (!revoked) {
    return NextResponse.json({ error: "Invite not found or already used" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
