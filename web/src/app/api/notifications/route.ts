import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getNotificationsForUser, getNotificationCount } from "@/lib/db-helpers";

// GET: Return pending invites (notifications) for the current patient
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== "patient") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const countOnly = searchParams.get("count") === "true";

  if (countOnly) {
    const count = await getNotificationCount(session.userId);
    return NextResponse.json({ count });
  }

  const notifications = await getNotificationsForUser(session.userId);
  return NextResponse.json({
    notifications: notifications.map((n) => ({
      _id: n._id.toString(),
      therapistName: n.therapistName,
      createdAt: n.createdAt,
    })),
  });
}
