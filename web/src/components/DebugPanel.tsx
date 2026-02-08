"use client";

import { useState } from "react";
import { Bug } from "lucide-react";

interface RmsHistoryEntry {
  timeSec: number;
  rms: number;
}

interface DebugPanelProps {
  painLevel: string;
  ear: number;
  mar: number;
  repCount: number;
  repState: string;
  angle: number;
  formQuality: string;
  wsConnected: boolean;
  rmsDiv?: number;
  rmsHistory?: RmsHistoryEntry[];
  coachingMessageCount?: number;
}

const PAIN_COLORS: Record<string, string> = {
  normal: "#58CC02",
  warning: "#FF9600",
  stop: "#EA2B2B",
};

function RmsSparkline({ data }: { data: RmsHistoryEntry[] }) {
  if (data.length < 2) return null;
  const w = 120;
  const h = 32;
  const maxRms = Math.max(0.15, ...data.map((d) => d.rms));
  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - (d.rms / maxRms) * h;
    return `${x},${y}`;
  });
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke="#02caca"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function DebugPanel({
  painLevel,
  ear,
  mar,
  repCount,
  repState,
  angle,
  formQuality,
  wsConnected,
  rmsDiv = 0,
  rmsHistory = [],
  coachingMessageCount = 0,
}: DebugPanelProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        className="debug-toggle"
        onClick={() => setOpen((v) => !v)}
        title="Debug Panel"
      >
        <Bug size={18} color="white" />
      </button>

      {open && (
        <div className="debug-panel">
          <div style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#999", marginBottom: 8 }}>
            Debug
          </div>

          <Row label="Pain Level">
            <span style={{ color: PAIN_COLORS[painLevel] || "#ccc", fontWeight: 700 }}>
              {painLevel}
            </span>
          </Row>

          <Row label="EAR">
            <span>{ear.toFixed(4)}</span>
            <span style={{ color: "#666", fontSize: "10px", marginLeft: 4 }}>
              {ear < 0.21 ? "(closed)" : "(open)"}
            </span>
          </Row>

          <Row label="MAR">
            <span>{mar.toFixed(4)}</span>
            <span style={{ color: "#666", fontSize: "10px", marginLeft: 4 }}>
              {mar > 0.6 ? "(open)" : "(closed)"}
            </span>
          </Row>

          <Row label="Rep State">
            <span style={{ color: "#02caca" }}>{repState}</span>
          </Row>

          <Row label="Angle">
            <span>{angle.toFixed(1)}&deg;</span>
          </Row>

          <Row label="Form">
            <span style={{
              color: formQuality === "good" ? "#58CC02" : formQuality === "warning" ? "#FF9600" : "#999",
            }}>
              {formQuality}
            </span>
          </Row>

          <Row label="WS">
            <span style={{ color: wsConnected ? "#58CC02" : "#EA2B2B" }}>
              {wsConnected ? "connected" : "offline"}
            </span>
          </Row>

          <Row label="Reps">
            <span style={{ fontWeight: 700 }}>{repCount}</span>
          </Row>

          {/* Coaching / RMS section */}
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.1)", marginTop: 6, paddingTop: 6 }}>
            <div style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: "#999", marginBottom: 6 }}>
              Coaching
            </div>

            <Row label="RMS Div">
              <span style={{
                fontWeight: 700,
                color: rmsDiv < 0.04 ? "#58CC02" : rmsDiv < 0.1 ? "#FF9600" : "#EA2B2B",
              }}>
                {rmsDiv.toFixed(4)}
              </span>
            </Row>

            <Row label="Coach Msgs">
              <span style={{ fontWeight: 700 }}>{coachingMessageCount}</span>
            </Row>

            {rmsHistory.length > 1 && (
              <div style={{ marginTop: 6 }}>
                <span style={{ color: "#888", fontSize: "10px" }}>RMS Over Time</span>
                <RmsSparkline data={rmsHistory} />
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "3px 0",
      borderBottom: "1px solid rgba(255,255,255,0.06)",
    }}>
      <span style={{ color: "#888", fontSize: "12px" }}>{label}</span>
      <span style={{ fontSize: "12px", fontFamily: "monospace" }}>{children}</span>
    </div>
  );
}
