"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function InviteRegisterPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/login");
  }, [router]);

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", color: "var(--color-gray-300)" }}>
      Redirecting to login...
    </div>
  );
}
