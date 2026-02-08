"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import Sidebar from "./Sidebar";
import TabBar from "./TabBar";
import Image from "next/image";
import { Flame, Award, TrendingUp, Bell, Check, X, Settings, LogOut } from "lucide-react";

interface StreakInfo {
  currentStreak: number;
  longestStreak: number;
  totalDays: number;
}

interface Notification {
  _id: string;
  therapistName?: string;
  patientUsername?: string;
  senderName?: string;
  senderId?: string;
  messageCount?: number;
  type: "invite" | "accepted" | "message";
  createdAt: string;
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
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
  const [userMenuAnchor, setUserMenuAnchor] = useState<"mobile" | "desktop" | null>(null);
  const bellRef = useRef<HTMLDivElement>(null);
  const mobileUserMenuRef = useRef<HTMLDivElement>(null);
  const desktopUserMenuRef = useRef<HTMLDivElement>(null);

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

  // Poll notification count every 5 seconds
  useEffect(() => {
    if (!userRole) return;

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

  // Click-outside + escape handlers for popovers
  useEffect(() => {
    const showUserMenu = userMenuAnchor !== null;
    if (!showNotifications && !showUserMenu) return;

    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (showNotifications && bellRef.current && !bellRef.current.contains(target)) {
        setShowNotifications(false);
      }

      if (showUserMenu) {
        const activeMenuRef = userMenuAnchor === "mobile" ? mobileUserMenuRef : desktopUserMenuRef;
        if (activeMenuRef.current && !activeMenuRef.current.contains(target)) {
          setUserMenuAnchor(null);
        }
      }
    }

    function handleEscape(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (showNotifications) {
        setShowNotifications(false);
      }
      if (showUserMenu) {
        setUserMenuAnchor(null);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [showNotifications, userMenuAnchor]);

  async function handleBellClick() {
    setUserMenuAnchor(null);
    if (showNotifications) {
      setShowNotifications(false);
      return;
    }
    try {
      const res = await fetch("/api/notifications");
      const data = await res.json();
      setNotifications(data.notifications || []);
      // For therapists, viewing clears the count (server marks as seen)
      if (userRole === "therapist") {
        setNotificationCount(0);
      }
    } catch {
      setNotifications([]);
    }
    setShowNotifications(true);
  }

  function handleAvatarClick(anchor: "mobile" | "desktop") {
    setShowNotifications(false);
    setUserMenuAnchor((prev) => (prev === anchor ? null : anchor));
  }

  function handleOpenSettings() {
    setUserMenuAnchor(null);
    router.push("/settings");
  }

  async function handleSignOut() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // Best effort: still route to login.
    } finally {
      setUserMenuAnchor(null);
      router.replace("/login");
    }
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
      // Dispatch event so pages can instantly refetch
      window.dispatchEvent(new CustomEvent("invite-responded"));
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
      setDisplayedChildren(pendingChildrenRef.current);
      setTransitionState("entering");
    } else if (transitionState === "entering") {
      setTransitionState("idle");
    }
  }, [transitionState]);

  const showStreak = userRole !== "therapist";

  const bellButton = (
    <div style={{ position: "relative" }} ref={bellRef}>
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
              No new notifications
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
                {n.type === "invite" && (
                  <>
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
                  </>
                )}
                {n.type === "accepted" && (
                  <div style={{ fontSize: "14px" }}>
                    <strong>@{n.patientUsername}</strong> accepted your invite
                  </div>
                )}
                {n.type === "message" && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ fontSize: "14px" }}>
                      <strong>{n.senderName}</strong> sent {n.messageCount === 1 ? "a message" : `${n.messageCount} messages`}
                    </div>
                    <button
                      className="btn btn-blue"
                      style={{ padding: "4px 10px", fontSize: "12px", flexShrink: 0 }}
                      onClick={() => { setShowNotifications(false); router.push("/messages"); }}
                    >
                      View
                    </button>
                  </div>
                )}
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
              <div className="user-menu-anchor" ref={mobileUserMenuRef}>
                <button
                  type="button"
                  className="avatar-button avatar-button-mobile"
                  onClick={() => handleAvatarClick("mobile")}
                  aria-haspopup="menu"
                  aria-expanded={userMenuAnchor === "mobile"}
                  aria-label="Open user menu"
                >
                  {avatarInitial}
                </button>
                {userMenuAnchor === "mobile" && (
                  <div className="user-menu-popover" role="menu" aria-label="User menu">
                    <button type="button" className="user-menu-item" role="menuitem" onClick={handleOpenSettings}>
                      <Settings size={16} />
                      Settings
                    </button>
                    <button type="button" className="user-menu-item user-menu-item-danger" role="menuitem" onClick={handleSignOut}>
                      <LogOut size={16} />
                      Sign out
                    </button>
                  </div>
                )}
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
              <div className="user-menu-anchor" ref={desktopUserMenuRef}>
                <button
                  type="button"
                  className="avatar-button avatar-button-desktop"
                  onClick={() => handleAvatarClick("desktop")}
                  aria-haspopup="menu"
                  aria-expanded={userMenuAnchor === "desktop"}
                  aria-label="Open user menu"
                >
                  {avatarInitial}
                </button>
                {userMenuAnchor === "desktop" && (
                  <div className="user-menu-popover" role="menu" aria-label="User menu">
                    <button type="button" className="user-menu-item" role="menuitem" onClick={handleOpenSettings}>
                      <Settings size={16} />
                      Settings
                    </button>
                    <button type="button" className="user-menu-item user-menu-item-danger" role="menuitem" onClick={handleSignOut}>
                      <LogOut size={16} />
                      Sign out
                    </button>
                  </div>
                )}
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
