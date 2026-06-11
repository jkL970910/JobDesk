import { describe, expect, it } from "vitest";

import {
  extractResumeBullets,
  validateBulletClaimCoverage,
  validateTailoredResumeDraft,
} from "../src/server/tailored-resume-guardrails";
import type { TailoredResumeDraft } from "../src/schemas/tailored-resume";

describe("tailored resume guardrails", () => {
  it("rejects claims without evidence mappings", () => {
    expect(() =>
      validateTailoredResumeDraft({
        draft: buildDraft({ evidence_ids: [] }),
        eligibleEvidence: [eligibleEvidence()],
      }),
    ).toThrow(/no evidence mapping/);
  });

  it("rejects claims without source quotes", () => {
    expect(() =>
      validateTailoredResumeDraft({
        draft: buildDraft({ source_quotes: [] }),
        eligibleEvidence: [eligibleEvidence()],
      }),
    ).toThrow(/no source quote/);
  });

  it("rejects claims referencing ineligible evidence", () => {
    expect(() =>
      validateTailoredResumeDraft({
        draft: buildDraft({ evidence_ids: ["e2"] }),
        eligibleEvidence: [eligibleEvidence()],
      }),
    ).toThrow(/ineligible evidence/);
  });

  it("rejects claims whose quotes do not belong to referenced evidence", () => {
    expect(() =>
      validateTailoredResumeDraft({
        draft: buildDraft({ source_quotes: ["Migrated Kubernetes clusters"] }),
        eligibleEvidence: [eligibleEvidence()],
      }),
    ).toThrow(/not supported by its evidence/);
  });

  it("rejects resume drafts without any claims", () => {
    expect(() =>
      validateTailoredResumeDraft({
        draft: { ...buildDraft(), claims: [] },
        eligibleEvidence: [eligibleEvidence()],
      }),
    ).toThrow(/at least one generated claim/);
  });

  it("extracts markdown bullets for coverage checks", () => {
    expect(
      extractResumeBullets("## Experience\n- Built dashboards\n* Led reporting\n1. Improved onboarding"),
    ).toEqual(["built dashboards", "led reporting", "improved onboarding"]);
  });

  it("accepts resume bullets that have strong token overlap with generated claims", () => {
    expect(
      validateBulletClaimCoverage({
        resumeMarkdown: "- Funnel analysis for onboarding flows",
        claims: ["Built dashboards for onboarding funnel analysis and activation metrics"],
      }),
    ).toMatchObject({ passed: true });
  });

  it("rejects resume drafts with bullets missing claim coverage", () => {
    expect(() =>
      validateTailoredResumeDraft({
        draft: {
          ...buildDraft(),
          resume_markdown: "- Built dashboards\n- Migrated Kubernetes clusters",
        },
        eligibleEvidence: [eligibleEvidence()],
      }),
    ).toThrow(/resume bullet is not mapped/);
  });

  it("allows extra claims because summaries and skills may also need provenance", () => {
    expect(
      validateBulletClaimCoverage({
        resumeMarkdown: "- Built dashboards",
        claims: ["Built dashboards", "Candidate has SQL experience"],
      }),
    ).toMatchObject({
      passed: true,
    });
  });
});

function buildDraft(
  claimPatch: Partial<TailoredResumeDraft["claims"][number]> = {},
): TailoredResumeDraft {
  return {
    title: "Resume",
    resume_json: {},
    resume_markdown: "- Built dashboards",
    missing_evidence_questions: [],
    claims: [
      {
        claim_text: "Built dashboards",
        section: "experience",
        evidence_ids: ["e1"],
        source_quotes: ["Built dashboards"],
        risk_level: "low",
        ...claimPatch,
      },
    ],
  };
}

function eligibleEvidence() {
  return {
    id: "e1",
    text: "Built dashboards",
    source_quote: "Built dashboards",
  };
}
