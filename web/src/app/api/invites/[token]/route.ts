import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { revokeInvite } from "@/lib/db-helpers";

// DELETE: Therapist revokes a pending invite by its _id
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const session = await getSession();
  if (!session || session.role !== "therapist") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { token: inviteId } = await params;
  const revoked = await revokeInvite(inviteId, session.userId);

  if (!revoked) {
    return NextResponse.json({ error: "Invite not found or already used" }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
