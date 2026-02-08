"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Home, Wrench, Settings, MessageCircle } from "lucide-react";

const patientTabs = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/messages", label: "Messages", icon: MessageCircle },
  { href: "/settings", label: "Settings", icon: Settings },
];

const therapistTabs = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/messages", label: "Messages", icon: MessageCircle },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default function TabBar() {
  const pathname = usePathname();
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => setRole(data.user?.role || "patient"))
      .catch(() => setRole("patient"));
  }, []);

  const tabs = role === "therapist" ? therapistTabs : patientTabs;

  return (
    <nav className="tab-bar">
      {tabs.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className={`tab-item ${pathname.startsWith(href) ? "active" : ""}`}
        >
          <Icon size={24} strokeWidth={2} />
          <span>{label}</span>
        </Link>
      ))}
      <Link
        href="/dev"
        className={`tab-item ${pathname.startsWith("/dev") ? "active" : ""}`}
      >
        <Wrench size={24} strokeWidth={2} />
        <span>Dev</span>
      </Link>
    </nav>
  );
}
