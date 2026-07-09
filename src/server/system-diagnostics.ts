import { desc, eq } from "drizzle-orm";

import { resolveJobDeskAiConfig } from "../ai/config";
import { skillRegistry } from "../ai/skills-registry";
import { getDb, hasDatabaseUrl } from "../db/client";
import { workflowRuns } from "../db/schema";

type ScopeAccuracyRunSummary = {
  acceptedCount: number;
  rejectedCount: number;
  reviewQueueOnlyCount: number;
  totalCount: number;
  mergedFragmentNoteCount: number;
};

export async function getSystemDiagnostics() {
  const aiConfig = resolveJobDeskAiConfig();
  const dbConfigured = hasDatabaseUrl();
  const base = {
    db: {
      configured: dbConfigured,
      connected: false,
    },
    ai: {
      providerEnabled: aiConfig.providerEnabled,
      apiKeyConfigured: Boolean(aiConfig.apiKey),
      transport: aiConfig.transport,
      model: aiConfig.model,
      endpointHost: safeHost(aiConfig.endpoint),
      responseStorageEnabled: aiConfig.store,
    },
    skills: {
      registryEntries: Object.keys(skillRegistry).length,
      runtimeSkillIds: Object.values(skillRegistry).map((entry) => entry.skillId),
    },
    workflows: {
      latest: [] as Array<{
        id: string;
        workflowType: string;
        status: string;
        skillId: string | null;
        promptVersion: string | null;
        model: string | null;
        finishedAt: string | null;
      }>,
      failedCount: 0,
      lastFinishedAt: null as string | null,
    },
    scopeAccuracy: {
      latestProfileExtractionRuns: [] as Array<{
        id: string;
        finishedAt: string | null;
        acceptedCount: number;
        rejectedCount: number;
        reviewQueueOnlyCount: number;
        totalCount: number;
        mergedFragmentNoteCount: number;
      }>,
      totals: {
        acceptedCount: 0,
        rejectedCount: 0,
        reviewQueueOnlyCount: 0,
        totalCount: 0,
        mergedFragmentNoteCount: 0,
      },
      lastFinishedAt: null as string | null,
    },
  };

  if (!dbConfigured) {
    return base;
  }

  try {
    const db = getDb();
    const latest = await db
      .select({
        id: workflowRuns.id,
        workflowType: workflowRuns.workflowType,
        status: workflowRuns.status,
        skillId: workflowRuns.skillId,
        promptVersion: workflowRuns.promptVersion,
        model: workflowRuns.model,
        finishedAt: workflowRuns.finishedAt,
      })
      .from(workflowRuns)
      .orderBy(desc(workflowRuns.startedAt))
      .limit(6);
    const failedRows = await db
      .select({ id: workflowRuns.id })
      .from(workflowRuns)
      .where(eq(workflowRuns.status, "failed"))
      .limit(1000);
    const scopeRuns = await db
      .select({
        id: workflowRuns.id,
        finishedAt: workflowRuns.finishedAt,
        skillMetadata: workflowRuns.skillMetadata,
      })
      .from(workflowRuns)
      .where(eq(workflowRuns.workflowType, "profile-evidence-extraction"))
      .orderBy(desc(workflowRuns.startedAt))
      .limit(20);
    const scopeAccuracy = summarizeScopeAccuracyRuns(scopeRuns);
    return {
      ...base,
      db: {
        configured: true,
        connected: true,
      },
      workflows: {
        latest: latest.map((run) => ({
          id: run.id,
          workflowType: run.workflowType,
          status: run.status,
          skillId: run.skillId,
          promptVersion: run.promptVersion,
          model: run.model,
          finishedAt: run.finishedAt?.toISOString() ?? null,
        })),
        failedCount: failedRows.length,
        lastFinishedAt: latest[0]?.finishedAt?.toISOString() ?? null,
      },
      scopeAccuracy,
    };
  } catch {
    return base;
  }
}

function summarizeScopeAccuracyRuns(
  runs: Array<{
    id: string;
    finishedAt: Date | null;
    skillMetadata: Record<string, unknown>;
  }>,
) {
  const latestProfileExtractionRuns: Array<ScopeAccuracyRunSummary & {
    id: string;
    finishedAt: string | null;
  }> = runs
    .map((run) => {
      const summary = summarizeScopeAccuracyMetadata(run.skillMetadata);
      if (!summary) return null;
      return {
        id: run.id,
        finishedAt: run.finishedAt?.toISOString() ?? null,
        ...summary,
      };
    })
    .filter((run): run is ScopeAccuracyRunSummary & {
      id: string;
      finishedAt: string | null;
    } => Boolean(run));
  const totals = latestProfileExtractionRuns.reduce(
    (sum, run) => ({
      acceptedCount: sum.acceptedCount + run.acceptedCount,
      rejectedCount: sum.rejectedCount + run.rejectedCount,
      reviewQueueOnlyCount: sum.reviewQueueOnlyCount + run.reviewQueueOnlyCount,
      totalCount: sum.totalCount + run.totalCount,
      mergedFragmentNoteCount: sum.mergedFragmentNoteCount + run.mergedFragmentNoteCount,
    }),
    {
      acceptedCount: 0,
      rejectedCount: 0,
      reviewQueueOnlyCount: 0,
      totalCount: 0,
      mergedFragmentNoteCount: 0,
    },
  );
  return {
    latestProfileExtractionRuns,
    totals,
    lastFinishedAt: latestProfileExtractionRuns[0]?.finishedAt ?? null,
  };
}

function summarizeScopeAccuracyMetadata(metadata: Record<string, unknown>): ScopeAccuracyRunSummary | null {
  const scopeAccuracy = metadata.scopeAccuracy;
  if (!scopeAccuracy || typeof scopeAccuracy !== "object") return null;
  const record = scopeAccuracy as Record<string, unknown>;
  const guardrails = [
    record.workExperienceGuardrail,
    record.initiativeGuardrail,
    record.portfolioProjectGuardrail,
    record.evidenceGuardrail,
  ];
  const mergedFragmentNoteCount = readNumber(
    (record.initiativeConsolidation as Record<string, unknown> | undefined)?.mergedFragmentNoteCount,
  );
  return guardrails.reduce<ScopeAccuracyRunSummary>(
    (sum, item) => {
      const summary = item && typeof item === "object" ? item as Record<string, unknown> : {};
      return {
        acceptedCount: sum.acceptedCount + readNumber(summary.acceptedCount),
        rejectedCount: sum.rejectedCount + readNumber(summary.rejectedCount),
        reviewQueueOnlyCount: sum.reviewQueueOnlyCount + readNumber(summary.reviewQueueOnlyCount),
        totalCount: sum.totalCount + readNumber(summary.totalCount),
        mergedFragmentNoteCount,
      };
    },
    {
      acceptedCount: 0,
      rejectedCount: 0,
      reviewQueueOnlyCount: 0,
      totalCount: 0,
      mergedFragmentNoteCount,
    },
  );
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function safeHost(endpoint: string) {
  try {
    return new URL(endpoint).host;
  } catch {
    return "invalid-endpoint";
  }
}
