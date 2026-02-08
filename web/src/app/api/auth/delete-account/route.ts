import { NextResponse } from "next/server";
import { getSession, clearSession } from "@/lib/auth";
import { getDb } from "@/lib/mongodb";
import { ObjectId } from "mongodb";

export async function DELETE() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const userId = session.userId;

  await Promise.all([
    db.collection("users").deleteOne({ _id: new ObjectId(userId) }),
    db.collection("assignments").deleteMany({ userId }),
    db.collection("streaks").deleteMany({ userId }),
    db.collection("messages").deleteMany({
      $or: [{ senderId: userId }, { receiverId: userId }],
    }),
    db.collection("invites").deleteMany({
      $or: [{ therapistId: userId }],
    }),
  ]);

  await clearSession();

  return NextResponse.json({ success: true });
}
