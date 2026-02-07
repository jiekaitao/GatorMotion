"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import StreakFlame from "@/components/StreakFlame";
import { TrendingUp, Award, Flame } from "lucide-react";

interface StreakData {
  currentStreak: number;
  longestStreak: number;
  lastCompletedDate: string | null;
  history: string[];
}

export default function ProgressPage() {
  const router = useRouter();
  const [streak, setStreak] = useState<StreakData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch("/api/streaks");
        if (!res.ok) {
          router.replace("/login");
          return;
        }
        const data = await res.json();
        setStreak(data.streak);
      } catch {
        router.replace("/login");
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [router]);

  if (loading || !streak) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "var(--color-gray-300)" }}>
        Loading...
      </div>
    );
  }

  // Build calendar of last 30 days
  const today = new Date();
  const last30: { date: string; completed: boolean }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split("T")[0];
    last30.push({ date: dateStr, completed: streak.history.includes(dateStr) });
  }

  return (
    <AppShell streakCount={streak.currentStreak}>
      <div className="page">
        <h1 style={{ fontSize: "var(--text-h1)", fontWeight: 800, marginBottom: "var(--space-lg)" }}>Progress</h1>

        {/* Streak Hero */}
        <div className="card animate-in text-center" style={{ marginBottom: "var(--space-lg)" }}>
          <StreakFlame
            fillPercent={streak.currentStreak > 0 ? 100 : 0}
            streakCount={streak.currentStreak}
            size={96}
          />
          <h2 style={{ marginTop: "var(--space-md)" }}>
            {streak.currentStreak > 0
              ? `${streak.currentStreak} Day Streak`
              : "No Active Streak"}
          </h2>
        </div>

        {/* Stats Row */}
        <div className="row" style={{ gap: "var(--space-md)", marginBottom: "var(--space-lg)" }}>
          <div className="card animate-in" style={{ flex: 1, textAlign: "center", animationDelay: "60ms" }}>
            <Flame size={24} color="var(--color-orange)" />
            <div style={{ marginTop: "4px", fontSize: "24px", fontWeight: 800 }}>
              {streak.currentStreak}
            </div>
            <div className="text-small">Current</div>
          </div>
          <div className="card animate-in" style={{ flex: 1, textAlign: "center", animationDelay: "120ms" }}>
            <Award size={24} color="var(--color-primary)" />
            <div style={{ marginTop: "4px", fontSize: "24px", fontWeight: 800 }}>
              {streak.longestStreak}
            </div>
            <div className="text-small">Longest</div>
          </div>
          <div className="card animate-in" style={{ flex: 1, textAlign: "center", animationDelay: "180ms" }}>
            <TrendingUp size={24} color="var(--color-blue)" />
            <div style={{ marginTop: "4px", fontSize: "24px", fontWeight: 800 }}>
              {streak.history.length}
            </div>
            <div className="text-small">Total Days</div>
          </div>
        </div>

        {/* 30-Day Calendar */}
        <div className="animate-in" style={{ animationDelay: "240ms" }}>
          <h3 style={{ marginBottom: "var(--space-md)" }}>Last 30 Days</h3>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              gap: "6px",
            }}
          >
            {last30.map(({ date, completed }) => (
              <div
                key={date}
                title={date}
                style={{
                  aspectRatio: "1",
                  borderRadius: "var(--radius-sm)",
                  backgroundColor: completed
                    ? "var(--color-green)"
                    : "var(--color-gray-100)",
                  transition: "background-color 0.2s ease",
                }}
              />
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
