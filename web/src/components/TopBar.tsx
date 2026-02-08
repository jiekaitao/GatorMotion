"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import StreakFlame from "./StreakFlame";

interface TopBarProps {
  title?: string;
  showBack?: boolean;
  streakCount?: number;
  streakFill?: number;
  rightContent?: React.ReactNode;
}

export default function TopBar({
  title,
  showBack,
  streakCount,
  streakFill,
  rightContent,
}: TopBarProps) {
  const router = useRouter();

  return (
    <div className="top-bar">
      <div className="row row-gap-md">
        {showBack && (
          <button
            onClick={() => router.back()}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "4px",
              color: "var(--color-gray-400)",
            }}
          >
            <ArrowLeft size={24} strokeWidth={2} />
          </button>
        )}
        {title && <h2>{title}</h2>}
      </div>
      <div className="row row-gap-md">
        {streakCount !== undefined && (
          <StreakFlame
            fillPercent={streakFill ?? 0}
            streakCount={streakCount}
            size={36}
          />
        )}
        {rightContent}
      </div>
    </div>
  );
}
