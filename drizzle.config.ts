import { existsSync } from "node:fs";

import { defineConfig } from "drizzle-kit";

import { loadDotEnv } from "./src/ai/env";

if (existsSync(".env")) {
  loadDotEnv(".env");
}

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: normalizeDatabaseUrlForPg(
      process.env.DATABASE_URL ??
        "postgresql://jobdesk:jobdesk@127.0.0.1:5432/jobdesk",
    ),
  },
});

function normalizeDatabaseUrlForPg(databaseUrl: string) {
  try {
    const url = new URL(databaseUrl);
    const sslMode = url.searchParams.get("sslmode");
    if (sslMode === "prefer" || sslMode === "require" || sslMode === "verify-ca") {
      url.searchParams.set("sslmode", "verify-full");
    }
    return url.toString();
  } catch {
    return databaseUrl;
  }
}
