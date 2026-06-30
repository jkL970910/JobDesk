import { describe, expect, it } from "vitest";

import { generatedClaims } from "../src/db/schema";
import {
  buildGeneratedResumePolishProposal,
  buildGeneratedResumeReadinessReview,
} from "../src/server/generated-resume-readiness-review";

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

  it("builds a polish proposal from generated-readiness findings without converting evidence gaps into tasks", () => {
    const review = buildGeneratedResumeReadinessReview({
      baseline: null,
      claims: [
        claim({ id: "c1", claimStatus: "supported", supportStatus: "supported" }),
        claim({ id: "c2", claimStatus: "supported", supportStatus: "supported" }),
      ],
      documentId: "33333333-3333-4333-8333-333333333333",
      documentType: "main_resume",
      generatedLabel: "Generated main resume · general readiness review",
      now: new Date("2026-06-30T12:00:00.000Z"),
      resumeMarkdown: [
        "## Experience",
        "- Built onboarding dashboards for product teams.",
      ].join("\n"),
      resumeStatus: "validated",
      scope: "general_readiness",
    });
    const proposal = buildGeneratedResumePolishProposal({
      mainResumeId: "33333333-3333-4333-8333-333333333333",
      readinessReview: review,
      resumeMarkdown: "## Experience\n- Built onboarding dashboards for product teams.",
    });

    expect(proposal.source_main_resume_id).toBe("33333333-3333-4333-8333-333333333333");
    expect(proposal.edits.every((edit) => edit.route !== "evidence_gap")).toBe(true);
    expect(proposal.preview_markdown).toContain("Built onboarding dashboards");
    expect(proposal.preview_markdown).toContain("## Generated polish focus");
    expect(proposal.preview_markdown).not.toContain("JobDesk polish proposal");
  });

  it("always makes proposal application visible even when a summary already exists", () => {
    const review = buildGeneratedResumeReadinessReview({
      baseline: null,
      claims: [
        claim({ id: "c1", claimStatus: "supported", supportStatus: "supported" }),
      ],
      documentId: "44444444-4444-4444-8444-444444444444",
      documentType: "main_resume",
      generatedLabel: "Generated main resume · general readiness review",
      now: new Date("2026-06-30T12:00:00.000Z"),
      resumeMarkdown: [
        "## Summary",
        "Evidence-backed product candidate.",
        "## Experience",
        "- Built onboarding dashboards for product teams.",
      ].join("\n"),
      resumeStatus: "validated",
      scope: "general_readiness",
    });
    const originalMarkdown = [
      "## Summary",
      "Evidence-backed product candidate.",
      "## Experience",
      "- Built onboarding dashboards for product teams.",
    ].join("\n");
    const proposal = buildGeneratedResumePolishProposal({
      mainResumeId: "44444444-4444-4444-8444-444444444444",
      readinessReview: review,
      resumeMarkdown: originalMarkdown,
    });

    expect(proposal.preview_markdown).not.toBe(originalMarkdown);
    expect(proposal.preview_markdown).toMatch(/^## Generated polish focus/);
    expect(proposal.preview_markdown).toContain("## Summary");
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
