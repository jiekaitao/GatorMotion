import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  getNotificationsForUser,
  getNotificationCount,
  getTherapistNotifications,
  getTherapistNotificationCount,
  markTherapistNotificationsSeen,
  getUnreadMessageCount,
  getUnreadMessageSenders,
} from "@/lib/db-helpers";

// GET: Return notifications for the current user
// Combines invite notifications + unread message notifications
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const countOnly = searchParams.get("count") === "true";

  if (countOnly) {
    const unreadMsgs = await getUnreadMessageCount(session.userId);
    let inviteCount = 0;
    if (session.role === "patient") {
      inviteCount = await getNotificationCount(session.userId);
    } else {
      inviteCount = await getTherapistNotificationCount(session.userId);
    }
    return NextResponse.json({ count: inviteCount + unreadMsgs });
  }

  // Full notification list
  const notifications: Array<{
    _id: string;
    type: string;
    therapistName?: string;
    patientUsername?: string;
    senderName?: string;
    senderId?: string;
    messageCount?: number;
    createdAt: Date | string;
  }> = [];

  // Invite-related notifications
  if (session.role === "patient") {
    const invites = await getNotificationsForUser(session.userId);
    for (const n of invites) {
      notifications.push({
        _id: n._id.toString(),
        type: "invite",
        therapistName: n.therapistName,
        createdAt: n.createdAt,
      });
    }
  } else {
    const accepted = await getTherapistNotifications(session.userId);
    for (const n of accepted) {
      notifications.push({
        _id: n._id.toString(),
        type: "accepted",
        patientUsername: n.patientUsername,
        createdAt: n.createdAt,
      });
    }
    await markTherapistNotificationsSeen(session.userId);
  }

  // Unread message notifications
  const unreadSenders = await getUnreadMessageSenders(session.userId);
  for (const s of unreadSenders) {
    notifications.push({
      _id: `msg-${s.senderId}`,
      type: "message",
      senderName: s.senderName,
      senderId: s.senderId,
      messageCount: s.count,
      createdAt: new Date().toISOString(),
    });
  }

  return NextResponse.json({ notifications });
}
