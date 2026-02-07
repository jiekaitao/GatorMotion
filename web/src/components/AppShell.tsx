"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import TabBar from "./TabBar";
import Image from "next/image";
import { Flame } from "lucide-react";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [avatarInitial, setAvatarInitial] = useState("");
  const [streakCount, setStreakCount] = useState<number | undefined>(undefined);
  const [displayedChildren, setDisplayedChildren] = useState(children);
  const [transitionState, setTransitionState] = useState<"idle" | "exiting" | "entering">("idle");
  const prevPathRef = useRef(pathname);
  const pendingChildrenRef = useRef(children);

  // Always track the latest children
  pendingChildrenRef.current = children;

  const hideDesktopHeader = pathname.startsWith("/messages");

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => {
        if (data.user?.name) {
          setAvatarInitial(data.user.name.charAt(0).toUpperCase());
        }
        if (data.streak?.currentStreak !== undefined) {
          setStreakCount(data.streak.currentStreak);
        }
      })
      .catch(() => {});
  }, []);

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

  return (
    <div className="app-shell">
      {/* Desktop Sidebar */}
      <Sidebar />

      {/* Main Content */}
      <main className="main-content">
        {/* Mobile Header */}
        <div className="mobile-header">
          <Image src="/gatormove-icon.png" alt="GatorMove" width={217} height={128} style={{ height: "28px", width: "auto" }} />
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-md)" }}>
            {streakCount !== undefined && (
              <div style={{ display: "flex", alignItems: "center", gap: "4px", color: streakCount > 0 ? "var(--color-orange)" : "var(--color-gray-300)", fontWeight: 700 }}>
                <Flame size={20} fill={streakCount > 0 ? "var(--color-orange)" : "var(--color-gray-300)"} color={streakCount > 0 ? "var(--color-orange)" : "var(--color-gray-300)"} />
                <span>{streakCount}</span>
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
            {streakCount !== undefined && (
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
