"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<"patient" | "therapist">("patient");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, username, role }),
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

  return (
    <div className="login-page">
      <div className="login-bg-shape login-bg-shape-1" />
      <div className="login-bg-shape login-bg-shape-2" />

      <div className="login-container">
        {/* Hero */}
        <div className="login-hero animate-in">
          <div className="login-logo-ring">
            <Image
              src="/gatormotion-icon.png"
              alt="GatorMotion"
              width={217}
              height={128}
              style={{ height: "56px", width: "auto" }}
              priority
            />
          </div>
          <h1 className="login-title">Join GatorMotion</h1>
          <p className="login-subtitle">Start your recovery journey today</p>
        </div>

        {/* Register card */}
        <div className="login-card animate-in" style={{ animationDelay: "80ms" }}>
          <h2 className="login-card-title">Create Account</h2>

          <form onSubmit={handleSubmit} className="login-form">
            <div className="login-field">
              <label className="login-label" htmlFor="name">Full Name</label>
              <input
                id="name"
                type="text"
                className="login-input"
                placeholder="Jane Doe"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoComplete="name"
              />
            </div>

            <div className="login-field">
              <label className="login-label" htmlFor="reg-username">Username</label>
              <input
                id="reg-username"
                type="text"
                className="login-input"
                placeholder="Pick a unique username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoComplete="username"
              />
            </div>

            <div className="login-field">
              <label className="login-label">I am a</label>
              <div style={{ display: "flex", gap: "var(--space-sm)" }}>
                <button
                  type="button"
                  onClick={() => setRole("patient")}
                  className="login-role-btn"
                  data-active={role === "patient"}
                >
                  Patient
                </button>
                <button
                  type="button"
                  onClick={() => setRole("therapist")}
                  className="login-role-btn"
                  data-active={role === "therapist"}
                >
                  Therapist
                </button>
              </div>
            </div>

            {error && (
              <div className="login-error">
                <p>{error}</p>
              </div>
            )}

            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? "Creating account..." : "Sign up"}
            </button>
          </form>

          <p className="login-footer">
            Already have an account?{" "}
            <Link href="/login" className="login-link">Log in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
