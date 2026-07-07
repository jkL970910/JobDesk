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
  enrichmentTasks,
  enrichmentTaskTargets,
  evidenceItems,
  generatedClaims,
  initiatives,
  portfolioProjects,
  profileContextAnswers,
  profileFactHistory,
  profiles,
  resumeSourceVersions,
  sourceCleanupEvents,
  sourceDocuments,
  workExperiences,
} from "../src/db/schema";
import {
  getEvidenceDedupeCandidates,
  getProjectDedupeCandidates,
  getRecentEvidenceLibrary,
  getResumeTailoringContext,
  getStarStoryBank,
  deleteEvidenceItem,
  keepEvidenceOverlapSeparate,
  keepProjectOverlapSeparate,
  mergeEvidenceItems,
  mergeProjectCards,
  mergeStoryTargets,
  persistProfileEvidenceExtraction,
  updateEvidenceItem,
  updateProfileFacts,
  reviewWorkExperience,
  updateStoryTargetReview,
  updateWorkExperienceFields,
} from "../src/server/profile-evidence-repository";
import type { ProfileEvidenceExtraction } from "../src/schemas/profile-evidence-extraction";
import { skillRegistry } from "../src/ai/skills-registry";
import { expectWorkflowRunMetadata } from "./helpers/workflow-run-assertions";
import { desc, eq } from "drizzle-orm";
import { getCurrentWorkspace } from "../src/server/workspace-repository";
import { getProfilePositioningContext } from "../src/server/profile-positioning-repository";
import { registerUser, runWithAuthContext } from "../src/server/auth-service";
import {
  applyEvidenceAssetAction,
  quarantineEvidenceAsset,
} from "../src/server/evidence-asset-actions";

const runIntegration = process.env.JOBDESK_RUN_DB_INTEGRATION === "true";

describe.skipIf(!runIntegration)("profile evidence repository integration", { timeout: 45_000 }, () => {
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
    expect(metricAnswered).toMatchObject({
      status: "invalid",
      reason: "target_required",
    });
    const [portfolioTarget] = await getDb()
      .select({ id: portfolioProjects.id })
      .from(portfolioProjects)
      .where(eq(portfolioProjects.sourceDocumentId, result.sourceDocumentId))
      .limit(1);
    expect(portfolioTarget?.id).toBeDefined();
    const metricLinked = await updateEnrichmentTask({
      taskId: metricTask.id,
      action: "link",
      anchor: { portfolioProjectId: portfolioTarget!.id },
    });
    expect(metricLinked.status).toBe("saved");
    const metricAnsweredAfterLink = await updateEnrichmentTask({
      taskId: metricTask.id,
      action: "answer",
      userAnswer: "Improved activation by 12% across three onboarding cohorts.",
    });
    expect(metricAnsweredAfterLink.status).toBe("saved");
    if (metricAnsweredAfterLink.status !== "saved") throw new Error("Expected metric answer saved.");
    const metricProposal = metricAnsweredAfterLink.task.proposals.find(
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
      expected_outcome: "route_answer",
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
      status: "saved",
      conversionMode: "ai_extraction",
      evidenceCount: 1,
    });
    const aiEvidence = await getDb()
      .select()
      .from(evidenceItems)
      .where(eq(evidenceItems.sourceQuote, aiAnswer));
    expect(aiEvidence).toHaveLength(1);
    expect(aiEvidence[0]).toMatchObject({
      allowedUsage: ["resume", "interview"],
      evidenceType: "extracted",
      needsUserConfirmation: 1,
      sourceQuote: aiAnswer,
      status: "pending",
    });
    expect(aiEvidence[0]?.metrics).toEqual([
      { value: "12%", source_quote: "Increased onboarding activation by 12%" },
    ]);
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
      status: "converted",
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

  it("keeps Work Experience persistence high-level and rejects bullet-shaped role containers", async () => {
    const sourceTitle = `Work experience sanitizer ${crypto.randomUUID()}`;
    const base = buildExtraction();
    const extraction: ProfileEvidenceExtraction = {
      ...base,
      profile: {
        ...base.profile,
        experience: [
          {
            employer: simpleField("Amazon", "Amazon", 0.9),
            title: simpleField("Software Engineer", "Software Engineer", 0.9),
            start_date: simpleField("Jan 2022", "Jan 2022", 0.8),
            end_date: simpleField("Present", "Present", 0.8),
            bullets: [
              simpleField(
                "Built a long platform migration story that should become initiative/evidence material, not Work Experience summary.",
                "Built a long platform migration story that should become initiative/evidence material, not Work Experience summary.",
                0.8,
              ),
            ],
          },
        ],
      },
      work_experiences: [
        {
          employer: "Amazon",
          role_title: "Software Engineer",
          team: null,
          location: "Toronto",
          start_date: "Jan 2022",
          end_date: "Present",
          summary: "Built platform workflows that improved operations reliability across multiple launch teams.",
          status: "pending",
        },
        {
          employer: "Worked on a visualization platform with a long paragraph that came from a resume bullet.",
          role_title: "Worked on a visualization platform with a long paragraph that came from a resume bullet.",
          team: null,
          location: null,
          start_date: null,
          end_date: null,
          summary: "This should be quarantined because it is not an employer or role container.",
          status: "pending",
        },
      ],
    };
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

    expect(result.status).toBe("saved");
    if (result.status !== "saved") throw new Error("Expected saved profile evidence.");
    const saved = await getDb()
      .select({
        employer: workExperiences.employer,
        roleTitle: workExperiences.roleTitle,
        summary: workExperiences.summary,
      })
      .from(workExperiences)
      .where(eq(workExperiences.sourceDocumentId, result.sourceDocumentId));

    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      employer: "Amazon",
      roleTitle: "Software Engineer",
      summary: null,
    });
  });

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
      evidence_type: "user_confirmed",
      status: "pending",
    });
    expect(String(answered.task.proposals[0]?.proposed_patch_json.text)).toContain(
      "Reduced manual QA review by 18 hours per week",
    );

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
    const evidenceItemId = accepted.evidenceItemId as string;
    const [evidence] = await db
      .select()
      .from(evidenceItems)
      .where(eq(evidenceItems.id, evidenceItemId))
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
    expect(answered).toMatchObject({
      status: "invalid",
      reason: "target_required",
    });

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
      target_id: role.id,
      target_kind: "work_experience",
    });
    expect(String(linkedProposal.proposed_patch_json.summary_patch ?? "")).toContain(
      "activation",
    );

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
      limit: 200,
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
      target_id: initiative.id,
      target_kind: "initiative",
    });
    expect(String(proposal.proposed_patch_json.context_patch)).toContain("event taxonomy cleanup");
    expect(String(proposal.proposed_patch_json.context_patch)).toContain("metric definition");
    expect(String(proposal.proposed_patch_json.context_patch)).toContain("rollout instrumentation");

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
    expect(updatedInitiative?.context).toContain("event taxonomy cleanup");
    expect(updatedInitiative?.context).toContain("metric definition");
    expect(updatedInitiative?.context).toContain("rollout instrumentation");
  });

  it("saves profile context answers without creating evidence or proposals", async () => {
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
          targetScope: "profile_context",
          expectedOutcome: "save_profile_answer",
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
    if (!task) throw new Error("Expected profile-context task.");

    const answer = `I am strongest in metric definition and event taxonomy cleanup ${crypto.randomUUID()}.`;
    const answered = await updateEnrichmentTask({
      taskId: task.id,
      action: "answer",
      userAnswer: answer,
    });
    expect(answered.status).toBe("saved");
    if (answered.status !== "saved") throw new Error("Expected saved answer.");
    expect(answered.task).toMatchObject({
      status: "converted",
      resolution_kind: "profile_answer_saved",
    });
    expect(answered.task.proposals).toHaveLength(0);
    const evidenceRows = await db.select().from(evidenceItems).where(eq(evidenceItems.text, answer));
    expect(evidenceRows).toHaveLength(0);
    const contextRows = await db
      .select()
      .from(profileContextAnswers)
      .where(eq(profileContextAnswers.sourceTaskId, task.id));
    expect(contextRows).toHaveLength(1);
    expect(contextRows[0]).toMatchObject({
      answerText: answer,
      contextType: "skills_to_emphasize",
      status: "active",
    });
    expect(contextRows[0]?.sourceAnswerId).toBeTruthy();
    const linkedAnswers = await db
      .select()
      .from(enrichmentAnswers)
      .where(eq(enrichmentAnswers.id, contextRows[0]?.sourceAnswerId ?? ""));
    expect(linkedAnswers).toHaveLength(1);
    expect(linkedAnswers[0]).toMatchObject({
      answerText: answer,
      answerStatus: "applied",
      taskId: task.id,
    });
    const positioningContext = await getProfilePositioningContext();
    expect(
      positioningContext.profileContextAnswers.some(
        (item) => item.id === contextRows[0]?.id && item.answerText === answer,
      ),
    ).toBe(true);
    const resumeContext = await getResumeTailoringContext();
    expect(resumeContext.evidenceItems.some((item) => item.text === answer)).toBe(false);
    expect(resumeContext).not.toHaveProperty("profileContextAnswers");
    expect(resumeContext).not.toHaveProperty("profile_context_answers");
  });

  it("can route an assign-later answer to profile context without targets or proposals", async () => {
    const db = getDb();
    const workspace = await getCurrentWorkspace(db);
    const prompt = `Which future role direction should be emphasized? ${crypto.randomUUID()}`;
    await upsertEnrichmentTasks(db, {
      workspaceId: workspace.id,
      tasks: [
        {
          taskType: "scope",
          sourceType: "user_input",
          sourceLabel: "Route answer smoke",
          prompt,
          targetScope: "assign_later",
          expectedOutcome: "route_answer",
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
    if (!task) throw new Error("Expected route-answer task.");

    const answer = `Prioritize backend platform roles with distributed systems ownership ${crypto.randomUUID()}.`;
    const saved = await updateEnrichmentTask({
      taskId: task.id,
      action: "save_profile_context",
      userAnswer: answer,
    });
    expect(saved.status).toBe("saved");
    if (saved.status !== "saved") throw new Error("Expected saved profile route.");
    expect(saved.task).toMatchObject({
      evidence_item_id: null,
      expected_outcome: "save_profile_answer",
      resolution_kind: "profile_answer_saved",
      status: "converted",
      target_scope: "profile_context",
    });
    expect(saved.task.proposals).toHaveLength(0);
    expect(saved.task.targets).toHaveLength(0);
    const evidenceRows = await db.select().from(evidenceItems).where(eq(evidenceItems.text, answer));
    expect(evidenceRows).toHaveLength(0);
    const proposalRows = await db
      .select()
      .from(enrichmentProposals)
      .where(eq(enrichmentProposals.taskId, task.id));
    expect(proposalRows).toHaveLength(0);
    const contextRows = await db
      .select()
      .from(profileContextAnswers)
      .where(eq(profileContextAnswers.sourceTaskId, task.id));
    expect(contextRows).toHaveLength(1);
    expect(contextRows[0]).toMatchObject({
      answerText: answer,
      contextType: "target_role_preference",
      status: "active",
    });
  });

  it("rejects profile-context saving for already confirmed library targets", async () => {
    const db = getDb();
    const workspace = await getCurrentWorkspace(db);
    const [evidence] = await db
      .insert(evidenceItems)
      .values({
        workspaceId: workspace.id,
        text: `Confirmed target evidence ${crypto.randomUUID()}`,
        sourceQuote: "Confirmed target source.",
        evidenceType: "extracted",
        sensitivityLevel: "private",
        status: "pending",
      })
      .returning({ id: evidenceItems.id });
    if (!evidence) throw new Error("Expected evidence.");
    const prompt = `Strengthen confirmed evidence ${crypto.randomUUID()}`;
    await upsertEnrichmentTasks(db, {
      workspaceId: workspace.id,
      tasks: [
        {
          evidenceItemId: evidence.id,
          expectedOutcome: "update_evidence",
          prompt,
          sourceLabel: "Confirmed target smoke",
          sourceType: "user_input",
          targetScope: "evidence_detail",
          taskType: "impact",
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
    if (!task) throw new Error("Expected anchored evidence task.");

    const saved = await updateEnrichmentTask({
      taskId: task.id,
      action: "save_profile_context",
      userAnswer: `This should not become profile context ${crypto.randomUUID()}.`,
    });
    expect(saved).toMatchObject({
      status: "invalid",
      reason: "unsupported_profile_context_route",
    });
  });

  it("requires confirmed targets before story or role update proposals", async () => {
    const db = getDb();
    const workspace = await getCurrentWorkspace(db);
    const storyPrompt = `Story update needs target ${crypto.randomUUID()}`;
    const rolePrompt = `Role update needs target ${crypto.randomUUID()}`;
    await upsertEnrichmentTasks(db, {
      workspaceId: workspace.id,
      tasks: [
        {
          expectedOutcome: "update_story",
          prompt: storyPrompt,
          sourceLabel: "Target guard smoke",
          sourceType: "user_input",
          targetScope: "story_context",
          taskType: "impact",
        },
        {
          expectedOutcome: "update_role",
          prompt: rolePrompt,
          sourceLabel: "Target guard smoke",
          sourceType: "user_input",
          targetScope: "role_context",
          taskType: "scope",
        },
      ],
    });
    const queue = await getEnrichmentTaskQueue({
      limit: 30,
      sourceType: "user_input",
      statuses: ["open"],
    });
    expect(queue.status).toBe("ready");
    if (queue.status !== "ready") throw new Error("Expected enrichment queue.");
    const storyTask = queue.tasks.find((item) => item.prompt === storyPrompt);
    const roleTask = queue.tasks.find((item) => item.prompt === rolePrompt);
    if (!storyTask || !roleTask) throw new Error("Expected target guard tasks.");

    const storyAnswer = await updateEnrichmentTask({
      taskId: storyTask.id,
      action: "answer",
      userAnswer: `Owned launch instrumentation ${crypto.randomUUID()}.`,
    });
    expect(storyAnswer).toMatchObject({
      status: "invalid",
      reason: "target_required",
    });
    const roleAnswer = await updateEnrichmentTask({
      taskId: roleTask.id,
      action: "answer",
      userAnswer: `Led platform analytics scope ${crypto.randomUUID()}.`,
    });
    expect(roleAnswer).toMatchObject({
      status: "invalid",
      reason: "target_required",
    });
  });

  it("resolves imported notes as reviewed, rerun requested, or converted to enrichment questions", async () => {
    const db = getDb();
    const workspace = await getCurrentWorkspace(db);
    const reviewedPrompt = `Full details beyond first four roles should be reviewed ${crypto.randomUUID()}.`;
    const rerunPrompt = `Returned at most four work experiences and may need rerun ${crypto.randomUUID()}.`;
    const convertPrompt = `Clarify project impact from imported note ${crypto.randomUUID()}.`;
    await upsertEnrichmentTasks(db, {
      workspaceId: workspace.id,
      tasks: [
        {
          taskType: "source_section_review",
          sourceType: "extraction_note",
          sourceLabel: "Resume import",
          prompt: reviewedPrompt,
          targetScope: "source_material",
          expectedOutcome: "review_imported_material",
          noteKind: "import_review",
          expectedAction: "review_import",
        },
        {
          taskType: "source_section_review",
          sourceType: "extraction_note",
          sourceLabel: "Resume import",
          prompt: rerunPrompt,
          targetScope: "source_material",
          expectedOutcome: "review_imported_material",
          noteKind: "extraction_limit",
          expectedAction: "rerun_extraction",
        },
        {
          taskType: "source_section_review",
          sourceType: "extraction_note",
          sourceLabel: "Resume import",
          prompt: convertPrompt,
          targetScope: "source_material",
          expectedOutcome: "review_imported_material",
          noteKind: "import_review",
          expectedAction: "review_import",
        },
      ],
    });
    const queue = await getEnrichmentTaskQueue({
      limit: 50,
      sourceType: "extraction_note",
      statuses: ["open"],
    });
    expect(queue.status).toBe("ready");
    if (queue.status !== "ready") throw new Error("Expected enrichment queue.");
    const reviewedTask = queue.tasks.find((item) => item.prompt === reviewedPrompt);
    const rerunTask = queue.tasks.find((item) => item.prompt === rerunPrompt);
    const convertTask = queue.tasks.find((item) => item.prompt === convertPrompt);
    if (!reviewedTask || !rerunTask || !convertTask) {
      throw new Error("Expected imported note tasks.");
    }

    const reviewed = await updateEnrichmentTask({
      taskId: reviewedTask.id,
      action: "mark_import_reviewed",
    });
    expect(reviewed.status).toBe("saved");
    if (reviewed.status !== "saved") throw new Error("Expected reviewed task update.");
    expect(reviewed.task).toMatchObject({
      status: "converted",
      resolution_kind: "import_reviewed",
    });

    const rerun = await updateEnrichmentTask({
      taskId: rerunTask.id,
      action: "request_rerun",
    });
    expect(rerun.status).toBe("saved");
    if (rerun.status !== "saved") throw new Error("Expected rerun task update.");
    expect(rerun.task).toMatchObject({
      status: "converted",
      resolution_kind: "rerun_requested",
    });

    const converted = await updateEnrichmentTask({
      taskId: convertTask.id,
      action: "convert_to_enrichment_question",
    });
    expect(converted.status).toBe("saved");
    if (converted.status !== "saved") throw new Error("Expected converted task update.");
    expect(converted.task).toMatchObject({
      status: "open",
      source_type: "extraction_note",
      target_scope: "assign_later",
      expected_outcome: "route_answer",
      note_kind: null,
      expected_action: null,
      resolvedAt: null,
      resolution_kind: null,
    });
    expect(converted.task.task_type).not.toBe("source_section_review");
    expect(converted.task.proposals).toHaveLength(0);

    const ordinaryPrompt = `Ordinary evidence question ${crypto.randomUUID()}.`;
    await upsertEnrichmentTasks(db, {
      workspaceId: workspace.id,
      tasks: [
        {
          taskType: "metric",
          sourceType: "resume_review",
          sourceLabel: "Resume Review",
          prompt: ordinaryPrompt,
          targetScope: "assign_later",
          expectedOutcome: "route_answer",
        },
      ],
    });
    const ordinaryQueue = await getEnrichmentTaskQueue({
      limit: 50,
      sourceType: "resume_review",
      statuses: ["open"],
    });
    expect(ordinaryQueue.status).toBe("ready");
    if (ordinaryQueue.status !== "ready") throw new Error("Expected ordinary queue.");
    const ordinaryTask = ordinaryQueue.tasks.find((item) => item.prompt === ordinaryPrompt);
    if (!ordinaryTask) throw new Error("Expected ordinary enrichment task.");
    await expect(
      updateEnrichmentTask({
        taskId: ordinaryTask.id,
        action: "mark_import_reviewed",
      }),
    ).resolves.toMatchObject({ status: "invalid", reason: "unsupported_import_review_action" });
    await expect(
      updateEnrichmentTask({
        taskId: ordinaryTask.id,
        action: "request_rerun",
      }),
    ).resolves.toMatchObject({ status: "invalid", reason: "unsupported_rerun_action" });
    await expect(
      updateEnrichmentTask({
        taskId: ordinaryTask.id,
        action: "convert_to_enrichment_question",
      }),
    ).resolves.toMatchObject({ status: "invalid", reason: "unsupported_convert_note_action" });
  });

  it("updates profile facts and resolves the originating imported note task", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const owner = await registerUser({
      email: `profile-fact-${suffix}@example.com`,
      password: "Password123!",
    });
    if (owner.status !== "created") throw new Error("Expected test user.");

    await runWithAuthContext(owner.user.id, async () => {
    const db = getDb();
    const workspace = await getCurrentWorkspace(db);
    const prompt = `No certifications were found in the source ${crypto.randomUUID()}.`;
    const existingCertification = "Google Professional Data Engineer";
    await db.insert(profiles).values({
      workspaceId: workspace.id,
      displayName: "Profile Fact Test",
      profileJson: {
        ...buildEmptyProfileJson(),
        certifications: [
          simpleField(existingCertification, existingCertification, 1),
        ],
      },
    });
    await upsertEnrichmentTasks(db, {
      workspaceId: workspace.id,
      tasks: [
        {
          taskType: "source_section_review",
          sourceType: "extraction_note",
          sourceLabel: "Resume import",
          prompt,
          targetScope: "profile_fact",
          expectedOutcome: "update_profile_fact",
          noteKind: "missing_profile_fact",
          expectedAction: "add_profile_fact",
          targetField: "certifications",
        },
      ],
    });
    const [task] = await db
      .select({ id: enrichmentTasks.id })
      .from(enrichmentTasks)
      .where(eq(enrichmentTasks.prompt, prompt))
      .limit(1);
    if (!task) throw new Error("Expected imported note task.");

    const result = await updateProfileFacts({
      field: "certifications",
      certifications: ["AWS Certified Cloud Practitioner · Issuer: AWS"],
      taskId: task.id,
    });
    expect(result.status).toBe("updated");
    const historyRows = await db
      .select()
      .from(profileFactHistory)
      .where(eq(profileFactHistory.profileId, result.status === "updated" ? result.profile.id : ""))
      .orderBy(desc(profileFactHistory.createdAt))
      .limit(5);
    expect(historyRows[0]).toMatchObject({
      field: "certifications",
      sourceType: "profile_fact_task",
      sourceTaskId: task.id,
      updatedBy: "user",
    });
    expect(historyRows[0]?.valueJson).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: existingCertification,
        }),
        expect.objectContaining({
          value: "AWS Certified Cloud Practitioner · Issuer: AWS",
        }),
      ]),
    );
    expect(historyRows[0]?.previousValueJson).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: existingCertification,
        }),
      ]),
    );
    const library = await getRecentEvidenceLibrary(10);
    expect(library.profile?.fact_sources?.certifications).toMatchObject({
      source_task_id: task.id,
      source_type: "profile_fact_task",
      updated_by: "user",
    });
    const refreshed = await getEnrichmentTaskQueue({
      limit: 20,
      sourceType: "extraction_note",
      statuses: ["converted"],
    });
    expect(refreshed.status).toBe("ready");
    if (refreshed.status !== "ready") throw new Error("Expected converted queue.");
    const resolvedTask = refreshed.tasks.find((item) => item.id === task.id);
    expect(resolvedTask).toMatchObject({
      status: "converted",
      resolution_kind: "profile_fact_updated",
    });
    });
  });

  it("updates missing role fields and resolves the originating imported note task", async () => {
    const db = getDb();
    const workspace = await getCurrentWorkspace(db);
    const prompt = `NVIDIA work experience line does not state a location ${crypto.randomUUID()}.`;
    const [role] = await db
      .insert(workExperiences)
      .values({
        workspaceId: workspace.id,
        employer: "NVIDIA",
        roleTitle: "Software Engineer Intern",
      })
      .returning({ id: workExperiences.id });
    if (!role) throw new Error("Expected role.");
    await upsertEnrichmentTasks(db, {
      workspaceId: workspace.id,
      tasks: [
        {
          taskType: "source_section_review",
          sourceType: "extraction_note",
          sourceLabel: "Resume import",
          prompt,
          targetScope: "source_material",
          expectedOutcome: "review_imported_material",
          noteKind: "missing_role_field",
          expectedAction: "edit_role_field",
          targetField: "location",
        },
      ],
    });
    const queue = await getEnrichmentTaskQueue({
      limit: 20,
      sourceType: "extraction_note",
      statuses: ["open"],
    });
    expect(queue.status).toBe("ready");
    if (queue.status !== "ready") throw new Error("Expected enrichment queue.");
    const task = queue.tasks.find((item) => item.prompt === prompt);
    if (!task) throw new Error("Expected imported note task.");

    const result = await updateWorkExperienceFields({
      workExperienceId: role.id,
      location: "Santa Clara, CA",
      taskId: task.id,
    });
    expect(result.status).toBe("saved");
    const [updatedRole] = await db
      .select()
      .from(workExperiences)
      .where(eq(workExperiences.id, role.id))
      .limit(1);
    expect(updatedRole?.location).toBe("Santa Clara, CA");
    const refreshed = await getEnrichmentTaskQueue({
      limit: 20,
      sourceType: "extraction_note",
      statuses: ["converted"],
    });
    expect(refreshed.status).toBe("ready");
    if (refreshed.status !== "ready") throw new Error("Expected converted queue.");
    const resolvedTask = refreshed.tasks.find((item) => item.id === task.id);
    expect(resolvedTask).toMatchObject({
      status: "converted",
      resolution_kind: "role_field_updated",
      work_experience_id: role.id,
    });
  });

  it("exposes provenance and target eligibility for library targets", async () => {
    const db = getDb();
    const workspace = await getCurrentWorkspace(db);
    const unique = crypto.randomUUID();
    const sourceText = `Eligibility source ${unique}`;
    const [sourceDocument] = await db
      .insert(sourceDocuments)
      .values({
        workspaceId: workspace.id,
        sourceType: "resume-review",
        title: `Eligibility source ${unique}`,
        contentText: sourceText,
        contentHash: crypto.createHash("sha256").update(sourceText).digest("hex"),
        lifecycleStatus: "reviewed",
      })
      .returning();
    if (!sourceDocument) throw new Error("Expected source document.");
    const [eligibleEvidence] = await db
      .insert(evidenceItems)
      .values({
        workspaceId: workspace.id,
        sourceDocumentId: sourceDocument.id,
        text: `Eligible target evidence ${unique}`,
        sourceQuote: "Eligible target source quote.",
        evidenceType: "extracted",
        sensitivityLevel: "private",
        status: "pending",
        needsUserConfirmation: 1,
      })
      .returning();
    const [rejectedEvidence] = await db
      .insert(evidenceItems)
      .values({
        workspaceId: workspace.id,
        text: `Rejected target evidence ${unique}`,
        sourceQuote: "Rejected target source quote.",
        evidenceType: "extracted",
        sensitivityLevel: "private",
        status: "rejected",
      })
      .returning();
    if (!eligibleEvidence || !rejectedEvidence) {
      throw new Error("Expected evidence rows.");
    }
    const [role] = await db
      .insert(workExperiences)
      .values({
        workspaceId: workspace.id,
        sourceDocumentId: sourceDocument.id,
        employer: `Eligibility employer ${unique}`,
        roleTitle: "Software Engineer",
        status: "pending",
      })
      .returning();
    if (!role) throw new Error("Expected role row.");
    const [initiative] = await db
      .insert(initiatives)
      .values({
        workspaceId: workspace.id,
        workExperienceId: role.id,
        sourceDocumentId: sourceDocument.id,
        internalTitle: `Eligibility initiative ${unique}`,
        actions: ["Built eligibility metadata."],
        results: ["Kept canonical target selectable."],
        technologies: ["TypeScript"],
        status: "pending",
      })
      .returning();
    const [portfolioProject] = await db
      .insert(portfolioProjects)
      .values({
        workspaceId: workspace.id,
        sourceDocumentId: sourceDocument.id,
        projectType: "personal_project",
        title: `Eligibility portfolio project ${unique}`,
        actions: ["Shipped provenance UI."],
        results: ["Clarified target selection."],
        technologies: ["Postgres"],
        status: "pending",
      })
      .returning();
    if (!initiative || !portfolioProject) {
      throw new Error("Expected story target rows.");
    }

    const library = await getRecentEvidenceLibrary(80);
    const eligible = library.evidenceItems.find((item) => item.id === eligibleEvidence.id);
    const rejected = library.evidenceItems.find((item) => item.id === rejectedEvidence.id);
    const libraryRole = library.workExperiences.find((item) => item.id === role.id);
    const libraryInitiative = library.initiatives.find((item) => item.id === initiative.id);
    const libraryPortfolioProject = library.portfolioProjects.find(
      (item) => item.id === portfolioProject.id,
    );

    expect(eligible?.provenance).toMatchObject({
      kind: "source_document",
      source_document_id: sourceDocument.id,
    });
    expect(eligible?.target_eligibility).toMatchObject({
      eligible: true,
    });
    expect(eligible?.target_eligibility?.reason).toContain("Draft evidence");
    expect(eligible?.resume_eligibility).toMatchObject({
      eligible: false,
      nextAction: "review_claim",
    });
    expect(eligible?.resume_eligibility?.blockers.map((item) => item.code)).toEqual(
      expect.arrayContaining([
        "approval_required",
        "public_safe_required",
        "user_confirmation_required",
        "resume_usage_required",
      ]),
    );
    expect(rejected?.provenance).toMatchObject({
      kind: "manual_or_generated",
      source_document_id: null,
    });
    expect(rejected?.target_eligibility).toMatchObject({
      eligible: false,
    });
    for (const item of [libraryRole, libraryInitiative, libraryPortfolioProject]) {
      expect(item?.provenance).toMatchObject({
        kind: "source_document",
        source_document_id: sourceDocument.id,
      });
      expect(item?.target_eligibility).toMatchObject({
        eligible: true,
      });
    }
  });

  it("reviews and rejects work experiences without exposing rejected roles as targets", async () => {
    const db = getDb();
    const workspace = await getCurrentWorkspace(db);
    const unique = crypto.randomUUID();
    const [reviewableRole] = await db
      .insert(workExperiences)
      .values({
        workspaceId: workspace.id,
        employer: `Reviewed role ${unique}`,
        roleTitle: "Software Engineer",
        startDate: "2024",
        status: "pending",
      })
      .returning({ id: workExperiences.id });
    const [incompleteRole] = await db
      .insert(workExperiences)
      .values({
        workspaceId: workspace.id,
        employer: `Incomplete role ${unique}`,
        roleTitle: "Intern",
        status: "pending",
      })
      .returning({ id: workExperiences.id });
    if (!reviewableRole || !incompleteRole) throw new Error("Expected role rows.");

    const reviewed = await reviewWorkExperience({
      workExperienceId: reviewableRole.id,
      action: "mark_reviewed",
    });
    expect(reviewed.status).toBe("saved");
    const invalidReview = await reviewWorkExperience({
      workExperienceId: incompleteRole.id,
      action: "mark_reviewed",
    });
    expect(invalidReview).toMatchObject({
      status: "invalid",
      reason: "work_experience_review_missing_core_fields",
    });
    const rejected = await reviewWorkExperience({
      workExperienceId: reviewableRole.id,
      action: "reject_role",
    });
    expect(rejected.status).toBe("saved");

    const library = await getRecentEvidenceLibrary(80);
    const rejectedRole = library.workExperiences.find((item) => item.id === reviewableRole.id);
    expect(rejectedRole).toMatchObject({
      status: "rejected",
      target_eligibility: {
        eligible: false,
      },
    });
  });

  it("applies downstream strategies when removing a Work Experience", async () => {
    const db = getDb();
    const workspace = await getCurrentWorkspace(db);
    const unique = crypto.randomUUID();
    const [sourceRole, targetRole] = await db
      .insert(workExperiences)
      .values([
        {
          workspaceId: workspace.id,
          employer: `Source role ${unique}`,
          roleTitle: "Software Engineer",
          startDate: "2023",
          status: "approved",
        },
        {
          workspaceId: workspace.id,
          employer: `Target role ${unique}`,
          roleTitle: "Senior Software Engineer",
          startDate: "2024",
          status: "approved",
        },
      ])
      .returning({ id: workExperiences.id });
    if (!sourceRole || !targetRole) throw new Error("Expected Work Experience rows.");
    const [story] = await db
      .insert(initiatives)
      .values({
        workspaceId: workspace.id,
        workExperienceId: sourceRole.id,
        internalTitle: `Role story ${unique}`,
        actions: ["Built platform"],
        results: ["Improved rollout"],
        metrics: [],
        status: "pending",
      })
      .returning({ id: initiatives.id });
    if (!story) throw new Error("Expected Story Target row.");
    const [directEvidence, storyEvidence] = await db
      .insert(evidenceItems)
      .values([
        {
          workspaceId: workspace.id,
          text: `Direct role evidence ${unique}`,
          sourceQuote: `Direct role evidence ${unique}`,
          evidenceType: "extracted",
          sensitivityLevel: "public_safe",
          relatedWorkExperienceId: sourceRole.id,
          relatedInitiativeId: null,
          status: "pending",
        },
        {
          workspaceId: workspace.id,
          text: `Story evidence ${unique}`,
          sourceQuote: `Story evidence ${unique}`,
          evidenceType: "extracted",
          sensitivityLevel: "public_safe",
          relatedWorkExperienceId: null,
          relatedInitiativeId: story.id,
          status: "pending",
        },
      ])
      .returning({ id: evidenceItems.id });
    if (!directEvidence || !storyEvidence) throw new Error("Expected Evidence rows.");
    const [task] = await db
      .insert(enrichmentTasks)
      .values({
        workspaceId: workspace.id,
        taskType: "scope",
        status: "open",
        sourceType: "evidence",
        sourceLabel: `Role task ${unique}`,
        prompt: "Clarify this role.",
        dedupeKey: `role-task-${unique}`,
        workExperienceId: sourceRole.id,
      })
      .returning({ id: enrichmentTasks.id });
    if (!task) throw new Error("Expected task row.");

    const reassigned = await reviewWorkExperience({
      workExperienceId: sourceRole.id,
      action: "reject_role",
      downstreamStrategy: "reassign",
      reassignToWorkExperienceId: targetRole.id,
    });
    expect(reassigned.status).toBe("saved");
    if (reassigned.status !== "saved") throw new Error("Expected reassigned remove result.");
    expect(reassigned.downstreamSummary).toMatchObject({
      strategy: "reassign",
      evidenceCount: 1,
      storyTargetCount: 1,
      taskCount: 1,
    });
    const [movedStory] = await db
      .select({ workExperienceId: initiatives.workExperienceId })
      .from(initiatives)
      .where(eq(initiatives.id, story.id));
    const [movedEvidence] = await db
      .select({ relatedWorkExperienceId: evidenceItems.relatedWorkExperienceId })
      .from(evidenceItems)
      .where(eq(evidenceItems.id, directEvidence.id));
    const [movedTask] = await db
      .select({ workExperienceId: enrichmentTasks.workExperienceId })
      .from(enrichmentTasks)
      .where(eq(enrichmentTasks.id, task.id));
    expect(movedStory?.workExperienceId).toBe(targetRole.id);
    expect(movedEvidence?.relatedWorkExperienceId).toBe(targetRole.id);
    expect(movedTask?.workExperienceId).toBe(targetRole.id);

    const [keepRole] = await db
      .insert(workExperiences)
      .values({
        workspaceId: workspace.id,
        employer: `Keep role ${unique}`,
        roleTitle: "Frontend Engineer",
        startDate: "2022",
        status: "approved",
      })
      .returning({ id: workExperiences.id });
    if (!keepRole) throw new Error("Expected keep role.");
    const [keepStory] = await db
      .insert(initiatives)
      .values({
        workspaceId: workspace.id,
        workExperienceId: keepRole.id,
        internalTitle: `Keep story ${unique}`,
        status: "pending",
      })
      .returning({ id: initiatives.id });
    const [keepEvidence] = await db
      .insert(evidenceItems)
      .values({
        workspaceId: workspace.id,
        text: `Keep evidence ${unique}`,
        sourceQuote: `Keep evidence ${unique}`,
        evidenceType: "extracted",
        sensitivityLevel: "public_safe",
        relatedWorkExperienceId: keepRole.id,
        status: "pending",
      })
      .returning({ id: evidenceItems.id });
    if (!keepStory || !keepEvidence) throw new Error("Expected keep downstream rows.");
    const kept = await reviewWorkExperience({
      workExperienceId: keepRole.id,
      action: "reject_role",
      downstreamStrategy: "keep",
    });
    expect(kept.status).toBe("saved");
    const [unassignedStory] = await db
      .select({ workExperienceId: initiatives.workExperienceId, status: initiatives.status })
      .from(initiatives)
      .where(eq(initiatives.id, keepStory.id));
    const [unassignedEvidence] = await db
      .select({ relatedWorkExperienceId: evidenceItems.relatedWorkExperienceId, status: evidenceItems.status })
      .from(evidenceItems)
      .where(eq(evidenceItems.id, keepEvidence.id));
    expect(unassignedStory).toMatchObject({ workExperienceId: null, status: "pending" });
    expect(unassignedEvidence).toMatchObject({ relatedWorkExperienceId: null, status: "pending" });

    const [deleteRole] = await db
      .insert(workExperiences)
      .values({
        workspaceId: workspace.id,
        employer: `Delete role ${unique}`,
        roleTitle: "Intern",
        startDate: "2021",
        status: "approved",
      })
      .returning({ id: workExperiences.id });
    if (!deleteRole) throw new Error("Expected delete role.");
    const [deleteStory] = await db
      .insert(initiatives)
      .values({
        workspaceId: workspace.id,
        workExperienceId: deleteRole.id,
        internalTitle: `Delete story ${unique}`,
        status: "pending",
      })
      .returning({ id: initiatives.id });
    if (!deleteStory) throw new Error("Expected delete story.");
    const [deleteEvidence] = await db
      .insert(evidenceItems)
      .values({
        workspaceId: workspace.id,
        text: `Delete evidence ${unique}`,
        sourceQuote: `Delete evidence ${unique}`,
        evidenceType: "extracted",
        sensitivityLevel: "public_safe",
        relatedInitiativeId: deleteStory.id,
        status: "pending",
      })
      .returning({ id: evidenceItems.id });
    if (!deleteEvidence) throw new Error("Expected delete evidence.");
    const deleted = await reviewWorkExperience({
      workExperienceId: deleteRole.id,
      action: "reject_role",
      downstreamStrategy: "delete_downstream",
    });
    expect(deleted.status).toBe("saved");
    const [rejectedStory] = await db
      .select({ status: initiatives.status })
      .from(initiatives)
      .where(eq(initiatives.id, deleteStory.id));
    const [rejectedEvidence] = await db
      .select({ status: evidenceItems.status })
      .from(evidenceItems)
      .where(eq(evidenceItems.id, deleteEvidence.id));
    expect(rejectedStory?.status).toBe("rejected");
    expect(rejectedEvidence?.status).toBe("rejected");
  });

  it("rejects Story Target review when required story material is missing", async () => {
    const db = getDb();
    const workspace = await getCurrentWorkspace(db);
    const unique = crypto.randomUUID();
    const [thinStory, readyStory] = await db
      .insert(initiatives)
      .values([
        {
          workspaceId: workspace.id,
          internalTitle: `Thin Story Target ${unique}`,
          actions: [],
          results: [],
          metrics: [],
          status: "pending",
        },
        {
          workspaceId: workspace.id,
          internalTitle: `Ready Story Target ${unique}`,
          context: "Owned onboarding analytics reporting.",
          problem: "Manual reporting slowed activation decisions.",
          role: "Technical owner",
          actions: ["Designed reporting model", "Built dashboard pipeline"],
          results: ["Reduced manual reporting effort"],
          metrics: [{ value: "6 hours saved weekly" }],
          externalSafeSummary: "Built onboarding analytics reporting and reduced manual effort.",
          status: "pending",
        },
      ])
      .returning({ id: initiatives.id });
    if (!thinStory || !readyStory) throw new Error("Expected Story Target rows.");

    const invalidReview = await updateStoryTargetReview({
      action: "mark_reviewed",
      targetId: thinStory.id,
      targetType: "initiative",
    });
    expect(invalidReview).toMatchObject({
      status: "invalid",
      reason: "story_target_not_ready",
    });
    const stillInvalidWithoutEvidence = await updateStoryTargetReview({
      action: "mark_reviewed",
      targetId: readyStory.id,
      targetType: "initiative",
    });
    expect(stillInvalidWithoutEvidence).toMatchObject({
      status: "invalid",
      reason: "story_target_not_ready",
    });
    await db.insert(evidenceItems).values({
      workspaceId: workspace.id,
      text: `Ready story evidence ${unique}`,
      sourceQuote: "Built reporting model and saved six hours weekly.",
      evidenceType: "extracted",
      publicSafeSummary: "Built reporting model and saved six hours weekly.",
      sensitivityLevel: "public_safe",
      status: "approved",
      allowedUsage: ["resume", "interview"],
      needsUserConfirmation: 0,
      relatedInitiativeId: readyStory.id,
    });
    const validReview = await updateStoryTargetReview({
      action: "mark_reviewed",
      targetId: readyStory.id,
      targetType: "initiative",
    });
    expect(validReview).toMatchObject({
      status: "saved",
      targetType: "initiative",
    });
  });

  it("updates non-location role fields from imported note tasks", async () => {
    const db = getDb();
    const workspace = await getCurrentWorkspace(db);
    const prompt = `Amazon role end date is stated as Present ${crypto.randomUUID()}.`;
    const [role] = await db
      .insert(workExperiences)
      .values({
        workspaceId: workspace.id,
        employer: "Amazon",
        roleTitle: "Software Development Engineer Intern",
      })
      .returning({ id: workExperiences.id });
    if (!role) throw new Error("Expected role.");
    await upsertEnrichmentTasks(db, {
      workspaceId: workspace.id,
      tasks: [
        {
          taskType: "source_section_review",
          sourceType: "extraction_note",
          sourceLabel: "Resume import",
          prompt,
          targetScope: "source_material",
          expectedOutcome: "review_imported_material",
          noteKind: "missing_role_field",
          expectedAction: "edit_role_field",
          targetField: "end_date",
          workExperienceId: role.id,
        },
      ],
    });
    const queue = await getEnrichmentTaskQueue({
      limit: 20,
      sourceType: "extraction_note",
      statuses: ["open"],
    });
    expect(queue.status).toBe("ready");
    if (queue.status !== "ready") throw new Error("Expected enrichment queue.");
    const task = queue.tasks.find((item) => item.prompt === prompt);
    if (!task) throw new Error("Expected imported note task.");

    const result = await updateWorkExperienceFields({
      workExperienceId: role.id,
      endDate: "Present",
      taskId: task.id,
    });
    expect(result.status).toBe("saved");
    const [updatedRole] = await db
      .select()
      .from(workExperiences)
      .where(eq(workExperiences.id, role.id))
      .limit(1);
    expect(updatedRole?.endDate).toBe("Present");
  });

  it("rejects role field updates when the submitted field does not match the imported note field", async () => {
    const db = getDb();
    const workspace = await getCurrentWorkspace(db);
    const prompt = `Shopify role team missing ${crypto.randomUUID()}.`;
    const [role] = await db
      .insert(workExperiences)
      .values({
        workspaceId: workspace.id,
        employer: "Shopify",
        roleTitle: "Backend Intern",
      })
      .returning({ id: workExperiences.id });
    if (!role) throw new Error("Expected role.");
    await upsertEnrichmentTasks(db, {
      workspaceId: workspace.id,
      tasks: [
        {
          taskType: "source_section_review",
          sourceType: "extraction_note",
          sourceLabel: "Resume import",
          prompt,
          targetScope: "source_material",
          expectedOutcome: "review_imported_material",
          noteKind: "missing_role_field",
          expectedAction: "edit_role_field",
          targetField: "team",
          workExperienceId: role.id,
        },
      ],
    });
    const queue = await getEnrichmentTaskQueue({
      limit: 20,
      sourceType: "extraction_note",
      statuses: ["open"],
    });
    expect(queue.status).toBe("ready");
    if (queue.status !== "ready") throw new Error("Expected enrichment queue.");
    const task = queue.tasks.find((item) => item.prompt === prompt);
    if (!task) throw new Error("Expected imported note task.");

    const result = await updateWorkExperienceFields({
      workExperienceId: role.id,
      location: "Toronto, ON",
      taskId: task.id,
    });
    expect(result).toMatchObject({ status: "invalid", reason: "task_field_mismatch" });
    const [unchangedRole] = await db
      .select()
      .from(workExperiences)
      .where(eq(workExperiences.id, role.id))
      .limit(1);
    expect(unchangedRole?.location).toBeNull();
    expect(unchangedRole?.team).toBeNull();
  });

  it("rejects role field updates when the imported note is anchored to a different role", async () => {
    const db = getDb();
    const workspace = await getCurrentWorkspace(db);
    const prompt = `NVIDIA location mismatch guard ${crypto.randomUUID()}.`;
    const [targetRole, wrongRole] = await db
      .insert(workExperiences)
      .values([
        {
          workspaceId: workspace.id,
          employer: "NVIDIA",
          roleTitle: "Software Engineer Intern",
        },
        {
          workspaceId: workspace.id,
          employer: "Shopify",
          roleTitle: "Backend Intern",
        },
      ])
      .returning({ id: workExperiences.id });
    if (!targetRole || !wrongRole) throw new Error("Expected work experiences.");
    await upsertEnrichmentTasks(db, {
      workspaceId: workspace.id,
      tasks: [
        {
          taskType: "source_section_review",
          sourceType: "extraction_note",
          sourceLabel: "Resume import",
          prompt,
          targetScope: "source_material",
          expectedOutcome: "review_imported_material",
          noteKind: "missing_role_field",
          expectedAction: "edit_role_field",
          targetField: "location",
          workExperienceId: targetRole.id,
        },
      ],
    });
    const queue = await getEnrichmentTaskQueue({
      limit: 20,
      sourceType: "extraction_note",
      statuses: ["open"],
    });
    expect(queue.status).toBe("ready");
    if (queue.status !== "ready") throw new Error("Expected enrichment queue.");
    const task = queue.tasks.find((item) => item.prompt === prompt);
    if (!task) throw new Error("Expected imported note task.");

    const result = await updateWorkExperienceFields({
      workExperienceId: wrongRole.id,
      location: "Toronto, ON",
      taskId: task.id,
    });
    expect(result).toMatchObject({ status: "invalid", reason: "task_target_mismatch" });
    const [unchangedWrongRole] = await db
      .select()
      .from(workExperiences)
      .where(eq(workExperiences.id, wrongRole.id))
      .limit(1);
    expect(unchangedWrongRole?.location).toBeNull();
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
        publicSafeSummary: "Original public safe summary for resume use.",
        sensitivityLevel: "public_safe",
        status: "approved",
        allowedUsage: ["resume", "interview"],
        needsUserConfirmation: 0,
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
    const proposedTextPatch =
      typeof proposal.proposed_patch_json.text_patch === "string"
        ? proposal.proposed_patch_json.text_patch
        : null;

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
    expect(evidenceRows[0]?.text).toBe(proposedTextPatch ?? evidence.text);
    expect(evidenceRows[0]?.sourceQuote).toBe(answer);
    expect(evidenceRows[0]).toMatchObject({
      status: "pending",
      needsUserConfirmation: 1,
    });
    expect(evidenceRows[0]?.allowedUsage).toEqual(["interview"]);
    const duplicateRows = await db.select().from(evidenceItems).where(eq(evidenceItems.text, answer));
    expect(duplicateRows).toHaveLength(0);
    const resumeContextAfterPatch = await getResumeTailoringContext();
    expect(resumeContextAfterPatch.evidenceItems.some((item) => item.id === evidence.id)).toBe(
      false,
    );
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

  it("applies evidence-only asset actions through the action service", async () => {
    const suffix = crypto.randomUUID();
    const owner = await registerUser({
      email: `evidence-asset-action-${suffix}@example.com`,
      password: "Password123!",
    });
    if (owner.status !== "created") throw new Error("Expected owner user.");

    const result = await runWithAuthContext(owner.user.id, async () => {
      const db = getDb();
      const workspace = await getCurrentWorkspace(db);
      const now = new Date();
      const [role] = await db
        .insert(workExperiences)
        .values({
          employer: `Action service employer ${suffix}`,
          roleTitle: "Software Engineer",
          status: "pending",
          workspaceId: workspace.id,
        })
        .returning({ id: workExperiences.id });
      if (!role) throw new Error("Expected role.");
      const [initiative] = await db
        .insert(initiatives)
        .values({
          actions: ["Built action service coverage."],
          internalTitle: `Action service initiative ${suffix}`,
          results: ["Centralized evidence action path."],
          status: "pending",
          technologies: ["TypeScript"],
          workExperienceId: role.id,
          workspaceId: workspace.id,
        })
        .returning({ id: initiatives.id });
      if (!initiative) throw new Error("Expected initiative.");
      const [evidence] = await db
        .insert(evidenceItems)
        .values({
          allowedUsage: ["interview"],
          evidenceType: "extracted",
          relatedWorkExperienceId: role.id,
          sensitivityLevel: "private",
          sourceQuote: "Built action service coverage.",
          status: "approved",
          text: `Evidence action service claim ${suffix}`,
          workspaceId: workspace.id,
        })
        .returning({ id: evidenceItems.id, sourceQuote: evidenceItems.sourceQuote });
      if (!evidence) throw new Error("Expected evidence.");
      const [claim] = await db
        .insert(generatedClaims)
        .values({
          claimStatus: "supported",
          claimText: "Generated claim linked to evidence action service claim.",
          createdAt: now,
          evidenceIds: [evidence.id],
          lastValidatedAt: now,
          riskLevel: "low",
          section: "experience",
          sourceQuotes: [evidence.sourceQuote],
          supportStatus: "supported",
          workspaceId: workspace.id,
        })
        .returning({ id: generatedClaims.id });

      const linked = await applyEvidenceAssetAction({
        action: "edit",
        evidenceId: evidence.id,
        relatedInitiativeId: initiative.id,
        relatedPortfolioProjectId: null,
        relatedProjectId: null,
        relatedWorkExperienceId: null,
      });
      const afterLink = await db
        .select()
        .from(evidenceItems)
        .where(eq(evidenceItems.id, evidence.id));
      const claimRows = claim
        ? await db.select().from(generatedClaims).where(eq(generatedClaims.id, claim.id))
        : [];

      const unlinked = await applyEvidenceAssetAction({
        action: "edit",
        evidenceId: evidence.id,
        relatedInitiativeId: null,
        relatedPortfolioProjectId: null,
        relatedProjectId: null,
        relatedWorkExperienceId: null,
      });
      const afterUnlink = await db
        .select()
        .from(evidenceItems)
        .where(eq(evidenceItems.id, evidence.id));
      return { afterLink, afterUnlink, claimRows, linked, unlinked };
    });

    expect(result.linked).toMatchObject({ status: "saved" });
    expect(result.afterLink[0]).toMatchObject({
      relatedInitiativeId: expect.any(String),
      relatedWorkExperienceId: null,
      needsUserConfirmation: 1,
    });
    expect(result.claimRows[0]).toMatchObject({
      claimStatus: "stale",
      staleReason: "Linked evidence was edited or reclassified.",
      lastValidatedAt: null,
    });
    expect(result.unlinked).toMatchObject({ status: "saved" });
    expect(result.afterUnlink[0]).toMatchObject({
      relatedInitiativeId: null,
      relatedPortfolioProjectId: null,
      relatedWorkExperienceId: null,
    });
  });

  it("quarantines approved source-derived evidence without physical deletion", async () => {
    const suffix = crypto.randomUUID();
    const owner = await registerUser({
      email: `quarantine-approved-evidence-${suffix}@example.com`,
      password: "Password123!",
    });
    if (owner.status !== "created") throw new Error("Expected owner user.");

    const result = await runWithAuthContext(owner.user.id, async () => {
      const db = getDb();
      const workspace = await getCurrentWorkspace(db);
      const sourceText = `Approved evidence quarantine source ${suffix}`;
      const [sourceDocument] = await db
        .insert(sourceDocuments)
        .values({
          contentHash: crypto.createHash("sha256").update(sourceText).digest("hex"),
          contentText: sourceText,
          lifecycleStatus: "reviewed",
          sourceType: "resume-review",
          title: `Approved evidence quarantine source ${suffix}`,
          workspaceId: workspace.id,
        })
        .returning({ id: sourceDocuments.id });
      if (!sourceDocument) throw new Error("Expected source document.");
      const now = new Date();
      const [evidence] = await db
        .insert(evidenceItems)
        .values({
          allowedUsage: ["resume", "interview"],
          evidenceType: "extracted",
          needsUserConfirmation: 0,
          publicSafeSummary: "Public-safe quarantine evidence.",
          sensitivityLevel: "public_safe",
          sourceDocumentId: sourceDocument.id,
          sourceQuote: "Approved quarantine evidence source quote.",
          status: "approved",
          text: `Approved quarantine evidence ${suffix}`,
          workspaceId: workspace.id,
        })
        .returning({ id: evidenceItems.id, sourceQuote: evidenceItems.sourceQuote });
      if (!evidence) throw new Error("Expected evidence.");
      const [claim] = await db
        .insert(generatedClaims)
        .values({
          claimStatus: "supported",
          claimText: "Generated claim linked to quarantined evidence.",
          createdAt: now,
          evidenceIds: [evidence.id],
          lastValidatedAt: now,
          riskLevel: "low",
          section: "experience",
          sourceQuotes: [evidence.sourceQuote],
          supportStatus: "supported",
          workspaceId: workspace.id,
        })
        .returning({ id: generatedClaims.id });

      const rejectedWithoutConfirmation = await quarantineEvidenceAsset({
        confirmation: "wrong",
        evidenceId: evidence.id,
      });
      const quarantined = await quarantineEvidenceAsset({
        confirmation: "QUARANTINE_APPROVED_EVIDENCE",
        evidenceId: evidence.id,
        reason: "Reset bad resume import.",
      });
      const approveAfterQuarantine = await applyEvidenceAssetAction({
        action: "approve_for_resume",
        evidenceId: evidence.id,
      });
      const evidenceRows = await db
        .select()
        .from(evidenceItems)
        .where(eq(evidenceItems.id, evidence.id));
      const claimRows = claim
        ? await db.select().from(generatedClaims).where(eq(generatedClaims.id, claim.id))
        : [];
      const cleanupEvents = await db
        .select()
        .from(sourceCleanupEvents)
        .where(eq(sourceCleanupEvents.workspaceId, workspace.id))
        .orderBy(desc(sourceCleanupEvents.createdAt))
        .limit(1);
      const deleted = await deleteEvidenceItem(evidence.id);
      return {
        cleanupEvents,
        approveAfterQuarantine,
        claimRows,
        deleted,
        evidenceRows,
        quarantined,
        rejectedWithoutConfirmation,
      };
    });

    expect(result.rejectedWithoutConfirmation).toMatchObject({
      reason: "quarantine_confirmation_required",
      status: "invalid",
    });
    expect(result.quarantined).toMatchObject({
      staleGeneratedClaims: 1,
      status: "saved",
    });
    expect(result.approveAfterQuarantine).toMatchObject({
      reason: "quarantined_evidence_requires_restore",
      status: "invalid",
    });
    expect(result.evidenceRows).toHaveLength(1);
    expect(result.evidenceRows[0]).toMatchObject({
      allowedUsage: [],
      needsUserConfirmation: 1,
      quarantineReason: "Reset bad resume import.",
      status: "rejected",
    });
    expect(result.evidenceRows[0]?.quarantinedAt).toBeTruthy();
    expect(result.claimRows[0]).toMatchObject({
      claimStatus: "stale",
      supportStatus: "unvalidated",
      staleReason: "Linked evidence was quarantined after source cleanup review.",
      lastValidatedAt: null,
    });
    expect(result.cleanupEvents[0]).toMatchObject({
      cleanupMode: "approved_material_quarantine",
      dryRun: 0,
    });
    expect(result.cleanupEvents[0]?.resultJson).toMatchObject({
      markedStaleIds: {
        generatedClaims: [result.claimRows[0]?.id],
      },
      quarantinedEvidenceItemId: result.evidenceRows[0]?.id,
    });
    expect(result.deleted).toMatchObject({
      reason: "quarantined_evidence_requires_cleanup_center",
      status: "invalid",
    });
  });

  it("deletes draft evidence and marks linked generated claims stale", async () => {
    const suffix = crypto.randomUUID();
    const owner = await registerUser({
      email: `delete-draft-evidence-${suffix}@example.com`,
      password: "Password123!",
    });
    if (owner.status !== "created") throw new Error("Expected owner user.");

    const result = await runWithAuthContext(owner.user.id, async () => {
      const db = getDb();
      const workspace = await getCurrentWorkspace(db);
      const now = new Date();
      const [evidence] = await db
        .insert(evidenceItems)
        .values({
          allowedUsage: ["interview"],
          createdAt: now,
          evidenceType: "extracted",
          sensitivityLevel: "private",
          sourceQuote: "Draft evidence source quote.",
          status: "pending",
          text: `Draft evidence ${suffix}`,
          updatedAt: now,
          workspaceId: workspace.id,
        })
        .returning();
      if (!evidence) throw new Error("Expected evidence.");
      const [claim] = await db
        .insert(generatedClaims)
        .values({
          claimStatus: "supported",
          claimText: "Generated claim linked to draft evidence.",
          createdAt: now,
          evidenceIds: [evidence.id],
          lastValidatedAt: now,
          riskLevel: "low",
          section: "experience",
          sourceQuotes: [evidence.sourceQuote],
          supportStatus: "supported",
          workspaceId: workspace.id,
        })
        .returning({ id: generatedClaims.id });
      await db.insert(enrichmentTasks).values({
        createdAt: now,
        dedupeKey: `delete-draft-evidence-${suffix}`,
        evidenceItemId: evidence.id,
        expectedOutcome: "update_evidence",
        prompt: "Add draft evidence detail.",
        sourceLabel: "Delete draft smoke",
        sourceType: "user_input",
        status: "open",
        targetScope: "evidence_detail",
        taskType: "metric",
        updatedAt: now,
        workspaceId: workspace.id,
      });

      const deleted = await deleteEvidenceItem(evidence.id);
      const evidenceRows = await db
        .select()
        .from(evidenceItems)
        .where(eq(evidenceItems.id, evidence.id));
      const claimRows = claim
        ? await db.select().from(generatedClaims).where(eq(generatedClaims.id, claim.id))
        : [];
      return { claimRows, deleted, evidenceRows };
    });

    expect(result.deleted).toMatchObject({
      deletedEnrichmentTasks: 1,
      staleGeneratedClaims: 1,
      status: "deleted",
    });
    expect(result.evidenceRows).toHaveLength(0);
    expect(result.claimRows[0]).toMatchObject({
      claimStatus: "stale",
      supportStatus: "unvalidated",
      staleReason: "Linked evidence was deleted.",
      lastValidatedAt: null,
    });
  });

  it("rejects direct deletion of approved resume-ready evidence", async () => {
    const suffix = crypto.randomUUID();
    const owner = await registerUser({
      email: `delete-approved-evidence-${suffix}@example.com`,
      password: "Password123!",
    });
    if (owner.status !== "created") throw new Error("Expected owner user.");

    const result = await runWithAuthContext(owner.user.id, async () => {
      const db = getDb();
      const workspace = await getCurrentWorkspace(db);
      const [evidence] = await db
        .insert(evidenceItems)
        .values({
          allowedUsage: ["resume", "interview"],
          evidenceType: "extracted",
          needsUserConfirmation: 0,
          publicSafeSummary: "Public-safe approved resume evidence.",
          sensitivityLevel: "public_safe",
          sourceQuote: "Approved evidence source quote.",
          status: "approved",
          text: `Approved evidence ${suffix}`,
          workspaceId: workspace.id,
        })
        .returning({ id: evidenceItems.id });
      if (!evidence) throw new Error("Expected evidence.");

      const deleted = await deleteEvidenceItem(evidence.id);
      const evidenceRows = await db
        .select()
        .from(evidenceItems)
        .where(eq(evidenceItems.id, evidence.id));
      return { deleted, evidenceRows };
    });

    expect(result.deleted).toMatchObject({
      reason: "resume_ready_evidence_requires_quarantine",
      status: "invalid",
    });
    expect(result.evidenceRows).toHaveLength(1);
  });

  it("rejects direct deletion of pending resume-usage evidence", async () => {
    const suffix = crypto.randomUUID();
    const owner = await registerUser({
      email: `delete-pending-resume-evidence-${suffix}@example.com`,
      password: "Password123!",
    });
    if (owner.status !== "created") throw new Error("Expected owner user.");

    const result = await runWithAuthContext(owner.user.id, async () => {
      const db = getDb();
      const workspace = await getCurrentWorkspace(db);
      const [evidence] = await db
        .insert(evidenceItems)
        .values({
          allowedUsage: ["resume"],
          evidenceType: "extracted",
          sensitivityLevel: "private",
          sourceQuote: "Pending resume-usage evidence source quote.",
          status: "pending",
          text: `Pending resume usage evidence ${suffix}`,
          workspaceId: workspace.id,
        })
        .returning({ id: evidenceItems.id });
      if (!evidence) throw new Error("Expected evidence.");

      const deleted = await deleteEvidenceItem(evidence.id);
      const evidenceRows = await db
        .select()
        .from(evidenceItems)
        .where(eq(evidenceItems.id, evidence.id));
      return { deleted, evidenceRows };
    });

    expect(result.deleted).toMatchObject({
      reason: "resume_usage_evidence_requires_quarantine",
      status: "invalid",
    });
    expect(result.evidenceRows).toHaveLength(1);
  });

  it("dismisses target-row-only enrichment tasks when deleting draft evidence", async () => {
    const suffix = crypto.randomUUID();
    const owner = await registerUser({
      email: `delete-target-only-task-${suffix}@example.com`,
      password: "Password123!",
    });
    if (owner.status !== "created") throw new Error("Expected owner user.");

    const result = await runWithAuthContext(owner.user.id, async () => {
      const db = getDb();
      const workspace = await getCurrentWorkspace(db);
      const [evidence] = await db
        .insert(evidenceItems)
        .values({
          allowedUsage: ["interview"],
          evidenceType: "extracted",
          sensitivityLevel: "private",
          sourceQuote: "Target-only task evidence source quote.",
          status: "pending",
          text: `Target-only task evidence ${suffix}`,
          workspaceId: workspace.id,
        })
        .returning({ id: evidenceItems.id });
      if (!evidence) throw new Error("Expected evidence.");
      const prompt = `Route target-only delete smoke ${suffix}`;
      await upsertEnrichmentTasks(db, {
        tasks: [
          {
            expectedOutcome: "route_answer",
            prompt,
            sourceLabel: "Target-only task delete smoke",
            sourceType: "user_input",
            targetScope: "assign_later",
            taskType: "metric",
          },
        ],
        workspaceId: workspace.id,
      });
      const queue = await getEnrichmentTaskQueue({
        limit: 20,
        sourceType: "user_input",
        statuses: ["open"],
      });
      expect(queue.status).toBe("ready");
      if (queue.status !== "ready") throw new Error("Expected enrichment queue.");
      const task = queue.tasks.find((item) => item.prompt === prompt);
      if (!task) throw new Error("Expected task.");
      await db.insert(enrichmentTaskTargets).values({
        confidence: "medium",
        createdBy: "system",
        reason: "Suggested by test.",
        targetId: evidence.id,
        targetKind: "evidence",
        targetRole: "suggested",
        taskId: task.id,
        workspaceId: workspace.id,
      });

      const deleted = await deleteEvidenceItem(evidence.id);
      const taskRows = await db
        .select()
        .from(enrichmentTasks)
        .where(eq(enrichmentTasks.id, task.id));
      const targetRows = await db
        .select()
        .from(enrichmentTaskTargets)
        .where(eq(enrichmentTaskTargets.taskId, task.id));
      return { deleted, targetRows, taskRows };
    });

    expect(result.deleted).toMatchObject({
      deletedEnrichmentTaskTargets: 1,
      dismissedTargetOnlyEnrichmentTasks: 1,
      status: "deleted",
    });
    expect(result.targetRows).toHaveLength(0);
    expect(result.taskRows[0]).toMatchObject({
      resolutionKind: "dismissed",
      status: "dismissed",
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
    expect(task?.evidence_item_id).toBeFalsy();
    expect(task).toMatchObject({
      target_scope: "assign_later",
      expected_outcome: "route_answer",
    });
    const suggestedTarget = task?.targets.find(
      (target) => target.target_kind === "evidence" && target.target_role === "suggested",
    );
    expect(suggestedTarget).toBeDefined();

    const [alternateEvidence] = await db
      .select()
      .from(evidenceItems)
      .where(eq(evidenceItems.sourceDocumentId, result.sourceDocumentId))
      .limit(1);
    if (!task || !alternateEvidence || !suggestedTarget) {
      throw new Error("Expected task, suggestion, and evidence.");
    }
    const answer = `The SQL dashboards reduced weekly reporting review time ${crypto.randomUUID()}.`;
    const blocked = await updateEnrichmentTask({
      action: "answer",
      taskId: task.id,
      userAnswer: answer,
    });
    expect(blocked).toMatchObject({
      status: "invalid",
      reason: "target_confirmation_required",
    });

    const acceptedSuggestion = await updateEnrichmentTask({
      action: "accept_suggested_target",
      targetId: suggestedTarget.target_id,
      taskId: task.id,
    });
    expect(acceptedSuggestion).toMatchObject({
      status: "saved",
      task: {
        evidence_item_id: suggestedTarget.target_id,
        target_scope: "evidence_detail",
      },
    });
    if (acceptedSuggestion.status !== "saved") throw new Error("Expected accepted suggestion.");
    expect(
      acceptedSuggestion.task.targets.some(
        (target) =>
          target.target_kind === "evidence" &&
          target.target_id === suggestedTarget.target_id &&
          target.target_role === "primary",
      ),
    ).toBe(true);
    expect(
      acceptedSuggestion.task.proposals.some(
        (proposal) =>
          proposal.status === "pending_review" &&
          proposal.proposal_type === "update_evidence" &&
          proposal.target_id === suggestedTarget.target_id,
      ),
    ).toBe(true);
    const persistedTargets = await db
      .select()
      .from(enrichmentTaskTargets)
      .where(eq(enrichmentTaskTargets.taskId, task.id));
    expect(persistedTargets).toHaveLength(1);
    expect(persistedTargets[0]).toMatchObject({
      targetKind: "evidence",
      targetId: suggestedTarget.target_id,
      targetRole: "primary",
      createdBy: "user",
    });
  });

  it("rejects suggested targets and prevents reuse without confirmation", async () => {
    const db = getDb();
    const workspace = await getCurrentWorkspace(db);
    const [evidence] = await db
      .insert(evidenceItems)
      .values({
        workspaceId: workspace.id,
        text: `Suggested evidence ${crypto.randomUUID()}`,
        sourceQuote: "Suggested source.",
        evidenceType: "extracted",
        sensitivityLevel: "private",
        status: "pending",
      })
      .returning({ id: evidenceItems.id });
    if (!evidence) throw new Error("Expected evidence.");
    const prompt = `Suggested target rejection ${crypto.randomUUID()}`;
    await upsertEnrichmentTasks(db, {
      workspaceId: workspace.id,
      tasks: [
        {
          expectedOutcome: "route_answer",
          prompt,
          sourceLabel: "Suggestion reject smoke",
          sourceType: "user_input",
          targetScope: "assign_later",
          taskType: "metric",
        },
      ],
    });
    const queue = await getEnrichmentTaskQueue({
      limit: 30,
      sourceType: "user_input",
      statuses: ["open"],
    });
    expect(queue.status).toBe("ready");
    if (queue.status !== "ready") throw new Error("Expected enrichment queue.");
    const task = queue.tasks.find((item) => item.prompt === prompt);
    if (!task) throw new Error("Expected task.");
    await db.insert(enrichmentTaskTargets).values({
      workspaceId: workspace.id,
      taskId: task.id,
      targetKind: "evidence",
      targetId: evidence.id,
      targetRole: "suggested",
      confidence: "medium",
      createdBy: "system",
      reason: "Suggested by test.",
    });

    const rejected = await updateEnrichmentTask({
      action: "reject_suggested_target",
      targetId: evidence.id,
      taskId: task.id,
    });
    expect(rejected.status).toBe("saved");
    const answer = await updateEnrichmentTask({
      action: "answer",
      taskId: task.id,
      userAnswer: `This answer still needs routing ${crypto.randomUUID()}.`,
    });
    expect(answer).toMatchObject({
      status: "invalid",
      reason: "target_required",
    });
    const targetRows = await db
      .select()
      .from(enrichmentTaskTargets)
      .where(eq(enrichmentTaskTargets.taskId, task.id));
    expect(targetRows[0]?.rejectedAt).toBeTruthy();
  });

  it("rejects pending proposals when changing route to profile context", async () => {
    const db = getDb();
    const workspace = await getCurrentWorkspace(db);
    const [evidence] = await db
      .insert(evidenceItems)
      .values({
        workspaceId: workspace.id,
        text: `Route change evidence ${crypto.randomUUID()}`,
        sourceQuote: "Route change source.",
        evidenceType: "extracted",
        sensitivityLevel: "private",
        status: "pending",
      })
      .returning({ id: evidenceItems.id });
    if (!evidence) throw new Error("Expected evidence.");
    const prompt = `Route change profile context ${crypto.randomUUID()}`;
    await upsertEnrichmentTasks(db, {
      workspaceId: workspace.id,
      tasks: [
        {
          evidenceItemId: evidence.id,
          expectedOutcome: "update_evidence",
          prompt,
          sourceLabel: "Route change smoke",
          sourceType: "user_input",
          targetScope: "evidence_detail",
          taskType: "metric",
        },
      ],
    });
    const queue = await getEnrichmentTaskQueue({
      limit: 30,
      sourceType: "user_input",
      statuses: ["open"],
    });
    expect(queue.status).toBe("ready");
    if (queue.status !== "ready") throw new Error("Expected enrichment queue.");
    const task = queue.tasks.find((item) => item.prompt === prompt);
    if (!task) throw new Error("Expected task.");
    const answered = await updateEnrichmentTask({
      action: "answer",
      taskId: task.id,
      userAnswer: `Add source detail before profile route ${crypto.randomUUID()}.`,
    });
    expect(answered.status).toBe("saved");
    if (answered.status !== "saved") throw new Error("Expected answer.");
    const pendingProposal = answered.task.proposals.find(
      (proposal) => proposal.status === "pending_review",
    );
    if (!pendingProposal) throw new Error("Expected pending proposal.");

    const rerouted = await updateEnrichmentTask({
      action: "change_workflow_route",
      route: "profile_context",
      taskId: task.id,
    });
    expect(rerouted).toMatchObject({
      status: "saved",
      task: {
        evidence_item_id: null,
        expected_outcome: "save_profile_answer",
        target_scope: "profile_context",
      },
    });
    if (rerouted.status !== "saved") throw new Error("Expected reroute.");
    expect(rerouted.task.targets).toHaveLength(0);
    const [proposalAfterRoute] = await db
      .select()
      .from(enrichmentProposals)
      .where(eq(enrichmentProposals.id, pendingProposal.id))
      .limit(1);
    expect(proposalAfterRoute).toMatchObject({
      status: "rejected",
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

function buildEmptyProfileJson() {
  return {
    name: simpleField("Profile Fact Test", "Profile Fact Test", 1),
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
