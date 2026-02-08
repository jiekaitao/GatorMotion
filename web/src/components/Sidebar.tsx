"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Image from "next/image";
import {
  Home,
  Wrench,
  Settings,
} from "lucide-react";

const patientLinks = [
  { href: "/home", label: "Home", icon: Home },
];

const therapistLinks = [
  { href: "/home", label: "Home", icon: Home },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [role, setRole] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((data) => setRole(data.user?.role || "patient"))
      .catch(() => setRole("patient"));
  }, []);

  const links = role === "therapist" ? therapistLinks : patientLinks;

  return (
    <aside className="sidebar">
      {/* Logo */}
      <div className="sidebar-logo">
        <Image src="/gatormotion-icon.png" alt="GatorMotion" width={217} height={128} style={{ height: "32px", width: "auto" }} />
        <h1>GatorMotion</h1>
      </div>

      {/* Nav Links */}
      <nav className="sidebar-nav">
        {links.map(({ href, label, icon: Icon }) => {
          const isActive = pathname.startsWith(href);
          return (
            <Link key={href} href={href} className={`sidebar-link ${isActive ? "active" : ""}`}>
              <Icon size={22} strokeWidth={2} />
              <span>{label}</span>
            </Link>
          );
        })}

        {/* Dev link */}
        <Link
          href="/dev"
          className={`sidebar-link ${pathname.startsWith("/dev") ? "active" : ""}`}
        >
          <Wrench size={22} strokeWidth={2} />
          <span>Dev</span>
        </Link>
      </nav>

      {/* Footer */}
      <div className="sidebar-footer">
        <Link
          href="/settings"
          className={`sidebar-link ${pathname.startsWith("/settings") ? "active" : ""}`}
          style={{
            justifyContent: "center",
            border: "2px solid var(--color-gray-100)",
          }}
        >
          <Settings size={18} />
          <span>Settings</span>
        </Link>
      </div>
    </aside>
  );
}
