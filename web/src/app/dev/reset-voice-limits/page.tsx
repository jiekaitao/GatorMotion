"use client";

import { useState } from "react";

export default function ResetVoiceLimitsPage() {
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleReset() {
    setStatus("loading");
    try {
      const res = await fetch("/api/dev/reset-voice-limits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setMessage(data.error || "Request failed");
        return;
      }
      setStatus("success");
      setMessage(`Done! Deleted ${data.deletedCount} usage record(s). Voice limits reset for all users.`);
    } catch {
      setStatus("error");
      setMessage("Network error");
    }
  }

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "var(--color-bg)",
      padding: "var(--space-xl)",
    }}>
      <div className="card" style={{ maxWidth: 420, width: "100%", textAlign: "center" }}>
        <h1 style={{ fontSize: "22px", fontWeight: 800, marginBottom: "var(--space-md)" }}>
          Reset Voice Limits
        </h1>
        <p className="text-small" style={{ marginBottom: "var(--space-lg)", color: "var(--color-gray-300)" }}>
          This deletes all TTS usage records, resetting daily voice limits for every user.
        </p>

        <input
          type="password"
          placeholder="Dev password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleReset()}
          style={{
            width: "100%",
            padding: "var(--space-sm) var(--space-md)",
            borderRadius: "var(--radius-md)",
            border: "2px solid var(--color-gray-100)",
            fontSize: "16px",
            marginBottom: "var(--space-md)",
          }}
        />

        <button
          className="btn btn-primary"
          style={{ width: "100%", height: 48, borderRadius: "var(--radius-xl)", fontWeight: 700 }}
          onClick={handleReset}
          disabled={status === "loading" || !password}
        >
          {status === "loading" ? "Resetting..." : "Reset All Voice Limits"}
        </button>

        {status === "success" && (
          <p style={{ marginTop: "var(--space-md)", color: "var(--color-green)", fontWeight: 600 }}>
            {message}
          </p>
        )}
        {status === "error" && (
          <p style={{ marginTop: "var(--space-md)", color: "var(--color-red)", fontWeight: 600 }}>
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
