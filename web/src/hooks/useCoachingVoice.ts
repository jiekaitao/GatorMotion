"use client";

import { useEffect, useRef } from "react";
import type { CoachingData, CoachingMessage } from "@/hooks/useExerciseWebSocket";

interface UseCoachingVoiceOptions {
  active: boolean;
  rmsDiv: number;
  coachingMessages: CoachingMessage[];
  coachingRef: React.RefObject<CoachingData | null>;
  fullName: string;
  metricsRef: React.RefObject<{
    coachingInterventions: { timeSec: number; message: string }[];
    startTime: number;
  }>;
  isPlayingPainAudioRef?: React.RefObject<boolean>;
}

const ENCOURAGEMENT_COOLDOWN_MS = 20000;
const CORRECTION_COOLDOWN_MS = 30000;
const SUSTAINED_HIGH_RMS_MS = 5000;
const HIGH_RMS_THRESHOLD = 0.18;
const PEAK_RMS_THRESHOLD = 0.15;

export function useCoachingVoice({
  active,
  rmsDiv,
  coachingMessages,
  coachingRef,
  fullName,
  metricsRef,
  isPlayingPainAudioRef,
}: UseCoachingVoiceOptions) {
  const isPlayingRef = useRef(false);
  const lastEncouragementRef = useRef(0);
  const lastCorrectionRef = useRef(0);
  const rmsPeakRef = useRef(0);
  const rmsHighSinceRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) {
      rmsPeakRef.current = 0;
      rmsHighSinceRef.current = null;
      return;
    }

    const interval = setInterval(() => {
      if (isPlayingRef.current) return;
      if (isPlayingPainAudioRef?.current) return;

      const now = Date.now();

      // Track peak RMS for encouragement detection
      if (rmsDiv > rmsPeakRef.current) {
        rmsPeakRef.current = rmsDiv;
      }

      // Encouragement: peak-to-valley detection
      if (
        rmsPeakRef.current > PEAK_RMS_THRESHOLD &&
        rmsDiv < rmsPeakRef.current * 0.5 &&
        now - lastEncouragementRef.current > ENCOURAGEMENT_COOLDOWN_MS
      ) {
        rmsPeakRef.current = 0;
        lastEncouragementRef.current = now;
        playCoachingAudio("encouragement", { fullName });
        return;
      }

      // Correction: sustained high RMS
      if (rmsDiv > HIGH_RMS_THRESHOLD) {
        if (rmsHighSinceRef.current === null) {
          rmsHighSinceRef.current = now;
        } else if (
          now - rmsHighSinceRef.current >= SUSTAINED_HIGH_RMS_MS &&
          now - lastCorrectionRef.current > CORRECTION_COOLDOWN_MS
        ) {
          rmsHighSinceRef.current = null;
          lastCorrectionRef.current = now;

          const coaching = coachingRef.current;
          if (coaching && coaching.divergences.length > 0) {
            const topDivergences = coaching.divergences
              .filter((d) => d.distance > 0.04)
              .sort((a, b) => b.distance - a.distance)
              .slice(0, 3);
            if (topDivergences.length > 0) {
              playCoachingAudio("correction", { divergences: topDivergences });
            }
          }
          return;
        }
      } else {
        rmsHighSinceRef.current = null;
      }

      // Reset peak if RMS is low for a while
      if (rmsDiv < 0.05) {
        rmsPeakRef.current = 0;
      }
    }, 500);

    return () => clearInterval(interval);
  }, [active, rmsDiv, coachingMessages, coachingRef, fullName, isPlayingPainAudioRef]);

  async function playCoachingAudio(
    type: "encouragement" | "correction" | "summary",
    payload: Record<string, unknown>
  ) {
    if (isPlayingRef.current) return;
    isPlayingRef.current = true;

    try {
      const res = await fetch("/api/tts/coaching", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, ...payload }),
      });

      if (!res.ok) {
        isPlayingRef.current = false;
        return;
      }

      const coachingText = decodeURIComponent(res.headers.get("X-Coaching-Text") || "");

      // Record intervention
      if (metricsRef.current.startTime > 0 && coachingText) {
        const timeSec = (Date.now() - metricsRef.current.startTime) / 1000;
        metricsRef.current.coachingInterventions.push({
          timeSec: Math.round(timeSec * 10) / 10,
          message: coachingText,
        });
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.volume = 0.8;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        isPlayingRef.current = false;
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        isPlayingRef.current = false;
      };
      await audio.play();
    } catch {
      isPlayingRef.current = false;
    }
  }

  return { playCoachingAudio };
}
