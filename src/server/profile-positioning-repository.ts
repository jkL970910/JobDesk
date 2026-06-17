import crypto from "node:crypto";

import { desc, eq } from "drizzle-orm";

import { skillRegistry } from "../ai/skills-registry";
import type {
  JobDeskAiFailureKind,
  JobDeskAiSkillBinding,
  JobDeskAiUsage,
} from "../ai/types";
import { getDb, hasDatabaseUrl } from "../db/client";
import { profilePositioningReports, workflowRuns } from "../db/schema";
import type { ProfilePositioningReport } from "../schemas/profile-positioning";
import type { TailoredResumeEvidenceContext } from "../ai/tailored-resume";
import { getResumeTailoringContext } from "./profile-evidence-repository";
import { workflowSkillFields } from "./workflow-run-metadata";
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
  const context = await getResumeTailoringContext(null);
  return {
    profile: context.profile,
    evidenceItems: context.evidenceItems,
    evidenceSnapshotHash: buildEvidenceSnapshotHash(context.evidenceItems),
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

function buildEvidenceSnapshotHash(evidenceItems: TailoredResumeEvidenceContext[]) {
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
