"use client";

import { useEffect, useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import { UserPlus, Copy, X, Check, Mail, Flame, Clock } from "lucide-react";

interface Patient {
  _id: string;
  name: string;
  email: string;
  createdAt: string;
  streak: { currentStreak: number; longestStreak: number; lastCompletedDate: string | null } | null;
}

interface Invite {
  _id: string;
  patientEmail: string;
  token: string;
  status: string;
  createdAt: string;
  expiresAt: string;
}

export default function TherapistPatientsPage() {
  const router = useRouter();
  const [patients, setPatients] = useState<Patient[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

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

  async function handleSendInvite(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSending(true);

    try {
      const res = await fetch("/api/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientEmail: inviteEmail }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to send invite");
        setSending(false);
        return;
      }

      setInviteEmail("");

      // Show feedback if auto-linked
      if (data.autoLinked) {
        setSuccessMsg(data.message || "Patient linked!");
        setTimeout(() => setSuccessMsg(""), 4000);
      }

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

  async function handleRevoke(token: string) {
    await fetch(`/api/invites/${token}`, { method: "DELETE" });
    setInvites((prev) => prev.map((inv) => inv.token === token ? { ...inv, status: "revoked" } : inv));
  }

  function copyInviteLink(token: string) {
    const link = `${window.location.origin}/register/invite/${token}`;
    navigator.clipboard.writeText(link);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
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
    <AppShell>
      <div className="page">
        <h1 style={{ fontSize: "var(--text-h1)", fontWeight: 800, marginBottom: "var(--space-lg)" }}>My Patients</h1>
        {/* Invite Form */}
        <div className="card animate-in" style={{ marginBottom: "var(--space-lg)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", marginBottom: "var(--space-md)" }}>
            <UserPlus size={20} color="var(--color-blue)" />
            <h3 style={{ fontWeight: 700 }}>Invite a Patient</h3>
          </div>
          <form onSubmit={handleSendInvite} style={{ display: "flex", gap: "var(--space-sm)" }}>
            <input
              type="email"
              className="input"
              placeholder="patient@email.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
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
              <Mail size={16} style={{ display: "inline", verticalAlign: "middle", marginRight: "6px" }} />
              Pending Invites ({pendingInvites.length})
            </h3>
            <div className="stack stack-sm">
              {pendingInvites.map((inv) => (
                <div key={inv._id} className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "var(--text-small)" }}>{inv.patientEmail}</div>
                    <div className="text-tiny" style={{ color: "var(--color-gray-300)" }}>
                      Expires {new Date(inv.expiresAt).toLocaleDateString()}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "var(--space-xs)" }}>
                    <button
                      className="btn btn-secondary"
                      style={{ padding: "6px 10px", fontSize: "12px" }}
                      onClick={() => copyInviteLink(inv.token)}
                    >
                      {copiedToken === inv.token ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                    <button
                      className="btn btn-secondary"
                      style={{ padding: "6px 10px", fontSize: "12px", color: "var(--color-red)" }}
                      onClick={() => handleRevoke(inv.token)}
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
              {patients.map((p) => (
                <div key={p._id} className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontWeight: 700 }}>{p.name}</div>
                    <div className="text-tiny" style={{ color: "var(--color-gray-300)" }}>{p.email}</div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--space-md)", fontSize: "var(--text-small)" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "4px", color: "var(--color-orange)" }}>
                      <Flame size={16} />
                      <span style={{ fontWeight: 700 }}>{p.streak?.currentStreak ?? 0}</span>
                    </div>
                    {p.streak?.lastCompletedDate && (
                      <div style={{ display: "flex", alignItems: "center", gap: "4px", color: "var(--color-gray-300)" }}>
                        <Clock size={14} />
                        <span className="text-tiny">{p.streak.lastCompletedDate}</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
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

        {/* Past Invites */}
        {pastInvites.length > 0 && (
          <div className="animate-in" style={{ animationDelay: "180ms", marginTop: "var(--space-lg)" }}>
            <h3 style={{ color: "var(--color-gray-400)", marginBottom: "var(--space-sm)", fontWeight: 600 }}>
              Past Invites
            </h3>
            <div className="stack stack-sm">
              {pastInvites.map((inv) => (
                <div key={inv._id} className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", opacity: 0.6 }}>
                  <div className="text-small">{inv.patientEmail}</div>
                  <div className="badge" style={{
                    backgroundColor: inv.status === "accepted" ? "var(--color-primary-light)" : "var(--color-gray-100)",
                    color: inv.status === "accepted" ? "var(--color-primary-dark)" : "var(--color-gray-400)",
                  }}>
                    {inv.status}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

    </AppShell>
  );
}
