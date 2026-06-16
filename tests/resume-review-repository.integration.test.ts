import { beforeAll, describe, expect, it } from "vitest";

import { loadDotEnv } from "../src/ai/env";
import {
  deleteResumeSourceVersion,
  getResumeSourceVersion,
  rerunResumeReview,
} from "../src/server/resume-review-repository";
import { registerUser, runWithAuthContext } from "../src/server/auth-service";
import { getDb } from "../src/db/client";
import { resumeSourceVersions, sourceDocuments } from "../src/db/schema";
import { getCurrentWorkspace } from "../src/server/workspace-repository";

const runIntegration = process.env.JOBDESK_RUN_DB_INTEGRATION === "true";

describe.skipIf(!runIntegration)("resume review repository workspace isolation", () => {
  beforeAll(() => {
    loadDotEnv();
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required for DB integration tests.");
    }
  });

  it("does not expose resume source versions across authenticated workspaces", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const owner = await registerUser({
      email: `resume-owner-${suffix}@example.com`,
      password: "Password123!",
    });
    const other = await registerUser({
      email: `resume-other-${suffix}@example.com`,
      password: "Password123!",
    });
    if (owner.status !== "created" || other.status !== "created") {
      throw new Error("Expected test users to be created.");
    }

    const resumeId = await runWithAuthContext(owner.user.id, () =>
      createResumeSourceFixture(`Isolation Resume ${suffix}.txt`),
    );

    await expect(
      runWithAuthContext(other.user.id, () => getResumeSourceVersion(resumeId)),
    ).resolves.toMatchObject({ status: "not_found" });
    await expect(
      runWithAuthContext(other.user.id, () => rerunResumeReview(resumeId)),
    ).resolves.toMatchObject({ status: "not_found" });
    await expect(
      runWithAuthContext(other.user.id, () => deleteResumeSourceVersion(resumeId)),
    ).resolves.toMatchObject({ status: "not_found" });
    await expect(
      runWithAuthContext(owner.user.id, () => getResumeSourceVersion(resumeId)),
    ).resolves.toMatchObject({
      status: "ready",
      resume: {
        id: resumeId,
      },
    });
  });
});

async function createResumeSourceFixture(title: string) {
  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const contentText = "Jane Doe\nBuilt onboarding analytics dashboards with SQL.";
  const now = new Date();
  const [sourceDocument] = await db
    .insert(sourceDocuments)
    .values({
      workspaceId: workspace.id,
      sourceType: "resume-review",
      title,
      contentText,
      contentHash: `${title}-source`,
      createdAt: now,
    })
    .returning({ id: sourceDocuments.id });
  if (!sourceDocument) throw new Error("Expected source document fixture.");
  const [resume] = await db
    .insert(resumeSourceVersions)
    .values({
      workspaceId: workspace.id,
      sourceDocumentId: sourceDocument.id,
      title,
      contentHash: `${title}-resume`,
      sourceKind: "text",
      sourceText: contentText,
      version: 1,
      status: "uploaded",
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: resumeSourceVersions.id });
  if (!resume) throw new Error("Expected resume source fixture.");
  return resume.id;
}
