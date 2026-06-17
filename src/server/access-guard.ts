import { NextResponse } from "next/server";

const sessionCookieName = "jobdesk_session";

export function isAccessTokenConfigured(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(env.JOBDESK_ACCESS_TOKEN?.trim());
}

export function isAccountAuthConfigured(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(env.DATABASE_URL?.trim());
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

export async function validateRequestAccess(
  request: Request,
  env: NodeJS.ProcessEnv = process.env,
) {
  const pathname = new URL(request.url).pathname;
  if (pathname.startsWith("/api/auth/")) return { ok: true as const };

  if (isAccessTokenConfigured(env)) {
    const legacyAccess = validateAccessToken(request, env);
    if (legacyAccess.ok) return legacyAccess;
  }

  if (!isAccountAuthConfigured(env)) {
    return validateAccessToken(request, env);
  }

  const session = await validateSignedSessionCookie(request, env);
  if (session.ok) return session;

  return {
    ok: false as const,
    response: NextResponse.json(
      { error: "Sign in to use JobDesk.", kind: "unauthorized" },
      { status: 401 },
    ),
  };
}

async function validateSignedSessionCookie(
  request: Request,
  env: NodeJS.ProcessEnv,
) {
  const raw = parseCookieHeader(request.headers.get("cookie") ?? "")[sessionCookieName];
  if (!raw) return { ok: false as const };
  const [body, signature] = raw.split(".");
  if (!body || !signature) return { ok: false as const };
  let expected: string;
  try {
    expected = await signCookieBody(body, env);
  } catch {
    return { ok: false as const };
  }
  if (expected !== signature) return { ok: false as const };
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
      expiresAt?: string;
      userId?: string;
    };
    if (!payload.userId || !payload.expiresAt) return { ok: false as const };
    if (Date.parse(payload.expiresAt) <= Date.now()) return { ok: false as const };
    return { ok: true as const, userId: payload.userId };
  } catch {
    return { ok: false as const };
  }
}

async function signCookieBody(body: string, env: NodeJS.ProcessEnv) {
  const secret = getSessionSecret(env);
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const signature = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );
  return Buffer.from(signature).toString("base64url");
}

function getSessionSecret(env: NodeJS.ProcessEnv) {
  const explicitSecret = env.JOBDESK_SESSION_SECRET?.trim();
  if (explicitSecret) return explicitSecret;
  if (env.NODE_ENV === "production" && env.DATABASE_URL?.trim()) {
    throw new Error("JOBDESK_SESSION_SECRET is required for production account sessions.");
  }
  return env.JOBDESK_ACCESS_TOKEN?.trim() || "jobdesk-local-dev-session-secret";
}

function parseCookieHeader(header: string) {
  const cookies: Record<string, string> = {};
  for (const segment of header.split(";")) {
    const [name, ...rest] = segment.trim().split("=");
    if (!name || rest.length === 0) continue;
    cookies[name] = decodeURIComponent(rest.join("="));
  }
  return cookies;
}
