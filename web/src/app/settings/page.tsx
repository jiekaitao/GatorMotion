"use client";

import { useEffect, useState, FormEvent } from "react";
import { useRouter } from "next/navigation";

import { User, Check, LogOut } from "lucide-react";

export default function SettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  // Profile form
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((data) => {
        setName(data.user.name);
        setUsername(data.user.username);
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
        body: JSON.stringify({ name }),
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
    <>
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
              <label className="input-label" htmlFor="settings-username">Username</label>
              <input
                id="settings-username"
                type="text"
                className="input"
                value={username}
                readOnly
                style={{ backgroundColor: "var(--color-snow)", color: "var(--color-gray-400)" }}
              />
            </div>

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

        {/* ── Logout ── */}
        <button
          onClick={handleLogout}
          className="btn btn-danger btn-full animate-in"
          style={{ animationDelay: "60ms" }}
        >
          <LogOut size={18} />
          Log Out
        </button>
      </div>
    </>
  );
}
