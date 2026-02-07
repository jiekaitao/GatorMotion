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
        {/* Outer flame shape */}
        <path
          d="M32 4C32 4 18 18 18 32C18 38 20 43 24 46C22 42 22 36 26 30C26 30 28 38 32 42C36 38 38 30 38 30C42 36 42 42 40 46C44 43 46 38 46 32C46 18 32 4 32 4Z"
          fill={`url(#${gradientId})`}
          stroke={isLit ? "#E58600" : "#CDCDCD"}
          strokeWidth="2"
          strokeLinejoin="round"
        />
        {/* Inner flame */}
        <path
          d="M32 24C32 24 26 32 26 38C26 42 28.5 45 32 46C35.5 45 38 42 38 38C38 32 32 24 32 24Z"
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
