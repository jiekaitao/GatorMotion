import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/mongodb";

const DEV_PASSWORD = "Jack123123@!";

export async function POST(req: NextRequest) {
  const { password } = await req.json();
  if (password !== DEV_PASSWORD) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  const db = await getDb();
  const result = await db.collection("tts_usage").deleteMany({});

  return NextResponse.json({
    success: true,
    deletedCount: result.deletedCount,
  });
}
