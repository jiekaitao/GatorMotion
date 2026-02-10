"use client";

import { useEffect, useState } from "react";
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
  ReferenceDot,
  ReferenceLine,
} from "recharts";
import { Clock, Repeat, Zap, AlertTriangle, Activity } from "lucide-react";

interface RmsHistoryEntry {
  timeSec: number;
  rms: number;
}

interface CoachingIntervention {
  timeSec: number;
  text: string;
}

interface SessionData {
  completedReps: number;
  durationMs: number;
  repTimestamps: number[];
  painEvents: { timeMs: number; level: string }[];
  formDistribution: { good: number; warning: number; neutral: number };
  rmsHistory?: RmsHistoryEntry[];
  coachingInterventions?: CoachingIntervention[];
}

interface ExerciseReportProps {
  sessionId: string;
}

const COLORS = {
  good: "#58CC02",
  warning: "#FF9600",
  neutral: "#CDCDCD",
  primary: "#02caca",
  pain: "#EA2B2B",
};

export default function ExerciseReport({ sessionId }: ExerciseReportProps) {
  const [data, setData] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/exercise-sessions?id=${sessionId}`);
        if (res.ok) {
          const json = await res.json();
          setData(json.session);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    })();
  }, [sessionId]);

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: "var(--space-xl)", color: "var(--color-gray-300)" }}>
        Loading report...
      </div>
    );
  }

  if (!data) return null;

  const durationSec = Math.round(data.durationMs / 1000);
  const durationMin = Math.floor(durationSec / 60);
  const durationRemSec = durationSec % 60;
  const avgRepSpeed = data.repTimestamps.length > 1
    ? ((data.repTimestamps[data.repTimestamps.length - 1] - data.repTimestamps[0]) / 1000 / (data.repTimestamps.length - 1)).toFixed(1)
    : "\u2014";

  // Build cumulative rep timeline data
  const timelineData = [{ sec: 0, reps: 0 }];
  data.repTimestamps.forEach((t, i) => {
    timelineData.push({ sec: Math.round(t / 1000), reps: i + 1 });
  });
  // Add final point at session end
  if (durationSec > 0) {
    timelineData.push({ sec: durationSec, reps: data.completedReps });
  }

  // Pain events mapped to timeline
  const painDots = data.painEvents.map((e) => ({
    sec: Math.round(e.timeMs / 1000),
    level: e.level,
  }));

  // Pie chart data
  const formData = [
    { name: "Good", value: data.formDistribution.good, color: COLORS.good },
    { name: "Warning", value: data.formDistribution.warning, color: COLORS.warning },
    { name: "Neutral", value: data.formDistribution.neutral, color: COLORS.neutral },
  ].filter((d) => d.value > 0);

  const totalSamples = formData.reduce((s, d) => s + d.value, 0);

  // RMS history for Form Quality Over Time chart
  const rmsHistory = data.rmsHistory || [];
  const coachingInterventions = data.coachingInterventions || [];

  return (
    <div className="report-container">
      {/* Summary Stats */}
      <div className="report-stats">
        <div className="report-stat-card">
          <Clock size={20} color={COLORS.primary} />
          <div>
            <div className="report-stat-value">{durationMin}:{String(durationRemSec).padStart(2, "0")}</div>
            <div className="report-stat-label">Duration</div>
          </div>
        </div>
        <div className="report-stat-card">
          <Repeat size={20} color={COLORS.good} />
          <div>
            <div className="report-stat-value">{data.completedReps}</div>
            <div className="report-stat-label">Total Reps</div>
          </div>
        </div>
        <div className="report-stat-card">
          <Zap size={20} color={COLORS.warning} />
          <div>
            <div className="report-stat-value">{avgRepSpeed}s</div>
            <div className="report-stat-label">Avg Rep</div>
          </div>
        </div>
        <div className="report-stat-card">
          <AlertTriangle size={20} color={COLORS.pain} />
          <div>
            <div className="report-stat-value">{data.painEvents.length}</div>
            <div className="report-stat-label">Pain Events</div>
          </div>
        </div>
      </div>

      {/* Rep Timeline Chart */}
      {timelineData.length > 1 && (
        <div className="report-chart-card">
          <h4 style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-gray-500)", marginBottom: "var(--space-md)" }}>
            Rep Timeline
          </h4>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={timelineData}>
              <defs>
                <linearGradient id="repGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.primary} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={COLORS.primary} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="sec" tickFormatter={(v: number) => `${v}s`} fontSize={11} />
              <YAxis fontSize={11} allowDecimals={false} />
              <Tooltip
                formatter={(value: number | undefined) => [`${value} reps`, "Cumulative"]}
                labelFormatter={(label: unknown) => `${label}s`}
              />
              <Area
                type="stepAfter"
                dataKey="reps"
                stroke={COLORS.primary}
                strokeWidth={2}
                fill="url(#repGrad)"
              />
              {painDots.map((dot, i) => {
                // Find the closest rep count at this time
                const closestPoint = timelineData.reduce((prev, curr) =>
                  Math.abs(curr.sec - dot.sec) < Math.abs(prev.sec - dot.sec) ? curr : prev
                );
                return (
                  <ReferenceDot
                    key={i}
                    x={dot.sec}
                    y={closestPoint.reps}
                    r={5}
                    fill={dot.level === "stop" ? COLORS.pain : COLORS.warning}
                    stroke="white"
                    strokeWidth={2}
                  />
                );
              })}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Form Quality Over Time (RMS Divergence) */}
      {rmsHistory.length > 2 && (
        <div className="report-chart-card">
          <h4 style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-gray-500)", marginBottom: "var(--space-md)", display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
            <Activity size={16} color={COLORS.primary} />
            Form Quality Over Time
          </h4>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={rmsHistory}>
              <defs>
                <linearGradient id="rmsGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={COLORS.warning} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={COLORS.good} stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis
                dataKey="timeSec"
                tickFormatter={(v: number) => `${Math.round(v)}s`}
                fontSize={11}
              />
              <YAxis
                fontSize={11}
                domain={[0, "auto"]}
                tickFormatter={(v: number) => v.toFixed(2)}
              />
              <Tooltip
                formatter={(value: number | undefined) => [Number(value).toFixed(4), "RMS Divergence"]}
                labelFormatter={(label: unknown) => `${Math.round(Number(label))}s`}
              />
              <Area
                type="monotone"
                dataKey="rms"
                stroke={COLORS.primary}
                strokeWidth={2}
                fill="url(#rmsGrad)"
              />
              {/* Coaching threshold line */}
              <ReferenceLine
                y={0.04}
                stroke={COLORS.good}
                strokeDasharray="4 4"
                strokeWidth={1}
                label={{ value: "Good", position: "right", fontSize: 10, fill: COLORS.good }}
              />
              {/* Coaching intervention markers */}
              {coachingInterventions.map((ci, i) => {
                const closest = rmsHistory.reduce((prev, curr) =>
                  Math.abs(curr.timeSec - ci.timeSec) < Math.abs(prev.timeSec - ci.timeSec) ? curr : prev
                );
                return (
                  <ReferenceDot
                    key={`ci-${i}`}
                    x={closest.timeSec}
                    y={closest.rms}
                    r={4}
                    fill={COLORS.warning}
                    stroke="white"
                    strokeWidth={1.5}
                  />
                );
              })}
            </AreaChart>
          </ResponsiveContainer>
          {coachingInterventions.length > 0 && (
            <div style={{ marginTop: "var(--space-sm)", fontSize: "12px", color: "var(--color-gray-300)" }}>
              <span style={{ color: COLORS.warning, fontWeight: 600 }}>{coachingInterventions.length}</span> coaching corrections during session
            </div>
          )}
        </div>
      )}

      {/* Form Quality Pie */}
      {totalSamples > 0 && (
        <div className="report-chart-card">
          <h4 style={{ fontSize: "14px", fontWeight: 700, color: "var(--color-gray-500)", marginBottom: "var(--space-md)" }}>
            Form Quality
          </h4>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "var(--space-xl)" }}>
            <ResponsiveContainer width={160} height={160}>
              <PieChart>
                <Pie
                  data={formData}
                  cx="50%"
                  cy="50%"
                  innerRadius={40}
                  outerRadius={70}
                  paddingAngle={2}
                  dataKey="value"
                  animationBegin={200}
                  animationDuration={800}
                >
                  {formData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
              {formData.map((entry) => (
                <div key={entry.name} style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
                  <div style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: entry.color }} />
                  <span style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-gray-500)" }}>
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
