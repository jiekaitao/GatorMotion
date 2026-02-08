import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import fs from "fs/promises";
import path from "path";

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY!;

/**
 * Pre-defined 6-7 Easter egg voice lines with different ElevenLabs voices.
 * Each clip gets a unique filename and is cached to disk after first generation.
 */
const SIX_SEVEN_CLIPS = [
  {
    id: "bedsheets",
    text: "How many times did you wash your bed sheets this year? Like... six or seven times.",
    voiceId: "ErXwobaYiN019PkySvjV", // Antoni — deadpan chill
  },
  {
    id: "braincells",
    text: "How many brain cells did that rep just cost you? I'd say about six... seven.",
    voiceId: "pNInz6obpgDQGcFmaJgB", // Adam — deep dramatic deadpan
  },
  {
    id: "chaos",
    text: "OH MY GOD! SIX SEVEN! SIX SEVEN! HE JUST HIT THE SIX SEVEN!",
    voiceId: "jBpfuIE2acCO8z3wKNLl", // Gigi — pure chaotic energy
  },
  {
    id: "onerep",
    text: "How many times have you said one more rep and not meant it? Six or seven.",
    voiceId: "onwK4e9ZLuTAKqWW03F9", // Daniel — dry British delivery
  },
  {
    id: "tabs",
    text: "How many tabs do you have open right now instead of focusing on your exercises? About six... seven.",
    voiceId: "TxGEqnHWrfWFTfGW9XjX", // Josh — casual matter-of-fact
  },
  {
    id: "bones",
    text: "How many bones just popped doing that? Six. Seven. Maybe eight, but who's counting.",
    voiceId: "pNInz6obpgDQGcFmaJgB", // Adam — dramatic deadpan
  },
  {
    id: "hype",
    text: "SIX! SEVEN! SIX SEVEN IN PHYSICAL THERAPY! THIS IS HISTORY!",
    voiceId: "jBpfuIE2acCO8z3wKNLl", // Gigi — unhinged excitement
  },
  {
    id: "coffee",
    text: "How many times did you reheat that same cup of coffee today? Six or seven.",
    voiceId: "ErXwobaYiN019PkySvjV", // Antoni — relatable deadpan
  },
];

const CACHE_DIR = path.join(process.cwd(), "public", "audio", "six-seven");

async function ensureCacheDir() {
  await fs.mkdir(CACHE_DIR, { recursive: true });
}

async function getCachedPath(clipId: string): Promise<string> {
  return path.join(CACHE_DIR, `${clipId}.mp3`);
}

async function generateAndCache(clip: (typeof SIX_SEVEN_CLIPS)[number]): Promise<Buffer> {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${clip.voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": ELEVENLABS_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: clip.text,
      model_id: "eleven_turbo_v2_5",
      voice_settings: {
        stability: 0.3,
        similarity_boost: 0.9,
        style: 0.8,
        use_speaker_boost: true,
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`ElevenLabs error: ${res.status}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  const filePath = await getCachedPath(clip.id);
  await ensureCacheDir();
  await fs.writeFile(filePath, buffer);
  return buffer;
}

/**
 * GET /api/tts/six-seven — returns a random cached 6-7 audio clip.
 * Generates and caches on first request. Subsequent requests serve from disk.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Pick a random clip
  const clip = SIX_SEVEN_CLIPS[Math.floor(Math.random() * SIX_SEVEN_CLIPS.length)];
  const filePath = await getCachedPath(clip.id);

  try {
    // Try serving from cache
    const cached = await fs.readFile(filePath);
    return new NextResponse(new Uint8Array(cached), {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "X-SixSeven-Clip": clip.id,
        "X-SixSeven-Text": encodeURIComponent(clip.text),
      },
    });
  } catch {
    // Not cached yet — generate it
  }

  try {
    const buffer = await generateAndCache(clip);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "X-SixSeven-Clip": clip.id,
        "X-SixSeven-Text": encodeURIComponent(clip.text),
      },
    });
  } catch (err) {
    console.error("6-7 TTS generation failed:", err);
    return NextResponse.json({ error: "Failed to generate 6-7 clip" }, { status: 502 });
  }
}

/**
 * POST /api/tts/six-seven/warm — pre-generate all clips (call once to fill cache).
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  await ensureCacheDir();
  const results: { id: string; status: string }[] = [];

  for (const clip of SIX_SEVEN_CLIPS) {
    const filePath = await getCachedPath(clip.id);
    try {
      await fs.access(filePath);
      results.push({ id: clip.id, status: "cached" });
    } catch {
      try {
        await generateAndCache(clip);
        results.push({ id: clip.id, status: "generated" });
      } catch (err) {
        results.push({ id: clip.id, status: `error: ${err}` });
      }
    }
  }

  return NextResponse.json({ clips: results });
}
