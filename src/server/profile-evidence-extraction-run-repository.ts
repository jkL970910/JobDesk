import crypto from "node:crypto";

import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import { getDb, hasDatabaseUrl } from "../db/client";
import {
  profileEvidenceExtractionRuns,
  sourceDocuments,
  workspaces,
  type profileEvidenceExtractionRunStatusEnum,
} from "../db/schema";
import { getCurrentWorkspace, getOrCreateDefaultWorkspace } from "./workspace-repository";

type DbHandle = ReturnType<typeof getDb>;
type ExtractionRunStatus = (typeof profileEvidenceExtractionRunStatusEnum.enumValues)[number];
export const profileEvidenceExtractionRunStaleClaimableStatuses = [
  "queued",
  "parsing",
  "segmenting",
  "extracting_profile",
  "extracting_evidence",
  "validating",
] satisfies ExtractionRunStatus[];
const staleProcessingFailureMs = 10 * 60_000;

export type ExtractionRunPayload = ReturnType<typeof toRunPayload>;

export async function createProfileEvidenceExtractionRun(args: {
  resumeSourceVersionId?: string;
  sourceDocumentId?: string;
  sourceText: string;
  sourceTitle?: string;
  sourceType?: "profile-evidence" | "jd-gap-note" | "project-note";
}) {
  if (!hasDatabaseUrl()) {
    return { status: "skipped" as const, reason: "missing_database_url" as const };
  }
  const db = getDb();
  const workspace = await getOrCreateDefaultWorkspace(db);
  const now = new Date();
  const sourceText = args.sourceText.trim();
  const sourceSnapshotHash = hashSource(sourceText);
  const sourceDocument = args.sourceDocumentId
    ? await findSourceDocument(db, {
        sourceDocumentId: args.sourceDocumentId,
        workspaceId: workspace.id,
      })
    : null;
  const sourceTextSnapshot = sourceDocument?.contentHash === sourceSnapshotHash ? null : sourceText.slice(0, 50_000);
  const [run] = await db
    .insert(profileEvidenceExtractionRuns)
    .values({
      workspaceId: workspace.id,
      sourceDocumentId: args.sourceDocumentId,
      resumeSourceVersionId: args.resumeSourceVersionId,
      sourceType: args.sourceType ?? "profile-evidence",
      sourceTitle: args.sourceTitle?.trim() || "Untitled source",
      sourceTextSnapshot,
      sourceSnapshotHash,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return run ? ({ status: "created" as const, run: toRunPayload(run) }) : ({ status: "failed" as const });
}

export async function getProfileEvidenceExtractionRun(runId: string) {
  if (!hasDatabaseUrl()) {
    return { status: "skipped" as const, reason: "missing_database_url" as const };
  }
  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  await expireStaleProfileEvidenceExtractionRun(db, { runId, workspaceId: workspace.id });
  const [run] = await db
    .select()
    .from(profileEvidenceExtractionRuns)
    .where(and(eq(profileEvidenceExtractionRuns.workspaceId, workspace.id), eq(profileEvidenceExtractionRuns.id, runId)))
    .limit(1);
  return run ? ({ status: "ready" as const, run: toRunPayload(run) }) : ({ status: "not_found" as const });
}

export async function retryProfileEvidenceExtractionRun(runId: string) {
  if (!hasDatabaseUrl()) {
    return { status: "skipped" as const, reason: "missing_database_url" as const };
  }
  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const now = new Date();
  const [run] = await db
    .update(profileEvidenceExtractionRuns)
    .set({
      canRetry: 0,
      failureKind: null,
      failureMessage: null,
      failedAt: null,
      lockedAt: null,
      lockedBy: null,
      retryAfterSeconds: null,
      status: "queued",
      updatedAt: now,
    })
    .where(
      and(
        eq(profileEvidenceExtractionRuns.workspaceId, workspace.id),
        eq(profileEvidenceExtractionRuns.id, runId),
        eq(profileEvidenceExtractionRuns.status, "failed"),
        eq(profileEvidenceExtractionRuns.canRetry, 1),
      ),
    )
    .returning();
  return run ? ({ status: "queued" as const, run: toRunPayload(run) }) : ({ status: "not_retryable" as const });
}

export async function claimNextProfileEvidenceExtractionRun(workerId: string) {
  if (!hasDatabaseUrl()) {
    return { status: "skipped" as const, reason: "missing_database_url" as const };
  }
  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const now = new Date();
  const staleLock = new Date(now.getTime() - 15 * 60_000);
  const candidates = await db
    .select({ id: profileEvidenceExtractionRuns.id })
    .from(profileEvidenceExtractionRuns)
    .where(
      and(
        eq(profileEvidenceExtractionRuns.workspaceId, workspace.id),
        inArray(profileEvidenceExtractionRuns.status, profileEvidenceExtractionRunStaleClaimableStatuses),
        or(
          isNull(profileEvidenceExtractionRuns.lockedAt),
          sql`${profileEvidenceExtractionRuns.lockedAt} < ${staleLock}`,
        ),
      ),
    )
    .orderBy(asc(profileEvidenceExtractionRuns.updatedAt))
    .limit(1);
  const candidate = candidates[0];
  if (!candidate) return { status: "empty" as const };
  const [run] = await db
    .update(profileEvidenceExtractionRuns)
    .set({
      attemptCount: sql`${profileEvidenceExtractionRuns.attemptCount} + 1`,
      canRetry: 0,
      failureKind: null,
      failureMessage: null,
      failedAt: null,
      lockedAt: now,
      lockedBy: workerId,
      retryAfterSeconds: null,
      startedAt: now,
      status: "parsing",
      updatedAt: now,
    })
    .where(
      and(
        eq(profileEvidenceExtractionRuns.id, candidate.id),
        eq(profileEvidenceExtractionRuns.workspaceId, workspace.id),
        inArray(profileEvidenceExtractionRuns.status, profileEvidenceExtractionRunStaleClaimableStatuses),
        or(
          isNull(profileEvidenceExtractionRuns.lockedAt),
          sql`${profileEvidenceExtractionRuns.lockedAt} < ${staleLock}`,
        ),
      ),
    )
    .returning();
  return run ? ({ status: "claimed" as const, run: toRunPayload(run) }) : ({ status: "empty" as const });
}

export async function expireStaleProfileEvidenceExtractionRun(
  db: Pick<DbHandle, "update">,
  args: { runId: string; workspaceId: string; now?: Date },
) {
  const now = args.now ?? new Date();
  const staleBefore = new Date(now.getTime() - staleProcessingFailureMs);
  const [run] = await db
    .update(profileEvidenceExtractionRuns)
    .set({
      canRetry: 1,
      failedAt: now,
      failureKind: "worker_timeout",
      failureMessage: "Extraction processing stopped before it could finish. Retry from Add Material.",
      lockedAt: null,
      lockedBy: null,
      retryAfterSeconds: 10,
      status: "failed",
      updatedAt: now,
    })
    .where(
      and(
        eq(profileEvidenceExtractionRuns.id, args.runId),
        eq(profileEvidenceExtractionRuns.workspaceId, args.workspaceId),
        inArray(profileEvidenceExtractionRuns.status, profileEvidenceExtractionRunStaleClaimableStatuses),
        sql`${profileEvidenceExtractionRuns.lockedAt} < ${staleBefore}`,
      ),
    )
    .returning();
  return run ? ({ status: "expired" as const, run: toRunPayload(run) }) : ({ status: "unchanged" as const });
}

export async function claimProfileEvidenceExtractionRunById(runId: string, workerId: string) {
  if (!hasDatabaseUrl()) {
    return { status: "skipped" as const, reason: "missing_database_url" as const };
  }
  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const now = new Date();
  const staleLock = new Date(now.getTime() - 15 * 60_000);
  const [run] = await db
    .update(profileEvidenceExtractionRuns)
    .set({
      attemptCount: sql`${profileEvidenceExtractionRuns.attemptCount} + 1`,
      canRetry: 0,
      failureKind: null,
      failureMessage: null,
      failedAt: null,
      lockedAt: now,
      lockedBy: workerId,
      retryAfterSeconds: null,
      startedAt: now,
      status: "parsing",
      updatedAt: now,
    })
    .where(
      and(
        eq(profileEvidenceExtractionRuns.id, runId),
        eq(profileEvidenceExtractionRuns.workspaceId, workspace.id),
        inArray(profileEvidenceExtractionRuns.status, profileEvidenceExtractionRunStaleClaimableStatuses),
        or(
          isNull(profileEvidenceExtractionRuns.lockedAt),
          sql`${profileEvidenceExtractionRuns.lockedAt} < ${staleLock}`,
        ),
      ),
    )
    .returning();
  return run ? ({ status: "claimed" as const, run: toRunPayload(run) }) : ({ status: "not_claimable" as const });
}

export async function updateProfileEvidenceExtractionRunStatus(args: {
  runId: string;
  status: ExtractionRunStatus;
  workerId: string;
}) {
  const db = getDb();
  const [run] = await db
    .update(profileEvidenceExtractionRuns)
    .set({ status: args.status, updatedAt: new Date() })
    .where(and(eq(profileEvidenceExtractionRuns.id, args.runId), eq(profileEvidenceExtractionRuns.lockedBy, args.workerId)))
    .returning();
  return run ? toRunPayload(run) : null;
}

export async function saveProfileEvidenceExtractionRunProgress(args: {
  runId: string;
  status: ExtractionRunStatus;
  workerId: string;
  result: Record<string, unknown>;
}) {
  const db = getDb();
  const [run] = await db
    .update(profileEvidenceExtractionRuns)
    .set({
      lockedAt: null,
      lockedBy: null,
      resultJson: args.result,
      status: args.status,
      updatedAt: new Date(),
    })
    .where(and(eq(profileEvidenceExtractionRuns.id, args.runId), eq(profileEvidenceExtractionRuns.lockedBy, args.workerId)))
    .returning();
  return run ? toRunPayload(run) : null;
}

export async function completeProfileEvidenceExtractionRun(args: {
  runId: string;
  workerId: string;
  workflowRunId?: string;
  result: Record<string, unknown>;
}) {
  const db = getDb();
  const now = new Date();
  const [run] = await db
    .update(profileEvidenceExtractionRuns)
    .set({
      completedAt: now,
      lockedAt: null,
      lockedBy: null,
      resultJson: args.result,
      status: "completed",
      updatedAt: now,
      workflowRunId: args.workflowRunId,
    })
    .where(and(eq(profileEvidenceExtractionRuns.id, args.runId), eq(profileEvidenceExtractionRuns.lockedBy, args.workerId)))
    .returning();
  return run ? toRunPayload(run) : null;
}

export async function failProfileEvidenceExtractionRun(args: {
  runId: string;
  workerId: string;
  failureKind: string;
  failureMessage: string;
  canRetry: boolean;
  retryAfterSeconds?: number;
}) {
  const db = getDb();
  const now = new Date();
  const [run] = await db
    .update(profileEvidenceExtractionRuns)
    .set({
      canRetry: args.canRetry ? 1 : 0,
      failedAt: now,
      failureKind: args.failureKind,
      failureMessage: sanitizeFailure(args.failureMessage),
      lockedAt: null,
      lockedBy: null,
      retryAfterSeconds: args.retryAfterSeconds,
      status: "failed",
      updatedAt: now,
    })
    .where(and(eq(profileEvidenceExtractionRuns.id, args.runId), eq(profileEvidenceExtractionRuns.lockedBy, args.workerId)))
    .returning();
  return run ? toRunPayload(run) : null;
}

export async function resolveProfileEvidenceExtractionRunSource(runId: string) {
  const db = getDb();
  const [run] = await db
    .select()
    .from(profileEvidenceExtractionRuns)
    .where(eq(profileEvidenceExtractionRuns.id, runId))
    .limit(1);
  if (!run) return null;
  if (run.sourceTextSnapshot?.trim()) {
    return { run: toRunPayload(run), sourceText: run.sourceTextSnapshot };
  }
  if (!run.sourceDocumentId) return { run: toRunPayload(run), sourceText: "" };
  const [source] = await db
    .select({ contentText: sourceDocuments.contentText })
    .from(sourceDocuments)
    .where(and(eq(sourceDocuments.id, run.sourceDocumentId), eq(sourceDocuments.workspaceId, run.workspaceId)))
    .limit(1);
  return { run: toRunPayload(run), sourceText: source?.contentText ?? "" };
}

export async function getProfileEvidenceExtractionRunOwner(runId: string) {
  if (!hasDatabaseUrl()) {
    return { status: "skipped" as const, reason: "missing_database_url" as const };
  }
  const db = getDb();
  const [row] = await db
    .select({
      userId: workspaces.userId,
      workspaceId: profileEvidenceExtractionRuns.workspaceId,
    })
    .from(profileEvidenceExtractionRuns)
    .innerJoin(workspaces, eq(workspaces.id, profileEvidenceExtractionRuns.workspaceId))
    .where(eq(profileEvidenceExtractionRuns.id, runId))
    .limit(1);
  return row ? ({ status: "ready" as const, ...row }) : ({ status: "not_found" as const });
}

async function findSourceDocument(
  db: Pick<DbHandle, "select">,
  args: { sourceDocumentId: string; workspaceId: string },
) {
  const [source] = await db
    .select({ contentHash: sourceDocuments.contentHash })
    .from(sourceDocuments)
    .where(and(eq(sourceDocuments.id, args.sourceDocumentId), eq(sourceDocuments.workspaceId, args.workspaceId)))
    .limit(1);
  return source ?? null;
}

function toRunPayload(run: typeof profileEvidenceExtractionRuns.$inferSelect) {
  return {
    id: run.id,
    workspaceId: run.workspaceId,
    sourceDocumentId: run.sourceDocumentId,
    resumeSourceVersionId: run.resumeSourceVersionId,
    sourceType: run.sourceType,
    sourceTitle: run.sourceTitle,
    status: run.status,
    result: run.resultJson,
    failureKind: run.failureKind,
    failureMessage: run.failureMessage,
    canRetry: run.canRetry === 1,
    retryAfterSeconds: run.retryAfterSeconds,
    attemptCount: run.attemptCount,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
    failedAt: run.failedAt?.toISOString() ?? null,
  };
}

function hashSource(sourceText: string) {
  return crypto.createHash("sha256").update(sourceText).digest("hex");
}

function sanitizeFailure(message: string) {
  return message.replace(/sk-[A-Za-z0-9_-]+/g, "sk-***").slice(0, 2000);
}
