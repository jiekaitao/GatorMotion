"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import TabBar from "./TabBar";
import Image from "next/image";
import { Flame } from "lucide-react";

interface AppShellProps {
  children: React.ReactNode;
  streakCount?: number;
  hideDesktopHeader?: boolean;
}

export default function AppShell({ children, streakCount, hideDesktopHeader }: AppShellProps) {
  const pathname = usePathname();
  const [avatarInitial, setAvatarInitial] = useState("");

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => {
        if (data.user?.name) {
          setAvatarInitial(data.user.name.charAt(0).toUpperCase());
        }
      })
      .catch(() => {});
  }, []);

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
              <div style={{ display: "flex", alignItems: "center", gap: "4px", color: "var(--color-orange)", fontWeight: 700 }}>
                <Flame size={20} fill="var(--color-orange)" />
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
                <Flame size={22} color="var(--color-orange)" fill="var(--color-orange)" />
                <span style={{ fontWeight: 700, color: "var(--color-orange)" }}>
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

        {/* Page content with transition keyed to route */}
        <div key={pathname} className="page-transition">
          {children}
        </div>
      </main>

      {/* Mobile Bottom Tab Bar */}
      <TabBar />
    </div>
  );
}
