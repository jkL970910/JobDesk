import { describe, expect, it } from "vitest";

import {
  isAccessTokenConfigured,
  validateRequestAccess,
  validateAccessToken,
} from "../src/server/access-guard";
import { serializeSessionCookie } from "../src/server/auth-service";

describe("access guard", () => {
  it("allows requests when no access token is configured", () => {
    const env = {} as NodeJS.ProcessEnv;
    expect(isAccessTokenConfigured(env)).toBe(false);

    const result = validateAccessToken(new Request("http://localhost/api/jobs"), env);
    expect(result.ok).toBe(true);
  });

  it("rejects missing or invalid bearer tokens when configured", async () => {
    const env = {
      JOBDESK_ACCESS_TOKEN: "local-secret",
      NODE_ENV: "test",
    } as NodeJS.ProcessEnv;

    const result = validateAccessToken(new Request("http://localhost/api/jobs"), env);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(401);
      await expect(result.response.json()).resolves.toMatchObject({
        kind: "unauthorized",
      });
    }
  });

  it("accepts the configured bearer token", () => {
    const env = {
      JOBDESK_ACCESS_TOKEN: "local-secret",
      NODE_ENV: "test",
    } as NodeJS.ProcessEnv;
    const request = new Request("http://localhost/api/jobs", {
      headers: { Authorization: "Bearer local-secret" },
    });

    expect(validateAccessToken(request, env)).toEqual({ ok: true });
  });

  it("accepts a signed account session cookie when account auth is configured", async () => {
    const previousSecret = process.env.JOBDESK_SESSION_SECRET;
    process.env.JOBDESK_SESSION_SECRET = "test-session-secret";
    const env = {
      DATABASE_URL: "postgres://example/test",
      JOBDESK_SESSION_SECRET: "test-session-secret",
      NODE_ENV: "test",
    } as NodeJS.ProcessEnv;
    const cookie = serializeSessionCookie({
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      sessionId: "session-1",
      token: "session-token",
      userId: "user-1",
    });
    const request = new Request("http://localhost/api/jobs", {
      headers: { Cookie: cookie },
    });

    expect(await validateRequestAccess(request, env)).toMatchObject({
      ok: true,
      userId: "user-1",
    });
    process.env.JOBDESK_SESSION_SECRET = previousSecret;
  });

  it("allows auth endpoints without a token or session", async () => {
    const env = {
      DATABASE_URL: "postgres://example/test",
      JOBDESK_SESSION_SECRET: "test-session-secret",
      NODE_ENV: "test",
    } as NodeJS.ProcessEnv;

    expect(
      await validateRequestAccess(new Request("http://localhost/api/auth/login"), env),
    ).toEqual({ ok: true });
  });
});
