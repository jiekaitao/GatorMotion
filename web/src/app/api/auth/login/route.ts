import { NextRequest, NextResponse } from "next/server";
import { setSessionCookie } from "@/lib/auth";
import { findUserByUsername } from "@/lib/db-helpers";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { username } = body;

  if (!username) {
    return NextResponse.json(
      { error: "Username is required" },
      { status: 400 }
    );
  }

  const user = await findUserByUsername(username);
  if (!user) {
    return NextResponse.json(
      { error: "User not found" },
      { status: 401 }
    );
  }

  await setSessionCookie({
    userId: user._id.toString(),
    username: user.username,
    name: user.name,
    role: user.role,
  });

  return NextResponse.json({
    success: true,
    user: {
      id: user._id.toString(),
      username: user.username,
      name: user.name,
      role: user.role,
    },
  });
}
