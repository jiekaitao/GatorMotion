import { NextRequest, NextResponse } from "next/server";
import { setSessionCookie } from "@/lib/auth";
import { createUser, findUserByUsername } from "@/lib/db-helpers";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { username, name, role } = body;

  if (!username || !name) {
    return NextResponse.json(
      { error: "Username and name are required" },
      { status: 400 }
    );
  }

  const existing = await findUserByUsername(username);
  if (existing) {
    return NextResponse.json(
      { error: "This username is already taken" },
      { status: 409 }
    );
  }

  const userRole = role === "therapist" ? "therapist" : "patient";

  const userId = await createUser({
    username: username.toLowerCase(),
    name,
    role: userRole,
  });

  await setSessionCookie({
    userId: userId.toString(),
    username: username.toLowerCase(),
    name,
    role: userRole,
  });

  return NextResponse.json({ success: true, userId: userId.toString() });
}
