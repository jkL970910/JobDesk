import { describe, expect, it } from "vitest";

import {
  isAccessTokenConfigured,
  validateAccessToken,
} from "../src/server/access-guard";

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
});
