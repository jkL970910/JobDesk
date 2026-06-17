import crypto from "node:crypto";
import { promisify } from "node:util";
import { AsyncLocalStorage } from "node:async_hooks";

import { and, eq, gt } from "drizzle-orm";

import { getDb, hasDatabaseUrl } from "../db/client";
import { userSessions, users } from "../db/schema";
import { claimDefaultUnownedWorkspaceForUser } from "./workspace-repository";

const scryptAsync = promisify(crypto.scrypt);
const sessionCookieName = "jobdesk_session";
const sessionTtlMs = 30 * 24 * 60 * 60 * 1000;
const minPasswordLength = 8;
const contextStorage = new AsyncLocalStorage<{ userId: string | null }>();

type AuthSessionPayload = {
  expiresAt: string;
  sessionId: string;
  token: string;
  userId: string;
};

export type AuthUser = {
  id: string;
  email: string;
  displayName: string | null;
};

export function getSessionCookieName() {
  return sessionCookieName;
}

export function getCurrentUserId() {
  return contextStorage.getStore()?.userId ?? null;
}

export function runWithAuthContext<T>(userId: string | null, callback: () => T) {
  return contextStorage.run({ userId }, callback);
}

export async function registerUser(args: {
  email: string;
  password: string;
  displayName?: string | null;
}) {
  assertDatabaseConfigured();
  const email = normalizeEmail(args.email);
  validatePassword(args.password);
  const passwordHash = await hashPassword(args.password);
  const now = new Date();
  try {
    const [user] = await getDb()
      .insert(users)
      .values({
        displayName: args.displayName?.trim() || null,
        email,
        passwordHash,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!user) throw new Error("Failed to create user.");
    await claimDefaultUnownedWorkspaceForUser(getDb(), user.id);
    const session = await createSession(user.id);
    return { status: "created" as const, session, user: toAuthUser(user) };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { status: "email_taken" as const };
    }
    throw error;
  }
}

export async function loginUser(args: { email: string; password: string }) {
  assertDatabaseConfigured();
  const email = normalizeEmail(args.email);
  const [user] = await getDb().select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) return { status: "invalid_credentials" as const };
  const valid = await verifyPassword(args.password, user.passwordHash);
  if (!valid) return { status: "invalid_credentials" as const };
  const session = await createSession(user.id);
  return { status: "authenticated" as const, session, user: toAuthUser(user) };
}

export async function logoutSession(request: Request) {
  if (!hasDatabaseUrl()) return;
  const payload = parseSessionCookie(request);
  if (!payload) return;
  await getDb()
    .delete(userSessions)
    .where(eq(userSessions.id, payload.sessionId));
}

export async function getAuthenticatedUser(request: Request) {
  if (!hasDatabaseUrl()) return null;
  const payload = parseSessionCookie(request);
  if (!payload) return null;
  const now = new Date();
  const [row] = await getDb()
    .select({
      displayName: users.displayName,
      email: users.email,
      expiresAt: userSessions.expiresAt,
      id: users.id,
      sessionId: userSessions.id,
      tokenHash: userSessions.tokenHash,
    })
    .from(userSessions)
    .innerJoin(users, eq(userSessions.userId, users.id))
    .where(
      and(
        eq(userSessions.id, payload.sessionId),
        eq(userSessions.userId, payload.userId),
        gt(userSessions.expiresAt, now),
      ),
    )
    .limit(1);
  if (!row || row.tokenHash !== hashSessionToken(payload.token)) return null;
  void getDb()
    .update(userSessions)
    .set({ lastSeenAt: now })
    .where(eq(userSessions.id, payload.sessionId));
  return {
    sessionId: row.sessionId,
    user: {
      displayName: row.displayName,
      email: row.email,
      id: row.id,
    } satisfies AuthUser,
  };
}

export function parseSignedSessionCookie(request: Request) {
  return parseSessionCookie(request);
}

export function parseSignedSessionCookieValue(value: string | undefined | null) {
  if (!value) return null;
  return decodeSessionCookie(value);
}

export async function getRequestUserIdFromCookies() {
  const contextUserId = getCurrentUserId();
  if (contextUserId) return contextUserId;
  try {
    const { cookies } = await import("next/headers");
    const cookieStore = await cookies();
    return parseSignedSessionCookieValue(cookieStore.get(sessionCookieName)?.value)?.userId ?? null;
  } catch {
    return null;
  }
}

export function serializeSessionCookie(session: AuthSessionPayload) {
  return serializeCookie(sessionCookieName, encodeSessionCookie(session), {
    httpOnly: true,
    maxAge: Math.floor(sessionTtlMs / 1000),
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

export function serializeClearedSessionCookie() {
  return serializeCookie(sessionCookieName, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

export function requireSessionSecret(env: NodeJS.ProcessEnv = process.env) {
  const explicitSecret = env.JOBDESK_SESSION_SECRET?.trim();
  if (explicitSecret) return explicitSecret;
  if (env.NODE_ENV === "production" && hasDatabaseUrl()) {
    throw new Error("JOBDESK_SESSION_SECRET is required for production account sessions.");
  }
  return env.JOBDESK_ACCESS_TOKEN?.trim() || "jobdesk-local-dev-session-secret";
}

function assertDatabaseConfigured() {
  if (!hasDatabaseUrl()) {
    throw new Error("DATABASE_URL is required for account authentication.");
  }
}

async function createSession(userId: string) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + sessionTtlMs);
  const [session] = await getDb()
    .insert(userSessions)
    .values({
      expiresAt,
      tokenHash: hashSessionToken(token),
      userId,
    })
    .returning();
  if (!session) throw new Error("Failed to create session.");
  return {
    expiresAt: expiresAt.toISOString(),
    sessionId: session.id,
    token,
    userId,
  } satisfies AuthSessionPayload;
}

function parseSessionCookie(request: Request) {
  const raw = parseCookieHeader(request.headers.get("cookie") ?? "")[sessionCookieName];
  if (!raw) return null;
  return decodeSessionCookie(raw);
}

function encodeSessionCookie(payload: AuthSessionPayload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = signCookieBody(body);
  return `${body}.${signature}`;
}

function decodeSessionCookie(value: string) {
  const [body, signature] = value.split(".");
  if (!body || !signature || signCookieBody(body) !== signature) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as AuthSessionPayload;
    if (!payload.sessionId || !payload.token || !payload.userId) return null;
    if (Number.isNaN(Date.parse(payload.expiresAt)) || Date.parse(payload.expiresAt) <= Date.now()) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function signCookieBody(body: string) {
  const secret = requireSessionSecret();
  return crypto.createHmac("sha256", secret).update(body).digest("base64url");
}

async function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString("base64url");
  const hash = (await scryptAsync(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${hash.toString("base64url")}`;
}

async function verifyPassword(password: string, storedHash: string) {
  const [algorithm, salt, expected] = storedHash.split(":");
  if (algorithm !== "scrypt" || !salt || !expected) return false;
  const hash = (await scryptAsync(password, salt, 64)) as Buffer;
  const expectedBuffer = Buffer.from(expected, "base64url");
  return hash.length === expectedBuffer.length && crypto.timingSafeEqual(hash, expectedBuffer);
}

function hashSessionToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function normalizeEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) {
    throw new Error("Enter a valid email address.");
  }
  return normalized;
}

function validatePassword(password: string) {
  if (password.length < minPasswordLength) {
    throw new Error(`Password must be at least ${minPasswordLength} characters.`);
  }
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

function serializeCookie(
  name: string,
  value: string,
  options: {
    httpOnly: boolean;
    maxAge: number;
    path: string;
    sameSite: "lax" | "strict";
    secure: boolean;
  },
) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Max-Age=${options.maxAge}`,
    `Path=${options.path}`,
    `SameSite=${options.sameSite}`,
  ];
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

function toAuthUser(user: typeof users.$inferSelect): AuthUser {
  return {
    displayName: user.displayName,
    email: user.email,
    id: user.id,
  };
}

function isUniqueViolation(error: unknown) {
  const visited = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !visited.has(current)) {
    visited.add(current);
    const record = current as {
      cause?: unknown;
      code?: unknown;
      constraint?: unknown;
      detail?: unknown;
      message?: unknown;
    };
    if (record.code === "23505") return true;
    if (
      typeof record.constraint === "string" &&
      record.constraint.includes("users_email_idx")
    ) {
      return true;
    }
    if (
      typeof record.detail === "string" &&
      record.detail.toLowerCase().includes("already exists")
    ) {
      return true;
    }
    if (
      typeof record.message === "string" &&
      record.message.includes("users_email_idx")
    ) {
      return true;
    }
    current = record.cause;
  }
  return false;
}
