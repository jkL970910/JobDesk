import { describe, expect, it } from "vitest";

import {
  buildRedactionReport,
  isPublicSafeText,
} from "../src/server/deidentification-service";

describe("deidentification service", () => {
  it("detects blocked terms and proposes public-safe wording", () => {
    const report = buildRedactionReport({
      text: "Built confidential dashboard for Acme Finance and client Northstar.",
    });

    expect(report.hasBlockedTerms).toBe(true);
    expect(report.blockedTerms).toContain("confidential");
    expect(report.suggestedSummary).toContain("financial services company");
    expect(report.suggestedSummary).not.toContain("Acme Finance");
    expect(report.diff.length).toBeGreaterThan(0);
  });

  it("accepts public-safe wording without replacements", () => {
    expect(isPublicSafeText("Built reporting dashboard for a financial services team.")).toBe(true);
  });
});
