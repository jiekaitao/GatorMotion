import { NextRequest, NextResponse } from "next/server";
import { getSession, setSessionCookie } from "@/lib/auth";
import { updateUserProfile } from "@/lib/db-helpers";

// PATCH: Update name only
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { name } = await req.json();

  const updated = await updateUserProfile(session.userId, { name });

  if (!updated) {
    return NextResponse.json({ error: "No changes made" }, { status: 400 });
  }

  // Refresh session cookie with new info
  await setSessionCookie({
    userId: session.userId,
    username: session.username,
    name: name || session.name,
    role: session.role,
  });

  return NextResponse.json({ success: true });
}
