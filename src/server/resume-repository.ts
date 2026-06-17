import { and, desc, eq, inArray } from "drizzle-orm";

import { getDb, hasDatabaseUrl } from "../db/client";
import {
  evidenceItems,
  generatedClaims,
  jobs,
  mainResumeVersions,
  resumeVersions,
  workflowRuns,
} from "../db/schema";
import type {
  JobDeskAiFailureKind,
  JobDeskAiSkillBinding,
  JobDeskAiUsage,
} from "../ai/types";
import type { TailoredResumeDraft } from "../schemas/tailored-resume";
import type { MainResumeDraft } from "../schemas/main-resume";
import type { PositioningDirection } from "../schemas/profile-positioning";
import { claimsMatch, validateBulletClaimCoverage } from "./tailored-resume-guardrails";
import { workflowSkillFields } from "./workflow-run-metadata";
import { skillRegistry } from "../ai/skills-registry";
import { getCurrentWorkspace, getOrCreateDefaultWorkspace } from "./workspace-repository";

type DbHandle = ReturnType<typeof getDb>;

export type FactGuardClaimReport = {
  id: string;
  claim_text: string;
  section: string;
  evidence_ids: string[];
  source_quotes: string[];
  support_status: string;
  claim_status: string;
  risk_level: string;
  stale_reason: string | null;
  last_validated_at: string | null;
};

export type TailoredResumePersistenceResult =
  | {
      status: "saved";
      workspaceId: string;
      resumeVersionId: string;
      workflowRunId: string;
      claimCount: number;
    }
  | {
      status: "skipped";
      reason: "missing_database_url";
    };

export type MainResumePersistenceResult =
  | {
      status: "saved";
      workspaceId: string;
      mainResumeVersionId: string;
      workflowRunId: string;
      claimCount: number;
    }
  | {
      status: "skipped";
      reason: "missing_database_url";
    };

export async function persistTailoredResume(args: {
  jobId: string;
  draft: TailoredResumeDraft;
  provider: string;
  model: string;
  usage: JobDeskAiUsage;
  retryCount: number;
  skill: JobDeskAiSkillBinding;
}): Promise<TailoredResumePersistenceResult> {
  if (!hasDatabaseUrl()) {
    return { status: "skipped", reason: "missing_database_url" };
  }

  return getDb().transaction(async (tx) => {
    const workspace = await getOrCreateDefaultWorkspace(tx);
    const [job] = await tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.workspaceId, workspace.id), eq(jobs.id, args.jobId)))
      .limit(1);
    if (!job) {
      throw new Error("Target job was not found in the current workspace.");
    }
    const now = new Date();
    const [resumeVersion] = await tx
      .insert(resumeVersions)
      .values({
        workspaceId: workspace.id,
        jobId: args.jobId,
        title: args.draft.title,
        resumeJson: args.draft.resume_json,
        resumeMarkdown: args.draft.resume_markdown,
        missingEvidenceQuestions: args.draft.missing_evidence_questions,
        status: "unvalidated",
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: resumeVersions.id });
    if (!resumeVersion) {
      throw new Error("Failed to create resume version.");
    }

    if (args.draft.claims.length > 0) {
      await tx.insert(generatedClaims).values(
        args.draft.claims.map((claim) => ({
          workspaceId: workspace.id,
          jobId: args.jobId,
          generatedDocumentId: resumeVersion.id,
          resumeVersionId: resumeVersion.id,
          claimText: claim.claim_text,
          section: claim.section,
          evidenceIds: claim.evidence_ids,
          sourceQuotes: claim.source_quotes,
          supportStatus: "unvalidated" as const,
          claimStatus: "unvalidated" as const,
          riskLevel: claim.risk_level,
          createdAt: now,
        })),
      );
    }

    const [workflowRun] = await tx
      .insert(workflowRuns)
      .values({
        workspaceId: workspace.id,
        jobId: args.jobId,
        workflowType: "tailored-resume",
        status: "succeeded",
        provider: args.provider,
        model: args.model,
        ...workflowSkillFields(args.skill),
        inputTokens: args.usage.inputTokens ?? null,
        outputTokens: args.usage.outputTokens ?? null,
        totalTokens: args.usage.totalTokens ?? null,
        retryCount: args.retryCount,
        startedAt: now,
        finishedAt: now,
      })
      .returning({ id: workflowRuns.id });
    if (!workflowRun) {
      throw new Error("Failed to create workflow run.");
    }

    return {
      status: "saved",
      workspaceId: workspace.id,
      resumeVersionId: resumeVersion.id,
      workflowRunId: workflowRun.id,
      claimCount: args.draft.claims.length,
    };
  });
}

export async function persistMainResume(args: {
  draft: MainResumeDraft;
  positioning?: {
    reportId: string;
    direction: PositioningDirection;
  } | null;
  provider: string;
  model: string;
  usage: JobDeskAiUsage;
  retryCount: number;
  skill: JobDeskAiSkillBinding;
}): Promise<MainResumePersistenceResult> {
  if (!hasDatabaseUrl()) {
    return { status: "skipped", reason: "missing_database_url" };
  }

  return getDb().transaction(async (tx) => {
    const workspace = await getOrCreateDefaultWorkspace(tx);
    const now = new Date();
    const [workflowRun] = await tx
      .insert(workflowRuns)
      .values({
        workspaceId: workspace.id,
        workflowType: args.skill.workflowType,
        status: "succeeded",
        provider: args.provider,
        model: args.model,
        ...workflowSkillFields(args.skill),
        inputTokens: args.usage.inputTokens ?? null,
        outputTokens: args.usage.outputTokens ?? null,
        totalTokens: args.usage.totalTokens ?? null,
        retryCount: args.retryCount,
        startedAt: now,
        finishedAt: now,
      })
      .returning({ id: workflowRuns.id });
    if (!workflowRun) {
      throw new Error("Failed to create main resume workflow run.");
    }

    const [mainResume] = await tx
      .insert(mainResumeVersions)
      .values({
        workspaceId: workspace.id,
        workflowRunId: workflowRun.id,
        positioningReportId: args.positioning?.reportId ?? null,
        positioningDirectionId: args.positioning?.direction.id ?? null,
        positioningTitle: args.positioning?.direction.target_role ?? null,
        title: args.draft.title,
        resumeJson: args.draft.resume_json,
        resumeMarkdown: args.draft.resume_markdown,
        missingEvidenceQuestions: args.draft.missing_evidence_questions,
        status: "unvalidated",
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: mainResumeVersions.id });
    if (!mainResume) {
      throw new Error("Failed to create main resume version.");
    }

    if (args.draft.claims.length > 0) {
      await tx.insert(generatedClaims).values(
        args.draft.claims.map((claim) => ({
          workspaceId: workspace.id,
          mainResumeVersionId: mainResume.id,
          claimText: claim.claim_text,
          section: claim.section,
          evidenceIds: claim.evidence_ids,
          sourceQuotes: claim.source_quotes,
          supportStatus: "unvalidated" as const,
          claimStatus: "unvalidated" as const,
          riskLevel: claim.risk_level,
          createdAt: now,
        })),
      );
    }

    return {
      status: "saved",
      workspaceId: workspace.id,
      mainResumeVersionId: mainResume.id,
      workflowRunId: workflowRun.id,
      claimCount: args.draft.claims.length,
    };
  });
}

export async function persistTailoredResumeFailure(args: {
  jobId?: string | null;
  provider: string;
  model: string;
  errorKind: JobDeskAiFailureKind | "unknown";
  errorMessage: string;
  retryCount: number;
  skill: JobDeskAiSkillBinding;
}) {
  if (!hasDatabaseUrl()) {
    return { status: "skipped" as const, reason: "missing_database_url" as const };
  }

  const db = getDb();
  const workspace = await getOrCreateDefaultWorkspace(db);
  let scopedJobId = args.jobId ?? null;
  if (scopedJobId) {
    const [job] = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.workspaceId, workspace.id), eq(jobs.id, scopedJobId)))
      .limit(1);
    scopedJobId = job?.id ?? null;
  }
  const now = new Date();
  const [workflowRun] = await db
    .insert(workflowRuns)
    .values({
      workspaceId: workspace.id,
      jobId: scopedJobId,
      workflowType: args.skill.workflowType,
      status: "failed",
      provider: args.provider,
      model: args.model,
      ...workflowSkillFields(args.skill),
      retryCount: args.retryCount,
      errorKind: args.errorKind,
      errorMessage: sanitizeWorkflowError(args.errorMessage),
      startedAt: now,
      finishedAt: now,
    })
    .returning({ id: workflowRuns.id });

  return workflowRun
    ? ({ status: "saved" as const, workflowRunId: workflowRun.id })
    : ({ status: "skipped" as const, reason: "missing_database_url" as const });
}

export async function getRecentTailoredResumes(limit = 5) {
  if (!hasDatabaseUrl()) return [];
  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const rows = await db
    .select()
    .from(resumeVersions)
    .where(eq(resumeVersions.workspaceId, workspace.id))
    .orderBy(desc(resumeVersions.updatedAt))
    .limit(limit);

  return Promise.all(rows.map((resume) => toTailoredResumeDto(db, resume)));
}

export async function getRecentMainResumes(limit = 5) {
  if (!hasDatabaseUrl()) return [];
  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const rows = await db
    .select()
    .from(mainResumeVersions)
    .where(eq(mainResumeVersions.workspaceId, workspace.id))
    .orderBy(desc(mainResumeVersions.updatedAt))
    .limit(limit);

  return Promise.all(rows.map((resume) => toMainResumeDto(db, resume)));
}

async function toMainResumeDto(
  db: Pick<DbHandle, "select">,
  resume: typeof mainResumeVersions.$inferSelect,
) {
  const claims = await db
    .select()
    .from(generatedClaims)
    .where(
      and(
        eq(generatedClaims.workspaceId, resume.workspaceId),
        eq(generatedClaims.mainResumeVersionId, resume.id),
      ),
    );
  return {
    id: resume.id,
    title: resume.title,
    positioning_report_id: resume.positioningReportId,
    positioning_direction_id: resume.positioningDirectionId,
    positioning_title: resume.positioningTitle,
    resume_markdown: resume.resumeMarkdown,
    resume_json: resume.resumeJson,
    missing_evidence_questions: resume.missingEvidenceQuestions,
    version: resume.version,
    status: resume.status,
    updatedAt: resume.updatedAt.toISOString(),
    claims: claims.map((claim) => ({
      id: claim.id,
      claim_text: claim.claimText,
      section: claim.section,
      evidence_ids: claim.evidenceIds,
      source_quotes: claim.sourceQuotes,
      support_status: claim.supportStatus,
      claim_status: claim.claimStatus,
      risk_level: claim.riskLevel,
      stale_reason: claim.staleReason,
      last_validated_at: claim.lastValidatedAt?.toISOString() ?? null,
    })),
  };
}

export async function getTailoredResumeById(resumeVersionId: string) {
  if (!hasDatabaseUrl()) return null;
  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const [resume] = await db
    .select()
    .from(resumeVersions)
    .where(and(eq(resumeVersions.workspaceId, workspace.id), eq(resumeVersions.id, resumeVersionId)))
    .limit(1);
  return resume ? toTailoredResumeDto(db, resume) : null;
}

export async function getMainResumeById(mainResumeVersionId: string) {
  if (!hasDatabaseUrl()) return null;
  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const [resume] = await db
    .select()
    .from(mainResumeVersions)
    .where(
      and(
        eq(mainResumeVersions.workspaceId, workspace.id),
        eq(mainResumeVersions.id, mainResumeVersionId),
      ),
    )
    .limit(1);
  return resume ? toMainResumeDto(db, resume) : null;
}

async function toTailoredResumeDto(
  db: Pick<DbHandle, "select">,
  resume: typeof resumeVersions.$inferSelect,
) {
  const claims = await db
    .select()
    .from(generatedClaims)
    .where(
      and(
        eq(generatedClaims.workspaceId, resume.workspaceId),
        eq(generatedClaims.resumeVersionId, resume.id),
      ),
    );
  return {
    id: resume.id,
    jobId: resume.jobId,
    title: resume.title,
    resume_markdown: resume.resumeMarkdown,
    resume_json: resume.resumeJson,
    missing_evidence_questions: resume.missingEvidenceQuestions,
    version: resume.version,
    status: resume.status,
    updatedAt: resume.updatedAt.toISOString(),
    claims: claims.map((claim) => ({
      id: claim.id,
      claim_text: claim.claimText,
      section: claim.section,
      evidence_ids: claim.evidenceIds,
      source_quotes: claim.sourceQuotes,
      support_status: claim.supportStatus,
      claim_status: claim.claimStatus,
      risk_level: claim.riskLevel,
      stale_reason: claim.staleReason,
      last_validated_at: claim.lastValidatedAt?.toISOString() ?? null,
    })),
  };
}

export async function runFactGuardForResume(resumeVersionId: string) {
  if (!hasDatabaseUrl()) {
    return { status: "skipped" as const, reason: "missing_database_url" as const };
  }

  return getDb().transaction(async (tx) => {
    const workspace = await getCurrentWorkspace(tx);
    const [resume] = await tx
      .select()
      .from(resumeVersions)
      .where(and(eq(resumeVersions.workspaceId, workspace.id), eq(resumeVersions.id, resumeVersionId)))
      .limit(1);
    if (!resume) {
      return { status: "not_found" as const };
    }

    const claims = await tx
      .select()
      .from(generatedClaims)
      .where(
        and(
          eq(generatedClaims.workspaceId, workspace.id),
          eq(generatedClaims.resumeVersionId, resumeVersionId),
        ),
      );
    const evidenceIds = Array.from(
      new Set(claims.flatMap((claim) => claim.evidenceIds)),
    );
    const evidence =
      evidenceIds.length > 0
        ? await tx
            .select()
            .from(evidenceItems)
            .where(and(eq(evidenceItems.workspaceId, workspace.id), inArray(evidenceItems.id, evidenceIds)))
        : [];
    const evidenceById = new Map(evidence.map((item) => [item.id, item]));
    const now = new Date();
    let supportedCount = 0;

    for (const claim of claims) {
      const verdict = evaluateClaimSupport(claim, evidenceById);
      if (verdict.supportStatus === "supported") supportedCount += 1;
      await tx
        .update(generatedClaims)
        .set({
          supportStatus: verdict.supportStatus,
          claimStatus: verdict.claimStatus,
          staleReason: verdict.staleReason,
          lastValidatedAt: now,
        })
        .where(and(eq(generatedClaims.workspaceId, workspace.id), eq(generatedClaims.id, claim.id)));
    }

    const coverage = validateBulletClaimCoverage({
      resumeMarkdown: resume.resumeMarkdown,
      claims: claims.map((claim) => claim.claimText),
    });
    if (!coverage.passed && claims.length > 0) {
      supportedCount = 0;
      await tx
        .update(generatedClaims)
        .set({
          supportStatus: "partially_supported",
          claimStatus: "partially_supported",
          staleReason: coverage.reason,
          lastValidatedAt: now,
        })
        .where(
          and(
            eq(generatedClaims.workspaceId, workspace.id),
            eq(generatedClaims.resumeVersionId, resumeVersionId),
          ),
        );
    }

    const allSupported =
      claims.length > 0 && supportedCount === claims.length && coverage.passed;
    await tx
      .update(resumeVersions)
      .set({
        status: allSupported ? "validated" : "unvalidated",
        updatedAt: now,
      })
      .where(and(eq(resumeVersions.workspaceId, workspace.id), eq(resumeVersions.id, resumeVersionId)));

    const [workflowRun] = await tx
      .insert(workflowRuns)
      .values({
        workspaceId: resume.workspaceId,
        jobId: resume.jobId,
        workflowType: "fact-guard",
        status: "succeeded",
        provider: "deterministic",
        model: "fact-guard-v0",
        ...workflowSkillFields(skillRegistry.factGuardV0),
        retryCount: 0,
        startedAt: now,
        finishedAt: now,
      })
      .returning({ id: workflowRuns.id });

    const guardedClaims = await tx
      .select()
      .from(generatedClaims)
      .where(
        and(
          eq(generatedClaims.workspaceId, workspace.id),
          eq(generatedClaims.resumeVersionId, resumeVersionId),
        ),
      );

    return {
      status: "validated" as const,
      resumeVersionId,
      workflowRunId: workflowRun?.id ?? null,
      claimCount: claims.length,
      supportedCount,
      resumeStatus: allSupported ? "validated" : "unvalidated",
      coveragePassed: coverage.passed,
      coverageReason: coverage.reason,
      claims: guardedClaims.map(toFactGuardClaimReport),
    };
  });
}

export async function runFactGuardForMainResume(mainResumeVersionId: string) {
  if (!hasDatabaseUrl()) {
    return { status: "skipped" as const, reason: "missing_database_url" as const };
  }

  return getDb().transaction(async (tx) => {
    const workspace = await getCurrentWorkspace(tx);
    const [resume] = await tx
      .select()
      .from(mainResumeVersions)
      .where(and(eq(mainResumeVersions.workspaceId, workspace.id), eq(mainResumeVersions.id, mainResumeVersionId)))
      .limit(1);
    if (!resume) {
      return { status: "not_found" as const };
    }

    const claims = await tx
      .select()
      .from(generatedClaims)
      .where(
        and(
          eq(generatedClaims.workspaceId, workspace.id),
          eq(generatedClaims.mainResumeVersionId, mainResumeVersionId),
        ),
      );
    const evidenceIds = Array.from(
      new Set(claims.flatMap((claim) => claim.evidenceIds)),
    );
    const evidence =
      evidenceIds.length > 0
        ? await tx
            .select()
            .from(evidenceItems)
            .where(and(eq(evidenceItems.workspaceId, workspace.id), inArray(evidenceItems.id, evidenceIds)))
        : [];
    const evidenceById = new Map(evidence.map((item) => [item.id, item]));
    const now = new Date();
    let supportedCount = 0;

    for (const claim of claims) {
      const verdict = evaluateClaimSupport(claim, evidenceById);
      if (verdict.supportStatus === "supported") supportedCount += 1;
      await tx
        .update(generatedClaims)
        .set({
          supportStatus: verdict.supportStatus,
          claimStatus: verdict.claimStatus,
          staleReason: verdict.staleReason,
          lastValidatedAt: now,
        })
        .where(and(eq(generatedClaims.workspaceId, workspace.id), eq(generatedClaims.id, claim.id)));
    }

    const coverage = validateBulletClaimCoverage({
      resumeMarkdown: resume.resumeMarkdown,
      claims: claims.map((claim) => claim.claimText),
    });
    if (!coverage.passed && claims.length > 0) {
      supportedCount = 0;
      await tx
        .update(generatedClaims)
        .set({
          supportStatus: "partially_supported",
          claimStatus: "partially_supported",
          staleReason: coverage.reason,
          lastValidatedAt: now,
        })
        .where(
          and(
            eq(generatedClaims.workspaceId, workspace.id),
            eq(generatedClaims.mainResumeVersionId, mainResumeVersionId),
          ),
        );
    }

    const allSupported =
      claims.length > 0 && supportedCount === claims.length && coverage.passed;
    await tx
      .update(mainResumeVersions)
      .set({
        status: allSupported ? "validated" : "unvalidated",
        updatedAt: now,
      })
      .where(
        and(
          eq(mainResumeVersions.workspaceId, workspace.id),
          eq(mainResumeVersions.id, mainResumeVersionId),
        ),
      );

    const [workflowRun] = await tx
      .insert(workflowRuns)
      .values({
        workspaceId: resume.workspaceId,
        workflowType: "fact-guard",
        status: "succeeded",
        provider: "deterministic",
        model: "fact-guard-v0",
        ...workflowSkillFields(skillRegistry.factGuardV0),
        retryCount: 0,
        startedAt: now,
        finishedAt: now,
      })
      .returning({ id: workflowRuns.id });

    const guardedClaims = await tx
      .select()
      .from(generatedClaims)
      .where(
        and(
          eq(generatedClaims.workspaceId, workspace.id),
          eq(generatedClaims.mainResumeVersionId, mainResumeVersionId),
        ),
      );

    return {
      status: "validated" as const,
      mainResumeVersionId,
      workflowRunId: workflowRun?.id ?? null,
      claimCount: claims.length,
      supportedCount,
      resumeStatus: allSupported ? "validated" : "unvalidated",
      coveragePassed: coverage.passed,
      coverageReason: coverage.reason,
      claims: guardedClaims.map(toFactGuardClaimReport),
    };
  });
}

function toFactGuardClaimReport(
  claim: typeof generatedClaims.$inferSelect,
): FactGuardClaimReport {
  return {
    id: claim.id,
    claim_text: claim.claimText,
    section: claim.section,
    evidence_ids: claim.evidenceIds,
    source_quotes: claim.sourceQuotes,
    support_status: claim.supportStatus,
    claim_status: claim.claimStatus,
    risk_level: claim.riskLevel,
    stale_reason: claim.staleReason,
    last_validated_at: claim.lastValidatedAt?.toISOString() ?? null,
  };
}

function sanitizeWorkflowError(message: string) {
  return message.replace(/sk-[A-Za-z0-9_-]+/g, "sk-***").slice(0, 1200);
}

function evaluateClaimSupport(
  claim: typeof generatedClaims.$inferSelect,
  evidenceById: Map<string, typeof evidenceItems.$inferSelect>,
) {
  if (claim.evidenceIds.length === 0) {
    return unsupported("claim has no evidence ids");
  }
  if (claim.sourceQuotes.length === 0) {
    return unsupported("claim has no source quotes");
  }

  const evidence = claim.evidenceIds.map((id) => evidenceById.get(id));
  if (evidence.some((item) => !item)) {
    return unsupported("claim references missing evidence");
  }

  const quoteSupported = claim.sourceQuotes.every((quote) =>
    evidence.some(
      (item) =>
        item &&
        (claimsMatch(item.sourceQuote, quote) || claimsMatch(item.text, quote)),
    ),
  );
  if (!quoteSupported) {
    return unsupported("claim source quote is not present in referenced evidence");
  }

  const textSupported = evidence.some(
    (item) =>
      item &&
      (claimsMatch(item.text, claim.claimText) ||
        claimsMatch(item.sourceQuote, claim.claimText) ||
        claim.sourceQuotes.some((quote) => claimsMatch(claim.claimText, quote))),
  );

  return {
    supportStatus: textSupported ? ("supported" as const) : ("partially_supported" as const),
    claimStatus: textSupported ? ("supported" as const) : ("partially_supported" as const),
    staleReason: textSupported ? null : "claim text is broader than referenced quote",
  };
}

function unsupported(reason: string) {
  return {
    supportStatus: "unsupported" as const,
    claimStatus: "unsupported" as const,
    staleReason: reason,
  };
}
