import { describe, expect, it } from "vitest";

import { generatedClaims } from "../src/db/schema";
import { buildGeneratedResumeReadinessReview } from "../src/server/generated-resume-readiness-review";

type ClaimRow = typeof generatedClaims.$inferSelect;

describe("generated resume readiness review", () => {
  it("keeps Fact Guard blockers as hard gates and routes claim gaps to Evidence Library", () => {
    const review = buildGeneratedResumeReadinessReview({
      baseline: { label: "Original resume · source review", score: 76 },
      claims: [
        claim({ id: "c1", claimStatus: "supported", supportStatus: "supported" }),
        claim({
          id: "c2",
          claimStatus: "unsupported",
          supportStatus: "unsupported",
          staleReason: "claim references missing evidence",
        }),
      ],
      documentId: "11111111-1111-4111-8111-111111111111",
      documentType: "main_resume",
      generatedLabel: "Generated main resume · general readiness review",
      now: new Date("2026-06-30T12:00:00.000Z"),
      resumeMarkdown: [
        "## Summary",
        "Product analytics candidate with evidence-backed launch work.",
        "## Experience",
        "- Built onboarding dashboards for product teams.",
      ].join("\n"),
      resumeStatus: "unvalidated",
      scope: "general_readiness",
    });

    expect(review.verdict).toBe("needs_evidence_before_export");
    expect(review.hard_gate_status.export_policy).toBe("blocked");
    expect(review.before_after.delta).toBeTypeOf("number");
    expect(review.findings.some((finding) => finding.route === "evidence_gap")).toBe(true);
    expect(review.findings.every((finding) => finding.route !== "positioning_gap" || finding.linked_claim_ids.length === 0)).toBe(true);
  });

  it("marks generated readiness as a soft review when Fact Guard passes", () => {
    const review = buildGeneratedResumeReadinessReview({
      baseline: null,
      claims: [
        claim({ id: "c1", claimStatus: "supported", supportStatus: "supported" }),
        claim({ id: "c2", claimStatus: "supported", supportStatus: "supported" }),
      ],
      documentId: "22222222-2222-4222-8222-222222222222",
      documentType: "main_resume",
      generatedLabel: "Generated main resume · general readiness review",
      now: new Date("2026-06-30T12:00:00.000Z"),
      resumeMarkdown: [
        "## Summary",
        "Product analytics candidate focused on lifecycle growth.",
        "## Experience",
        "- Built onboarding dashboards for product teams.",
        "- Reduced weekly reporting effort with automation.",
        "## Projects",
        "- Launched a usage taxonomy migration.",
        "## Skills",
        "- SQL",
      ].join("\n"),
      resumeStatus: "validated",
      scope: "general_readiness",
    });

    expect(review.hard_gate_status.fact_guard).toBe("passed");
    expect(review.hard_gate_status.export_policy).toBe("enabled");
    expect(["ready_to_export", "recommended_polish"]).toContain(review.verdict);
    expect(review.findings.every((finding) => finding.route !== "evidence_gap")).toBe(true);
  });
});

function claim(patch: {
  claimStatus?: ClaimRow["claimStatus"];
  id: string;
  riskLevel?: ClaimRow["riskLevel"];
  staleReason?: string | null;
  supportStatus?: ClaimRow["supportStatus"];
}): ClaimRow {
  return {
    claimStatus: patch.claimStatus ?? "unvalidated",
    claimText: `Generated claim ${patch.id}`,
    createdAt: new Date("2026-06-30T12:00:00.000Z"),
    evidenceIds: patch.supportStatus === "supported" ? ["e1"] : [],
    id: patch.id,
    jobId: null,
    generatedDocumentId: null,
    mainResumeVersionId: "11111111-1111-4111-8111-111111111111",
    resumeVersionId: null,
    riskLevel: patch.riskLevel ?? "low",
    section: "experience",
    sourceQuotes: patch.supportStatus === "supported" ? ["Built dashboards"] : [],
    staleReason: patch.staleReason ?? null,
    supportStatus: patch.supportStatus ?? "unvalidated",
    workspaceId: "99999999-9999-4999-8999-999999999999",
    lastValidatedAt: null,
  };
}
