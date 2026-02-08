"use client";

import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Check, Calendar } from "lucide-react";

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

export default function PatientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const [patient, setPatient] = useState<PatientInfo | null>(null);
  const [todayAssignment, setTodayAssignment] = useState<Assignment | null>(null);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [error, setError] = useState("");

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
        setExercises(exerciseData.exercises || []);
      })
      .catch(() => setError("Failed to load data"))
      .finally(() => setLoading(false));
  }, [id]);

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

  async function handleAssign() {
    if (selected.size === 0) return;
    setAssigning(true);
    setError("");

    const selectedExercises = exercises
      .filter((ex) => selected.has(ex._id))
      .map((ex) => ({
        exerciseId: ex._id,
        exerciseName: ex.name,
        sets: ex.defaultSets,
        reps: ex.defaultReps,
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
        // Refresh assignment data
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

      {/* Assign Exercises */}
      <div className="animate-in" style={{ animationDelay: "120ms" }}>
        <h3 style={{ fontSize: "var(--text-h2)", fontWeight: 800, marginBottom: "var(--space-md)" }}>
          Assign Exercises
        </h3>

        {/* Date picker */}
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", marginBottom: "var(--space-lg)" }}>
          <Calendar size={18} color="var(--color-gray-400)" />
          <input
            type="date"
            className="input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={{ maxWidth: 200 }}
          />
        </div>

        {/* Exercise cards */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)", marginBottom: "var(--space-lg)" }}>
          {exercises.map((ex) => {
            const isSelected = selected.has(ex._id);
            return (
              <div
                key={ex._id}
                onClick={() => toggleExercise(ex._id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-md)",
                  padding: "var(--space-md)",
                  borderRadius: "var(--radius-xl)",
                  border: `2px solid ${isSelected ? "var(--color-primary)" : "var(--color-gray-100)"}`,
                  backgroundColor: isSelected ? "var(--color-primary-surface)" : "var(--color-white)",
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "var(--radius-sm)",
                    border: `2px solid ${isSelected ? "var(--color-primary)" : "var(--color-gray-200)"}`,
                    backgroundColor: isSelected ? "var(--color-primary)" : "transparent",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  {isSelected && <Check size={16} color="white" />}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700 }}>{ex.name}</div>
                  <div className="text-tiny" style={{ color: "var(--color-gray-300)", marginTop: 2 }}>
                    {ex.defaultSets} sets &middot; {ex.defaultReps} reps
                    {ex.exerciseKey && <span style={{ marginLeft: 8, color: "var(--color-primary)" }}>{ex.exerciseKey}</span>}
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
    </div>
  );
}
