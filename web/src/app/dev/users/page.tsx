"use client";

import { useEffect, useState } from "react";

import { User, Shield } from "lucide-react";

interface UserInfo {
  _id: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
}

export default function DevUsersPage() {
  const [users, setUsers] = useState<UserInfo[]>([]);

  useEffect(() => {
    fetch("/api/dev/stats")
      .then((r) => r.json())
      .then((d) => setUsers(d.recentUsers || []))
      .catch(() => {});
  }, []);

  return (
    <>
      <div className="page">
        <h1 style={{ fontSize: "var(--text-h1)", fontWeight: 800, marginBottom: "var(--space-lg)" }}>Dev: Users</h1>
        <h3 className="animate-in" style={{ marginBottom: "var(--space-md)" }}>
          Registered Users ({users.length})
        </h3>

        <div className="stack stack-sm">
          {users.map((u, i) => (
            <div
              key={u._id}
              className="card animate-in"
              style={{ animationDelay: `${i * 60}ms`, display: "flex", alignItems: "center", gap: "var(--space-md)" }}
            >
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: "var(--radius-full)",
                  backgroundColor: u.role === "therapist" ? "var(--color-blue-light)" : "var(--color-primary-light)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {u.role === "therapist" ? (
                  <Shield size={20} color="var(--color-blue)" />
                ) : (
                  <User size={20} color="var(--color-primary)" />
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>{u.name}</div>
                <div className="text-small">{u.email}</div>
              </div>
              <div className={`badge ${u.role === "therapist" ? "badge-blue" : "badge-green"}`}>
                {u.role}
              </div>
            </div>
          ))}
          {users.length === 0 && (
            <p className="text-small">No users yet. Register from the login page.</p>
          )}
        </div>

        {/* ID Reference */}
        {users.length > 0 && (
          <div style={{ marginTop: "var(--space-lg)" }}>
            <h3 style={{ marginBottom: "var(--space-sm)", color: "var(--color-gray-400)" }}>User IDs (for dev tools)</h3>
            {users.map((u) => (
              <div key={u._id} className="text-tiny" style={{ color: "var(--color-gray-300)", marginBottom: "4px", fontFamily: "monospace" }}>
                {u.name}: {u._id}
              </div>
            ))}
          </div>
        )}
      </div>

    </>
  );
}
