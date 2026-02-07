"use client";

import { useEffect, useState, FormEvent } from "react";

import { Trash2 } from "lucide-react";

interface Exercise {
  _id: string;
  name: string;
  description: string;
  category: string;
  defaultSets: number;
  defaultReps: number;
  defaultHoldSec: number;
}

export default function DevExercisesPage() {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("general");
  const [sets, setSets] = useState("3");
  const [reps, setReps] = useState("10");
  const [holdSec, setHoldSec] = useState("0");
  const [message, setMessage] = useState("");

  async function fetchExercises() {
    const res = await fetch("/api/exercises");
    const data = await res.json();
    setExercises(data.exercises || []);
  }

  useEffect(() => {
    fetchExercises();
  }, []);

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setMessage("");

    await fetch("/api/exercises", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        description,
        category,
        defaultSets: parseInt(sets),
        defaultReps: parseInt(reps),
        defaultHoldSec: parseInt(holdSec),
      }),
    });

    setMessage(`Created: ${name}`);
    setName("");
    setDescription("");
    fetchExercises();
  }

  async function handleDelete(id: string) {
    await fetch(`/api/exercises?id=${id}`, { method: "DELETE" });
    fetchExercises();
  }

  return (
    <>
      <div className="page">
        <h1 style={{ fontSize: "var(--text-h1)", fontWeight: 800, marginBottom: "var(--space-lg)" }}>Dev: Exercises</h1>
        {/* Create Form */}
        <form onSubmit={handleCreate} className="card animate-in" style={{ marginBottom: "var(--space-lg)" }}>
          <h3 style={{ marginBottom: "var(--space-md)" }}>Create Exercise</h3>

          <div className="stack stack-md">
            <div>
              <label className="input-label">Name</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Knee Extension" required />
            </div>
            <div>
              <label className="input-label">Description</label>
              <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Instructions for the exercise" />
            </div>
            <div>
              <label className="input-label">Category</label>
              <input className="input" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. knee, shoulder, back" />
            </div>
            <div className="row" style={{ gap: "var(--space-sm)" }}>
              <div style={{ flex: 1 }}>
                <label className="input-label">Sets</label>
                <input className="input" type="number" value={sets} onChange={(e) => setSets(e.target.value)} min="1" />
              </div>
              <div style={{ flex: 1 }}>
                <label className="input-label">Reps</label>
                <input className="input" type="number" value={reps} onChange={(e) => setReps(e.target.value)} min="1" />
              </div>
              <div style={{ flex: 1 }}>
                <label className="input-label">Hold (s)</label>
                <input className="input" type="number" value={holdSec} onChange={(e) => setHoldSec(e.target.value)} min="0" />
              </div>
            </div>

            {message && <div className="badge badge-green">{message}</div>}

            <button type="submit" className="btn btn-primary btn-full">
              Create Exercise
            </button>
          </div>
        </form>

        {/* Exercise List */}
        <div className="animate-in" style={{ animationDelay: "60ms" }}>
          <h3 style={{ marginBottom: "var(--space-md)" }}>
            All Exercises ({exercises.length})
          </h3>
          <div className="stack stack-sm">
            {exercises.map((ex) => (
              <div key={ex._id} className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{ex.name}</div>
                  <div className="text-small">
                    {ex.category} | {ex.defaultSets}x{ex.defaultReps}
                    {ex.defaultHoldSec > 0 ? ` / ${ex.defaultHoldSec}s` : ""}
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(ex._id)}
                  style={{ background: "none", border: "none", cursor: "pointer", padding: "8px", color: "var(--color-red)" }}
                >
                  <Trash2 size={18} />
                </button>
              </div>
            ))}
            {exercises.length === 0 && (
              <p className="text-small">No exercises yet. Create one above.</p>
            )}
          </div>
        </div>
      </div>

    </>
  );
}
