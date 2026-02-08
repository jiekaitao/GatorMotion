"use client";

import { useEffect, useRef, useState } from "react";
import { XOctagon } from "lucide-react";

interface PainStopOverlayProps {
  repCount: number;
  exerciseName: string;
  onResume: () => void;
}

export default function PainStopOverlay({ repCount, exerciseName, onResume }: PainStopOverlayProps) {
  const [adviceText, setAdviceText] = useState("Take a moment to rest. You're doing great!");
  const abortRef = useRef<AbortController | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    abortRef.current = controller;

    (async () => {
      try {
        const res = await fetch("/api/tts/pain-advice", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ repCount, exerciseName }),
          signal: controller.signal,
        });

        if (!res.ok) return;

        // Extract advice text from header
        const headerText = res.headers.get("X-Advice-Text");
        if (headerText) {
          setAdviceText(decodeURIComponent(headerText));
        }

        // Play audio
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.play().catch(() => {});
      } catch {
        // Aborted or network error — ignore
      }
    })();

    return () => {
      controller.abort();
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, [repCount, exerciseName]);

  return (
    <div className="pain-stop-overlay" onClick={onResume}>
      <div className="pain-stop-card" onClick={(e) => e.stopPropagation()}>
        <div className="animate-pulse" style={{ marginBottom: "var(--space-md)" }}>
          <XOctagon size={56} color="var(--color-red)" strokeWidth={1.5} />
        </div>
        <h2 style={{ fontSize: "24px", fontWeight: 800, color: "var(--color-gray-600)", marginBottom: "var(--space-sm)" }}>
          Let&apos;s Take a Break
        </h2>
        <p style={{ fontSize: "16px", color: "var(--color-gray-400)", lineHeight: 1.6, maxWidth: 320, margin: "0 auto" }}>
          {adviceText}
        </p>
        <p style={{ fontSize: "13px", color: "var(--color-red)", fontWeight: 700, lineHeight: 1.5, marginTop: "var(--space-md)" }}>
          If pain continues, stop and contact your therapist.
        </p>
        <button
          className="btn btn-secondary"
          style={{ marginTop: "var(--space-lg)", minWidth: 200, borderRadius: "var(--radius-xl)" }}
          onClick={onResume}
        >
          Resume Exercise
        </button>
        <p style={{ fontSize: "12px", color: "var(--color-gray-300)", marginTop: "var(--space-md)" }}>
          Tap anywhere to resume
        </p>
      </div>
    </div>
  );
}
