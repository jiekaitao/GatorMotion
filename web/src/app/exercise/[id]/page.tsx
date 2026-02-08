"use client";

import { useState, useCallback, useEffect, use, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import CameraFeed from "@/components/CameraFeed";
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
  Play,
  Eye,
  Zap,
  ShieldCheck,
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
  const [currentSet, setCurrentSet] = useState(1);
  const [currentRep, setCurrentRep] = useState(0);

  // Countdown state (embedded in hero, not a separate overlay)
  const [countdownNum, setCountdownNum] = useState(3);
  const [countdownText, setCountdownText] = useState<string | null>(null);
  const countdownKeyRef = useRef(0);

  // Hero expansion animation state
  const [heroExpanded, setHeroExpanded] = useState(false);

  // Transition animation state
  const [transitioning, setTransitioning] = useState(false);

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

  // Trigger hero expansion after mount
  useEffect(() => {
    const timer = setTimeout(() => setHeroExpanded(true), 900);
    return () => clearTimeout(timer);
  }, []);

  // Sync WebSocket rep count to local state
  useEffect(() => {
    if (exerciseKey && wsRepCount > currentRep) {
      setCurrentRep(wsRepCount);
    }
  }, [wsRepCount, exerciseKey, currentRep]);

  // Auto-advance set or complete when reps reached
  useEffect(() => {
    if (phase === "active" && currentRep >= reps && !completing) {
      if (currentSet < sets) {
        setCurrentSet((s) => s + 1);
        setCurrentRep(0);
      } else {
        handleComplete();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRep, reps, phase, completing, currentSet, sets]);

  // Countdown timer logic (runs when phase === "countdown")
  useEffect(() => {
    if (phase !== "countdown") return;

    let num = 3;
    setCountdownNum(3);
    setCountdownText(null);
    countdownKeyRef.current++;

    const timers: ReturnType<typeof setTimeout>[] = [];

    const tick = () => {
      num--;
      if (num > 0) {
        setCountdownNum(num);
        countdownKeyRef.current++;
        timers.push(setTimeout(tick, 1000));
      } else {
        setCountdownText("GO!");
        countdownKeyRef.current++;
        timers.push(setTimeout(() => {
          setTransitioning(true);
          setPhase("active");
          timers.push(setTimeout(() => setTransitioning(false), 700));
        }, 800));
      }
    };

    timers.push(setTimeout(tick, 1000));
    return () => timers.forEach(clearTimeout);
  }, [phase]);

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

  function simulateRep() {
    if (currentRep < reps) {
      setCurrentRep((prev) => prev + 1);
    }
  }

  const totalReps = sets * reps;
  const completedReps = (currentSet - 1) * reps + currentRep;
  const progressPct = totalReps > 0 ? (completedReps / totalReps) * 100 : 0;

  const formBadge = exerciseKey
    ? formQuality === "good"
      ? { label: "Good Form!", sublabel: "Keep going", color: "var(--color-green)", icon: <CheckCircle2 size={16} color="white" /> }
      : formQuality === "warning"
      ? { label: "Check Form", sublabel: "Adjust position", color: "var(--color-orange)", icon: <AlertTriangle size={16} color="white" /> }
      : null
    : { label: "Good Form!", sublabel: "Keep going", color: "var(--color-green)", icon: <CheckCircle2 size={16} color="white" /> };

  const isHero = phase === "ready" || phase === "countdown";

  // Exercise instruction steps
  const instructionSteps = [
    holdSec > 0
      ? `Hold the position for ${holdSec} seconds.`
      : "Get into the starting position.",
    "Perform the movement slowly and controlled.",
    `Complete ${sets} sets of ${reps} repetitions.`,
  ];

  // ─── Done state ───
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

  // ─── Hero Layout (ready / countdown) ───
  if (isHero) {
    return (
      <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh", backgroundColor: "var(--color-bg)", overflow: "hidden" }}>
        {/* Top bar */}
        <header className="session-header">
          <button
            onClick={() => { stopCapture(); router.push("/home"); }}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-gray-300)", padding: 4 }}
          >
            <X size={28} />
          </button>
          <div style={{ flex: 1 }} />
          <span style={{ color: "var(--color-gray-300)", fontWeight: 600, fontSize: "14px" }}>
            {sets} sets &times; {reps} reps
          </span>
        </header>

        {/* Hero content area */}
        <div className={`hero-content ${heroExpanded ? "hero-expanded" : ""}`}>
          {/* Left: Demo panel */}
          <div className="hero-demo">
            {/* Exercise title */}
            <div style={{ textAlign: "center" }}>
              <span style={{ color: "var(--color-gray-400)", fontWeight: 600, textTransform: "uppercase", fontSize: "var(--text-small)", letterSpacing: "0.05em" }}>
                Physical Therapy
              </span>
              <h1 style={{ fontSize: "var(--text-display)", fontWeight: 800, letterSpacing: "-0.02em", marginTop: 4 }}>{name}</h1>
            </div>

            {/* Skeleton viewer with countdown overlay */}
            <div style={{ position: "relative", width: "100%", maxWidth: 380, aspectRatio: "3/4" }}>
              {skeletonDataFile ? (
                <SkeletonViewer
                  skeletonDataFile={skeletonDataFile}
                  playing
                  mirror
                  className="skeleton-viewer-hero"
                />
              ) : (
                <div style={{
                  width: "100%",
                  height: "100%",
                  borderRadius: "var(--radius-xl)",
                  backgroundColor: "#1a1a2e",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}>
                  <Dumbbell size={80} color="var(--color-primary)" strokeWidth={1.5} />
                </div>
              )}

              {/* Countdown number overlaid on skeleton */}
              {phase === "countdown" && (
                <div style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "rgba(0, 0, 0, 0.4)",
                  borderRadius: "var(--radius-xl)",
                }}>
                  <div
                    key={countdownKeyRef.current}
                    style={{
                      fontSize: countdownText ? "80px" : "120px",
                      fontWeight: 800,
                      color: countdownText ? "#58CC02" : "#FFFFFF",
                      animation: "countdownPop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards",
                      textShadow: "0 4px 24px rgba(0,0,0,0.3)",
                      letterSpacing: countdownText ? "0.1em" : "0",
                    }}
                  >
                    {countdownText || countdownNum}
                  </div>
                </div>
              )}
            </div>

            {/* Exercise instructions below skeleton */}
            <div className="hero-instructions">
              {instructionSteps.map((step, idx) => (
                <div key={idx} style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-sm)" }}>
                  <span style={{
                    minWidth: 24,
                    height: 24,
                    borderRadius: "var(--radius-sm)",
                    backgroundColor: "var(--color-snow)",
                    color: "var(--color-primary)",
                    fontWeight: 700,
                    fontSize: "12px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}>
                    {idx + 1}
                  </span>
                  <p style={{ fontSize: "14px", fontWeight: 500, color: "var(--color-gray-400)", lineHeight: 1.4 }}>
                    {step}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Right: Info panel with bezier connectors (desktop only) */}
          {heroExpanded && (
            <div className="hero-info-panel">
              {/* SVG bezier connectors */}
              <svg
                className="hero-connectors"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
              >
                {/* Origin dot */}
                <circle cx="2" cy="85" r="3" fill="var(--color-primary)" vectorEffect="non-scaling-stroke" opacity="0.6" />
                {/* Top curve */}
                <path
                  d="M 2 85 C 35 85, 50 15, 100 15"
                  className="hero-connector-line hero-connector-1"
                />
                {/* Middle curve */}
                <path
                  d="M 2 85 C 35 85, 50 50, 100 50"
                  className="hero-connector-line hero-connector-2"
                />
                {/* Bottom curve */}
                <path
                  d="M 2 85 C 35 85, 50 85, 100 85"
                  className="hero-connector-line hero-connector-3"
                />
              </svg>

              {/* Info cards */}
              <div className="hero-info-cards">
                <div className="hero-info-card hero-card-1">
                  <div className="hero-info-card-icon" style={{ backgroundColor: "var(--color-primary)" }}>
                    <Eye size={18} color="white" />
                  </div>
                  <div>
                    <h4 style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-gray-600)", marginBottom: 2 }}>Watch &amp; Follow</h4>
                    <p style={{ fontSize: "13px", color: "var(--color-gray-300)", lineHeight: 1.4 }}>
                      Follow the animated skeleton reference to learn proper form for each movement.
                    </p>
                  </div>
                </div>

                <div className="hero-info-card hero-card-2">
                  <div className="hero-info-card-icon" style={{ backgroundColor: "var(--color-green)" }}>
                    <Zap size={18} color="white" />
                  </div>
                  <div>
                    <h4 style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-gray-600)", marginBottom: 2 }}>Smart Rep Counter</h4>
                    <p style={{ fontSize: "13px", color: "var(--color-gray-300)", lineHeight: 1.4 }}>
                      Our AI vision system tracks your movements and automatically counts each repetition.
                    </p>
                  </div>
                </div>

                <div className="hero-info-card hero-card-3">
                  <div className="hero-info-card-icon" style={{ backgroundColor: "var(--color-orange)" }}>
                    <ShieldCheck size={18} color="white" />
                  </div>
                  <div>
                    <h4 style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-gray-600)", marginBottom: 2 }}>Safety Monitoring</h4>
                    <p style={{ fontSize: "13px", color: "var(--color-gray-300)", lineHeight: 1.4 }}>
                      Real-time pain detection alerts you to stop if discomfort is detected during exercise.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer with start button */}
        <div style={{ padding: "var(--space-lg)", display: "flex", justifyContent: "center" }}>
          {phase === "ready" && (
            <button
              className="btn btn-primary"
              style={{
                height: 56,
                borderRadius: "var(--radius-xl)",
                fontSize: "18px",
                fontWeight: 800,
                minWidth: 280,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "var(--space-sm)",
              }}
              onClick={() => setPhase("countdown")}
            >
              <Play size={20} fill="white" />
              Start Exercise
            </button>
          )}
        </div>

        {/* Hidden camera feed - starts early so it's ready when active */}
        <div style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", opacity: 0 }}>
          <CameraFeed active onVideoReady={handleVideoReady} />
        </div>
      </div>
    );
  }

  // ─── Active Layout ───
  return (
    <div
      className={transitioning ? "exercise-transition-in" : ""}
      style={{ display: "flex", flexDirection: "column", minHeight: "100vh", backgroundColor: "var(--color-bg)", overflow: "hidden" }}
    >
      {/* Pain detection overlay */}
      {painLevel !== "normal" && (
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

        {/* Segmented progress bar with flame icon */}
        <div style={{ flex: 1, margin: "0 var(--space-xl)", maxWidth: 600, position: "relative" }}>
          <div style={{ display: "flex", gap: 4 }}>
            {Array.from({ length: sets }, (_, i) => {
              const setStart = (i / sets) * 100;
              const setEnd = ((i + 1) / sets) * 100;
              const segmentFill = progressPct >= setEnd ? 100 : progressPct <= setStart ? 0 : ((progressPct - setStart) / (setEnd - setStart)) * 100;
              return (
                <div key={i} className="progress-track" style={{ flex: 1 }}>
                  <div className="progress-fill" style={{ width: `${segmentFill}%`, backgroundColor: "var(--color-primary)" }} />
                </div>
              );
            })}
          </div>
          <div style={{
            position: "absolute",
            top: "50%",
            left: `calc(${progressPct}% + ${(progressPct / 100) * (sets - 1) * 4}px)`,
            transform: "translate(-50%, -50%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "left 0.3s ease",
            zIndex: 1,
          }}>
            <Flame size={22} color={completedReps > 0 ? "var(--color-orange)" : "var(--color-gray-200)"} fill={completedReps > 0 ? "var(--color-orange)" : "var(--color-gray-200)"} />
          </div>
        </div>

        {/* Set & rep counter */}
        <div style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--color-primary)", fontWeight: 700, whiteSpace: "nowrap" }}>
          <span>Set {currentSet}/{sets}</span>
        </div>
      </header>

      {/* Main Session Layout */}
      <div className="session-layout">
        {/* Camera Feed + Instructions below */}
        <div className="session-camera">
          <div style={{ width: "100%", position: "relative", borderRadius: "var(--radius-xl)", overflow: "hidden", border: "4px solid var(--color-white)", boxShadow: "0 4px 24px rgba(0,0,0,0.08)" }}>
            <CameraFeed
              active
              onVideoReady={handleVideoReady}
            />

            {/* Form Feedback Badge */}
            {formBadge && (
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
                <div style={{ width: 28, height: 28, borderRadius: "var(--radius-full)", backgroundColor: formBadge.color, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {formBadge.icon}
                </div>
                <div>
                  <p style={{ fontWeight: 700, color: formBadge.color, fontSize: "16px", lineHeight: 1 }}>{formBadge.label}</p>
                  <p style={{ color: "var(--color-gray-300)", fontSize: "11px", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>{formBadge.sublabel}</p>
                </div>
              </div>
            )}

            {/* WebSocket connection indicator */}
            {exerciseKey && (
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

          {/* Exercise instructions below camera */}
          <div className="camera-instructions">
            <Info size={16} color="var(--color-primary)" style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {instructionSteps.map((step, idx) => (
                <p key={idx} style={{ fontSize: "13px", fontWeight: 500, color: "var(--color-gray-400)", lineHeight: 1.4 }}>
                  <span style={{ color: "var(--color-primary)", fontWeight: 700 }}>{idx + 1}. </span>
                  {step}
                </p>
              ))}
            </div>
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
              playing
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
                  / {reps}
                </span>
              </div>
            </div>

            {/* Circular progress */}
            <div
              style={{
                width: 88,
                height: 88,
                borderRadius: "var(--radius-full)",
                background: `conic-gradient(var(--color-primary) ${reps > 0 ? (currentRep / reps) * 100 : 0}%, var(--color-gray-100) 0)`,
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

          {/* Controls */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-md)", marginTop: "auto" }}>
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
          </div>
        </div>
      </div>
    </div>
  );
}
