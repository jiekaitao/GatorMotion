"use client";

/**
 * StreakFlame — A flame icon that progressively fills based on daily progress.
 * fillPercent: 0-100 (0 = empty/gray, 100 = fully lit orange flame)
 * streakCount: the number to display below the flame
 */

interface StreakFlameProps {
  fillPercent: number;
  streakCount: number;
  size?: number;
}

export default function StreakFlame({
  fillPercent,
  streakCount,
  size = 64,
}: StreakFlameProps) {
  const clampedFill = Math.max(0, Math.min(100, fillPercent));
  const isLit = clampedFill > 0;
  const isFull = clampedFill >= 100;
  const gradientId = `flame-fill-${Math.random().toString(36).slice(2, 8)}`;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "4px",
      }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{
          filter: isFull ? "drop-shadow(0 0 8px rgba(255, 150, 0, 0.5))" : "none",
          transition: "filter 0.3s ease",
        }}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="1" x2="0" y2="0">
            <stop
              offset={`${clampedFill}%`}
              stopColor={isLit ? "#FF9600" : "#E5E5E5"}
            />
            <stop
              offset={`${clampedFill}%`}
              stopColor={isLit ? "#E5E5E5" : "#E5E5E5"}
            />
          </linearGradient>
          <linearGradient id={`${gradientId}-inner`} x1="0" y1="1" x2="0" y2="0">
            <stop
              offset={`${Math.max(0, clampedFill - 20)}%`}
              stopColor={isLit ? "#FFD700" : "#CDCDCD"}
            />
            <stop
              offset={`${Math.max(0, clampedFill - 20)}%`}
              stopColor={isLit ? "#CDCDCD" : "#CDCDCD"}
            />
          </linearGradient>
        </defs>
        {/* Outer flame — sharp tip, wide body, rounded base */}
        <path
          d="M32 4C32 4 28 12 25 18C21 26 16 31 16 40C16 48 23 56 32 56C41 56 48 48 48 40C48 31 43 26 39 18C36 12 32 4 32 4Z"
          fill={`url(#${gradientId})`}
          stroke={isLit ? "#E58600" : "#CDCDCD"}
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        {/* Inner flame tongue */}
        <path
          d="M32 22C32 22 26 34 26 41C26 46 28.5 50 32 52C35.5 50 38 46 38 41C38 34 32 22 32 22Z"
          fill={`url(#${gradientId}-inner)`}
        />
      </svg>
      <div
        style={{
          fontSize: "20px",
          fontWeight: 800,
          color: isFull ? "#FF9600" : isLit ? "#E58600" : "#AFAFAF",
          lineHeight: 1,
          transition: "color 0.3s ease",
        }}
      >
        {streakCount}
      </div>
    </div>
  );
}
