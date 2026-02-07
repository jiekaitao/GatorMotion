"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
        body: JSON.stringify({ email, password }),
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
    <div className="page" style={{ display: "flex", flexDirection: "column", justifyContent: "center", minHeight: "100vh", paddingBottom: "var(--space-2xl)" }}>
      <div className="animate-in text-center" style={{ marginBottom: "var(--space-xl)", display: "flex", flexDirection: "column", alignItems: "center" }}>
        <Image src="/gatormove-logo.png" alt="GatorMove" width={1536} height={1024} style={{ height: "120px", width: "auto" }} priority />
        <h1 style={{ marginTop: "var(--space-md)", fontSize: "var(--text-display)", fontWeight: 800 }}>
          GatorMove
        </h1>
        <p className="text-small" style={{ marginTop: "var(--space-sm)" }}>
          Your PT recovery companion
        </p>
      </div>

      <form onSubmit={handleSubmit} className="stack stack-md animate-in" style={{ animationDelay: "60ms" }}>
        <div>
          <label className="input-label" htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            className="input"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div>
          <label className="input-label" htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            className="input"
            placeholder="Your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        {error && (
          <div className="card" style={{ backgroundColor: "var(--color-red-light)", border: "2px solid var(--color-red)", padding: "12px 16px" }}>
            <p style={{ color: "var(--color-red)", fontSize: "14px", fontWeight: 600 }}>{error}</p>
          </div>
        )}

        <button type="submit" className="btn btn-primary btn-full" disabled={loading} style={{ marginTop: "var(--space-sm)" }}>
          {loading ? "Logging in..." : "Log in"}
        </button>

        <p className="text-center text-small" style={{ marginTop: "var(--space-md)" }}>
          Don&apos;t have an account?{" "}
          <Link href="/register" style={{ fontWeight: 700 }}>Sign up</Link>
        </p>
      </form>
    </div>
  );
}
