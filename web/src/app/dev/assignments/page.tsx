"use client";

import { useEffect, useState, FormEvent } from "react";

import Link from "next/link";
import { ChevronLeft, CheckCircle2, Circle } from "lucide-react";

interface Exercise {
  _id: string;
  name: string;
  defaultSets: number;
  defaultReps: number;
  defaultHoldSec: number;
}

interface AssignmentExercise {
  exerciseId: string;
  exerciseName: string;
  sets: number;
  reps: number;
  holdSec: number;
  completed: boolean;
}

interface Assignment {
  _id: string;
  userId: string;
  date: string;
  exercises: AssignmentExercise[];
  allCompleted: boolean;
}

export default function DevAssignmentsPage() {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [userId, setUserId] = useState("");
  const [selectedExercises, setSelectedExercises] = useState<Set<string>>(new Set());
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => { if (d.user) setUserId(d.user.id); })
      .catch(() => {});

    fetch("/api/exercises")
      .then((r) => r.json())
      .then((d) => setExercises(d.exercises || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!userId) return;
    fetch("/api/assignments")
      .then((r) => r.json())
      .then((d) => setAssignments(d.assignments || []))
      .catch(() => {});
  }, [userId]);

  function toggleExercise(id: string) {
    setSelectedExercises((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleAssign(e: FormEvent) {
    e.preventDefault();
    if (selectedExercises.size === 0) return;

    const exerciseList = exercises
      .filter((ex) => selectedExercises.has(ex._id))
      .map((ex) => ({
        exerciseId: ex._id,
        exerciseName: ex.name,
        sets: ex.defaultSets,
        reps: ex.defaultReps,
        holdSec: ex.defaultHoldSec,
      }));

    await fetch("/api/assignments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, date, exercises: exerciseList }),
    });

    setMessage(`Assigned ${exerciseList.length} exercises for ${date}`);
    setSelectedExercises(new Set());

    // Refresh
    const res = await fetch("/api/assignments");
    const data = await res.json();
    setAssignments(data.assignments || []);
  }

  return (
    <>
      <div className="page">
        <Link href="/dev" style={{ display: "inline-flex", alignItems: "center", gap: "4px", color: "var(--color-gray-400)", textDecoration: "none", fontSize: "var(--text-small)", fontWeight: 600, marginBottom: "var(--space-sm)" }}>
          <ChevronLeft size={18} /> Back to Dev Panel
        </Link>
        <h1 style={{ fontSize: "var(--text-h1)", fontWeight: 800, marginBottom: "var(--space-lg)" }}>Dev: Assignments</h1>
        {/* Create Assignment */}
        <form onSubmit={handleAssign} className="card animate-in" style={{ marginBottom: "var(--space-lg)" }}>
          <h3 style={{ marginBottom: "var(--space-md)" }}>Create Assignment</h3>

          <div className="stack stack-md">
            <div>
              <label className="input-label">Date</label>
              <input
                type="date"
                className="input"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>

            <div>
              <label className="input-label">Select Exercises</label>
              {exercises.length === 0 ? (
                <p className="text-small">No exercises available. Create some first.</p>
              ) : (
                <div className="stack stack-sm">
                  {exercises.map((ex) => (
                    <button
                      key={ex._id}
                      type="button"
                      onClick={() => toggleExercise(ex._id)}
                      className={selectedExercises.has(ex._id) ? "card card-success" : "card"}
                      style={{ textAlign: "left", cursor: "pointer", display: "flex", alignItems: "center", gap: "12px", padding: "12px 16px" }}
                    >
                      {selectedExercises.has(ex._id) ? (
                        <CheckCircle2 size={20} color="var(--color-primary)" />
                      ) : (
                        <Circle size={20} color="var(--color-gray-200)" />
                      )}
                      <div>
                        <div style={{ fontWeight: 600 }}>{ex.name}</div>
                        <div className="text-small">
                          {ex.defaultSets}x{ex.defaultReps}
                          {ex.defaultHoldSec > 0 ? ` / ${ex.defaultHoldSec}s` : ""}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {message && <div className="badge badge-green">{message}</div>}

            <button
              type="submit"
              className="btn btn-primary btn-full"
              disabled={selectedExercises.size === 0}
            >
              Assign ({selectedExercises.size} exercises)
            </button>
          </div>
        </form>

        {/* Assignment History */}
        <div className="animate-in" style={{ animationDelay: "60ms" }}>
          <h3 style={{ marginBottom: "var(--space-md)" }}>
            Recent Assignments ({assignments.length})
          </h3>
          <div className="stack stack-sm">
            {assignments.map((a) => (
              <div key={a._id} className={`card ${a.allCompleted ? "card-success" : ""}`}>
                <div className="row row-between" style={{ marginBottom: "8px" }}>
                  <span style={{ fontWeight: 700 }}>{a.date}</span>
                  <span className={`badge ${a.allCompleted ? "badge-green" : "badge-orange"}`}>
                    {a.allCompleted ? "Done" : `${a.exercises.filter((e) => e.completed).length}/${a.exercises.length}`}
                  </span>
                </div>
                <div className="stack stack-sm">
                  {a.exercises.map((ex) => (
                    <div key={ex.exerciseId} className="row row-gap-sm">
                      {ex.completed ? (
                        <CheckCircle2 size={16} color="var(--color-primary)" />
                      ) : (
                        <Circle size={16} color="var(--color-gray-200)" />
                      )}
                      <span className="text-small" style={{ color: ex.completed ? "var(--color-primary-dark)" : "var(--color-gray-400)" }}>
                        {ex.exerciseName}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            {assignments.length === 0 && (
              <p className="text-small">No assignments yet.</p>
            )}
          </div>
        </div>
      </div>

    </>
  );
}
