import { desc, eq } from "drizzle-orm";

import { resolveJobDeskAiConfig } from "../ai/config";
import { skillRegistry } from "../ai/skills-registry";
import { getDb, hasDatabaseUrl } from "../db/client";
import { workflowRuns } from "../db/schema";

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
    };
  } catch {
    return base;
  }
}

function safeHost(endpoint: string) {
  try {
    return new URL(endpoint).host;
  } catch {
    return "invalid-endpoint";
  }
}
