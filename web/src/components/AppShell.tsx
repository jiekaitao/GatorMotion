"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import TabBar from "./TabBar";
import Image from "next/image";
import { Flame, Award, TrendingUp, Bell, Check, X } from "lucide-react";

interface StreakInfo {
  currentStreak: number;
  longestStreak: number;
  totalDays: number;
}

interface Notification {
  _id: string;
  therapistName: string;
  createdAt: string;
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [avatarInitial, setAvatarInitial] = useState("");
  const [streakCount, setStreakCount] = useState<number | undefined>(undefined);
  const [streakInfo, setStreakInfo] = useState<StreakInfo | null>(null);
  const [displayedChildren, setDisplayedChildren] = useState(children);
  const [transitionState, setTransitionState] = useState<"idle" | "exiting" | "entering">("idle");
  const prevPathRef = useRef(pathname);
  const pendingChildrenRef = useRef(children);

  const [userRole, setUserRole] = useState<string>("");
  const [notificationCount, setNotificationCount] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [respondingTo, setRespondingTo] = useState<string | null>(null);

  // Always track the latest children
  pendingChildrenRef.current = children;

  const hideDesktopHeader = pathname.startsWith("/messages");

  useEffect(() => {
    Promise.all([
      fetch("/api/auth/me").then((r) => r.json()),
      fetch("/api/streaks").then((r) => r.ok ? r.json() : null),
    ])
      .then(([meData, streakData]) => {
        if (meData.user?.name) {
          setAvatarInitial(meData.user.name.charAt(0).toUpperCase());
        }
        if (meData.user?.role) {
          setUserRole(meData.user.role);
        }
        if (meData.user?.notificationCount !== undefined) {
          setNotificationCount(meData.user.notificationCount);
        }
        if (meData.streak?.currentStreak !== undefined) {
          setStreakCount(meData.streak.currentStreak);
        }
        if (streakData?.streak) {
          setStreakInfo({
            currentStreak: streakData.streak.currentStreak,
            longestStreak: streakData.streak.longestStreak,
            totalDays: streakData.streak.history?.length || 0,
          });
        }
      })
      .catch(() => {});
  }, []);

  // Poll notification count every 5 seconds for patients
  useEffect(() => {
    if (userRole !== "patient") return;

    const poll = () => {
      fetch("/api/notifications?count=true")
        .then((r) => r.json())
        .then((data) => {
          if (data.count !== undefined) setNotificationCount(data.count);
        })
        .catch(() => {});
    };

    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, [userRole]);

  async function handleBellClick() {
    if (showNotifications) {
      setShowNotifications(false);
      return;
    }
    try {
      const res = await fetch("/api/notifications");
      const data = await res.json();
      setNotifications(data.notifications || []);
    } catch {
      setNotifications([]);
    }
    setShowNotifications(true);
  }

  async function handleRespond(inviteId: string, action: "accept" | "decline") {
    setRespondingTo(inviteId);
    try {
      await fetch(`/api/notifications/${inviteId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      // Remove from list
      setNotifications((prev) => prev.filter((n) => n._id !== inviteId));
      // Refresh count
      const res = await fetch("/api/notifications?count=true");
      const data = await res.json();
      if (data.count !== undefined) setNotificationCount(data.count);
    } catch {
      // ignore
    }
    setRespondingTo(null);
  }

  // Handle route changes with exit/enter animation
  useEffect(() => {
    if (pathname !== prevPathRef.current) {
      prevPathRef.current = pathname;
      setTransitionState("exiting");
    }
  }, [pathname]);

  // When children change and we're idle, update immediately
  useEffect(() => {
    if (transitionState === "idle") {
      setDisplayedChildren(children);
    }
  }, [children, transitionState]);

  const handleAnimationEnd = useCallback(() => {
    if (transitionState === "exiting") {
      // Exit done — swap in the latest children and start enter animation
      setDisplayedChildren(pendingChildrenRef.current);
      setTransitionState("entering");
    } else if (transitionState === "entering") {
      setTransitionState("idle");
    }
  }, [transitionState]);

  const showStreak = userRole !== "therapist";

  const bellButton = userRole === "patient" && (
    <div style={{ position: "relative" }}>
      <button
        onClick={handleBellClick}
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          padding: 4,
          display: "flex",
          alignItems: "center",
          position: "relative",
        }}
      >
        <Bell size={22} color="var(--color-gray-500)" />
        {notificationCount > 0 && (
          <span
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              backgroundColor: "var(--color-red, #ef4444)",
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
            }}
          >
            {notificationCount}
          </span>
        )}
      </button>
      {showNotifications && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            marginTop: 8,
            width: 320,
            maxHeight: 400,
            overflowY: "auto",
            backgroundColor: "var(--color-white)",
            borderRadius: "var(--radius-lg, 12px)",
            boxShadow: "0 4px 24px rgba(0,0,0,0.12)",
            border: "1px solid var(--color-gray-100)",
            zIndex: 100,
          }}
        >
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--color-gray-100)", fontWeight: 700, fontSize: "14px" }}>
            Notifications
          </div>
          {notifications.length === 0 ? (
            <div style={{ padding: "24px 16px", textAlign: "center", color: "var(--color-gray-300)", fontSize: "14px" }}>
              No pending invites
            </div>
          ) : (
            notifications.map((n) => (
              <div
                key={n._id}
                style={{
                  padding: "12px 16px",
                  borderBottom: "1px solid var(--color-gray-100)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <div style={{ fontSize: "14px" }}>
                  <strong>{n.therapistName}</strong> wants to add you as a patient
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    className="btn btn-primary"
                    style={{ padding: "4px 12px", fontSize: "12px", display: "flex", alignItems: "center", gap: 4 }}
                    disabled={respondingTo === n._id}
                    onClick={() => handleRespond(n._id, "accept")}
                  >
                    <Check size={14} /> Accept
                  </button>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: "4px 12px", fontSize: "12px", display: "flex", alignItems: "center", gap: 4 }}
                    disabled={respondingTo === n._id}
                    onClick={() => handleRespond(n._id, "decline")}
                  >
                    <X size={14} /> Decline
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );

  return (
    <div className="app-shell">
      {/* Desktop Sidebar */}
      <Sidebar />

      {/* Main Content */}
      <main className="main-content">
        {/* Mobile Header */}
        <div className="mobile-header">
          <Image src="/gatormotion-icon.png" alt="GatorMotion" width={217} height={128} style={{ height: "28px", width: "auto" }} />
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-md)" }}>
            {bellButton}
            {showStreak && streakCount !== undefined && (
              <div className="streak-badge-wrapper">
                <div style={{ display: "flex", alignItems: "center", gap: "4px", color: streakCount > 0 ? "var(--color-orange)" : "var(--color-gray-300)", fontWeight: 700, cursor: "pointer" }}>
                  <Flame size={20} fill={streakCount > 0 ? "var(--color-orange)" : "var(--color-gray-300)"} color={streakCount > 0 ? "var(--color-orange)" : "var(--color-gray-300)"} />
                  <span>{streakCount}</span>
                </div>
                {streakInfo && (
                  <div className="streak-popover">
                    <div className="streak-popover-row">
                      <Flame size={16} color={streakInfo.currentStreak > 0 ? "var(--color-orange)" : "var(--color-gray-300)"} fill={streakInfo.currentStreak > 0 ? "var(--color-orange)" : "none"} />
                      <span>{streakInfo.currentStreak} day streak</span>
                    </div>
                    <div className="streak-popover-row">
                      <Award size={16} color="var(--color-primary)" />
                      <span>Longest: {streakInfo.longestStreak} days</span>
                    </div>
                    <div className="streak-popover-row">
                      <TrendingUp size={16} color="var(--color-blue)" />
                      <span>Total: {streakInfo.totalDays} days</span>
                    </div>
                  </div>
                )}
              </div>
            )}
            {avatarInitial && (
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "var(--radius-full)",
                  backgroundColor: "var(--color-gray-100)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                  fontSize: "var(--text-small)",
                  color: "var(--color-gray-500)",
                }}
              >
                {avatarInitial}
              </div>
            )}
          </div>
        </div>

        {/* Desktop Top Bar */}
        {!hideDesktopHeader && (
          <header className="desktop-header">
            {bellButton}
            {showStreak && streakCount !== undefined && (
              <div className="streak-badge-wrapper">
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-sm)",
                    padding: "var(--space-sm) var(--space-md)",
                    borderRadius: "var(--radius-xl)",
                    cursor: "pointer",
                  }}
                >
                  <Flame size={22} color={streakCount > 0 ? "var(--color-orange)" : "var(--color-gray-300)"} fill={streakCount > 0 ? "var(--color-orange)" : "var(--color-gray-300)"} />
                  <span style={{ fontWeight: 700, color: streakCount > 0 ? "var(--color-orange)" : "var(--color-gray-300)" }}>
                    {streakCount} Day Streak
                  </span>
                </div>
                {streakInfo && (
                  <div className="streak-popover">
                    <div className="streak-popover-row">
                      <Flame size={16} color={streakInfo.currentStreak > 0 ? "var(--color-orange)" : "var(--color-gray-300)"} fill={streakInfo.currentStreak > 0 ? "var(--color-orange)" : "none"} />
                      <span>{streakInfo.currentStreak} day streak</span>
                    </div>
                    <div className="streak-popover-row">
                      <Award size={16} color="var(--color-primary)" />
                      <span>Longest: {streakInfo.longestStreak} days</span>
                    </div>
                    <div className="streak-popover-row">
                      <TrendingUp size={16} color="var(--color-blue)" />
                      <span>Total: {streakInfo.totalDays} days</span>
                    </div>
                  </div>
                )}
              </div>
            )}
            {avatarInitial && (
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "var(--radius-xl)",
                  backgroundColor: "var(--color-gray-100)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                  fontSize: "var(--text-body)",
                  color: "var(--color-gray-500)",
                  cursor: "pointer",
                  border: "2px solid transparent",
                }}
              >
                {avatarInitial}
              </div>
            )}
          </header>
        )}

        {/* Page content with smooth exit/enter transitions */}
        <div
          className={`page-transition ${
            transitionState === "exiting"
              ? "page-exit"
              : transitionState === "entering"
              ? "page-enter"
              : ""
          }`}
          onAnimationEnd={handleAnimationEnd}
        >
          {displayedChildren}
        </div>
      </main>

      {/* Mobile Bottom Tab Bar */}
      <TabBar />
    </div>
  );
}
