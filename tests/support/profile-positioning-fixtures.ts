import type { PositioningDirection } from "../../src/schemas/profile-positioning";

export function buildDirection(evidenceId: string): PositioningDirection {
  return {
    id: "data-product-manager",
    target_role: "Data Product Manager",
    role_family: "data",
    fit_score: 78,
    confidence: "medium",
    support_level: "medium_fit",
    positioning_angle: "Lead with analytics execution and product funnel ownership.",
    supporting_evidence: [
      {
        evidence_id: evidenceId,
        reason: "Shows analytics execution around an activation funnel.",
        signal_tags: ["analytics", "activation", "dashboard"],
      },
    ],
    evidence_strength_explanation:
      "Strong analytics signal with a need for more strategy evidence.",
    missing_evidence_questions: ["Which product decision changed after the dashboard?"],
    resume_emphasis: {
      summary_angle: "Analytics-driven product operator.",
      skills_to_emphasize: ["SQL", "dashboarding"],
      project_ordering_guidance: ["Lead with activation funnel work."],
      keywords: ["activation", "funnel", "analytics"],
      deprioritize: ["unrelated coursework"],
    },
    risks: ["Product strategy scope needs more evidence."],
  };
}
