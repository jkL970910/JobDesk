import crypto from "node:crypto";

import { NextResponse } from "next/server";

type ProcessOnceResult =
  | { status: "skipped"; reason: string }
  | { status: "empty" }
  | { status: "failed"; reason?: string; run?: unknown; runId?: string }
  | { status: "completed"; run: unknown };
type ProcessOnceWorker = () => Promise<ProcessOnceResult>;
type CronSecretEnv = Record<string, string | undefined>;

const PROCESS_LIMIT = 1;

export async function handleProfileEvidenceExtractionProcessOnceRequest(
  request: Request,
  worker: ProcessOnceWorker = runProductionWorkerOnce,
  env: CronSecretEnv = process.env,
) {
  const auth = validateCronSecret(request, env);
  if (!auth.ok) {
    return NextResponse.json(
      { error: auth.error, kind: auth.kind },
      { status: auth.status },
    );
  }

  const result = await worker();
  return NextResponse.json({
    data: {
      limit: PROCESS_LIMIT,
      processedCount: result.status === "completed" || result.status === "failed" ? 1 : 0,
      result,
    },
  });
}

async function runProductionWorkerOnce() {
  const { runProfileEvidenceExtractionWorkerOnce } = await import("./profile-evidence-extraction-worker");
  return runProfileEvidenceExtractionWorkerOnce();
}

function validateCronSecret(request: Request, env: CronSecretEnv) {
  const secret = env.CRON_SECRET;
  if (!secret?.trim()) {
    return {
      ok: false as const,
      error: "CRON_SECRET is not configured.",
      kind: "cron_secret_missing",
      status: 503,
    };
  }

  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!timingSafeEqual(header, expected)) {
    return {
      ok: false as const,
      error: "Unauthorized worker trigger.",
      kind: "unauthorized",
      status: 401,
    };
  }

  return { ok: true as const };
}

function timingSafeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
