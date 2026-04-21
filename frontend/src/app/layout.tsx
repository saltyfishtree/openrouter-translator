import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "OpenRouter Translator",
  description:
    "A clean streaming translation workspace with a TypeScript frontend and Python backend.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body>{children}</body>
    </html>
  );
}
