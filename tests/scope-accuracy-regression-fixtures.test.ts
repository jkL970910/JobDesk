import { describe, expect, it } from "vitest";

import { buildExtractionNoteEnrichmentTasks } from "../src/server/enrichment-task-repository";
import { guardWorkExperienceDraftsForPersistence } from "../src/server/extraction-scope-guardrail";
import { consolidateInitiativeDrafts } from "../src/server/initiative-consolidation";
import { classifyExtractedAssetCandidate } from "../src/server/scope-classifier";
import type { ProfileEvidenceExtraction } from "../src/schemas/profile-evidence-extraction";

const amazonInternship = {
  employer: "Amazon",
  id: "amazon-internship",
  roleTitle: "Software Development Engineer Intern",
  sourceSection: "Amazon internship",
};

const amazonFullTime = {
  employer: "Amazon",
  id: "amazon-full-time",
  roleTitle: "Software Development Engineer",
  sourceSection: "Amazon full-time",
};

describe("scope accuracy regression fixtures", () => {
  it("does not match same-company roles by employer token alone", () => {
    const internshipFragment = classifyExtractedAssetCandidate({
      content: "Amazon internship cache metrics dashboard",
      proposedScope: "work_initiative",
      sourceSection: "Amazon internship",
    }, {
      linkedWorkExperience: amazonInternship,
    });
    const fullTimeFragment = classifyExtractedAssetCandidate({
      content: "Amazon full-time cache metrics dashboard",
      proposedScope: "work_initiative",
      sourceSection: "Amazon full-time",
    }, {
      linkedWorkExperience: amazonFullTime,
    });

    expect(internshipFragment.initiativeClusterKey).not.toBe(fullTimeFragment.initiativeClusterKey);
  });

  it("consolidates one split AWS/cache/latency project into a single initiative", () => {
    const result = consolidateInitiativeDrafts([
      buildInitiative({
        internal_title: "AWS infrastructure provisioning with CDK",
        actions: ["Provisioned cloud infrastructure using AWS CDK."],
        technologies: ["AWS CDK"],
      }),
      buildInitiative({
        internal_title: "Session latency optimization with distributed caching",
        results: ["Optimized session latency."],
        technologies: ["distributed cache"],
      }),
      buildInitiative({
        internal_title: "Distributed cloud caching for high-scale delivery service",
        context: "High-scale delivery service had session latency constraints.",
        problem: "Session dependency latency affected delivery service reliability.",
        technologies: ["distributed cache"],
      }),
    ]);

    expect(result.initiatives).toHaveLength(1);
    expect(result.initiatives[0]?.technologies).toEqual(
      expect.arrayContaining(["AWS CDK", "distributed cache"]),
    );
    expect(result.extractionNotes[0]).toContain("These story fragments were merged");
  });

  it("keeps bullet-shaped Work Experience candidates out of canonical role rows", () => {
    const result = guardWorkExperienceDraftsForPersistence(
      [
        buildWorkExperienceDraft({
          employer: "Migrated service to region X",
          role_title: "Reduced latency by 35%",
          summary: "Built AWS CDK infrastructure for distributed cache rollout.",
        }),
      ],
      { sourceTitle: "Resume import" },
    );

    expect(result.accepted).toHaveLength(0);
    expect(result.decisions[0]).toMatchObject({
      disposition: "rejected",
      classification: {
        decision: {
          acceptedScope: "unassigned",
          canonicalLinkPolicy: "reject_as_invalid_scope",
        },
      },
    });
    expect(result.reviewNotes[0]).toContain("Scope review needed");
  });

  it("routes Technical Skills material to profile context, not a random project", () => {
    const result = classifyExtractedAssetCandidate({
      content: "Technical Skills: Java, Python, React, AWS, Redis",
      proposedScope: "work_initiative",
      sourceSection: "Technical Skills",
    }, {
      linkedWorkExperience: amazonFullTime,
    });

    expect(result.decision).toMatchObject({
      acceptedScope: "profile_context",
      canonicalLinkPolicy: "review_queue_only",
    });
  });

  it("routes project-only material without employer/date to portfolio project or review", () => {
    const result = classifyExtractedAssetCandidate({
      content: "Open-source resume parser with section-level extraction and markdown cleanup",
      proposedScope: "portfolio_project",
      sourceSection: "Projects",
    });

    expect(result.decision).toMatchObject({
      acceptedScope: "portfolio_project",
      canonicalLinkPolicy: "can_persist_to_canonical_pending",
    });
  });

  it("separates atomic evidence from broader story material", () => {
    const metric = classifyExtractedAssetCandidate({
      content: "Reduced API count from 20+ services to 10",
      proposedScope: "evidence_claim",
      sourceQuote: "Reduced API count from 20+ services to 10",
    });
    const story = classifyExtractedAssetCandidate({
      content: "Led API consolidation across migration planning, service dependency cleanup, and rollout coordination.",
      proposedScope: "work_initiative",
      sourceSection: "Amazon full-time API migration",
    }, {
      linkedWorkExperience: amazonFullTime,
    });

    expect(metric.decision).toMatchObject({
      acceptedScope: "evidence_claim",
      canonicalLinkPolicy: "can_persist_to_canonical_pending",
    });
    expect(story.decision).toMatchObject({
      acceptedScope: "work_initiative",
      canonicalLinkPolicy: "can_persist_to_canonical_pending",
    });
  });

  it("routes imported observations to ACK/edit-source instead of evidence proposals", () => {
    const [task] = buildExtractionNoteEnrichmentTasks({
      sourceTitle: "Resume import",
      notes: ["No certifications found in the uploaded resume."],
    });

    expect(task).toMatchObject({
      taskType: "source_section_review",
      expectedOutcome: "review_imported_material",
      expectedAction: "add_profile_fact",
      noteKind: "missing_profile_fact",
    });
  });
});

function buildInitiative(
  overrides: Partial<ProfileEvidenceExtraction["initiatives"][number]>,
): ProfileEvidenceExtraction["initiatives"][number] {
  return {
    actions: [],
    context: null,
    external_safe_summary: null,
    external_safe_title: null,
    internal_title: "Untitled initiative",
    metrics: [],
    needs_redaction_review: false,
    problem: null,
    results: [],
    role: null,
    sensitivity_level: "private",
    stakeholders: [],
    status: "pending",
    technologies: [],
    work_experience_ref: "Amazon · Software Engineer",
    ...overrides,
  };
}

function buildWorkExperienceDraft(
  overrides: Partial<ProfileEvidenceExtraction["work_experiences"][number]>,
): ProfileEvidenceExtraction["work_experiences"][number] {
  return {
    employer: "Acme",
    role_title: "Software Engineer",
    team: null,
    location: null,
    start_date: "2020",
    end_date: "2021",
    summary: null,
    status: "pending",
    ...overrides,
  };
}
