import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getStreak, findUserById, getNotificationCount } from "@/lib/db-helpers";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const streak = await getStreak(session.userId);

  let hasTherapist = false;
  let notificationCount = 0;
  if (session.role === "patient") {
    const user = await findUserById(session.userId);
    hasTherapist = (user?.therapistIds?.length ?? 0) > 0;
    notificationCount = await getNotificationCount(session.userId);
  }

  return NextResponse.json({
    user: {
      id: session.userId,
      username: session.username,
      name: session.name,
      role: session.role,
      hasTherapist,
      notificationCount,
    },
    streak: {
      currentStreak: streak.currentStreak,
      longestStreak: streak.longestStreak,
      lastCompletedDate: streak.lastCompletedDate,
    },
  });
}
