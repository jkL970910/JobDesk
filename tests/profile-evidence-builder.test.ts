import { describe, expect, it } from "vitest";

import { buildProfileEvidenceInstructions } from "../src/ai/profile-evidence-extraction";
import { buildExtractionNoteEnrichmentTasks } from "../src/server/enrichment-task-repository";

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
