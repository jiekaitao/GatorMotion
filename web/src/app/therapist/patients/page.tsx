"use client";

import { useEffect, useState, useCallback, FormEvent } from "react";
import { useRouter } from "next/navigation";

import { UserPlus, X, Clock, Trash2 } from "lucide-react";

interface AssignmentExercise {
  exerciseId: string;
  exerciseName: string;
  completed: boolean;
}

interface Patient {
  _id: string;
  name: string;
  username: string;
  createdAt: string;
  streak: { currentStreak: number; longestStreak: number; lastCompletedDate: string | null } | null;
  todayAssignment?: { exercises: AssignmentExercise[] } | null;
}

interface Invite {
  _id: string;
  patientUsername: string;
  status: string;
  createdAt: string;
}

export default function TherapistPatientsPage() {
  const router = useRouter();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteUsername, setInviteUsername] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  const refreshData = useCallback(async () => {
    try {
      const [pRes, iRes] = await Promise.all([
        fetch("/api/patients"),
        fetch("/api/invites"),
      ]);
      const pData = await pRes.json();
      const iData = await iRes.json();
      setPatients(pData.patients || []);
      setInvites(iData.invites || []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    Promise.all([
      fetch("/api/patients").then((r) => r.json()),
      fetch("/api/invites").then((r) => r.json()),
      fetch("/api/auth/me").then((r) => {
        if (!r.ok) throw new Error("Not authed");
        return r.json();
      }),
    ])
      .then(([pData, iData]) => {
        setPatients(pData.patients || []);
        setInvites(iData.invites || []);
      })
      .catch(() => {
        router.replace("/login");
      })
      .finally(() => setLoading(false));
  }, [router]);

  // Auto-refresh when invite events happen (e.g. patient accepts from bell)
  useEffect(() => {
    const handler = () => refreshData();
    window.addEventListener("invite-responded", handler);
    return () => window.removeEventListener("invite-responded", handler);
  }, [refreshData]);

  // Poll for updates every 10 seconds (so PT side sees accepts from patient side)
  useEffect(() => {
    const interval = setInterval(refreshData, 10000);
    return () => clearInterval(interval);
  }, [refreshData]);

  async function handleSendInvite(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSuccessMsg("");
    setSending(true);

    try {
      const res = await fetch("/api/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: inviteUsername.trim() }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to send invite");
        setSending(false);
        return;
      }

      setInviteUsername("");
      setSuccessMsg("Invite sent!");
      setTimeout(() => setSuccessMsg(""), 4000);

      // Refresh invites + patients
      const [iRes, pRes] = await Promise.all([
        fetch("/api/invites"),
        fetch("/api/patients"),
      ]);
      const iData = await iRes.json();
      const pData = await pRes.json();
      setInvites(iData.invites || []);
      setPatients(pData.patients || []);
    } catch {
      setError("Something went wrong");
    } finally {
      setSending(false);
    }
  }

  async function handleRevoke(inviteId: string) {
    await fetch(`/api/invites/${inviteId}`, { method: "DELETE" });
    setInvites((prev) => prev.map((inv) => inv._id === inviteId ? { ...inv, status: "revoked" } : inv));
  }

  async function handleRemovePatient(patientId: string) {
    try {
      const res = await fetch(`/api/relationships/${patientId}`, { method: "DELETE" });
      if (res.ok) {
        setPatients((prev) => prev.filter((p) => p._id !== patientId));
      }
    } catch {
      // ignore
    }
  }

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "var(--color-gray-300)" }}>
        Loading...
      </div>
    );
  }

  const pendingInvites = invites.filter((i) => i.status === "pending");
  const pastInvites = invites.filter((i) => i.status !== "pending");

  return (
    <>
      <div className="page">
        <h1 style={{ fontSize: "var(--text-h1)", fontWeight: 800, marginBottom: "var(--space-lg)" }}>My Patients</h1>
        {/* Invite Form */}
        <div className="card animate-in" style={{ marginBottom: "var(--space-lg)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-md)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
              <UserPlus size={20} color="var(--color-blue)" />
              <h3 style={{ fontWeight: 700 }}>Invite a Patient</h3>
            </div>
            <button
                onClick={() => setShowHistory(true)}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--color-blue)",
                  fontSize: "14px",
                  fontWeight: 600,
                  cursor: "pointer",
                  textDecoration: "underline",
                  padding: 0,
                }}
              >
                View Invite History
              </button>
          </div>
          <form onSubmit={handleSendInvite} style={{ display: "flex", gap: "var(--space-sm)" }}>
            <input
              type="text"
              className="input"
              placeholder="patient username"
              value={inviteUsername}
              onChange={(e) => setInviteUsername(e.target.value)}
              required
              style={{ flex: 1 }}
            />
            <button type="submit" className="btn btn-blue" disabled={sending}>
              {sending ? "..." : "Send"}
            </button>
          </form>
          {error && (
            <p style={{ color: "var(--color-red)", fontSize: "14px", fontWeight: 600, marginTop: "var(--space-sm)" }}>{error}</p>
          )}
          {successMsg && (
            <p style={{ color: "var(--color-green-dark)", fontSize: "14px", fontWeight: 600, marginTop: "var(--space-sm)", backgroundColor: "var(--color-green-surface)", padding: "8px 12px", borderRadius: "var(--radius-sm)" }}>{successMsg}</p>
          )}
        </div>

        {/* Pending Invites */}
        {pendingInvites.length > 0 && (
          <div className="animate-in" style={{ animationDelay: "60ms", marginBottom: "var(--space-lg)" }}>
            <h3 style={{ color: "var(--color-gray-400)", marginBottom: "var(--space-sm)", fontWeight: 600 }}>
              <Clock size={16} style={{ display: "inline", verticalAlign: "middle", marginRight: "6px" }} />
              Pending Invites ({pendingInvites.length})
            </h3>
            <div className="stack stack-sm">
              {pendingInvites.map((inv) => (
                <div key={inv._id} className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "var(--text-small)" }}>{inv.patientUsername}</div>
                    <div className="text-tiny" style={{ color: "var(--color-gray-300)" }}>
                      Sent {new Date(inv.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "var(--space-xs)" }}>
                    <button
                      className="btn btn-secondary"
                      style={{ padding: "6px 10px", fontSize: "12px", color: "var(--color-red)" }}
                      onClick={() => handleRevoke(inv._id)}
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Patient List */}
        <div className="animate-in" style={{ animationDelay: "120ms" }}>
          <h3 style={{ color: "var(--color-gray-400)", marginBottom: "var(--space-sm)", fontWeight: 600 }}>
            Patients ({patients.length})
          </h3>
          {patients.length > 0 ? (
            <div className="stack stack-sm">
              {patients.map((p) => {
                const exercises = p.todayAssignment?.exercises || [];
                return (
                <div
                  key={p._id}
                  className="card-interactive"
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}
                  onClick={() => router.push(`/therapist/patients/${p._id}`)}
                >
                  <div>
                    <div style={{ fontWeight: 700 }}>{p.name}</div>
                    <div className="text-tiny" style={{ color: "var(--color-gray-300)" }}>@{p.username}</div>
                    {exercises.length > 0 && (
                      <div className="exercise-indicators" style={{ marginTop: 6 }}>
                        {exercises.map((ex, i) => (
                          <div
                            key={i}
                            style={{
                              width: 24,
                              height: 4,
                              borderRadius: 2,
                              backgroundColor: ex.completed ? "var(--color-green)" : "var(--color-gray-200)",
                            }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
                    <button
                      className="btn btn-secondary"
                      style={{ padding: "6px 10px", fontSize: "12px", color: "var(--color-red)" }}
                      onClick={(e) => { e.stopPropagation(); handleRemovePatient(p._id); }}
                      title="Remove patient"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                );
              })}
            </div>
          ) : (
            <div className="card text-center" style={{ padding: "var(--space-xl)" }}>
              <p style={{ color: "var(--color-gray-300)", fontWeight: 600 }}>
                No patients yet.
              </p>
              <p className="text-small" style={{ marginTop: "var(--space-sm)" }}>
                Send an invite above to get started.
              </p>
            </div>
          )}
        </div>

      </div>

      {/* Invite History Modal */}
      {showHistory && (
        <div
          onClick={() => setShowHistory(false)}
          style={{
            position: "fixed",
            inset: 0,
            backgroundColor: "rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
            padding: "var(--space-md)",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "var(--color-surface)",
              borderRadius: "var(--radius-lg)",
              width: "100%",
              maxWidth: 480,
              maxHeight: "70vh",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "var(--space-md) var(--space-lg)" }}>
              <h3 style={{ fontWeight: 700 }}>Invite History</h3>
              <button
                onClick={() => setShowHistory(false)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-gray-400)", padding: 4 }}
              >
                <X size={20} />
              </button>
            </div>
            <div style={{ overflowY: "auto", padding: "0 var(--space-lg) var(--space-lg)" }}>
              {pastInvites.length > 0 ? (
                <div className="stack stack-sm">
                  {pastInvites.map((inv) => (
                    <div key={inv._id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--color-gray-100)" }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: "var(--text-small)" }}>{inv.patientUsername}</div>
                        <div className="text-tiny" style={{ color: "var(--color-gray-300)" }}>
                          {new Date(inv.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                      <div className="badge" style={{
                        backgroundColor: inv.status === "accepted" ? "var(--color-primary-light)" : "var(--color-gray-100)",
                        color: inv.status === "accepted" ? "var(--color-primary-dark)" : "var(--color-gray-400)",
                      }}>
                        {inv.status}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p style={{ color: "var(--color-gray-300)", textAlign: "center", padding: "var(--space-lg) 0" }}>
                  No past invites yet.
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
