import { describe, expect, it } from "vitest";

import { getMainResumeExportBlocker } from "../src/server/main-resume-export-policy";
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

  it("blocks final Markdown export until a main resume is Fact Guard validated", () => {
    expect(
      getMainResumeExportBlocker({ format: "markdown", status: "unvalidated" }),
    ).toMatchObject({
      kind: "resume_not_validated",
    });
    expect(getMainResumeExportBlocker({ format: "json", status: "unvalidated" })).toBeNull();
    expect(getMainResumeExportBlocker({ format: "markdown", status: "validated" })).toBeNull();
  });
});
