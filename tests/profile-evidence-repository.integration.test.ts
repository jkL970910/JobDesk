import crypto from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import { loadDotEnv } from "../src/ai/env";
import {
  getEnrichmentTaskQueue,
  updateEnrichmentTask,
  upsertEnrichmentTasks,
} from "../src/server/enrichment-task-repository";
import { getDb } from "../src/db/client";
import {
  enrichmentAnswers,
  enrichmentProposals,
  enrichmentTaskTargets,
  evidenceItems,
  generatedClaims,
  initiatives,
  resumeSourceVersions,
  sourceDocuments,
  workExperiences,
} from "../src/db/schema";
import {
  getEvidenceDedupeCandidates,
  getProjectDedupeCandidates,
  getRecentEvidenceLibrary,
  getResumeTailoringContext,
  getStarStoryBank,
  keepEvidenceOverlapSeparate,
  keepProjectOverlapSeparate,
  mergeEvidenceItems,
  mergeProjectCards,
  mergeStoryTargets,
  persistProfileEvidenceExtraction,
  updateEvidenceItem,
} from "../src/server/profile-evidence-repository";
import type { ProfileEvidenceExtraction } from "../src/schemas/profile-evidence-extraction";
import { skillRegistry } from "../src/ai/skills-registry";
import { expectWorkflowRunMetadata } from "./helpers/workflow-run-assertions";
import { eq } from "drizzle-orm";
import { getCurrentWorkspace } from "../src/server/workspace-repository";

const runIntegration = process.env.JOBDESK_RUN_DB_INTEGRATION === "true";

describe.skipIf(!runIntegration)("profile evidence repository integration", () => {
  beforeAll(() => {
    loadDotEnv();
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is required for DB integration tests.");
    }
  });

  it("persists profile, evidence drafts, and project cards", async () => {
    const extraction = buildExtraction();
    const sourceTitle = `Profile evidence integration ${crypto.randomUUID()}`;
    const result = await persistProfileEvidenceExtraction({
      sourceTitle,
      sourceText: sampleSourceText,
      extraction,
      provider: "integration-test",
      model: "test-model",
      usage: { totalTokens: 42 },
      retryCount: 0,
      skill: skillRegistry.profileEvidenceExtractionResume,
    });

    expect(result).toMatchObject({
      status: "saved",
      evidenceCount: 5,
      projectCount: 1,
    });
    if (result.status !== "saved") throw new Error("Expected saved profile evidence.");
    await expectWorkflowRunMetadata(result.workflowRunId, {
      skillId: "profile-evidence-extraction-resume",
      promptVersion: "profile-evidence-extraction-resume-v1",
      schemaName: "ProfileEvidenceExtraction",
      sourceSkillIds: [
        "profile-extraction",
        "evidence-extraction",
        "project-deidentification",
        "star-story-extraction",
      ],
    });
    const enrichmentQueue = await getEnrichmentTaskQueue({
      limit: 200,
      sourceType: "extraction_note",
      statuses: ["open", "answered"],
    });
    expect(enrichmentQueue.status).toBe("ready");
    if (enrichmentQueue.status !== "ready") {
      throw new Error("Expected enrichment queue.");
    }
    const metricTask = enrichmentQueue.tasks.find((task) =>
      task.prompt.includes("Add a concrete activation metric") &&
      task.source_label === sourceTitle,
    );
    expect(metricTask).toBeDefined();
    if (!metricTask) throw new Error("Expected enrichment task.");
    const filterSmokePrompt = `Filter smoke metric ${result.workflowRunId}`;
    await upsertEnrichmentTasks(getDb(), {
      workspaceId: result.workspaceId,
      tasks: [
        {
          taskType: "metric",
          sourceType: "extraction_note",
          sourceLabel: `Filter smoke ${result.workflowRunId}`,
          prompt: filterSmokePrompt,
        },
      ],
    });
    const filteredExtractionTasks = await getEnrichmentTaskQueue({
      limit: 20,
      sourceType: "extraction_note",
      statuses: ["open", "answered"],
    });
    expect(filteredExtractionTasks.status).toBe("ready");
    if (filteredExtractionTasks.status !== "ready") {
      throw new Error("Expected filtered enrichment queue.");
    }
    expect(filteredExtractionTasks.tasks.length).toBeGreaterThan(0);
    expect(filteredExtractionTasks.tasks.some((task) => task.prompt === filterSmokePrompt)).toBe(true);
    expect(
      filteredExtractionTasks.tasks.every(
        (task) => task.source_type === "extraction_note" && ["open", "answered"].includes(task.status),
      ),
    ).toBe(true);
    await upsertEnrichmentTasks(getDb(), {
      workspaceId: result.workspaceId,
      tasks: [
        {
          taskType: "metric",
          sourceType: "extraction_note",
          sourceLabel: "Different source",
          prompt: metricTask.prompt,
          expectedOutcome: "create_evidence",
          targetScope: "evidence_detail",
        },
      ],
    });
    const afterDifferentSource = await getEnrichmentTaskQueue(50);
    expect(afterDifferentSource.status).toBe("ready");
    if (afterDifferentSource.status !== "ready") {
      throw new Error("Expected enrichment queue after different source.");
    }
    expect(
      afterDifferentSource.tasks.filter((task) => task.prompt === metricTask.prompt).length,
    ).toBeGreaterThanOrEqual(2);
    const metricAnswered = await updateEnrichmentTask({
      taskId: metricTask.id,
      action: "answer",
      userAnswer: "Improved activation by 12% across three onboarding cohorts.",
    });
    expect(metricAnswered.status).toBe("saved");
    if (metricAnswered.status !== "saved") throw new Error("Expected metric answer saved.");
    const metricProposal = metricAnswered.task.proposals.find(
      (proposal) => proposal.status === "pending_review",
    );
    if (!metricProposal) throw new Error("Expected metric proposal.");
    const converted = await updateEnrichmentTask({
      taskId: metricTask.id,
      action: "accept_proposal",
      proposalId: metricProposal.id,
    });
    expect(converted.status).toBe("saved");
    expect(converted).toMatchObject({
      conversionMode: "proposal_commit",
      evidenceCount: 0,
    });
    const aiAnswerPrompt = `AI extraction answer ${result.workflowRunId}`;
    await upsertEnrichmentTasks(getDb(), {
      workspaceId: result.workspaceId,
      tasks: [
        {
          taskType: "metric",
          sourceType: "user_input",
          sourceLabel: "AI answer smoke",
          prompt: aiAnswerPrompt,
        },
      ],
    });
    const aiTaskQueue = await getEnrichmentTaskQueue({
      limit: 20,
      sourceType: "user_input",
      statuses: ["open"],
    });
    expect(aiTaskQueue.status).toBe("ready");
    if (aiTaskQueue.status !== "ready") throw new Error("Expected AI task queue.");
    const aiTask = aiTaskQueue.tasks.find((task) => task.prompt === aiAnswerPrompt);
    if (!aiTask) throw new Error("Expected AI extraction task.");
    expect(aiTask).toMatchObject({
      target_scope: "assign_later",
      expected_outcome: "clarify_assignment",
      targets: [],
    });
    const aiAnswer = `Increased onboarding activation by 12% across three cohorts ${crypto.randomUUID()}.`;
    await updateEnrichmentTask({
      taskId: aiTask.id,
      action: "answer",
      userAnswer: aiAnswer,
    });
    const aiConverted = await updateEnrichmentTask({
      taskId: aiTask.id,
      action: "convert",
      useAiExtraction: true,
      extractAnswerEvidence: async ({ sourceText }) => ({
        extraction: {
          ...buildExtraction(),
          evidence_items: [
            {
              text: "Increased onboarding activation by 12% across three cohorts.",
              source_quote: sourceText,
              evidence_type: "extracted",
              metrics: [
                { value: "12%", source_quote: "Increased onboarding activation by 12%" },
                { value: "40%", source_quote: "Prompt said 40%" },
              ],
              sensitivity_level: "private",
              allowed_usage: ["resume", "interview"],
              public_safe_summary: null,
              status: "pending",
              related_project_id: null,
              needs_user_confirmation: false,
            },
          ],
        },
        provider: "mock-ai",
        model: "mock-model",
        usage: { totalTokens: 10 },
        retryCount: 0,
        skill: skillRegistry.profileEvidenceExtractionProjectNote,
      }),
    });
    expect(aiConverted).toMatchObject({
      status: "invalid",
      reason: "proposal_review_required",
    });
    const aiEvidence = await getDb()
      .select()
      .from(evidenceItems)
      .where(eq(evidenceItems.text, aiAnswer));
    expect(aiEvidence).toHaveLength(0);
    await upsertEnrichmentTasks(getDb(), {
      workspaceId: result.workspaceId,
      tasks: [
        {
          taskType: "metric",
          sourceType: "extraction_note",
          sourceLabel: metricTask.source_label,
          prompt: metricTask.prompt,
        },
      ],
    });
    const afterTerminalUpsert = await getEnrichmentTaskQueue(50);
    expect(afterTerminalUpsert.status).toBe("ready");
    if (afterTerminalUpsert.status !== "ready") {
      throw new Error("Expected enrichment queue after terminal upsert.");
    }
    const terminalTask = afterTerminalUpsert.tasks.find((task) => task.id === metricTask.id);
    expect(terminalTask).toMatchObject({
      status: "answered",
    });

    const library = await getRecentEvidenceLibrary(10);
    expect(library.profile?.displayName).toBe("Jane Doe");
    const profileJson = library.profile?.profile as
      | {
          contact?: {
            name?: { verified?: boolean; source_offset?: number | null };
          };
          experience?: Array<{
            employer?: { verified?: boolean; source_offset?: number | null };
            title?: { verified?: boolean; source_offset?: number | null };
            start_date?: { verified?: boolean; source_offset?: number | null } | null;
          }>;
          skills?: Array<{ verified?: boolean; source_offset?: number | null }>;
        }
      | undefined;
    expect(profileJson?.contact?.name).toMatchObject({
      verified: true,
      source_offset: sampleSourceText.indexOf("Jane Doe"),
    });
    expect(profileJson?.experience?.[0]?.employer?.verified).toBe(true);
    expect(profileJson?.experience?.[0]?.title?.verified).toBe(true);
    expect(profileJson?.experience?.[0]?.start_date?.verified).toBe(true);
    expect(profileJson?.skills?.[0]).toMatchObject({
      verified: true,
      source_offset: sampleSourceText.indexOf("Built SQL dashboards"),
    });
    const insertedEvidence = library.evidenceItems.filter(
      (item) => item.source_document_id === result.sourceDocumentId,
    );
    const sqlEvidence = insertedEvidence.find((item) =>
      item.text.includes("SQL dashboards"),
    );
    const inferredEvidence = insertedEvidence.find((item) =>
      item.text.includes("Inferred ownership"),
    );
    const internalEvidence = insertedEvidence.find((item) =>
      item.text.includes("Internal-only stakeholder reporting"),
    );
    const sensitiveEvidence = insertedEvidence.find((item) =>
      item.text.includes("Sensitive finance dashboard"),
    );
    expect(sqlEvidence).toBeDefined();
    expect(sqlEvidence?.public_safe_summary).toBe(
      "Built SQL dashboards for onboarding funnel analysis.",
    );
    expect(inferredEvidence).toMatchObject({
      needs_user_confirmation: true,
      public_safe_summary: null,
    });
    expect(sensitiveEvidence?.public_safe_summary).toBeNull();
    if (!internalEvidence) throw new Error("Expected internal evidence.");
    const unsafeExternalSummary = await updateEvidenceItem({
      evidenceId: internalEvidence.id,
      action: "edit",
      publicSafeSummary: "Built confidential reporting for Acme Finance.",
    });
    expect(unsafeExternalSummary).toMatchObject({
      status: "invalid",
      reason: "public_safe_summary_contains_blocked_terms",
      redactionReport: {
        hasBlockedTerms: true,
      },
    });
    const onboardingProject = library.projectCards.find(
      (project) => project.title === "Onboarding analytics",
    );
    expect(onboardingProject).toBeDefined();
    const starStories = await getStarStoryBank(10);
    expect(starStories.status).toBe("ready");
    if (starStories.status !== "ready") throw new Error("Expected STAR story bank.");
    expect(
      starStories.stories.some(
        (story) =>
          story.title === "Onboarding analytics" &&
          story.action.some((action) => action.includes("SQL dashboards")),
      ),
    ).toBe(true);

    if (!sqlEvidence) throw new Error("Expected SQL evidence.");
    const approve = await updateEvidenceItem({
      evidenceId: sqlEvidence.id,
      action: "approve",
    });
    expect(approve).toMatchObject({
      status: "saved",
      evidenceItem: {
        status: "approved",
        needsUserConfirmation: false,
      },
    });

    const edit = await updateEvidenceItem({
      evidenceId: sqlEvidence.id,
      action: "edit",
      text: "Built SQL dashboards for onboarding funnel analysis and activation metrics.",
    });
    expect(edit).toMatchObject({
      status: "saved",
      evidenceItem: {
        text: "Built SQL dashboards for onboarding funnel analysis and activation metrics.",
        needsUserConfirmation: true,
      },
    });

    const invalidProjectLink = await updateEvidenceItem({
      evidenceId: sqlEvidence.id,
      action: "edit",
      relatedProjectId: crypto.randomUUID(),
    });
    expect(invalidProjectLink).toMatchObject({
      status: "invalid",
      reason: "related_project_not_found",
    });

    if (!onboardingProject) throw new Error("Expected onboarding project.");
    const projectLink = await updateEvidenceItem({
      evidenceId: sqlEvidence.id,
      action: "edit",
      relatedProjectId: onboardingProject.id,
    });
    expect(projectLink).toMatchObject({
      status: "saved",
      evidenceItem: {
        relatedProjectId: onboardingProject.id,
        needsUserConfirmation: true,
      },
    });

    const afterEditContext = await getResumeTailoringContext();
    expect(
      afterEditContext.evidenceItems.some((item) => item.id === sqlEvidence.id),
    ).toBe(false);

    await updateEvidenceItem({
      evidenceId: sqlEvidence.id,
      action: "edit",
      publicSafeSummary: "Built dashboard analysis for onboarding funnel metrics.",
      sensitivityLevel: "public_safe",
    });
    const resumeEligible = await updateEvidenceItem({
      evidenceId: sqlEvidence.id,
      action: "approve_for_resume",
      allowedUsage: ["interview"],
    });
    expect(resumeEligible).toMatchObject({
      status: "saved",
      evidenceItem: {
        status: "approved",
        allowedUsage: ["interview", "resume"],
        needsUserConfirmation: false,
      },
    });

    const tailoringContext = await getResumeTailoringContext();
    expect(tailoringContext.profile?.displayName).toBe("Jane Doe");
    expect(
      tailoringContext.evidenceItems.some((item) => item.id === sqlEvidence.id),
    ).toBe(true);
    expect(
      tailoringContext.evidenceItems.some((item) => item.text.includes("three product teams")),
    ).toBe(false);

    if (!internalEvidence || !sensitiveEvidence) {
      throw new Error("Expected de-identification guardrail evidence.");
    }
    await expect(
      updateEvidenceItem({
        evidenceId: internalEvidence.id,
        action: "approve_for_resume",
        allowedUsage: ["resume"],
      }),
    ).resolves.toMatchObject({
      status: "invalid",
      reason: "resume_evidence_requires_public_safe_summary",
    });
    await updateEvidenceItem({
      evidenceId: internalEvidence.id,
      action: "edit",
      publicSafeSummary: "Led stakeholder reporting for cross-functional product teams.",
      allowedUsage: ["resume", "internal_only"],
    });
    await expect(
      updateEvidenceItem({
        evidenceId: internalEvidence.id,
        action: "approve_for_resume",
        allowedUsage: ["resume", "internal_only"],
      }),
    ).resolves.toMatchObject({
      status: "invalid",
      reason: "internal_only_evidence_requires_external_safe_edit",
    });
    await expect(
      updateEvidenceItem({
        evidenceId: sensitiveEvidence.id,
        action: "approve_for_resume",
        allowedUsage: ["resume"],
      }),
    ).resolves.toMatchObject({
      status: "invalid",
      reason: "resume_evidence_requires_public_safe_summary",
    });
    await updateEvidenceItem({
      evidenceId: internalEvidence.id,
      action: "edit",
      publicSafeSummary: "Led stakeholder reporting for cross-functional product teams.",
      sensitivityLevel: "public_safe",
      allowedUsage: ["resume", "interview"],
    });
    await expect(
      updateEvidenceItem({
        evidenceId: internalEvidence.id,
        action: "approve_for_resume",
        allowedUsage: ["resume", "interview"],
      }),
    ).resolves.toMatchObject({
      status: "saved",
      evidenceItem: {
        allowedUsage: ["resume", "interview"],
        sensitivityLevel: "public_safe",
      },
    });

    for (const item of [inferredEvidence, internalEvidence, sensitiveEvidence]) {
      if (!item) throw new Error("Expected exclusion test evidence.");
      await updateEvidenceItem({
        evidenceId: item.id,
        action: "edit",
        allowedUsage: ["resume", ...(item === internalEvidence ? ["internal_only" as const] : [])],
      });
      await updateEvidenceItem({
        evidenceId: item.id,
        action: "approve",
      });
    }

    const stricterContext = await getResumeTailoringContext();
    expect(
      stricterContext.evidenceItems.some((item) =>
        item.text.includes("Inferred ownership"),
      ),
    ).toBe(false);
    expect(
      stricterContext.evidenceItems.some((item) =>
        item.text.includes("Internal-only stakeholder reporting"),
      ),
    ).toBe(false);
    expect(
      stricterContext.evidenceItems.some((item) =>
        item.text.includes("Sensitive finance dashboard"),
      ),
    ).toBe(false);

    const duplicateA = await persistProfileEvidenceExtraction({
      sourceText: duplicateSourceText,
      extraction: buildDuplicateExtraction("Built onboarding funnel dashboards with SQL."),
      provider: "integration-test",
      model: "test-model",
      usage: {},
      retryCount: 0,
      skill: skillRegistry.profileEvidenceExtractionResume,
    });
    const duplicateB = await persistProfileEvidenceExtraction({
      sourceText: duplicateSourceText,
      extraction: buildDuplicateExtraction("Built SQL dashboards for onboarding funnel analysis."),
      provider: "integration-test",
      model: "test-model",
      usage: {},
      retryCount: 0,
      skill: skillRegistry.profileEvidenceExtractionResume,
    });
    if (duplicateA.status !== "saved" || duplicateB.status !== "saved") {
      throw new Error("Expected duplicate evidence setup to save.");
    }
    const dedupe = await getEvidenceDedupeCandidates(20);
    expect(dedupe.status).toBe("ready");
    if (dedupe.status !== "ready") throw new Error("Expected dedupe candidates.");
    const candidate = dedupe.candidates.find(
      (item) =>
        item.primary.text.includes("onboarding funnel") &&
        item.duplicate.text.includes("onboarding funnel"),
    );
    expect(candidate).toBeDefined();
    if (!candidate) throw new Error("Expected duplicate candidate.");

    const keepSeparate = await keepEvidenceOverlapSeparate({
      primaryEvidenceId: candidate.primary.id,
      duplicateEvidenceId: candidate.duplicate.id,
    });
    expect(keepSeparate).toMatchObject({ status: "saved", entityType: "evidence" });
    const afterKeepSeparate = await getEvidenceDedupeCandidates(20);
    expect(afterKeepSeparate.status).toBe("ready");
    if (afterKeepSeparate.status !== "ready") {
      throw new Error("Expected dedupe candidates after keep-separate.");
    }
    expect(
      afterKeepSeparate.candidates.some(
        (item) =>
          item.primary.id === candidate.primary.id &&
          item.duplicate.id === candidate.duplicate.id,
      ),
    ).toBe(false);

    const mergeDuplicateA = await persistProfileEvidenceExtraction({
      sourceText: duplicateSourceText,
      extraction: buildDuplicateExtraction("Built onboarding funnel reporting with SQL."),
      provider: "integration-test",
      model: "test-model",
      usage: {},
      retryCount: 0,
      skill: skillRegistry.profileEvidenceExtractionResume,
    });
    const mergeDuplicateB = await persistProfileEvidenceExtraction({
      sourceText: duplicateSourceText,
      extraction: buildDuplicateExtraction("Built SQL reporting for onboarding funnel analysis."),
      provider: "integration-test",
      model: "test-model",
      usage: {},
      retryCount: 0,
      skill: skillRegistry.profileEvidenceExtractionResume,
    });
    if (mergeDuplicateA.status !== "saved" || mergeDuplicateB.status !== "saved") {
      throw new Error("Expected duplicate evidence merge setup to save.");
    }
    const mergeDedupe = await getEvidenceDedupeCandidates(20);
    expect(mergeDedupe.status).toBe("ready");
    if (mergeDedupe.status !== "ready") throw new Error("Expected merge dedupe candidates.");
    const mergeCandidate = mergeDedupe.candidates.find(
      (item) =>
        item.primary.text.includes("onboarding funnel") &&
        item.duplicate.text.includes("onboarding funnel") &&
        item.primary.id !== candidate.primary.id &&
        item.duplicate.id !== candidate.duplicate.id,
    );
    expect(mergeCandidate).toBeDefined();
    if (!mergeCandidate) throw new Error("Expected duplicate merge candidate.");

    const merge = await mergeEvidenceItems({
      primaryEvidenceId: mergeCandidate.primary.id,
      duplicateEvidenceId: mergeCandidate.duplicate.id,
    });
    expect(merge).toMatchObject({
      status: "merged",
      primaryEvidenceId: mergeCandidate.primary.id,
      duplicateEvidenceId: mergeCandidate.duplicate.id,
    });

    const afterMerge = await getRecentEvidenceLibrary(50);
    const duplicateAfterMerge = afterMerge.evidenceItems.find(
      (item) => item.id === mergeCandidate.duplicate.id,
    );
    expect(duplicateAfterMerge).toMatchObject({ status: "rejected" });

    const projectA = await persistProfileEvidenceExtraction({
      sourceText: projectDuplicateSourceText,
      extraction: buildProjectDuplicateExtraction({
        action: "Mapped activation funnel events.",
        evidence: "Mapped onboarding activation funnel events with SQL.",
        result: "Identified onboarding drop-off.",
        title: "Activation dashboard",
      }),
      provider: "integration-test",
      model: "test-model",
      usage: {},
      retryCount: 0,
      skill: skillRegistry.profileEvidenceExtractionResume,
    });
    const projectB = await persistProfileEvidenceExtraction({
      sourceText: projectDuplicateSourceText,
      extraction: buildProjectDuplicateExtraction({
        action: "Mapped onboarding funnel steps.",
        evidence: "Mapped onboarding funnel steps and dashboard slices.",
        result: "Prioritized follow-up activation experiments.",
        title: "Activation dashboard",
      }),
      provider: "integration-test",
      model: "test-model",
      usage: {},
      retryCount: 0,
      skill: skillRegistry.profileEvidenceExtractionResume,
    });
    if (projectA.status !== "saved" || projectB.status !== "saved") {
      throw new Error("Expected duplicate project setup to save.");
    }

    const projectDedupe = await getProjectDedupeCandidates(200);
    expect(projectDedupe.status).toBe("ready");
    if (projectDedupe.status !== "ready") {
      throw new Error("Expected project dedupe candidates.");
    }
    const projectCandidate = projectDedupe.candidates.find(
      (item) =>
        item.primary.title.includes("Activation dashboard") &&
        item.duplicate.title.includes("Activation dashboard"),
    );
    expect(projectCandidate).toBeDefined();
    if (!projectCandidate) throw new Error("Expected duplicate project candidate.");

    const projectKeepSeparate = await keepProjectOverlapSeparate({
      primaryProjectId: projectCandidate.primary.id,
      duplicateProjectIds: projectCandidate.duplicateProjectIds,
    });
    expect(projectKeepSeparate).toMatchObject({
      status: "saved",
      entityType: "project",
      ignoredPairCount: projectCandidate.duplicateProjectIds.length,
    });
    const projectDedupeAfterKeepSeparate = await getProjectDedupeCandidates(200);
    expect(projectDedupeAfterKeepSeparate.status).toBe("ready");
    if (projectDedupeAfterKeepSeparate.status !== "ready") {
      throw new Error("Expected project dedupe after keep-separate.");
    }
    expect(
      projectDedupeAfterKeepSeparate.candidates.some(
        (item) =>
          item.primary.id === projectCandidate.primary.id &&
          item.duplicateProjectIds.some((id) =>
            projectCandidate.duplicateProjectIds.includes(id),
          ),
      ),
    ).toBe(false);

    const mergeProjectA = await persistProfileEvidenceExtraction({
      sourceText: projectDuplicateSourceText,
      extraction: buildProjectDuplicateExtraction({
        action: "Mapped activation funnel cohorts.",
        evidence: "Mapped activation funnel cohorts with SQL.",
        result: "Found onboarding drop-off for paid acquisition.",
        title: "Activation dashboard merge test",
      }),
      provider: "integration-test",
      model: "test-model",
      usage: {},
      retryCount: 0,
      skill: skillRegistry.profileEvidenceExtractionResume,
    });
    const mergeProjectB = await persistProfileEvidenceExtraction({
      sourceText: projectDuplicateSourceText,
      extraction: buildProjectDuplicateExtraction({
        action: "Mapped activation funnel cohort dashboard slices.",
        evidence: "Mapped activation funnel cohort dashboard slices.",
        result: "Prioritized paid acquisition onboarding experiments.",
        title: "Activation dashboard merge test",
      }),
      provider: "integration-test",
      model: "test-model",
      usage: {},
      retryCount: 0,
      skill: skillRegistry.profileEvidenceExtractionResume,
    });
    if (mergeProjectA.status !== "saved" || mergeProjectB.status !== "saved") {
      throw new Error("Expected duplicate project merge setup to save.");
    }
    const projectMergeDedupe = await getProjectDedupeCandidates(200);
    expect(projectMergeDedupe.status).toBe("ready");
    if (projectMergeDedupe.status !== "ready") {
      throw new Error("Expected project merge dedupe candidates.");
    }
    const projectMergeCandidate = projectMergeDedupe.candidates.find(
      (item) =>
        item.primary.title.includes("Activation dashboard merge test") &&
        item.duplicate.title.includes("Activation dashboard merge test"),
    );
    expect(projectMergeCandidate).toBeDefined();
    if (!projectMergeCandidate) throw new Error("Expected duplicate project merge candidate.");

    const projectMerge = await mergeProjectCards({
      primaryProjectId: projectMergeCandidate.primary.id,
      duplicateProjectIds: projectMergeCandidate.duplicateProjectIds,
    });
    expect(projectMerge).toMatchObject({
      status: "merged",
      primaryProjectId: projectMergeCandidate.primary.id,
      duplicateProjectId: projectMergeCandidate.duplicate.id,
      duplicateProjectCount: projectMergeCandidate.duplicateCount,
      movedEvidenceCount: projectMergeCandidate.duplicateEvidenceCount,
    });

    const afterProjectMerge = await getRecentEvidenceLibrary(80);
    expect(
      afterProjectMerge.projectCards.some((project) => project.id === projectMergeCandidate.duplicate.id),
    ).toBe(false);
    expect(
      afterProjectMerge.evidenceItems.some(
        (item) =>
          item.related_project_id === projectMergeCandidate.primary.id &&
          item.text.includes("cohort dashboard slices"),
      ),
    ).toBe(true);
  }, 20_000);

  it("previews enrichment answers as proposals before committing canonical evidence", async () => {
    const db = getDb();
    const workspace = await getCurrentWorkspace(db);
    const prompt = `Proposal flow metric ${crypto.randomUUID()}`;
    await upsertEnrichmentTasks(db, {
      workspaceId: workspace.id,
      tasks: [
        {
          taskType: "metric",
          sourceType: "user_input",
          sourceLabel: "Proposal flow smoke",
          prompt,
          expectedOutcome: "create_evidence",
          targetScope: "evidence_detail",
        },
      ],
    });
    const queue = await getEnrichmentTaskQueue({
      limit: 20,
      sourceType: "user_input",
      statuses: ["open"],
    });
    expect(queue.status).toBe("ready");
    if (queue.status !== "ready") throw new Error("Expected enrichment queue.");
    const task = queue.tasks.find((item) => item.prompt === prompt);
    if (!task) throw new Error("Expected proposal flow task.");

    const answer = `Reduced manual QA review by 18 hours per week through validation dashboards ${crypto.randomUUID()}.`;
    const answered = await updateEnrichmentTask({
      taskId: task.id,
      action: "answer",
      userAnswer: answer,
    });
    expect(answered.status).toBe("saved");
    if (answered.status !== "saved") throw new Error("Expected saved answer.");
    expect(answered.task.proposals).toHaveLength(1);
    expect(answered.task.proposals[0]).toMatchObject({
      proposal_type: "create_evidence",
      status: "pending_review",
      schema_version: "enrichment-proposal-v1",
    });
    expect(answered.task.proposals[0]?.proposed_patch_json).toMatchObject({
      text: answer,
      evidence_type: "user_confirmed",
      status: "pending",
    });

    const answerRows = await db
      .select()
      .from(enrichmentAnswers)
      .where(eq(enrichmentAnswers.taskId, task.id));
    expect(answerRows).toHaveLength(1);
    const evidenceBeforeAccept = await db
      .select()
      .from(evidenceItems)
      .where(eq(evidenceItems.text, answer));
    expect(evidenceBeforeAccept).toHaveLength(0);

    const rejected = await updateEnrichmentTask({
      taskId: task.id,
      action: "reject_proposal",
      proposalId: answered.task.proposals[0]!.id,
    });
    expect(rejected.status).toBe("saved");
    const proposalRowsAfterReject = await db
      .select()
      .from(enrichmentProposals)
      .where(eq(enrichmentProposals.taskId, task.id));
    expect(proposalRowsAfterReject.some((proposal) => proposal.status === "rejected")).toBe(true);
    const evidenceAfterReject = await db
      .select()
      .from(evidenceItems)
      .where(eq(evidenceItems.text, answer));
    expect(evidenceAfterReject).toHaveLength(0);

    const answeredAgain = await updateEnrichmentTask({
      taskId: task.id,
      action: "answer",
      userAnswer: answer,
    });
    expect(answeredAgain.status).toBe("saved");
    if (answeredAgain.status !== "saved") throw new Error("Expected saved answer.");
    const pendingProposal = answeredAgain.task.proposals.find(
      (proposal) => proposal.status === "pending_review",
    );
    expect(pendingProposal).toBeDefined();
    if (!pendingProposal) throw new Error("Expected pending proposal.");
    const revisedText = `${answer} Revised preview wording keeps backend ownership explicit.`;
    const revised = await updateEnrichmentTask({
      taskId: task.id,
      action: "revise_proposal",
      proposalId: pendingProposal.id,
      revisedText,
    });
    expect(revised.status).toBe("saved");
    if (revised.status !== "saved") throw new Error("Expected revised proposal.");
    const revisedProposal = revised.task.proposals.find(
      (proposal) => proposal.status === "pending_review",
    );
    expect(revisedProposal).toBeDefined();
    if (!revisedProposal) throw new Error("Expected pending revised proposal.");
    expect(revisedProposal.id).not.toBe(pendingProposal.id);
    expect(revisedProposal.proposed_patch_json).toMatchObject({ text: revisedText });
    const originalAfterRevision = await db
      .select()
      .from(enrichmentProposals)
      .where(eq(enrichmentProposals.id, pendingProposal.id))
      .limit(1);
    expect(originalAfterRevision[0]?.status).toBe("rejected");
    const legacyConvertWithPendingProposal = await updateEnrichmentTask({
      taskId: task.id,
      action: "convert",
    });
    expect(legacyConvertWithPendingProposal).toMatchObject({
      status: "invalid",
      reason: "proposal_review_required",
    });
    const accepted = await updateEnrichmentTask({
      taskId: task.id,
      action: "accept_proposal",
      proposalId: revisedProposal.id,
    });
    expect(accepted.status).toBe("saved");
    expect(accepted).toMatchObject({
      conversionMode: "proposal_commit",
      evidenceCount: 1,
    });
    if (
      accepted.status !== "saved" ||
      !("evidenceItemId" in accepted) ||
      !accepted.evidenceItemId
    ) {
      throw new Error("Expected accepted proposal evidence item.");
    }
    const [evidence] = await db
      .select()
      .from(evidenceItems)
      .where(eq(evidenceItems.id, accepted.evidenceItemId))
      .limit(1);
    expect(evidence).toMatchObject({
      text: revisedText,
      sourceQuote: revisedText,
      evidenceType: "user_confirmed",
      status: "pending",
      needsUserConfirmation: 1,
      allowedUsage: [],
      publicSafeSummary: null,
    });
    const [acceptedProposal] = await db
      .select()
      .from(enrichmentProposals)
      .where(eq(enrichmentProposals.id, revisedProposal.id))
      .limit(1);
    expect(acceptedProposal).toMatchObject({
      status: "accepted",
      committedEvidenceItemId: accepted.evidenceItemId,
    });
    const secondAccept = await updateEnrichmentTask({
      taskId: task.id,
      action: "accept_proposal",
      proposalId: revisedProposal.id,
    });
    expect(secondAccept).toMatchObject({
      status: "invalid",
      reason: "proposal_not_found",
    });
    const duplicateEvidence = await db
      .select()
      .from(evidenceItems)
      .where(eq(evidenceItems.text, revisedText));
    expect(duplicateEvidence).toHaveLength(1);
  });

  it("keeps proposal review state consistent when targets or payloads change", async () => {
    const db = getDb();
    const workspace = await getCurrentWorkspace(db);
    const prompt = `Proposal consistency ${crypto.randomUUID()}`;
    await upsertEnrichmentTasks(db, {
      workspaceId: workspace.id,
      tasks: [
        {
          taskType: "metric",
          sourceType: "user_input",
          sourceLabel: "Proposal consistency smoke",
          prompt,
        },
      ],
    });
    const queue = await getEnrichmentTaskQueue({
      limit: 20,
      sourceType: "user_input",
      statuses: ["open"],
    });
    expect(queue.status).toBe("ready");
    if (queue.status !== "ready") throw new Error("Expected enrichment queue.");
    const task = queue.tasks.find((item) => item.prompt === prompt);
    if (!task) throw new Error("Expected consistency task.");

    const answer = `Raised activation by 9 percent through onboarding metric reviews ${crypto.randomUUID()}.`;
    const answered = await updateEnrichmentTask({
      taskId: task.id,
      action: "answer",
      userAnswer: answer,
    });
    expect(answered.status).toBe("saved");
    if (answered.status !== "saved") throw new Error("Expected saved answer.");
    const staleProposal = answered.task.proposals.find(
      (proposal) => proposal.status === "pending_review",
    );
    if (!staleProposal) throw new Error("Expected pending proposal.");

    const [role] = await db
      .insert(workExperiences)
      .values({
        workspaceId: workspace.id,
        employer: `Consistency Co ${crypto.randomUUID()}`,
        roleTitle: "Product Analyst",
      })
      .returning({ id: workExperiences.id });
    if (!role) throw new Error("Expected role.");

    const linked = await updateEnrichmentTask({
      taskId: task.id,
      action: "link",
      anchor: { workExperienceId: role.id },
    });
    expect(linked.status).toBe("saved");
    const staleProposalAfterLink = await db
      .select()
      .from(enrichmentProposals)
      .where(eq(enrichmentProposals.id, staleProposal.id))
      .limit(1);
    expect(staleProposalAfterLink[0]?.status).toBe("rejected");
    const staleAccept = await updateEnrichmentTask({
      taskId: task.id,
      action: "accept_proposal",
      proposalId: staleProposal.id,
    });
    expect(staleAccept).toMatchObject({
      status: "invalid",
      reason: "proposal_not_found",
    });

    const answeredAfterLink = await updateEnrichmentTask({
      taskId: task.id,
      action: "answer",
      userAnswer: answer,
    });
    expect(answeredAfterLink.status).toBe("saved");
    if (answeredAfterLink.status !== "saved") throw new Error("Expected relinked answer.");
    const linkedProposal = answeredAfterLink.task.proposals.find(
      (proposal) => proposal.status === "pending_review",
    );
    if (!linkedProposal) throw new Error("Expected relinked proposal.");
    expect(linkedProposal).toMatchObject({
      proposal_type: "update_work_experience",
      target_kind: "work_experience",
      target_id: role.id,
    });
    expect(linkedProposal.proposed_patch_json).toMatchObject({
      patch_type: "update_work_experience",
      summary_patch: answer,
      target_id: role.id,
      target_kind: "work_experience",
    });

    const invalidPayload = await updateEnrichmentTask({
      taskId: task.id,
      action: "answer",
      userAnswer: `${answer} invalid payload check`,
    });
    expect(invalidPayload.status).toBe("saved");
    if (invalidPayload.status !== "saved") throw new Error("Expected invalid payload answer.");
    const invalidProposal = invalidPayload.task.proposals.find(
      (proposal) => proposal.status === "pending_review",
    );
    if (!invalidProposal) throw new Error("Expected invalid payload proposal.");
    await db
      .update(enrichmentProposals)
      .set({ proposedPatchJson: { text: "" } })
      .where(eq(enrichmentProposals.id, invalidProposal.id));
    const invalidAccept = await updateEnrichmentTask({
      taskId: task.id,
      action: "accept_proposal",
      proposalId: invalidProposal.id,
    });
    expect(invalidAccept).toMatchObject({
      status: "invalid",
      reason: "invalid_proposal_payload",
    });
    const invalidProposalAfterAccept = await db
      .select()
      .from(enrichmentProposals)
      .where(eq(enrichmentProposals.id, invalidProposal.id))
      .limit(1);
    expect(invalidProposalAfterAccept[0]).toMatchObject({
      status: "pending_review",
      committedEvidenceItemId: null,
    });

    await db
      .update(enrichmentProposals)
      .set({
        proposalType: "link_evidence_to_story",
        proposedPatchJson: {
          answer_text: answer,
          expected_outcome: "clarify_assignment",
          needs_user_confirmation: true,
          source_quote: answer,
          status: "pending_review",
          target_summary: "Assign later",
          task_scope: "assign_later",
          text: answer,
        },
        status: "pending_review",
      })
      .where(eq(enrichmentProposals.id, invalidProposal.id));
    const unsupportedAccept = await updateEnrichmentTask({
      taskId: task.id,
      action: "accept_proposal",
      proposalId: invalidProposal.id,
    });
    expect(unsupportedAccept).toMatchObject({
      status: "invalid",
      reason: "unsupported_proposal_type",
    });
    const unsupportedRevise = await updateEnrichmentTask({
      taskId: task.id,
      action: "revise_proposal",
      proposalId: invalidProposal.id,
      revisedText: `${answer} unsupported link proposal should not revise.`,
    });
    expect(unsupportedRevise).toMatchObject({
      status: "invalid",
      reason: "unsupported_proposal_type",
    });
    const unsupportedProposalAfterAccept = await db
      .select()
      .from(enrichmentProposals)
      .where(eq(enrichmentProposals.id, invalidProposal.id))
      .limit(1);
    expect(unsupportedProposalAfterAccept[0]).toMatchObject({
      status: "pending_review",
      committedEvidenceItemId: null,
    });
  });

  it("applies story-context enrichment without creating draft evidence", async () => {
    const db = getDb();
    const workspace = await getCurrentWorkspace(db);
    const [role] = await db
      .insert(workExperiences)
      .values({
        workspaceId: workspace.id,
        employer: `Story Context Co ${crypto.randomUUID()}`,
        roleTitle: "Product Engineer",
      })
      .returning({ id: workExperiences.id });
    if (!role) throw new Error("Expected role.");
    const [initiative] = await db
      .insert(initiatives)
      .values({
        workspaceId: workspace.id,
        workExperienceId: role.id,
        internalTitle: `Checkout instrumentation ${crypto.randomUUID()}`,
        context: "Owned checkout analytics instrumentation.",
      })
      .returning({ id: initiatives.id });
    if (!initiative) throw new Error("Expected initiative.");

    const prompt = `Which techniques are you strongest in today? ${crypto.randomUUID()}`;
    await upsertEnrichmentTasks(db, {
      workspaceId: workspace.id,
      tasks: [
        {
          taskType: "scope",
          sourceType: "resume_review",
          sourceLabel: "Story context smoke",
          prompt,
          targetScope: "story_context",
          expectedOutcome: "update_story",
          initiativeId: initiative.id,
          workExperienceId: role.id,
        },
      ],
    });
    const queue = await getEnrichmentTaskQueue({
      limit: 20,
      sourceType: "resume_review",
      statuses: ["open"],
    });
    expect(queue.status).toBe("ready");
    if (queue.status !== "ready") throw new Error("Expected enrichment queue.");
    const task = queue.tasks.find((item) => item.prompt === prompt);
    if (!task) throw new Error("Expected story-context task.");

    const answer = `Strongest techniques are event taxonomy cleanup, metric definition, and rollout instrumentation ${crypto.randomUUID()}.`;
    const answered = await updateEnrichmentTask({
      taskId: task.id,
      action: "answer",
      userAnswer: answer,
    });
    expect(answered.status).toBe("saved");
    if (answered.status !== "saved") throw new Error("Expected saved answer.");
    const proposal = answered.task.proposals.find(
      (item) => item.status === "pending_review",
    );
    if (!proposal) throw new Error("Expected pending story-context proposal.");
    expect(proposal).toMatchObject({
      proposal_type: "update_initiative",
      target_kind: "initiative",
      target_id: initiative.id,
    });
    expect(proposal.proposed_patch_json).toMatchObject({
      patch_type: "update_initiative",
      context_patch: answer,
      target_id: initiative.id,
      target_kind: "initiative",
    });

    const accepted = await updateEnrichmentTask({
      taskId: task.id,
      action: "accept_proposal",
      proposalId: proposal.id,
    });
    expect(accepted).toMatchObject({
      status: "saved",
      task: { status: "converted" },
      conversionMode: "proposal_commit",
      evidenceCount: 0,
      evidenceItemId: null,
    });
    const evidenceRows = await db.select().from(evidenceItems).where(eq(evidenceItems.text, answer));
    expect(evidenceRows).toHaveLength(0);
    const [updatedInitiative] = await db
      .select()
      .from(initiatives)
      .where(eq(initiatives.id, initiative.id))
      .limit(1);
    expect(updatedInitiative?.context).toContain("Owned checkout analytics instrumentation.");
    expect(updatedInitiative?.context).toContain(answer);
  });

  it("routes unassigned enrichment answers to clarify assignment context", async () => {
    const db = getDb();
    const workspace = await getCurrentWorkspace(db);
    const prompt = `What techniques are strongest today? ${crypto.randomUUID()}`;
    await upsertEnrichmentTasks(db, {
      workspaceId: workspace.id,
      tasks: [
        {
          taskType: "scope",
          sourceType: "user_input",
          sourceLabel: "Clarify assignment smoke",
          prompt,
          targetScope: "assign_later",
          expectedOutcome: "clarify_assignment",
        },
      ],
    });
    const queue = await getEnrichmentTaskQueue({
      limit: 20,
      sourceType: "user_input",
      statuses: ["open"],
    });
    expect(queue.status).toBe("ready");
    if (queue.status !== "ready") throw new Error("Expected enrichment queue.");
    const task = queue.tasks.find((item) => item.prompt === prompt);
    if (!task) throw new Error("Expected clarify-assignment task.");

    const answer = `I am strongest in metric definition and event taxonomy cleanup ${crypto.randomUUID()}.`;
    const answered = await updateEnrichmentTask({
      taskId: task.id,
      action: "answer",
      userAnswer: answer,
    });
    expect(answered.status).toBe("saved");
    if (answered.status !== "saved") throw new Error("Expected saved answer.");
    const proposal = answered.task.proposals.find(
      (item) => item.status === "pending_review",
    );
    if (!proposal) throw new Error("Expected clarify-assignment proposal.");
    expect(proposal).toMatchObject({
      proposal_type: "clarify_assignment",
      target_kind: null,
      target_id: null,
    });
    expect(proposal.proposed_patch_json).toMatchObject({
      patch_type: "clarify_assignment",
      text: answer,
      expected_outcome: "clarify_assignment",
      task_scope: "assign_later",
    });

    const accepted = await updateEnrichmentTask({
      taskId: task.id,
      action: "accept_proposal",
      proposalId: proposal.id,
    });
    expect(accepted).toMatchObject({
      status: "saved",
      task: { status: "converted" },
      conversionMode: "proposal_commit",
      evidenceCount: 0,
      evidenceItemId: null,
    });
    const evidenceRows = await db.select().from(evidenceItems).where(eq(evidenceItems.text, answer));
    expect(evidenceRows).toHaveLength(0);
  });

  it("applies evidence update proposals in place and marks linked claims stale", async () => {
    const db = getDb();
    const workspace = await getCurrentWorkspace(db);
    const now = new Date();
    const [evidence] = await db
      .insert(evidenceItems)
      .values({
        workspaceId: workspace.id,
        text: `Original evidence text ${crypto.randomUUID()}`,
        sourceQuote: "Original source quote.",
        evidenceType: "extracted",
        sensitivityLevel: "private",
        status: "pending",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!evidence) throw new Error("Expected evidence row.");
    await db.insert(generatedClaims).values({
      workspaceId: workspace.id,
      claimText: "Original generated claim.",
      section: "experience",
      evidenceIds: [evidence.id],
      sourceQuotes: [evidence.sourceQuote],
      supportStatus: "supported",
      claimStatus: "supported",
      riskLevel: "low",
      lastValidatedAt: now,
      createdAt: now,
    });

    const prompt = `Can you add more specific detail to this evidence? ${crypto.randomUUID()}`;
    await upsertEnrichmentTasks(db, {
      workspaceId: workspace.id,
      tasks: [
        {
          taskType: "scope",
          sourceType: "resume_review",
          sourceLabel: "Evidence patch smoke",
          prompt,
          targetScope: "evidence_detail",
          expectedOutcome: "update_evidence",
          evidenceItemId: evidence.id,
        },
      ],
    });
    const queue = await getEnrichmentTaskQueue({
      limit: 20,
      sourceType: "resume_review",
      statuses: ["open"],
    });
    expect(queue.status).toBe("ready");
    if (queue.status !== "ready") throw new Error("Expected enrichment queue.");
    const task = queue.tasks.find((item) => item.prompt === prompt);
    if (!task) throw new Error("Expected evidence-update task.");

    const answer = `Updated evidence text with specific rollout details ${crypto.randomUUID()}.`;
    const answered = await updateEnrichmentTask({
      taskId: task.id,
      action: "answer",
      userAnswer: answer,
    });
    expect(answered.status).toBe("saved");
    if (answered.status !== "saved") throw new Error("Expected saved answer.");
    const proposal = answered.task.proposals.find(
      (item) => item.status === "pending_review",
    );
    if (!proposal) throw new Error("Expected evidence-update proposal.");
    expect(proposal).toMatchObject({
      proposal_type: "update_evidence",
      target_kind: "evidence",
      target_id: evidence.id,
    });
    expect(proposal.proposed_patch_json).toMatchObject({
      patch_type: "update_evidence",
      evidence_id: evidence.id,
      source_quote_patch: answer,
    });
    expect(proposal.proposed_patch_json).not.toHaveProperty("text_patch");

    const accepted = await updateEnrichmentTask({
      taskId: task.id,
      action: "accept_proposal",
      proposalId: proposal.id,
    });
    expect(accepted).toMatchObject({
      status: "saved",
      task: { status: "converted" },
      conversionMode: "proposal_commit",
      evidenceCount: 0,
      evidenceItemId: evidence.id,
    });
    const evidenceRows = await db
      .select()
      .from(evidenceItems)
      .where(eq(evidenceItems.id, evidence.id));
    expect(evidenceRows[0]?.text).toBe(evidence.text);
    expect(evidenceRows[0]?.sourceQuote).toBe(answer);
    const duplicateRows = await db.select().from(evidenceItems).where(eq(evidenceItems.text, answer));
    expect(duplicateRows).toHaveLength(0);
    const claimRows = await db
      .select()
      .from(generatedClaims)
      .where(eq(generatedClaims.workspaceId, workspace.id));
    const staleClaim = claimRows.find((claim) => claim.evidenceIds.includes(evidence.id));
    expect(staleClaim).toMatchObject({
      claimStatus: "stale",
      staleReason: "Evidence text or summary was updated.",
      lastValidatedAt: null,
    });
  });

  it("reconciles same-source resume review enrichment tasks to extracted library items", async () => {
    const db = getDb();
    const workspace = await getCurrentWorkspace(db);
    const uniqueText = `${sampleSourceText}\nReconcile smoke ${Date.now()} ${crypto.randomUUID()}`;
    const contentHash = crypto.createHash("sha256").update(uniqueText).digest("hex");
    const [sourceDocument] = await db
      .insert(sourceDocuments)
      .values({
        workspaceId: workspace.id,
        sourceType: "resume-review",
        title: "Reconcile resume",
        contentText: uniqueText,
        contentHash,
        lifecycleStatus: "reviewed",
      })
      .returning();
    expect(sourceDocument).toBeDefined();
    if (!sourceDocument) throw new Error("Expected source document.");
    const [resumeSource] = await db
      .insert(resumeSourceVersions)
      .values({
        workspaceId: workspace.id,
        sourceDocumentId: sourceDocument.id,
        title: "Reconcile resume",
        contentHash,
        sourceKind: "text",
        sourceText: uniqueText,
        status: "reviewed",
      })
      .returning();
    expect(resumeSource).toBeDefined();
    if (!resumeSource) throw new Error("Expected resume source.");
    const prompt = `Add concrete SQL dashboard metric ${crypto.randomUUID()}`;
    await upsertEnrichmentTasks(db, {
      workspaceId: workspace.id,
      tasks: [
        {
          taskType: "metric",
          sourceType: "resume_review",
          sourceLabel: "Reconcile resume review",
          prompt,
          resumeSourceVersionId: resumeSource.id,
        },
      ],
    });

    const result = await persistProfileEvidenceExtraction({
      sourceDocumentId: sourceDocument.id,
      sourceText: uniqueText,
      extraction: buildExtraction(),
      provider: "integration-test",
      model: "test-model",
      usage: { totalTokens: 42 },
      retryCount: 0,
      skill: skillRegistry.profileEvidenceExtractionResume,
    });
    expect(result.status).toBe("saved");
    if (result.status !== "saved") throw new Error("Expected saved extraction.");

    const queue = await getEnrichmentTaskQueue({
      limit: 20,
      resumeSourceVersionId: resumeSource.id,
      statuses: ["open", "answered"],
    });
    expect(queue.status).toBe("ready");
    if (queue.status !== "ready") throw new Error("Expected enrichment queue.");
    const task = queue.tasks.find((item) => item.prompt === prompt);
    expect(task?.evidence_item_id).toBeTruthy();
    expect(task).toMatchObject({
      target_scope: "evidence_detail",
      expected_outcome: "update_evidence",
    });
    expect(task?.targets.some((target) => target.target_kind === "evidence")).toBe(true);

    const [alternateEvidence] = await db
      .select()
      .from(evidenceItems)
      .where(eq(evidenceItems.sourceDocumentId, result.sourceDocumentId))
      .limit(1);
    if (!task || !alternateEvidence) throw new Error("Expected task and evidence.");
    const linked = await updateEnrichmentTask({
      action: "link",
      anchor: { evidenceItemId: alternateEvidence.id },
      taskId: task.id,
    });
    expect(linked).toMatchObject({
      status: "saved",
      task: {
        evidence_item_id: alternateEvidence.id,
        target_scope: "evidence_detail",
      },
    });
    if (linked.status !== "saved") throw new Error("Expected linked task.");
    expect(
      linked.task.targets.some(
        (target) =>
          target.target_kind === "evidence" &&
          target.target_id === alternateEvidence.id &&
          target.target_role === "primary",
      ),
    ).toBe(true);
    const persistedTargets = await db
      .select()
      .from(enrichmentTaskTargets)
      .where(eq(enrichmentTaskTargets.taskId, task.id));
    expect(persistedTargets).toHaveLength(1);
    expect(persistedTargets[0]).toMatchObject({
      targetKind: "evidence",
      targetId: alternateEvidence.id,
      targetRole: "primary",
    });
  });

  it("merges initiative story targets and moves linked evidence", async () => {
    const db = getDb();
    const workspace = await getCurrentWorkspace(db);
    const now = new Date();
    const [experience] = await db
      .insert(workExperiences)
      .values({
        workspaceId: workspace.id,
        employer: `Nimbus ${crypto.randomUUID()}`,
        roleTitle: "Software Development Engineer Intern",
        status: "pending",
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: workExperiences.id });
    if (!experience) throw new Error("Expected work experience.");
    const [wrongExperience] = await db
      .insert(workExperiences)
      .values({
        workspaceId: workspace.id,
        employer: `Wrong role ${crypto.randomUUID()}`,
        roleTitle: "Infrastructure Intern",
        status: "pending",
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: workExperiences.id });
    if (!wrongExperience) throw new Error("Expected wrong work experience.");

    const createdInitiatives = await db
      .insert(initiatives)
      .values([
        {
          workspaceId: workspace.id,
          workExperienceId: experience.id,
          internalTitle: "Distributed cache infrastructure for session latency",
          externalSafeTitle: "Distributed cache infrastructure",
          context: "High-scale session service",
          problem: "Session lookup latency",
          actions: ["Provisioned distributed cache infrastructure"],
          results: ["Reduced p95 latency"],
          metrics: [{ value: "p95 420 ms to 180 ms" }],
          technologies: ["distributed cache"],
          stakeholders: [],
          sensitivityLevel: "private",
          needsRedactionReview: 1,
          status: "approved",
          createdAt: now,
          updatedAt: now,
        },
        {
          workspaceId: workspace.id,
          workExperienceId: wrongExperience.id,
          internalTitle: "AWS CDK provisioning",
          externalSafeTitle: "AWS CDK provisioning",
          context: "Cache infrastructure",
          actions: ["Built AWS CDK deployment path"],
          results: [],
          metrics: [],
          technologies: ["AWS CDK"],
          stakeholders: [],
          sensitivityLevel: "private",
          needsRedactionReview: 0,
          status: "pending",
          createdAt: now,
          updatedAt: now,
        },
        {
          workspaceId: workspace.id,
          workExperienceId: experience.id,
          internalTitle: "Session latency optimization",
          externalSafeTitle: "Session latency optimization",
          context: "Session dependency path",
          actions: ["Integrated cache into session dependency path"],
          results: ["Improved session lookup latency"],
          metrics: [],
          technologies: ["session cache"],
          stakeholders: [],
          sensitivityLevel: "private",
          needsRedactionReview: 0,
          status: "pending",
          createdAt: now,
          updatedAt: now,
        },
      ])
      .returning({ id: initiatives.id });
    const [primary, duplicateA, duplicateB] = createdInitiatives;
    if (!primary || !duplicateA || !duplicateB) throw new Error("Expected initiatives.");

    const evidenceRows = await db
      .insert(evidenceItems)
      .values([
        {
          workspaceId: workspace.id,
          text: "Provisioned distributed cache infrastructure.",
          sourceQuote: "Provisioned distributed cache infrastructure.",
          evidenceType: "extracted",
          sensitivityLevel: "private",
          relatedInitiativeId: primary.id,
          status: "pending",
          createdAt: now,
          updatedAt: now,
        },
        {
          workspaceId: workspace.id,
          text: "Built AWS CDK deployment path.",
          sourceQuote: "Built AWS CDK deployment path.",
          evidenceType: "extracted",
          sensitivityLevel: "private",
          relatedInitiativeId: duplicateA.id,
          status: "pending",
          createdAt: now,
          updatedAt: now,
        },
        {
          workspaceId: workspace.id,
          text: "Integrated cache into session dependency path.",
          sourceQuote: "Integrated cache into session dependency path.",
          evidenceType: "extracted",
          sensitivityLevel: "private",
          relatedInitiativeId: duplicateB.id,
          status: "pending",
          createdAt: now,
          updatedAt: now,
        },
      ])
      .returning({ id: evidenceItems.id });
    const duplicateEvidenceIds = evidenceRows.slice(1).map((item) => item.id);
    await db.insert(generatedClaims).values({
      workspaceId: workspace.id,
      claimText: "Built AWS CDK cache infrastructure.",
      section: "experience",
      evidenceIds: [duplicateEvidenceIds[0]!],
      sourceQuotes: ["Built AWS CDK deployment path."],
      supportStatus: "supported",
      claimStatus: "supported",
      riskLevel: "low",
      lastValidatedAt: now,
      createdAt: now,
    });

    const merge = await mergeStoryTargets({
      storyType: "initiative",
      primaryStoryId: primary.id,
      duplicateStoryIds: [duplicateA.id, duplicateB.id],
    });
    expect(merge).toMatchObject({
      status: "merged",
      primaryStoryId: primary.id,
      duplicateStoryCount: 2,
      movedEvidenceCount: 2,
      staleClaimCount: 1,
    });

    const initiativeRows = await db
      .select()
      .from(initiatives)
      .where(eq(initiatives.workspaceId, workspace.id));
    const updatedPrimary = initiativeRows.find((initiative) => initiative.id === primary.id);
    expect(updatedPrimary?.actions).toEqual(
      expect.arrayContaining([
        "Provisioned distributed cache infrastructure",
        "Built AWS CDK deployment path",
        "Integrated cache into session dependency path",
      ]),
    );
    expect(updatedPrimary?.technologies).toEqual(
      expect.arrayContaining(["distributed cache", "AWS CDK", "session cache"]),
    );
    expect(updatedPrimary).toMatchObject({
      status: "approved",
      workExperienceId: experience.id,
    });
    expect(
      initiativeRows
        .filter((initiative) => [duplicateA.id, duplicateB.id].includes(initiative.id))
        .every((initiative) => initiative.status === "rejected"),
    ).toBe(true);

    const movedEvidence = await db
      .select()
      .from(evidenceItems)
      .where(eq(evidenceItems.workspaceId, workspace.id));
    expect(
      movedEvidence
        .filter((item) => evidenceRows.map((evidence) => evidence.id).includes(item.id))
        .every((item) => item.relatedInitiativeId === primary.id),
    ).toBe(true);
    const claims = await db
      .select()
      .from(generatedClaims)
      .where(eq(generatedClaims.workspaceId, workspace.id));
    expect(claims.some((claim) => claim.claimStatus === "stale")).toBe(true);
  }, 20_000);
});

const duplicateSourceText = [
  "Jane Doe",
  "Built SQL dashboards for onboarding funnel analysis.",
].join("\n");

const sampleSourceText = [
  "Jane Doe",
  "Senior Product Analyst at Acme Finance, 2019 - Present",
  "Built SQL dashboards for onboarding funnel analysis.",
  "Led experimentation readouts for three product teams.",
  "Partnered with product managers to define activation metrics.",
].join("\n");

const projectDuplicateSourceText = [
  "Activation dashboard",
  "Mapped onboarding activation funnel events with SQL.",
  "Mapped onboarding funnel steps and dashboard slices.",
  "Identified onboarding drop-off and prioritized follow-up activation experiments.",
].join("\n");

function buildExtraction(): ProfileEvidenceExtraction {
  return {
    profile: {
      name: simpleField("Jane Doe", "Jane Doe", 0.95),
      email: null,
      phone: null,
      location: null,
      links: [],
      education: [],
      experience: [
        {
          employer: {
            ...simpleField(
              "Acme Finance",
              "Senior Product Analyst at Acme Finance, 2019 - Present",
              0.9,
            ),
          },
          title: {
            ...simpleField(
              "Senior Product Analyst",
              "Senior Product Analyst at Acme Finance, 2019 - Present",
              0.9,
            ),
          },
          start_date: {
            ...simpleField("2019", "2019 - Present", 0.8),
          },
          end_date: {
            ...simpleField("Present", "2019 - Present", 0.8),
          },
          bullets: [],
        },
      ],
      skills: [
        {
          ...simpleField(
            "SQL",
            "Built SQL dashboards for onboarding funnel analysis.",
            0.9,
          ),
        },
      ],
      certifications: [],
      missing_fields: ["contact.email"],
      low_confidence_fields: [],
      invented_field_flags: [],
    },
    work_experiences: [],
    initiatives: [],
    portfolio_projects: [
      {
        title: "Onboarding analytics",
        project_type: "personal_project",
        external_safe_title: "Onboarding analytics",
        context: "Onboarding funnel analysis.",
        problem: null,
        role: "Senior Product Analyst",
        actions: ["Built SQL dashboards."],
        results: [],
        metrics: [],
        technologies: ["SQL"],
        stakeholders: ["product teams"],
        external_safe_summary: null,
        sensitivity_level: "private",
        needs_redaction_review: false,
        status: "pending",
      },
    ],
    evidence_items: [
      {
        text: "Built SQL dashboards for onboarding funnel analysis.",
        source_quote: "Built SQL dashboards for onboarding funnel analysis.",
        evidence_type: "extracted",
        metrics: [],
        sensitivity_level: "private",
        allowed_usage: ["resume", "interview"],
        public_safe_summary: null,
        status: "pending",
        related_project_id: null,
        related_portfolio_project_id: "Onboarding analytics",
        needs_user_confirmation: false,
      },
      {
        text: "Led experimentation readouts for three product teams.",
        source_quote: "Led experimentation readouts for three product teams.",
        evidence_type: "extracted",
        metrics: [{ value: "three product teams", source_quote: "three product teams" }],
        sensitivity_level: "private",
        allowed_usage: ["interview"],
        public_safe_summary: null,
        status: "pending",
        related_project_id: null,
        needs_user_confirmation: false,
      },
      {
        text: "Inferred ownership of activation metrics.",
        source_quote: "Partnered with product managers to define activation metrics.",
        evidence_type: "inferred",
        metrics: [{ value: "25%", source_quote: "activation metrics" }],
        sensitivity_level: "private",
        allowed_usage: [],
        public_safe_summary: null,
        status: "pending",
        related_project_id: null,
        needs_user_confirmation: false,
      },
      {
        text: "Internal-only stakeholder reporting should not leave the system.",
        source_quote: "Led experimentation readouts for three product teams.",
        evidence_type: "extracted",
        metrics: [],
        sensitivity_level: "private",
        allowed_usage: ["resume", "internal_only"],
        public_safe_summary: null,
        status: "pending",
        related_project_id: null,
        needs_user_confirmation: false,
      },
      {
        text: "Sensitive finance dashboard should not be used for resumes.",
        source_quote: "Built SQL dashboards for onboarding funnel analysis.",
        evidence_type: "extracted",
        metrics: [],
        sensitivity_level: "sensitive",
        allowed_usage: ["resume"],
        public_safe_summary: null,
        status: "pending",
        related_project_id: null,
        needs_user_confirmation: false,
      },
    ],
    project_cards: [
      {
        title: "Onboarding analytics",
        context: "Onboarding funnel analysis.",
        problem: null,
        role: "Senior Product Analyst",
        actions: ["Built SQL dashboards."],
        results: [],
        metrics: [],
        technologies: ["SQL"],
        stakeholders: ["product teams"],
        public_safe_summary: null,
        sensitivity_level: "private",
        status: "pending",
      },
    ],
    extraction_notes: ["Add a concrete activation metric for the onboarding analytics story."],
  };
}

function simpleField(
  value: string,
  sourceQuote: string,
  confidence: number,
) {
  return {
    value,
    source_quote: sourceQuote,
    confidence,
  };
}


function buildDuplicateExtraction(text: string): ProfileEvidenceExtraction {
  return {
    profile: {
      name: simpleField("Jane Doe", "Jane Doe", 0.95),
      email: null,
      phone: null,
      location: null,
      links: [],
      education: [],
      experience: [],
      skills: [],
      certifications: [],
      missing_fields: [],
      low_confidence_fields: [],
      invented_field_flags: [],
    },
    work_experiences: [],
    initiatives: [],
    portfolio_projects: [],
    evidence_items: [
      {
        text,
        source_quote: "Built SQL dashboards for onboarding funnel analysis.",
        evidence_type: "extracted",
        metrics: [],
        sensitivity_level: "private",
        allowed_usage: ["resume"],
        public_safe_summary: null,
        status: "pending",
        related_project_id: null,
        needs_user_confirmation: false,
      },
    ],
    project_cards: [],
    extraction_notes: [],
  };
}

function buildProjectDuplicateExtraction(args: {
  action: string;
  evidence: string;
  result: string;
  title: string;
}): ProfileEvidenceExtraction {
  return {
    profile: {
      name: simpleField("Jane Doe", "Jane Doe", 0.95),
      email: null,
      phone: null,
      location: null,
      links: [],
      education: [],
      experience: [],
      skills: [],
      certifications: [],
      missing_fields: [],
      low_confidence_fields: [],
      invented_field_flags: [],
    },
    work_experiences: [],
    initiatives: [],
    portfolio_projects: [],
    evidence_items: [
      {
        text: args.evidence,
        source_quote: args.evidence,
        evidence_type: "extracted",
        metrics: [],
        sensitivity_level: "private",
        allowed_usage: ["resume", "interview"],
        public_safe_summary: null,
        status: "pending",
        related_project_id: args.title,
        needs_user_confirmation: false,
      },
    ],
    project_cards: [
      {
        title: args.title,
        context: "Onboarding activation dashboard work.",
        problem: "Teams could not see onboarding drop-off clearly.",
        role: "Product analyst",
        actions: [args.action],
        results: [args.result],
        metrics: [],
        technologies: ["SQL", "Dashboard"],
        stakeholders: ["product teams"],
        public_safe_summary: null,
        sensitivity_level: "private",
        status: "pending",
      },
    ],
    extraction_notes: [],
  };
}
