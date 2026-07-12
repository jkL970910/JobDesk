import { scopeCorrectionEvents } from "../db/schema";

type DbExecutor = {
  insert: (table: typeof scopeCorrectionEvents) => {
    values: (value: typeof scopeCorrectionEvents.$inferInsert) => Promise<unknown>;
  };
};

type SafeCorrectionSnapshot = {
  claimCount?: number;
  confidence?: string | null;
  entityStatus?: string | null;
  fromScope?: string | null;
  label?: string | null;
  sourceSection?: string | null;
  sourceState?: "linked" | "missing" | null;
  targetCount?: number;
  toScope?: string | null;
};

export async function recordScopeCorrectionEvent(
  db: DbExecutor,
  args: {
    action: string;
    after?: SafeCorrectionSnapshot | null;
    before?: SafeCorrectionSnapshot | null;
    entityId?: string | null;
    entityType: string;
    sourceCandidateId?: string | null;
    sourceTaskId?: string | null;
    workspaceId: string;
  },
) {
  await db.insert(scopeCorrectionEvents).values({
    workspaceId: args.workspaceId,
    actorType: "user",
    action: args.action,
    entityType: args.entityType,
    entityId: args.entityId ?? null,
    sourceCandidateId: args.sourceCandidateId ?? null,
    sourceTaskId: args.sourceTaskId ?? null,
    beforeJson: sanitizeCorrectionSnapshot(args.before),
    afterJson: sanitizeCorrectionSnapshot(args.after),
  });
}

function sanitizeCorrectionSnapshot(value?: SafeCorrectionSnapshot | null) {
  if (!value) return null;
  return {
    claimCount: normalizeNumber(value.claimCount),
    confidence: normalizeShortText(value.confidence),
    entityStatus: normalizeShortText(value.entityStatus),
    fromScope: normalizeShortText(value.fromScope),
    label: normalizeShortText(value.label),
    sourceSection: normalizeShortText(value.sourceSection),
    sourceState: value.sourceState === "linked" || value.sourceState === "missing" ? value.sourceState : null,
    targetCount: normalizeNumber(value.targetCount),
    toScope: normalizeShortText(value.toScope),
  };
}

function normalizeShortText(value: string | null | undefined) {
  const normalized = value?.trim().replace(/\s+/g, " ") ?? "";
  return normalized ? normalized.slice(0, 160) : null;
}

function normalizeNumber(value: number | undefined) {
  return Number.isFinite(value) ? value : undefined;
}
