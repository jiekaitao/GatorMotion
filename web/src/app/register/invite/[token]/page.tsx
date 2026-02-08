"use client";

import { useState, useEffect, FormEvent, use } from "react";
import { useRouter } from "next/navigation";

export default function InviteRegisterPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [therapistName, setTherapistName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(true);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    fetch(`/api/invites/${token}`)
      .then((r) => {
        if (!r.ok) throw new Error("Invalid invite");
        return r.json();
      })
      .then((data) => {
        setTherapistName(data.therapistName);
        setPageLoading(false);
      })
      .catch(() => {
        setInvalid(true);
        setPageLoading(false);
      });
  }, [token]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, username, role: "patient", inviteToken: token }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Registration failed");
        setLoading(false);
        return;
      }

      router.push("/home");
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  if (pageLoading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "var(--color-gray-300)" }}>
        Loading invite...
      </div>
    );
  }

  if (invalid) {
    return (
      <div className="page" style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", minHeight: "100vh", textAlign: "center" }}>
        <div style={{ fontSize: "48px", marginBottom: "var(--space-md)" }}>🔗</div>
        <h2>Invalid Invite Link</h2>
        <p className="text-small" style={{ marginTop: "var(--space-sm)", color: "var(--color-gray-400)" }}>
          This invite link is invalid, expired, or has already been used.
        </p>
        <button className="btn btn-primary" style={{ marginTop: "var(--space-lg)" }} onClick={() => router.push("/register")}>
          Sign up normally
        </button>
      </div>
    );
  }

  return (
    <div className="page" style={{ display: "flex", flexDirection: "column", justifyContent: "center", minHeight: "100vh", paddingBottom: "var(--space-2xl)" }}>
      <div className="animate-in" style={{ marginBottom: "var(--space-lg)" }}>
        <div className="badge badge-blue" style={{ marginBottom: "var(--space-md)" }}>
          Invite from {therapistName}
        </div>
        <h1 style={{ fontSize: "var(--text-display)", fontWeight: 800 }}>Join GatorMotion</h1>
        <p className="text-small" style={{ marginTop: "var(--space-sm)" }}>
          {therapistName} has invited you to track your physical therapy exercises.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="stack stack-md animate-in" style={{ animationDelay: "60ms" }}>
        <div>
          <label className="input-label" htmlFor="name">Full Name</label>
          <input
            id="name"
            type="text"
            className="input"
            placeholder="Jane Doe"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>

        <div>
          <label className="input-label" htmlFor="inv-username">Username</label>
          <input
            id="inv-username"
            type="text"
            className="input"
            placeholder="Pick a unique username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </div>

        {error && (
          <div className="card" style={{ backgroundColor: "var(--color-red-light)", border: "2px solid var(--color-red)", padding: "12px 16px" }}>
            <p style={{ color: "var(--color-red)", fontSize: "14px", fontWeight: 600 }}>{error}</p>
          </div>
        )}

        <button type="submit" className="btn btn-primary btn-full" disabled={loading} style={{ marginTop: "var(--space-sm)" }}>
          {loading ? "Creating account..." : "Create Account"}
        </button>
      </form>
    </div>
  );
}
