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
    url:
      process.env.DATABASE_URL ??
      "postgresql://jobdesk:jobdesk@127.0.0.1:5432/jobdesk",
  },
});

