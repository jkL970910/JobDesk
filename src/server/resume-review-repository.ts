import crypto from "node:crypto";

import { and, count, desc, eq, inArray, ne, sql } from "drizzle-orm";

import { getDb, hasDatabaseUrl } from "../db/client";
import {
  evidenceItems,
  enrichmentTasks,
  initiatives,
  portfolioProjects,
  profileEvidenceExtractionRuns,
  resumeReviewRunSteps,
  resumeReviewReports,
  resumeSourceVersions,
  sourceDocuments,
  workExperiences,
  workflowRuns,
} from "../db/schema";
import { resolveJobDeskAiConfig } from "../ai/config";
import { JobDeskAiError } from "../ai/errors";
import {
  assessResumeReviewSectionWithAi,
  buildResumeReviewSynthesisInput,
  composeResumeReviewFromStages,
  consolidateResumeReviewRubricDimensions,
  RESUME_REVIEW_RUBRIC_DIMENSIONS,
  reviewResumeWithAi,
  segmentResumeReviewSource,
  synthesizeResumeReviewEvidenceWithAi,
  synthesizeResumeReviewRubricDimensionWithAi,
  synthesizeResumeReviewRubricWithAi,
  synthesizeResumeReviewScanWithAi,
  type ResumeReviewEvidenceData,
  type ResumeReviewRubricData,
  type ResumeReviewRubricDimensionData,
  type ResumeReviewScanData,
  type ResumeReviewSectionAssessmentData,
  type ResumeReviewSourceSection,
} from "../ai/resume-review";
import { skillRegistry } from "../ai/skills-registry";
import type { ResumeReviewReport } from "./resume-review-service";
import type { ResumeReview } from "../schemas/resume-review";
import type {
  JobDeskAiDiagnostics,
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
import { indexSourceChunks } from "./source-chunk-service";

type DbHandle = ReturnType<typeof getDb>;
type ResumeReviewAiAdapter = typeof reviewResumeWithAi;
type ResumeReviewStepAiAdapter = {
  assessSection: typeof assessResumeReviewSectionWithAi;
  synthesizeEvidence: typeof synthesizeResumeReviewEvidenceWithAi;
  synthesizeRubric: typeof synthesizeResumeReviewRubricWithAi;
  synthesizeRubricDimension: typeof synthesizeResumeReviewRubricDimensionWithAi;
  synthesizeScan: typeof synthesizeResumeReviewScanWithAi;
};

let resumeReviewAiAdapter: ResumeReviewAiAdapter = reviewResumeWithAi;
let resumeReviewStepAiAdapter: ResumeReviewStepAiAdapter = {
  assessSection: assessResumeReviewSectionWithAi,
  synthesizeEvidence: synthesizeResumeReviewEvidenceWithAi,
  synthesizeRubric: synthesizeResumeReviewRubricWithAi,
  synthesizeRubricDimension: synthesizeResumeReviewRubricDimensionWithAi,
  synthesizeScan: synthesizeResumeReviewScanWithAi,
};

export function setResumeReviewAiAdapterForTest(adapter: ResumeReviewAiAdapter) {
  resumeReviewAiAdapter = adapter;
  return () => {
    resumeReviewAiAdapter = reviewResumeWithAi;
  };
}

export function setResumeReviewStepAiAdapterForTest(adapter: Partial<ResumeReviewStepAiAdapter>) {
  resumeReviewStepAiAdapter = {
    ...resumeReviewStepAiAdapter,
    ...adapter,
  };
  return () => {
    resumeReviewStepAiAdapter = {
      assessSection: assessResumeReviewSectionWithAi,
      synthesizeEvidence: synthesizeResumeReviewEvidenceWithAi,
      synthesizeRubric: synthesizeResumeReviewRubricWithAi,
      synthesizeRubricDimension: synthesizeResumeReviewRubricDimensionWithAi,
      synthesizeScan: synthesizeResumeReviewScanWithAi,
    };
  };
}

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

type ResumeDeleteCleanupMode = "keep_library" | "remove_draft_materials";

export type ResumeSourceDeleteImpact = {
  draftEvidenceItems: number;
  draftInitiatives: number;
  draftPortfolioProjects: number;
  draftWorkExperiences: number;
  openEnrichmentTasks: number;
};

type ResumeSourceDeleteCounts = ResumeSourceDeleteImpact & {
  sourceDocumentDeleted: boolean;
};

type ResumeReviewActiveRun = {
  id: string;
  status: "running" | "succeeded" | "failed" | "skipped";
  stage: "queued" | "reading_source" | "scanning" | "scoring" | "evidence_review" | "analyzing" | "validating" | "saving" | "completed" | "failed";
  startedAt: string;
  finishedAt: string | null;
  errorKind: string | null;
  errorMessage: string | null;
  stepProgress?: ResumeReviewStepProgress | null;
};

type ResumeReviewStepProgress = {
  currentStepTitle: string | null;
  completedSteps: number;
  failedSteps: number;
  processingSteps: number;
  sectionCompleted: number;
  sectionTotal: number;
  totalSteps: number;
};

type ResumeReviewProcessResult = {
  hasMoreWork?: boolean;
  resume?: ReturnType<typeof toResumeSummary>;
  run: ResumeReviewActiveRun;
  status: "failed" | "ready" | "saved";
};

type ResumeReviewStepKind =
  | "segment_source"
  | "assess_section"
  | "synthesize_scan"
  | "synthesize_rubric"
  | "synthesize_rubric_dimension"
  | "calibrate_score"
  | "synthesize_evidence"
  | "save_report";

const RESUME_REVIEW_STALE_RUN_MS = 15 * 60 * 1000;
const RESUME_REVIEW_STEP_LOCK_MS = 4 * 60 * 1000;
const RESUME_REVIEW_STEPPED_STALE_MS = 10 * 60 * 1000;
const RESUME_REVIEW_PROCESSOR_ID = `resume-review-${process.pid}`;
const RESUME_REVIEW_STALE_ERROR_MESSAGE =
  "Resume review did not finish within the expected window. Start the full review again.";
const STALE_RESUME_REVIEW_STAGES = new Set<ResumeReviewActiveRun["stage"]>([
  "queued",
  "reading_source",
  "scanning",
  "scoring",
  "evidence_review",
  "analyzing",
  "validating",
]);

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
  const currentActiveRuns = await expireStaleResumeReviewRuns(db, {
    runs: activeRuns,
    workspaceId: workspace.id,
  });
  const activeRunByResumeId = new Map<string, typeof workflowRuns.$inferSelect>();
  for (const run of currentActiveRuns) {
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

export async function getResumeSourceDeleteImpact(resumeSourceVersionId: string) {
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
    impact: await getResumeDeleteImpactCounts(db, {
      resumeSourceVersionId: resume.id,
      sourceDocumentId: resume.sourceDocumentId,
      workspaceId: workspace.id,
    }),
    resume: toResumeSourcePayload(resume),
  };
}

export async function deleteResumeSourceVersion(
  resumeSourceVersionId: string,
  options: { cleanupMode?: ResumeDeleteCleanupMode } = {},
) {
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

  const cleanupMode = options.cleanupMode ?? "keep_library";
  const impact = await getResumeDeleteImpactCounts(db, {
    resumeSourceVersionId: resume.id,
    sourceDocumentId: resume.sourceDocumentId,
    workspaceId: workspace.id,
  });
  let deletedCounts: ResumeSourceDeleteCounts = {
    draftEvidenceItems: 0,
    draftInitiatives: 0,
    draftPortfolioProjects: 0,
    draftWorkExperiences: 0,
    openEnrichmentTasks: 0,
    sourceDocumentDeleted: false,
  };

  await db.transaction(async (tx) => {
    if (cleanupMode === "remove_draft_materials") {
      deletedCounts = await deleteDraftResumeMaterials(tx, {
        resumeSourceVersionId: resume.id,
        sourceDocumentId: resume.sourceDocumentId,
        workspaceId: workspace.id,
      });
    }
    await tx
      .delete(workflowRuns)
      .where(
        and(
          eq(workflowRuns.workspaceId, workspace.id),
          eq(workflowRuns.workflowType, skillRegistry.resumeReviewGeneral.workflowType),
          sql`${workflowRuns.skillMetadata}->>'resumeSourceVersionId' = ${resumeSourceVersionId}`,
        ),
      );
    await tx
      .delete(profileEvidenceExtractionRuns)
      .where(
        and(
          eq(profileEvidenceExtractionRuns.workspaceId, workspace.id),
          eq(profileEvidenceExtractionRuns.resumeSourceVersionId, resumeSourceVersionId),
        ),
      );
    await tx
      .delete(resumeSourceVersions)
      .where(and(eq(resumeSourceVersions.workspaceId, workspace.id), eq(resumeSourceVersions.id, resumeSourceVersionId)));
    if (cleanupMode === "remove_draft_materials") {
      const remainingReferences = await countSourceDocumentLibraryReferences(tx, {
        sourceDocumentId: resume.sourceDocumentId,
        workspaceId: workspace.id,
      });
      if (remainingReferences === 0) {
        await tx
          .delete(sourceDocuments)
          .where(and(eq(sourceDocuments.workspaceId, workspace.id), eq(sourceDocuments.id, resume.sourceDocumentId)));
        deletedCounts.sourceDocumentDeleted = true;
      }
    }
  });

  return {
    status: "deleted" as const,
    cleanupMode,
    deletedCounts,
    impact,
    resume: toResumeSourcePayload(resume),
  };
}

export async function rerunResumeReview(resumeSourceVersionId: string) {
  const started = await startResumeReviewRun(resumeSourceVersionId);
  if (started.status !== "created") return started;
  return processResumeReviewRun(started.run.id);
}

async function getResumeDeleteImpactCounts(
  db: Pick<DbHandle, "select">,
  args: { workspaceId: string; sourceDocumentId: string; resumeSourceVersionId: string },
): Promise<ResumeSourceDeleteImpact> {
  const [
    [draftEvidence],
    [draftWork],
    [draftInitiatives],
    [draftPortfolio],
    [openTasks],
  ] = await Promise.all([
    db
      .select({ value: count() })
      .from(evidenceItems)
      .where(
        and(
          eq(evidenceItems.workspaceId, args.workspaceId),
          eq(evidenceItems.sourceDocumentId, args.sourceDocumentId),
          ne(evidenceItems.status, "approved"),
        ),
      ),
    db
      .select({ value: count() })
      .from(workExperiences)
      .where(
        and(
          eq(workExperiences.workspaceId, args.workspaceId),
          eq(workExperiences.sourceDocumentId, args.sourceDocumentId),
          ne(workExperiences.status, "approved"),
          sql`not exists (
            select 1 from ${initiatives}
            where ${initiatives.workExperienceId} = ${workExperiences.id}
            and ${initiatives.status} = 'approved'
          )`,
        ),
      ),
    db
      .select({ value: count() })
      .from(initiatives)
      .where(
        and(
          eq(initiatives.workspaceId, args.workspaceId),
          eq(initiatives.sourceDocumentId, args.sourceDocumentId),
          ne(initiatives.status, "approved"),
        ),
      ),
    db
      .select({ value: count() })
      .from(portfolioProjects)
      .where(
        and(
          eq(portfolioProjects.workspaceId, args.workspaceId),
          eq(portfolioProjects.sourceDocumentId, args.sourceDocumentId),
          ne(portfolioProjects.status, "approved"),
        ),
      ),
    db
      .select({ value: count() })
      .from(enrichmentTasks)
      .where(
        and(
          eq(enrichmentTasks.workspaceId, args.workspaceId),
          eq(enrichmentTasks.resumeSourceVersionId, args.resumeSourceVersionId),
          inArray(enrichmentTasks.status, ["open", "answered"]),
        ),
      ),
  ]);
  return {
    draftEvidenceItems: draftEvidence?.value ?? 0,
    draftInitiatives: draftInitiatives?.value ?? 0,
    draftPortfolioProjects: draftPortfolio?.value ?? 0,
    draftWorkExperiences: draftWork?.value ?? 0,
    openEnrichmentTasks: openTasks?.value ?? 0,
  };
}

async function deleteDraftResumeMaterials(
  db: Pick<DbHandle, "delete" | "select" | "update">,
  args: { workspaceId: string; sourceDocumentId: string; resumeSourceVersionId: string },
): Promise<ResumeSourceDeleteCounts> {
  const evidence = await db
    .delete(evidenceItems)
    .where(
      and(
        eq(evidenceItems.workspaceId, args.workspaceId),
        eq(evidenceItems.sourceDocumentId, args.sourceDocumentId),
        ne(evidenceItems.status, "approved"),
      ),
    )
    .returning({ id: evidenceItems.id });
  const initiativesResult = await db
    .delete(initiatives)
    .where(
      and(
        eq(initiatives.workspaceId, args.workspaceId),
        eq(initiatives.sourceDocumentId, args.sourceDocumentId),
        ne(initiatives.status, "approved"),
      ),
    )
    .returning({ id: initiatives.id });
  const work = await db
    .delete(workExperiences)
    .where(
      and(
        eq(workExperiences.workspaceId, args.workspaceId),
        eq(workExperiences.sourceDocumentId, args.sourceDocumentId),
        ne(workExperiences.status, "approved"),
        sql`not exists (
          select 1 from ${initiatives}
          where ${initiatives.workExperienceId} = ${workExperiences.id}
        )`,
      ),
    )
    .returning({ id: workExperiences.id });
  const portfolio = await db
    .delete(portfolioProjects)
    .where(
      and(
        eq(portfolioProjects.workspaceId, args.workspaceId),
        eq(portfolioProjects.sourceDocumentId, args.sourceDocumentId),
        ne(portfolioProjects.status, "approved"),
      ),
    )
    .returning({ id: portfolioProjects.id });
  const tasks = await db
    .delete(enrichmentTasks)
    .where(
      and(
        eq(enrichmentTasks.workspaceId, args.workspaceId),
        eq(enrichmentTasks.resumeSourceVersionId, args.resumeSourceVersionId),
        inArray(enrichmentTasks.status, ["open", "answered"]),
      ),
    )
    .returning({ id: enrichmentTasks.id });

  return {
    draftEvidenceItems: evidence.length,
    draftInitiatives: initiativesResult.length,
    draftPortfolioProjects: portfolio.length,
    draftWorkExperiences: work.length,
    openEnrichmentTasks: tasks.length,
    sourceDocumentDeleted: false,
  };
}

async function countSourceDocumentLibraryReferences(
  db: Pick<DbHandle, "select">,
  args: { workspaceId: string; sourceDocumentId: string },
) {
  const [
    [evidence],
    [work],
    [initiativesResult],
    [portfolio],
  ] = await Promise.all([
    db
      .select({ value: count() })
      .from(evidenceItems)
      .where(and(eq(evidenceItems.workspaceId, args.workspaceId), eq(evidenceItems.sourceDocumentId, args.sourceDocumentId))),
    db
      .select({ value: count() })
      .from(workExperiences)
      .where(and(eq(workExperiences.workspaceId, args.workspaceId), eq(workExperiences.sourceDocumentId, args.sourceDocumentId))),
    db
      .select({ value: count() })
      .from(initiatives)
      .where(and(eq(initiatives.workspaceId, args.workspaceId), eq(initiatives.sourceDocumentId, args.sourceDocumentId))),
    db
      .select({ value: count() })
      .from(portfolioProjects)
      .where(and(eq(portfolioProjects.workspaceId, args.workspaceId), eq(portfolioProjects.sourceDocumentId, args.sourceDocumentId))),
  ]);
  return (
    (evidence?.value ?? 0) +
    (work?.value ?? 0) +
    (initiativesResult?.value ?? 0) +
    (portfolio?.value ?? 0)
  );
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
    const resumed = await resumeFailedResumeReviewRun(db, {
      run: existing,
      workspaceId: workspace.id,
    });
    return {
      status: "created" as const,
      run: toResumeReviewRunPayload(resumed),
      resume: toResumeSummary(resume, latestReport, resumed),
    };
  }

  const run = await createResumeReviewRun(db, {
    resumeSourceVersionId: resume.id,
    trigger: "user_retry",
    workspaceId: workspace.id,
  });
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
  const currentRun = await expireStaleResumeReviewRun(db, {
    run,
    workspaceId: workspace.id,
  });
  return { status: "ready" as const, run: await toResumeReviewRunPayloadWithProgress(db, currentRun, workspace.id) };
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
  const currentRun = await expireStaleResumeReviewRun(db, {
    run,
    workspaceId: workspace.id,
  });
  const runnableRun = await resumeFailedResumeReviewRun(db, {
    run: currentRun,
    workspaceId: workspace.id,
  });
  if (runnableRun.status !== "running") {
    return { status: "ready" as const, run: await toResumeReviewRunPayloadWithProgress(db, runnableRun, workspace.id) };
  }
  const resumeSourceVersionId = getResumeSourceVersionIdFromWorkflowRun(currentRun);
  if (!resumeSourceVersionId) return { status: "not_found" as const };

  const [resume] = await db
    .select()
    .from(resumeSourceVersions)
    .where(and(eq(resumeSourceVersions.workspaceId, workspace.id), eq(resumeSourceVersions.id, resumeSourceVersionId)))
    .limit(1);
  if (!resume) return { status: "not_found" as const };

  await ensureResumeReviewRunSteps(db, {
    resume,
    run: runnableRun,
    workspaceId: workspace.id,
  });
  const step = await claimNextResumeReviewStep(db, {
    run: runnableRun,
    workspaceId: workspace.id,
  });
  if (!step) {
    const [latestRun] = await db
      .select()
      .from(workflowRuns)
      .where(and(eq(workflowRuns.workspaceId, workspace.id), eq(workflowRuns.id, currentRun.id)))
      .limit(1);
    return {
      hasMoreWork: Boolean(latestRun?.status === "running"),
      run: await toResumeReviewRunPayloadWithProgress(db, latestRun ?? runnableRun, workspace.id),
      status: "ready" as const,
    };
  }

  try {
    return await processClaimedResumeReviewStep({
      db,
      resume,
      run: runnableRun,
      step,
      workspaceId: workspace.id,
    });
  } catch (error) {
    const failureKind = error instanceof JobDeskAiError ? error.kind : "provider_error";
    const failureMessage = error instanceof Error ? error.message : "Unknown provider error.";
    await failResumeReviewStep(db, {
      diagnostics: error instanceof JobDeskAiError ? error.diagnostics : null,
      errorKind: failureKind,
      errorMessage: failureMessage,
      step,
      workspaceId: workspace.id,
    });
    const failedRun = await finishResumeReviewRun(db, {
      errorKind: failureKind,
      errorMessage: failureMessage,
      run: runnableRun,
      status: "failed",
      workspaceId: workspace.id,
    });
    return { status: "failed" as const, run: await toResumeReviewRunPayloadWithProgress(db, failedRun, workspace.id) };
  }
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
        lifecycleStatus: getInitialResumeSourceLifecycleStatus(args.parseMetadata?.parseQuality.status),
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

    const run = await createResumeReviewRun(tx, {
      resumeSourceVersionId: resume.id,
      trigger: "initial_upload",
      workspaceId: workspace.id,
    });

    return {
      status: "saved" as const,
      run: toResumeReviewRunPayload(run),
      resume: toResumeSummary(resume, undefined, run),
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
    await tx
      .update(sourceDocuments)
      .set({
        lifecycleStatus: "reviewed",
        updatedAt: now,
      })
      .where(and(eq(sourceDocuments.workspaceId, args.workspaceId), eq(sourceDocuments.id, args.resume.sourceDocumentId)));
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
  db: Pick<DbHandle, "execute" | "select" | "update">,
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
        sql`${workflowRuns.status} IN ('running', 'failed')`,
        sql`${workflowRuns.skillMetadata}->>'resumeSourceVersionId' = ${args.resumeSourceVersionId}`,
      ),
    )
    .orderBy(desc(workflowRuns.startedAt))
    .limit(1);
  if (!run) return null;
  const currentRun = await expireStaleResumeReviewRun(db, {
    run,
    workspaceId: args.workspaceId,
  });
  if (currentRun.status === "running") return currentRun;
  if (currentRun.status === "failed" && (await hasRetryableResumeReviewStep(db, currentRun, args.workspaceId))) {
    return currentRun;
  }
  return null;
}

async function createResumeReviewRun(
  db: Pick<DbHandle, "insert">,
  args: {
    resumeSourceVersionId: string;
    trigger: "initial_upload" | "user_retry";
    workspaceId: string;
  },
) {
  const now = new Date();
  const [run] = await db
    .insert(workflowRuns)
    .values({
      workspaceId: args.workspaceId,
      workflowType: skillRegistry.resumeReviewGeneral.workflowType,
      status: "running",
      ...workflowSkillFields(skillRegistry.resumeReviewGeneral),
      skillMetadata: {
        resumeSourceVersionId: args.resumeSourceVersionId,
        stage: "queued",
        trigger: args.trigger,
      },
      startedAt: now,
      finishedAt: null,
    })
    .returning();
  if (!run) throw new Error("Failed to create resume review run.");
  return run;
}

async function hasRetryableResumeReviewStep(
  db: Pick<DbHandle, "select">,
  run: typeof workflowRuns.$inferSelect,
  workspaceId: string,
) {
  if (run.status !== "failed") return false;
  const [failedStep] = await db
    .select({ id: resumeReviewRunSteps.id })
    .from(resumeReviewRunSteps)
    .where(
      and(
        eq(resumeReviewRunSteps.workspaceId, workspaceId),
        eq(resumeReviewRunSteps.workflowRunId, run.id),
        eq(resumeReviewRunSteps.status, "failed"),
      ),
    )
    .limit(1);
  return Boolean(failedStep);
}

async function resumeFailedResumeReviewRun(
  db: Pick<DbHandle, "insert" | "select" | "update">,
  args: {
    run: typeof workflowRuns.$inferSelect;
    workspaceId: string;
  },
) {
  if (args.run.status !== "failed") return args.run;
  const now = new Date();
  const [failedStep] = await db
    .select()
    .from(resumeReviewRunSteps)
    .where(
      and(
        eq(resumeReviewRunSteps.workspaceId, args.workspaceId),
        eq(resumeReviewRunSteps.workflowRunId, args.run.id),
        eq(resumeReviewRunSteps.status, "failed"),
      ),
    )
    .orderBy(resumeReviewRunSteps.sequence)
    .limit(1);
  if (!failedStep) return args.run;

  let resumeStageStepKind = failedStep.stepKind;
  if (failedStep.stepKind === "synthesize_rubric") {
    resumeStageStepKind = "synthesize_rubric_dimension";
    await replaceLegacyFailedRubricStepWithDimensionSteps(db, {
      failedStep,
      now,
      run: args.run,
      workspaceId: args.workspaceId,
    });
  }

  await db
    .update(resumeReviewRunSteps)
    .set({
      failureKind: null,
      failureMessage: null,
      lockedAt: null,
      lockedBy: null,
      lockExpiresAt: null,
      status: "pending",
      updatedAt: now,
    })
    .where(
      and(
        eq(resumeReviewRunSteps.workspaceId, args.workspaceId),
        eq(resumeReviewRunSteps.workflowRunId, args.run.id),
        sql`${resumeReviewRunSteps.status} = 'failed'`,
        sql`${resumeReviewRunSteps.sequence} >= ${failedStep.sequence}`,
      ),
    );
  const [updatedRun] = await db
    .update(workflowRuns)
    .set({
      errorKind: null,
      errorMessage: null,
      finishedAt: null,
      skillMetadata: {
        ...args.run.skillMetadata,
        stage: getResumeReviewRunStageForStepKind(resumeStageStepKind),
      },
      startedAt: now,
      status: "running",
    })
    .where(and(eq(workflowRuns.workspaceId, args.workspaceId), eq(workflowRuns.id, args.run.id)))
    .returning();
  return updatedRun ?? args.run;
}

async function replaceLegacyFailedRubricStepWithDimensionSteps(
  db: Pick<DbHandle, "insert" | "update">,
  args: {
    failedStep: typeof resumeReviewRunSteps.$inferSelect;
    now: Date;
    run: typeof workflowRuns.$inferSelect;
    workspaceId: string;
  },
) {
  await db
    .update(resumeReviewRunSteps)
    .set({
      failureKind: null,
      failureMessage: null,
      lockedAt: null,
      lockedBy: null,
      lockExpiresAt: null,
      status: "completed",
      resultJson: {
        migratedToDimensionSteps: true,
      },
      updatedAt: args.now,
    })
    .where(
      and(
        eq(resumeReviewRunSteps.workspaceId, args.workspaceId),
        eq(resumeReviewRunSteps.id, args.failedStep.id),
      ),
    );
  await db
    .update(resumeReviewRunSteps)
    .set({
      sequence: sql`CASE
        WHEN ${resumeReviewRunSteps.stepKind} = 'synthesize_evidence' THEN 10300
        WHEN ${resumeReviewRunSteps.stepKind} = 'save_report' THEN 10400
        ELSE ${resumeReviewRunSteps.sequence}
      END`,
      updatedAt: args.now,
    })
    .where(
      and(
        eq(resumeReviewRunSteps.workspaceId, args.workspaceId),
        eq(resumeReviewRunSteps.workflowRunId, args.run.id),
        sql`${resumeReviewRunSteps.stepKind} IN ('synthesize_evidence', 'save_report')`,
      ),
    );
  await db
    .insert(resumeReviewRunSteps)
    .values(
      RESUME_REVIEW_RUBRIC_DIMENSIONS.map((dimension, index) => ({
        workspaceId: args.workspaceId,
        workflowRunId: args.run.id,
        resumeSourceVersionId: args.failedStep.resumeSourceVersionId,
        stepKey: `synthesize-rubric-${dimension.key}`,
        stepKind: "synthesize_rubric_dimension",
        sequence: 10_100 + index,
        title: `Score ${dimension.label}`,
        inputJson: { dimension },
        resultJson: {},
        status: "pending" as const,
        createdAt: args.now,
        updatedAt: args.now,
      })),
    )
    .onConflictDoNothing();
  await db
    .insert(resumeReviewRunSteps)
    .values({
      workspaceId: args.workspaceId,
      workflowRunId: args.run.id,
      resumeSourceVersionId: args.failedStep.resumeSourceVersionId,
      stepKey: "calibrate-score",
      stepKind: "calibrate_score",
      sequence: 10_200,
      title: "Calibrate final score",
      inputJson: {},
      resultJson: {},
      status: "pending",
      createdAt: args.now,
      updatedAt: args.now,
    })
    .onConflictDoNothing();
}

async function ensureResumeReviewRunSteps(
  db: Pick<DbHandle, "insert" | "select">,
  args: {
    resume: typeof resumeSourceVersions.$inferSelect;
    run: typeof workflowRuns.$inferSelect;
    workspaceId: string;
  },
) {
  const existing = await db
    .select({ id: resumeReviewRunSteps.id })
    .from(resumeReviewRunSteps)
    .where(eq(resumeReviewRunSteps.workflowRunId, args.run.id))
    .limit(1);
  if (existing.length > 0) return;

  const now = new Date();
  await db.insert(resumeReviewRunSteps).values({
    workspaceId: args.workspaceId,
    workflowRunId: args.run.id,
    resumeSourceVersionId: args.resume.id,
    stepKey: "segment-source",
    stepKind: "segment_source",
    sequence: 0,
    title: "Prepare resume sections",
    inputJson: {
      sourceTitle: args.resume.title,
    },
    resultJson: {},
    status: "pending",
    createdAt: now,
    updatedAt: now,
  });
}

async function claimNextResumeReviewStep(
  db: Pick<DbHandle, "execute">,
  args: {
    run: typeof workflowRuns.$inferSelect;
    workspaceId: string;
  },
) {
  const now = new Date();
  const lockExpiresAt = new Date(now.getTime() + RESUME_REVIEW_STEP_LOCK_MS);
  const result = await db.execute(sql`
    UPDATE ${resumeReviewRunSteps}
    SET
      attempt_count = attempt_count + 1,
      failure_kind = NULL,
      failure_message = NULL,
      locked_at = ${now},
      locked_by = ${RESUME_REVIEW_PROCESSOR_ID},
      lock_expires_at = ${lockExpiresAt},
      status = 'processing',
      updated_at = ${now}
    WHERE id = (
      SELECT id
      FROM ${resumeReviewRunSteps}
      WHERE workspace_id = ${args.workspaceId}
        AND workflow_run_id = ${args.run.id}
        AND (
          status = 'pending'
          OR (status = 'processing' AND lock_expires_at < ${now})
        )
        AND NOT EXISTS (
          SELECT 1
          FROM ${resumeReviewRunSteps} earlier
          WHERE earlier.workspace_id = ${args.workspaceId}
            AND earlier.workflow_run_id = ${args.run.id}
            AND earlier.sequence < ${resumeReviewRunSteps.sequence}
            AND earlier.status <> 'completed'
        )
      ORDER BY sequence
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING *
  `);
  return mapResumeReviewRunStepRow(result.rows[0]);
}

async function processClaimedResumeReviewStep(args: {
  db: DbHandle;
  resume: typeof resumeSourceVersions.$inferSelect;
  run: typeof workflowRuns.$inferSelect;
  step: typeof resumeReviewRunSteps.$inferSelect;
  workspaceId: string;
}): Promise<ResumeReviewProcessResult> {
  const stepKind = args.step.stepKind as ResumeReviewStepKind;
  if (stepKind === "segment_source") {
    await updateResumeReviewRunStage(args.db, {
      run: args.run,
      stage: "reading_source",
      workspaceId: args.workspaceId,
    });
    const sections = segmentResumeReviewSource(args.resume.sourceText);
    await completeResumeReviewStep(args.db, {
      resultJson: {
        sections,
      },
      step: args.step,
      workspaceId: args.workspaceId,
    });
    await insertSectionAssessmentSteps(args.db, {
      resume: args.resume,
      run: args.run,
      sections,
      workspaceId: args.workspaceId,
    });
    return resumeReviewStepResponse(args.db, {
      hasMoreWork: true,
      run: args.run,
      workspaceId: args.workspaceId,
    });
  }

  if (stepKind === "assess_section") {
    await updateResumeReviewRunStage(args.db, {
      run: args.run,
      stage: "scanning",
      workspaceId: args.workspaceId,
    });
    const section = parseStepInput<ResumeReviewSourceSection>(args.step.inputJson, "section");
    const assessment = await resumeReviewStepAiAdapter.assessSection({
      resumeTitle: args.resume.title,
      section,
    });
    await completeResumeReviewStep(args.db, {
      resultJson: {
        assessment: assessment.data,
        diagnostics: sanitizeAiDiagnostics(assessment.diagnostics),
        retryCount: assessment.retryCount,
        usage: assessment.usage,
      },
      step: args.step,
      workspaceId: args.workspaceId,
    });
    await ensureSynthesisStepsIfSectionsComplete(args.db, {
      resume: args.resume,
      run: args.run,
      workspaceId: args.workspaceId,
    });
    return resumeReviewStepResponse(args.db, {
      hasMoreWork: true,
      run: args.run,
      workspaceId: args.workspaceId,
    });
  }

  const synthesisInput = await buildSynthesisInputFromCompletedSections(args.db, {
    resume: args.resume,
    run: args.run,
    workspaceId: args.workspaceId,
  });

  if (stepKind === "synthesize_scan") {
    await updateResumeReviewRunStage(args.db, {
      run: args.run,
      stage: "scoring",
      workspaceId: args.workspaceId,
    });
    const scan = await resumeReviewStepAiAdapter.synthesizeScan({ synthesisInput });
    await completeResumeReviewStep(args.db, {
      resultJson: {
        scan: scan.data,
        diagnostics: sanitizeAiDiagnostics(scan.diagnostics),
        retryCount: scan.retryCount,
        usage: scan.usage,
      },
      step: args.step,
      workspaceId: args.workspaceId,
    });
    return resumeReviewStepResponse(args.db, {
      hasMoreWork: true,
      run: args.run,
      workspaceId: args.workspaceId,
    });
  }

  if (stepKind === "synthesize_rubric") {
    await updateResumeReviewRunStage(args.db, {
      run: args.run,
      stage: "scoring",
      workspaceId: args.workspaceId,
    });
    const rubric = await resumeReviewStepAiAdapter.synthesizeRubric({ synthesisInput });
    await completeResumeReviewStep(args.db, {
      resultJson: {
        diagnostics: sanitizeAiDiagnostics(rubric.diagnostics),
        retryCount: rubric.retryCount,
        rubric: rubric.data,
        usage: rubric.usage,
      },
      step: args.step,
      workspaceId: args.workspaceId,
    });
    return resumeReviewStepResponse(args.db, {
      hasMoreWork: true,
      run: args.run,
      workspaceId: args.workspaceId,
    });
  }

  if (stepKind === "synthesize_rubric_dimension") {
    await updateResumeReviewRunStage(args.db, {
      run: args.run,
      stage: "scoring",
      workspaceId: args.workspaceId,
    });
    const dimension = parseStepInput<(typeof RESUME_REVIEW_RUBRIC_DIMENSIONS)[number]>(args.step.inputJson, "dimension");
    const rubricDimension = await resumeReviewStepAiAdapter.synthesizeRubricDimension({
      dimension,
      synthesisInput,
    });
    await completeResumeReviewStep(args.db, {
      resultJson: {
        diagnostics: sanitizeAiDiagnostics(rubricDimension.diagnostics),
        dimension: rubricDimension.data,
        retryCount: rubricDimension.retryCount,
        usage: rubricDimension.usage,
      },
      step: args.step,
      workspaceId: args.workspaceId,
    });
    return resumeReviewStepResponse(args.db, {
      hasMoreWork: true,
      run: args.run,
      workspaceId: args.workspaceId,
    });
  }

  if (stepKind === "calibrate_score") {
    await updateResumeReviewRunStage(args.db, {
      run: args.run,
      stage: "scoring",
      workspaceId: args.workspaceId,
    });
    const rubric = await buildRubricFromCompletedDimensionSteps(args.db, {
      run: args.run,
      workspaceId: args.workspaceId,
    });
    await completeResumeReviewStep(args.db, {
      resultJson: {
        rubric,
      },
      step: args.step,
      workspaceId: args.workspaceId,
    });
    return resumeReviewStepResponse(args.db, {
      hasMoreWork: true,
      run: args.run,
      workspaceId: args.workspaceId,
    });
  }

  if (stepKind === "synthesize_evidence") {
    await updateResumeReviewRunStage(args.db, {
      run: args.run,
      stage: "evidence_review",
      workspaceId: args.workspaceId,
    });
    const evidence = await resumeReviewStepAiAdapter.synthesizeEvidence({ synthesisInput });
    await completeResumeReviewStep(args.db, {
      resultJson: {
        evidence: evidence.data,
        diagnostics: sanitizeAiDiagnostics(evidence.diagnostics),
        retryCount: evidence.retryCount,
        usage: evidence.usage,
      },
      step: args.step,
      workspaceId: args.workspaceId,
    });
    return resumeReviewStepResponse(args.db, {
      hasMoreWork: true,
      run: args.run,
      workspaceId: args.workspaceId,
    });
  }

  if (stepKind === "save_report") {
    await updateResumeReviewRunStage(args.db, {
      run: args.run,
      stage: "validating",
      workspaceId: args.workspaceId,
    });
    const review = await buildReviewFromCompletedSteps(args.db, {
      run: args.run,
      workspaceId: args.workspaceId,
    });
    await updateResumeReviewRunStage(args.db, {
      run: args.run,
      stage: "saving",
      workspaceId: args.workspaceId,
    });
    const saved = await persistResumeReviewResult({
      db: args.db,
      resume: args.resume,
      review,
      workflowRunId: args.run.id,
      workspaceId: args.workspaceId,
    });
    await completeResumeReviewStep(args.db, {
      resultJson: {
        resumeReviewReportId: saved.resume.latestReview?.id,
      },
      step: args.step,
      workspaceId: args.workspaceId,
    });
    const finishedRun = await finishResumeReviewRun(args.db, {
      errorKind: null,
      errorMessage: null,
      review,
      run: args.run,
      status: "succeeded",
      workspaceId: args.workspaceId,
    });
    return {
      hasMoreWork: false,
      resume: saved.resume,
      run: await toResumeReviewRunPayloadWithProgress(args.db, finishedRun, args.workspaceId),
      status: "saved",
    };
  }

  throw new Error(`Unsupported resume review step: ${args.step.stepKind}`);
}

async function completeResumeReviewStep(
  db: Pick<DbHandle, "update">,
  args: {
    resultJson: Record<string, unknown>;
    step: typeof resumeReviewRunSteps.$inferSelect;
    workspaceId: string;
  },
) {
  const now = new Date();
  const [updated] = await db
    .update(resumeReviewRunSteps)
    .set({
      failureKind: null,
      failureMessage: null,
      lockedAt: null,
      lockedBy: null,
      lockExpiresAt: null,
      resultJson: args.resultJson,
      status: "completed",
      updatedAt: now,
    })
    .where(
      and(
        eq(resumeReviewRunSteps.workspaceId, args.workspaceId),
        eq(resumeReviewRunSteps.id, args.step.id),
        eq(resumeReviewRunSteps.status, "processing"),
      ),
    )
    .returning();
  return updated ?? args.step;
}

async function failResumeReviewStep(
  db: Pick<DbHandle, "update">,
  args: {
    errorKind: string;
    errorMessage: string;
    diagnostics?: JobDeskAiDiagnostics | null;
    step: typeof resumeReviewRunSteps.$inferSelect;
    workspaceId: string;
  },
) {
  const now = new Date();
  const [updated] = await db
    .update(resumeReviewRunSteps)
    .set({
      failureKind: args.errorKind,
      failureMessage: sanitizeWorkflowError(args.errorMessage),
      lockedAt: null,
      lockedBy: null,
      lockExpiresAt: null,
      resultJson: {
        ...args.step.resultJson,
        diagnostics: sanitizeAiDiagnostics(args.diagnostics),
      },
      status: "failed",
      updatedAt: now,
    })
    .where(and(eq(resumeReviewRunSteps.workspaceId, args.workspaceId), eq(resumeReviewRunSteps.id, args.step.id)))
    .returning();
  return updated ?? args.step;
}

async function insertSectionAssessmentSteps(
  db: Pick<DbHandle, "insert">,
  args: {
    resume: typeof resumeSourceVersions.$inferSelect;
    run: typeof workflowRuns.$inferSelect;
    sections: ResumeReviewSourceSection[];
    workspaceId: string;
  },
) {
  const now = new Date();
  if (args.sections.length === 0) {
    args.sections = [
      {
        id: "uncategorized-1",
        kind: "uncategorized",
        text: args.resume.sourceText,
        title: "Resume content",
      },
    ];
  }
  await db
    .insert(resumeReviewRunSteps)
    .values(
      args.sections.map((section, index) => ({
        workspaceId: args.workspaceId,
        workflowRunId: args.run.id,
        resumeSourceVersionId: args.resume.id,
        stepKey: `assess-${section.id}`,
        stepKind: "assess_section",
        sequence: index + 1,
        title: `Review ${section.title}`,
        inputJson: { section },
        resultJson: {},
        status: "pending" as const,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .onConflictDoNothing();
}

async function ensureSynthesisStepsIfSectionsComplete(
  db: Pick<DbHandle, "insert" | "select">,
  args: {
    resume: typeof resumeSourceVersions.$inferSelect;
    run: typeof workflowRuns.$inferSelect;
    workspaceId: string;
  },
) {
  const incompleteSections = await db
    .select({ id: resumeReviewRunSteps.id })
    .from(resumeReviewRunSteps)
    .where(
      and(
        eq(resumeReviewRunSteps.workspaceId, args.workspaceId),
        eq(resumeReviewRunSteps.workflowRunId, args.run.id),
        eq(resumeReviewRunSteps.stepKind, "assess_section"),
        sql`${resumeReviewRunSteps.status} <> 'completed'`,
      ),
    )
    .limit(1);
  if (incompleteSections.length > 0) return;

  const now = new Date();
  const synthesisSteps = [
    { key: "synthesize-scan", kind: "synthesize_scan", sequence: 10_000, title: "Synthesize recruiter scan" },
    ...RESUME_REVIEW_RUBRIC_DIMENSIONS.map((dimension, index) => ({
      dimension,
      key: `synthesize-rubric-${dimension.key}`,
      kind: "synthesize_rubric_dimension",
      sequence: 10_100 + index,
      title: `Score ${dimension.label}`,
    })),
    { key: "calibrate-score", kind: "calibrate_score", sequence: 10_200, title: "Calibrate final score" },
    { key: "synthesize-evidence", kind: "synthesize_evidence", sequence: 10_300, title: "Review evidence and fairness" },
    { key: "save-report", kind: "save_report", sequence: 10_400, title: "Save final review" },
  ];
  await db
    .insert(resumeReviewRunSteps)
    .values(
      synthesisSteps.map((step) => ({
        workspaceId: args.workspaceId,
        workflowRunId: args.run.id,
        resumeSourceVersionId: args.resume.id,
        stepKey: step.key,
        stepKind: step.kind,
        sequence: step.sequence,
        title: step.title,
        inputJson: "dimension" in step ? { dimension: step.dimension } : {},
        resultJson: {},
        status: "pending" as const,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .onConflictDoNothing();
}

async function buildSynthesisInputFromCompletedSections(
  db: Pick<DbHandle, "select">,
  args: {
    resume: typeof resumeSourceVersions.$inferSelect;
    run: typeof workflowRuns.$inferSelect;
    workspaceId: string;
  },
) {
  const steps = await db
    .select()
    .from(resumeReviewRunSteps)
    .where(
      and(
        eq(resumeReviewRunSteps.workspaceId, args.workspaceId),
        eq(resumeReviewRunSteps.workflowRunId, args.run.id),
        eq(resumeReviewRunSteps.stepKind, "assess_section"),
        eq(resumeReviewRunSteps.status, "completed"),
      ),
    )
    .orderBy(resumeReviewRunSteps.sequence);
  const sections = steps.map((step) => {
    const section = parseStepInput<ResumeReviewSourceSection>(step.inputJson, "section");
    const assessment = parseStepInput<ResumeReviewSectionAssessmentData>(step.resultJson, "assessment");
    return { ...section, assessment };
  });
  return buildResumeReviewSynthesisInput({
    resumeTitle: args.resume.title,
    sections,
  });
}

async function buildReviewFromCompletedSteps(
  db: Pick<DbHandle, "select">,
  args: {
    run: typeof workflowRuns.$inferSelect;
    workspaceId: string;
  },
): Promise<ResumeReviewBuildResult> {
  const steps = await db
    .select()
    .from(resumeReviewRunSteps)
    .where(and(eq(resumeReviewRunSteps.workspaceId, args.workspaceId), eq(resumeReviewRunSteps.workflowRunId, args.run.id)))
    .orderBy(resumeReviewRunSteps.sequence);
  const scanStep = findCompletedStepResult<ResumeReviewScanData>(steps, "synthesize_scan", "scan");
  const rubricStep =
    steps.some((step) => step.stepKind === "calibrate_score")
      ? findCompletedStepResult<ResumeReviewRubricData>(steps, "calibrate_score", "rubric")
      : findCompletedStepResult<ResumeReviewRubricData>(steps, "synthesize_rubric", "rubric");
  const evidenceStep = findCompletedStepResult<ResumeReviewEvidenceData>(steps, "synthesize_evidence", "evidence");
  const review = composeResumeReviewFromStages({
    evidence: evidenceStep,
    rubric: rubricStep,
    scan: scanStep,
  });
  const config = resolveJobDeskAiConfig();
  return fromAiReview({
    review,
    provider: `openrouter-compatible:${config.transport}`,
    model: config.model,
    retryCount: sumStepRetryCount(steps),
    usage: sumStepUsage(steps),
    skill: skillRegistry.resumeReviewGeneral,
  });
}

async function buildRubricFromCompletedDimensionSteps(
  db: Pick<DbHandle, "select">,
  args: {
    run: typeof workflowRuns.$inferSelect;
    workspaceId: string;
  },
) {
  const steps = await db
    .select()
    .from(resumeReviewRunSteps)
    .where(and(eq(resumeReviewRunSteps.workspaceId, args.workspaceId), eq(resumeReviewRunSteps.workflowRunId, args.run.id)))
    .orderBy(resumeReviewRunSteps.sequence);
  const dimensionSteps = steps
    .filter((candidate) => candidate.stepKind === "synthesize_rubric_dimension")
    .sort((left, right) => left.sequence - right.sequence);
  if (dimensionSteps.length === 0) throw new Error("Missing completed resume review step: synthesize_rubric");
  const missingDimension = RESUME_REVIEW_RUBRIC_DIMENSIONS.find(
    (dimension) => !dimensionSteps.some((step) => step.stepKey === `synthesize-rubric-${dimension.key}`),
  );
  if (missingDimension) throw new Error(`Missing completed resume review step: synthesize-rubric-${missingDimension.key}`);
  const incomplete = dimensionSteps.find((step) => step.status !== "completed");
  if (incomplete) throw new Error(`Missing completed resume review step: ${incomplete.stepKey}`);
  const dimensions = dimensionSteps.map((step) =>
    parseStepInput<ResumeReviewRubricDimensionData>(step.resultJson, "dimension"),
  );
  return consolidateResumeReviewRubricDimensions({ dimensions });
}

function findCompletedStepResult<T>(
  steps: Array<typeof resumeReviewRunSteps.$inferSelect>,
  stepKind: ResumeReviewStepKind,
  resultKey: string,
) {
  const step = steps.find((candidate) => candidate.stepKind === stepKind && candidate.status === "completed");
  if (!step) throw new Error(`Missing completed resume review step: ${stepKind}`);
  return parseStepInput<T>(step.resultJson, resultKey);
}

async function resumeReviewStepResponse(
  db: Pick<DbHandle, "select">,
  args: {
    hasMoreWork: boolean;
    run: typeof workflowRuns.$inferSelect;
    workspaceId: string;
  },
): Promise<ResumeReviewProcessResult> {
  const [currentRun] = await db
    .select()
    .from(workflowRuns)
    .where(and(eq(workflowRuns.workspaceId, args.workspaceId), eq(workflowRuns.id, args.run.id)))
    .limit(1);
  return {
    hasMoreWork: args.hasMoreWork,
    run: await toResumeReviewRunPayloadWithProgress(db, currentRun ?? args.run, args.workspaceId),
    status: "ready",
  };
}

function parseStepInput<T>(value: unknown, key: string): T {
  if (!value || typeof value !== "object") throw new Error(`Resume review step is missing ${key}.`);
  const record = value as Record<string, unknown>;
  const nested = record[key];
  if (!nested || typeof nested !== "object") throw new Error(`Resume review step is missing ${key}.`);
  return nested as T;
}

function sumStepRetryCount(steps: Array<typeof resumeReviewRunSteps.$inferSelect>) {
  return steps.reduce((sum, step) => {
    const retryCount = step.resultJson?.retryCount;
    return sum + (typeof retryCount === "number" ? retryCount : 0);
  }, 0);
}

function sumStepUsage(steps: Array<typeof resumeReviewRunSteps.$inferSelect>): JobDeskAiUsage {
  const usage: JobDeskAiUsage = {};
  for (const step of steps) {
    const stepUsage = step.resultJson?.usage;
    if (!stepUsage || typeof stepUsage !== "object") continue;
    addUsageField(usage, "inputTokens", stepUsage as Record<string, unknown>);
    addUsageField(usage, "outputTokens", stepUsage as Record<string, unknown>);
    addUsageField(usage, "totalTokens", stepUsage as Record<string, unknown>);
  }
  return usage;
}

function addUsageField(
  usage: JobDeskAiUsage,
  key: "inputTokens" | "outputTokens" | "totalTokens",
  source: Record<string, unknown>,
) {
  const value = source[key];
  if (typeof value === "number") usage[key] = (usage[key] ?? 0) + value;
}

function sanitizeAiDiagnostics(diagnostics?: JobDeskAiDiagnostics | null) {
  if (!diagnostics) return null;
  return {
    durationMs: diagnostics.durationMs,
    endpoint: sanitizeAiEndpoint(diagnostics.endpoint),
    failurePhase: diagnostics.failurePhase,
    finalAttempt: diagnostics.finalAttempt,
    inputChars: diagnostics.inputChars,
    instructionsChars: diagnostics.instructionsChars,
    maxOutputTokens: diagnostics.maxOutputTokens,
    model: diagnostics.model,
    outputChars: diagnostics.outputChars,
    reasoningEffort: diagnostics.reasoningEffort,
    receivedResponse: diagnostics.receivedResponse,
    requestBodyChars: diagnostics.requestBodyChars,
    responseChars: diagnostics.responseChars,
    retryCount: diagnostics.retryCount,
    status: diagnostics.status,
    task: diagnostics.task,
    timeoutMs: diagnostics.timeoutMs,
    transport: diagnostics.transport,
  };
}

function sanitizeAiEndpoint(endpoint?: string) {
  if (!endpoint) return undefined;
  try {
    const url = new URL(endpoint);
    return `${url.host}${url.pathname}`;
  } catch {
    return "configured-provider";
  }
}

async function expireStaleResumeReviewRuns(
  db: Pick<DbHandle, "execute" | "select" | "update">,
  args: {
    runs: Array<typeof workflowRuns.$inferSelect>;
    workspaceId: string;
  },
) {
  const activeRuns: Array<typeof workflowRuns.$inferSelect> = [];
  for (const run of args.runs) {
    const currentRun = await expireStaleResumeReviewRun(db, {
      run,
      workspaceId: args.workspaceId,
    });
    if (currentRun.status === "running") activeRuns.push(currentRun);
  }
  return activeRuns;
}

async function expireStaleResumeReviewRun(
  db: Pick<DbHandle, "execute" | "select" | "update">,
  args: {
    run: typeof workflowRuns.$inferSelect;
    workspaceId: string;
  },
) {
  if (!isStaleResumeReviewRun(args.run)) return args.run;
  const stepHealth = await getResumeReviewRunStepHealth(db, args.run, args.workspaceId);
  if (stepHealth.hasSteps && !isStaleSteppedResumeReviewRun(args.run, stepHealth)) {
    return args.run;
  }
  if (stepHealth.hasSteps) {
    await failStaleResumeReviewStep(db, {
      run: args.run,
      workspaceId: args.workspaceId,
    });
  }
  return finishResumeReviewRun(db, {
    errorKind: "timeout",
    errorMessage: RESUME_REVIEW_STALE_ERROR_MESSAGE,
    run: args.run,
    status: "failed",
    workspaceId: args.workspaceId,
  });
}

async function failStaleResumeReviewStep(
  db: Pick<DbHandle, "execute">,
  args: {
    run: typeof workflowRuns.$inferSelect;
    workspaceId: string;
  },
) {
  const now = new Date();
  await db.execute(sql`
    UPDATE ${resumeReviewRunSteps}
    SET
      failure_kind = 'timeout',
      failure_message = ${RESUME_REVIEW_STALE_ERROR_MESSAGE},
      locked_at = NULL,
      locked_by = NULL,
      lock_expires_at = NULL,
      status = 'failed',
      updated_at = ${now}
    WHERE id = (
      SELECT id
      FROM ${resumeReviewRunSteps}
      WHERE workspace_id = ${args.workspaceId}
        AND workflow_run_id = ${args.run.id}
        AND status <> 'completed'
      ORDER BY sequence
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
  `);
}

async function getResumeReviewRunStepHealth(
  db: Pick<DbHandle, "select">,
  run: typeof workflowRuns.$inferSelect,
  workspaceId: string,
) {
  const now = new Date();
  const [summary] = await db
    .select({
      activeProcessingCount: sql<number>`
        count(*) filter (
          where ${resumeReviewRunSteps.status} = 'processing'
            and ${resumeReviewRunSteps.lockExpiresAt} is not null
            and ${resumeReviewRunSteps.lockExpiresAt} > ${now}
        )::int
      `,
      failedCount: sql<number>`count(*) filter (where ${resumeReviewRunSteps.status} = 'failed')::int`,
      lastUpdatedAt: sql<Date | null>`
        max(${resumeReviewRunSteps.updatedAt}) filter (
          where ${resumeReviewRunSteps.status} <> 'completed'
        )
      `,
      stepCount: sql<number>`count(*)::int`,
    })
    .from(resumeReviewRunSteps)
    .where(and(eq(resumeReviewRunSteps.workspaceId, workspaceId), eq(resumeReviewRunSteps.workflowRunId, run.id)));
  return {
    activeProcessingCount: Number(summary?.activeProcessingCount ?? 0),
    failedCount: Number(summary?.failedCount ?? 0),
    hasSteps: Number(summary?.stepCount ?? 0) > 0,
    lastUpdatedAt: asDate(summary?.lastUpdatedAt) ?? null,
  };
}

function isStaleResumeReviewRun(run: typeof workflowRuns.$inferSelect, now = Date.now()) {
  if (run.status !== "running") return false;
  const stage = getResumeReviewRunStage(run);
  if (!STALE_RESUME_REVIEW_STAGES.has(stage)) return false;
  return now - run.startedAt.getTime() > RESUME_REVIEW_STALE_RUN_MS;
}

function isStaleSteppedResumeReviewRun(
  run: typeof workflowRuns.$inferSelect,
  stepHealth: {
    activeProcessingCount: number;
    failedCount: number;
    lastUpdatedAt: Date | null;
  },
  now = Date.now(),
) {
  if (stepHealth.activeProcessingCount > 0) return false;
  if (stepHealth.failedCount > 0) return true;
  const lastActivityAt = stepHealth.lastUpdatedAt?.getTime() ?? run.startedAt.getTime();
  return now - lastActivityAt > RESUME_REVIEW_STEPPED_STALE_MS;
}

function getResumeReviewRunStageForStepKind(stepKind: string): ResumeReviewActiveRun["stage"] {
  if (stepKind === "segment_source") return "reading_source";
  if (stepKind === "assess_section") return "scanning";
  if (
    stepKind === "synthesize_scan" ||
    stepKind === "synthesize_rubric" ||
    stepKind === "synthesize_rubric_dimension" ||
    stepKind === "calibrate_score"
  ) return "scoring";
  if (stepKind === "synthesize_evidence") return "evidence_review";
  if (stepKind === "save_report") return "validating";
  return "queued";
}

function mapResumeReviewRunStepRow(row: unknown): typeof resumeReviewRunSteps.$inferSelect | null {
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  return {
    attemptCount: Number(record.attempt_count ?? 0),
    createdAt: asDate(record.created_at) ?? new Date(),
    failureKind: typeof record.failure_kind === "string" ? record.failure_kind : null,
    failureMessage: typeof record.failure_message === "string" ? record.failure_message : null,
    id: String(record.id),
    inputJson: asRecord(record.input_json),
    lockedAt: asDate(record.locked_at),
    lockedBy: typeof record.locked_by === "string" ? record.locked_by : null,
    lockExpiresAt: asDate(record.lock_expires_at),
    resultJson: asRecord(record.result_json),
    resumeSourceVersionId: String(record.resume_source_version_id),
    sequence: Number(record.sequence ?? 0),
    status: String(record.status) as typeof resumeReviewRunSteps.$inferSelect.status,
    stepKey: String(record.step_key),
    stepKind: String(record.step_kind),
    title: String(record.title),
    updatedAt: asDate(record.updated_at) ?? new Date(),
    workflowRunId: String(record.workflow_run_id),
    workspaceId: String(record.workspace_id),
  };
}

function asDate(value: unknown) {
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

async function updateResumeReviewRunStage(
  db: Pick<DbHandle, "select" | "update">,
  args: {
    run: typeof workflowRuns.$inferSelect;
    stage: ResumeReviewActiveRun["stage"];
    workspaceId: string;
  },
) {
  const [current] = await db
    .select({ skillMetadata: workflowRuns.skillMetadata })
    .from(workflowRuns)
    .where(and(eq(workflowRuns.workspaceId, args.workspaceId), eq(workflowRuns.id, args.run.id)))
    .limit(1);
  const [updated] = await db
    .update(workflowRuns)
    .set({
      skillMetadata: {
        ...(current?.skillMetadata ?? args.run.skillMetadata),
        stage: args.stage,
      },
    })
    .where(and(eq(workflowRuns.workspaceId, args.workspaceId), eq(workflowRuns.id, args.run.id)))
    .returning();
  return updated ?? args.run;
}

async function finishResumeReviewRun(
  db: Pick<DbHandle, "select" | "update">,
  args: {
    errorKind: string | null;
    errorMessage: string | null;
    review?: ResumeReviewBuildResult;
    run: typeof workflowRuns.$inferSelect;
    status: "succeeded" | "failed";
    workspaceId: string;
  },
) {
  const [current] = await db
    .select({ skillMetadata: workflowRuns.skillMetadata })
    .from(workflowRuns)
    .where(and(eq(workflowRuns.workspaceId, args.workspaceId), eq(workflowRuns.id, args.run.id)))
    .limit(1);
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
        ...(current?.skillMetadata ?? args.run.skillMetadata),
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
  db: Pick<DbHandle, "execute" | "select" | "update">,
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
  const activeRun = await findActiveResumeReviewRun(db, {
    resumeSourceVersionId: existing.id,
    workspaceId: args.workspaceId,
  });
  return {
    status: "duplicate" as const,
    existingResume: toResumeSummary(existing, latestReport, activeRun ?? undefined),
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

function getInitialResumeSourceLifecycleStatus(parseStatus?: string) {
  return parseStatus === "warning" ? "parsed_with_warnings" : "parsed";
}

async function buildReviewReport(args: {
  onStatus?: (stage: "scanning" | "scoring" | "evidence_review") => Promise<void>;
  sourceTitle: string;
  sourceText: string;
}): Promise<ResumeReviewBuildResult> {
  const config = resolveJobDeskAiConfig();
  try {
    const result = await resumeReviewAiAdapter({
      onStatus: args.onStatus,
      sourceText: args.sourceText,
      sourceTitle: args.sourceTitle,
    });
    return fromAiReview({
      review: result.data,
      provider: `openrouter-compatible:${config.transport}`,
      model: config.model,
      retryCount: result.retryCount,
      usage: result.usage,
      skill: result.skill,
    });
  } catch (error) {
    if (error instanceof JobDeskAiError) throw error;
    throw new JobDeskAiError("Resume review provider failed.", {
      kind: "provider_error",
      cause: error,
    });
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

async function toResumeReviewRunPayloadWithProgress(
  db: Pick<DbHandle, "select">,
  run: typeof workflowRuns.$inferSelect,
  workspaceId: string,
): Promise<ResumeReviewActiveRun> {
  return {
    ...toResumeReviewRunPayload(run),
    stepProgress: await buildResumeReviewStepProgress(db, run, workspaceId),
  };
}

async function buildResumeReviewStepProgress(
  db: Pick<DbHandle, "select">,
  run: typeof workflowRuns.$inferSelect,
  workspaceId: string,
): Promise<ResumeReviewStepProgress | null> {
  const steps = await db
    .select({
      sequence: resumeReviewRunSteps.sequence,
      status: resumeReviewRunSteps.status,
      stepKind: resumeReviewRunSteps.stepKind,
      title: resumeReviewRunSteps.title,
    })
    .from(resumeReviewRunSteps)
    .where(and(eq(resumeReviewRunSteps.workspaceId, workspaceId), eq(resumeReviewRunSteps.workflowRunId, run.id)))
    .orderBy(resumeReviewRunSteps.sequence);
  if (steps.length === 0) return null;
  const sectionSteps = steps.filter((step) => step.stepKind === "assess_section");
  const activeStep =
    steps.find((step) => step.status === "processing") ??
    steps.find((step) => step.status === "failed") ??
    steps.find((step) => step.status === "pending") ??
    null;
  return {
    completedSteps: steps.filter((step) => step.status === "completed").length,
    currentStepTitle: activeStep?.title ?? null,
    failedSteps: steps.filter((step) => step.status === "failed").length,
    processingSteps: steps.filter((step) => step.status === "processing").length,
    sectionCompleted: sectionSteps.filter((step) => step.status === "completed").length,
    sectionTotal: sectionSteps.length,
    totalSteps: steps.length,
  };
}

function getResumeReviewRunStage(run: typeof workflowRuns.$inferSelect): ResumeReviewActiveRun["stage"] {
  const stage = run.skillMetadata?.stage;
  if (
    stage === "queued" ||
    stage === "reading_source" ||
    stage === "scanning" ||
    stage === "scoring" ||
    stage === "evidence_review" ||
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
