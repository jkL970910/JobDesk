import { NextResponse } from "next/server";

export function isAccessTokenConfigured(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(env.JOBDESK_ACCESS_TOKEN?.trim());
}

export function validateAccessToken(
  request: Request,
  env: NodeJS.ProcessEnv = process.env,
) {
  const expected = env.JOBDESK_ACCESS_TOKEN?.trim();
  if (!expected) return { ok: true as const };

  const header = request.headers.get("authorization") ?? "";
  const token = header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (token === expected) return { ok: true as const };

  return {
    ok: false as const,
    response: NextResponse.json(
      { error: "JobDesk access token is required.", kind: "unauthorized" },
      { status: 401 },
    ),
  };
}

