import { describe, expect, it } from "vitest";

import { clampResumeReviewRunStepTitle } from "../src/server/resume-review-repository";

describe("resume review step titles", () => {
  it("keeps semantic section titles within the persisted step title limit", () => {
    const longSemanticTitle = [
      "Review Experience - AMAZON - Software Dev Engineer (Last Mile Delivery Technology)",
      "NFC Check-In Platform - Scaling Last Mile Network Rollout and operational adoption across stations",
      "with additional migration, partner onboarding, metrics, and project detail text",
    ].join(" - ");

    const title = clampResumeReviewRunStepTitle(longSemanticTitle);

    expect(title.length).toBeLessThanOrEqual(240);
    expect(title).toMatch(/\.\.\.$/);
  });

  it("normalizes whitespace before enforcing the persisted title limit", () => {
    const title = clampResumeReviewRunStepTitle("  Review   Experience\n\nAmazon\tSoftware Engineer  ");

    expect(title).toBe("Review Experience Amazon Software Engineer");
  });
});
