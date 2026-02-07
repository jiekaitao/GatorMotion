"use client";

import { useEffect, useState } from "react";

import StreakFlame from "@/components/StreakFlame";

interface StreakInfo {
  userId: string;
  currentStreak: number;
  longestStreak: number;
  lastCompletedDate: string | null;
  history: string[];
}

export default function DevStreaksPage() {
  const [userId, setUserId] = useState("");
  const [streak, setStreak] = useState<StreakInfo | null>(null);
  const [allStreaks, setAllStreaks] = useState<StreakInfo[]>([]);
  const [customDate, setCustomDate] = useState(new Date().toISOString().split("T")[0]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    // Get current user ID
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        if (d.user) setUserId(d.user.id);
      })
      .catch(() => {});

    // Get all streaks
    fetch("/api/dev/streaks")
      .then((r) => r.json())
      .then((d) => setAllStreaks(d.streaks || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!userId) return;
    fetch(`/api/dev/streaks?userId=${userId}`)
      .then((r) => r.json())
      .then((d) => setStreak(d.streak))
      .catch(() => {});
  }, [userId]);

  async function doAction(action: string, extra?: Record<string, unknown>) {
    setMessage("");
    const res = await fetch("/api/dev/streaks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, userId, ...extra }),
    });
    const data = await res.json();
    if (data.streak) setStreak(data.streak);
    setMessage(`${action} completed`);

    // Refresh all streaks
    const allRes = await fetch("/api/dev/streaks");
    const allData = await allRes.json();
    setAllStreaks(allData.streaks || []);
  }

  return (
    <>
      <div className="page">
        <h1 style={{ fontSize: "var(--text-h1)", fontWeight: 800, marginBottom: "var(--space-lg)" }}>Dev: Streaks</h1>
        {/* Current user streak */}
        {streak && (
          <div className="card animate-in text-center" style={{ marginBottom: "var(--space-lg)" }}>
            <StreakFlame
              fillPercent={streak.currentStreak > 0 ? 100 : 0}
              streakCount={streak.currentStreak}
              size={80}
            />
            <p className="text-small" style={{ marginTop: "var(--space-sm)" }}>
              Longest: {streak.longestStreak} | Last: {streak.lastCompletedDate || "never"}
            </p>
            <p className="text-tiny" style={{ marginTop: "4px", color: "var(--color-gray-300)", wordBreak: "break-all" }}>
              User: {userId}
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="stack stack-md animate-in" style={{ animationDelay: "60ms", marginBottom: "var(--space-lg)" }}>
          <h3>Actions</h3>

          <div className="row" style={{ gap: "var(--space-sm)" }}>
            <input
              type="date"
              className="input"
              value={customDate}
              onChange={(e) => setCustomDate(e.target.value)}
              style={{ flex: 1 }}
            />
            <button
              className="btn btn-primary"
              onClick={() => doAction("increment", { date: customDate })}
            >
              Add Day
            </button>
          </div>

          <button
            className="btn btn-danger btn-full"
            onClick={() => doAction("reset")}
          >
            Reset Streak
          </button>

          <button
            className="btn btn-secondary btn-full"
            onClick={() => {
              // Build 7 consecutive days ending today
              const days: string[] = [];
              for (let i = 6; i >= 0; i--) {
                const d = new Date();
                d.setDate(d.getDate() - i);
                days.push(d.toISOString().split("T")[0]);
              }
              doAction("set", { currentStreak: 7, history: days });
            }}
          >
            Set 7-Day Streak
          </button>

          <button
            className="btn btn-secondary btn-full"
            onClick={() => {
              const days: string[] = [];
              for (let i = 29; i >= 0; i--) {
                const d = new Date();
                d.setDate(d.getDate() - i);
                days.push(d.toISOString().split("T")[0]);
              }
              doAction("set", { currentStreak: 30, history: days });
            }}
          >
            Set 30-Day Streak
          </button>

          {message && (
            <div className="badge badge-green">{message}</div>
          )}
        </div>

        {/* All Streaks */}
        <div className="animate-in" style={{ animationDelay: "120ms" }}>
          <h3 style={{ marginBottom: "var(--space-md)" }}>All Streaks in DB</h3>
          {allStreaks.map((s, i) => (
            <div key={i} className="card" style={{ marginBottom: "var(--space-sm)", padding: "12px" }}>
              <div className="row row-between">
                <span className="text-tiny" style={{ color: "var(--color-gray-400)" }}>
                  {s.userId}
                </span>
                <span style={{ fontWeight: 700, color: "var(--color-orange)" }}>
                  {s.currentStreak} days
                </span>
              </div>
            </div>
          ))}
          {allStreaks.length === 0 && (
            <p className="text-small">No streaks found.</p>
          )}
        </div>
      </div>

    </>
  );
}
