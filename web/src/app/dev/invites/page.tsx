"use client";

import { useEffect, useState, FormEvent } from "react";

interface Invite {
  _id: string;
  therapistId: string;
  therapistName: string;
  patientUsername: string;
  status: string;
  createdAt: string;
}

export default function DevInvitesPage() {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [username, setUsername] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchInvites();
  }, []);

  async function fetchInvites() {
    try {
      const res = await fetch("/api/invites");
      const data = await res.json();
      setInvites(data.invites || []);
    } catch {
      /* ignore */
    }
  }

  async function handleCreate(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSending(true);

    try {
      const res = await fetch("/api/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim() }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed — are you logged in as a therapist?");
        setSending(false);
        return;
      }

      setUsername("");
      fetchInvites();
    } catch {
      setError("Something went wrong");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <div className="page">
        <h1 style={{ fontSize: "var(--text-h1)", fontWeight: 800, marginBottom: "var(--space-lg)" }}>Dev: Invites</h1>
        <div className="badge badge-orange animate-in" style={{ marginBottom: "var(--space-lg)" }}>
          Development Only
        </div>

        {/* Create Invite */}
        <div className="card animate-in" style={{ animationDelay: "60ms", marginBottom: "var(--space-lg)" }}>
          <h3 style={{ fontWeight: 700, marginBottom: "var(--space-sm)" }}>Create Test Invite</h3>
          <p className="text-tiny" style={{ color: "var(--color-gray-400)", marginBottom: "var(--space-md)" }}>
            Must be logged in as a therapist
          </p>
          <form onSubmit={handleCreate} style={{ display: "flex", gap: "var(--space-sm)" }}>
            <input
              type="text"
              className="input"
              placeholder="patient username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              style={{ flex: 1 }}
            />
            <button type="submit" className="btn btn-blue" disabled={sending}>
              {sending ? "..." : "Create"}
            </button>
          </form>
          {error && (
            <p style={{ color: "var(--color-red)", fontSize: "14px", fontWeight: 600, marginTop: "var(--space-sm)" }}>{error}</p>
          )}
        </div>

        {/* All Invites */}
        <div className="animate-in" style={{ animationDelay: "120ms" }}>
          <h3 style={{ color: "var(--color-gray-400)", marginBottom: "var(--space-sm)", fontWeight: 600 }}>
            All Invites ({invites.length})
          </h3>
          {invites.length > 0 ? (
            <div className="stack stack-sm">
              {invites.map((inv) => (
                <div key={inv._id} className="card" style={{ fontSize: "var(--text-small)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-xs)" }}>
                    <span style={{ fontWeight: 700 }}>{inv.patientUsername}</span>
                    <div className="badge" style={{
                      backgroundColor: inv.status === "pending" ? "var(--color-blue-light)" : inv.status === "accepted" ? "var(--color-primary-light)" : "var(--color-gray-100)",
                      color: inv.status === "pending" ? "var(--color-blue)" : inv.status === "accepted" ? "var(--color-primary-dark)" : "var(--color-gray-400)",
                    }}>
                      {inv.status}
                    </div>
                  </div>
                  <div className="text-tiny" style={{ color: "var(--color-gray-300)" }}>
                    From: {inv.therapistName} &middot; Created: {new Date(inv.createdAt).toLocaleDateString()}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="card text-center" style={{ padding: "var(--space-xl)" }}>
              <p className="text-small" style={{ color: "var(--color-gray-300)" }}>No invites yet.</p>
            </div>
          )}
        </div>
      </div>

    </>
  );
}
