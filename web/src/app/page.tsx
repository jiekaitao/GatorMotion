"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function RootPage() {
  const router = useRouter();

  useEffect(() => {
    async function checkAuth() {
      try {
        const res = await fetch("/api/auth/me");
        if (res.ok) {
          router.replace("/home");
        } else {
          router.replace("/login");
        }
      } catch {
        router.replace("/login");
      }
    }
    checkAuth();
  }, [router]);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        color: "var(--color-gray-300)",
      }}
    >
      Loading...
    </div>
  );
}
