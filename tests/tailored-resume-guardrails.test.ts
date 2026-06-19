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

  it("rejects claims whose primary evidence is not listed first", () => {
    expect(() =>
      validateTailoredResumeDraft({
        draft: buildDraft({
          primary_evidence_id: "e1",
          evidence_ids: ["e2", "e1"],
        }),
        eligibleEvidence: [
          eligibleEvidence(),
          { id: "e2", text: "Built dashboards", source_quote: "Built dashboards" },
        ],
      }),
    ).toThrow(/primary evidence first/);
  });

  it("rejects claims without a quote from primary evidence", () => {
    expect(() =>
      validateTailoredResumeDraft({
        draft: buildDraft({
          primary_evidence_id: "e1",
          evidence_ids: ["e1", "e2"],
          source_quotes: ["Reduced onboarding dropoff by 12%"],
        }),
        eligibleEvidence: [
          eligibleEvidence(),
          {
            id: "e2",
            text: "Reduced onboarding dropoff by 12%",
            source_quote: "Reduced onboarding dropoff by 12%",
          },
        ],
      }),
    ).toThrow(/no source quote from its primary evidence/);
  });

  it("rejects claims whose quotes do not belong to referenced evidence", () => {
    expect(() =>
      validateTailoredResumeDraft({
        draft: buildDraft({ source_quotes: ["Migrated Kubernetes clusters"] }),
        eligibleEvidence: [eligibleEvidence()],
      }),
    ).toThrow(/no source quote from its primary evidence/);
  });

  it("accepts public-safe summaries as de-identified claim support", () => {
    expect(() =>
      validateTailoredResumeDraft({
        draft: {
          ...buildDraft({
            claim_text: "Led stakeholder reporting for cross-functional product teams",
            source_quotes: ["Led stakeholder reporting for cross-functional product teams"],
          }),
          resume_markdown: "- Led stakeholder reporting for cross-functional product teams",
        },
        eligibleEvidence: [
          {
            ...eligibleEvidence(),
            source_quote: "Led Project Falcon reporting for Client A",
            text: "Led Project Falcon reporting for Client A",
            public_safe_summary:
              "Led stakeholder reporting for cross-functional product teams",
          },
        ],
      }),
    ).not.toThrow();
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
        primary_evidence_id: "e1",
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
