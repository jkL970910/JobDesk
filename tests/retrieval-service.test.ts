import { describe, expect, it } from "vitest";

import {
  isEvidenceEligible,
  rankEvidenceForPolicy,
  type EvidenceRetrievalCandidate,
  type EvidenceRetrievalPolicy,
} from "../src/server/retrieval-service";

const resumePolicy: EvidenceRetrievalPolicy = {
  allowedUsage: "resume",
  externalFacing: true,
  excludeInferred: true,
  limit: 10,
};

describe("retrieval service", () => {
  it("blocks evidence that is not eligible for external resume generation", () => {
    expect(isEvidenceEligible(candidate(), resumePolicy)).toBe(true);
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
          updatedAt: "2026-01-02T00:00:00.000Z",
        }),
        candidate({
          id: "sql",
          text: "Built SQL dashboards for onboarding funnel analytics.",
          source_quote: "Built SQL dashboards for onboarding funnel analytics.",
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
    expect(ranked[0]?.retrieval_score).toBeGreaterThan(
      ranked[1]?.retrieval_score ?? 0,
    );
    expect(ranked.some((item) => item.id === "sensitive")).toBe(false);
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
