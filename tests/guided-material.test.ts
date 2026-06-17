import { describe, expect, it } from "vitest";

import {
  buildGuidedMaterialMarkdown,
  emptyGuidedMaterialFields,
  getGuidedMaterialReadiness,
  hasGuidedMaterialContent,
} from "../src/lib/guided-material";

describe("guided material source builder", () => {
  it("builds editable markdown from guided answers and target context", () => {
    const markdown = buildGuidedMaterialMarkdown(
      {
        ...emptyGuidedMaterialFields,
        actions: "Built SQL dashboard\nLed weekly readouts",
        businessImpact: "Reduced manual reporting effort by 6 hours per week.",
        companyOrContext: "Growth onboarding team",
        metricsAfter: "6 hours saved weekly",
        problem: "Teams could not see activation drop-off.",
        projectOrInitiativeTitle: "Activation reporting",
      },
      {
        missingFields: ["ownership", "public-safe wording"],
        targetTitle: "Activation reporting",
        targetType: "initiative",
      },
    );

    expect(markdown).toContain("# Activation reporting");
    expect(markdown).toContain("Target story type: initiative");
    expect(markdown).toContain("Missing fields to strengthen: ownership, public-safe wording");
    expect(markdown).toContain("## Actions");
    expect(markdown).toContain("Built SQL dashboard");
    expect(markdown).toContain("## Metrics after");
    expect(markdown).toContain("6 hours saved weekly");
  });

  it("does not treat an empty generated template as ready material", () => {
    const markdown = buildGuidedMaterialMarkdown(emptyGuidedMaterialFields);
    const readiness = getGuidedMaterialReadiness(emptyGuidedMaterialFields);

    expect(readiness.isReady).toBe(false);
    expect(readiness.missingReason).toBe("Add a project or initiative title.");
    expect(hasGuidedMaterialContent(markdown)).toBe(false);
  });

  it("requires a title and multiple substantive answers", () => {
    const readiness = getGuidedMaterialReadiness({
      ...emptyGuidedMaterialFields,
      actions: "Built a dashboard and led weekly readouts.",
      businessImpact: "Reduced manual reporting effort by six hours weekly.",
      metricsAfter: "Six hours saved per week.",
      projectOrInitiativeTitle: "Activation reporting",
    });

    expect(readiness).toMatchObject({
      answeredCount: 3,
      isReady: true,
      missingReason: null,
    });
  });
});
