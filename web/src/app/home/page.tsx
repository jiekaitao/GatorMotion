"use client";

import { useEffect, useState, useCallback, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import {
  Users,
  Play,
  Check,
  Lock,
  Dumbbell,
  MessageCircle,
  User,
  UserPlus,
  Flame,
  ChevronDown,
  ChevronUp,
  Calendar,
  Clock,
  X,
  Trash2,
} from "lucide-react";

interface Exercise {
  exerciseId: string;
  exerciseName: string;
  sets: number;
  reps: number;
  holdSec: number;
  completed: boolean;
  exerciseKey?: string;
  skeletonDataFile?: string;
}

interface Assignment {
  _id: string;
  exercises: Exercise[];
  allCompleted: boolean;
  date: string;
}

interface Conversation {
  partnerId: string;
  partnerName: string;
  partnerRole: string;
  lastMessage: { content: string; createdAt: string; senderId: string } | null;
  unreadCount: number;
}

interface Patient {
  _id: string;
  name: string;
  username: string;
  streak: { currentStreak: number; lastCompletedDate: string | null } | null;
}

interface Invite {
  _id: string;
  patientUsername: string;
  status: string;
}

interface UserData {
  user: { id: string; name: string; username: string; role: string; hasTherapist?: boolean; notificationCount?: number };
  streak: { currentStreak: number; longestStreak: number; lastCompletedDate: string | null };
}

function formatAssignmentDate(dateStr: string): string {
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split("T")[0];

  if (dateStr === todayStr) return "Today";
  if (dateStr === yesterdayStr) return "Yesterday";

  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export default function HomePage() {
  const router = useRouter();
  const [userData, setUserData] = useState<UserData | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [pastAssignments, setPastAssignments] = useState<Assignment[]>([]);
  const [showPast, setShowPast] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteUsername, setInviteUsername] = useState("");
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState("");
  const [showInviteHistory, setShowInviteHistory] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [meRes, assignRes, msgRes] = await Promise.all([
        fetch("/api/auth/me"),
        fetch("/api/assignments?view=incomplete"),
        fetch("/api/messages"),
      ]);

      if (!meRes.ok) {
        router.replace("/login");
        return;
      }

      const meData = await meRes.json();
      const assignData = await assignRes.json();
      if (msgRes.ok) {
        const msgData = await msgRes.json();
        setConversations(msgData.conversations || []);
      }

      setUserData(meData);
      setAssignments(assignData.assignments || []);

      // Therapist: also fetch patients + invites
      if (meData.user?.role === "therapist") {
        const [pRes, iRes] = await Promise.all([
          fetch("/api/patients"),
          fetch("/api/invites"),
        ]);
        if (pRes.ok) {
          const pData = await pRes.json();
          setPatients(pData.patients || []);
        }
        if (iRes.ok) {
          const iData = await iRes.json();
          setInvites(iData.invites || []);
        }
      }
    } catch {
      router.replace("/login");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Poll conversations every 5 seconds so message previews stay fresh
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch("/api/messages");
        if (res.ok) {
          const data = await res.json();
          setConversations(data.conversations || []);
        }
      } catch { /* ignore */ }
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // Re-fetch immediately when an invite is accepted/declined
  useEffect(() => {
    const handler = () => fetchData();
    window.addEventListener("invite-responded", handler);
    return () => window.removeEventListener("invite-responded", handler);
  }, [fetchData]);

  // Fetch past assignments on demand
  const handleTogglePast = async () => {
    if (!showPast && pastAssignments.length === 0) {
      try {
        const res = await fetch("/api/assignments?view=past");
        if (res.ok) {
          const data = await res.json();
          setPastAssignments(data.assignments || []);
        }
      } catch { /* ignore */ }
    }
    setShowPast((v) => !v);
  };

  async function handleSendInvite(e: FormEvent) {
    e.preventDefault();
    setInviteError("");
    setInviteSuccess("");
    setInviteSending(true);
    try {
      const res = await fetch("/api/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: inviteUsername.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setInviteError(data.error || "Failed to send invite");
      } else {
        setInviteUsername("");
        setInviteSuccess("Invite sent!");
        setTimeout(() => setInviteSuccess(""), 4000);
        fetchData();
      }
    } catch {
      setInviteError("Something went wrong");
    } finally {
      setInviteSending(false);
    }
  }

  async function handleRevokeInvite(inviteId: string) {
    await fetch(`/api/invites/${inviteId}`, { method: "DELETE" });
    setInvites((prev) => prev.map((inv) => inv._id === inviteId ? { ...inv, status: "revoked" } : inv));
  }

  async function handleRemovePatient(patientId: string) {
    try {
      const res = await fetch(`/api/relationships/${patientId}`, { method: "DELETE" });
      if (res.ok) {
        setPatients((prev) => prev.filter((p) => p._id !== patientId));
      }
    } catch { /* ignore */ }
  }

  if (loading || !userData) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "var(--color-gray-300)" }}>
        Loading...
      </div>
    );
  }

  // Therapist view
  if (userData.user.role === "therapist") {
    const pendingInvites = invites.filter((i) => i.status === "pending");
    const totalUnread = conversations.reduce((sum, c) => sum + c.unreadCount, 0);

    return (
      <>
        <div className="page">
          <div className="animate-in" style={{ marginBottom: "var(--space-xl)" }}>
            <h1 style={{ fontSize: "var(--text-display)", fontWeight: 800 }}>
              Hey, {userData.user.name.split(" ")[0]}!
            </h1>
            <p className="text-small" style={{ marginTop: "4px" }}>
              Here&apos;s your overview for today.
            </p>
          </div>

          {/* Stats Row */}
          <div className="animate-in" style={{ animationDelay: "60ms", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "var(--space-md)", marginBottom: "var(--space-xl)" }}>
            <div className="card" style={{ textAlign: "center", padding: "var(--space-lg) var(--space-md)" }}>
              <Users size={24} color="var(--color-blue)" style={{ margin: "0 auto var(--space-xs)" }} />
              <div style={{ fontSize: "28px", fontWeight: 800 }}>{patients.length}</div>
              <div className="text-tiny" style={{ color: "var(--color-gray-400)" }}>Patients</div>
            </div>
            <div className="card" style={{ textAlign: "center", padding: "var(--space-lg) var(--space-md)" }}>
              <UserPlus size={24} color="var(--color-orange)" style={{ margin: "0 auto var(--space-xs)" }} />
              <div style={{ fontSize: "28px", fontWeight: 800 }}>{pendingInvites.length}</div>
              <div className="text-tiny" style={{ color: "var(--color-gray-400)" }}>Pending Invites</div>
            </div>
            <div className="card" style={{ textAlign: "center", padding: "var(--space-lg) var(--space-md)" }}>
              <MessageCircle size={24} color="var(--color-primary)" style={{ margin: "0 auto var(--space-xs)" }} />
              <div style={{ fontSize: "28px", fontWeight: 800 }}>{totalUnread}</div>
              <div className="text-tiny" style={{ color: "var(--color-gray-400)" }}>Unread Messages</div>
            </div>
          </div>

          {/* Invite a Patient */}
          <div className="card animate-in" style={{ animationDelay: "120ms", marginBottom: "var(--space-lg)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "var(--space-md)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
                <UserPlus size={20} color="var(--color-blue)" />
                <h3 style={{ fontWeight: 700 }}>Invite a Patient</h3>
              </div>
              {invites.filter((i) => i.status !== "pending").length > 0 && (
                <button
                  onClick={() => setShowInviteHistory(true)}
                  style={{ background: "none", border: "none", color: "var(--color-blue)", fontSize: "13px", fontWeight: 600, cursor: "pointer", padding: 0 }}
                >
                  History
                </button>
              )}
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
              <button type="submit" className="btn btn-blue" disabled={inviteSending}>
                {inviteSending ? "..." : "Send"}
              </button>
            </form>
            {inviteError && (
              <p style={{ color: "var(--color-red)", fontSize: "14px", fontWeight: 600, marginTop: "var(--space-sm)" }}>{inviteError}</p>
            )}
            {inviteSuccess && (
              <p style={{ color: "var(--color-green-dark)", fontSize: "14px", fontWeight: 600, marginTop: "var(--space-sm)", backgroundColor: "var(--color-green-surface)", padding: "8px 12px", borderRadius: "var(--radius-sm)" }}>{inviteSuccess}</p>
            )}
          </div>

          {/* Pending Invites */}
          {pendingInvites.length > 0 && (
            <div className="animate-in" style={{ animationDelay: "150ms", marginBottom: "var(--space-lg)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: "var(--space-sm)" }}>
                <Clock size={14} color="var(--color-gray-300)" />
                <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--color-gray-400)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  Pending Invites ({pendingInvites.length})
                </span>
              </div>
              <div className="stack stack-sm">
                {pendingInvites.map((inv) => (
                  <div key={inv._id} className="card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "var(--space-sm) var(--space-md)" }}>
                    <span style={{ fontWeight: 600, fontSize: "14px" }}>{inv.patientUsername}</span>
                    <button
                      className="btn btn-secondary"
                      style={{ padding: "4px 8px", fontSize: "12px", color: "var(--color-red)" }}
                      onClick={() => handleRevokeInvite(inv._id)}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Patient Cards */}
          <section className="animate-in" style={{ animationDelay: "180ms", marginBottom: "var(--space-xl)" }}>
            <h3 style={{ fontSize: "var(--text-h2)", fontWeight: 800, marginBottom: "var(--space-md)" }}>
              Patients ({patients.length})
            </h3>
            {patients.length > 0 ? (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: "var(--space-md)" }}>
                {patients.map((p) => {
                  const convo = conversations.find((c) => c.partnerId === p._id);
                  return (
                    <div
                      key={p._id}
                      className="card-interactive"
                      style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)", position: "relative" }}
                      onClick={() => router.push(`/therapist/patients/${p._id}`)}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
                        <div style={{ width: 40, height: 40, borderRadius: "var(--radius-full)", backgroundColor: "var(--color-blue-light)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <User size={20} color="var(--color-blue)" />
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: "15px" }}>{p.name}</div>
                          <div style={{ fontSize: "12px", color: "var(--color-gray-300)" }}>@{p.username}</div>
                        </div>
                        {p.streak && p.streak.currentStreak > 0 && (
                          <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                            <Flame size={14} color="var(--color-orange)" fill="var(--color-orange)" />
                            <span style={{ fontSize: "14px", fontWeight: 800, color: "var(--color-orange)" }}>{p.streak.currentStreak}</span>
                          </div>
                        )}
                        <button
                          className="btn btn-secondary"
                          style={{ padding: "4px 6px", position: "absolute", top: 8, right: 8 }}
                          onClick={(e) => { e.stopPropagation(); handleRemovePatient(p._id); }}
                          title="Remove patient"
                        >
                          <Trash2 size={12} color="var(--color-gray-300)" />
                        </button>
                      </div>

                      {/* Floating message bubble */}
                      {convo && convo.lastMessage && (
                        <div
                          onClick={(e) => {
                            e.stopPropagation();
                            router.push(`/messages/${p._id}?name=${encodeURIComponent(p.name)}`);
                          }}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "var(--space-sm)",
                            padding: "6px 10px",
                            borderRadius: "var(--radius-md)",
                            backgroundColor: convo.unreadCount > 0 ? "var(--color-primary-surface)" : "var(--color-snow)",
                            border: convo.unreadCount > 0 ? "1px solid var(--color-primary)" : "1px solid var(--color-gray-100)",
                            cursor: "pointer",
                          }}
                        >
                          <MessageCircle size={13} color={convo.unreadCount > 0 ? "var(--color-primary)" : "var(--color-gray-300)"} />
                          <span style={{
                            flex: 1,
                            fontSize: "12px",
                            color: convo.unreadCount > 0 ? "var(--color-gray-600)" : "var(--color-gray-400)",
                            fontWeight: convo.unreadCount > 0 ? 600 : 400,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}>
                            {convo.lastMessage.content}
                          </span>
                          {convo.unreadCount > 0 && (
                            <span style={{
                              backgroundColor: "var(--color-primary)",
                              color: "white",
                              fontSize: "10px",
                              fontWeight: 700,
                              borderRadius: "var(--radius-full)",
                              minWidth: 16,
                              height: 16,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              padding: "0 4px",
                              flexShrink: 0,
                            }}>
                              {convo.unreadCount}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="card text-center" style={{ padding: "var(--space-xl)" }}>
                <Users size={36} color="var(--color-gray-200)" style={{ margin: "0 auto var(--space-sm)" }} />
                <p style={{ color: "var(--color-gray-300)", fontWeight: 600 }}>No patients yet</p>
                <p className="text-small" style={{ marginTop: "var(--space-xs)" }}>Send an invite above to get started.</p>
              </div>
            )}
          </section>

          {/* Messages */}
          <section className="animate-in" style={{ animationDelay: "240ms" }}>
            <h3 style={{ fontSize: "var(--text-h2)", fontWeight: 800, marginBottom: "var(--space-md)" }}>Messages</h3>
            {conversations.length > 0 ? (
              <div className="stack stack-sm">
                {conversations.slice(0, 5).map((c) => (
                  <Link key={c.partnerId} href={`/messages/${c.partnerId}?name=${encodeURIComponent(c.partnerName)}`} style={{ textDecoration: "none", color: "inherit", minWidth: 0 }}>
                    <div className="card-interactive" style={{ display: "flex", alignItems: "center", gap: "var(--space-md)", overflow: "hidden" }}>
                      <div style={{ width: 40, height: 40, borderRadius: "var(--radius-full)", backgroundColor: "var(--color-blue-light)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <User size={20} color="var(--color-blue)" />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontWeight: 700, fontSize: "var(--text-small)" }}>{c.partnerName}</span>
                          {c.unreadCount > 0 && (
                            <span style={{ backgroundColor: "var(--color-primary)", color: "white", fontSize: "11px", fontWeight: 700, borderRadius: "var(--radius-full)", minWidth: 20, height: 20, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px" }}>
                              {c.unreadCount}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: "var(--text-small)", color: "var(--color-gray-400)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>
                          {c.lastMessage ? c.lastMessage.content : "No messages yet"}
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="card text-center" style={{ padding: "var(--space-xl)" }}>
                <MessageCircle size={36} color="var(--color-gray-200)" style={{ margin: "0 auto var(--space-sm)" }} />
                <p style={{ color: "var(--color-gray-300)", fontWeight: 600 }}>No conversations yet</p>
                <p className="text-small" style={{ marginTop: "var(--space-xs)" }}>Messages with your patients will appear here.</p>
              </div>
            )}
          </section>
        </div>

        {/* Invite History Modal */}
        {showInviteHistory && (
          <div
            onClick={() => setShowInviteHistory(false)}
            style={{ position: "fixed", inset: 0, backgroundColor: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "var(--space-md)" }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{ background: "var(--color-surface)", borderRadius: "var(--radius-lg)", width: "100%", maxWidth: 480, maxHeight: "70vh", display: "flex", flexDirection: "column", overflow: "hidden" }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "var(--space-md) var(--space-lg)" }}>
                <h3 style={{ fontWeight: 700 }}>Invite History</h3>
                <button onClick={() => setShowInviteHistory(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-gray-400)", padding: 4 }}>
                  <X size={20} />
                </button>
              </div>
              <div style={{ overflowY: "auto", padding: "0 var(--space-lg) var(--space-lg)" }}>
                {invites.filter((i) => i.status !== "pending").length > 0 ? (
                  <div className="stack stack-sm">
                    {invites.filter((i) => i.status !== "pending").map((inv) => (
                      <div key={inv._id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--color-gray-100)" }}>
                        <span style={{ fontWeight: 600, fontSize: "14px" }}>{inv.patientUsername}</span>
                        <span className="badge" style={{
                          backgroundColor: inv.status === "accepted" ? "var(--color-primary-light)" : "var(--color-gray-100)",
                          color: inv.status === "accepted" ? "var(--color-primary-dark)" : "var(--color-gray-400)",
                        }}>
                          {inv.status}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ color: "var(--color-gray-300)", textAlign: "center", padding: "var(--space-lg) 0" }}>No past invites.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </>
    );
  }

  // Patient view
  const hasTherapist = userData.user.hasTherapist !== false;

  // Group assignments by date, flatten exercises with assignment ref
  type FlatExercise = Exercise & { assignmentId: string };
  const dateGroups: { date: string; exercises: FlatExercise[] }[] = [];
  const dateMap = new Map<string, FlatExercise[]>();
  for (const a of assignments) {
    const existing = dateMap.get(a.date);
    const mapped = a.exercises.map((ex) => ({ ...ex, assignmentId: a._id }));
    if (existing) {
      existing.push(...mapped);
    } else {
      const arr = [...mapped];
      dateMap.set(a.date, arr);
      dateGroups.push({ date: a.date, exercises: arr });
    }
  }

  // Find global first incomplete exercise for "Up Next" badge + CTA
  let globalNextExercise: FlatExercise | null = null;
  for (const group of dateGroups) {
    for (const ex of group.exercises) {
      if (!ex.completed) {
        globalNextExercise = ex;
        break;
      }
    }
    if (globalNextExercise) break;
  }

  const completedCount = dateGroups.reduce((s, g) => s + g.exercises.filter(e => e.completed).length, 0);
  const remainingCount = dateGroups.reduce((s, g) => s + g.exercises.filter(e => !e.completed).length, 0);

  return (
    <>
      <div className="page">

        {/* ── No Therapist Banner ── */}
        {!hasTherapist && (
          <div
            className="animate-in"
            style={{
              padding: "var(--space-md) var(--space-lg)",
              borderRadius: "var(--radius-xl)",
              border: "2px dashed var(--color-gray-200)",
              backgroundColor: "var(--color-snow, #f9fafb)",
              display: "flex",
              alignItems: "center",
              gap: "var(--space-md)",
              marginBottom: "var(--space-lg)",
            }}
          >
            <div style={{ width: 44, height: 44, borderRadius: "var(--radius-full)", backgroundColor: "var(--color-blue-light)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <UserPlus size={22} color="var(--color-blue)" />
            </div>
            <p style={{ fontWeight: 600, color: "var(--color-gray-500)", lineHeight: 1.4, fontSize: "var(--text-small)" }}>
              Ask your physical therapist to add your username{" "}
              <strong style={{ color: "var(--color-gray-600)" }}>{userData.user.username}</strong>
            </p>
          </div>
        )}

        {/* ── Profile + Assignments Row ── */}
        <div className="home-profile-row" style={{ ...(!hasTherapist ? { opacity: 0.45, pointerEvents: "none", filter: "grayscale(0.4)" } : {}) }}>

          {/* Profile Card */}
          <div className="home-profile-card animate-in">
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
              <div className="home-avatar">
                <span style={{ fontSize: "20px", fontWeight: 800, color: "white" }}>
                  {userData.user.name.charAt(0).toUpperCase()}
                </span>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h3 style={{ fontSize: "16px", fontWeight: 800, lineHeight: 1.2 }}>{userData.user.name}</h3>
                <p style={{ fontSize: "12px", color: "var(--color-gray-300)", fontWeight: 500 }}>@{userData.user.username}</p>
              </div>
            </div>

            {/* Streak + Stats in a compact row */}
            <div style={{ display: "flex", gap: "var(--space-sm)", marginTop: "var(--space-md)" }}>
              <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", borderRadius: "var(--radius-md)", backgroundColor: "var(--color-snow)", border: "1px solid var(--color-gray-100)" }}>
                <Flame size={18} color="var(--color-orange)" fill="var(--color-orange)" />
                <div>
                  <span style={{ fontSize: "18px", fontWeight: 800, color: "var(--color-orange)" }}>{userData.streak.currentStreak}</span>
                  <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-gray-400)", marginLeft: 3 }}>days</span>
                </div>
              </div>
              <div style={{ textAlign: "center", padding: "8px 12px", borderRadius: "var(--radius-md)", backgroundColor: "var(--color-green-surface)" }}>
                <div style={{ fontSize: "18px", fontWeight: 800, color: "var(--color-green)", lineHeight: 1 }}>{completedCount}</div>
                <div style={{ fontSize: "9px", fontWeight: 700, color: "var(--color-green-dark)", textTransform: "uppercase" }}>Done</div>
              </div>
              <div style={{ textAlign: "center", padding: "8px 12px", borderRadius: "var(--radius-md)", backgroundColor: "var(--color-primary-surface)" }}>
                <div style={{ fontSize: "18px", fontWeight: 800, color: "var(--color-primary)", lineHeight: 1 }}>{remainingCount}</div>
                <div style={{ fontSize: "9px", fontWeight: 700, color: "var(--color-primary-dark)", textTransform: "uppercase" }}>Left</div>
              </div>
            </div>
          </div>

          {/* Assignments Section */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-sm)" }}>
              <h3 style={{ fontSize: "var(--text-h2)", fontWeight: 800 }}>Assignments</h3>
              <button
                onClick={handleTogglePast}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: "13px",
                  fontWeight: 700,
                  color: "var(--color-primary)",
                }}
              >
                {showPast ? "Hide Past" : "View Past"}
                {showPast ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
            </div>

            {dateGroups.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
                {dateGroups.map((group) => (
                  <div key={group.date} className="animate-in">
                    {/* Date header — one per date */}
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                      <Calendar size={12} color="var(--color-gray-300)" />
                      <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--color-gray-400)", textTransform: "uppercase", letterSpacing: "0.04em" }}>
                        {formatAssignmentDate(group.date)}
                      </span>
                    </div>

                    {/* All exercises for this date */}
                    {group.exercises.map((ex) => {
                      const isCompleted = ex.completed;
                      const isGlobalNext = globalNextExercise === ex;

                      if (isCompleted) {
                        return (
                          <div key={`${ex.assignmentId}-${ex.exerciseId}`} style={{ marginBottom: 4 }}>
                            <div style={{
                              display: "flex", alignItems: "center", gap: "var(--space-sm)", padding: "6px 10px",
                              borderRadius: "var(--radius-md)", backgroundColor: "var(--color-green-surface)", border: "1px solid var(--color-green)",
                            }}>
                              <div style={{ width: 24, height: 24, borderRadius: "var(--radius-full)", backgroundColor: "var(--color-green)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                <Check size={12} color="white" strokeWidth={3} />
                              </div>
                              <span style={{ fontWeight: 600, color: "var(--color-gray-400)", textDecoration: "line-through", fontSize: "13px" }}>{ex.exerciseName}</span>
                            </div>
                          </div>
                        );
                      }

                      if (isGlobalNext) {
                        return (
                          <div
                            key={`${ex.assignmentId}-${ex.exerciseId}`}
                            style={{ marginBottom: 4, cursor: "pointer" }}
                            onClick={() => {
                              let url = `/exercise/${ex.assignmentId}?exerciseId=${ex.exerciseId}&name=${encodeURIComponent(ex.exerciseName)}&sets=${ex.sets}&reps=${ex.reps}&holdSec=${ex.holdSec}`;
                              if (ex.exerciseKey) url += `&exerciseKey=${ex.exerciseKey}`;
                              if (ex.skeletonDataFile) url += `&skeletonDataFile=${ex.skeletonDataFile}`;
                              router.push(url);
                            }}
                          >
                            <div style={{
                              display: "flex", alignItems: "center", gap: "var(--space-sm)", padding: "10px 12px",
                              borderRadius: "var(--radius-lg)", backgroundColor: "var(--color-white)", border: "2px solid var(--color-blue)",
                              boxShadow: "var(--shadow-tactile-sm) var(--color-blue-dark)", transition: "transform 0.1s, box-shadow 0.1s",
                            }}>
                              <div style={{ width: 36, height: 36, borderRadius: "var(--radius-md)", backgroundColor: "var(--color-blue-light)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                                <Dumbbell size={18} color="var(--color-blue)" />
                              </div>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                  <span style={{ fontWeight: 800, fontSize: "15px" }}>{ex.exerciseName}</span>
                                  <span style={{ padding: "1px 5px", borderRadius: 3, fontSize: "9px", fontWeight: 700, backgroundColor: "var(--color-blue)", color: "white", textTransform: "uppercase", letterSpacing: "0.03em" }}>
                                    Next
                                  </span>
                                </div>
                                <div style={{ display: "flex", gap: "var(--space-md)", fontSize: "12px", color: "var(--color-gray-400)", fontWeight: 500, marginTop: 1 }}>
                                  <span>{ex.sets}×{ex.reps} reps</span>
                                  {ex.holdSec > 0 && <span>{ex.holdSec}s hold</span>}
                                </div>
                              </div>
                              <Play size={22} color="var(--color-blue)" fill="var(--color-blue)" />
                            </div>
                          </div>
                        );
                      }

                      // Locked
                      return (
                        <div key={`${ex.assignmentId}-${ex.exerciseId}`} style={{ marginBottom: 4 }}>
                          <div style={{
                            display: "flex", alignItems: "center", gap: "var(--space-sm)", padding: "6px 10px",
                            borderRadius: "var(--radius-md)", backgroundColor: "var(--color-white)", border: "1px solid var(--color-gray-100)",
                            opacity: 0.55,
                          }}>
                            <div style={{ width: 24, height: 24, borderRadius: "var(--radius-full)", backgroundColor: "var(--color-snow)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                              <Dumbbell size={12} color="var(--color-gray-300)" />
                            </div>
                            <span style={{ fontWeight: 600, fontSize: "13px", flex: 1 }}>{ex.exerciseName}</span>
                            <Lock size={14} color="var(--color-gray-200)" />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            ) : (
              <div className="card text-center" style={{ padding: "var(--space-lg)" }}>
                <Dumbbell size={32} color="var(--color-gray-200)" style={{ margin: "0 auto var(--space-xs)" }} />
                <p style={{ color: "var(--color-gray-300)", fontWeight: 600, fontSize: "var(--text-small)" }}>No exercises assigned yet.</p>
                <p className="text-small" style={{ marginTop: 4, fontSize: "12px" }}>
                  We&apos;re waiting on your therapist to assign exercises.
                </p>
              </div>
            )}

            {/* Past Assignments */}
            {showPast && (
              <div style={{ marginTop: "var(--space-md)", paddingTop: "var(--space-md)", borderTop: "1px solid var(--color-gray-100)" }}>
                <h4 style={{ fontSize: "12px", fontWeight: 700, color: "var(--color-gray-300)", textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: "var(--space-sm)" }}>
                  Past Assignments
                </h4>
                {pastAssignments.length > 0 ? (
                  pastAssignments.map((a) => (
                    <div key={a._id} style={{ marginBottom: "var(--space-sm)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                        <Calendar size={11} color="var(--color-gray-300)" />
                        <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--color-gray-300)" }}>{formatAssignmentDate(a.date)}</span>
                        <span className="badge badge-green" style={{ fontSize: "9px", padding: "1px 5px" }}>Done</span>
                      </div>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                        {a.exercises.map((ex) => (
                          <span key={ex.exerciseId} style={{
                            fontSize: "11px", fontWeight: 600, color: "var(--color-gray-400)",
                            padding: "3px 8px", borderRadius: 6, backgroundColor: "var(--color-snow)", border: "1px solid var(--color-gray-100)",
                          }}>
                            {ex.exerciseName}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))
                ) : (
                  <p style={{ fontSize: "12px", color: "var(--color-gray-300)", textAlign: "center" }}>No past assignments yet.</p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Conversations Section (full width below) ── */}
        <section style={{ marginTop: "var(--space-lg)", ...(!hasTherapist ? { opacity: 0.45, pointerEvents: "none", filter: "grayscale(0.4)" } : {}) }}>
          <div className="card" style={{ padding: "var(--space-md) var(--space-lg)" }}>
            <h3 style={{ fontSize: "var(--text-h2)", fontWeight: 800, marginBottom: "var(--space-sm)" }}>Conversations</h3>
            {conversations.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {conversations.map((c) => (
                  <Link
                    key={c.partnerId}
                    href={`/messages/${c.partnerId}?name=${encodeURIComponent(c.partnerName)}`}
                    style={{ textDecoration: "none", color: "inherit", minWidth: 0 }}
                  >
                    <div style={{
                      display: "flex", alignItems: "center", gap: "var(--space-sm)", padding: "8px 10px",
                      borderRadius: "var(--radius-md)", border: "1px solid var(--color-gray-100)",
                      transition: "background 0.15s",
                    }}>
                      <div style={{ width: 36, height: 36, borderRadius: "var(--radius-full)", backgroundColor: "var(--color-blue-light)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                        <User size={18} color="var(--color-blue)" />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontWeight: 700, fontSize: "14px" }}>{c.partnerName}</span>
                          {c.unreadCount > 0 && (
                            <span style={{
                              backgroundColor: "var(--color-primary)", color: "white", fontSize: "11px", fontWeight: 700,
                              borderRadius: "var(--radius-full)", minWidth: 18, height: 18,
                              display: "flex", alignItems: "center", justifyContent: "center", padding: "0 5px",
                            }}>
                              {c.unreadCount}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: "12px", color: "var(--color-gray-400)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 1 }}>
                          {c.lastMessage ? c.lastMessage.content : "No messages yet"}
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="text-center" style={{ padding: "var(--space-md) 0" }}>
                <MessageCircle size={28} color="var(--color-gray-200)" style={{ margin: "0 auto var(--space-xs)" }} />
                <p style={{ color: "var(--color-gray-300)", fontWeight: 600, fontSize: "var(--text-small)" }}>No conversations yet</p>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Fixed CTA */}
      {globalNextExercise && (
        <div className="fixed-cta">
          <button
            className="btn btn-primary"
            style={{ fontSize: "18px", fontWeight: 800 }}
            onClick={() => {
              const ex = globalNextExercise!;
              let url = `/exercise/${ex.assignmentId}?exerciseId=${ex.exerciseId}&name=${encodeURIComponent(ex.exerciseName)}&sets=${ex.sets}&reps=${ex.reps}&holdSec=${ex.holdSec}`;
              if (ex.exerciseKey) url += `&exerciseKey=${ex.exerciseKey}`;
              if (ex.skeletonDataFile) url += `&skeletonDataFile=${ex.skeletonDataFile}`;
              router.push(url);
            }}
          >
            <Play size={22} fill="white" />
            Start Session
          </button>
        </div>
      )}
    </>
  );
}
