"use client";

import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { CheckCircle2, TrendingUp, AlertTriangle, CalendarDays } from "lucide-react";

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
  history: string[];
}

interface Props {
  sessions: SessionData[];
  assignments: AssignmentData[];
  streak: StreakData;
  patientName: string;
}

export default function PatientReportsTab({ sessions, assignments, streak, patientName }: Props) {
  if (sessions.length === 0 && assignments.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "var(--space-xl) 0", color: "var(--color-gray-300)" }}>
        <TrendingUp size={48} style={{ marginBottom: "var(--space-md)", opacity: 0.3 }} />
        <p style={{ fontWeight: 700, fontSize: "18px" }}>No data for reports</p>
        <p style={{ fontSize: "14px", marginTop: 6, color: "var(--color-gray-200)" }}>
          Reports will appear once {patientName.split(" ")[0]} starts completing exercises.
        </p>
      </div>
    );
  }

  // -- Compliance over time --
  const sortedAssignments = [...assignments].sort((a, b) => a.date.localeCompare(b.date));
  const complianceData = sortedAssignments.map((a) => {
    const completed = a.exercises.filter((e) => e.completed).length;
    const total = a.exercises.length;
    return {
      date: formatDateShort(a.date),
      pct: total > 0 ? Math.round((completed / total) * 100) : 0,
    };
  });

  // -- Form quality trend --
  const sortedSessions = [...sessions].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
  const formTrendData = sortedSessions.map((s) => {
    const total = s.formDistribution.good + s.formDistribution.warning + s.formDistribution.neutral;
    return {
      date: formatDateShort(new Date(s.createdAt).toISOString().split("T")[0]),
      good: total > 0 ? Math.round((s.formDistribution.good / total) * 100) : 0,
      warning: total > 0 ? Math.round((s.formDistribution.warning / total) * 100) : 0,
      neutral: total > 0 ? Math.round((s.formDistribution.neutral / total) * 100) : 0,
    };
  });

  // -- Distress events timeline --
  const painData = sortedSessions.map((s) => ({
    date: formatDateShort(new Date(s.createdAt).toISOString().split("T")[0]),
    name: s.exerciseName,
    count: s.painEvents.length,
  }));
  const hasPain = painData.some((d) => d.count > 0);

  // -- Activity calendar (last 35 days) --
  const calendarDays = buildCalendar(assignments, streak.history);

  return (
    <div className="report-container animate-in">
      {/* Compliance over time */}
      {complianceData.length > 0 && (
        <div className="report-chart-card">
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", marginBottom: "var(--space-md)" }}>
            <CheckCircle2 size={18} color={COLORS.good} />
            <h4 style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-gray-500)", margin: 0 }}>
              Compliance Over Time
            </h4>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={complianceData}>
              <defs>
                <linearGradient id="complianceGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.good} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={COLORS.good} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="date" fontSize={11} />
              <YAxis domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} fontSize={11} />
              <Tooltip formatter={(value: number | undefined) => [`${value}%`, "Completion"]} />
              <Area
                type="monotone"
                dataKey="pct"
                stroke={COLORS.good}
                strokeWidth={2}
                fill="url(#complianceGrad)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Form quality trend */}
      {formTrendData.length > 0 && (
        <div className="report-chart-card">
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", marginBottom: "var(--space-md)" }}>
            <TrendingUp size={18} color={COLORS.primary} />
            <h4 style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-gray-500)", margin: 0 }}>
              Form Quality Trend
            </h4>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={formTrendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="date" fontSize={11} />
              <YAxis domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} fontSize={11} />
              <Tooltip formatter={(value: number | undefined, name: string | undefined) => [`${value}%`, String(name)]} />
              <Area type="monotone" dataKey="good" stackId="1" stroke={COLORS.good} fill={COLORS.good} fillOpacity={0.6} />
              <Area type="monotone" dataKey="warning" stackId="1" stroke={COLORS.warning} fill={COLORS.warning} fillOpacity={0.6} />
              <Area type="monotone" dataKey="neutral" stackId="1" stroke={COLORS.neutral} fill={COLORS.neutral} fillOpacity={0.6} />
            </AreaChart>
          </ResponsiveContainer>
          <div style={{ display: "flex", gap: "var(--space-lg)", marginTop: "var(--space-sm)", justifyContent: "center" }}>
            {[
              { label: "Good", color: COLORS.good },
              { label: "Warning", color: COLORS.warning },
              { label: "Neutral", color: COLORS.neutral },
            ].map((item) => (
              <div key={item.label} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <div style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: item.color }} />
                <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-gray-400)" }}>{item.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Distress events timeline */}
      <div className="report-chart-card">
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", marginBottom: "var(--space-md)" }}>
          <AlertTriangle size={18} color={COLORS.pain} />
          <h4 style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-gray-500)", margin: 0 }}>
            Distress Events
          </h4>
        </div>
        {hasPain ? (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={painData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="date" fontSize={11} />
              <YAxis allowDecimals={false} fontSize={11} />
              <Tooltip
                formatter={(value: number | undefined) => [`${value}`, "Distress events"]}
                labelFormatter={(label: unknown) => `${label}`}
              />
              <Bar dataKey="count" fill={COLORS.pain} radius={[4, 4, 0, 0]} maxBarSize={30} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div style={{ textAlign: "center", padding: "var(--space-lg)", color: COLORS.good, fontWeight: 700, fontSize: "15px" }}>
            No distress events recorded
          </div>
        )}
      </div>

      {/* Activity calendar */}
      <div className="report-chart-card">
        <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", marginBottom: "var(--space-md)" }}>
          <CalendarDays size={18} color={COLORS.primary} />
          <h4 style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-gray-500)", margin: 0 }}>
            Activity Calendar
          </h4>
        </div>
        {/* Day-of-week headers */}
        <div className="activity-calendar" style={{ marginBottom: 2 }}>
          {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
            <div key={i} style={{ textAlign: "center", fontSize: "11px", fontWeight: 700, color: "var(--color-gray-300)", padding: "2px 0" }}>
              {d}
            </div>
          ))}
        </div>
        <div className="activity-calendar">
          {calendarDays.map((day, i) => (
            <div
              key={i}
              className={`activity-day ${day.className}`}
              title={day.date || ""}
            >
              {day.label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

interface CalendarDay {
  date: string | null;
  label: string;
  className: string;
}

function buildCalendar(
  assignments: AssignmentData[],
  streakHistory: string[]
): CalendarDay[] {
  const today = new Date();
  // Start 34 days ago (5 weeks)
  const start = new Date(today);
  start.setDate(start.getDate() - 34);
  // Align to start of week (Sunday)
  start.setDate(start.getDate() - start.getDay());

  const assignmentMap = new Map<string, AssignmentData>();
  for (const a of assignments) {
    assignmentMap.set(a.date, a);
  }
  const streakSet = new Set(streakHistory);

  const days: CalendarDay[] = [];
  const cursor = new Date(start);

  while (cursor <= today) {
    const dateStr = cursor.toISOString().split("T")[0];
    const dayNum = cursor.getDate();
    const assignment = assignmentMap.get(dateStr);

    let className = "activity-day-empty";
    if (assignment) {
      if (assignment.allCompleted) {
        className = "activity-day-done";
      } else if (assignment.exercises.some((e) => e.completed)) {
        className = "activity-day-partial";
      } else {
        className = "activity-day-missed";
      }
    } else if (streakSet.has(dateStr)) {
      className = "activity-day-done";
    }

    days.push({ date: dateStr, label: String(dayNum), className });
    cursor.setDate(cursor.getDate() + 1);
  }

  return days;
}
