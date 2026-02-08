import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";

// Dev-only: see database stats, collection counts, etc.
export async function GET() {
  const db = await getDb();

  const [userCount, exerciseCount, assignmentCount, streakCount] =
    await Promise.all([
      db.collection("users").countDocuments(),
      db.collection("exercises").countDocuments(),
      db.collection("assignments").countDocuments(),
      db.collection("streaks").countDocuments(),
    ]);

  const recentUsers = await db
    .collection("users")
    .find({})
    .sort({ createdAt: -1 })
    .limit(10)
    .toArray();

  const recentAssignments = await db
    .collection("assignments")
    .find()
    .sort({ createdAt: -1 })
    .limit(10)
    .toArray();

  return NextResponse.json({
    counts: {
      users: userCount,
      exercises: exerciseCount,
      assignments: assignmentCount,
      streaks: streakCount,
    },
    recentUsers,
    recentAssignments,
    timestamp: new Date().toISOString(),
  });
}
