import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";

import { JobDeskAiError } from "../src/ai/errors";
import { loadDotEnv } from "../src/ai/env";
import {
  deleteResumeSourceVersion,
  getResumeSourceVersion,
  processResumeReviewRun,
  rerunResumeReview,
  setResumeReviewAiAdapterForTest,
  startResumeReviewRun,
} from "../src/server/resume-review-repository";
import { registerUser, runWithAuthContext } from "../src/server/auth-service";
import { getDb } from "../src/db/client";
import { resumeReviewReports, resumeSourceVersions, sourceDocuments, workflowRuns } from "../src/db/schema";
import { getCurrentWorkspace } from "../src/server/workspace-repository";
import { skillRegistry } from "../src/ai/skills-registry";

const runIntegration = process.env.JOBDESK_RUN_DB_INTEGRATION === "true";

describe.skipIf(!runIntegration)("resume review repository workspace isolation", () => {
  let restoreAiAdapter: (() => void) | null = null;

  beforeAll(() => {
    loadDotEnv();
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required for DB integration tests.");
    }
  });

  afterEach(() => {
    restoreAiAdapter?.();
    restoreAiAdapter = null;
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

  it("does not publish a ready report when provider review fails", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const owner = await registerUser({
      email: `resume-provider-fail-${suffix}@example.com`,
      password: "Password123!",
    });
    if (owner.status !== "created") throw new Error("Expected owner user.");
    restoreAiAdapter = setResumeReviewAiAdapterForTest(async () => {
      throw new JobDeskAiError("OpenRouter request timed out.", { kind: "timeout" });
    });

    const result = await runWithAuthContext(owner.user.id, async () => {
      const resumeId = await createResumeSourceFixture(`Provider Fail Resume ${suffix}.txt`);
      const started = await startResumeReviewRun(resumeId);
      if (started.status !== "created") throw new Error("Expected review run.");
      const processed = await processResumeReviewRun(started.run.id);
      const db = getDb();
      const [resume] = await db
        .select()
        .from(resumeSourceVersions)
        .where(eq(resumeSourceVersions.id, resumeId))
        .limit(1);
      const reports = await db
        .select()
        .from(resumeReviewReports)
        .where(eq(resumeReviewReports.resumeSourceVersionId, resumeId));
      return { processed, reports, resume };
    });

    expect(result.processed).toMatchObject({
      run: {
        errorKind: "timeout",
        stage: "failed",
        status: "failed",
      },
      status: "failed",
    });
    expect(result.reports).toHaveLength(0);
    expect(result.resume).toMatchObject({
      lastReviewedAt: null,
      status: "uploaded",
    });
  });

  it("does not process the same review run twice after it is claimed", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const owner = await registerUser({
      email: `resume-double-process-${suffix}@example.com`,
      password: "Password123!",
    });
    if (owner.status !== "created") throw new Error("Expected owner user.");
    let calls = 0;
    restoreAiAdapter = setResumeReviewAiAdapterForTest(async () => {
      calls += 1;
      return buildAiReviewResult();
    });

    const result = await runWithAuthContext(owner.user.id, async () => {
      const resumeId = await createResumeSourceFixture(`Double Process Resume ${suffix}.txt`);
      const started = await startResumeReviewRun(resumeId);
      if (started.status !== "created") throw new Error("Expected review run.");
      const db = getDb();
      await db
        .update(workflowRuns)
        .set({
          skillMetadata: {
            resumeSourceVersionId: resumeId,
            stage: "scanning",
            trigger: "user_retry",
          },
        })
        .where(and(eq(workflowRuns.id, started.run.id), eq(workflowRuns.workflowType, skillRegistry.resumeReviewGeneral.workflowType)));

      const skipped = await processResumeReviewRun(started.run.id);
      await db
        .update(workflowRuns)
        .set({
          skillMetadata: {
            resumeSourceVersionId: resumeId,
            stage: "queued",
            trigger: "user_retry",
          },
        })
        .where(and(eq(workflowRuns.id, started.run.id), eq(workflowRuns.workflowType, skillRegistry.resumeReviewGeneral.workflowType)));
      const processed = await processResumeReviewRun(started.run.id);
      const second = await processResumeReviewRun(started.run.id);
      const reports = await db
        .select()
        .from(resumeReviewReports)
        .where(eq(resumeReviewReports.resumeSourceVersionId, resumeId));
      return { processed, reports, second, skipped };
    });

    expect(result.skipped).toMatchObject({
      run: {
        stage: "scanning",
        status: "running",
      },
      status: "ready",
    });
    expect(result.processed.status).toBe("saved");
    expect(result.second).toMatchObject({
      run: {
        stage: "completed",
        status: "succeeded",
      },
      status: "ready",
    });
    expect(calls).toBe(1);
    expect(result.reports).toHaveLength(1);
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

function buildAiReviewResult() {
  return {
    data: {
      ats_notes: ["Readable section structure."],
      fairness_check: {
        applied: true,
        note: "No protected or proxy signals were penalized.",
        signals_not_penalized: [],
      },
      missing_evidence_questions: ["Which metric proves the dashboard impact?"],
      risk_flags: [],
      rubric: [
        {
          evidenceQuestions: ["Which metric proves the dashboard impact?"],
          findings: ["Concrete dashboard work is visible."],
          helpedScore: ["Specific technical work is present."],
          key: "impact_evidence",
          label: "Impact evidence",
          loweredScore: ["Impact metric is not explicit."],
          maxScore: 100,
          nextAction: "Add one measurable outcome.",
          note: "Evidence is present but not fully quantified.",
          raiseScore: ["Add scope and impact metric."],
          score: 76,
        },
      ],
      score: {
        confidence: 0.8,
        overall: 76,
        scope_note: "General resume review without a target JD.",
      },
      strengths: ["Technical project work is visible."],
      suggested_edits: ["Add one measurable outcome."],
      ten_second_scan: "Reviewer sees dashboard work but not impact scale.",
      weaknesses: ["Impact scale is not yet clear."],
    },
    outputText: "{}",
    retryCount: 0,
    skill: skillRegistry.resumeReviewGeneral,
    stageCount: 4,
    usage: {},
  };
}
