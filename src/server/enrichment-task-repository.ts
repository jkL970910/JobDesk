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
  enrichmentTaskTargets,
  enrichmentTasks,
  evidenceItems,
  initiatives,
  portfolioProjects,
  sourceDocuments,
  workExperiences,
  workflowRuns,
  type enrichmentTaskSourceTypeEnum,
  type enrichmentTaskStatusEnum,
  type enrichmentTaskExpectedOutcomeEnum,
  type enrichmentTaskTargetConfidenceEnum,
  type enrichmentTaskTargetKindEnum,
  type enrichmentTaskTargetRoleEnum,
  type enrichmentTaskTargetScopeEnum,
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
export type EnrichmentTaskTargetScope =
  (typeof enrichmentTaskTargetScopeEnum.enumValues)[number];
export type EnrichmentTaskTargetConfidence =
  (typeof enrichmentTaskTargetConfidenceEnum.enumValues)[number];
export type EnrichmentTaskExpectedOutcome =
  (typeof enrichmentTaskExpectedOutcomeEnum.enumValues)[number];
export type EnrichmentTaskTargetKind =
  (typeof enrichmentTaskTargetKindEnum.enumValues)[number];
export type EnrichmentTaskTargetRole =
  (typeof enrichmentTaskTargetRoleEnum.enumValues)[number];

export type EnrichmentTaskTargetPayload = {
  target_kind: EnrichmentTaskTargetKind;
  target_id: string;
  target_role: EnrichmentTaskTargetRole;
  confidence: EnrichmentTaskTargetConfidence;
  reason: string | null;
};

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
  targetScope?: EnrichmentTaskTargetScope;
  targetConfidence?: EnrichmentTaskTargetConfidence;
  targetReason?: string | null;
  expectedOutcome?: EnrichmentTaskExpectedOutcome;
  evidenceItemId?: string | null;
  workExperienceId?: string | null;
  initiativeId?: string | null;
  portfolioProjectId?: string | null;
  resumeSourceVersionId?: string | null;
  resumeReviewReportId?: string | null;
};

export type EnrichmentAnswerExtractorResult = {
  extraction: ProfileEvidenceExtraction;
  provider: string;
  model: string;
  usage: { inputTokens?: number | null; outputTokens?: number | null; totalTokens?: number | null };
  retryCount: number;
  skill: JobDeskAiSkillBinding;
};

type ReusableLibraryAnchor = {
  evidenceItemId?: string | null;
  workExperienceId?: string | null;
  initiativeId?: string | null;
  portfolioProjectId?: string | null;
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
  const targetMap = await getTaskTargetMap(db, rows.map((row) => row.id));

  return {
    status: "ready" as const,
    tasks: rows.map((row) => toEnrichmentTaskPayload(row, targetMap.get(row.id))),
  };
}

function clampQueueLimit(limit?: number) {
  if (!Number.isFinite(limit)) return 50;
  return Math.max(1, Math.min(200, Math.floor(limit ?? 50)));
}

export async function upsertEnrichmentTasks(
  db: Pick<DbHandle, "insert" | "delete">,
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
        ...deriveTaskTargetMetadata(task),
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
    if (row) {
      await replaceTaskTargets(db, {
        workspaceId: args.workspaceId,
        taskId: row.id,
        anchor: task,
        reason: "Initial target inferred from task source.",
        confidence: hasReusableLibraryAnchor(task) ? "medium" : "low",
      });
    }
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
  return args.notes.map((note) => {
    if (isSourceSectionExtractionNote(note)) {
      return {
        taskType: "source_section_review" as const,
        sourceType: "extraction_note" as const,
        sourceLabel: args.sourceTitle,
        prompt: note,
        targetScope: "source_material" as const,
        targetConfidence: "high" as const,
        targetReason:
          "This is an extraction note for an imported source section, not a missing-information question.",
        expectedOutcome: "review_imported_material" as const,
      };
    }
    return {
      taskType: classifyEnrichmentTask(note),
      sourceType: "extraction_note" as const,
      sourceLabel: args.sourceTitle,
      prompt: note,
    };
  });
}

export async function updateEnrichmentTask(args: {
  taskId: string;
  action: "answer" | "dismiss" | "reopen" | "convert" | "link";
  userAnswer?: string;
  anchor?: ReusableLibraryAnchor;
  useAiExtraction?: boolean;
  extractAnswerEvidence?: (args: {
    sourceId: string;
    sourceText: string;
  }) => Promise<EnrichmentAnswerExtractorResult | null>;
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
      extractAnswerEvidence: args.extractAnswerEvidence,
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
  } else if (args.action === "link") {
    const anchor = await validateReusableLibraryAnchor(db, {
      anchor: args.anchor ?? {},
      workspaceId: workspace.id,
    });
    if (anchor.status === "invalid") {
      return { status: "invalid" as const, reason: anchor.reason };
    }
    patch.evidenceItemId = anchor.anchor.evidenceItemId ?? null;
    patch.workExperienceId = anchor.anchor.workExperienceId ?? null;
    patch.initiativeId = anchor.anchor.initiativeId ?? null;
    patch.portfolioProjectId = anchor.anchor.portfolioProjectId ?? null;
    Object.assign(
      patch,
      deriveTaskTargetMetadata(anchor.anchor, "User selected this destination."),
    );
  }

  const [updated] = await db
    .update(enrichmentTasks)
    .set(patch)
    .where(and(eq(enrichmentTasks.workspaceId, workspace.id), eq(enrichmentTasks.id, args.taskId)))
    .returning();
  if (updated && args.action === "link") {
    await replaceTaskTargets(db, {
      workspaceId: workspace.id,
      taskId: updated.id,
      anchor: {
        evidenceItemId: updated.evidenceItemId,
        workExperienceId: updated.workExperienceId,
        initiativeId: updated.initiativeId,
        portfolioProjectId: updated.portfolioProjectId,
      },
      reason: "User selected this destination.",
      confidence: "high",
    });
  }
  const targetMap = updated ? await getTaskTargetMap(db, [updated.id]) : new Map();
  return updated
    ? ({ status: "saved" as const, task: toEnrichmentTaskPayload(updated, targetMap.get(updated.id)) })
    : ({ status: "not_found" as const });
}

export async function reconcileResumeReviewEnrichmentTasksForSource(
  db: Pick<DbHandle, "delete" | "insert" | "select" | "update">,
  args: {
    workspaceId: string;
    resumeSourceVersionId: string;
    anchors: Array<
      ReusableLibraryAnchor & {
        text: string;
        sourceQuote?: string | null;
      }
    >;
    now?: Date;
  },
) {
  const cleanAnchors = args.anchors.filter(hasReusableLibraryAnchor);
  if (cleanAnchors.length === 0) return { updatedCount: 0 };
  const now = args.now ?? new Date();
  const tasks = await db
    .select()
    .from(enrichmentTasks)
    .where(
      and(
        eq(enrichmentTasks.workspaceId, args.workspaceId),
        eq(enrichmentTasks.sourceType, "resume_review"),
        eq(enrichmentTasks.resumeSourceVersionId, args.resumeSourceVersionId),
        inArray(enrichmentTasks.status, ["open", "answered"]),
        sql`${enrichmentTasks.evidenceItemId} is null`,
        sql`${enrichmentTasks.workExperienceId} is null`,
        sql`${enrichmentTasks.initiativeId} is null`,
        sql`${enrichmentTasks.portfolioProjectId} is null`,
      ),
    );

  let updatedCount = 0;
  for (const task of tasks) {
    const anchor = pickBestAnchorForTask(task.prompt, cleanAnchors);
    const [updated] = await db
      .update(enrichmentTasks)
      .set({
        evidenceItemId: anchor.evidenceItemId ?? null,
        workExperienceId: anchor.workExperienceId ?? null,
        initiativeId: anchor.initiativeId ?? null,
        portfolioProjectId: anchor.portfolioProjectId ?? null,
        ...deriveTaskTargetMetadata(anchor, "Automatically matched to material from the same source."),
        updatedAt: now,
      })
      .where(
        and(
          eq(enrichmentTasks.workspaceId, args.workspaceId),
          eq(enrichmentTasks.id, task.id),
          sql`${enrichmentTasks.evidenceItemId} is null`,
          sql`${enrichmentTasks.workExperienceId} is null`,
          sql`${enrichmentTasks.initiativeId} is null`,
          sql`${enrichmentTasks.portfolioProjectId} is null`,
        ),
      )
      .returning({ id: enrichmentTasks.id });
    if (updated) {
      await replaceTaskTargets(db, {
        workspaceId: args.workspaceId,
        taskId: updated.id,
        anchor,
        reason: "Automatically matched to material from the same source.",
        confidence: "medium",
      });
      updatedCount += 1;
    }
  }
  return { updatedCount };
}

async function convertEnrichmentTaskToEvidenceCandidate(
  db: DbHandle,
  args: {
    task: typeof enrichmentTasks.$inferSelect;
    now: Date;
    useAiExtraction: boolean;
    extractAnswerEvidence?: (args: {
      sourceId: string;
      sourceText: string;
    }) => Promise<EnrichmentAnswerExtractorResult | null>;
  },
) {
  if (!args.task.userAnswer?.trim()) {
    return { status: "invalid" as const, reason: "missing_answer" as const };
  }
  if (args.task.status === "converted" && args.task.evidenceItemId) {
    const targetMap = await getTaskTargetMap(db, [args.task.id]);
    return {
      status: "saved" as const,
      task: toEnrichmentTaskPayload(args.task, targetMap.get(args.task.id)),
      evidenceItemId: args.task.evidenceItemId,
    };
  }

  const content = args.task.userAnswer?.trim() ?? "";
  const aiExtraction = args.useAiExtraction
    ? await (args.extractAnswerEvidence ?? extractEnrichmentAnswerEvidence)({
        sourceId: args.task.id,
        sourceText: content,
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
        evidenceDrafts.map((item) => {
          const guardrail = evaluateEnrichmentEvidenceGuardrails(item, content);
          return {
          workspaceId: args.task.workspaceId,
          sourceDocumentId: sourceDocument.id,
          text: item.text,
          sourceQuote: item.source_quote,
          evidenceType: item.evidence_type,
          metrics: guardrail.metrics,
          sensitivityLevel: item.sensitivity_level,
          allowedUsage: item.allowed_usage,
          publicSafeSummary: item.public_safe_summary,
          status: item.status,
          relatedWorkExperienceId: args.task.workExperienceId,
          relatedInitiativeId: args.task.initiativeId,
          relatedPortfolioProjectId: args.task.portfolioProjectId,
          needsUserConfirmation: guardrail.needsUserConfirmation ? 1 : 0,
          createdAt: args.now,
          updatedAt: args.now,
          };
        }),
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
    await replaceTaskTargets(tx, {
      workspaceId: args.task.workspaceId,
      taskId: updated.id,
      anchor: {
        evidenceItemId: updated.evidenceItemId,
        workExperienceId: updated.workExperienceId,
        initiativeId: updated.initiativeId,
        portfolioProjectId: updated.portfolioProjectId,
      },
      reason: "Converted answer created this evidence candidate.",
      confidence: "medium",
    });
    const targetMap = await getTaskTargetMap(tx, [updated.id]);

    return {
      status: "saved" as const,
      task: toEnrichmentTaskPayload(updated, targetMap.get(updated.id)),
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

function evaluateEnrichmentEvidenceGuardrails(
  item: ProfileEvidenceExtraction["evidence_items"][number],
  sourceText: string,
) {
  const quoteFound = sourceText.includes(item.source_quote);
  const groundedMetrics = item.metrics.filter((metric) =>
    sourceText.includes(metric.source_quote) &&
    metricNumbersAreInQuote(metric.value, metric.source_quote),
  );
  return {
    metrics: groundedMetrics as Array<Record<string, unknown>>,
    needsUserConfirmation:
      item.needs_user_confirmation ||
      item.evidence_type === "inferred" ||
      !quoteFound ||
      groundedMetrics.length !== item.metrics.length,
  };
}

function metricNumbersAreInQuote(value: string, quote: string) {
  const numbers = value.match(/\d+(?:[.,]\d+)?%?/g) ?? [];
  return numbers.every((number) => quote.includes(number));
}

async function validateReusableLibraryAnchor(
  db: Pick<DbHandle, "select">,
  args: {
    anchor: ReusableLibraryAnchor;
    workspaceId: string;
  },
):
  Promise<
    | { status: "valid"; anchor: ReusableLibraryAnchor }
    | {
        status: "invalid";
        reason:
          | "evidence_item_not_found"
          | "initiative_not_found"
          | "portfolio_project_not_found"
          | "work_experience_not_found";
      }
  > {
  const anchor = normalizeReusableLibraryAnchor(args.anchor);
  if (anchor.evidenceItemId) {
    const [item] = await db
      .select({ id: evidenceItems.id })
      .from(evidenceItems)
      .where(
        and(
          eq(evidenceItems.workspaceId, args.workspaceId),
          eq(evidenceItems.id, anchor.evidenceItemId),
        ),
      )
      .limit(1);
    if (!item) return { status: "invalid", reason: "evidence_item_not_found" };
  }
  if (anchor.initiativeId) {
    const [item] = await db
      .select({ id: initiatives.id })
      .from(initiatives)
      .where(and(eq(initiatives.workspaceId, args.workspaceId), eq(initiatives.id, anchor.initiativeId)))
      .limit(1);
    if (!item) return { status: "invalid", reason: "initiative_not_found" };
  }
  if (anchor.portfolioProjectId) {
    const [item] = await db
      .select({ id: portfolioProjects.id })
      .from(portfolioProjects)
      .where(
        and(
          eq(portfolioProjects.workspaceId, args.workspaceId),
          eq(portfolioProjects.id, anchor.portfolioProjectId),
        ),
      )
      .limit(1);
    if (!item) return { status: "invalid", reason: "portfolio_project_not_found" };
  }
  if (anchor.workExperienceId) {
    const [item] = await db
      .select({ id: workExperiences.id })
      .from(workExperiences)
      .where(
        and(
          eq(workExperiences.workspaceId, args.workspaceId),
          eq(workExperiences.id, anchor.workExperienceId),
        ),
      )
      .limit(1);
    if (!item) return { status: "invalid", reason: "work_experience_not_found" };
  }
  return { status: "valid", anchor };
}

function normalizeReusableLibraryAnchor(anchor: ReusableLibraryAnchor): ReusableLibraryAnchor {
  return {
    evidenceItemId: anchor.evidenceItemId ?? null,
    initiativeId: anchor.evidenceItemId ? null : anchor.initiativeId ?? null,
    portfolioProjectId: anchor.evidenceItemId || anchor.initiativeId ? null : anchor.portfolioProjectId ?? null,
    workExperienceId:
      anchor.evidenceItemId || anchor.initiativeId || anchor.portfolioProjectId
        ? null
        : anchor.workExperienceId ?? null,
  };
}

function hasReusableLibraryAnchor(anchor: ReusableLibraryAnchor) {
  return Boolean(
    anchor.evidenceItemId ||
      anchor.initiativeId ||
      anchor.portfolioProjectId ||
      anchor.workExperienceId,
  );
}

function pickBestAnchorForTask<T extends ReusableLibraryAnchor & { text: string; sourceQuote?: string | null }>(
  prompt: string,
  anchors: T[],
) {
  let best = anchors[0]!;
  let bestScore = -1;
  for (const anchor of anchors) {
    const score = scoreAnchorForTask(prompt, anchor);
    if (score > bestScore) {
      best = anchor;
      bestScore = score;
    }
  }
  return best;
}

function scoreAnchorForTask(
  prompt: string,
  anchor: ReusableLibraryAnchor & { text: string; sourceQuote?: string | null },
) {
  const promptTokens = new Set(toTaskTokens(prompt));
  const textTokens = new Set(toTaskTokens(`${anchor.text} ${anchor.sourceQuote ?? ""}`));
  let overlap = 0;
  for (const token of promptTokens) {
    if (textTokens.has(token)) overlap += 1;
  }
  const typeBonus = anchor.evidenceItemId
    ? 4
    : anchor.initiativeId || anchor.portfolioProjectId
      ? 2
      : 1;
  return overlap * 3 + typeBonus;
}

function toTaskTokens(value: string) {
  const stopWords = new Set([
    "about",
    "after",
    "before",
    "could",
    "from",
    "have",
    "more",
    "that",
    "their",
    "this",
    "with",
    "your",
  ]);
  return value
    .toLowerCase()
    .split(/[^a-z0-9%]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !stopWords.has(token));
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
  if (isSourceSectionExtractionNote(prompt)) {
    return "source_section_review";
  }
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

function isSourceSectionExtractionNote(prompt: string) {
  const text = normalizeText(prompt);
  return (
    /\b(entries|items|details)\s+were\s+extracted\s+from\s+the\s+.+\s+section\b/.test(text) ||
    /\b.+\s+was\s+extracted\s+from\s+the\s+.+\s+section\b/.test(text)
  );
}

function normalizeText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

async function getTaskTargetMap(
  db: Pick<DbHandle, "select">,
  taskIds: string[],
) {
  if (taskIds.length === 0) return new Map<string, EnrichmentTaskTargetPayload[]>();
  const rows = await db
    .select()
    .from(enrichmentTaskTargets)
    .where(inArray(enrichmentTaskTargets.taskId, taskIds));
  const map = new Map<string, EnrichmentTaskTargetPayload[]>();
  for (const row of rows) {
    const targets = map.get(row.taskId) ?? [];
    targets.push({
      target_kind: row.targetKind,
      target_id: row.targetId,
      target_role: row.targetRole,
      confidence: row.confidence,
      reason: row.reason,
    });
    map.set(row.taskId, targets);
  }
  return map;
}

async function replaceTaskTargets(
  db: Pick<DbHandle, "delete" | "insert">,
  args: {
    workspaceId: string;
    taskId: string;
    anchor: ReusableLibraryAnchor;
    confidence: EnrichmentTaskTargetConfidence;
    reason: string;
  },
) {
  await db
    .delete(enrichmentTaskTargets)
    .where(eq(enrichmentTaskTargets.taskId, args.taskId));
  const targets = buildTargetRows(args.anchor, {
    confidence: args.confidence,
    reason: args.reason,
    taskId: args.taskId,
    workspaceId: args.workspaceId,
  });
  if (targets.length === 0) return [];
  return db.insert(enrichmentTaskTargets).values(targets).returning();
}

function buildTargetRows(
  anchor: ReusableLibraryAnchor,
  args: {
    confidence: EnrichmentTaskTargetConfidence;
    reason: string;
    taskId: string;
    workspaceId: string;
  },
) {
  const rows: Array<typeof enrichmentTaskTargets.$inferInsert> = [];
  const add = (targetKind: EnrichmentTaskTargetKind, targetId?: string | null) => {
    if (!targetId) return;
    rows.push({
      workspaceId: args.workspaceId,
      taskId: args.taskId,
      targetKind,
      targetId,
      targetRole: rows.length === 0 ? "primary" : "parent",
      confidence: args.confidence,
      reason: args.reason,
    });
  };
  add("evidence", anchor.evidenceItemId);
  add("initiative", anchor.initiativeId);
  add("portfolio_project", anchor.portfolioProjectId);
  add("work_experience", anchor.workExperienceId);
  return rows;
}

function deriveTaskTargetMetadata(
  task: EnrichmentTaskDraft | ReusableLibraryAnchor,
  reason?: string,
): {
  targetScope: EnrichmentTaskTargetScope;
  targetConfidence: EnrichmentTaskTargetConfidence;
  targetReason: string;
  expectedOutcome: EnrichmentTaskExpectedOutcome;
} {
  if ("taskType" in task && task.taskType === "source_section_review") {
    return {
      targetScope: task.targetScope ?? "source_material",
      targetConfidence: task.targetConfidence ?? "high",
      targetReason:
        task.targetReason ??
        reason ??
        "This is an extraction note for imported source material, not a missing-information question.",
      expectedOutcome: task.expectedOutcome ?? "review_imported_material",
    };
  }
  const anchor = task;
  if (anchor.evidenceItemId) {
    return {
      targetScope: "evidence_detail",
      targetConfidence: "medium",
      targetReason: reason ?? "This question is attached to a specific evidence claim.",
      expectedOutcome: "update_evidence",
    };
  }
  if (anchor.initiativeId || anchor.portfolioProjectId) {
    return {
      targetScope: "story_context",
      targetConfidence: "medium",
      targetReason: reason ?? "This question is attached to a project or story.",
      expectedOutcome: "update_story",
    };
  }
  if (anchor.workExperienceId) {
    return {
      targetScope: "role_context",
      targetConfidence: "medium",
      targetReason: reason ?? "This question is attached to a role-level experience.",
      expectedOutcome: "update_role",
    };
  }
  return {
    targetScope: "assign_later",
    targetConfidence: "low",
    targetReason: reason ?? "No reusable library target is attached yet.",
    expectedOutcome: "clarify_assignment",
  };
}

function toEnrichmentTaskPayload(
  task: typeof enrichmentTasks.$inferSelect,
  targets: EnrichmentTaskTargetPayload[] = [],
) {
  const fallbackTargets = targets.length > 0 ? targets : buildFallbackTargetPayloads(task);
  return {
    id: task.id,
    task_type: task.taskType,
    status: task.status,
    source_type: task.sourceType,
    source_label: task.sourceLabel,
    prompt: task.prompt,
    user_answer: task.userAnswer,
    target_scope: task.targetScope,
    target_confidence: task.targetConfidence,
    target_reason: task.targetReason,
    expected_outcome: task.expectedOutcome,
    targets: fallbackTargets,
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

function buildFallbackTargetPayloads(
  task: typeof enrichmentTasks.$inferSelect,
): EnrichmentTaskTargetPayload[] {
  return buildTargetRows(
    {
      evidenceItemId: task.evidenceItemId,
      initiativeId: task.initiativeId,
      portfolioProjectId: task.portfolioProjectId,
      workExperienceId: task.workExperienceId,
    },
    {
      confidence: task.targetConfidence ?? "low",
      reason: task.targetReason ?? "Fallback from legacy destination fields.",
      taskId: task.id,
      workspaceId: task.workspaceId,
    },
  ).map((row) => ({
    target_kind: row.targetKind,
    target_id: row.targetId,
    target_role: row.targetRole ?? "primary",
    confidence: row.confidence ?? "low",
    reason: row.reason ?? null,
  }));
}
