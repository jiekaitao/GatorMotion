import { NextRequest, NextResponse } from "next/server";
import { getSession, setSessionCookie } from "@/lib/auth";
import { updateUserProfile, findUserByEmail } from "@/lib/db-helpers";

// PATCH: Update name and/or email
export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { name, email } = await req.json();

  // If changing email, check it's not taken
  if (email && email.toLowerCase() !== session.email) {
    const existing = await findUserByEmail(email);
    if (existing) {
      return NextResponse.json({ error: "Email already in use" }, { status: 409 });
    }
  }

  const updated = await updateUserProfile(session.userId, { name, email });

  if (!updated) {
    return NextResponse.json({ error: "No changes made" }, { status: 400 });
  }

  // Refresh session cookie with new info
  await setSessionCookie({
    userId: session.userId,
    email: email ? email.toLowerCase() : session.email,
    name: name || session.name,
    role: session.role,
  });

  return NextResponse.json({ success: true });
}
