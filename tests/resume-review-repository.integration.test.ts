import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";

import { JobDeskAiError } from "../src/ai/errors";
import { loadDotEnv } from "../src/ai/env";
import {
  deleteResumeSourceVersion,
  getResumeReviewRun,
  getResumeSourceVersion,
  getResumeReviewWorkspace,
  processResumeReviewRun,
  rerunResumeReview,
  setResumeReviewStepAiAdapterForTest,
  startResumeReviewRun,
} from "../src/server/resume-review-repository";
import { registerUser, runWithAuthContext } from "../src/server/auth-service";
import { getDb } from "../src/db/client";
import {
  resumeReviewReports,
  resumeReviewRunSteps,
  resumeSourceVersions,
  sourceDocuments,
  workflowRuns,
} from "../src/db/schema";
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
    restoreAiAdapter = setResumeReviewStepAiAdapterForTest({
      assessSection: async () => {
        throw new JobDeskAiError("OpenRouter request timed out.", { kind: "timeout" });
      },
    });

    const result = await runWithAuthContext(owner.user.id, async () => {
      const resumeId = await createResumeSourceFixture(`Provider Fail Resume ${suffix}.txt`);
      const started = await startResumeReviewRun(resumeId);
      if (started.status !== "created") throw new Error("Expected review run.");
      await processResumeReviewRun(started.run.id);
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

  it("does not publish a report while a review run still has pending steps", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const owner = await registerUser({
      email: `resume-double-process-${suffix}@example.com`,
      password: "Password123!",
    });
    if (owner.status !== "created") throw new Error("Expected owner user.");
    restoreAiAdapter = setResumeReviewStepAiAdapterForTest(buildStepAdapter());
    const result = await runWithAuthContext(owner.user.id, async () => {
      const resumeId = await createResumeSourceFixture(`Double Process Resume ${suffix}.txt`);
      const started = await startResumeReviewRun(resumeId);
      if (started.status !== "created") throw new Error("Expected review run.");
      const processed = await processResumeReviewRun(started.run.id);
      const second = await processResumeReviewRun(started.run.id);
      const db = getDb();
      const reports = await db
        .select()
        .from(resumeReviewReports)
        .where(eq(resumeReviewReports.resumeSourceVersionId, resumeId));
      const steps = await db
        .select()
        .from(resumeReviewRunSteps)
        .where(eq(resumeReviewRunSteps.workflowRunId, started.run.id));
      return { processed, reports, second, steps };
    });

    expect(result.processed).toMatchObject({
      hasMoreWork: true,
      status: "ready",
    });
    expect(result.second).toMatchObject({
      hasMoreWork: true,
      status: "ready",
    });
    expect(result.reports).toHaveLength(0);
    expect(result.steps.filter((step) => step.stepKind === "segment_source")).toHaveLength(1);
  });

  it("expires stale pre-save review runs so polling and retry can recover", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const owner = await registerUser({
      email: `resume-stale-run-${suffix}@example.com`,
      password: "Password123!",
    });
    if (owner.status !== "created") throw new Error("Expected owner user.");

    const result = await runWithAuthContext(owner.user.id, async () => {
      const resumeId = await createResumeSourceFixture(`Stale Run Resume ${suffix}.txt`);
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
          startedAt: new Date(Date.now() - 16 * 60 * 1000),
        })
        .where(and(eq(workflowRuns.id, started.run.id), eq(workflowRuns.workflowType, skillRegistry.resumeReviewGeneral.workflowType)));

      const polled = await getResumeReviewRun(started.run.id);
      const restarted = await startResumeReviewRun(resumeId);
      const workspace = await getResumeReviewWorkspace(5);
      return { polled, restarted, workspace };
    });

    expect(result.polled).toMatchObject({
      run: {
        errorKind: "timeout",
        stage: "failed",
        status: "failed",
      },
      status: "ready",
    });
    expect(result.restarted).toMatchObject({
      run: {
        stage: "queued",
        status: "running",
      },
      status: "created",
    });
    expect(result.restarted.status === "created" ? result.restarted.run.id : null).not.toBe(
      result.polled.status === "ready" ? result.polled.run.id : null,
    );
    expect(result.workspace.status).toBe("ready");
    if (result.workspace.status === "ready") {
      const staleResume = result.workspace.resumes.find(
        (resume) => resume.id === (result.restarted.status === "created" ? result.restarted.resume.id : ""),
      );
      expect(staleResume?.activeReviewRun?.id).toBe(
        result.restarted.status === "created" ? result.restarted.run.id : undefined,
      );
    }
  });

  it("retries the failed review step without duplicating completed steps", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const owner = await registerUser({
      email: `resume-step-retry-${suffix}@example.com`,
      password: "Password123!",
    });
    if (owner.status !== "created") throw new Error("Expected owner user.");
    let calls = 0;
    restoreAiAdapter = setResumeReviewStepAiAdapterForTest({
      ...buildStepAdapter(),
      assessSection: async () => {
        calls += 1;
        if (calls === 1) {
          throw new JobDeskAiError("OpenRouter request timed out.", {
            diagnostics: {
              failurePhase: "fetch",
              inputChars: 240,
              maxOutputTokens: 620,
              receivedResponse: false,
              task: "general-resume-review-section-assessment",
              timeoutMs: 55_000,
            },
            kind: "timeout",
          });
        }
        return buildSectionAssessmentResult();
      },
    });

    const result = await runWithAuthContext(owner.user.id, async () => {
      const resumeId = await createResumeSourceFixture(`Step Retry Resume ${suffix}.txt`);
      const started = await startResumeReviewRun(resumeId);
      if (started.status !== "created") throw new Error("Expected review run.");
      await processResumeReviewRun(started.run.id);
      const first = await processResumeReviewRun(started.run.id);
      const retryStarted = await startResumeReviewRun(resumeId);
      const second = await processResumeReviewRun(started.run.id);
      const db = getDb();
      const steps = await db
        .select()
        .from(resumeReviewRunSteps)
        .where(eq(resumeReviewRunSteps.workflowRunId, started.run.id));
      const reports = await db
        .select()
        .from(resumeReviewReports)
        .where(eq(resumeReviewReports.resumeSourceVersionId, resumeId));
      return { first, reports, retryStarted, second, steps };
    });

    expect(result.first).toMatchObject({
      run: {
        errorKind: "timeout",
        stage: "failed",
        status: "failed",
      },
      status: "failed",
    });
    expect(result.retryStarted).toMatchObject({
      run: {
        stage: "scanning",
        status: "running",
      },
      status: "created",
    });
    if (result.first.status === "failed" && result.retryStarted.status === "created") {
      expect(new Date(result.retryStarted.run.startedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(result.first.run.finishedAt ?? result.first.run.startedAt).getTime(),
      );
    }
    expect(result.second.status).toBe("ready");
    expect(result.steps.filter((step) => step.stepKind === "segment_source")).toHaveLength(1);
    const retriedStep = result.steps.find((step) => step.stepKind === "assess_section");
    expect(retriedStep).toMatchObject({
      attemptCount: 2,
      failureKind: null,
      status: "completed",
    });
    expect(result.reports).toHaveLength(0);
  });

  it("does not claim save report while synthesis prerequisites are failed or pending", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const owner = await registerUser({
      email: `resume-synthesis-barrier-${suffix}@example.com`,
      password: "Password123!",
    });
    if (owner.status !== "created") throw new Error("Expected owner user.");
    let rubricCalls = 0;
    restoreAiAdapter = setResumeReviewStepAiAdapterForTest({
      ...buildStepAdapter(),
      synthesizeRubric: async () => {
        rubricCalls += 1;
        if (rubricCalls === 1) {
          throw new JobDeskAiError("OpenRouter request timed out.", {
            diagnostics: {
              failurePhase: "fetch",
              inputChars: 17_778,
              maxOutputTokens: 1500,
              receivedResponse: false,
              task: "general-resume-review-rubric",
              timeoutMs: 120_000,
            },
            kind: "timeout",
          });
        }
        return buildStepAdapter().synthesizeRubric();
      },
    });

    const result = await runWithAuthContext(owner.user.id, async () => {
      const resumeId = await createResumeSourceFixture(`Synthesis Barrier Resume ${suffix}.txt`);
      const started = await startResumeReviewRun(resumeId);
      if (started.status !== "created") throw new Error("Expected review run.");
      let latest: Awaited<ReturnType<typeof processResumeReviewRun>> | null = null;
      for (let index = 0; index < 12; index += 1) {
        latest = await processResumeReviewRun(started.run.id);
        if (latest.status === "failed") break;
      }
      const retryStarted = await startResumeReviewRun(resumeId);
      const afterRetry = await processResumeReviewRun(started.run.id);
      const db = getDb();
      const steps = await db
        .select()
        .from(resumeReviewRunSteps)
        .where(eq(resumeReviewRunSteps.workflowRunId, started.run.id));
      const reports = await db
        .select()
        .from(resumeReviewReports)
        .where(eq(resumeReviewReports.resumeSourceVersionId, resumeId));
      return { afterRetry, latest, reports, retryStarted, steps };
    });

    expect(result.latest).toMatchObject({
      run: {
        errorKind: "timeout",
        stage: "failed",
        status: "failed",
      },
      status: "failed",
    });
    const failedRubric = result.steps.find((step) => step.stepKind === "synthesize_rubric");
    expect(failedRubric).toMatchObject({
      attemptCount: 2,
      status: "completed",
    });
    expect(result.retryStarted).toMatchObject({
      run: {
        stage: "scoring",
        status: "running",
      },
      status: "created",
    });
    expect(result.afterRetry).toMatchObject({
      hasMoreWork: true,
      status: "ready",
    });
    const saveStep = result.steps.find((step) => step.stepKind === "save_report");
    expect(saveStep).toMatchObject({
      attemptCount: 0,
      failureKind: null,
      status: "pending",
    });
    expect(result.reports).toHaveLength(0);
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

function buildStepAdapter() {
  return {
    assessSection: async () => buildSectionAssessmentResult(),
    synthesizeEvidence: async () => ({
      data: {
        fairness_check: {
          applied: true,
          note: "No protected or proxy signals were penalized.",
          signals_not_penalized: [],
        },
        missing_evidence_questions: ["Which metric proves the dashboard impact?"],
        risk_flags: [],
      },
      outputText: "{}",
      retryCount: 0,
      skill: skillRegistry.resumeReviewGeneral,
      usage: {},
    }),
    synthesizeRubric: async () => ({
      data: {
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
        suggested_edits: ["Add one measurable outcome."],
      },
      outputText: "{}",
      retryCount: 0,
      skill: skillRegistry.resumeReviewGeneral,
      usage: {},
    }),
    synthesizeScan: async () => ({
      data: {
        ats_notes: ["Readable section structure."],
        strengths: ["Technical project work is visible."],
        ten_second_scan: "Reviewer sees dashboard work but not impact scale.",
        weaknesses: ["Impact scale is not yet clear."],
      },
      outputText: "{}",
      retryCount: 0,
      skill: skillRegistry.resumeReviewGeneral,
      usage: {},
    }),
  };
}

function buildSectionAssessmentResult() {
  return {
    data: {
      ats_notes: [],
      confidence: 0.8,
      dimension_signals: [
        {
          dimension: "impact_evidence",
          helped: ["Concrete dashboard work is visible."],
          lowered: ["Impact metric is not explicit."],
          raise_score: ["Add scope and impact metric."],
        },
      ],
      evidence_questions: ["Which metric proves the dashboard impact?"],
      risk_flags: [],
      strengths: ["Technical project work is visible."],
      weaknesses: ["Impact scale is not yet clear."],
    },
    outputText: "{}",
    retryCount: 0,
    skill: skillRegistry.resumeReviewGeneral,
    usage: {},
  };
}
