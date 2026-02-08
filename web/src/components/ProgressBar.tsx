"use client";

interface ProgressBarProps {
  value: number; // 0-100
  label?: string;
  small?: boolean;
  color?: "green" | "blue";
}

export default function ProgressBar({
  value,
  label,
  small,
  color = "green",
}: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, value));

  return (
    <div>
      {label && (
        <div
          style={{
            fontSize: "14px",
            fontWeight: 600,
            color: "var(--color-gray-400)",
            marginBottom: "6px",
          }}
        >
          {label}
        </div>
      )}
      <div className={`progress-track ${small ? "progress-track-sm" : ""}`}>
        <div
          className={`progress-fill ${color === "blue" ? "progress-fill-blue" : ""}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
