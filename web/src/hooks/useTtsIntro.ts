"use client";

import { useEffect, useRef } from "react";
import { generateIntroMessage } from "@/lib/tts-messages";
import { showToast } from "@/components/Toast";

export function useTtsIntro(phase: string, exerciseName: string) {
  const hasPlayedRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (phase !== "ready" || hasPlayedRef.current) return;
    hasPlayedRef.current = true;

    let cancelled = false;

    (async () => {
      try {
        const meRes = await fetch("/api/auth/me");
        if (!meRes.ok) return;
        const { user } = await meRes.json();

        const text = generateIntroMessage(user.name, exerciseName);

        const ttsRes = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });

        if (ttsRes.status === 429) {
          showToast("Daily voice limit reached. Audio intro skipped.", "error");
          return;
        }

        if (!ttsRes.ok) return;

        const blob = await ttsRes.blob();
        if (cancelled) return;

        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.play().catch(() => {});
        audio.onended = () => URL.revokeObjectURL(url);
      } catch {
        // TTS is non-critical — silent fail
      }
    })();

    return () => {
      cancelled = true;
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, [phase, exerciseName]);
}
