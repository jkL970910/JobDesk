import { describe, expect, it } from "vitest";

import { validateBulletClaimCoverage } from "../src/server/tailored-resume-guardrails";

describe("resume export coverage assumptions", () => {
  it("keeps a generated bullet mapped when extra claim ledger entries exist", () => {
    const result = validateBulletClaimCoverage({
      resumeMarkdown: "## Experience\n- Built SQL dashboards for onboarding funnel analysis.",
      claims: [
        "Built SQL dashboards for onboarding funnel analysis.",
        "Candidate has SQL experience.",
      ],
    });

    expect(result).toEqual({ passed: true, reason: null });
  });
});
