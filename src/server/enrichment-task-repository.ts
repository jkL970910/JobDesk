import crypto from "node:crypto";

import { and, desc, eq, inArray, sql } from "drizzle-orm";

import { resolveJobDeskAiConfig } from "../ai/config";
import { JobDeskAiError } from "../ai/errors";
import { extractProfileEvidenceWithAi } from "../ai/profile-evidence-extraction";
import { skillRegistry } from "../ai/skills-registry";
import type { ProfileEvidenceExtraction } from "../schemas/profile-evidence-extraction";
import type { JobDeskAiFailureKind, JobDeskAiSkillBinding } from "../ai/types";
import { getDb, hasDatabaseUrl } from "../db/client";
import {
  enrichmentTasks,
  evidenceItems,
  sourceDocuments,
  workflowRuns,
  type enrichmentTaskSourceTypeEnum,
  type enrichmentTaskStatusEnum,
  type enrichmentTaskTypeEnum,
} from "../db/schema";
import { workflowSkillFields } from "./workflow-run-metadata";
import { getCurrentWorkspace, getOrCreateDefaultWorkspace } from "./workspace-repository";

type DbHandle = ReturnType<typeof getDb>;

export type EnrichmentTaskType =
  (typeof enrichmentTaskTypeEnum.enumValues)[number];
export type EnrichmentTaskStatus =
  (typeof enrichmentTaskStatusEnum.enumValues)[number];
export type EnrichmentTaskSourceType =
  (typeof enrichmentTaskSourceTypeEnum.enumValues)[number];

export type EnrichmentTaskQueueFilters = {
  limit?: number;
  resumeReviewReportId?: string;
  resumeSourceVersionId?: string;
  sourceType?: EnrichmentTaskSourceType;
  statuses?: EnrichmentTaskStatus[];
};

export type EnrichmentTaskDraft = {
  taskType: EnrichmentTaskType;
  sourceType: EnrichmentTaskSourceType;
  sourceLabel: string;
  prompt: string;
  evidenceItemId?: string | null;
  workExperienceId?: string | null;
  initiativeId?: string | null;
  portfolioProjectId?: string | null;
  resumeSourceVersionId?: string | null;
  resumeReviewReportId?: string | null;
};

export async function getEnrichmentTaskQueue(filters: EnrichmentTaskQueueFilters | number = {}) {
  if (!hasDatabaseUrl()) {
    return {
      status: "skipped" as const,
      reason: "missing_database_url" as const,
      tasks: [],
    };
  }

  const db = getDb();
  const workspace = await getOrCreateDefaultWorkspace(db);
  const normalizedFilters =
    typeof filters === "number" ? ({ limit: filters } satisfies EnrichmentTaskQueueFilters) : filters;
  const limit = clampQueueLimit(normalizedFilters.limit);
  const conditions = [eq(enrichmentTasks.workspaceId, workspace.id)];
  if (normalizedFilters.sourceType) {
    conditions.push(eq(enrichmentTasks.sourceType, normalizedFilters.sourceType));
  }
  if (normalizedFilters.resumeSourceVersionId) {
    conditions.push(eq(enrichmentTasks.resumeSourceVersionId, normalizedFilters.resumeSourceVersionId));
  }
  if (normalizedFilters.resumeReviewReportId) {
    conditions.push(eq(enrichmentTasks.resumeReviewReportId, normalizedFilters.resumeReviewReportId));
  }
  if (normalizedFilters.statuses?.length) {
    conditions.push(inArray(enrichmentTasks.status, normalizedFilters.statuses));
  }
  const rows = await db
    .select()
    .from(enrichmentTasks)
    .where(and(...conditions))
    .orderBy(
      sql`case when ${enrichmentTasks.status} in ('open', 'answered') then 0 else 1 end`,
      desc(enrichmentTasks.updatedAt),
    )
    .limit(limit);

  return {
    status: "ready" as const,
    tasks: rows.map(toEnrichmentTaskPayload),
  };
}

function clampQueueLimit(limit?: number) {
  if (!Number.isFinite(limit)) return 50;
  return Math.max(1, Math.min(200, Math.floor(limit ?? 50)));
}

export async function upsertEnrichmentTasks(
  db: Pick<DbHandle, "insert">,
  args: {
    workspaceId: string;
    tasks: EnrichmentTaskDraft[];
    now?: Date;
  },
) {
  const now = args.now ?? new Date();
  const cleanTasks = args.tasks
    .map(normalizeTaskDraft)
    .filter((task): task is EnrichmentTaskDraft => task !== null);
  if (cleanTasks.length === 0) return [];

  const inserted = [];
  for (const task of cleanTasks) {
    const [row] = await db
      .insert(enrichmentTasks)
      .values({
        workspaceId: args.workspaceId,
        taskType: task.taskType,
        status: "open",
        sourceType: task.sourceType,
        sourceLabel: task.sourceLabel,
        prompt: task.prompt,
        dedupeKey: buildEnrichmentDedupeKey(task),
        evidenceItemId: task.evidenceItemId ?? null,
        workExperienceId: task.workExperienceId ?? null,
        initiativeId: task.initiativeId ?? null,
        portfolioProjectId: task.portfolioProjectId ?? null,
        resumeSourceVersionId: task.resumeSourceVersionId ?? null,
        resumeReviewReportId: task.resumeReviewReportId ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [enrichmentTasks.workspaceId, enrichmentTasks.dedupeKey],
        set: {
          sourceLabel: task.sourceLabel,
          prompt: task.prompt,
          updatedAt: sql`case when ${enrichmentTasks.status} in ('open', 'answered') then ${now} else ${enrichmentTasks.updatedAt} end`,
        },
        targetWhere: undefined,
        setWhere: sql`${enrichmentTasks.status} in ('open', 'answered')`,
      })
      .returning();
    if (row) inserted.push(row);
  }
  return inserted;
}

export function buildResumeReviewEnrichmentTasks(args: {
  resumeTitle: string;
  resumeSourceVersionId: string;
  resumeReviewReportId: string;
  missingEvidenceQuestions: string[];
}) {
  return args.missingEvidenceQuestions.map((question) => ({
    taskType: classifyEnrichmentTask(question),
    sourceType: "resume_review" as const,
    sourceLabel: `${args.resumeTitle} review`,
    prompt: question,
    resumeSourceVersionId: args.resumeSourceVersionId,
    resumeReviewReportId: args.resumeReviewReportId,
  }));
}

export function buildExtractionNoteEnrichmentTasks(args: {
  sourceTitle: string;
  notes: string[];
}) {
  return args.notes.map((note) => ({
    taskType: classifyEnrichmentTask(note),
    sourceType: "extraction_note" as const,
    sourceLabel: args.sourceTitle,
    prompt: note,
  }));
}

export async function updateEnrichmentTask(args: {
  taskId: string;
  action: "answer" | "dismiss" | "reopen" | "convert";
  userAnswer?: string;
  useAiExtraction?: boolean;
}) {
  if (!hasDatabaseUrl()) {
    return { status: "skipped" as const, reason: "missing_database_url" as const };
  }

  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const now = new Date();
  const [existing] = await db
    .select()
    .from(enrichmentTasks)
    .where(and(eq(enrichmentTasks.workspaceId, workspace.id), eq(enrichmentTasks.id, args.taskId)))
    .limit(1);
  if (!existing) return { status: "not_found" as const };

  if (args.action === "convert") {
    return convertEnrichmentTaskToEvidenceCandidate(db, {
      task: existing,
      now,
      useAiExtraction: args.useAiExtraction ?? false,
    });
  }

  const patch: Partial<typeof enrichmentTasks.$inferInsert> = {
    updatedAt: now,
  };
  if (args.action === "answer") {
    const answer = args.userAnswer?.trim();
    if (!answer) return { status: "invalid" as const, reason: "missing_answer" as const };
    patch.status = "answered";
    patch.userAnswer = answer;
    patch.answeredAt = now;
    patch.dismissedAt = null;
  } else if (args.action === "dismiss") {
    patch.status = "dismissed";
    patch.dismissedAt = now;
  } else if (args.action === "reopen") {
    patch.status = existing.userAnswer ? "answered" : "open";
    patch.dismissedAt = null;
  }

  const [updated] = await db
    .update(enrichmentTasks)
    .set(patch)
    .where(and(eq(enrichmentTasks.workspaceId, workspace.id), eq(enrichmentTasks.id, args.taskId)))
    .returning();
  return updated
    ? ({ status: "saved" as const, task: toEnrichmentTaskPayload(updated) })
    : ({ status: "not_found" as const });
}

async function convertEnrichmentTaskToEvidenceCandidate(
  db: DbHandle,
  args: {
    task: typeof enrichmentTasks.$inferSelect;
    now: Date;
    useAiExtraction: boolean;
  },
) {
  if (!args.task.userAnswer?.trim()) {
    return { status: "invalid" as const, reason: "missing_answer" as const };
  }
  if (args.task.status === "converted" && args.task.evidenceItemId) {
    return {
      status: "saved" as const,
      task: toEnrichmentTaskPayload(args.task),
      evidenceItemId: args.task.evidenceItemId,
    };
  }

  const content = args.task.userAnswer?.trim() ?? "";
  const aiExtraction = args.useAiExtraction
    ? await extractEnrichmentAnswerEvidence({
        sourceId: args.task.id,
        sourceText: buildEnrichmentAnswerSourceText(args.task, content),
      })
    : null;

  return db.transaction(async (tx) => {
    const [sourceDocument] = await tx
      .insert(sourceDocuments)
      .values({
        workspaceId: args.task.workspaceId,
        sourceType: "enrichment-answer",
        title: `Enrichment answer: ${args.task.sourceLabel}`,
        contentText: content,
        contentHash: crypto.createHash("sha256").update(content).digest("hex"),
        createdAt: args.now,
      })
      .returning({ id: sourceDocuments.id });
    if (!sourceDocument) {
      throw new Error("Failed to create enrichment answer source document.");
    }

    const evidenceDrafts = aiExtraction?.extraction.evidence_items.length
      ? aiExtraction.extraction.evidence_items
      : [buildFallbackEvidenceDraft(content)];
    const insertedEvidence = await tx
      .insert(evidenceItems)
      .values(
        evidenceDrafts.map((item) => ({
          workspaceId: args.task.workspaceId,
          sourceDocumentId: sourceDocument.id,
          text: item.text,
          sourceQuote: item.source_quote,
          evidenceType: item.evidence_type,
          metrics: item.metrics as Array<Record<string, unknown>>,
          sensitivityLevel: item.sensitivity_level,
          allowedUsage: item.allowed_usage,
          publicSafeSummary: item.public_safe_summary,
          status: item.status,
          relatedWorkExperienceId: args.task.workExperienceId,
          relatedInitiativeId: args.task.initiativeId,
          relatedPortfolioProjectId: args.task.portfolioProjectId,
          needsUserConfirmation: item.needs_user_confirmation ? 1 : 0,
          createdAt: args.now,
          updatedAt: args.now,
        })),
      )
      .returning({ id: evidenceItems.id });
    if (insertedEvidence.length === 0) {
      throw new Error("Failed to create evidence from enrichment answer.");
    }

    if (aiExtraction) {
      await tx.insert(workflowRuns).values({
        workspaceId: args.task.workspaceId,
        workflowType: "profile-evidence-extraction",
        status: "succeeded",
        provider: aiExtraction.provider,
        model: aiExtraction.model,
        ...workflowSkillFields(aiExtraction.skill),
        inputTokens: aiExtraction.usage.inputTokens ?? null,
        outputTokens: aiExtraction.usage.outputTokens ?? null,
        totalTokens: aiExtraction.usage.totalTokens ?? null,
        retryCount: aiExtraction.retryCount,
        startedAt: args.now,
        finishedAt: args.now,
      });
    }

    const [updated] = await tx
      .update(enrichmentTasks)
      .set({
        status: "converted",
        evidenceItemId: insertedEvidence[0]?.id ?? null,
        updatedAt: args.now,
        convertedAt: args.now,
      })
      .where(and(eq(enrichmentTasks.workspaceId, args.task.workspaceId), eq(enrichmentTasks.id, args.task.id)))
      .returning();
    if (!updated) throw new Error("Failed to mark enrichment task converted.");

    return {
      status: "saved" as const,
      task: toEnrichmentTaskPayload(updated),
      evidenceItemId: insertedEvidence[0]?.id ?? null,
      evidenceCount: insertedEvidence.length,
      conversionMode: aiExtraction ? "ai_extraction" as const : "fallback" as const,
    };
  });
}

async function extractEnrichmentAnswerEvidence(args: {
  sourceId: string;
  sourceText: string;
}) {
  const config = resolveJobDeskAiConfig();
  if (!config.providerEnabled || !config.apiKey) return null;

  try {
    const result = await extractProfileEvidenceWithAi({
      sourceId: args.sourceId,
      sourceText: args.sourceText,
      sourceKind: "project_note",
    });
    return {
      extraction: result.data,
      provider: `openrouter-compatible:${config.transport}`,
      model: config.model,
      usage: result.usage,
      retryCount: result.retryCount,
      skill: result.skill,
    };
  } catch (error) {
    await persistEnrichmentExtractionFailure({
      provider: `openrouter-compatible:${config.transport}`,
      model: config.model,
      errorKind: error instanceof JobDeskAiError ? error.kind : "unknown",
      errorMessage:
        error instanceof Error ? error.message : "Unknown enrichment extraction error.",
      retryCount: error instanceof JobDeskAiError ? error.retryCount : 0,
      skill: skillRegistry.profileEvidenceExtractionProjectNote,
    });
    return null;
  }
}

async function persistEnrichmentExtractionFailure(args: {
  provider: string;
  model: string;
  errorKind: JobDeskAiFailureKind | "unknown";
  errorMessage: string;
  retryCount: number;
  skill: JobDeskAiSkillBinding;
}) {
  if (!hasDatabaseUrl()) return;
  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const now = new Date();
  await db.insert(workflowRuns).values({
    workspaceId: workspace.id,
    workflowType: "profile-evidence-extraction",
    status: "failed",
    provider: args.provider,
    model: args.model,
    ...workflowSkillFields(args.skill),
    retryCount: args.retryCount,
    errorKind: args.errorKind,
    errorMessage: args.errorMessage.replace(/sk-[A-Za-z0-9_-]+/g, "sk-***"),
    startedAt: now,
    finishedAt: now,
  });
}

function buildEnrichmentAnswerSourceText(
  task: typeof enrichmentTasks.$inferSelect,
  answer: string,
) {
  return [
    `Source label: ${task.sourceLabel}`,
    `Task type: ${task.taskType}`,
    `Prompt: ${task.prompt}`,
    "User answer:",
    answer,
  ].join("\n");
}

function buildFallbackEvidenceDraft(
  content: string,
): ProfileEvidenceExtraction["evidence_items"][number] {
  return {
    text: content,
    source_quote: content,
    evidence_type: "user_confirmed",
    metrics: [],
    sensitivity_level: "private",
    allowed_usage: ["resume", "interview", "cover_letter"],
    public_safe_summary: null,
    status: "pending",
    related_project_id: null,
    related_work_experience_id: null,
    related_initiative_id: null,
    related_portfolio_project_id: null,
    needs_user_confirmation: true,
  };
}

export async function getOpenEnrichmentTaskCountsByEvidenceIds(evidenceIds: string[]) {
  if (!hasDatabaseUrl() || evidenceIds.length === 0) return new Map<string, number>();
  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const rows = await db
    .select({
      evidenceItemId: enrichmentTasks.evidenceItemId,
    })
    .from(enrichmentTasks)
    .where(
      and(
        eq(enrichmentTasks.workspaceId, workspace.id),
        inArray(enrichmentTasks.evidenceItemId, evidenceIds),
        inArray(enrichmentTasks.status, ["open", "answered"]),
      ),
    );
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.evidenceItemId) continue;
    counts.set(row.evidenceItemId, (counts.get(row.evidenceItemId) ?? 0) + 1);
  }
  return counts;
}

function normalizeTaskDraft(task: EnrichmentTaskDraft) {
  const prompt = task.prompt.trim();
  const sourceLabel = task.sourceLabel.trim();
  if (!prompt || !sourceLabel) return null;
  return {
    ...task,
    prompt,
    sourceLabel,
  };
}

function buildEnrichmentDedupeKey(task: EnrichmentTaskDraft) {
  const basis = [
    task.sourceType,
    task.resumeReviewReportId ?? "",
    normalizeText(task.sourceLabel),
    task.resumeSourceVersionId ?? "",
    task.evidenceItemId ?? "",
    task.workExperienceId ?? "",
    task.initiativeId ?? "",
    task.portfolioProjectId ?? "",
    normalizeText(task.prompt),
  ].join("|");
  return crypto.createHash("sha256").update(basis).digest("hex");
}

function classifyEnrichmentTask(prompt: string): EnrichmentTaskType {
  const text = prompt.toLowerCase();
  if (/\b(metric|measure|number|percent|%|revenue|cost|latency|volume)\b/.test(text)) {
    return "metric";
  }
  if (/\b(scope|scale|size|team|users|customers|traffic)\b/.test(text)) {
    return "scope";
  }
  if (/\b(owner|ownership|led|responsible|role|contribution)\b/.test(text)) {
    return "ownership";
  }
  if (/\b(technical|architecture|system|stack|implementation|algorithm)\b/.test(text)) {
    return "technical_depth";
  }
  if (/\b(stakeholder|partner|cross-functional|customer|manager)\b/.test(text)) {
    return "stakeholder";
  }
  if (/\b(result|impact|outcome|improved|reduced|increased)\b/.test(text)) {
    return "impact";
  }
  if (/\b(public|external|safe|confidential|redact)\b/.test(text)) {
    return "public_safe_wording";
  }
  return "star";
}

function normalizeText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function toEnrichmentTaskPayload(task: typeof enrichmentTasks.$inferSelect) {
  return {
    id: task.id,
    task_type: task.taskType,
    status: task.status,
    source_type: task.sourceType,
    source_label: task.sourceLabel,
    prompt: task.prompt,
    user_answer: task.userAnswer,
    evidence_item_id: task.evidenceItemId,
    work_experience_id: task.workExperienceId,
    initiative_id: task.initiativeId,
    portfolio_project_id: task.portfolioProjectId,
    resume_source_version_id: task.resumeSourceVersionId,
    resume_review_report_id: task.resumeReviewReportId,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    answeredAt: task.answeredAt?.toISOString() ?? null,
    convertedAt: task.convertedAt?.toISOString() ?? null,
    dismissedAt: task.dismissedAt?.toISOString() ?? null,
  };
}
