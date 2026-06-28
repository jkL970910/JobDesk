import { describe, expect, it } from "vitest";

import { buildDimensionDetail } from "../src/components/resume-review-dimension-detail";

describe("resume review dimension detail", () => {
  it("keeps privacy evidence prompts out of the project depth card", () => {
    const detail = buildDimensionDetail({
      dimension: {
        id: "project_depth",
        label: "Project depth",
        percent: 0.67,
      },
      missingEvidenceQuestions: [
        "Which bullets are safe to share publicly, and which need external-safe rewriting?",
        "Which project had the clearest ownership, scope, technical decision, and result?",
      ],
      recommendedActions: [
        "Add source-backed project context, metrics, ownership, or linked evidence before regenerating.",
        "Use external-safe wording before approving evidence for resume use.",
      ],
      riskFlags: ["Some internal wording may need public-safe rewriting."],
      strengths: ["Project or initiative signals are visible."],
      weaknesses: ["Project stories need clearer context, actions, and results."],
    });

    expect(detail.evidencePrompts).toEqual([
      "Which project had the clearest ownership, scope, technical decision, and result?",
    ]);
    expect(detail.findings.map((finding) => finding.text)).toEqual([
      "Project or initiative signals are visible.",
      "Project stories need clearer context, actions, and results.",
      "Add source-backed project context, metrics, ownership, or linked evidence before regenerating.",
    ]);
    expect(detail.nextAction).toContain("project context");
    expect(detail.scoreLabel).toBe("Moderate");
  });

  it("shows external-safe prompts on the privacy card", () => {
    const detail = buildDimensionDetail({
      dimension: {
        id: "privacy",
        label: "Privacy and confidentiality",
      },
      missingEvidenceQuestions: [
        "Which bullets are safe to share publicly, and which need external-safe rewriting?",
        "Which project had the clearest ownership, scope, technical decision, and result?",
      ],
      recommendedActions: ["Use external-safe wording before approving evidence for resume use."],
      riskFlags: ["Some internal wording may need public-safe rewriting."],
      strengths: [],
      weaknesses: [],
    });

    expect(detail.evidencePrompts).toEqual([
      "Which bullets are safe to share publicly, and which need external-safe rewriting?",
    ]);
    expect(detail.findings.map((finding) => finding.text)).toEqual([
      "Use external-safe wording before approving evidence for resume use.",
      "Some internal wording may need public-safe rewriting.",
    ]);
  });

  it("explains moderate readability scores with explicit deductions and improvements", () => {
    const detail = buildDimensionDetail({
      dimension: {
        id: "readability",
        label: "Readability",
        percent: 10 / 15,
      },
      missingEvidenceQuestions: [],
      recommendedActions: [],
      riskFlags: [],
      strengths: [],
      weaknesses: [],
    });

    expect(detail.scoreLabel).toBe("Moderate");
    expect(detail.helpedScore).toContain("Resume is generally scan-friendly.");
    expect(detail.loweredScore).toContain("Target role may not be immediately obvious.");
    expect(detail.loweredScore).toContain("Strongest evidence is not prioritized in the first scan.");
    expect(detail.wouldRaiseScore).toContain("Add a clear target headline.");
  });
});
