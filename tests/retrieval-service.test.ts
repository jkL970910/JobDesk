import { describe, expect, it } from "vitest";

import {
  isEvidenceEligible,
  rankEvidenceForPolicy,
  retrieveSourceMaterialForEvidenceGaps,
  toRetrievedSourceMaterialItem,
  type EvidenceRetrievalCandidate,
} from "../src/server/retrieval-service";
import { getRetrievalPolicy } from "../src/server/retrieval-policy";
import { sourceChunkIndexType } from "../src/server/source-chunk-service";

const resumePolicy = getRetrievalPolicy("resume_generation", { limit: 10 });

describe("retrieval service", () => {
  it("blocks evidence that is not eligible for external resume generation", () => {
    expect(isEvidenceEligible(candidate({ sensitivity_level: "public_safe" }), resumePolicy)).toBe(true);
    expect(
      isEvidenceEligible(
        candidate({ public_safe_summary: "Built dashboard reporting for a product team." }),
        resumePolicy,
      ),
    ).toBe(true);
    expect(isEvidenceEligible(candidate(), resumePolicy)).toBe(false);
    expect(
      isEvidenceEligible(candidate({ status: "pending" }), resumePolicy),
    ).toBe(false);
    expect(
      isEvidenceEligible(candidate({ needs_user_confirmation: true }), resumePolicy),
    ).toBe(false);
    expect(
      isEvidenceEligible(candidate({ allowed_usage: ["interview"] }), resumePolicy),
    ).toBe(false);
    expect(
      isEvidenceEligible(
        candidate({ allowed_usage: ["resume", "internal_only"] }),
        resumePolicy,
      ),
    ).toBe(false);
    expect(
      isEvidenceEligible(candidate({ sensitivity_level: "sensitive" }), resumePolicy),
    ).toBe(false);
    expect(
      isEvidenceEligible(candidate({ evidence_type: "inferred" }), resumePolicy),
    ).toBe(false);
  });

  it("ranks public-safe summaries as searchable resume evidence", () => {
    const ranked = rankEvidenceForPolicy({
      policy: { ...resumePolicy, limit: 2 },
      job: { keywords: ["stakeholder", "reporting"] },
      candidates: [
        candidate({
          id: "safe-summary",
          text: "Led Project Falcon work for Client A.",
          source_quote: "Led Project Falcon work for Client A.",
          public_safe_summary:
            "Led stakeholder reporting for cross-functional product teams.",
        }),
        candidate({
          id: "other",
          text: "Built SQL dashboards.",
          source_quote: "Built SQL dashboards.",
          sensitivity_level: "public_safe",
        }),
      ],
    });

    expect(ranked[0]?.id).toBe("safe-summary");
    expect(ranked[0]?.retrieval_policy).toBe("resume_generation");
    expect(ranked[0]?.eligibility_reason).toContain("public-safe");
    expect(ranked[0]?.reason_for_selection.join(" ")).toContain("stakeholder");
  });

  it("ranks eligible evidence by job term overlap and keeps selection reasons", () => {
    const ranked = rankEvidenceForPolicy({
      policy: { ...resumePolicy, limit: 2 },
      job: {
        keywords: ["sql", "dashboards"],
        requirements: [
          {
            text: "dashboard development",
            keywords: ["dashboard", "development"],
            requirement_type: "hard",
            importance: 0.9,
          },
        ],
        role_signals: ["analytics"],
      },
      candidates: [
        candidate({
          id: "stakeholder",
          text: "Led stakeholder reporting.",
          source_quote: "Led stakeholder reporting.",
          sensitivity_level: "public_safe",
          updatedAt: "2026-01-02T00:00:00.000Z",
        }),
        candidate({
          id: "sql",
          text: "Built SQL dashboards for onboarding funnel analytics.",
          source_quote: "Built SQL dashboards for onboarding funnel analytics.",
          sensitivity_level: "public_safe",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }),
        candidate({
          id: "sensitive",
          text: "Built sensitive dashboards.",
          source_quote: "Built sensitive dashboards.",
          sensitivity_level: "sensitive",
        }),
      ],
    });

    expect(ranked.map((item) => item.id)).toEqual(["sql", "stakeholder"]);
    expect(ranked[0]?.reason_for_selection.join(" ")).toContain("sql");
    expect(ranked[0]?.matched_terms).toContain("sql");
    expect(ranked[0]?.score_breakdown.keyword).toBeGreaterThan(0);
    expect(ranked[0]?.score_breakdown.semantic).toBeGreaterThanOrEqual(0);
    expect(ranked[0]?.score_breakdown.metric).toBe(0);
    expect(ranked[0]?.score_breakdown.total).toBe(ranked[0]?.retrieval_score);
    expect(ranked[0]?.retrieval_score).toBeGreaterThan(
      ranked[1]?.retrieval_score ?? 0,
    );
    expect(ranked.some((item) => item.id === "sensitive")).toBe(false);
  });

  it("uses different eligibility for interview prep than resume generation", () => {
    const interviewPolicy = getRetrievalPolicy("interview_prep");
    const interviewOnlyInternal = candidate({
      allowed_usage: ["interview", "internal_only"],
      sensitivity_level: "private",
      evidence_type: "inferred",
      public_safe_summary: null,
    });

    expect(isEvidenceEligible(interviewOnlyInternal, resumePolicy)).toBe(false);
    expect(isEvidenceEligible(interviewOnlyInternal, interviewPolicy)).toBe(true);
  });

  it("allows reviewable material for positioning analysis without making it resume eligible", () => {
    const positioningPolicy = getRetrievalPolicy("positioning_analysis");
    const pendingReviewable = candidate({
      allowed_usage: [],
      status: "pending",
      needs_user_confirmation: true,
      sensitivity_level: "sensitive",
      evidence_type: "inferred",
    });

    expect(isEvidenceEligible(pendingReviewable, resumePolicy)).toBe(false);
    expect(isEvidenceEligible(pendingReviewable, positioningPolicy)).toBe(true);
  });

  it("keeps source chunks out of resume-generation policy", () => {
    expect(getRetrievalPolicy("resume_generation").allowedIndexTypes).toEqual([
      "evidence_index",
    ]);
    expect(getRetrievalPolicy("evidence_enrichment").allowedIndexTypes).toContain(
      sourceChunkIndexType,
    );
  });

  it("retrieves source chunks only as evidence-enrichment material", async () => {
    const results = await retrieveSourceMaterialForEvidenceGaps("activation metrics", {
      limit: 1,
    });
    expect(Array.isArray(results)).toBe(true);
  });

  it("maps source chunks as possible source material, not resume evidence", () => {
    const mapped = toRetrievedSourceMaterialItem({
      source_entity_id: "11111111-2222-5333-8444-000000000000",
      source_entity_type: "source_document",
      index_type: sourceChunkIndexType,
      chunk_text: "Raw work note about activation dashboard metrics.",
      similarity: 0.42,
      metadata: {
        source_document_id: "11111111-2222-4333-8444-555555555555",
        source_type: "work_summary",
        title: "Launch notes",
        chunk_index: 2,
        lifecycle_status: "parsed",
        parse_quality_status: "usable",
        sensitivity_hint: "unknown",
      },
    });

    expect(mapped).toMatchObject({
      source_document_id: "11111111-2222-4333-8444-555555555555",
      source_type: "work_summary",
      title: "Launch notes",
      chunk_index: 2,
      retrieval_policy: "evidence_enrichment",
      retrieval_score: 42,
      reason_for_selection: [
        "possible source material for evidence gap",
        "semantic match 42%",
      ],
    });
  });
});

function candidate(
  patch: Partial<EvidenceRetrievalCandidate> = {},
): EvidenceRetrievalCandidate {
  return {
    id: "e1",
    text: "Built SQL dashboards.",
    source_quote: "Built SQL dashboards.",
    evidence_type: "extracted",
    metrics: [],
    sensitivity_level: "private",
    allowed_usage: ["resume"],
    public_safe_summary: null,
    status: "approved",
    needs_user_confirmation: false,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...patch,
  };
}
