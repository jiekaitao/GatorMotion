"use client";

import AppShell from "@/components/AppShell";
import { MessageCircle } from "lucide-react";

export default function MessagesPage() {
  return (
    <AppShell>
      <div className="page">
        <h1 style={{ fontSize: "var(--text-h1)", fontWeight: 800, marginBottom: "var(--space-lg)" }}>Messages</h1>

        <div className="card text-center animate-in" style={{ padding: "var(--space-2xl) var(--space-lg)" }}>
          <MessageCircle
            size={48}
            color="var(--color-gray-200)"
            style={{ margin: "0 auto var(--space-md)" }}
          />
          <h2 style={{ color: "var(--color-gray-400)" }}>Coming Soon</h2>
          <p className="text-small" style={{ marginTop: "var(--space-sm)" }}>
            Chat with your therapist directly from the app.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
