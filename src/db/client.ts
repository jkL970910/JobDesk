import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import * as schema from "./schema";

const { Pool } = pg;

declare global {
  // eslint-disable-next-line no-var
  var __jobdeskPgPool: pg.Pool | undefined;
}

export function hasDatabaseUrl() {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function getDb() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const pool =
    globalThis.__jobdeskPgPool ??
    new Pool({
      connectionString: normalizeDatabaseUrlForPg(databaseUrl),
    });

  if (process.env.NODE_ENV !== "production") {
    globalThis.__jobdeskPgPool = pool;
  }

  return drizzle(pool, { schema });
}

export function normalizeDatabaseUrlForPg(databaseUrl: string) {
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
