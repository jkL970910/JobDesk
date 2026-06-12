import type { Metadata } from "next";

import { AccessProvider } from "../src/components/access-provider";
import { isAccessTokenConfigured } from "../src/server/access-guard";
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
      <body>
        <AccessProvider configured={isAccessTokenConfigured()}>
          {children}
        </AccessProvider>
      </body>
    </html>
  );
}
