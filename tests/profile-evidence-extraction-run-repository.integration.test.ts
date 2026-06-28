import { beforeAll, describe, expect, it } from "vitest";

import { loadDotEnv } from "../src/ai/env";
import { getDb } from "../src/db/client";
import {
  profileEvidenceExtractionRuns,
  sourceDocuments,
} from "../src/db/schema";
import { registerUser, runWithAuthContext } from "../src/server/auth-service";
import {
  claimNextProfileEvidenceExtractionRun,
  createProfileEvidenceExtractionRun,
  failProfileEvidenceExtractionRun,
  retryProfileEvidenceExtractionRun,
} from "../src/server/profile-evidence-extraction-run-repository";
import { getCurrentWorkspace } from "../src/server/workspace-repository";
import { eq } from "drizzle-orm";

const runIntegration = process.env.JOBDESK_RUN_DB_INTEGRATION === "true";

describe.skipIf(!runIntegration)("profile evidence extraction run repository integration", () => {
  beforeAll(() => {
    loadDotEnv();
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required for DB integration tests.");
    }
  });

  it("claims once, increments attempt count, and retries the same preserved source snapshot", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const owner = await registerUser({
      email: `profile-extraction-run-${suffix}@example.com`,
      password: "Password123!",
    });
    if (owner.status !== "created") throw new Error("Expected test user.");

    await runWithAuthContext(owner.user.id, async () => {
      const db = getDb();
      const workspace = await getCurrentWorkspace(db);
      const sourceText = "Jane Doe\nExperience\nAmazon\nSoftware Engineer Jan 2022 - Present\nBuilt reliable workflows.";
      const [sourceDocument] = await db
        .insert(sourceDocuments)
        .values({
          contentHash: `different-hash-${suffix}`,
          contentText: sourceText,
          createdAt: new Date(),
          sourceType: "profile_evidence",
          title: `Extraction Run ${suffix}`,
          workspaceId: workspace.id,
        })
        .returning({ id: sourceDocuments.id });
      if (!sourceDocument) throw new Error("Expected source document.");

      const created = await createProfileEvidenceExtractionRun({
        sourceDocumentId: sourceDocument.id,
        sourceText,
        sourceTitle: `Extraction Run ${suffix}`,
      });
      if (created.status !== "created") throw new Error("Expected extraction run.");

      const firstClaim = await claimNextProfileEvidenceExtractionRun("worker-a");
      expect(firstClaim).toMatchObject({ status: "claimed" });
      if (firstClaim.status !== "claimed") throw new Error("Expected claimed run.");
      expect(firstClaim.run.id).toBe(created.run.id);
      expect(firstClaim.run.attemptCount).toBe(1);

      await expect(claimNextProfileEvidenceExtractionRun("worker-b")).resolves.toMatchObject({
        status: "empty",
      });

      await failProfileEvidenceExtractionRun({
        canRetry: true,
        failureKind: "provider_timeout",
        failureMessage: "AI extraction timed out.",
        retryAfterSeconds: 10,
        runId: created.run.id,
        workerId: "worker-a",
      });
      const retry = await retryProfileEvidenceExtractionRun(created.run.id);
      expect(retry).toMatchObject({ status: "queued" });

      const secondClaim = await claimNextProfileEvidenceExtractionRun("worker-b");
      expect(secondClaim).toMatchObject({ status: "claimed" });
      if (secondClaim.status !== "claimed") throw new Error("Expected retried claim.");
      expect(secondClaim.run.id).toBe(created.run.id);
      expect(secondClaim.run.attemptCount).toBe(2);

      const [stored] = await db
        .select({
          sourceSnapshotHash: profileEvidenceExtractionRuns.sourceSnapshotHash,
          sourceTextSnapshot: profileEvidenceExtractionRuns.sourceTextSnapshot,
        })
        .from(profileEvidenceExtractionRuns)
        .where(eq(profileEvidenceExtractionRuns.id, created.run.id))
        .limit(1);
      expect(stored?.sourceTextSnapshot).toBe(sourceText);
      expect(stored?.sourceSnapshotHash).toEqual(expect.any(String));
      expect(stored?.sourceSnapshotHash).toHaveLength(64);
    });
  });

  it("reclaims stale pre-save processing runs without reclaiming saving runs", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const owner = await registerUser({
      email: `profile-extraction-stale-${suffix}@example.com`,
      password: "Password123!",
    });
    if (owner.status !== "created") throw new Error("Expected test user.");

    await runWithAuthContext(owner.user.id, async () => {
      const db = getDb();
      const staleExtracting = await createRunFixture(`Stale extracting ${suffix}`);
      if (staleExtracting.status !== "created") throw new Error("Expected stale extracting run.");
      const staleSaving = await createRunFixture(`Stale saving ${suffix}`);
      if (staleSaving.status !== "created") throw new Error("Expected stale saving run.");
      const staleLock = new Date(Date.now() - 20 * 60_000);

      await db
        .update(profileEvidenceExtractionRuns)
        .set({
          lockedAt: staleLock,
          lockedBy: "dead-worker",
          status: "extracting_evidence",
          updatedAt: staleLock,
        })
        .where(eq(profileEvidenceExtractionRuns.id, staleExtracting.run.id));
      await db
        .update(profileEvidenceExtractionRuns)
        .set({
          lockedAt: staleLock,
          lockedBy: "dead-saving-worker",
          status: "saving",
          updatedAt: staleLock,
        })
        .where(eq(profileEvidenceExtractionRuns.id, staleSaving.run.id));

      const claimed = await claimNextProfileEvidenceExtractionRun("recovery-worker");
      expect(claimed).toMatchObject({
        run: {
          attemptCount: 1,
          id: staleExtracting.run.id,
          status: "parsing",
        },
        status: "claimed",
      });

      const stillSaving = await db
        .select({ status: profileEvidenceExtractionRuns.status, lockedBy: profileEvidenceExtractionRuns.lockedBy })
        .from(profileEvidenceExtractionRuns)
        .where(eq(profileEvidenceExtractionRuns.id, staleSaving.run.id))
        .limit(1);
      expect(stillSaving[0]).toMatchObject({
        lockedBy: "dead-saving-worker",
        status: "saving",
      });
    });
  });
});

async function createRunFixture(title: string) {
  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const sourceText = `Jane Doe\nExperience\n${title}\nSoftware Engineer Jan 2022 - Present\nBuilt reliable workflows.`;
  const now = new Date();
  const [sourceDocument] = await db
    .insert(sourceDocuments)
    .values({
      contentHash: `source-${title}`,
      contentText: sourceText,
      createdAt: now,
      sourceType: "profile_evidence",
      title,
      workspaceId: workspace.id,
    })
    .returning({ id: sourceDocuments.id });
  if (!sourceDocument) throw new Error("Expected source document.");
  return createProfileEvidenceExtractionRun({
    sourceDocumentId: sourceDocument.id,
    sourceText,
    sourceTitle: title,
  });
}
