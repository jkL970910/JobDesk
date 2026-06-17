import crypto from "node:crypto";

import { and, desc, eq, or } from "drizzle-orm";

import { skillRegistry } from "../ai/skills-registry";
import type { ProfilePositioningEvidenceContext } from "../ai/profile-positioning";
import type {
  JobDeskAiFailureKind,
  JobDeskAiSkillBinding,
  JobDeskAiUsage,
} from "../ai/types";
import { getDb, hasDatabaseUrl } from "../db/client";
import {
  evidenceItems,
  profilePositioningReports,
  profiles,
  workflowRuns,
} from "../db/schema";
import type { ProfilePositioningReport } from "../schemas/profile-positioning";
import { workflowSkillFields } from "./workflow-run-metadata";
import { upsertEnrichmentTasks } from "./enrichment-task-repository";
import { getCurrentWorkspace, getOrCreateDefaultWorkspace } from "./workspace-repository";

export type ProfilePositioningContext = Awaited<
  ReturnType<typeof getProfilePositioningContext>
>;

export type ProfilePositioningPersistenceResult =
  | {
      status: "saved";
      workspaceId: string;
      profilePositioningReportId: string;
      workflowRunId: string;
      directionCount: number;
    }
  | {
      status: "skipped";
      reason: "missing_database_url";
    };

export async function getProfilePositioningContext() {
  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const [profile] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.workspaceId, workspace.id))
    .orderBy(desc(profiles.updatedAt))
    .limit(1);
  const rows = await db
    .select()
    .from(evidenceItems)
    .where(
      and(
        eq(evidenceItems.workspaceId, workspace.id),
        or(
          eq(evidenceItems.status, "approved"),
          and(
            eq(evidenceItems.status, "pending"),
            eq(evidenceItems.needsUserConfirmation, 0),
          ),
        ),
      ),
    )
    .orderBy(desc(evidenceItems.updatedAt))
    .limit(80);
  const evidence = rows
    .filter((item) => isUsefulPositioningEvidence(item))
    .map(toProfilePositioningEvidenceContext);
  return {
    profile: profile
      ? {
          id: profile.id,
          profile: profile.profileJson,
          updatedAt: profile.updatedAt.toISOString(),
        }
      : null,
    evidenceItems: evidence,
    evidenceSnapshotHash: buildEvidenceSnapshotHash(evidence),
  };
}

export async function getRecentProfilePositioningReports(limit = 5) {
  if (!hasDatabaseUrl()) return [];
  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const rows = await db
    .select()
    .from(profilePositioningReports)
    .where(eq(profilePositioningReports.workspaceId, workspace.id))
    .orderBy(desc(profilePositioningReports.updatedAt))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    profileId: row.profileId,
    status: row.status,
    report: row.reportJson as ProfilePositioningReport,
    evidenceSnapshotHash: row.evidenceSnapshotHash,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function getProfilePositioningReportById(reportId: string) {
  if (!hasDatabaseUrl()) return null;
  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const [row] = await db
    .select()
    .from(profilePositioningReports)
    .where(eq(profilePositioningReports.id, reportId))
    .limit(1);
  if (!row || row.workspaceId !== workspace.id) return null;
  return {
    id: row.id,
    profileId: row.profileId,
    status: row.status,
    report: row.reportJson as ProfilePositioningReport,
    evidenceSnapshotHash: row.evidenceSnapshotHash,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function createPositioningEnrichmentTasks(args: {
  reportId: string;
  directionId: string;
}) {
  if (!hasDatabaseUrl()) {
    return { status: "skipped" as const, reason: "missing_database_url" as const };
  }
  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const [row] = await db
    .select()
    .from(profilePositioningReports)
    .where(
      and(
        eq(profilePositioningReports.id, args.reportId),
        eq(profilePositioningReports.workspaceId, workspace.id),
      ),
    )
    .limit(1);
  if (!row) return { status: "not_found" as const };
  const report = row.reportJson as ProfilePositioningReport;
  const direction = report.directions.find((candidate) => candidate.id === args.directionId);
  if (!direction) return { status: "not_found" as const };
  const tasks = direction.missing_evidence_questions.map((question) => ({
    taskType: classifyPositioningQuestion(question),
    sourceType: "user_input" as const,
    sourceLabel: `Positioning: ${direction.target_role}`,
    prompt: question,
  }));
  const inserted = await upsertEnrichmentTasks(db, {
    workspaceId: workspace.id,
    tasks,
  });
  return {
    status: "saved" as const,
    taskCount: inserted.length,
    directionTitle: direction.target_role,
  };
}

export async function persistProfilePositioningReport(args: {
  profileId: string | null;
  report: ProfilePositioningReport;
  evidenceSnapshotHash: string;
  provider: string;
  model: string;
  usage: JobDeskAiUsage;
  retryCount: number;
  skill: JobDeskAiSkillBinding;
}): Promise<ProfilePositioningPersistenceResult> {
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
      throw new Error("Failed to create profile positioning workflow run.");
    }

    const [report] = await tx
      .insert(profilePositioningReports)
      .values({
        workspaceId: workspace.id,
        profileId: args.profileId,
        workflowRunId: workflowRun.id,
        status: "succeeded",
        reportJson: args.report,
        evidenceSnapshotHash: args.evidenceSnapshotHash,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: profilePositioningReports.id });
    if (!report) {
      throw new Error("Failed to create profile positioning report.");
    }

    return {
      status: "saved",
      workspaceId: workspace.id,
      profilePositioningReportId: report.id,
      workflowRunId: workflowRun.id,
      directionCount: args.report.directions.length,
    };
  });
}

export class ProfilePositioningPostCheckError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Profile positioning report failed deterministic checks: ${issues.join("; ")}`);
    this.name = "ProfilePositioningPostCheckError";
    this.issues = issues;
  }
}

export function validateProfilePositioningReport(
  report: ProfilePositioningReport,
  evidenceItems: ProfilePositioningEvidenceContext[],
) {
  const evidenceIds = new Set(evidenceItems.map((item) => item.id));
  const issues: string[] = [];
  for (const direction of report.directions) {
    if (direction.supporting_evidence.length === 0) {
      issues.push(`${direction.id}: missing supporting evidence`);
    }
    if (direction.fit_score < 0 || direction.fit_score > 100) {
      issues.push(`${direction.id}: fit score outside 0-100`);
    }
    if (
      (direction.confidence === "low" || direction.confidence === "medium") &&
      direction.missing_evidence_questions.length === 0
    ) {
      issues.push(`${direction.id}: low/medium confidence direction needs missing evidence questions`);
    }
    if (
      direction.support_level === "aspirational_gap" &&
      direction.missing_evidence_questions.length === 0
    ) {
      issues.push(`${direction.id}: aspirational direction needs missing evidence questions`);
    }
    for (const support of direction.supporting_evidence) {
      if (!evidenceIds.has(support.evidence_id)) {
        issues.push(`${direction.id}: unknown evidence id ${support.evidence_id}`);
      }
    }
  }
  if (issues.length > 0) {
    throw new ProfilePositioningPostCheckError(issues);
  }
}

export async function persistProfilePositioningFailure(args: {
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
  const now = new Date();
  const [workflowRun] = await db
    .insert(workflowRuns)
    .values({
      workspaceId: workspace.id,
      workflowType: args.skill.workflowType,
      status: "failed",
      provider: args.provider,
      model: args.model,
      ...workflowSkillFields(args.skill),
      retryCount: args.retryCount,
      errorKind: args.errorKind,
      errorMessage: args.errorMessage,
      startedAt: now,
      finishedAt: now,
    })
    .returning({ id: workflowRuns.id });
  return workflowRun
    ? ({ status: "saved" as const, workflowRunId: workflowRun.id })
    : ({ status: "skipped" as const, reason: "missing_database_url" as const });
}

function isUsefulPositioningEvidence(item: typeof evidenceItems.$inferSelect) {
  if (item.allowedUsage.includes("internal_only")) return false;
  if (item.status === "approved") return true;
  return item.status === "pending" && item.needsUserConfirmation === 0;
}

function toProfilePositioningEvidenceContext(
  item: typeof evidenceItems.$inferSelect,
): ProfilePositioningEvidenceContext {
  return {
    id: item.id,
    text: item.text,
    source_quote: item.sourceQuote,
    evidence_type: item.evidenceType,
    status: item.status,
    allowed_usage: item.allowedUsage,
    needs_user_confirmation: item.needsUserConfirmation === 1,
    metrics: item.metrics,
    sensitivity_level: item.sensitivityLevel,
    public_safe_summary: item.publicSafeSummary,
  };
}

function classifyPositioningQuestion(question: string) {
  const normalized = question.toLowerCase();
  if (/\bmetric|measure|impact|result|lift|revenue|conversion|reduction\b/.test(normalized)) {
    return "metric" as const;
  }
  if (/\bscope|team|scale|users|stakeholder|cross-functional\b/.test(normalized)) {
    return "scope" as const;
  }
  if (/\bown|owner|ownership|led|drive|decision\b/.test(normalized)) {
    return "ownership" as const;
  }
  if (/\btechnical|architecture|system|model|api|data\b/.test(normalized)) {
    return "technical_depth" as const;
  }
  return "impact" as const;
}

function buildEvidenceSnapshotHash(evidenceItems: ProfilePositioningEvidenceContext[]) {
  return crypto
    .createHash("sha256")
    .update(
      JSON.stringify(
        evidenceItems
          .map((item) => ({
            id: item.id,
            text: item.public_safe_summary ?? item.text,
            source_quote: item.source_quote,
          }))
          .sort((left, right) => left.id.localeCompare(right.id)),
      ),
    )
    .digest("hex");
}
