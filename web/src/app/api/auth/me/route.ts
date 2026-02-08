import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getStreak, findUserById, getNotificationCount, getTherapistNotificationCount } from "@/lib/db-helpers";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const streak = await getStreak(session.userId);

  const user = await findUserById(session.userId);

  let hasTherapist = false;
  let notificationCount = 0;
  if (session.role === "patient") {
    hasTherapist = (user?.therapistIds?.length ?? 0) > 0;
    notificationCount = await getNotificationCount(session.userId);
  } else if (session.role === "therapist") {
    notificationCount = await getTherapistNotificationCount(session.userId);
  }

  return NextResponse.json({
    user: {
      id: session.userId,
      username: session.username,
      name: session.name,
      role: session.role,
      hasTherapist,
      notificationCount,
      voiceId: user?.voiceId || "EXAVITQu4vr4xnSDxMaL",
    },
    streak: {
      currentStreak: streak.currentStreak,
      longestStreak: streak.longestStreak,
      lastCompletedDate: streak.lastCompletedDate,
    },
  });
}
