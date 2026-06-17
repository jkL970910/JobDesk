import type { Metadata } from "next";

import { AccessProvider } from "../src/components/access-provider";
import { isAccountAuthConfigured, isAccessTokenConfigured } from "../src/server/access-guard";
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
  const accountAuthConfigured = isAccountAuthConfigured();
  return (
    <html lang="en">
      <body>
        <AccessProvider
          accountAuthConfigured={accountAuthConfigured}
          configured={isAccessTokenConfigured() || accountAuthConfigured}
        >
          {children}
        </AccessProvider>
      </body>
    </html>
  );
}
