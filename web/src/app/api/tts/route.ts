import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { findUserById } from "@/lib/db-helpers";
import { checkTtsRateLimit, logTtsUsage } from "@/lib/tts-helpers";

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY!;
const DEFAULT_VOICE_ID = "EXAVITQu4vr4xnSDxMaL"; // Sarah

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { text } = (await req.json()) as { text?: string };
  if (!text || text.length === 0 || text.length > 500) {
    return NextResponse.json({ error: "Invalid text" }, { status: 400 });
  }

  const { allowed, remaining } = await checkTtsRateLimit(session.userId);
  if (!allowed) {
    return NextResponse.json({ error: "Daily voice limit reached" }, { status: 429 });
  }

  const user = await findUserById(session.userId);
  const voiceId = user?.voiceId || DEFAULT_VOICE_ID;

  const elevenRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_turbo_v2_5",
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
      },
    }),
  });

  if (!elevenRes.ok) {
    const errText = await elevenRes.text().catch(() => "Unknown error");
    console.error("ElevenLabs error:", elevenRes.status, errText);
    return NextResponse.json({ error: "TTS generation failed" }, { status: 502 });
  }

  await logTtsUsage(session.userId, text.length);

  const audioBuffer = await elevenRes.arrayBuffer();
  return new NextResponse(audioBuffer, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "X-TTS-Remaining": String(remaining - 1),
    },
  });
}
