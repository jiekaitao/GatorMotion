"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import {
  Users,
  Play,
  Check,
  Lock,
  Repeat,
  Dumbbell,
  Timer,
  Star,
  MessageCircle,
  User,
  UserPlus,
} from "lucide-react";

interface Exercise {
  exerciseId: string;
  exerciseName: string;
  sets: number;
  reps: number;
  holdSec: number;
  completed: boolean;
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

export default function HomePage() {
  const router = useRouter();
  const [userData, setUserData] = useState<UserData | null>(null);
  const [assignment, setAssignment] = useState<Assignment | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      const [meRes, assignRes, msgRes] = await Promise.all([
        fetch("/api/auth/me"),
        fetch("/api/assignments?view=today"),
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
      setAssignment(assignData.assignment);

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

  // Re-fetch immediately when an invite is accepted/declined
  useEffect(() => {
    const handler = () => fetchData();
    window.addEventListener("invite-responded", handler);
    return () => window.removeEventListener("invite-responded", handler);
  }, [fetchData]);

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

          <div className="home-grid">
            {/* Messages Column */}
            <section className="animate-in" style={{ animationDelay: "180ms" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-md)" }}>
                <h3 style={{ fontSize: "var(--text-h2)", fontWeight: 800 }}>Messages</h3>
                <Link href="/messages" className="text-small" style={{ color: "var(--color-blue)", fontWeight: 600 }}>
                  View All
                </Link>
              </div>
              {conversations.length > 0 ? (
                <div className="stack stack-sm">
                  {conversations.slice(0, 5).map((c) => (
                    <Link key={c.partnerId} href="/messages" style={{ textDecoration: "none", color: "inherit", minWidth: 0 }}>
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
        </div>
      </>
    );
  }

  // Patient view
  const hasTherapist = userData.user.hasTherapist !== false;
  const exercises = assignment?.exercises || [];
  const completedCount = exercises.filter((e) => e.completed).length;
  const totalCount = exercises.length;
  const progressPercent = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  // Find the next uncompleted exercise
  const nextExerciseIndex = exercises.findIndex((e) => !e.completed);

  return (
    <>
      <div className="page">

        {/* ── No Therapist Banner ── */}
        {!hasTherapist && (
          <div
            className="animate-in"
            style={{
              padding: "var(--space-lg)",
              borderRadius: "var(--radius-xl)",
              border: "2px dashed var(--color-gray-200)",
              backgroundColor: "var(--color-snow, #f9fafb)",
              display: "flex",
              alignItems: "center",
              gap: "var(--space-md)",
              marginBottom: "var(--space-xl)",
            }}
          >
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: "var(--radius-full)",
                backgroundColor: "var(--color-blue-light)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <UserPlus size={28} color="var(--color-blue)" />
            </div>
            <p style={{ fontWeight: 600, color: "var(--color-gray-500)", lineHeight: 1.4 }}>
              Ask your physical therapist to add your username,{" "}
              <strong style={{ color: "var(--color-gray-600, #333)" }}>{userData.user.username}</strong>
              , as their patient
            </p>
          </div>
        )}

        {/* ── Daily Progress Hero Card ── */}
        {totalCount > 0 && <section
          className="card animate-in"
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "center",
            gap: "var(--space-lg)",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div style={{ flex: 1, zIndex: 1 }}>
            <h2 style={{ fontSize: "var(--text-h1)", fontWeight: 800, marginBottom: "var(--space-sm)" }}>
              Daily Progress
            </h2>
            <p style={{ color: "var(--color-gray-400)", fontWeight: 500, marginBottom: "var(--space-lg)" }}>
              {totalCount > 0 && completedCount === totalCount
                ? `You're all done for today, ${userData.user.name.split(" ")[0]}!`
                : `You're crushing your recovery goals, ${userData.user.name.split(" ")[0]}!`}
            </p>

            {/* Progress label + bar */}
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "var(--space-sm)" }}>
              <span style={{ color: "var(--color-green)", fontWeight: 700, textTransform: "uppercase", fontSize: "var(--text-small)", letterSpacing: "0.05em" }}>
                {completedCount} of {totalCount} exercises
              </span>
              <span style={{ color: "var(--color-green)", fontWeight: 700, fontSize: "var(--text-small)" }}>
                {Math.round(progressPercent)}%
              </span>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
            </div>
          </div>

          {/* Mascot / Star icon */}
          <div
            style={{
              width: 100,
              height: 100,
              flexShrink: 0,
              borderRadius: "var(--radius-full)",
              backgroundColor: "var(--color-green-surface)",
              border: "4px solid var(--color-green)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              position: "relative",
              zIndex: 1,
            }}
          >
            <Star size={48} color="var(--color-green)" fill="var(--color-green-light)" />
            <div
              style={{
                position: "absolute",
                bottom: -4,
                right: -4,
                backgroundColor: "var(--color-white)",
                borderRadius: "var(--radius-full)",
                border: "2px solid var(--color-gray-100)",
                padding: 4,
                display: "flex",
              }}
            >
              <Star size={16} color="var(--color-orange)" fill="var(--color-orange)" />
            </div>
          </div>

          {/* Decorative background circle */}
          <div
            style={{
              position: "absolute",
              right: -40,
              top: -40,
              width: 200,
              height: 200,
              borderRadius: "var(--radius-full)",
              backgroundColor: "rgba(88, 204, 2, 0.05)",
              zIndex: 0,
            }}
          />
        </section>}

        {/* ── Two-Column Dashboard Grid ── */}
        <div className="home-grid" style={{ marginTop: "var(--space-xl)", ...(!hasTherapist ? { opacity: 0.45, pointerEvents: "none", filter: "grayscale(0.4)" } : {}) }}>

        {/* ── Today's Plan Section ── */}
        <section>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--space-md)" }}>
            <h3 style={{ fontSize: "var(--text-h2)", fontWeight: 800 }}>Today&apos;s Plan</h3>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
            {exercises.length > 0 ? (
              exercises.map((ex, i) => {
                const isCompleted = ex.completed;
                const isNext = i === nextExerciseIndex;
                const isLocked = !isCompleted && !isNext;

                // Completed card
                if (isCompleted) {
                  return (
                    <div
                      key={ex.exerciseId}
                      className="animate-in"
                      style={{ animationDelay: `${i * 60}ms` }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "var(--space-md)",
                          padding: "var(--space-md)",
                          borderRadius: "var(--radius-xl)",
                          backgroundColor: "var(--color-green-surface)",
                          border: "2px solid var(--color-green)",
                        }}
                      >
                        <div
                          style={{
                            width: 64,
                            height: 64,
                            borderRadius: "var(--radius-xl)",
                            backgroundColor: "var(--color-green-light)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                          }}
                        >
                          <div
                            style={{
                              width: 28,
                              height: 28,
                              borderRadius: "var(--radius-full)",
                              backgroundColor: "var(--color-green)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <Check size={16} color="white" strokeWidth={3} />
                          </div>
                        </div>
                        <div style={{ flex: 1 }}>
                          <h4 style={{ fontWeight: 700, color: "var(--color-gray-400)", textDecoration: "line-through", textDecorationColor: "var(--color-green)" }}>
                            {ex.exerciseName}
                          </h4>
                          <p style={{ fontSize: "var(--text-small)", fontWeight: 500, color: "var(--color-green)" }}>Completed</p>
                        </div>
                        <div style={{ padding: "0 var(--space-md)" }}>
                          <span style={{ color: "var(--color-green)", fontWeight: 800, fontSize: "18px" }}>100%</span>
                        </div>
                      </div>
                    </div>
                  );
                }

                // Active (up next) card
                if (isNext) {
                  return (
                    <div
                      key={ex.exerciseId}
                      className="animate-in"
                      style={{ animationDelay: `${i * 60}ms`, position: "relative", cursor: "pointer" }}
                      onClick={() =>
                        router.push(
                          `/exercise/${assignment!._id}?exerciseId=${ex.exerciseId}&name=${encodeURIComponent(ex.exerciseName)}&sets=${ex.sets}&reps=${ex.reps}&holdSec=${ex.holdSec}`
                        )
                      }
                    >
                      {/* Pulse glow */}
                      <div
                        style={{
                          position: "absolute",
                          inset: -4,
                          borderRadius: "var(--radius-xl)",
                          background: "rgba(28, 176, 246, 0.2)",
                          filter: "blur(8px)",
                          opacity: 0.75,
                        }}
                        className="animate-pulse"
                      />
                      <div
                        style={{
                          position: "relative",
                          display: "flex",
                          alignItems: "center",
                          gap: "var(--space-md)",
                          padding: "var(--space-md)",
                          borderRadius: "var(--radius-xl)",
                          backgroundColor: "var(--color-white)",
                          border: "2px solid var(--color-blue)",
                          boxShadow: "var(--shadow-tactile) var(--color-blue-dark)",
                          transition: "transform 0.1s, box-shadow 0.1s",
                        }}
                      >
                        <div
                          style={{
                            width: 64,
                            height: 64,
                            borderRadius: "var(--radius-xl)",
                            backgroundColor: "var(--color-blue-light)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            flexShrink: 0,
                          }}
                        >
                          <Dumbbell size={28} color="var(--color-blue)" />
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", marginBottom: 4 }}>
                            <h4 style={{ fontWeight: 800, fontSize: "18px" }}>{ex.exerciseName}</h4>
                            <span
                              style={{
                                padding: "2px 8px",
                                borderRadius: 4,
                                fontSize: "10px",
                                fontWeight: 700,
                                backgroundColor: "var(--color-blue)",
                                color: "white",
                                textTransform: "uppercase",
                                letterSpacing: "0.05em",
                              }}
                            >
                              Up Next
                            </span>
                          </div>
                          <div style={{ display: "flex", gap: "var(--space-md)", fontSize: "var(--text-small)", color: "var(--color-gray-400)", fontWeight: 500 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                              <Repeat size={16} />
                              <span>{ex.sets} sets</span>
                            </div>
                            {ex.holdSec > 0 ? (
                              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                <Timer size={16} />
                                <span>{ex.holdSec} sec</span>
                              </div>
                            ) : (
                              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                <Dumbbell size={16} />
                                <span>{ex.reps} reps</span>
                              </div>
                            )}
                          </div>
                        </div>
                        <div style={{ paddingRight: "var(--space-sm)" }}>
                          <Play size={32} color="var(--color-blue)" fill="var(--color-blue)" />
                        </div>
                      </div>
                    </div>
                  );
                }

                // Locked (pending) card
                return (
                  <div
                    key={ex.exerciseId}
                    className="animate-in"
                    style={{ animationDelay: `${i * 60}ms` }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "var(--space-md)",
                        padding: "var(--space-md)",
                        borderRadius: "var(--radius-xl)",
                        backgroundColor: "var(--color-white)",
                        border: "2px solid var(--color-gray-100)",
                        boxShadow: "var(--shadow-tactile-sm) var(--color-gray-100)",
                        opacity: 0.7,
                        cursor: "default",
                      }}
                    >
                      <div
                        style={{
                          width: 64,
                          height: 64,
                          borderRadius: "var(--radius-xl)",
                          backgroundColor: "var(--color-snow)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          flexShrink: 0,
                          filter: "grayscale(1)",
                        }}
                      >
                        <Dumbbell size={28} color="var(--color-gray-300)" />
                      </div>
                      <div style={{ flex: 1 }}>
                        <h4 style={{ fontWeight: 700 }}>{ex.exerciseName}</h4>
                        <div style={{ display: "flex", gap: "var(--space-md)", fontSize: "var(--text-small)", color: "var(--color-gray-400)", fontWeight: 500, marginTop: 4 }}>
                          {ex.holdSec > 0 ? (
                            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                              <Timer size={16} />
                              <span>{ex.holdSec} sec</span>
                            </div>
                          ) : (
                            <>
                              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                <Repeat size={16} />
                                <span>{ex.sets} sets</span>
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                <Dumbbell size={16} />
                                <span>{ex.reps} reps</span>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                      <div style={{ paddingRight: "var(--space-sm)", color: "var(--color-gray-200)" }}>
                        <Lock size={28} />
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="card text-center" style={{ padding: "var(--space-xl)" }}>
                <Dumbbell size={36} color="var(--color-gray-200)" style={{ margin: "0 auto var(--space-sm)" }} />
                <p style={{ color: "var(--color-gray-300)", fontWeight: 600 }}>
                  No exercises assigned yet.
                </p>
                <p className="text-small" style={{ marginTop: "var(--space-sm)" }}>
                  We&apos;re waiting on your therapist to assign exercises.
                </p>
              </div>
            )}
          </div>
        </section>

        {/* ── Right Column: Messages ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xl)" }}>

        {/* ── Messages Section ── */}
        <section>
          <div style={{ display: "flex", alignItems: "center", marginBottom: "var(--space-md)" }}>
            <h3 style={{ fontSize: "var(--text-h2)", fontWeight: 800 }}>Conversations</h3>
          </div>

          {conversations.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
              {conversations.map((c) => (
                <Link
                  key={c.partnerId}
                  href="/messages"
                  style={{ textDecoration: "none", color: "inherit", minWidth: 0 }}
                >
                  <div
                    className="card-interactive animate-in"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "var(--space-md)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: "var(--radius-full)",
                        backgroundColor: "var(--color-blue-light)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <User size={22} color="var(--color-blue)" />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontWeight: 700 }}>{c.partnerName}</span>
                        {c.unreadCount > 0 && (
                          <span
                            style={{
                              backgroundColor: "var(--color-primary)",
                              color: "white",
                              fontSize: "12px",
                              fontWeight: 700,
                              borderRadius: "var(--radius-full)",
                              minWidth: 22,
                              height: 22,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              padding: "0 6px",
                            }}
                          >
                            {c.unreadCount}
                          </span>
                        )}
                      </div>
                      <div
                        style={{
                          fontSize: "var(--text-small)",
                          color: "var(--color-gray-400)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          marginTop: 2,
                        }}
                      >
                        {c.lastMessage
                          ? c.lastMessage.content
                          : "No messages yet — tap to start"}
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
              <p className="text-small" style={{ marginTop: "var(--space-xs)" }}>
                Your therapist will appear here once they message you.
              </p>
            </div>
          )}
        </section>

        </div>{/* end right column */}
        </div>{/* end home-grid */}
      </div>

      {/* Fixed CTA */}
      {nextExerciseIndex >= 0 && (
        <div className="fixed-cta">
          <button
            className="btn btn-primary"
            style={{ fontSize: "18px", fontWeight: 800 }}
            onClick={() => {
              const ex = exercises[nextExerciseIndex];
              router.push(
                `/exercise/${assignment!._id}?exerciseId=${ex.exerciseId}&name=${encodeURIComponent(ex.exerciseName)}&sets=${ex.sets}&reps=${ex.reps}&holdSec=${ex.holdSec}`
              );
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
