import { describe, expect, it } from "vitest";

import { JobDeskAiError } from "../src/ai/errors";
import { skillRegistry } from "../src/ai/skills-registry";
import type {
  ProfileEvidenceExtractionWorkerDependencies,
} from "../src/server/profile-evidence-extraction-worker";
import {
  runProfileEvidenceExtractionWorkerForRun,
  runProfileEvidenceExtractionWorkerOnce,
} from "../src/server/profile-evidence-extraction-worker";
import { profileEvidenceExtractionRunStaleClaimableStatuses } from "../src/server/profile-evidence-extraction-run-repository";
import type { ProfileEvidenceExtraction } from "../src/schemas/profile-evidence-extraction";

describe("profile evidence extraction worker orchestration", () => {
  it("initializes extraction state without writing canonical library data", async () => {
    const { calls, dependencies } = buildWorkerFixture();

    const result = await runProfileEvidenceExtractionWorkerOnce("worker-test", dependencies);

    expect(result).toMatchObject({ hasMoreWork: true, status: "processing" });
    expect(calls.claimedWorkerIds).toEqual(["worker-test"]);
    expect(calls.authUserIds).toEqual(["user-test"]);
    expect(calls.statuses).toEqual([
      "segmenting",
      "extracting_profile",
    ]);
    expect(calls.progressRuns).toHaveLength(1);
    expect(calls.persistedExtractions).toHaveLength(0);
    expect(calls.completedRuns).toHaveLength(0);
    expect(calls.failedRuns).toHaveLength(0);
    expect(calls.markedResumeSources).toHaveLength(0);
    expect(calls.embeddingReasons).toHaveLength(0);
  });

  it("saves canonical library data only after all persisted segments complete", async () => {
    const { calls, dependencies } = buildWorkerFixture({
      claimNextRun: async (workerId) => {
        calls.claimedWorkerIds.push(workerId);
        return { status: "claimed" as const, run: buildRunPayload({ result: buildCompletedStepRunnerResult() }) };
      },
    });

    const result = await runProfileEvidenceExtractionWorkerOnce("worker-test", dependencies);

    expect(result).toMatchObject({ status: "completed" });
    expect(calls.statuses).toEqual(["validating", "saving"]);
    expect(calls.persistedExtractions).toHaveLength(1);
    expect(calls.completedRuns).toHaveLength(1);
    expect(calls.markedResumeSources).toEqual(["resume-source-test"]);
    expect(calls.embeddingReasons).toEqual(["profile_evidence_extract_run"]);
  });

  it("does not write canonical library data when a persisted segment fails before final validation", async () => {
    const { calls, dependencies } = buildWorkerFixture({
      claimNextRun: async (workerId) => {
        calls.claimedWorkerIds.push(workerId);
        return { status: "claimed" as const, run: buildRunPayload({ result: buildPendingStepRunnerResult() }) };
      },
      processNextSegment: async () => {
        throw new JobDeskAiError("provider timed out", { kind: "timeout", status: 524 });
      },
    });

    const result = await runProfileEvidenceExtractionWorkerOnce("worker-test", dependencies);

    expect(result).toMatchObject({ status: "failed" });
    expect(calls.statuses).toEqual(["extracting_evidence"]);
    expect(calls.persistedExtractions).toHaveLength(0);
    expect(calls.completedRuns).toHaveLength(0);
    expect(calls.markedResumeSources).toHaveLength(0);
    expect(calls.failedRuns).toEqual([
      expect.objectContaining({
        canRetry: true,
        failureKind: "provider_timeout",
        retryAfterSeconds: 10,
        runId: "run-test",
      }),
    ]);
  });

  it("does not claim or touch source state when no queued run is available", async () => {
    const { calls, dependencies } = buildWorkerFixture({
      claimNextRun: async (workerId) => {
        calls.claimedWorkerIds.push(workerId);
        return { status: "empty" as const };
      },
    });

    const result = await runProfileEvidenceExtractionWorkerOnce("worker-test", dependencies);

    expect(result).toEqual({ status: "empty" });
    expect(calls.claimedWorkerIds).toEqual(["worker-test"]);
    expect(calls.authUserIds).toHaveLength(0);
    expect(calls.statuses).toHaveLength(0);
    expect(calls.persistedExtractions).toHaveLength(0);
  });

  it("processes only the user-triggered extraction run by id one bounded unit at a time", async () => {
    const { calls, dependencies } = buildWorkerFixture({
      claimRunById: async (runId, workerId) => {
        calls.claimedRunIds.push(runId);
        calls.claimedWorkerIds.push(workerId);
        return { status: "claimed" as const, run: buildRunPayload({ id: runId }) };
      },
      claimNextRun: async () => {
        throw new Error("UI-triggered processing must not claim arbitrary queued runs.");
      },
    });

    const result = await runProfileEvidenceExtractionWorkerForRun("run-user-clicked", "worker-test", dependencies);

    expect(result).toMatchObject({ hasMoreWork: true, status: "processing" });
    expect(calls.claimedRunIds).toEqual(["run-user-clicked"]);
    expect(calls.claimedWorkerIds).toEqual(["worker-test"]);
    expect(calls.persistedExtractions).toHaveLength(0);
  });

  it("keeps stale pre-save states reclaimable but excludes saving", () => {
    expect(profileEvidenceExtractionRunStaleClaimableStatuses).toEqual([
      "queued",
      "parsing",
      "segmenting",
      "extracting_profile",
      "extracting_evidence",
      "validating",
    ]);
    expect(profileEvidenceExtractionRunStaleClaimableStatuses).not.toContain("saving");
    expect(profileEvidenceExtractionRunStaleClaimableStatuses).not.toContain("completed");
    expect(profileEvidenceExtractionRunStaleClaimableStatuses).not.toContain("failed");
  });
});

function buildWorkerFixture(
  overrides: Partial<ProfileEvidenceExtractionWorkerDependencies> = {},
) {
  const run = buildRunPayload();
  const calls = {
    authUserIds: [] as Array<string | null>,
    claimedRunIds: [] as string[],
    claimedWorkerIds: [] as string[],
    completedRuns: [] as unknown[],
    embeddingReasons: [] as string[],
    failedRuns: [] as unknown[],
    markedResumeSources: [] as string[],
    persistedExtractions: [] as unknown[],
    progressRuns: [] as unknown[],
    statuses: [] as string[],
  };
  const dependencies: ProfileEvidenceExtractionWorkerDependencies = {
    claimRunById: async (runId, workerId) => {
      calls.claimedRunIds.push(runId);
      calls.claimedWorkerIds.push(workerId);
      return { status: "claimed" as const, run };
    },
    claimNextRun: async (workerId) => {
      calls.claimedWorkerIds.push(workerId);
      return { status: "claimed" as const, run };
    },
    completeRun: async (args) => {
      calls.completedRuns.push(args);
      return { ...run, result: args.result, status: "completed" as const };
    },
    extractChunked: async (args) => {
      await args.onStatus?.("extracting_evidence");
      return {
        data: buildExtraction(),
        retryCount: 0,
        segmentCount: 2,
        skill: skillRegistry.profileEvidenceExtractionResume,
        usage: { inputTokens: 120, outputTokens: 80, totalTokens: 200 },
      };
    },
    failRun: async (args) => {
      calls.failedRuns.push(args);
      return { ...run, failureKind: args.failureKind, status: "failed" as const };
    },
    getRunOwner: async () => ({
      status: "ready" as const,
      userId: "user-test",
      workspaceId: "workspace-test",
    }),
    markResumeExtracted: async (resumeSourceVersionId) => {
      calls.markedResumeSources.push(resumeSourceVersionId);
      return { status: "saved" as const, resume: buildResumeSourcePayload(resumeSourceVersionId) };
    },
    persistExtraction: async (args) => {
      calls.persistedExtractions.push(args);
      return {
        evidenceCount: args.extraction.evidence_items.length,
        initiativeCount: args.extraction.initiatives.length,
        portfolioProjectCount: args.extraction.portfolio_projects.length,
        profileId: "profile-test",
        projectCount: args.extraction.project_cards.length,
        sourceDocumentId: args.sourceDocumentId ?? "source-document-test",
        status: "saved" as const,
        workExperienceCount: args.extraction.work_experiences.length,
        workflowRunId: "workflow-test",
        workspaceId: "workspace-test",
      };
    },
    persistFailure: async () => ({ status: "saved" as const, workflowRunId: "failure-workflow-test" }),
    processNextSegment: async ({ state }) => {
      if (overrides.extractChunked) {
        await overrides.extractChunked({
          onStatus: async () => undefined,
          sourceId: state.sourceId,
          sourceText: "fixture",
        });
      }
      return {
        processedSegment: true,
        state: {
          ...state,
          segments: state.segments.map((segment, index) =>
            index === 0
              ? {
                  ...segment,
                  result: {
                    evidence_items: buildExtraction().evidence_items,
                    extraction_notes: [],
                    initiatives: buildExtraction().initiatives,
                  },
                  status: "completed" as const,
                }
              : segment,
          ),
        },
      };
    },
    resolveAiConfig: () => ({
      apiKey: "test-key",
      endpoint: "https://openrouter.example/v1/responses",
      model: "gpt-5.5",
      providerEnabled: true,
      reasoningEffort: "medium",
      store: false,
      temperature: 0,
      transport: "responses",
    }),
    resolveRunSource: async () => ({
      run,
      sourceText: "Jane Doe\n\nExperience\nAmazon\nSoftware Engineer Jan 2022 - Present\nBuilt reliable platform workflows.",
    }),
    runAsUser: (userId, callback) => {
      calls.authUserIds.push(userId);
      return callback();
    },
    scheduleEmbeddingsSync: (reason) => {
      calls.embeddingReasons.push(reason);
    },
    saveRunProgress: async (args) => {
      calls.progressRuns.push(args);
      return { ...run, result: args.result, status: args.status };
    },
    updateRunStatus: async (args) => {
      calls.statuses.push(args.status);
      return { ...run, status: args.status };
    },
  };

  return {
    calls,
    dependencies: {
      ...dependencies,
      ...overrides,
    },
  };
}

function buildRunPayload(overrides: Partial<ReturnType<typeof buildRunPayloadBase>> = {}) {
  return {
    ...buildRunPayloadBase(),
    ...overrides,
  };
}

function buildRunPayloadBase() {
  return {
    attemptCount: 1,
    canRetry: false,
    completedAt: null,
    createdAt: "2026-06-27T00:00:00.000Z",
    failedAt: null,
    failureKind: null,
    failureMessage: null,
    id: "run-test",
    result: {},
    resumeSourceVersionId: "resume-source-test",
    retryAfterSeconds: null,
    sourceDocumentId: "source-document-test",
    sourceTitle: "Jiekun Liu Resume",
    sourceType: "profile-evidence",
    startedAt: "2026-06-27T00:00:00.000Z",
    status: "parsing" as const,
    updatedAt: "2026-06-27T00:00:00.000Z",
    workspaceId: "workspace-test",
  };
}

function buildCompletedStepRunnerResult() {
  return {
    profileEvidenceStepRunner: {
      profileResult: {
        extraction_notes: [],
        profile: buildExtraction().profile,
        work_experiences: buildExtraction().work_experiences,
      },
      retryCount: 0,
      segmentCount: 2,
      segments: [
        {
          id: "work_experience-1",
          kind: "work_experience",
          result: {
            evidence_items: buildExtraction().evidence_items,
            extraction_notes: [],
            initiatives: buildExtraction().initiatives,
          },
          status: "completed",
          text: "Amazon\nSoftware Engineer Jan 2022 - Present\nBuilt reliable platform workflows.",
          title: "Experience",
        },
      ],
      sourceId: "run-test",
      usage: { inputTokens: 120, outputTokens: 80, totalTokens: 200 },
      version: "profile-evidence-step-runner-v1",
    },
  };
}

function buildPendingStepRunnerResult() {
  return {
    profileEvidenceStepRunner: {
      profileResult: {
        extraction_notes: [],
        profile: buildExtraction().profile,
        work_experiences: buildExtraction().work_experiences,
      },
      retryCount: 0,
      segmentCount: 2,
      segments: [
        {
          id: "work_experience-1",
          kind: "work_experience",
          status: "pending",
          text: "Amazon\nSoftware Engineer Jan 2022 - Present\nBuilt reliable platform workflows.",
          title: "Experience",
        },
      ],
      sourceId: "run-test",
      usage: {},
      version: "profile-evidence-step-runner-v1",
    },
  };
}

function buildResumeSourcePayload(resumeSourceVersionId: string) {
  return {
    contentHash: "resume-hash-test",
    createdAt: "2026-06-27T00:00:00.000Z",
    extractedAt: "2026-06-27T00:00:00.000Z",
    id: resumeSourceVersionId,
    lastReviewedAt: null,
    sourceDocumentId: "source-document-test",
    sourceKind: "text",
    sourceText: "Jane Doe resume",
    status: "extracted" as const,
    title: "Jiekun Liu Resume",
    updatedAt: "2026-06-27T00:00:00.000Z",
    version: 1,
  };
}

function buildExtraction(): ProfileEvidenceExtraction {
  return {
    evidence_items: [
      {
        allowed_usage: [],
        evidence_type: "extracted",
        metrics: [],
        needs_user_confirmation: false,
        public_safe_summary: null,
        related_initiative_id: "Reliable platform workflows",
        related_portfolio_project_id: null,
        related_project_id: null,
        related_work_experience_id: "Amazon · Software Engineer",
        sensitivity_level: "private",
        source_quote: "Built reliable platform workflows.",
        status: "pending",
        text: "Built reliable platform workflows.",
      },
    ],
    extraction_notes: [],
    initiatives: [
      {
        actions: ["Built reliable platform workflows."],
        context: "Platform systems.",
        external_safe_summary: null,
        external_safe_title: null,
        internal_title: "Reliable platform workflows",
        metrics: [],
        needs_redaction_review: true,
        problem: null,
        results: [],
        role: null,
        sensitivity_level: "private",
        stakeholders: [],
        status: "pending",
        technologies: [],
        work_experience_ref: "Amazon · Software Engineer",
      },
    ],
    portfolio_projects: [],
    profile: {
      certifications: [],
      education: [],
      email: null,
      experience: [],
      invented_field_flags: [],
      links: [],
      location: null,
      low_confidence_fields: [],
      missing_fields: [],
      name: { confidence: 0.9, source_quote: "Jane Doe", value: "Jane Doe" },
      phone: null,
      skills: [],
    },
    project_cards: [],
    work_experiences: [
      {
        employer: "Amazon",
        end_date: "Present",
        location: null,
        role_title: "Software Engineer",
        start_date: "Jan 2022",
        status: "pending",
        summary: "Built reliable platform workflows.",
        team: null,
      },
    ],
  };
}
