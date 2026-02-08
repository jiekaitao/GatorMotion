import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import {
  sendMessage,
  getConversationList,
  getPatientsByTherapist,
  findUserById,
} from "@/lib/db-helpers";

// GET: List conversations for current user
// For patients without existing conversations, returns their therapist as a contact
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const conversations = await getConversationList(session.userId);

  // For patients: if no conversations yet but they have therapists, show them
  if (session.role === "patient" && conversations.length === 0) {
    const user = await findUserById(session.userId);
    if (user?.therapistIds?.length) {
      const therapistConvos = [];
      for (const tId of user.therapistIds) {
        const therapist = await findUserById(tId);
        if (therapist) {
          therapistConvos.push({
            partnerId: therapist._id.toString(),
            partnerName: therapist.name,
            partnerRole: "therapist",
            lastMessage: null,
            unreadCount: 0,
          });
        }
      }
      if (therapistConvos.length > 0) {
        return NextResponse.json({ conversations: therapistConvos });
      }
    }
  }

  // For therapists: ensure all patients appear even if no messages yet
  if (session.role === "therapist") {
    const patients = await getPatientsByTherapist(session.userId);
    const existingPartnerIds = new Set(conversations.map((c) => c.partnerId));

    for (const p of patients) {
      const patient = p as unknown as { _id: { toString(): string }; name: string; streak: unknown };
      const pid = patient._id.toString();
      if (!existingPartnerIds.has(pid)) {
        conversations.push({
          partnerId: pid,
          partnerName: patient.name,
          partnerRole: "patient",
          lastMessage: null as never,
          unreadCount: 0,
        });
      }
    }
  }

  return NextResponse.json({ conversations });
}

// POST: Send a message
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { to, content } = await req.json();

  if (!to || !content || typeof content !== "string" || content.trim().length === 0) {
    return NextResponse.json({ error: "Recipient and message content are required" }, { status: 400 });
  }

  const messageId = await sendMessage({
    senderId: session.userId,
    receiverId: to,
    content: content.trim(),
  });

  return NextResponse.json({ success: true, messageId: messageId.toString() });
}
