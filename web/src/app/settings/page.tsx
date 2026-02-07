"use client";

import { useEffect, useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import AppShell from "@/components/AppShell";
import { User, Lock, Check, LogOut } from "lucide-react";

export default function SettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  // Profile form
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Password form
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((data) => {
        setName(data.user.name);
        setEmail(data.user.email);
        setRole(data.user.role);
      })
      .catch(() => router.replace("/login"))
      .finally(() => setLoading(false));
  }, [router]);

  async function handleProfileSubmit(e: FormEvent) {
    e.preventDefault();
    setProfileMsg(null);
    setProfileSaving(true);

    try {
      const res = await fetch("/api/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setProfileMsg({ type: "error", text: data.error || "Failed to update" });
      } else {
        setProfileMsg({ type: "success", text: "Profile updated!" });
      }
    } catch {
      setProfileMsg({ type: "error", text: "Something went wrong" });
    } finally {
      setProfileSaving(false);
    }
  }

  async function handlePasswordSubmit(e: FormEvent) {
    e.preventDefault();
    setPasswordMsg(null);

    if (newPassword !== confirmPassword) {
      setPasswordMsg({ type: "error", text: "New passwords don't match" });
      return;
    }

    setPasswordSaving(true);

    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setPasswordMsg({ type: "error", text: data.error || "Failed to change password" });
      } else {
        setPasswordMsg({ type: "success", text: "Password changed!" });
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      }
    } catch {
      setPasswordMsg({ type: "error", text: "Something went wrong" });
    } finally {
      setPasswordSaving(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "var(--color-gray-300)" }}>
        Loading...
      </div>
    );
  }

  return (
    <AppShell>
      <div className="page" style={{ maxWidth: 560 }}>
        <h1 style={{ fontSize: "var(--text-h1)", fontWeight: 800, marginBottom: "var(--space-lg)" }}>Settings</h1>

        {/* ── Profile Section ── */}
        <div className="card animate-in" style={{ marginBottom: "var(--space-lg)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", marginBottom: "var(--space-lg)" }}>
            <User size={20} color="var(--color-blue)" />
            <h3 style={{ fontWeight: 700 }}>Profile</h3>
            <div className="badge badge-blue" style={{ marginLeft: "auto" }}>{role}</div>
          </div>

          <form onSubmit={handleProfileSubmit} className="stack stack-md">
            <div>
              <label className="input-label" htmlFor="settings-name">Full Name</label>
              <input
                id="settings-name"
                type="text"
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="input-label" htmlFor="settings-email">Email</label>
              <input
                id="settings-email"
                type="email"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            {profileMsg && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-sm)",
                  padding: "10px 14px",
                  borderRadius: "var(--radius-md)",
                  backgroundColor: profileMsg.type === "success" ? "var(--color-green-surface)" : "var(--color-red-light)",
                  color: profileMsg.type === "success" ? "var(--color-green-dark)" : "var(--color-red)",
                  fontSize: "var(--text-small)",
                  fontWeight: 600,
                }}
              >
                {profileMsg.type === "success" && <Check size={16} />}
                {profileMsg.text}
              </div>
            )}

            <button type="submit" className="btn btn-teal btn-full" disabled={profileSaving}>
              {profileSaving ? "Saving..." : "Save Changes"}
            </button>
          </form>
        </div>

        {/* ── Password Section ── */}
        <div className="card animate-in" style={{ animationDelay: "60ms", marginBottom: "var(--space-lg)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", marginBottom: "var(--space-lg)" }}>
            <Lock size={20} color="var(--color-orange)" />
            <h3 style={{ fontWeight: 700 }}>Change Password</h3>
          </div>

          <form onSubmit={handlePasswordSubmit} className="stack stack-md">
            <div>
              <label className="input-label" htmlFor="current-pw">Current Password</label>
              <input
                id="current-pw"
                type="password"
                className="input"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="input-label" htmlFor="new-pw">New Password</label>
              <input
                id="new-pw"
                type="password"
                className="input"
                placeholder="At least 6 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>

            <div>
              <label className="input-label" htmlFor="confirm-pw">Confirm New Password</label>
              <input
                id="confirm-pw"
                type="password"
                className="input"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>

            {passwordMsg && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-sm)",
                  padding: "10px 14px",
                  borderRadius: "var(--radius-md)",
                  backgroundColor: passwordMsg.type === "success" ? "var(--color-green-surface)" : "var(--color-red-light)",
                  color: passwordMsg.type === "success" ? "var(--color-green-dark)" : "var(--color-red)",
                  fontSize: "var(--text-small)",
                  fontWeight: 600,
                }}
              >
                {passwordMsg.type === "success" && <Check size={16} />}
                {passwordMsg.text}
              </div>
            )}

            <button type="submit" className="btn btn-secondary btn-full" disabled={passwordSaving}>
              {passwordSaving ? "Changing..." : "Change Password"}
            </button>
          </form>
        </div>

        {/* ── Logout ── */}
        <button
          onClick={handleLogout}
          className="btn btn-danger btn-full animate-in"
          style={{ animationDelay: "120ms" }}
        >
          <LogOut size={18} />
          Log Out
        </button>
      </div>
    </AppShell>
  );
}
