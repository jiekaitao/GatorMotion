import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import AppShellWrapper from "@/components/AppShellWrapper";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "GatorMotion",
  description: "Your physical therapy companion. Complete exercises, build streaks, recover stronger.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <AppShellWrapper>{children}</AppShellWrapper>
      </body>
    </html>
  );
}
