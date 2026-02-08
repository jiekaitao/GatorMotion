"use client";

import { useEffect, useState, useRef, useCallback, use, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Check, Calendar, Dumbbell, Minus, Plus, Send, MessageCircle } from "lucide-react";
import SkeletonViewer from "@/components/SkeletonViewer";
import { showToast } from "@/components/Toast";

interface Exercise {
  _id: string;
  name: string;
  description: string;
  category: string;
  defaultSets: number;
  defaultReps: number;
  defaultHoldSec: number;
  exerciseKey?: string;
  skeletonDataFile?: string;
}

interface PatientInfo {
  _id: string;
  name: string;
  username: string;
}

interface AssignmentExercise {
  exerciseId: string;
  exerciseName: string;
  completed: boolean;
}

interface Assignment {
  _id: string;
  date: string;
  exercises: AssignmentExercise[];
  allCompleted: boolean;
}

interface ExerciseConfig {
  sets: number;
  reps: number;
}

interface ChatMessage {
  _id: string;
  content: string;
  isMine: boolean;
  createdAt: string;
}

export default function PatientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [patient, setPatient] = useState<PatientInfo | null>(null);
  const [todayAssignment, setTodayAssignment] = useState<Assignment | null>(null);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [configs, setConfigs] = useState<Record<string, ExerciseConfig>>({});
  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState("");

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [newMsg, setNewMsg] = useState("");
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    Promise.all([
      fetch(`/api/patients/${id}`).then((r) => r.json()),
      fetch("/api/exercises").then((r) => r.json()),
    ])
      .then(([patientData, exerciseData]) => {
        if (patientData.error) {
          setError(patientData.error);
        } else {
          setPatient(patientData.patient);
          setTodayAssignment(patientData.todayAssignment);
        }
        const exList: Exercise[] = exerciseData.exercises || [];
        setExercises(exList);
        const initial: Record<string, ExerciseConfig> = {};
        for (const ex of exList) {
          initial[ex._id] = { sets: ex.defaultSets, reps: ex.defaultReps };
        }
        setConfigs(initial);
      })
      .catch(() => setError("Failed to load data"))
      .finally(() => setLoading(false));
  }, [id]);

  // Chat: fetch messages
  const fetchMessages = useCallback(async () => {
    try {
      const res = await fetch(`/api/messages/${id}`);
      const data = await res.json();
      setMessages(data.messages || []);
    } catch { /* ignore */ }
  }, [id]);

  useEffect(() => {
    fetchMessages();
    pollRef.current = setInterval(fetchMessages, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchMessages]);

  // Auto-scroll chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend(e: FormEvent) {
    e.preventDefault();
    if (!newMsg.trim()) return;
    setSending(true);
    try {
      await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: id, content: newMsg.trim() }),
      });
      setNewMsg("");
      await fetchMessages();
    } catch { /* ignore */ }
    finally { setSending(false); }
  }

  function toggleExercise(exerciseId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(exerciseId)) {
        next.delete(exerciseId);
      } else {
        next.add(exerciseId);
      }
      return next;
    });
  }

  function updateConfig(exerciseId: string, field: "sets" | "reps", delta: number) {
    setConfigs((prev) => {
      const current = prev[exerciseId];
      if (!current) return prev;
      const newVal = Math.max(1, current[field] + delta);
      return { ...prev, [exerciseId]: { ...current, [field]: newVal } };
    });
  }

  async function handleAssign() {
    if (selected.size === 0) return;
    setAssigning(true);
    setError("");

    const selectedExercises = exercises
      .filter((ex) => selected.has(ex._id))
      .map((ex) => ({
        exerciseId: ex._id,
        exerciseName: ex.name,
        sets: configs[ex._id]?.sets ?? ex.defaultSets,
        reps: configs[ex._id]?.reps ?? ex.defaultReps,
        holdSec: ex.defaultHoldSec,
        exerciseKey: ex.exerciseKey,
        skeletonDataFile: ex.skeletonDataFile,
      }));

    try {
      const res = await fetch("/api/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: id,
          date,
          exercises: selectedExercises,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to assign");
      } else {
        showToast("Exercises assigned!", "success");
        setSelected(new Set());
        const patientData = await fetch(`/api/patients/${id}`).then((r) => r.json());
        setTodayAssignment(patientData.todayAssignment);
      }
    } catch {
      setError("Something went wrong");
    } finally {
      setAssigning(false);
    }
  }

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "var(--color-gray-300)" }}>
        Loading...
      </div>
    );
  }

  return (
    <div style={{ width: "100%", padding: "var(--space-lg) var(--space-xl)", paddingBottom: "var(--space-xl)" }}>
      {/* Back button */}
      <button
        onClick={() => router.push("/therapist/patients")}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          color: "var(--color-gray-400)",
          background: "none",
          border: "none",
          cursor: "pointer",
          fontSize: "15px",
          fontWeight: 600,
          marginBottom: "var(--space-lg)",
          padding: 0,
        }}
      >
        <ChevronLeft size={20} /> Back to Patients
      </button>

      {/* Patient header */}
      {patient && (
        <div className="animate-in" style={{ marginBottom: "var(--space-lg)" }}>
          <h1 style={{ fontSize: "32px", fontWeight: 800, margin: 0 }}>{patient.name}</h1>
          <p style={{ fontSize: "15px", color: "var(--color-gray-300)", marginTop: 4 }}>@{patient.username}</p>
        </div>
      )}

      {/* Today's Assignment */}
      {todayAssignment && (
        <div className="card animate-in" style={{ marginBottom: "var(--space-xl)", animationDelay: "60ms", padding: "var(--space-lg)" }}>
          <h3 style={{ fontWeight: 700, fontSize: "18px", marginBottom: "var(--space-md)" }}>Today&apos;s Assignment</h3>
          <div style={{ display: "flex", gap: "var(--space-md)", flexWrap: "wrap" }}>
            {todayAssignment.exercises.map((ex, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 16px",
                  borderRadius: "var(--radius-xl)",
                  backgroundColor: ex.completed ? "var(--color-green-surface)" : "var(--color-snow)",
                }}
              >
                <div
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: "var(--radius-full)",
                    backgroundColor: ex.completed ? "var(--color-green)" : "var(--color-gray-100)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  {ex.completed && <Check size={13} color="white" />}
                </div>
                <span style={{ fontWeight: 600, fontSize: "15px", color: ex.completed ? "var(--color-gray-300)" : "var(--color-gray-600)", textDecoration: ex.completed ? "line-through" : "none" }}>
                  {ex.exerciseName}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Two-column layout: Assign Exercises + Chat */}
      <div style={{ display: "grid", gridTemplateColumns: "540px 0.8fr", gap: "var(--space-xl)", alignItems: "stretch" }}>
        {/* LEFT: Assign Exercises */}
        <div className="animate-in" style={{ animationDelay: "120ms" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-lg)", flexWrap: "wrap", gap: "var(--space-md)" }}>
            <h3 style={{ fontSize: "24px", fontWeight: 800, margin: 0 }}>
              Assign Exercises
            </h3>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
              <Calendar size={18} color="var(--color-blue)" />
              <input
                type="date"
                className="input"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                style={{ padding: "8px 12px", fontSize: "15px" }}
              />
              {date === new Date().toISOString().split("T")[0] && (
                <span style={{ fontSize: "13px", color: "var(--color-gray-300)", fontWeight: 600 }}>Today</span>
              )}
            </div>
          </div>

          {/* Exercise cards */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: "var(--space-lg)",
            marginBottom: "var(--space-xl)",
          }}>
            {exercises.map((ex) => {
              const isSelected = selected.has(ex._id);
              const cfg = configs[ex._id];
              return (
                <div
                  key={ex._id}
                  className="exercise-card"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    borderRadius: 20,
                    border: `3px solid ${isSelected ? "var(--color-primary)" : "var(--color-gray-100)"}`,
                    backgroundColor: isSelected ? "var(--color-primary-surface)" : "var(--color-white)",
                    cursor: "pointer",
                    transition: "all 0.25s ease",
                    overflow: "hidden",
                    position: "relative",
                    boxShadow: isSelected
                      ? "0 4px 0 var(--color-primary-dark)"
                      : "0 4px 0 var(--color-gray-100)",
                  }}
                >
                  {/* Selection check */}
                  <div
                    onClick={() => toggleExercise(ex._id)}
                    style={{
                      position: "absolute",
                      top: 10,
                      right: 10,
                      width: 30,
                      height: 30,
                      borderRadius: "var(--radius-full)",
                      border: `2px solid ${isSelected ? "var(--color-primary)" : "rgba(255,255,255,0.6)"}`,
                      backgroundColor: isSelected ? "var(--color-primary)" : "rgba(255,255,255,0.3)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      zIndex: 2,
                      backdropFilter: "blur(4px)",
                    }}
                  >
                    {isSelected && <Check size={16} color="white" strokeWidth={3} />}
                  </div>

                  {/* Clickable area */}
                  <div onClick={() => toggleExercise(ex._id)}>
                    {/* Skeleton preview or placeholder */}
                    <div style={{
                      width: "100%",
                      aspectRatio: "1/1",
                      backgroundColor: ex.skeletonDataFile ? "#1a1a2e" : "var(--color-snow)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      position: "relative",
                      overflow: "hidden",
                    }}>
                      {ex.skeletonDataFile ? (
                        <SkeletonViewer
                          skeletonDataFile={ex.skeletonDataFile}
                          playing
                          speed={0.5}
                          color={isSelected ? "#02caca" : "#4A90D9"}
                          backgroundColor="#1a1a2e"
                          className="skeleton-thumb"
                        />
                      ) : (
                        <div style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          gap: 10,
                        }}>
                          <Dumbbell size={44} color="var(--color-gray-200)" />
                          <span style={{
                            fontSize: "13px",
                            fontWeight: 700,
                            color: "var(--color-gray-300)",
                            textTransform: "uppercase",
                            letterSpacing: "0.03em",
                          }}>
                            Manual mode
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Info */}
                    <div style={{ padding: "16px 18px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ fontWeight: 800, fontSize: "18px", lineHeight: 1.2 }}>{ex.name}</div>
                      <div style={{
                        fontSize: "14px",
                        color: "var(--color-gray-400)",
                        lineHeight: 1.4,
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical" as const,
                        overflow: "hidden",
                      }}>
                        {ex.description}
                      </div>
                      <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-gray-300)", marginTop: 2 }}>
                        {cfg?.sets ?? ex.defaultSets} sets &middot; {cfg?.reps ?? ex.defaultReps} reps
                      </div>
                    </div>
                  </div>

                  {/* Expandable config panel */}
                  <div
                    style={{
                      maxHeight: isSelected ? 90 : 0,
                      opacity: isSelected ? 1 : 0,
                      overflow: "hidden",
                      transition: "max-height 0.3s ease, opacity 0.2s ease",
                      borderTop: isSelected ? "1px solid var(--color-gray-100)" : "none",
                    }}
                  >
                    <div style={{ padding: "12px 18px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-gray-400)" }}>Sets</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <button onClick={(e) => { e.stopPropagation(); updateConfig(ex._id, "sets", -1); }} className="stepper-btn">
                            <Minus size={16} />
                          </button>
                          <span style={{ fontSize: "16px", fontWeight: 700, minWidth: 24, textAlign: "center" }}>{cfg?.sets ?? ex.defaultSets}</span>
                          <button onClick={(e) => { e.stopPropagation(); updateConfig(ex._id, "sets", 1); }} className="stepper-btn">
                            <Plus size={16} />
                          </button>
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--color-gray-400)" }}>Reps</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <button onClick={(e) => { e.stopPropagation(); updateConfig(ex._id, "reps", -1); }} className="stepper-btn">
                            <Minus size={16} />
                          </button>
                          <span style={{ fontSize: "16px", fontWeight: 700, minWidth: 24, textAlign: "center" }}>{cfg?.reps ?? ex.defaultReps}</span>
                          <button onClick={(e) => { e.stopPropagation(); updateConfig(ex._id, "reps", 1); }} className="stepper-btn">
                            <Plus size={16} />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {error && (
            <p style={{ color: "var(--color-red)", fontSize: "15px", fontWeight: 600, marginBottom: "var(--space-md)" }}>{error}</p>
          )}

          <button
            className="btn btn-primary btn-full"
            disabled={selected.size === 0 || assigning}
            onClick={handleAssign}
            style={{ borderRadius: "var(--radius-xl)", fontSize: "16px", padding: "14px 24px" }}
          >
            {assigning ? "Assigning..." : `Assign Selected (${selected.size})`}
          </button>
        </div>

        {/* RIGHT: Chat with Patient */}
        <div
          className="animate-in"
          style={{
            animationDelay: "180ms",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
            borderRadius: "var(--radius-lg)",
            border: "2px solid var(--color-gray-100)",
            backgroundColor: "var(--color-white)",
            overflow: "hidden",
          }}
        >
          {/* Chat header */}
          <div style={{
            padding: "var(--space-md) var(--space-lg)",
            borderBottom: "2px solid var(--color-gray-100)",
            display: "flex",
            alignItems: "center",
            gap: "var(--space-sm)",
            flexShrink: 0,
          }}>
            <MessageCircle size={20} color="var(--color-primary)" />
            <span style={{ fontWeight: 700, fontSize: "16px" }}>
              Chat with {patient?.name.split(" ")[0] || "Patient"}
            </span>
          </div>

          {/* Messages area */}
          <div style={{
            flex: 1,
            overflowY: "auto",
            padding: "var(--space-md) var(--space-lg)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-sm)",
          }}>
            {messages.length === 0 && (
              <div style={{ textAlign: "center", color: "var(--color-gray-300)", flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                <MessageCircle size={44} style={{ marginBottom: "var(--space-md)", opacity: 0.3 }} />
                <p style={{ fontWeight: 600, fontSize: "15px" }}>No messages yet</p>
                <p style={{ fontSize: "14px", marginTop: 6, color: "var(--color-gray-200)" }}>Send a message to start the conversation.</p>
              </div>
            )}
            {messages.map((msg) => (
              <div
                key={msg._id}
                style={{
                  display: "flex",
                  justifyContent: msg.isMine ? "flex-end" : "flex-start",
                }}
              >
                <div
                  style={{
                    maxWidth: "85%",
                    padding: "10px 14px",
                    borderRadius: msg.isMine ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
                    backgroundColor: msg.isMine ? "var(--color-primary)" : "var(--color-snow)",
                    color: msg.isMine ? "white" : "var(--color-gray-600)",
                    fontSize: "15px",
                    lineHeight: 1.4,
                    wordBreak: "break-word",
                  }}
                >
                  {msg.content}
                  <div style={{ fontSize: "11px", marginTop: 4, opacity: 0.5, textAlign: "right" }}>
                    {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input bar */}
          <form
            onSubmit={handleSend}
            style={{
              display: "flex",
              gap: "var(--space-sm)",
              padding: "var(--space-md) var(--space-lg)",
              borderTop: "2px solid var(--color-gray-100)",
              flexShrink: 0,
            }}
          >
            <input
              type="text"
              className="input"
              placeholder="Type a message..."
              value={newMsg}
              onChange={(e) => setNewMsg(e.target.value)}
              style={{ flex: 1, fontSize: "15px", padding: "10px 14px" }}
            />
            <button
              type="submit"
              className="btn btn-teal"
              disabled={sending || !newMsg.trim()}
              style={{ padding: "10px 14px" }}
            >
              <Send size={18} />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
