"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { LogOut, User } from "lucide-react";

interface UserInfo {
  id: string;
  name: string;
  email: string;
  role: string;
}

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<UserInfo | null>(null);

  useEffect(() => {
    async function fetchUser() {
      try {
        const res = await fetch("/api/auth/me");
        if (!res.ok) {
          router.replace("/login");
          return;
        }
        const data = await res.json();
        setUser(data.user);
      } catch {
        router.replace("/login");
      }
    }
    fetchUser();
  }, [router]);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  }

  if (!user) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "var(--color-gray-300)" }}>
        Loading...
      </div>
    );
  }

  return (
    <>
      <div className="page">
        <h1 style={{ fontSize: "var(--text-h1)", fontWeight: 800, marginBottom: "var(--space-lg)" }}>Profile</h1>

        <div className="card animate-in text-center" style={{ marginBottom: "var(--space-lg)" }}>
          <div
            style={{
              width: 80,
              height: 80,
              borderRadius: "var(--radius-full)",
              backgroundColor: "var(--color-blue-light)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto var(--space-md)",
            }}
          >
            <User size={36} color="var(--color-blue)" />
          </div>
          <h2>{user.name}</h2>
          <p className="text-small">{user.email}</p>
          <div className="badge badge-blue" style={{ margin: "var(--space-sm) auto 0" }}>
            {user.role}
          </div>
        </div>

        <button
          onClick={handleLogout}
          className="btn btn-danger btn-full animate-in"
          style={{ animationDelay: "60ms" }}
        >
          <LogOut size={18} />
          Log out
        </button>
      </div>
    </>
  );
}
