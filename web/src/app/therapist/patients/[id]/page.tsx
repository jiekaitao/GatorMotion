"use client";

import { useEffect, useState, useRef, useCallback, use, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Check, Calendar, Dumbbell, Minus, Plus, Send, MessageCircle } from "lucide-react";
import SkeletonViewer from "@/components/SkeletonViewer";

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
  const [successMsg, setSuccessMsg] = useState("");
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
        setSuccessMsg("Exercises assigned!");
        setSelected(new Set());
        const patientData = await fetch(`/api/patients/${id}`).then((r) => r.json());
        setTodayAssignment(patientData.todayAssignment);
        setTimeout(() => setSuccessMsg(""), 4000);
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
    <div className="page">
      {/* Back button */}
      <button
        onClick={() => router.push("/therapist/patients")}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          color: "var(--color-gray-400)",
          background: "none",
          border: "none",
          cursor: "pointer",
          fontSize: "var(--text-small)",
          fontWeight: 600,
          marginBottom: "var(--space-md)",
          padding: 0,
        }}
      >
        <ChevronLeft size={18} /> Back to Patients
      </button>

      {patient && (
        <div className="animate-in" style={{ marginBottom: "var(--space-xl)" }}>
          <h1 style={{ fontSize: "var(--text-display)", fontWeight: 800 }}>{patient.name}</h1>
          <p className="text-small" style={{ marginTop: 4 }}>@{patient.username}</p>
        </div>
      )}

      {/* Current Assignment */}
      {todayAssignment && (
        <div className="card animate-in" style={{ marginBottom: "var(--space-xl)", animationDelay: "60ms" }}>
          <h3 style={{ fontWeight: 700, marginBottom: "var(--space-md)" }}>Today&apos;s Assignment</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
            {todayAssignment.exercises.map((ex, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-md)",
                  padding: "var(--space-sm) 0",
                  borderBottom: i < todayAssignment.exercises.length - 1 ? "1px solid var(--color-gray-100)" : "none",
                }}
              >
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: "var(--radius-full)",
                    backgroundColor: ex.completed ? "var(--color-green)" : "var(--color-gray-100)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  {ex.completed && <Check size={14} color="white" />}
                </div>
                <span style={{ fontWeight: 600, color: ex.completed ? "var(--color-gray-300)" : "var(--color-gray-600)", textDecoration: ex.completed ? "line-through" : "none" }}>
                  {ex.exerciseName}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Two-column layout: Assign Exercises + Chat */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: "var(--space-xl)", alignItems: "start" }}>
        {/* LEFT: Assign Exercises */}
        <div className="animate-in" style={{ animationDelay: "120ms" }}>
          <h3 style={{ fontSize: "var(--text-h2)", fontWeight: 800, marginBottom: "var(--space-sm)" }}>
            Assign Exercises
          </h3>
          <p className="text-small" style={{ marginBottom: "var(--space-lg)" }}>
            Select exercises and choose when {patient?.name.split(" ")[0] || "the patient"} should complete them.
          </p>

          {/* Due date picker */}
          <div className="card" style={{ marginBottom: "var(--space-xl)", display: "flex", alignItems: "center", gap: "var(--space-md)" }}>
            <div style={{
              width: 44,
              height: 44,
              borderRadius: "var(--radius-md)",
              backgroundColor: "var(--color-blue-light)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}>
              <Calendar size={22} color="var(--color-blue)" />
            </div>
            <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "var(--space-md)" }}>
              <label style={{ fontSize: "var(--text-tiny)", fontWeight: 700, color: "var(--color-gray-400)", textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>
                Due date
              </label>
              <input
                type="date"
                className="input"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                style={{ maxWidth: 200, padding: "8px 12px" }}
              />
            </div>
            <span className="text-tiny" style={{ color: "var(--color-gray-300)", marginLeft: "var(--space-md)" }}>
              {date === new Date().toISOString().split("T")[0] ? "Today" : ""}
            </span>
          </div>

          {/* Exercise cards */}
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))",
            gap: "var(--space-md)",
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
                      top: 8,
                      right: 8,
                      width: 26,
                      height: 26,
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
                    {isSelected && <Check size={14} color="white" strokeWidth={3} />}
                  </div>

                  {/* Clickable area */}
                  <div onClick={() => toggleExercise(ex._id)}>
                    {/* Skeleton preview or placeholder */}
                    <div style={{
                      width: "100%",
                      aspectRatio: "3/4",
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
                          gap: 8,
                        }}>
                          <Dumbbell size={36} color="var(--color-gray-200)" />
                          <span style={{
                            fontSize: "11px",
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
                    <div style={{ padding: "12px 14px 10px", display: "flex", flexDirection: "column", gap: 4 }}>
                      <div style={{ fontWeight: 800, fontSize: "15px", lineHeight: 1.2 }}>{ex.name}</div>
                      <div style={{
                        fontSize: "12px",
                        color: "var(--color-gray-400)",
                        lineHeight: 1.3,
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical" as const,
                        overflow: "hidden",
                        minHeight: "2.6em",
                      }}>
                        {ex.description}
                      </div>
                      <div style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-gray-300)", marginTop: 2 }}>
                        {cfg?.sets ?? ex.defaultSets} sets &middot; {cfg?.reps ?? ex.defaultReps} reps
                      </div>
                    </div>
                  </div>

                  {/* Expandable config panel */}
                  <div
                    style={{
                      maxHeight: isSelected ? 80 : 0,
                      opacity: isSelected ? 1 : 0,
                      overflow: "hidden",
                      transition: "max-height 0.3s ease, opacity 0.2s ease",
                      borderTop: isSelected ? "1px solid var(--color-gray-100)" : "none",
                    }}
                  >
                    <div style={{ padding: "10px 14px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-gray-400)" }}>Sets</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <button onClick={(e) => { e.stopPropagation(); updateConfig(ex._id, "sets", -1); }} className="stepper-btn">
                            <Minus size={14} />
                          </button>
                          <span style={{ fontSize: "14px", fontWeight: 700, minWidth: 20, textAlign: "center" }}>{cfg?.sets ?? ex.defaultSets}</span>
                          <button onClick={(e) => { e.stopPropagation(); updateConfig(ex._id, "sets", 1); }} className="stepper-btn">
                            <Plus size={14} />
                          </button>
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-gray-400)" }}>Reps</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <button onClick={(e) => { e.stopPropagation(); updateConfig(ex._id, "reps", -1); }} className="stepper-btn">
                            <Minus size={14} />
                          </button>
                          <span style={{ fontSize: "14px", fontWeight: 700, minWidth: 20, textAlign: "center" }}>{cfg?.reps ?? ex.defaultReps}</span>
                          <button onClick={(e) => { e.stopPropagation(); updateConfig(ex._id, "reps", 1); }} className="stepper-btn">
                            <Plus size={14} />
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
            <p style={{ color: "var(--color-red)", fontSize: "14px", fontWeight: 600, marginBottom: "var(--space-md)" }}>{error}</p>
          )}
          {successMsg && (
            <p style={{
              color: "var(--color-green-dark)",
              fontSize: "14px",
              fontWeight: 600,
              marginBottom: "var(--space-md)",
              backgroundColor: "var(--color-green-surface)",
              padding: "8px 12px",
              borderRadius: "var(--radius-sm)",
            }}>{successMsg}</p>
          )}

          <button
            className="btn btn-primary btn-full"
            disabled={selected.size === 0 || assigning}
            onClick={handleAssign}
            style={{ borderRadius: "var(--radius-xl)" }}
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
            height: "calc(100vh - 200px)",
            minHeight: 400,
            borderRadius: "var(--radius-lg)",
            border: "2px solid var(--color-gray-100)",
            backgroundColor: "var(--color-white)",
            overflow: "hidden",
          }}
        >
          {/* Chat header */}
          <div style={{
            padding: "var(--space-md)",
            borderBottom: "2px solid var(--color-gray-100)",
            display: "flex",
            alignItems: "center",
            gap: "var(--space-sm)",
            flexShrink: 0,
          }}>
            <MessageCircle size={18} color="var(--color-primary)" />
            <span style={{ fontWeight: 700, fontSize: "14px" }}>
              Chat with {patient?.name.split(" ")[0] || "Patient"}
            </span>
          </div>

          {/* Messages area */}
          <div style={{
            flex: 1,
            overflowY: "auto",
            padding: "var(--space-md)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-sm)",
          }}>
            {messages.length === 0 && (
              <div style={{ textAlign: "center", color: "var(--color-gray-300)", marginTop: "var(--space-2xl)", flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                <MessageCircle size={36} style={{ marginBottom: "var(--space-sm)", opacity: 0.3 }} />
                <p style={{ fontWeight: 600, fontSize: "13px" }}>No messages yet</p>
                <p style={{ fontSize: "12px", marginTop: 4, color: "var(--color-gray-200)" }}>Send a message to start the conversation.</p>
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
                    padding: "8px 12px",
                    borderRadius: msg.isMine ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                    backgroundColor: msg.isMine ? "var(--color-primary)" : "var(--color-snow)",
                    color: msg.isMine ? "white" : "var(--color-gray-600)",
                    fontSize: "13px",
                    lineHeight: 1.4,
                    wordBreak: "break-word",
                  }}
                >
                  {msg.content}
                  <div style={{ fontSize: "10px", marginTop: 3, opacity: 0.5, textAlign: "right" }}>
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
              padding: "var(--space-sm) var(--space-md)",
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
              style={{ flex: 1, fontSize: "13px", padding: "8px 12px" }}
            />
            <button
              type="submit"
              className="btn btn-teal"
              disabled={sending || !newMsg.trim()}
              style={{ padding: "8px 12px" }}
            >
              <Send size={16} />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
