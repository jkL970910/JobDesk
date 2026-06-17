import { beforeAll, describe, expect, it } from "vitest";

import { loadDotEnv } from "../src/ai/env";
import {
  archiveJdAnalysis,
  getJdAnalysisById,
  getRecentJdAnalyses,
  JobRepositoryError,
  persistJdAnalysis,
  updateApplicationStatus,
} from "../src/server/job-repository";
import { GET as getJob, PATCH as patchJob } from "../app/api/jobs/[jobId]/route";
import type { JDAnalysis } from "../src/schemas/jd-analysis";
import { skillRegistry } from "../src/ai/skills-registry";
import { expectWorkflowRunMetadata } from "./helpers/workflow-run-assertions";
import { registerUser, runWithAuthContext } from "../src/server/auth-service";

const runIntegration = process.env.JOBDESK_RUN_DB_INTEGRATION === "true";

describe.skipIf(!runIntegration)("job repository database integration", () => {
  beforeAll(() => {
    loadDotEnv();
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required for DB integration tests.");
    }
  });

  it("persists, reloads, reanalyzes, and archives a job", async () => {
    const first = buildAnalysis("Integration QA Engineer", ["PostgreSQL"], {
      company: "Integration Co",
      level: "Senior",
      location: "Toronto",
      responsibilities: ["Maintain JobDesk integration coverage."],
      preferred_qualifications: ["Experience with QA automation."],
    });
    const firstResult = await persistJdAnalysis({
      analysis: first,
      provider: "integration-test",
      model: "test-model",
      usage: { totalTokens: 10 },
      retryCount: 0,
      skill: skillRegistry.jdAnalysis,
    });
    expect(firstResult.status).toBe("saved");
    if (firstResult.status !== "saved" || !firstResult.jobId) {
      throw new Error("Expected saved job.");
    }
    await expectWorkflowRunMetadata(firstResult.workflowRunId, {
      skillId: "jd-analysis",
      promptVersion: "jd-analysis-v1",
      schemaName: "JDAnalysis",
      sourceSkillIds: ["jd-analysis"],
    });

    const loaded = await getJdAnalysisById(firstResult.jobId);
    expect(loaded?.title).toBe("Integration QA Engineer");
    expect(loaded?.requirementCount).toBe(1);
    expect(loaded?.job_facts).toMatchObject({
      company: "Integration Co",
      role_title: "Integration QA Engineer",
      level: "Senior",
      location: "Toronto",
      responsibilities: ["Maintain JobDesk integration coverage."],
      preferred_qualifications: ["Experience with QA automation."],
    });

    const second = buildAnalysis(
      "Integration Platform Engineer",
      ["TypeScript", "structured outputs"],
      {
        company: "Updated Integration Co",
        level: "Staff",
        location: "Remote Canada",
        responsibilities: ["Own structured-output workflow reliability."],
        preferred_qualifications: ["Experience with OpenRouter-compatible APIs."],
      },
    );
    const secondResult = await persistJdAnalysis({
      analysis: second,
      targetJobId: firstResult.jobId,
      provider: "integration-test",
      model: "test-model",
      usage: { totalTokens: 20 },
      retryCount: 1,
      skill: skillRegistry.jdAnalysis,
    });
    expect(secondResult).toMatchObject({
      status: "saved",
      jobId: firstResult.jobId,
    });
    if (secondResult.status !== "saved") {
      throw new Error("Expected saved reanalysis.");
    }
    await expectWorkflowRunMetadata(secondResult.workflowRunId, {
      skillId: "jd-analysis",
      promptVersion: "jd-analysis-v1",
      schemaName: "JDAnalysis",
      sourceSkillIds: ["jd-analysis"],
    });

    const reloaded = await getJdAnalysisById(firstResult.jobId);
    expect(reloaded?.requirementCount).toBe(2);
    expect(reloaded?.title).toBe("Integration Platform Engineer");
    expect(reloaded?.job_facts).toMatchObject({
      company: "Updated Integration Co",
      role_title: "Integration Platform Engineer",
      level: "Staff",
      location: "Remote Canada",
      responsibilities: ["Own structured-output workflow reliability."],
      preferred_qualifications: ["Experience with OpenRouter-compatible APIs."],
    });
    expect(reloaded?.requirements.map((requirement) => requirement.text)).toEqual([
      "TypeScript",
      "structured outputs",
    ]);

    const statusResult = await updateApplicationStatus(firstResult.jobId, "applied");
    expect(statusResult).toMatchObject({
      status: "updated",
      jobId: firstResult.jobId,
      applicationStatus: "applied",
    });
    const statusReloaded = await getJdAnalysisById(firstResult.jobId);
    expect(statusReloaded?.application_status).toBe("applied");

    const recent = await getRecentJdAnalyses(20);
    expect(recent.some((job) => job.id === firstResult.jobId)).toBe(true);

    const detailResponse = await getJob(new Request("http://localhost/api/jobs"), {
      params: Promise.resolve({ jobId: firstResult.jobId }),
    });
    expect(detailResponse.status).toBe(200);
    const detailPayload = (await detailResponse.json()) as {
      data?: {
        id: string;
        requirementCount: number;
        job_facts: JDAnalysis["job_facts"];
      };
    };
    expect(detailPayload.data).toMatchObject({
      id: firstResult.jobId,
      requirementCount: 2,
      job_facts: {
        company: "Updated Integration Co",
        role_title: "Integration Platform Engineer",
        level: "Staff",
        location: "Remote Canada",
      },
    });

    const archiveResponse = await patchJob(
      new Request("http://localhost/api/jobs", {
        method: "PATCH",
        body: JSON.stringify({ action: "archive" }),
      }),
      { params: Promise.resolve({ jobId: firstResult.jobId }) },
    );
    expect(archiveResponse.status).toBe(200);
    expect(await getJdAnalysisById(firstResult.jobId)).toBeNull();

    const recentAfterArchive = await getRecentJdAnalyses(20);
    expect(recentAfterArchive.some((job) => job.id === firstResult.jobId)).toBe(
      false,
    );
  });

  it("rejects reanalysis for archived or missing jobs", async () => {
    const result = await persistJdAnalysis({
      analysis: buildAnalysis("Integration Archive Target", ["SQL"]),
      provider: "integration-test",
      model: "test-model",
      usage: {},
      retryCount: 0,
      skill: skillRegistry.jdAnalysis,
    });
    if (result.status !== "saved" || !result.jobId) {
      throw new Error("Expected saved job.");
    }
    await expectWorkflowRunMetadata(result.workflowRunId, {
      skillId: "jd-analysis",
      promptVersion: "jd-analysis-v1",
      schemaName: "JDAnalysis",
      sourceSkillIds: ["jd-analysis"],
    });
    await archiveJdAnalysis(result.jobId);

    await expect(
      persistJdAnalysis({
        analysis: buildAnalysis("Integration Archive Target", ["React"]),
        targetJobId: result.jobId,
        provider: "integration-test",
        model: "test-model",
        usage: {},
        retryCount: 0,
        skill: skillRegistry.jdAnalysis,
      }),
    ).rejects.toMatchObject({ kind: "job_not_found" });
  });

  it("isolates raw job ids by authenticated workspace", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const owner = await registerUser({
      email: `job-owner-${suffix}@example.com`,
      password: "Password123!",
    });
    const other = await registerUser({
      email: `job-other-${suffix}@example.com`,
      password: "Password123!",
    });
    if (owner.status !== "created" || other.status !== "created") {
      throw new Error("Expected test users to be created.");
    }

    const saved = await runWithAuthContext(owner.user.id, () =>
      persistJdAnalysis({
        analysis: buildAnalysis("Workspace Scoped Role", ["ownership guard"]),
        provider: "integration-test",
        model: "test-model",
        usage: {},
        retryCount: 0,
        skill: skillRegistry.jdAnalysis,
      }),
    );
    if (saved.status !== "saved" || !saved.jobId) {
      throw new Error("Expected owner job to save.");
    }
    const ownerJobId = saved.jobId;

    await expect(
      runWithAuthContext(other.user.id, () => getJdAnalysisById(ownerJobId)),
    ).resolves.toBeNull();
    await expect(
      runWithAuthContext(other.user.id, () => updateApplicationStatus(ownerJobId, "applied")),
    ).resolves.toMatchObject({ status: "not_found" });
    await expect(
      runWithAuthContext(other.user.id, () => archiveJdAnalysis(ownerJobId)),
    ).resolves.toMatchObject({ status: "not_found" });
    await expect(
      runWithAuthContext(owner.user.id, () => getJdAnalysisById(ownerJobId)),
    ).resolves.toMatchObject({ id: ownerJobId });
  });

  it("claims the existing unowned workspace for the first registered account", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const legacyJob = await runWithAuthContext(null, () =>
      persistJdAnalysis({
        analysis: buildAnalysis(`Legacy Workspace Role ${suffix}`, ["workspace claim"]),
        provider: "integration-test",
        model: "test-model",
        usage: {},
        retryCount: 0,
        skill: skillRegistry.jdAnalysis,
      }),
    );
    if (legacyJob.status !== "saved" || !legacyJob.jobId) {
      throw new Error("Expected legacy unowned job to save.");
    }

    const owner = await registerUser({
      email: `claim-owner-${suffix}@example.com`,
      password: "Password123!",
    });
    if (owner.status !== "created") {
      throw new Error("Expected owner user to be created.");
    }

    await expect(
      runWithAuthContext(owner.user.id, () => getJdAnalysisById(legacyJob.jobId!)),
    ).resolves.toMatchObject({ id: legacyJob.jobId });
  });
});

function buildAnalysis(
  title: string,
  requirements: string[],
  facts: Partial<JDAnalysis["job_facts"]> = {},
): JDAnalysis {
  const lines = [
    title,
    ...requirements.map((requirement) => `Requires ${requirement}.`),
  ];
  return {
    job_id: `integration-${Date.now()}`,
    original_jd_text: lines.join("\n"),
    job_facts: {
      company: facts.company ?? "Integration Co",
      role_title: title,
      level: facts.level ?? null,
      location: facts.location ?? "Remote",
      responsibilities:
        facts.responsibilities ?? ["Maintain JobDesk integration coverage."],
      preferred_qualifications:
        facts.preferred_qualifications ?? ["Experience with structured outputs."],
    },
    role_archetype: "technical_ai_pm",
    job_legitimacy: {
      tier: "proceed_with_caution",
      signals: [],
      context_notes: [],
    },
    requirements: requirements.map((requirement, index) => ({
      text: requirement,
      source_quote: `Requires ${requirement}.`,
      requirement_type: index === 0 ? "hard" : "soft",
      importance: index === 0 ? 0.9 : 0.6,
      keywords: [requirement.toLowerCase()],
      verified: false,
    })),
    role_signals: ["integration-test"],
    keywords: requirements.map((requirement) => requirement.toLowerCase()),
    interview_implications: ["Discuss relevant project evidence."],
  };
}
