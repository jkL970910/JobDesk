import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "JobDesk",
  description: "Evidence-grounded job search copilot workspace.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

