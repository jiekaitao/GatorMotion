"use client";

import { useState, useCallback, useEffect, use } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import CameraFeed from "@/components/CameraFeed";
import CountdownOverlay from "@/components/CountdownOverlay";
import SkeletonViewer from "@/components/SkeletonViewer";
import { useExerciseWebSocket } from "@/hooks/useExerciseWebSocket";
import confetti from "canvas-confetti";
import {
  X,
  Flame,
  Dumbbell,
  Info,
  SkipForward,
  CheckCircle2,
  AlertTriangle,
  XOctagon,
} from "lucide-react";

export default function ExercisePage({ params }: { params: Promise<{ id: string }> }) {
  const { id: assignmentId } = use(params);
  const searchParams = useSearchParams();
  const router = useRouter();

  const exerciseId = searchParams.get("exerciseId") || "";
  const name = searchParams.get("name") || "Exercise";
  const sets = parseInt(searchParams.get("sets") || "3");
  const reps = parseInt(searchParams.get("reps") || "10");
  const holdSec = parseInt(searchParams.get("holdSec") || "0");
  const exerciseKey = searchParams.get("exerciseKey") || null;
  const skeletonDataFile = searchParams.get("skeletonDataFile") || null;

  const [phase, setPhase] = useState<"ready" | "countdown" | "active" | "done">("ready");
  const [completing, setCompleting] = useState(false);
  const [allDone, setAllDone] = useState(false);
  const [currentRep, setCurrentRep] = useState(0);

  // WebSocket-driven rep counting (only when exerciseKey is set)
  const {
    connected: wsConnected,
    repCount: wsRepCount,
    formQuality,
    painLevel,
    painMessage,
    startCapture,
    stopCapture,
  } = useExerciseWebSocket(phase === "active" ? exerciseKey : null);

  // Sync WebSocket rep count to local state
  useEffect(() => {
    if (exerciseKey && wsRepCount > currentRep) {
      setCurrentRep(wsRepCount);
    }
  }, [wsRepCount, exerciseKey, currentRep]);

  // Auto-complete when reps reached
  useEffect(() => {
    if (phase === "active" && currentRep >= reps && !completing) {
      handleComplete();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRep, reps, phase, completing]);

  const handleCountdownComplete = useCallback(() => {
    setPhase("active");
  }, []);

  const handleVideoReady = useCallback((video: HTMLVideoElement) => {
    startCapture(video);
  }, [startCapture]);

  async function handleComplete() {
    setCompleting(true);
    try {
      const res = await fetch(`/api/assignments/${assignmentId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exerciseId }),
      });

      const data = await res.json();

      if (data.allCompleted) {
        setAllDone(true);
      }

      // Always fire confetti on exercise completion
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 },
        colors: ["#02caca", "#58CC02", "#FFD700", "#1CB0F6", "#FF9600"],
      });

      stopCapture();
      setPhase("done");
    } catch {
      setCompleting(false);
    }
  }

  // Manual rep increment (fallback when no exerciseKey)
  function simulateRep() {
    if (currentRep < reps) {
      setCurrentRep((prev) => prev + 1);
    }
  }

  const totalReps = reps;
  const progressPct = totalReps > 0 ? (currentRep / totalReps) * 100 : 0;

  // Form quality badge
  const formBadge = exerciseKey
    ? formQuality === "good"
      ? { label: "Good Form!", sublabel: "Keep going", color: "var(--color-green)", icon: <CheckCircle2 size={16} color="white" /> }
      : formQuality === "warning"
      ? { label: "Check Form", sublabel: "Adjust position", color: "var(--color-orange)", icon: <AlertTriangle size={16} color="white" /> }
      : null
    : { label: "Good Form!", sublabel: "Keep going", color: "var(--color-green)", icon: <CheckCircle2 size={16} color="white" /> };

  // Done state
  if (phase === "done") {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "var(--space-xl)",
          backgroundColor: "var(--color-bg)",
          textAlign: "center",
        }}
      >
        <div className="animate-success">
          <CheckCircle2 size={80} strokeWidth={2} color="var(--color-green)" />
        </div>
        <h1 style={{ marginTop: "var(--space-lg)", fontSize: "var(--text-display)", fontWeight: 800, color: allDone ? "var(--color-green)" : "var(--color-primary)" }}>
          {allDone ? "All Exercises Complete!" : "Exercise Complete!"}
        </h1>
        <p className="text-small" style={{ marginTop: "var(--space-sm)", fontSize: "18px" }}>
          {allDone ? "Amazing work! Your streak has been updated." : "Great job! Keep going."}
        </p>
        <button
          className="btn btn-primary"
          style={{ marginTop: "var(--space-xl)", minWidth: 250, fontSize: "18px", fontWeight: 800, borderRadius: "var(--radius-xl)" }}
          onClick={() => router.push("/home")}
        >
          {allDone ? "View Streak" : "Back to Exercises"}
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh", backgroundColor: "var(--color-bg)", overflow: "hidden" }}>
      {/* Countdown overlay */}
      {phase === "countdown" && (
        <CountdownOverlay onComplete={handleCountdownComplete} />
      )}

      {/* Pain detection overlay */}
      {phase === "active" && painLevel !== "normal" && (
        <div className="pain-overlay" style={{
          backgroundColor: painLevel === "stop" ? "var(--color-red)" : "var(--color-orange)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
            {painLevel === "stop" ? <XOctagon size={24} color="white" /> : <AlertTriangle size={24} color="white" />}
            <span style={{ color: "white", fontWeight: 700, fontSize: "16px" }}>{painMessage}</span>
          </div>
        </div>
      )}

      {/* Session Header */}
      <header className="session-header">
        <button
          onClick={() => { stopCapture(); router.push("/home"); }}
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-gray-300)", padding: 4 }}
        >
          <X size={28} />
        </button>

        {/* Progress bar */}
        <div style={{ flex: 1, margin: "0 var(--space-xl)", maxWidth: 600 }}>
          <div className="progress-track">
            <div className="progress-fill-teal progress-fill" style={{ width: `${progressPct}%`, backgroundColor: "var(--color-primary)" }} />
          </div>
        </div>

        {/* Rep counter */}
        <div style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--color-primary)", fontWeight: 700 }}>
          <Flame size={20} color="var(--color-orange)" fill="var(--color-orange)" />
          <span>{currentRep}</span>
        </div>
      </header>

      {/* Main Session Layout */}
      <div className="session-layout">
        {/* Camera Feed */}
        <div className="session-camera">
          <div style={{ width: "100%", height: "100%", position: "relative", borderRadius: "var(--radius-xl)", overflow: "hidden", border: "4px solid var(--color-white)", boxShadow: "0 4px 24px rgba(0,0,0,0.08)" }}>
            <CameraFeed
              active={phase === "active" || phase === "countdown"}
              onVideoReady={handleVideoReady}
            />

            {/* Form Feedback Badge */}
            {phase === "active" && formBadge && (
              <div
                className="animate-bounce-gentle"
                style={{
                  position: "absolute",
                  top: "var(--space-lg)",
                  left: "50%",
                  transform: "translateX(-50%)",
                  backgroundColor: "var(--color-white)",
                  borderRadius: "var(--radius-xl)",
                  boxShadow: "var(--shadow-tactile) var(--color-gray-100)",
                  padding: "var(--space-sm) var(--space-md)",
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-sm)",
                  zIndex: 10,
                }}
              >
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "var(--radius-full)",
                    backgroundColor: formBadge.color,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {formBadge.icon}
                </div>
                <div>
                  <p style={{ fontWeight: 700, color: formBadge.color, fontSize: "16px", lineHeight: 1 }}>{formBadge.label}</p>
                  <p style={{ color: "var(--color-gray-300)", fontSize: "11px", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>{formBadge.sublabel}</p>
                </div>
              </div>
            )}

            {/* WebSocket connection indicator */}
            {phase === "active" && exerciseKey && (
              <div style={{
                position: "absolute",
                bottom: "var(--space-sm)",
                right: "var(--space-sm)",
                padding: "4px 8px",
                borderRadius: "var(--radius-sm)",
                backgroundColor: wsConnected ? "rgba(88,204,2,0.8)" : "rgba(234,43,43,0.8)",
                color: "white",
                fontSize: "11px",
                fontWeight: 700,
              }}>
                {wsConnected ? "CV Connected" : "CV Offline"}
              </div>
            )}
          </div>
        </div>

        {/* Dashboard Panel */}
        <div className="session-dashboard">
          {/* Exercise Header */}
          <div>
            <span style={{ color: "var(--color-gray-400)", fontWeight: 600, textTransform: "uppercase", fontSize: "var(--text-small)", letterSpacing: "0.05em" }}>
              Physical Therapy
            </span>
            <h1 style={{ fontSize: "var(--text-display)", fontWeight: 800, letterSpacing: "-0.02em", marginTop: 4 }}>{name}</h1>
          </div>

          {/* Skeleton Reference Viewer */}
          {skeletonDataFile && (
            <SkeletonViewer
              skeletonDataFile={skeletonDataFile}
              playing={phase === "active"}
              mirror
            />
          )}

          {/* Rep Counter Card */}
          <div
            className="card"
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
          >
            <div>
              <span style={{ color: "var(--color-gray-300)", fontWeight: 500, fontSize: "var(--text-small)", textTransform: "uppercase" }}>
                Repetitions
              </span>
              <div style={{ display: "flex", alignItems: "baseline", gap: "var(--space-sm)", marginTop: 4 }}>
                <span style={{ fontSize: "48px", fontWeight: 800, color: "var(--color-primary)", lineHeight: 1 }}>
                  {currentRep}
                </span>
                <span style={{ fontSize: "24px", fontWeight: 700, color: "var(--color-gray-200)" }}>
                  / {totalReps}
                </span>
              </div>
            </div>

            {/* Circular progress */}
            <div
              style={{
                width: 88,
                height: 88,
                borderRadius: "var(--radius-full)",
                background: `conic-gradient(var(--color-primary) ${progressPct}%, var(--color-gray-100) 0)`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "var(--color-white)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Dumbbell size={32} color="var(--color-primary)" />
              </div>
            </div>
          </div>

          {/* Instructions */}
          <div className="card" style={{ flex: 1, display: "flex", flexDirection: "column" }}>
            <h3 style={{ fontSize: "18px", fontWeight: 700, marginBottom: "var(--space-md)", display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
              <Info size={20} color="var(--color-primary)" />
              Instructions
            </h3>
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
              {[
                holdSec > 0
                  ? `Hold the position for ${holdSec} seconds.`
                  : "Get into the starting position.",
                `Perform the movement slowly and controlled.`,
                `Complete ${sets} sets of ${reps} repetitions.`,
              ].map((step, idx) => (
                <li key={idx} style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-md)" }}>
                  <span
                    style={{
                      minWidth: 32,
                      height: 32,
                      borderRadius: "var(--radius-sm)",
                      backgroundColor: "var(--color-snow)",
                      color: "var(--color-primary)",
                      fontWeight: 700,
                      fontSize: "var(--text-small)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {idx + 1}
                  </span>
                  <p style={{ fontSize: "16px", fontWeight: 500, color: "var(--color-gray-500)", paddingTop: 4 }}>
                    {step}
                  </p>
                </li>
              ))}
            </ul>
          </div>

          {/* Controls */}
          <div style={{ display: "grid", gridTemplateColumns: phase === "ready" ? "1fr" : "1fr 1fr", gap: "var(--space-md)", marginTop: "auto" }}>
            {phase === "ready" && (
              <button
                className="btn btn-primary"
                style={{ height: 56, borderRadius: "var(--radius-xl)", fontSize: "18px", fontWeight: 800 }}
                onClick={() => setPhase("countdown")}
              >
                Start Exercise
              </button>
            )}

            {phase === "active" && (
              <>
                {/* Manual fallback button - always shown, but labeled differently */}
                <button
                  className="btn btn-secondary"
                  style={{ height: 56, borderRadius: "var(--radius-xl)" }}
                  onClick={() => simulateRep()}
                >
                  <SkipForward size={18} />
                  +1 Rep
                </button>
                <button
                  className="btn btn-teal"
                  style={{ height: 56, borderRadius: "var(--radius-xl)" }}
                  onClick={handleComplete}
                  disabled={completing}
                >
                  {completing ? "Saving..." : "Complete"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
