"use client";

import { useState, useEffect, useCallback } from "react";

interface CountdownOverlayProps {
  onComplete: () => void;
}

export default function CountdownOverlay({ onComplete }: CountdownOverlayProps) {
  const [count, setCount] = useState(3);
  const [phase, setPhase] = useState<"counting" | "go" | "done">("counting");
  const [animKey, setAnimKey] = useState(0);

  const advanceCount = useCallback(() => {
    if (count > 1) {
      setCount((c) => c - 1);
      setAnimKey((k) => k + 1);
    } else if (phase === "counting") {
      setPhase("go");
      setAnimKey((k) => k + 1);
    } else if (phase === "go") {
      setPhase("done");
      onComplete();
    }
  }, [count, phase, onComplete]);

  useEffect(() => {
    const timer = setTimeout(advanceCount, phase === "go" ? 800 : 1000);
    return () => clearTimeout(timer);
  }, [advanceCount, phase]);

  if (phase === "done") return null;

  const displayText = phase === "go" ? "GO" : String(count);
  const color = phase === "go" ? "#58CC02" : "#FFFFFF";

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(0, 0, 0, 0.75)",
      }}
    >
      <div
        key={animKey}
        style={{
          fontSize: "120px",
          fontWeight: 800,
          color,
          animation: "countdownPop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards",
          textShadow: "0 4px 24px rgba(0,0,0,0.3)",
          letterSpacing: phase === "go" ? "0.1em" : "0",
        }}
      >
        {displayText}
      </div>
    </div>
  );
}
