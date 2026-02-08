"use client";

import { usePathname } from "next/navigation";
import AppShell from "./AppShell";
import { ToastContainer } from "./Toast";

const NO_SHELL_ROUTES = ["/login", "/register", "/exercise"];

export default function AppShellWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const showShell = pathname !== "/" && !NO_SHELL_ROUTES.some((r) => pathname.startsWith(r));

  if (showShell) {
    return (
      <>
        <AppShell>{children}</AppShell>
        <ToastContainer />
      </>
    );
  }

  return (
    <>
      {children}
      <ToastContainer />
    </>
  );
}
