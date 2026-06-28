import crypto from "node:crypto";

import { and, desc, eq, sql } from "drizzle-orm";

import { getDb, hasDatabaseUrl } from "../db/client";
import {
  resumeReviewReports,
  resumeSourceVersions,
  sourceDocuments,
  workflowRuns,
} from "../db/schema";
import { resolveJobDeskAiConfig } from "../ai/config";
import { JobDeskAiError } from "../ai/errors";
import { reviewResumeWithAi } from "../ai/resume-review";
import { skillRegistry } from "../ai/skills-registry";
import { buildResumeReviewReport, type ResumeReviewReport } from "./resume-review-service";
import type { ResumeReview } from "../schemas/resume-review";
import type {
  JobDeskAiFailureKind,
  JobDeskAiSkillBinding,
  JobDeskAiUsage,
} from "../ai/types";
import { workflowSkillFields } from "./workflow-run-metadata";
import {
  buildResumeReviewEnrichmentTasks,
  upsertEnrichmentTasks,
} from "./enrichment-task-repository";
import { getCurrentWorkspace, getOrCreateDefaultWorkspace } from "./workspace-repository";
import type { ResumeSourceParseResult } from "./resume-source-parser";
import { deleteRebuildSourceChunksForSource, indexSourceChunks } from "./source-chunk-service";

type DbHandle = ReturnType<typeof getDb>;

type ResumeReviewBuildResult = {
  report: ResumeReviewReport;
  provider: string;
  model: string;
  confidence: number;
  scopeNote: string;
  tenSecondScan: string;
  atsNotes: string[];
  fairnessCheck: ResumeReview["fairness_check"];
  providerFailureKind: JobDeskAiFailureKind | null;
  providerFailureMessage: string | null;
  retryCount: number;
  usage: JobDeskAiUsage;
  skill: JobDeskAiSkillBinding;
};

type ResumeReviewActiveRun = {
  id: string;
  status: "running" | "succeeded" | "failed" | "skipped";
  stage: "queued" | "reading_source" | "analyzing" | "validating" | "saving" | "completed" | "failed";
  startedAt: string;
  finishedAt: string | null;
  errorKind: string | null;
  errorMessage: string | null;
};

export async function getResumeReviewWorkspace(limit = 10) {
  if (!hasDatabaseUrl()) {
    return {
      status: "skipped" as const,
      reason: "missing_database_url" as const,
      resumes: [],
    };
  }

  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const resumes = await db
    .select()
    .from(resumeSourceVersions)
    .where(eq(resumeSourceVersions.workspaceId, workspace.id))
    .orderBy(desc(resumeSourceVersions.updatedAt))
    .limit(limit);
  const reports = resumes.length
    ? await db
        .select()
        .from(resumeReviewReports)
        .where(and(eq(resumeReviewReports.workspaceId, workspace.id), eq(resumeReviewReports.status, "ready")))
        .orderBy(desc(resumeReviewReports.updatedAt))
        .limit(limit * 3)
    : [];
  const activeRuns = resumes.length
    ? await db
        .select()
        .from(workflowRuns)
        .where(
          and(
            eq(workflowRuns.workspaceId, workspace.id),
            eq(workflowRuns.workflowType, skillRegistry.resumeReviewGeneral.workflowType),
            eq(workflowRuns.status, "running"),
          ),
        )
        .orderBy(desc(workflowRuns.startedAt))
        .limit(limit * 3)
    : [];
  const latestReportByResumeId = new Map<string, typeof resumeReviewReports.$inferSelect>();
  for (const report of reports) {
    if (!latestReportByResumeId.has(report.resumeSourceVersionId)) {
      latestReportByResumeId.set(report.resumeSourceVersionId, report);
    }
  }
  const activeRunByResumeId = new Map<string, typeof workflowRuns.$inferSelect>();
  for (const run of activeRuns) {
    const resumeSourceVersionId = getResumeSourceVersionIdFromWorkflowRun(run);
    if (resumeSourceVersionId && !activeRunByResumeId.has(resumeSourceVersionId)) {
      activeRunByResumeId.set(resumeSourceVersionId, run);
    }
  }

  return {
    status: "ready" as const,
    resumes: resumes.map((resume) =>
      toResumeSummary(
        resume,
        latestReportByResumeId.get(resume.id),
        activeRunByResumeId.get(resume.id),
      ),
    ),
  };
}

export async function getResumeSourceVersion(resumeSourceVersionId: string) {
  if (!hasDatabaseUrl()) {
    return { status: "skipped" as const, reason: "missing_database_url" as const };
  }
  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const [resume] = await db
    .select()
    .from(resumeSourceVersions)
    .where(and(eq(resumeSourceVersions.workspaceId, workspace.id), eq(resumeSourceVersions.id, resumeSourceVersionId)))
    .limit(1);
  if (!resume) return { status: "not_found" as const };
  return {
    status: "ready" as const,
    resume: toResumeSourcePayload(resume),
  };
}

export async function deleteResumeSourceVersion(resumeSourceVersionId: string) {
  if (!hasDatabaseUrl()) {
    return { status: "skipped" as const, reason: "missing_database_url" as const };
  }
  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const [resume] = await db
    .select()
    .from(resumeSourceVersions)
    .where(and(eq(resumeSourceVersions.workspaceId, workspace.id), eq(resumeSourceVersions.id, resumeSourceVersionId)))
    .limit(1);
  if (!resume) return { status: "not_found" as const };

  await db.transaction(async (tx) => {
    await deleteRebuildSourceChunksForSource({
      db: tx,
      sourceDocumentId: resume.sourceDocumentId,
      workspaceId: workspace.id,
    });
    await tx
      .delete(resumeSourceVersions)
      .where(and(eq(resumeSourceVersions.workspaceId, workspace.id), eq(resumeSourceVersions.id, resumeSourceVersionId)));
    await tx
      .delete(sourceDocuments)
      .where(and(eq(sourceDocuments.workspaceId, workspace.id), eq(sourceDocuments.id, resume.sourceDocumentId)));
  });

  return {
    status: "deleted" as const,
    resume: toResumeSourcePayload(resume),
  };
}

export async function rerunResumeReview(resumeSourceVersionId: string) {
  const started = await startResumeReviewRun(resumeSourceVersionId);
  if (started.status !== "created") return started;
  return processResumeReviewRun(started.run.id);
}

export async function startResumeReviewRun(resumeSourceVersionId: string) {
  if (!hasDatabaseUrl()) {
    return { status: "skipped" as const, reason: "missing_database_url" as const };
  }
  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const [resume] = await db
    .select()
    .from(resumeSourceVersions)
    .where(and(eq(resumeSourceVersions.workspaceId, workspace.id), eq(resumeSourceVersions.id, resumeSourceVersionId)))
    .limit(1);
  if (!resume) return { status: "not_found" as const };

  const existing = await findActiveResumeReviewRun(db, {
    workspaceId: workspace.id,
    resumeSourceVersionId: resume.id,
  });
  const latestReport = await findLatestResumeReviewReport(db, {
    workspaceId: workspace.id,
    resumeSourceVersionId: resume.id,
  });
  if (existing) {
    return {
      status: "created" as const,
      run: toResumeReviewRunPayload(existing),
      resume: toResumeSummary(resume, latestReport, existing),
    };
  }

  const now = new Date();
  const [run] = await db
    .insert(workflowRuns)
    .values({
      workspaceId: workspace.id,
      workflowType: skillRegistry.resumeReviewGeneral.workflowType,
      status: "running",
      ...workflowSkillFields(skillRegistry.resumeReviewGeneral),
      skillMetadata: {
        resumeSourceVersionId: resume.id,
        stage: "queued",
        trigger: "user_retry",
      },
      startedAt: now,
      finishedAt: null,
    })
    .returning();
  if (!run) throw new Error("Failed to create resume review run.");
  return {
    status: "created" as const,
    run: toResumeReviewRunPayload(run),
    resume: toResumeSummary(resume, latestReport, run),
  };
}

export async function getResumeReviewRun(runId: string) {
  if (!hasDatabaseUrl()) {
    return { status: "skipped" as const, reason: "missing_database_url" as const };
  }
  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const [run] = await db
    .select()
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.workspaceId, workspace.id),
        eq(workflowRuns.workflowType, skillRegistry.resumeReviewGeneral.workflowType),
        eq(workflowRuns.id, runId),
      ),
    )
    .limit(1);
  if (!run || getResumeSourceVersionIdFromWorkflowRun(run) == null) {
    return { status: "not_found" as const };
  }
  return { status: "ready" as const, run: toResumeReviewRunPayload(run) };
}

export async function processResumeReviewRun(runId: string) {
  if (!hasDatabaseUrl()) {
    return { status: "skipped" as const, reason: "missing_database_url" as const };
  }
  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const [run] = await db
    .select()
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.workspaceId, workspace.id),
        eq(workflowRuns.workflowType, skillRegistry.resumeReviewGeneral.workflowType),
        eq(workflowRuns.id, runId),
      ),
    )
    .limit(1);
  if (!run) return { status: "not_found" as const };
  if (run.status !== "running") {
    return { status: "ready" as const, run: toResumeReviewRunPayload(run) };
  }
  const resumeSourceVersionId = getResumeSourceVersionIdFromWorkflowRun(run);
  if (!resumeSourceVersionId) return { status: "not_found" as const };

  const [resume] = await db
    .select()
    .from(resumeSourceVersions)
    .where(and(eq(resumeSourceVersions.workspaceId, workspace.id), eq(resumeSourceVersions.id, resumeSourceVersionId)))
    .limit(1);
  if (!resume) return { status: "not_found" as const };

  await updateResumeReviewRunStage(db, {
    run,
    stage: "reading_source",
    workspaceId: workspace.id,
  });
  let review: ResumeReviewBuildResult;
  try {
    await updateResumeReviewRunStage(db, {
      run,
      stage: "analyzing",
      workspaceId: workspace.id,
    });
    review = await buildReviewReport({
      sourceTitle: resume.title,
      sourceText: resume.sourceText,
    });
    await updateResumeReviewRunStage(db, {
      run,
      stage: "validating",
      workspaceId: workspace.id,
    });
  } catch (error) {
    const failedRun = await finishResumeReviewRun(db, {
      errorKind: error instanceof JobDeskAiError ? error.kind : "provider_error",
      errorMessage: error instanceof Error ? error.message : "Unknown provider error.",
      run,
      status: "failed",
      workspaceId: workspace.id,
    });
    return { status: "failed" as const, run: toResumeReviewRunPayload(failedRun) };
  }

  await updateResumeReviewRunStage(db, {
    run,
    stage: "saving",
    workspaceId: workspace.id,
  });
  const saved = await persistResumeReviewResult({
    db,
    resume,
    review,
    workflowRunId: run.id,
    workspaceId: workspace.id,
  });
  const finishedRun = await finishResumeReviewRun(db, {
    errorKind: review.providerFailureKind,
    errorMessage: review.providerFailureMessage,
    review,
    run,
    status: review.providerFailureKind ? "failed" : "succeeded",
    workspaceId: workspace.id,
  });
  return {
    status: "saved" as const,
    run: toResumeReviewRunPayload(finishedRun),
    resume: saved.resume,
  };
}

export async function createResumeSourceVersion(args: {
  sourceTitle: string;
  sourceText: string;
  sourceKind: string;
  parseMetadata?: Pick<
    ResumeSourceParseResult,
    | "originalFilename"
    | "mimeType"
    | "fileSizeBytes"
    | "parserName"
    | "parserVersion"
    | "parseQuality"
  >;
}) {
  if (!hasDatabaseUrl()) {
    return { status: "skipped" as const, reason: "missing_database_url" as const };
  }

  const contentHash = crypto
    .createHash("sha256")
    .update(args.sourceText)
    .digest("hex");

  const db = getDb();
  const workspace = await getOrCreateDefaultWorkspace(db);
  const existing = await findResumeByHash(db, {
    workspaceId: workspace.id,
    contentHash,
  });
  if (existing) {
    return existing;
  }

  const review = await buildReviewReport(args);

  return getDb().transaction(async (tx) => {
    const now = new Date();
    const version = await inferNextResumeVersion(tx, workspace.id);
    const [sourceDocument] = await tx
      .insert(sourceDocuments)
      .values({
        workspaceId: workspace.id,
        sourceType: "resume-review",
        title: args.sourceTitle,
        originalFilename: args.parseMetadata?.originalFilename,
        mimeType: args.parseMetadata?.mimeType,
        fileSizeBytes: args.parseMetadata?.fileSizeBytes,
        contentText: args.sourceText,
        contentHash,
        parserName: args.parseMetadata?.parserName,
        parserVersion: args.parseMetadata?.parserVersion,
        parseStatus: args.parseMetadata?.parseQuality.status,
        parseWarnings: args.parseMetadata?.parseQuality.warnings ?? [],
        pageCount: args.parseMetadata?.parseQuality.pageCount,
        charCount: args.parseMetadata?.parseQuality.charCount ?? args.sourceText.length,
        wordCount: args.parseMetadata?.parseQuality.wordCount,
        lifecycleStatus: "reviewed",
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: sourceDocuments.id });
    if (!sourceDocument) throw new Error("Failed to save resume source document.");
    await indexSourceChunks({
      db: tx,
      workspaceId: workspace.id,
      sourceDocumentId: sourceDocument.id,
    });

    const [resume] = await tx
      .insert(resumeSourceVersions)
      .values({
        workspaceId: workspace.id,
        sourceDocumentId: sourceDocument.id,
        title: args.sourceTitle,
        contentHash,
        sourceKind: args.sourceKind,
        sourceText: args.sourceText,
        version,
        status: "uploaded",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!resume) throw new Error("Failed to save resume source version.");

    const workflowRunId = await createResumeReviewWorkflowRun(tx, {
      workspaceId: workspace.id,
      review,
      now,
    });
    const [savedReport] = await tx
      .insert(resumeReviewReports)
      .values({
        workspaceId: workspace.id,
        resumeSourceVersionId: resume.id,
        workflowRunId,
        overallScore: review.report.overallScore,
        rubricJson: buildReviewRubricPayload(review),
        strengths: review.report.strengths,
        weaknesses: review.report.weaknesses,
        recommendedActions: review.report.recommendedActions,
        missingEvidenceQuestions: review.report.missingEvidenceQuestions,
        riskFlags: review.report.riskFlags,
        status: "ready",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (savedReport) {
      await upsertEnrichmentTasks(tx, {
        workspaceId: workspace.id,
        now,
        tasks: buildResumeReviewEnrichmentTasks({
          resumeTitle: resume.title,
          resumeSourceVersionId: resume.id,
          resumeReviewReportId: savedReport.id,
          missingEvidenceQuestions: review.report.missingEvidenceQuestions,
        }),
      });
    }

    await tx
      .update(resumeSourceVersions)
      .set({
        status: "reviewed",
        lastReviewedAt: now,
        updatedAt: now,
      })
      .where(and(eq(resumeSourceVersions.workspaceId, workspace.id), eq(resumeSourceVersions.id, resume.id)));

    return {
      status: "saved" as const,
      resume: toResumeSummary(
        { ...resume, status: "reviewed", lastReviewedAt: now, updatedAt: now },
        savedReport,
      ),
    };
  });
}

function buildReviewRubricPayload(review: Awaited<ReturnType<typeof buildReviewReport>>) {
  return [
    ...review.report.rubric,
    {
      key: "review_metadata",
      label: "Review metadata",
      provider: review.provider,
      model: review.model,
      confidence: review.confidence,
      scopeNote: review.scopeNote,
      tenSecondScan: review.tenSecondScan,
      atsNotes: review.atsNotes,
      fairnessCheck: review.fairnessCheck,
      providerFailureKind: review.providerFailureKind,
      providerFailureMessage: review.providerFailureMessage,
      retryCount: review.retryCount,
    },
  ];
}

async function persistResumeReviewResult(args: {
  db: DbHandle;
  resume: typeof resumeSourceVersions.$inferSelect;
  review: ResumeReviewBuildResult;
  workflowRunId: string;
  workspaceId: string;
}) {
  const now = new Date();
  return args.db.transaction(async (tx) => {
    await tx
      .update(resumeReviewReports)
      .set({
        status: "stale",
        updatedAt: now,
      })
      .where(
        and(
          eq(resumeReviewReports.workspaceId, args.workspaceId),
          eq(resumeReviewReports.resumeSourceVersionId, args.resume.id),
        ),
      );
    const [savedReport] = await tx
      .insert(resumeReviewReports)
      .values({
        workspaceId: args.resume.workspaceId,
        resumeSourceVersionId: args.resume.id,
        workflowRunId: args.workflowRunId,
        overallScore: args.review.report.overallScore,
        rubricJson: buildReviewRubricPayload(args.review),
        strengths: args.review.report.strengths,
        weaknesses: args.review.report.weaknesses,
        recommendedActions: args.review.report.recommendedActions,
        missingEvidenceQuestions: args.review.report.missingEvidenceQuestions,
        riskFlags: args.review.report.riskFlags,
        status: "ready",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (savedReport) {
      await upsertEnrichmentTasks(tx, {
        workspaceId: args.resume.workspaceId,
        now,
        tasks: buildResumeReviewEnrichmentTasks({
          resumeTitle: args.resume.title,
          resumeSourceVersionId: args.resume.id,
          resumeReviewReportId: savedReport.id,
          missingEvidenceQuestions: args.review.report.missingEvidenceQuestions,
        }),
      });
    }
    await tx
      .update(resumeSourceVersions)
      .set({
        status: "reviewed",
        lastReviewedAt: now,
        updatedAt: now,
      })
      .where(and(eq(resumeSourceVersions.workspaceId, args.workspaceId), eq(resumeSourceVersions.id, args.resume.id)));
    return {
      status: "saved" as const,
      resume: toResumeSummary(
        { ...args.resume, status: "reviewed", lastReviewedAt: now, updatedAt: now },
        savedReport,
      ),
    };
  });
}

async function findActiveResumeReviewRun(
  db: Pick<DbHandle, "select">,
  args: {
    resumeSourceVersionId: string;
    workspaceId: string;
  },
) {
  const [run] = await db
    .select()
    .from(workflowRuns)
    .where(
      and(
        eq(workflowRuns.workspaceId, args.workspaceId),
        eq(workflowRuns.workflowType, skillRegistry.resumeReviewGeneral.workflowType),
        eq(workflowRuns.status, "running"),
        sql`${workflowRuns.skillMetadata}->>'resumeSourceVersionId' = ${args.resumeSourceVersionId}`,
      ),
    )
    .orderBy(desc(workflowRuns.startedAt))
    .limit(1);
  return run ?? null;
}

async function updateResumeReviewRunStage(
  db: Pick<DbHandle, "update">,
  args: {
    run: typeof workflowRuns.$inferSelect;
    stage: ResumeReviewActiveRun["stage"];
    workspaceId: string;
  },
) {
  const [updated] = await db
    .update(workflowRuns)
    .set({
      skillMetadata: {
        ...args.run.skillMetadata,
        stage: args.stage,
      },
    })
    .where(and(eq(workflowRuns.workspaceId, args.workspaceId), eq(workflowRuns.id, args.run.id)))
    .returning();
  return updated ?? args.run;
}

async function finishResumeReviewRun(
  db: Pick<DbHandle, "update">,
  args: {
    errorKind: string | null;
    errorMessage: string | null;
    review?: ResumeReviewBuildResult;
    run: typeof workflowRuns.$inferSelect;
    status: "succeeded" | "failed";
    workspaceId: string;
  },
) {
  const [updated] = await db
    .update(workflowRuns)
    .set({
      errorKind: args.errorKind,
      errorMessage: args.errorMessage ? sanitizeWorkflowError(args.errorMessage) : null,
      finishedAt: new Date(),
      inputTokens: args.review?.usage.inputTokens ?? args.run.inputTokens,
      model: args.review?.model ?? args.run.model,
      outputTokens: args.review?.usage.outputTokens ?? args.run.outputTokens,
      provider: args.review?.provider ?? args.run.provider,
      retryCount: args.review?.retryCount ?? args.run.retryCount,
      skillMetadata: {
        ...args.run.skillMetadata,
        stage: args.status === "succeeded" ? "completed" : "failed",
      },
      status: args.status,
      totalTokens: args.review?.usage.totalTokens ?? args.run.totalTokens,
    })
    .where(and(eq(workflowRuns.workspaceId, args.workspaceId), eq(workflowRuns.id, args.run.id)))
    .returning();
  return updated ?? args.run;
}

async function findResumeByHash(
  db: Pick<DbHandle, "select">,
  args: {
    workspaceId: string;
    contentHash: string;
  },
) {
  const [existing] = await db
    .select()
    .from(resumeSourceVersions)
    .where(
      and(
        eq(resumeSourceVersions.workspaceId, args.workspaceId),
      eq(resumeSourceVersions.contentHash, args.contentHash),
      ),
    )
    .limit(1);
  if (!existing) return null;
  const latestReport = await findLatestResumeReviewReport(db, {
    resumeSourceVersionId: existing.id,
    workspaceId: args.workspaceId,
  });
  return {
    status: "duplicate" as const,
    existingResume: toResumeSummary(existing, latestReport),
  };
}

async function findLatestResumeReviewReport(
  db: Pick<DbHandle, "select">,
  args: {
    resumeSourceVersionId: string;
    workspaceId: string;
  },
) {
  const [latestReport] = await db
    .select()
    .from(resumeReviewReports)
    .where(
      and(
        eq(resumeReviewReports.workspaceId, args.workspaceId),
        eq(resumeReviewReports.resumeSourceVersionId, args.resumeSourceVersionId),
        eq(resumeReviewReports.status, "ready"),
      ),
    )
    .orderBy(desc(resumeReviewReports.updatedAt))
    .limit(1);
  return latestReport;
}

async function buildReviewReport(args: {
  sourceTitle: string;
  sourceText: string;
}): Promise<ResumeReviewBuildResult> {
  const config = resolveJobDeskAiConfig();
  try {
    const result = await reviewResumeWithAi(args);
    return fromAiReview({
      review: result.data,
      provider: `openrouter-compatible:${config.transport}`,
      model: config.model,
      retryCount: result.retryCount,
      usage: result.usage,
      skill: result.skill,
    });
  } catch (error) {
    const fallback = buildResumeReviewReport(args.sourceText);
    return {
      report: fallback,
      provider: "deterministic-fallback",
      model: "local-rubric",
      confidence: 0.45,
      scopeNote:
        "Local fallback review used because the AI resume reviewer was unavailable.",
      tenSecondScan: "Local fallback review does not produce a recruiter scan.",
      atsNotes: [],
      fairnessCheck: {
        applied: true,
        note: "Fallback rubric does not penalize protected or proxy signals.",
        signals_not_penalized: [],
      },
      providerFailureKind:
        error instanceof JobDeskAiError ? error.kind : "provider_error",
      providerFailureMessage:
        error instanceof Error ? error.message : "Unknown provider error.",
      retryCount: error instanceof JobDeskAiError ? error.retryCount : 0,
      usage: {},
      skill: skillRegistry.resumeReviewGeneral,
    };
  }
}

function fromAiReview(args: {
  review: ResumeReview;
  provider: string;
  model: string;
  retryCount: number;
  usage: JobDeskAiUsage;
  skill: JobDeskAiSkillBinding;
}): ResumeReviewBuildResult {
  const report: ResumeReviewReport = {
    overallScore: args.review.score.overall,
    rubric: args.review.rubric.map((item) => ({
      evidenceQuestions: item.evidenceQuestions,
      findings: item.findings,
      helpedScore: item.helpedScore,
      key: item.key,
      label: item.label,
      loweredScore: item.loweredScore,
      score: item.score,
      maxScore: item.maxScore,
      note: item.note,
      nextAction: item.nextAction,
      raiseScore: item.raiseScore,
    })),
    strengths: args.review.strengths,
    weaknesses: args.review.weaknesses,
    recommendedActions: args.review.suggested_edits,
    missingEvidenceQuestions: args.review.missing_evidence_questions,
    riskFlags: args.review.risk_flags,
  };
  return {
    report,
    provider: args.provider,
    model: args.model,
    confidence: args.review.score.confidence,
    scopeNote: args.review.score.scope_note,
    tenSecondScan: args.review.ten_second_scan,
    atsNotes: args.review.ats_notes,
    fairnessCheck: args.review.fairness_check,
    providerFailureKind: null,
    providerFailureMessage: null,
    retryCount: args.retryCount,
    usage: args.usage,
    skill: args.skill,
  };
}

async function createResumeReviewWorkflowRun(
  db: Pick<DbHandle, "insert">,
  args: {
    workspaceId: string;
    review: ResumeReviewBuildResult;
    now: Date;
  },
) {
  const [workflowRun] = await db
    .insert(workflowRuns)
    .values({
      workspaceId: args.workspaceId,
      workflowType: args.review.skill.workflowType,
      status: args.review.providerFailureKind ? "failed" : "succeeded",
      provider: args.review.provider,
      model: args.review.model,
      ...workflowSkillFields(args.review.skill),
      inputTokens: args.review.usage.inputTokens ?? null,
      outputTokens: args.review.usage.outputTokens ?? null,
      totalTokens: args.review.usage.totalTokens ?? null,
      retryCount: args.review.retryCount,
      errorKind: args.review.providerFailureKind,
      errorMessage: args.review.providerFailureMessage
        ? sanitizeWorkflowError(args.review.providerFailureMessage)
        : null,
      startedAt: args.now,
      finishedAt: args.now,
    })
    .returning({ id: workflowRuns.id });
  if (!workflowRun) {
    throw new Error("Failed to create resume review workflow run.");
  }
  return workflowRun.id;
}

export async function markResumeSourceExtracted(resumeSourceVersionId: string) {
  if (!hasDatabaseUrl()) {
    return { status: "skipped" as const, reason: "missing_database_url" as const };
  }
  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const now = new Date();
  const [resume] = await db
    .update(resumeSourceVersions)
    .set({
      status: "extracted",
      extractedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(resumeSourceVersions.workspaceId, workspace.id),
        eq(resumeSourceVersions.id, resumeSourceVersionId),
      ),
    )
    .returning();
  return resume
    ? ({ status: "saved" as const, resume: toResumeSourcePayload(resume) })
    : ({ status: "not_found" as const });
}

async function inferNextResumeVersion(
  db: Pick<DbHandle, "select">,
  workspaceId: string,
) {
  const [latest] = await db
    .select({ version: resumeSourceVersions.version })
    .from(resumeSourceVersions)
    .where(eq(resumeSourceVersions.workspaceId, workspaceId))
    .orderBy(desc(resumeSourceVersions.version))
    .limit(1);
  return (latest?.version ?? 0) + 1;
}

function toResumeSummary(
  resume: typeof resumeSourceVersions.$inferSelect,
  report?: typeof resumeReviewReports.$inferSelect,
  activeRun?: typeof workflowRuns.$inferSelect,
) {
  return {
    ...toResumeSourcePayload(resume),
    activeReviewRun: activeRun ? toResumeReviewRunPayload(activeRun) : null,
    latestReview: report ? toReviewPayload(report) : null,
  };
}

function toResumeSourcePayload(resume: typeof resumeSourceVersions.$inferSelect) {
  return {
    id: resume.id,
    sourceDocumentId: resume.sourceDocumentId,
    title: resume.title,
    sourceKind: resume.sourceKind,
    sourceText: resume.sourceText,
    version: resume.version,
    status: resume.status,
    contentHash: resume.contentHash,
    lastReviewedAt: resume.lastReviewedAt?.toISOString() ?? null,
    extractedAt: resume.extractedAt?.toISOString() ?? null,
    createdAt: resume.createdAt.toISOString(),
    updatedAt: resume.updatedAt.toISOString(),
  };
}

function toReviewPayload(report: typeof resumeReviewReports.$inferSelect) {
  return {
    id: report.id,
    overallScore: report.overallScore,
    rubric: report.rubricJson,
    strengths: report.strengths,
    weaknesses: report.weaknesses,
    recommendedActions: report.recommendedActions,
    missingEvidenceQuestions: report.missingEvidenceQuestions,
    riskFlags: report.riskFlags,
    status: report.status,
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
  };
}

function toResumeReviewRunPayload(run: typeof workflowRuns.$inferSelect): ResumeReviewActiveRun {
  return {
    errorKind: run.errorKind,
    errorMessage: run.errorMessage,
    finishedAt: run.finishedAt?.toISOString() ?? null,
    id: run.id,
    stage: getResumeReviewRunStage(run),
    startedAt: run.startedAt.toISOString(),
    status: run.status,
  };
}

function getResumeReviewRunStage(run: typeof workflowRuns.$inferSelect): ResumeReviewActiveRun["stage"] {
  const stage = run.skillMetadata?.stage;
  if (
    stage === "queued" ||
    stage === "reading_source" ||
    stage === "analyzing" ||
    stage === "validating" ||
    stage === "saving" ||
    stage === "completed" ||
    stage === "failed"
  ) {
    return stage;
  }
  if (run.status === "succeeded") return "completed";
  if (run.status === "failed") return "failed";
  return "queued";
}

function getResumeSourceVersionIdFromWorkflowRun(run: typeof workflowRuns.$inferSelect) {
  const value = run.skillMetadata?.resumeSourceVersionId;
  return typeof value === "string" && value ? value : null;
}

function sanitizeWorkflowError(message: string) {
  return message.replace(/sk-[A-Za-z0-9_-]+/g, "sk-***").slice(0, 2000);
}
