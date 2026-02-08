"use client";

import { useEffect, useState, FormEvent, CSSProperties } from "react";
import { useRouter } from "next/navigation";

import { User, Check, LogOut, Trash2 } from "lucide-react";

export default function SettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  // Profile form
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Delete account
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteHover, setDeleteHover] = useState(false);

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

  async function handleDeleteAccount() {
    if (deleteConfirmText !== username) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/auth/delete-account", { method: "DELETE" });
      if (res.ok) {
        router.replace("/login");
      }
    } catch {
      setDeleting(false);
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

  const deleteBtnStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "6px",
    padding: "10px 16px",
    borderRadius: "var(--radius-md)",
    border: "none",
    cursor: "pointer",
    fontWeight: 600,
    fontSize: "var(--text-small)",
    width: "100%",
    transition: "all 0.2s ease",
    backgroundColor: deleteHover ? "var(--color-red-light, #fee)" : "var(--color-snow, #f5f5f5)",
    color: deleteHover ? "var(--color-red)" : "var(--color-gray-400)",
  };

  return (
    <>
      <div className="page" style={{ maxWidth: 720 }}>
        <h1 style={{ fontSize: "var(--text-h1)", fontWeight: 800, marginBottom: "var(--space-lg)" }}>Settings</h1>

        {/* ── Profile + Delete side by side ── */}
        <div style={{ display: "flex", gap: "var(--space-lg)", alignItems: "stretch", marginBottom: "var(--space-lg)" }}>

          {/* ── Profile Section ── */}
          <div className="card animate-in" style={{ flex: 1, minWidth: 0 }}>
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

          {/* ── Delete Account Section ── */}
          <div className="card animate-in" style={{ animationDelay: "60ms", width: 220, flexShrink: 0, display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", marginBottom: "var(--space-md)" }}>
              <Trash2 size={18} color={deleteHover ? "var(--color-red)" : "var(--color-gray-400)"} style={{ transition: "color 0.2s ease" }} />
              <h3 style={{ fontWeight: 700, fontSize: "var(--text-small)" }}>Delete Account</h3>
            </div>

            <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
              <p style={{ fontSize: "12px", color: "var(--color-gray-400)", marginBottom: "var(--space-sm)", lineHeight: 1.5 }}>
                This will permanently delete your profile, exercise assignments, streaks, and all messages. This cannot be undone.
              </p>
              <p style={{ fontSize: "12px", color: "var(--color-gray-400)", marginBottom: "var(--space-sm)", lineHeight: 1.4 }}>
                Type <strong style={{ color: "var(--color-gray-500)" }}>{username}</strong> to confirm:
              </p>
              <input
                type="text"
                className="input"
                placeholder={username}
                value={deleteConfirmText}
                onChange={(e) => setDeleteConfirmText(e.target.value)}
                style={{ marginBottom: "var(--space-sm)", fontSize: "13px" }}
              />
              <div style={{ marginTop: "auto" }}>
                <button
                  onClick={handleDeleteAccount}
                  onMouseEnter={() => setDeleteHover(true)}
                  onMouseLeave={() => setDeleteHover(false)}
                  style={deleteBtnStyle}
                  disabled={deleteConfirmText !== username || deleting}
                >
                  <Trash2 size={14} />
                  {deleting ? "Deleting..." : "Delete Account"}
                </button>
              </div>
            </div>
          </div>
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
    </>
  );
}
