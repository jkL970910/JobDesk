import crypto from "node:crypto";

import { and, asc, desc, eq, isNull } from "drizzle-orm";

import { getDb, hasDatabaseUrl } from "../db/client";
import {
  jobRequirements,
  jobs,
  sourceDocuments,
  workflowRuns,
} from "../db/schema";
import { JobLegitimacy, type JDAnalysis } from "../schemas/jd-analysis";
import { ApplicationStatus, type ApplicationStatus as ApplicationStatusValue } from "../schemas/shared";
import type { JobDeskAiFailureKind, JobDeskAiSkillBinding } from "../ai/types";
import { workflowSkillFields } from "./workflow-run-metadata";
import { getOrCreateDefaultWorkspace } from "./workspace-repository";

type DbHandle = ReturnType<typeof getDb>;

export class JobRepositoryError extends Error {
  readonly kind: "job_not_found";

  constructor(message: string, options: { kind: "job_not_found" }) {
    super(message);
    this.name = "JobRepositoryError";
    this.kind = options.kind;
  }
}

export type PersistenceResult =
  | {
      status: "saved";
      workspaceId: string;
      jobId?: string;
      workflowRunId: string;
    }
  | {
      status: "skipped";
      reason: "missing_database_url";
    };

export async function persistJdAnalysis(args: {
  analysis: JDAnalysis;
  targetJobId?: string | null;
  provider: string;
  model: string;
  usage: {
    inputTokens?: number | null;
    outputTokens?: number | null;
    totalTokens?: number | null;
  };
  retryCount: number;
  skill: JobDeskAiSkillBinding;
}): Promise<PersistenceResult> {
  if (!hasDatabaseUrl()) {
    return { status: "skipped", reason: "missing_database_url" };
  }

  return getDb().transaction(async (tx) => {
    const workspace = await getOrCreateDefaultWorkspace(tx);
    const now = new Date();
    const title =
      args.analysis.job_facts.role_title ??
      inferJobTitle(args.analysis.original_jd_text);
    const contentHash = crypto
      .createHash("sha256")
      .update(args.analysis.original_jd_text)
      .digest("hex");
    const existingJob = args.targetJobId
      ? await getActiveJobById(tx, args.targetJobId)
      : null;
    if (args.targetJobId && !existingJob) {
      throw new JobRepositoryError("Target job was not found or has been archived.", {
        kind: "job_not_found",
      });
    }
    const sourceDocumentId = await createSourceDocument(tx, {
      workspaceId: workspace.id,
      title,
      jdText: args.analysis.original_jd_text,
      contentHash,
      now,
    });

    const [job] = existingJob
      ? await tx
          .update(jobs)
          .set({
            title,
            sourceDocumentId,
            company: args.analysis.job_facts.company,
            roleTitle: args.analysis.job_facts.role_title,
            level: args.analysis.job_facts.level,
            location: args.analysis.job_facts.location,
            originalJdText: args.analysis.original_jd_text,
            responsibilities: args.analysis.job_facts.responsibilities,
            preferredQualifications:
              args.analysis.job_facts.preferred_qualifications,
            roleSignals: args.analysis.role_signals,
            roleArchetype: args.analysis.role_archetype,
            jobLegitimacy: args.analysis.job_legitimacy,
            keywords: args.analysis.keywords,
            interviewImplications: args.analysis.interview_implications,
            lastAnalyzedAt: now,
            updatedAt: now,
          })
          .where(eq(jobs.id, existingJob.id))
          .returning()
      : await tx
          .insert(jobs)
          .values({
            workspaceId: workspace.id,
            sourceDocumentId,
            title,
            company: args.analysis.job_facts.company,
            roleTitle: args.analysis.job_facts.role_title,
            level: args.analysis.job_facts.level,
            location: args.analysis.job_facts.location,
            originalJdText: args.analysis.original_jd_text,
            responsibilities: args.analysis.job_facts.responsibilities,
            preferredQualifications:
              args.analysis.job_facts.preferred_qualifications,
            roleSignals: args.analysis.role_signals,
            roleArchetype: args.analysis.role_archetype,
            jobLegitimacy: args.analysis.job_legitimacy,
            keywords: args.analysis.keywords,
            interviewImplications: args.analysis.interview_implications,
            lastAnalyzedAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
    if (!job) {
      throw new Error("Failed to create job.");
    }

    if (existingJob) {
      await tx.delete(jobRequirements).where(eq(jobRequirements.jobId, existingJob.id));
    }

    if (args.analysis.requirements.length > 0) {
      await tx.insert(jobRequirements).values(
        args.analysis.requirements.map((requirement, index) => ({
          jobId: job.id,
          text: requirement.text,
          sourceQuote: requirement.source_quote,
          requirementType: requirement.requirement_type,
          importance: Math.round(requirement.importance * 100),
          keywords: requirement.keywords,
          verified: requirement.verified ? 1 : 0,
          sortOrder: index,
        })),
      );
    }

    const [workflowRun] = await tx
      .insert(workflowRuns)
      .values({
        workspaceId: workspace.id,
        jobId: job.id,
        workflowType: "jd-analysis",
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
      .returning();
    if (!workflowRun) {
      throw new Error("Failed to create workflow run.");
    }

    return {
      status: "saved",
      workspaceId: workspace.id,
      jobId: job.id,
      workflowRunId: workflowRun.id,
    };
  });
}

export async function persistJdAnalysisFailure(args: {
  provider: string;
  model: string;
  errorKind: JobDeskAiFailureKind | "unknown";
  errorMessage: string;
  retryCount: number;
  skill: JobDeskAiSkillBinding;
}): Promise<PersistenceResult> {
  if (!hasDatabaseUrl()) {
    return { status: "skipped", reason: "missing_database_url" };
  }

  const db = getDb();
  const workspace = await getOrCreateDefaultWorkspace(db);
  const now = new Date();
  const [workflowRun] = await db
    .insert(workflowRuns)
    .values({
      workspaceId: workspace.id,
      workflowType: "jd-analysis",
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
    .returning();
  if (!workflowRun) {
    throw new Error("Failed to create workflow run.");
  }

  return {
    status: "saved",
    workspaceId: workspace.id,
    workflowRunId: workflowRun.id,
  };
}

export async function getRecentJdAnalyses(limit = 5) {
  if (!hasDatabaseUrl()) return [];
  const db = getDb();
  const rows = await db
    .select()
    .from(jobs)
    .where(isNull(jobs.archivedAt))
    .orderBy(desc(jobs.updatedAt))
    .limit(limit);

  return Promise.all(rows.map((job) => hydrateJdAnalysis(db, job)));
}

export async function getJdAnalysisById(jobId: string) {
  if (!hasDatabaseUrl()) return null;
  const db = getDb();
  const [job] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, jobId), isNull(jobs.archivedAt)))
    .limit(1);
  if (!job) return null;
  return hydrateJdAnalysis(db, job);
}

export async function assertActiveJdAnalysis(jobId: string) {
  if (!hasDatabaseUrl()) return;
  const job = await getJdAnalysisById(jobId);
  if (!job) {
    throw new JobRepositoryError("Target job was not found or has been archived.", {
      kind: "job_not_found",
    });
  }
}

export async function archiveJdAnalysis(jobId: string) {
  if (!hasDatabaseUrl()) {
    return { status: "skipped" as const, reason: "missing_database_url" as const };
  }

  const [job] = await getDb()
    .update(jobs)
    .set({
      archivedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(jobs.id, jobId), isNull(jobs.archivedAt)))
    .returning({ id: jobs.id });

  return job
    ? ({ status: "archived" as const, jobId: job.id })
    : ({ status: "not_found" as const });
}

export async function updateApplicationStatus(
  jobId: string,
  status: ApplicationStatusValue,
) {
  if (!hasDatabaseUrl()) {
    return { status: "skipped" as const, reason: "missing_database_url" as const };
  }

  const parsedStatus = ApplicationStatus.parse(status);
  const [job] = await getDb()
    .update(jobs)
    .set({
      applicationStatus: parsedStatus,
      updatedAt: new Date(),
    })
    .where(and(eq(jobs.id, jobId), isNull(jobs.archivedAt)))
    .returning({
      id: jobs.id,
      applicationStatus: jobs.applicationStatus,
    });

  return job
    ? ({
        status: "updated" as const,
        jobId: job.id,
        applicationStatus: job.applicationStatus,
      })
    : ({ status: "not_found" as const });
}

async function createSourceDocument(
  db: Pick<DbHandle, "insert">,
  args: {
    workspaceId: string;
    title: string;
    jdText: string;
    contentHash: string;
    now: Date;
  },
) {
  const [sourceDocument] = await db
    .insert(sourceDocuments)
    .values({
      workspaceId: args.workspaceId,
      sourceType: "job-description",
      title: args.title,
      contentText: args.jdText,
      contentHash: args.contentHash,
      createdAt: args.now,
    })
    .returning({ id: sourceDocuments.id });
  if (!sourceDocument) {
    throw new Error("Failed to create source document.");
  }
  return sourceDocument.id;
}

async function getActiveJobById(db: Pick<DbHandle, "select">, jobId: string) {
  const [job] = await db
    .select()
    .from(jobs)
    .where(and(eq(jobs.id, jobId), isNull(jobs.archivedAt)))
    .limit(1);
  return job ?? null;
}

async function hydrateJdAnalysis(
  db: Pick<DbHandle, "select">,
  job: typeof jobs.$inferSelect,
) {
  const requirements = await db
    .select()
    .from(jobRequirements)
    .where(eq(jobRequirements.jobId, job.id))
    .orderBy(asc(jobRequirements.sortOrder));
  return {
    id: job.id,
    title: job.title,
    job_facts: {
      company: job.company,
      role_title: job.roleTitle,
      level: job.level,
      location: job.location,
      responsibilities: job.responsibilities,
      preferred_qualifications: job.preferredQualifications,
    },
    originalJdText: job.originalJdText,
    analyzedAt: job.lastAnalyzedAt?.toISOString() ?? null,
    requirementCount: requirements.length,
    keywords: job.keywords,
    requirements: requirements.map((requirement) => ({
      text: requirement.text,
      source_quote: requirement.sourceQuote,
      requirement_type: requirement.requirementType,
      importance: requirement.importance / 100,
      keywords: requirement.keywords,
      verified: requirement.verified === 1,
    })),
    role_archetype: job.roleArchetype,
    job_legitimacy: JobLegitimacy.parse(job.jobLegitimacy),
    application_status: job.applicationStatus,
    role_signals: job.roleSignals,
    interview_implications: job.interviewImplications,
  };
}

function inferJobTitle(jdText: string) {
  const firstLine = jdText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return (firstLine ?? "Untitled job").slice(0, 240);
}

function sanitizeWorkflowError(message: string) {
  return message.replace(/sk-[A-Za-z0-9_-]+/g, "sk-***").slice(0, 1200);
}
