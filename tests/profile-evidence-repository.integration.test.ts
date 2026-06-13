import crypto from "node:crypto";

import { beforeAll, describe, expect, it } from "vitest";

import { loadDotEnv } from "../src/ai/env";
import {
  getEvidenceDedupeCandidates,
  getProjectDedupeCandidates,
  getRecentEvidenceLibrary,
  getResumeTailoringContext,
  getStarStoryBank,
  mergeEvidenceItems,
  mergeProjectCards,
  persistProfileEvidenceExtraction,
  updateEvidenceItem,
} from "../src/server/profile-evidence-repository";
import type { ProfileEvidenceExtraction } from "../src/schemas/profile-evidence-extraction";

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
    const result = await persistProfileEvidenceExtraction({
      sourceText: sampleSourceText,
      extraction,
      provider: "integration-test",
      model: "test-model",
      usage: { totalTokens: 42 },
      retryCount: 0,
    });

    expect(result).toMatchObject({
      status: "saved",
      evidenceCount: 5,
      projectCount: 1,
    });

    const library = await getRecentEvidenceLibrary(10);
    expect(library.profile?.displayName).toBe("Jane Doe");
    if (result.status !== "saved") throw new Error("Expected saved profile evidence.");
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
    expect(inferredEvidence).toMatchObject({
      needs_user_confirmation: true,
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
      reason: "sensitive_evidence_requires_deidentification",
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
    });
    const duplicateB = await persistProfileEvidenceExtraction({
      sourceText: duplicateSourceText,
      extraction: buildDuplicateExtraction("Built SQL dashboards for onboarding funnel analysis."),
      provider: "integration-test",
      model: "test-model",
      usage: {},
      retryCount: 0,
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

    const merge = await mergeEvidenceItems({
      primaryEvidenceId: candidate.primary.id,
      duplicateEvidenceId: candidate.duplicate.id,
    });
    expect(merge).toMatchObject({
      status: "merged",
      primaryEvidenceId: candidate.primary.id,
      duplicateEvidenceId: candidate.duplicate.id,
    });

    const afterMerge = await getRecentEvidenceLibrary(50);
    const duplicateAfterMerge = afterMerge.evidenceItems.find(
      (item) => item.id === candidate.duplicate.id,
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

    const projectMerge = await mergeProjectCards({
      primaryProjectId: projectCandidate.primary.id,
      duplicateProjectIds: projectCandidate.duplicateProjectIds,
    });
    expect(projectMerge).toMatchObject({
      status: "merged",
      primaryProjectId: projectCandidate.primary.id,
      duplicateProjectId: projectCandidate.duplicate.id,
      duplicateProjectCount: projectCandidate.duplicateCount,
      movedEvidenceCount: projectCandidate.duplicateEvidenceCount,
    });

    const afterProjectMerge = await getRecentEvidenceLibrary(80);
    expect(
      afterProjectMerge.projectCards.some((project) => project.id === projectCandidate.duplicate.id),
    ).toBe(false);
    expect(
      afterProjectMerge.evidenceItems.some(
        (item) =>
          item.related_project_id === projectCandidate.primary.id &&
          item.text.includes("dashboard slices"),
      ),
    ).toBe(true);
  });
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
    extraction_notes: [],
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
