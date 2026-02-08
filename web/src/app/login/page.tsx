"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Login failed");
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
      {/* Decorative background shapes */}
      <div className="login-bg-shape login-bg-shape-1" />
      <div className="login-bg-shape login-bg-shape-2" />

      <div className="login-container">
        {/* Hero section */}
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
          <h1 className="login-title">GatorMotion</h1>
          <p className="login-subtitle">Your PT recovery companion</p>
        </div>

        {/* Login card */}
        <div className="login-card animate-in" style={{ animationDelay: "80ms" }}>
          <h2 className="login-card-title">Welcome back</h2>

          <form onSubmit={handleSubmit} className="login-form">
            <div className="login-field">
              <label className="login-label" htmlFor="username">Username</label>
              <input
                id="username"
                type="text"
                className="login-input"
                placeholder="Your username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoComplete="username"
              />
            </div>

            {error && (
              <div className="login-error">
                <p>{error}</p>
              </div>
            )}

            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? "Logging in..." : "Log in"}
            </button>
          </form>

          <p className="login-footer">
            Don&apos;t have an account?{" "}
            <Link href="/register" className="login-link">Sign up</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
