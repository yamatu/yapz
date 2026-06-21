import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Yapz",
  description: "Game channel chat and voice platform"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
