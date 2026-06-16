import { describe, expect, it } from "vitest";

import { buildResumeReviewInstructions } from "../src/ai/resume-review";

describe("resume review AI instructions", () => {
  it("adapts HR screening review skill to general resumes", () => {
    const instructions = buildResumeReviewInstructions();

    expect(instructions).toContain("skills/hr-screening-review");
    expect(instructions).toContain("general resume review with no target JD");
    expect(instructions).toContain("Do not produce a JD match score");
    expect(instructions).toContain("fairness_check");
    expect(instructions).toContain("Do not rewrite the resume");
    expect(instructions).toContain("Scores above 90 require exceptional quantified impact");
    expect(instructions).toContain("do not return 100 overall");
  });
});
