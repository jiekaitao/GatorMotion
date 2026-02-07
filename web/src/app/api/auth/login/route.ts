import { NextRequest, NextResponse } from "next/server";
import { verifyPassword, setSessionCookie } from "@/lib/auth";
import { findUserByEmail } from "@/lib/db-helpers";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { email, password } = body;

  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password are required" },
      { status: 400 }
    );
  }

  const user = await findUserByEmail(email);
  if (!user) {
    return NextResponse.json(
      { error: "Invalid email or password" },
      { status: 401 }
    );
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return NextResponse.json(
      { error: "Invalid email or password" },
      { status: 401 }
    );
  }

  await setSessionCookie({
    userId: user._id.toString(),
    email: user.email,
    name: user.name,
    role: user.role,
  });

  return NextResponse.json({
    success: true,
    user: {
      id: user._id.toString(),
      email: user.email,
      name: user.name,
      role: user.role,
    },
  });
}
