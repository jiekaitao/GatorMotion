import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { updateUserProfile } from "@/lib/db-helpers";

const VALID_VOICE_IDS = [
  "21m00Tcm4TlvDq8ikWAM", // Rachel
  "TxGEqnHWrfWFTfGW9XjX", // Josh
  "EXAVITQu4vr4xnSDxMaL", // Sarah
  "pNInz6obpgDQGcFmaJgB", // Adam
  "XB0fDUnXU5powFXDhCwa", // Charlotte
];

export async function PATCH(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { voiceId } = await req.json();

  if (!voiceId || !VALID_VOICE_IDS.includes(voiceId)) {
    return NextResponse.json({ error: "Invalid voice selection" }, { status: 400 });
  }

  await updateUserProfile(session.userId, { voiceId });

  return NextResponse.json({ success: true });
}
