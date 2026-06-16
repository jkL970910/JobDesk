import { eq } from "drizzle-orm";
import { expect } from "vitest";

import { getDb } from "../../src/db/client";
import { workflowRuns } from "../../src/db/schema";

export async function expectWorkflowRunMetadata(
  workflowRunId: string,
  expected: {
    skillId: string;
    promptVersion: string;
    schemaName: string;
    sourceSkillIds: string[];
  },
) {
  const [run] = await getDb()
    .select()
    .from(workflowRuns)
    .where(eq(workflowRuns.id, workflowRunId))
    .limit(1);
  expect(run).toMatchObject({
    skillId: expected.skillId,
    promptVersion: expected.promptVersion,
    schemaName: expected.schemaName,
  });
  expect(run?.skillMetadata).toMatchObject({
    sourceSkillIds: expected.sourceSkillIds,
  });
}
