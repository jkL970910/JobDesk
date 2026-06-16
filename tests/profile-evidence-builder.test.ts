import { describe, expect, it } from "vitest";

import { buildProfileEvidenceInstructions } from "../src/ai/profile-evidence-extraction";

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
});
