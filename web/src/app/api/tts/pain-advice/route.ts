import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { findUserById } from "@/lib/db-helpers";
import { checkTtsRateLimit, logTtsUsage } from "@/lib/tts-helpers";

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY!;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const DEFAULT_VOICE_ID = "EXAVITQu4vr4xnSDxMaL"; // Sarah

const FALLBACK_MESSAGE = "Take a break now. If pain continues, stop the exercise and contact your therapist.";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { allowed } = await checkTtsRateLimit(session.userId);
  if (!allowed) {
    return NextResponse.json({ error: "Daily voice limit reached" }, { status: 429 });
  }

  const { repCount, exerciseName } = (await req.json()) as {
    repCount?: number;
    exerciseName?: string;
  };

  // Generate advice text via Gemini
  let adviceText = FALLBACK_MESSAGE;
  if (GEMINI_API_KEY) {
    try {
      const prompt = `Generate a short (1-2 sentences, under 35 words) safety-first break message for someone doing physical therapy exercises. They were doing "${exerciseName || "an exercise"}"${repCount && repCount > 3 ? ` and completed ${repCount} reps so far` : ""}. Include this guidance naturally: if pain continues, stop and contact their therapist. Don't use quotes around the message. Just return the message text, nothing else.`;

      const geminiRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 60, temperature: 0.8 },
          }),
        }
      );

      if (geminiRes.ok) {
        const geminiData = await geminiRes.json();
        const generated = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (generated && generated.length > 0 && generated.length < 200) {
          adviceText = generated;
        }
      }
    } catch (err) {
      console.error("Gemini API error:", err);
    }
  }

  // Generate TTS audio via ElevenLabs
  const user = await findUserById(session.userId);
  const voiceId = user?.voiceId || DEFAULT_VOICE_ID;

  const elevenRes = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: adviceText,
      model_id: "eleven_turbo_v2_5",
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });

  if (!elevenRes.ok) {
    console.error("ElevenLabs error:", elevenRes.status);
    return NextResponse.json({ error: "TTS generation failed" }, { status: 502 });
  }

  await logTtsUsage(session.userId, adviceText.length);

  const audioBuffer = await elevenRes.arrayBuffer();
  return new NextResponse(audioBuffer, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "X-Advice-Text": encodeURIComponent(adviceText),
    },
  });
}
