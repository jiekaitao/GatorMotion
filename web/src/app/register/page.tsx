"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
        body: JSON.stringify({ name, email, password, role }),
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
    <div className="page" style={{ display: "flex", flexDirection: "column", justifyContent: "center", minHeight: "100vh", paddingBottom: "var(--space-2xl)" }}>
      <div className="animate-in" style={{ marginBottom: "var(--space-xl)", display: "flex", flexDirection: "column", alignItems: "center" }}>
        <Image src="/gatormove-logo.png" alt="GatorMove" width={1536} height={1024} style={{ height: "80px", width: "auto" }} priority />
        <h1 style={{ marginTop: "var(--space-md)", fontSize: "var(--text-display)", fontWeight: 800 }}>Create Account</h1>
        <p className="text-small" style={{ marginTop: "var(--space-sm)" }}>
          Join GatorMove and start your recovery journey
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
          <label className="input-label" htmlFor="reg-email">Email</label>
          <input
            id="reg-email"
            type="email"
            className="input"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <div>
          <label className="input-label" htmlFor="reg-password">Password</label>
          <input
            id="reg-password"
            type="password"
            className="input"
            placeholder="At least 6 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />
        </div>

        <div>
          <label className="input-label">I am a</label>
          <div className="row" style={{ gap: "var(--space-sm)" }}>
            <button
              type="button"
              onClick={() => setRole("patient")}
              className={`btn ${role === "patient" ? "btn-primary" : "btn-secondary"}`}
              style={{ flex: 1 }}
            >
              Patient
            </button>
            <button
              type="button"
              onClick={() => setRole("therapist")}
              className={`btn ${role === "therapist" ? "btn-blue" : "btn-secondary"}`}
              style={{ flex: 1 }}
            >
              Therapist
            </button>
          </div>
        </div>

        {error && (
          <div className="card" style={{ backgroundColor: "var(--color-red-light)", border: "2px solid var(--color-red)", padding: "12px 16px" }}>
            <p style={{ color: "var(--color-red)", fontSize: "14px", fontWeight: 600 }}>{error}</p>
          </div>
        )}

        <button type="submit" className="btn btn-primary btn-full" disabled={loading} style={{ marginTop: "var(--space-sm)" }}>
          {loading ? "Creating account..." : "Sign up"}
        </button>

        <p className="text-center text-small" style={{ marginTop: "var(--space-md)" }}>
          Already have an account?{" "}
          <Link href="/login" style={{ fontWeight: 700 }}>Log in</Link>
        </p>
      </form>
    </div>
  );
}
