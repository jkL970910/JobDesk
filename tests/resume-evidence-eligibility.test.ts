import { describe, expect, it } from "vitest";

import { evaluateResumeEvidenceEligibility } from "../src/server/resume-evidence-eligibility";

describe("resume evidence eligibility", () => {
  it("allows approved source-backed resume evidence with public-safe disclosure", () => {
    expect(evaluateResumeEvidenceEligibility(candidate()).eligible).toBe(true);
    expect(evaluateResumeEvidenceEligibility(candidate()).nextAction).toBe("ready");
  });

  it("returns explicit blockers for non-resume-ready evidence", () => {
    const result = evaluateResumeEvidenceEligibility(
      candidate({
        allowedUsage: ["interview", "internal_only"],
        evidenceType: "inferred",
        needsUserConfirmation: true,
        publicSafeSummary: null,
        sensitivityLevel: "private",
        sourceQuote: "",
        status: "pending",
      }),
    );

    expect(result.eligible).toBe(false);
    expect(result.blockers.map((item) => item.code)).toEqual([
      "approval_required",
      "public_safe_required",
      "user_confirmation_required",
      "inferred_evidence_not_allowed",
      "missing_source_quote",
      "resume_usage_required",
      "internal_only_not_allowed",
    ]);
    expect(result.nextAction).toBe("review_claim");
  });

  it("accepts public-safe summaries for private source text", () => {
    const result = evaluateResumeEvidenceEligibility(
      candidate({
        publicSafeSummary: "Led stakeholder reporting for cross-functional product teams.",
        sensitivityLevel: "private",
        sourceQuote: "Led Project Falcon reporting for Client A.",
        text: "Led Project Falcon reporting for Client A.",
      }),
    );

    expect(result.eligible).toBe(true);
    expect(result.canUsePublicSafeSummary).toBe(true);
  });

  it("blocks public_safe text when the text itself still contains unsafe terms", () => {
    const result = evaluateResumeEvidenceEligibility(
      candidate({
        publicSafeSummary: null,
        sensitivityLevel: "public_safe",
        text: "Led confidential stakeholder reporting.",
      }),
    );

    expect(result.eligible).toBe(false);
    expect(result.blockers.map((item) => item.code)).toContain("public_safe_required");
  });

  it("blocks quarantined evidence even if all resume-ready fields are present", () => {
    const result = evaluateResumeEvidenceEligibility(
      candidate({
        quarantinedAt: "2026-07-07T12:00:00.000Z",
      }),
    );

    expect(result.eligible).toBe(false);
    expect(result.blockers.map((item) => item.code)).toContain("quarantined_evidence_not_allowed");
    expect(result.nextAction).toBe("quarantine_restore_required");
  });
});

function candidate(
  patch: Partial<Parameters<typeof evaluateResumeEvidenceEligibility>[0]> = {},
): Parameters<typeof evaluateResumeEvidenceEligibility>[0] {
  return {
    allowedUsage: ["resume"],
    evidenceType: "extracted",
    needsUserConfirmation: false,
    publicSafeSummary: null,
    quarantinedAt: null,
    sensitivityLevel: "public_safe",
    sourceQuote: "Built SQL dashboards.",
    status: "approved",
    text: "Built SQL dashboards.",
    ...patch,
  };
}
