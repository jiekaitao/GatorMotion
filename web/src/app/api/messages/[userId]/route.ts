import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getConversation, markMessagesRead } from "@/lib/db-helpers";

// GET: Get conversation with a specific user
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { userId } = await params;

  // Mark their messages to us as read
  await markMessagesRead(userId, session.userId);

  const messages = await getConversation(session.userId, userId, 100);

  return NextResponse.json({
    messages: messages.map((m) => ({
      _id: m._id.toString(),
      senderId: m.senderId,
      receiverId: m.receiverId,
      content: m.content,
      read: m.read,
      createdAt: m.createdAt,
      isMine: m.senderId === session.userId,
    })),
  });
}
