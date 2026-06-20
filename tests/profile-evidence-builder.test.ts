import { describe, expect, it } from "vitest";

import { buildProfileEvidenceInstructions } from "../src/ai/profile-evidence-extraction";
import { buildExtractionNoteEnrichmentTasks } from "../src/server/enrichment-task-repository";
import { consolidateInitiativeDrafts } from "../src/server/profile-evidence-repository";
import type { ProfileEvidenceExtraction } from "../src/schemas/profile-evidence-extraction";

describe("Evidence Library Builder instructions", () => {
  it("biases project-note sources toward reusable project cards and evidence", () => {
    const instructions = buildProfileEvidenceInstructions("project_note");

    expect(instructions).toContain("project note");
    expect(instructions).toContain("work_experiences are employer/role containers");
    expect(instructions).toContain("create either one initiative");
    expect(instructions).toContain("Return at most 8 evidence_items");
    expect(instructions).toContain("redaction");
  });

  it("keeps resume sources constrained to resume/profile extraction", () => {
    const instructions = buildProfileEvidenceInstructions("resume");

    expect(instructions).toContain("resume or career-notes source");
    expect(instructions).toContain("Return at most 6 evidence_items");
    expect(instructions).toContain("extract work_experiences from Experience sections");
    expect(instructions).toContain("portfolio_projects only from non-employer Projects sections");
  });

  it("defines initiative granularity rules in the extraction prompt", () => {
    const instructions = buildProfileEvidenceInstructions("resume");

    expect(instructions).toContain("Initiative granularity rules");
    expect(instructions).toContain("not a single tool, task, system component, or result");
    expect(instructions).toContain("AWS infrastructure provisioning with CDK");
    expect(instructions).toContain("Distributed caching infrastructure for session latency optimization");
  });

  it("consolidates complementary initiative fragments under one role", () => {
    const initiatives: ProfileEvidenceExtraction["initiatives"] = [
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
    ];

    const result = consolidateInitiativeDrafts(initiatives);

    expect(result.initiatives).toHaveLength(1);
    expect(result.initiatives[0]).toMatchObject({
      status: "pending",
      sensitivity_level: "private",
    });
    expect(result.initiatives[0]?.technologies).toEqual(
      expect.arrayContaining(["AWS CDK", "distributed cache"]),
    );
    expect(result.initiatives[0]?.results).toContain("Optimized session latency.");
    expect(result.draftRefRedirects.get("Session latency optimization with distributed caching")).toBe(
      result.initiatives[0]?.internal_title,
    );
    expect(result.extractionNotes[0]).toContain("These story fragments were merged");
  });

  it("does not consolidate similar initiatives across different roles", () => {
    const result = consolidateInitiativeDrafts([
      buildInitiative({
        internal_title: "AWS infrastructure provisioning with CDK",
        technologies: ["AWS CDK"],
        work_experience_ref: "Amazon · Software Engineer",
      }),
      buildInitiative({
        internal_title: "Distributed cloud caching for session latency",
        technologies: ["distributed cache"],
        work_experience_ref: "Shopify · Data Engineer",
      }),
    ]);

    expect(result.initiatives).toHaveLength(2);
    expect(result.draftRefRedirects.size).toBe(0);
    expect(result.extractionNotes).toHaveLength(0);
  });

  it("does not consolidate initiatives when role references are missing", () => {
    const result = consolidateInitiativeDrafts([
      buildInitiative({
        internal_title: "AWS infrastructure provisioning with CDK",
        technologies: ["AWS CDK"],
        work_experience_ref: null,
      }),
      buildInitiative({
        internal_title: "Distributed cloud caching for session latency",
        technologies: ["distributed cache"],
        work_experience_ref: null,
      }),
    ]);

    expect(result.initiatives).toHaveLength(2);
    expect(result.draftRefRedirects.size).toBe(0);
    expect(result.extractionNotes).toHaveLength(0);
  });

  it("marks source-section extraction notes as imported material review tasks", () => {
    const [task] = buildExtractionNoteEnrichmentTasks({
      sourceTitle: "Resume import",
      notes: ["Work experience entries were extracted from the WORK EXPERIENCES section."],
    });

    expect(task).toMatchObject({
      taskType: "source_section_review",
      sourceType: "extraction_note",
      sourceLabel: "Resume import",
      targetScope: "source_material",
      targetConfidence: "high",
      expectedOutcome: "review_imported_material",
    });
    expect(task?.targetReason).toContain("not a missing-information question");
  });

  it("keeps concrete extraction notes as ordinary enrichment questions", () => {
    const [task] = buildExtractionNoteEnrichmentTasks({
      sourceTitle: "Resume import",
      notes: ["Add a concrete activation metric for the onboarding dashboard."],
    });

    expect(task).toMatchObject({
      taskType: "metric",
      sourceType: "extraction_note",
      sourceLabel: "Resume import",
      prompt: "Add a concrete activation metric for the onboarding dashboard.",
    });
    expect(task).not.toHaveProperty("expectedOutcome", "review_imported_material");
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
