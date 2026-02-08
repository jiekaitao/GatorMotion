import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { acceptInvite, declineInvite } from "@/lib/db-helpers";

// POST: Accept or decline an invite notification
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session || session.role !== "patient") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: inviteId } = await params;
  const { action } = await req.json();

  if (action === "accept") {
    const invite = await acceptInvite(inviteId);
    if (!invite) {
      return NextResponse.json({ error: "Invite not found or already handled" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  }

  if (action === "decline") {
    const declined = await declineInvite(inviteId);
    if (!declined) {
      return NextResponse.json({ error: "Invite not found or already handled" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
