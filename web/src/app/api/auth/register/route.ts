import { NextRequest, NextResponse } from "next/server";
import { setSessionCookie } from "@/lib/auth";
import { createUser, findUserByUsername, findInviteByToken, acceptInvite } from "@/lib/db-helpers";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { username, name, role, inviteToken } = body;

  if (!username || !name) {
    return NextResponse.json(
      { error: "Username and name are required" },
      { status: 400 }
    );
  }

  // If invite token provided, validate it before creating user
  let invite = null;
  if (inviteToken) {
    invite = await findInviteByToken(inviteToken);
    if (!invite || invite.status !== "pending") {
      return NextResponse.json(
        { error: "Invalid or expired invite link" },
        { status: 400 }
      );
    }
    if (new Date() > invite.expiresAt) {
      return NextResponse.json(
        { error: "This invite link has expired" },
        { status: 410 }
      );
    }
  }

  const existing = await findUserByUsername(username);
  if (existing) {
    return NextResponse.json(
      { error: "This username is already taken" },
      { status: 409 }
    );
  }

  // Force patient role when registering via invite
  const userRole = inviteToken ? "patient" : (role === "therapist" ? "therapist" : "patient");

  const userId = await createUser({
    username: username.toLowerCase(),
    name,
    role: userRole,
  });

  // If invite, link patient to therapist
  if (invite && inviteToken) {
    await acceptInvite(inviteToken, userId.toString());
  }

  await setSessionCookie({
    userId: userId.toString(),
    username: username.toLowerCase(),
    name,
    role: userRole,
  });

  return NextResponse.json({ success: true, userId: userId.toString() });
}
