import { describe, expect, it } from "vitest";

import {
  coerceResumeReviewScore,
  normalizeResumeReviewProviderOutput,
} from "../src/ai/resume-review-output-normalizer";

describe("resume review provider output normalizer", () => {
  it("normalizes section assessment drift without publishing raw provider shape", () => {
    const result = normalizeResumeReviewProviderOutput("section_assessment", {
      ats_notes: { note: "Headings are readable." },
      confidence: "medium",
      dimension_signals: {
        dimension: "readability",
        helped: "Role and employer are clear.",
        lowered: { note: "Impact is not front-loaded." },
        raise_score: ["Move strongest result higher."],
      },
      evidence_questions: { question: "Which metric proves the platform result?" },
      risk_flags: [{ risk: "Some internal wording needs public context." }],
      strengths: "Recent engineering role is visible.",
      weaknesses: { section: "Experience", note: "Impact needs sharper proof." },
    });

    expect(result.value).toMatchObject({
      ats_notes: ["Headings are readable."],
      confidence: 0.6,
      dimension_signals: [
        {
          dimension: "readability",
          helped: ["Role and employer are clear."],
          lowered: ["Impact is not front-loaded."],
          raise_score: ["Move strongest result higher."],
        },
      ],
      evidence_questions: ["Which metric proves the platform result?"],
      risk_flags: ["Some internal wording needs public context."],
      strengths: ["Recent engineering role is visible."],
      weaknesses: ["Experience: Impact needs sharper proof."],
    });
    expect(result.drift.map((entry) => entry.field)).toContain("dimension_signals");
  });

  it("normalizes rubric dimension suggested edit objects using suggestion/action semantics", () => {
    const result = normalizeResumeReviewProviderOutput("rubric_dimension", {
      rubric_item: {
        evidenceQuestions: [{ question: "Which metric proves impact?" }],
        findings: [{ finding: "Impact is visible." }],
        helpedScore: [{ note: "Production workflow scope is named." }],
        key: "impact_evidence",
        label: "Impact evidence",
        loweredScore: [{ note: "Metrics are missing." }],
        maxScore: "100",
        nextAction: { action: "Add one measurable outcome." },
        note: { summary: "Evidence exists but needs sharper proof." },
        raiseScore: [{ action: "Add a measurable outcome." }],
        score: "72/100",
      },
      suggested_edits: [
        {
          rationale: "This explains why the edit matters.",
          suggestion: "Move the strongest measurable impact bullet higher.",
        },
      ],
    });

    expect(result.value).toMatchObject({
      rubric_item: {
        maxScore: 100,
        nextAction: "Add one measurable outcome.",
        note: "Evidence exists but needs sharper proof.",
        score: 72,
      },
      suggested_edits: ["Move the strongest measurable impact bullet higher."],
    });
  });

  it("does not guess vague score labels as numeric scores", () => {
    expect(coerceResumeReviewScore("72/100")).toBe(72);
    expect(coerceResumeReviewScore("medium")).toBe("medium");
  });
});
