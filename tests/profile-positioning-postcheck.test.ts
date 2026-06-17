import { describe, expect, it } from "vitest";

import type { ProfilePositioningEvidenceContext } from "../src/ai/profile-positioning";
import {
  ProfilePositioningPostCheckError,
  validateProfilePositioningReport,
} from "../src/server/profile-positioning-repository";
import { buildDirection } from "./support/profile-positioning-fixtures";

describe("profile positioning deterministic post-check", () => {
  it("rejects unknown supporting evidence ids", () => {
    expect(() =>
      validateProfilePositioningReport(
        buildReport([buildDirection("missing-evidence")]),
        [buildEvidence("evidence-1")],
      ),
    ).toThrow(ProfilePositioningPostCheckError);
  });

  it("rejects directions without supporting evidence", () => {
    const direction = {
      ...buildDirection("evidence-1"),
      supporting_evidence: [],
    };
    expect(() =>
      validateProfilePositioningReport(buildReport([direction]), [buildEvidence("evidence-1")]),
    ).toThrow(/missing supporting evidence/);
  });

  it("requires missing evidence questions for low or medium confidence directions", () => {
    const direction = {
      ...buildDirection("evidence-1"),
      confidence: "low" as const,
      missing_evidence_questions: [],
      support_level: "aspirational_gap" as const,
    };
    expect(() =>
      validateProfilePositioningReport(buildReport([direction]), [buildEvidence("evidence-1")]),
    ).toThrow(/missing evidence questions/);
  });
});

function buildReport(directions: ReturnType<typeof buildDirection>[]) {
  return {
    summary: "Evidence-backed positioning report.",
    generated_at: new Date().toISOString(),
    directions,
    global_strengths: ["Analytics execution"],
    global_gaps: ["Product strategy scope"],
  };
}

function buildEvidence(id: string): ProfilePositioningEvidenceContext {
  return {
    id,
    text: "Built activation funnel dashboard.",
    source_quote: "Built activation funnel dashboard.",
    evidence_type: "extracted",
    status: "approved",
    allowed_usage: ["resume"],
    needs_user_confirmation: false,
    metrics: [],
    sensitivity_level: "public_safe",
    public_safe_summary: null,
  };
}
