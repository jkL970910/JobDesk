import crypto from "node:crypto";

import { and, desc, eq } from "drizzle-orm";

import { getDb, hasDatabaseUrl } from "../db/client";
import {
  resumeReviewReports,
  resumeSourceVersions,
  sourceDocuments,
  workspaces,
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

const defaultWorkspaceName = "Personal JobDesk";
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

export async function getResumeReviewWorkspace(limit = 10) {
  if (!hasDatabaseUrl()) {
    return {
      status: "skipped" as const,
      reason: "missing_database_url" as const,
      resumes: [],
    };
  }

  const db = getDb();
  const resumes = await db
    .select()
    .from(resumeSourceVersions)
    .orderBy(desc(resumeSourceVersions.updatedAt))
    .limit(limit);
  const reports = resumes.length
    ? await db
        .select()
        .from(resumeReviewReports)
        .where(eq(resumeReviewReports.status, "ready"))
        .orderBy(desc(resumeReviewReports.updatedAt))
        .limit(limit * 3)
    : [];
  const latestReportByResumeId = new Map<string, typeof resumeReviewReports.$inferSelect>();
  for (const report of reports) {
    if (!latestReportByResumeId.has(report.resumeSourceVersionId)) {
      latestReportByResumeId.set(report.resumeSourceVersionId, report);
    }
  }

  return {
    status: "ready" as const,
    resumes: resumes.map((resume) =>
      toResumeSummary(resume, latestReportByResumeId.get(resume.id)),
    ),
  };
}

export async function getResumeSourceVersion(resumeSourceVersionId: string) {
  if (!hasDatabaseUrl()) {
    return { status: "skipped" as const, reason: "missing_database_url" as const };
  }
  const [resume] = await getDb()
    .select()
    .from(resumeSourceVersions)
    .where(eq(resumeSourceVersions.id, resumeSourceVersionId))
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
  const [resume] = await db
    .select()
    .from(resumeSourceVersions)
    .where(eq(resumeSourceVersions.id, resumeSourceVersionId))
    .limit(1);
  if (!resume) return { status: "not_found" as const };

  await db.transaction(async (tx) => {
    await tx
      .delete(resumeSourceVersions)
      .where(eq(resumeSourceVersions.id, resumeSourceVersionId));
    await tx
      .delete(sourceDocuments)
      .where(eq(sourceDocuments.id, resume.sourceDocumentId));
  });

  return {
    status: "deleted" as const,
    resume: toResumeSourcePayload(resume),
  };
}

export async function rerunResumeReview(resumeSourceVersionId: string) {
  if (!hasDatabaseUrl()) {
    return { status: "skipped" as const, reason: "missing_database_url" as const };
  }
  const db = getDb();
  const [resume] = await db
    .select()
    .from(resumeSourceVersions)
    .where(eq(resumeSourceVersions.id, resumeSourceVersionId))
    .limit(1);
  if (!resume) return { status: "not_found" as const };

  const review = await buildReviewReport({
    sourceTitle: resume.title,
    sourceText: resume.sourceText,
  });
  const now = new Date();
  return db.transaction(async (tx) => {
    await tx
      .update(resumeReviewReports)
      .set({
        status: "stale",
        updatedAt: now,
      })
      .where(eq(resumeReviewReports.resumeSourceVersionId, resume.id));
    const workflowRunId = await createResumeReviewWorkflowRun(tx, {
      workspaceId: resume.workspaceId,
      review,
      now,
    });
    const [savedReport] = await tx
      .insert(resumeReviewReports)
      .values({
        workspaceId: resume.workspaceId,
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
    await tx
      .update(resumeSourceVersions)
      .set({
        status: "reviewed",
        lastReviewedAt: now,
        updatedAt: now,
      })
      .where(eq(resumeSourceVersions.id, resume.id));
    return {
      status: "saved" as const,
      resume: toResumeSummary(
        { ...resume, status: "reviewed", lastReviewedAt: now, updatedAt: now },
        savedReport,
      ),
    };
  });
}

export async function createResumeSourceVersion(args: {
  sourceTitle: string;
  sourceText: string;
  sourceKind: string;
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
    const version = await inferNextResumeVersion(tx);
    const [sourceDocument] = await tx
      .insert(sourceDocuments)
      .values({
        workspaceId: workspace.id,
        sourceType: "resume-review",
        title: args.sourceTitle,
        contentText: args.sourceText,
        contentHash,
        createdAt: now,
      })
      .returning({ id: sourceDocuments.id });
    if (!sourceDocument) throw new Error("Failed to save resume source document.");

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

    await tx
      .update(resumeSourceVersions)
      .set({
        status: "reviewed",
        lastReviewedAt: now,
        updatedAt: now,
      })
      .where(eq(resumeSourceVersions.id, resume.id));

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
  const [latestReport] = await db
    .select()
    .from(resumeReviewReports)
    .where(
      and(
        eq(resumeReviewReports.resumeSourceVersionId, existing.id),
        eq(resumeReviewReports.status, "ready"),
      ),
    )
    .orderBy(desc(resumeReviewReports.updatedAt))
    .limit(1);
  return {
    status: "duplicate" as const,
    existingResume: toResumeSummary(existing, latestReport),
  };
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
      key: item.key,
      label: item.label,
      score: item.score,
      maxScore: item.maxScore,
      note: item.note,
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
  const now = new Date();
  const [resume] = await getDb()
    .update(resumeSourceVersions)
    .set({
      status: "extracted",
      extractedAt: now,
      updatedAt: now,
    })
    .where(eq(resumeSourceVersions.id, resumeSourceVersionId))
    .returning();
  return resume
    ? ({ status: "saved" as const, resume: toResumeSourcePayload(resume) })
    : ({ status: "not_found" as const });
}

async function getOrCreateDefaultWorkspace(db: Pick<DbHandle, "select" | "insert">) {
  const [existing] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.name, defaultWorkspaceName))
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(workspaces)
    .values({ name: defaultWorkspaceName })
    .returning();
  if (!created) {
    throw new Error("Failed to create workspace.");
  }
  return created;
}

async function inferNextResumeVersion(
  db: Pick<DbHandle, "select">,
) {
  const [latest] = await db
    .select({ version: resumeSourceVersions.version })
    .from(resumeSourceVersions)
    .orderBy(desc(resumeSourceVersions.version))
    .limit(1);
  return (latest?.version ?? 0) + 1;
}

function toResumeSummary(
  resume: typeof resumeSourceVersions.$inferSelect,
  report?: typeof resumeReviewReports.$inferSelect,
) {
  return {
    ...toResumeSourcePayload(resume),
    latestReview: report ? toReviewPayload(report) : null,
  };
}

function toResumeSourcePayload(resume: typeof resumeSourceVersions.$inferSelect) {
  return {
    id: resume.id,
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

function sanitizeWorkflowError(message: string) {
  return message.replace(/sk-[A-Za-z0-9_-]+/g, "sk-***").slice(0, 2000);
}
