import { beforeAll, describe, expect, it } from "vitest";

import { loadDotEnv } from "../src/ai/env";
import { registerUser } from "../src/server/auth-service";

const runIntegration = process.env.JOBDESK_RUN_DB_INTEGRATION === "true";

describe.skipIf(!runIntegration)("auth service database integration", () => {
  beforeAll(() => {
    loadDotEnv();
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required for DB integration tests.");
    }
  });

  it("returns email_taken for duplicate registration emails", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const email = `auth-duplicate-${suffix}@example.com`;

    const first = await registerUser({
      displayName: "Duplicate Auth",
      email,
      password: "Password123!",
    });
    expect(first.status).toBe("created");

    const duplicate = await registerUser({
      displayName: "Duplicate Auth 2",
      email,
      password: "Password123!",
    });
    expect(duplicate).toEqual({ status: "email_taken" });
  });
});
