import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { findUserById } from "@/lib/db-helpers";
import { checkTtsRateLimit, logTtsUsage } from "@/lib/tts-helpers";
import { pickEncouragementLine, formatDivergencesForPrompt } from "@/lib/coaching-messages";

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY!;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const DEFAULT_VOICE_ID = "EXAVITQu4vr4xnSDxMaL"; // Sarah

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { allowed } = await checkTtsRateLimit(session.userId);
  if (!allowed) {
    return NextResponse.json({ error: "Daily voice limit reached" }, { status: 429 });
  }

  const body = await req.json();
  const { type, fullName, divergences, sessionStats } = body as {
    type: "encouragement" | "correction" | "summary";
    fullName?: string;
    divergences?: { side: string; part: string; delta_x: number; delta_y: number; distance: number }[];
    sessionStats?: { completedReps: number; exerciseName: string; durationSec: number; avgRms: number };
  };

  let speechText: string;

  if (type === "encouragement") {
    speechText = pickEncouragementLine(fullName || "there");
  } else if (type === "correction" && divergences && divergences.length > 0) {
    const formatted = formatDivergencesForPrompt(divergences);
    if (GEMINI_API_KEY) {
      try {
        const prompt = `Generate a brief, friendly 1-sentence form correction for a physical therapy patient. Their joint divergences are: ${formatted}. Tell them specifically which body part to move and in what direction. Keep it under 20 words. Don't use quotes. Just return the text.`;
        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { maxOutputTokens: 40, temperature: 0.7 },
            }),
          }
        );
        if (geminiRes.ok) {
          const data = await geminiRes.json();
          const generated = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (generated && generated.length > 0 && generated.length < 150) {
            speechText = generated;
          } else {
            speechText = `Adjust your ${divergences[0].side} ${divergences[0].part} position.`;
          }
        } else {
          speechText = `Adjust your ${divergences[0].side} ${divergences[0].part} position.`;
        }
      } catch {
        speechText = `Adjust your ${divergences[0].side} ${divergences[0].part} position.`;
      }
    } else {
      speechText = `Adjust your ${divergences[0].side} ${divergences[0].part} position.`;
    }
  } else if (type === "summary" && sessionStats) {
    if (GEMINI_API_KEY) {
      try {
        const prompt = `Generate a brief, encouraging 1-sentence workout summary for a PT patient who just finished "${sessionStats.exerciseName}". They did ${sessionStats.completedReps} reps in ${sessionStats.durationSec} seconds with an average form divergence of ${sessionStats.avgRms.toFixed(3)}. Keep it under 25 words. Don't use quotes. Just return the text.`;
        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { maxOutputTokens: 50, temperature: 0.8 },
            }),
          }
        );
        if (geminiRes.ok) {
          const data = await geminiRes.json();
          const generated = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (generated && generated.length > 0 && generated.length < 200) {
            speechText = generated;
          } else {
            speechText = `Great job completing ${sessionStats.completedReps} reps! Keep up the good work.`;
          }
        } else {
          speechText = `Great job completing ${sessionStats.completedReps} reps! Keep up the good work.`;
        }
      } catch {
        speechText = `Great job completing ${sessionStats.completedReps} reps! Keep up the good work.`;
      }
    } else {
      speechText = `Great job completing ${sessionStats.completedReps} reps! Keep up the good work.`;
    }
  } else {
    return NextResponse.json({ error: "Invalid coaching type" }, { status: 400 });
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
      text: speechText,
      model_id: "eleven_turbo_v2_5",
      voice_settings: { stability: 0.5, similarity_boost: 0.75 },
    }),
  });

  if (!elevenRes.ok) {
    console.error("ElevenLabs error:", elevenRes.status);
    return NextResponse.json({ error: "TTS generation failed" }, { status: 502 });
  }

  await logTtsUsage(session.userId, speechText.length);

  const audioBuffer = await elevenRes.arrayBuffer();
  return new NextResponse(audioBuffer, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "X-Coaching-Text": encodeURIComponent(speechText),
    },
  });
}
