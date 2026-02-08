"use client";

import { useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
} from "recharts";
import { Flame, CheckCircle2, Activity, AlertTriangle, ChevronDown, Clock } from "lucide-react";

const COLORS = {
  good: "#58CC02",
  warning: "#FF9600",
  neutral: "#CDCDCD",
  primary: "#02caca",
  pain: "#EA2B2B",
};

interface SessionData {
  _id: string;
  exerciseName: string;
  completedReps: number;
  reps: number;
  sets: number;
  durationMs: number;
  repTimestamps: number[];
  painEvents: { timeMs: number; level: string }[];
  formDistribution: { good: number; warning: number; neutral: number };
  createdAt: string;
}

interface AssignmentData {
  _id: string;
  date: string;
  exercises: { exerciseId: string; exerciseName: string; completed: boolean }[];
  allCompleted: boolean;
}

interface StreakData {
  currentStreak: number;
  longestStreak: number;
}

interface Props {
  sessions: SessionData[];
  assignments: AssignmentData[];
  streak: StreakData;
  patientName: string;
}

export default function PatientActivityTab({ sessions, assignments, streak, patientName }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const completedAssignments = assignments.filter((a) => a.allCompleted).length;
  const complianceRate = assignments.length > 0
    ? Math.round((completedAssignments / assignments.length) * 100)
    : 0;
  const totalPainEvents = sessions.reduce((sum, s) => sum + s.painEvents.length, 0);

  // Group sessions by date
  const grouped: Record<string, SessionData[]> = {};
  for (const s of sessions) {
    const dateKey = new Date(s.createdAt).toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    if (!grouped[dateKey]) grouped[dateKey] = [];
    grouped[dateKey].push(s);
  }

  if (sessions.length === 0 && assignments.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "var(--space-xl) 0", color: "var(--color-gray-300)" }}>
        <Activity size={48} style={{ marginBottom: "var(--space-md)", opacity: 0.3 }} />
        <p style={{ fontWeight: 700, fontSize: "18px" }}>No activity yet</p>
        <p style={{ fontSize: "14px", marginTop: 6, color: "var(--color-gray-200)" }}>
          {patientName.split(" ")[0]} hasn&apos;t completed any exercises yet.
        </p>
      </div>
    );
  }

  return (
    <div className="report-container animate-in">
      {/* Summary stats */}
      <div className="report-stats">
        <div className="report-stat-card">
          <Flame size={20} color={COLORS.warning} />
          <div>
            <div className="report-stat-value">{streak.currentStreak}</div>
            <div className="report-stat-label">Current Streak<br />Best: {streak.longestStreak}</div>
          </div>
        </div>
        <div className="report-stat-card">
          <CheckCircle2 size={20} color={COLORS.good} />
          <div>
            <div className="report-stat-value">{complianceRate}%</div>
            <div className="report-stat-label">Compliance ({completedAssignments}/{assignments.length})</div>
          </div>
        </div>
        <div className="report-stat-card">
          <Activity size={20} color={COLORS.primary} />
          <div>
            <div className="report-stat-value">{sessions.length}</div>
            <div className="report-stat-label">Sessions Completed</div>
          </div>
        </div>
        <div className="report-stat-card">
          <AlertTriangle size={20} color={COLORS.pain} />
          <div>
            <div className="report-stat-value">{totalPainEvents}</div>
            <div className="report-stat-label">Distress Events</div>
          </div>
        </div>
      </div>

      {/* Session history grouped by date */}
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-lg)" }}>
        {Object.entries(grouped).map(([dateLabel, dateSessions]) => (
          <div key={dateLabel}>
            <h4 style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-gray-300)", marginBottom: "var(--space-sm)", textTransform: "uppercase", letterSpacing: "0.03em" }}>
              {dateLabel}
            </h4>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
              {dateSessions.map((s) => {
                const isExpanded = expandedId === s._id;
                const durationSec = Math.round(s.durationMs / 1000);
                const durationMin = Math.floor(durationSec / 60);
                const durationRemSec = durationSec % 60;
                const totalForm = s.formDistribution.good + s.formDistribution.warning + s.formDistribution.neutral;
                const goodPct = totalForm > 0 ? Math.round((s.formDistribution.good / totalForm) * 100) : 0;
                const warnPct = totalForm > 0 ? Math.round((s.formDistribution.warning / totalForm) * 100) : 0;

                return (
                  <div key={s._id}>
                    <div
                      className="session-card-expandable"
                      onClick={() => setExpandedId(isExpanded ? null : s._id)}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-md)", flexWrap: "wrap" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          <span style={{ fontWeight: 700, fontSize: "16px" }}>{s.exerciseName}</span>
                          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-md)", fontSize: "13px", color: "var(--color-gray-400)", fontWeight: 600 }}>
                            <span>{s.completedReps}/{s.reps * s.sets} reps</span>
                            <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                              <Clock size={12} /> {durationMin}:{String(durationRemSec).padStart(2, "0")}
                            </span>
                          </div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
                          {s.painEvents.length > 0 && (
                            <span className="badge-red" style={{ padding: "3px 10px", borderRadius: 20, fontSize: "12px", fontWeight: 700 }}>
                              {s.painEvents.length} distress
                            </span>
                          )}
                          {/* Mini form quality bar */}
                          {totalForm > 0 && (
                            <div style={{ display: "flex", width: 60, height: 8, borderRadius: 4, overflow: "hidden" }}>
                              <div style={{ width: `${goodPct}%`, backgroundColor: COLORS.good }} />
                              <div style={{ width: `${warnPct}%`, backgroundColor: COLORS.warning }} />
                              <div style={{ flex: 1, backgroundColor: COLORS.neutral }} />
                            </div>
                          )}
                          <ChevronDown
                            size={16}
                            color="var(--color-gray-300)"
                            style={{ transform: isExpanded ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.2s" }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div className="animate-in" style={{ padding: "var(--space-lg)", display: "flex", flexDirection: "column", gap: "var(--space-lg)" }}>
                        <SessionDetailCharts session={s} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SessionDetailCharts({ session }: { session: SessionData }) {
  const durationSec = Math.round(session.durationMs / 1000);

  // Rep timeline
  const timelineData = [{ sec: 0, reps: 0 }];
  session.repTimestamps.forEach((t, i) => {
    timelineData.push({ sec: Math.round(t / 1000), reps: i + 1 });
  });
  if (durationSec > 0) {
    timelineData.push({ sec: durationSec, reps: session.completedReps });
  }

  // Form pie data
  const formData = [
    { name: "Good", value: session.formDistribution.good, color: COLORS.good },
    { name: "Warning", value: session.formDistribution.warning, color: COLORS.warning },
    { name: "Neutral", value: session.formDistribution.neutral, color: COLORS.neutral },
  ].filter((d) => d.value > 0);
  const totalSamples = formData.reduce((s, d) => s + d.value, 0);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--space-lg)" }}>
      {/* Rep timeline */}
      {timelineData.length > 1 && (
        <div className="report-chart-card">
          <h4 style={{ fontSize: "13px", fontWeight: 700, color: "var(--color-gray-500)", marginBottom: "var(--space-sm)" }}>
            Rep Timeline
          </h4>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={timelineData}>
              <defs>
                <linearGradient id={`repGrad-${session._id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.primary} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={COLORS.primary} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="sec" tickFormatter={(v) => `${v}s`} fontSize={10} />
              <YAxis fontSize={10} allowDecimals={false} />
              <Tooltip
                formatter={(value) => [`${value} reps`, "Cumulative"]}
                labelFormatter={(label) => `${label}s`}
              />
              <Area
                type="stepAfter"
                dataKey="reps"
                stroke={COLORS.primary}
                strokeWidth={2}
                fill={`url(#repGrad-${session._id})`}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Form quality pie */}
      {totalSamples > 0 && (
        <div className="report-chart-card">
          <h4 style={{ fontSize: "13px", fontWeight: 700, color: "var(--color-gray-500)", marginBottom: "var(--space-sm)" }}>
            Form Quality
          </h4>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "var(--space-lg)" }}>
            <ResponsiveContainer width={120} height={120}>
              <PieChart>
                <Pie
                  data={formData}
                  cx="50%"
                  cy="50%"
                  innerRadius={30}
                  outerRadius={55}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {formData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {formData.map((entry) => (
                <div key={entry.name} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: entry.color }} />
                  <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-gray-500)" }}>
                    {entry.name} ({Math.round((entry.value / totalSamples) * 100)}%)
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
