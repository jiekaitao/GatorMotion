"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { Database, Flame, Dumbbell, Users, ClipboardList, Mail, ScanEye, Volume2 } from "lucide-react";

interface Stats {
  counts: { users: number; exercises: number; assignments: number; streaks: number };
  timestamp: string;
}

export default function DevDashboard() {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    fetch("/api/dev/stats")
      .then((r) => r.json())
      .then(setStats)
      .catch(() => {});
  }, []);

  const links = [
    { href: "/dev/streaks", label: "Streaks", icon: Flame, desc: "Test streak increment/reset" },
    { href: "/dev/exercises", label: "Exercises", icon: Dumbbell, desc: "Create/manage exercises" },
    { href: "/dev/assignments", label: "Assignments", icon: ClipboardList, desc: "Create/view assignments" },
    { href: "/dev/users", label: "Users", icon: Users, desc: "View registered users" },
    { href: "/dev/invites", label: "Invites", icon: Mail, desc: "Create/manage patient invites" },
    { href: "/dev/cv-test", label: "CV Test", icon: ScanEye, desc: "Live webcam body tracking" },
    { href: "/dev/reset-voice-limits", label: "Reset Voice Limits", icon: Volume2, desc: "Clear TTS usage for all users" },
  ];

  return (
    <>
      <div className="page">
        <h1 style={{ fontSize: "var(--text-h1)", fontWeight: 800, marginBottom: "var(--space-md)" }}>Dev Panel</h1>
        <div className="badge badge-orange animate-in" style={{ marginBottom: "var(--space-lg)" }}>
          Development Only
        </div>

        {/* Stats */}
        {stats && (
          <div className="row animate-in" style={{ gap: "var(--space-sm)", marginBottom: "var(--space-lg)", flexWrap: "wrap", animationDelay: "60ms" }}>
            {Object.entries(stats.counts).map(([key, val]) => (
              <div key={key} className="card" style={{ flex: "1 1 100px", textAlign: "center", padding: "12px" }}>
                <div style={{ fontSize: "20px", fontWeight: 800, color: "var(--color-gray-600)" }}>{val}</div>
                <div className="text-tiny" style={{ color: "var(--color-gray-400)", textTransform: "capitalize" }}>{key}</div>
              </div>
            ))}
          </div>
        )}

        {/* Navigation */}
        <div className="stack stack-md">
          {links.map(({ href, label, icon: Icon, desc }, i) => (
            <Link key={href} href={href} style={{ textDecoration: "none" }}>
              <div className="card-interactive animate-in" style={{ animationDelay: `${120 + i * 60}ms`, display: "flex", alignItems: "center", gap: "var(--space-md)" }}>
                <div style={{ width: 44, height: 44, borderRadius: "var(--radius-md)", backgroundColor: "var(--color-blue-light)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Icon size={22} color="var(--color-blue)" />
                </div>
                <div>
                  <div style={{ fontWeight: 700, color: "var(--color-gray-600)" }}>{label}</div>
                  <div className="text-small">{desc}</div>
                </div>
              </div>
            </Link>
          ))}
        </div>

        {/* Raw DB Info */}
        {stats && (
          <div className="animate-in" style={{ animationDelay: "360ms", marginTop: "var(--space-xl)" }}>
            <h3 style={{ marginBottom: "var(--space-sm)", color: "var(--color-gray-400)" }}>
              <Database size={16} style={{ display: "inline", verticalAlign: "middle", marginRight: "6px" }} />
              Database Info
            </h3>
            <pre className="card" style={{ fontSize: "12px", overflow: "auto", color: "var(--color-gray-400)", whiteSpace: "pre-wrap" }}>
              {JSON.stringify(stats, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </>
  );
}
