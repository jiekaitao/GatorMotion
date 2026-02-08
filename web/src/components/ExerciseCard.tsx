"use client";

import { CheckCircle2, Dumbbell, Play } from "lucide-react";

interface ExerciseCardProps {
  name: string;
  sets: number;
  reps: number;
  holdSec: number;
  completed: boolean;
  onClick: () => void;
}

export default function ExerciseCard({
  name,
  sets,
  reps,
  holdSec,
  completed,
  onClick,
}: ExerciseCardProps) {
  return (
    <button
      onClick={onClick}
      disabled={completed}
      className={completed ? "card card-success" : "card-interactive"}
      style={{
        width: "100%",
        display: "flex",
        alignItems: "center",
        gap: "16px",
        textAlign: "left",
        position: "relative",
        background: completed ? "var(--color-primary-surface)" : "var(--color-white)",
      }}
    >
      {/* Icon */}
      <div
        style={{
          width: 48,
          height: 48,
          borderRadius: "var(--radius-md)",
          backgroundColor: completed
            ? "var(--color-primary-light)"
            : "var(--color-snow)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {completed ? (
          <CheckCircle2
            size={24}
            strokeWidth={2.5}
            color="var(--color-primary)"
          />
        ) : (
          <Dumbbell size={24} strokeWidth={2} color="var(--color-gray-300)" />
        )}
      </div>

      {/* Text */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: "16px",
            fontWeight: 700,
            color: completed
              ? "var(--color-primary-dark)"
              : "var(--color-gray-600)",
            marginBottom: "2px",
          }}
        >
          {name}
        </div>
        <div
          style={{
            fontSize: "14px",
            color: completed
              ? "var(--color-primary)"
              : "var(--color-gray-400)",
          }}
        >
          {sets} sets x {reps} reps
          {holdSec > 0 ? ` / ${holdSec}s hold` : ""}
        </div>
      </div>

      {/* Action */}
      {!completed && (
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: "var(--radius-full)",
            backgroundColor: "var(--color-primary)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Play size={18} fill="white" color="white" />
        </div>
      )}
    </button>
  );
}
