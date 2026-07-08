import { describe, expect, it } from "vitest";

import {
  invalidScopeDecision,
  pendingCanonicalScopeDecision,
  reviewQueueScopeDecision,
} from "../src/server/scope-decision";
import { normalizeExtractedAssetCandidate } from "../src/server/extracted-asset-candidate";

describe("scope decision contracts", () => {
  it("normalizes extracted asset candidates without touching scope intent", () => {
    const candidate = normalizeExtractedAssetCandidate({
      content: "  Built   AWS CDK cache   infrastructure  ",
      nearbyHeadings: [" Experience ", "Experience", " Amazon "],
      proposedScope: "work_initiative",
      sourceQuote: "  Built cache infra  ",
      sourceSection: "  Work Experience  ",
    });

    expect(candidate).toMatchObject({
      content: "Built AWS CDK cache infrastructure",
      nearbyHeadings: ["Experience", "Amazon"],
      proposedScope: "work_initiative",
      sourceQuote: "Built cache infra",
      sourceSection: "Work Experience",
    });
  });

  it("marks review-queue decisions as user-review required", () => {
    expect(
      reviewQueueScopeDecision({
        possibleAlternatives: ["work_initiative", "evidence_claim"],
        reason: "Too ambiguous to persist as a canonical story.",
      }),
    ).toEqual({
      acceptedScope: "unassigned",
      canonicalLinkPolicy: "review_queue_only",
      confidence: "low",
      needsUserReview: true,
      possibleAlternatives: ["work_initiative", "evidence_claim"],
      reason: "Too ambiguous to persist as a canonical story.",
    });
  });

  it("keeps high-confidence canonical decisions pending but not automatically review-blocked", () => {
    expect(
      pendingCanonicalScopeDecision({
        acceptedScope: "evidence_claim",
        confidence: "high",
        reason: "Atomic sourced claim.",
      }),
    ).toEqual({
      acceptedScope: "evidence_claim",
      canonicalLinkPolicy: "can_persist_to_canonical_pending",
      confidence: "high",
      needsUserReview: false,
      possibleAlternatives: [],
      reason: "Atomic sourced claim.",
    });
  });

  it("rejects invalid scope decisions without allowing canonical persistence", () => {
    expect(invalidScopeDecision("Bullet-shaped action cannot become a Work Experience.")).toEqual({
      acceptedScope: "unassigned",
      canonicalLinkPolicy: "reject_as_invalid_scope",
      confidence: "low",
      needsUserReview: true,
      possibleAlternatives: [],
      reason: "Bullet-shaped action cannot become a Work Experience.",
    });
  });
});
