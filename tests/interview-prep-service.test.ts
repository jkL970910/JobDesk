import { describe, expect, it } from "vitest";

import { buildInterviewPrepPack } from "../src/server/interview-prep-service";
import type { StarStoryCard } from "../src/server/star-story-service";
import type { JDAnalysis } from "../src/schemas/jd-analysis";

describe("interview prep service", () => {
  it("builds a role-specific prep pack from a JD and STAR story bank", () => {
    const pack = buildInterviewPrepPack({
      job: jdAnalysis(),
      starStories: [story()],
      retrievedContext: [
        {
          source_entity_id: "e1",
          source_entity_type: "evidence",
          similarity: 0.72,
        },
      ],
    });

    expect(pack.status).toBe("ready");
    expect(pack.job_id).toBe("job-1");
    expect(pack.behavioral_questions.length).toBeGreaterThan(0);
    expect(pack.behavioral_questions[0]?.recommended_story_id).toBe("star-project-1");
    expect(pack.technical_review_topics.map((topic) => topic.topic)).toContain("SQL");
    expect(pack.company_research_prompts.join(" ")).toContain("Acme");
    expect(pack.practice_plan.join(" ")).toContain("mock screen");
    expect(pack.retrieved_context[0]?.source_entity_id).toBe("e1");
  });

  it("surfaces evidence gaps for high-importance requirements and thin stories", () => {
    const pack = buildInterviewPrepPack({
      job: jdAnalysis(),
      starStories: [
        {
          ...story(),
          gaps: ["Add grounded metrics if available."],
        },
      ],
      retrievedContext: [],
    });

    expect(pack.evidence_gaps.join(" ")).toContain("Prepare evidence for");
    expect(pack.evidence_gaps.join(" ")).toContain("Add grounded metrics");
  });
});

function jdAnalysis(): JDAnalysis {
  return {
    job_id: "job-1",
    original_jd_text: "Acme is hiring a Senior Product Analyst with SQL and experimentation depth.",
    job_facts: {
      company: "Acme",
      role_title: "Senior Product Analyst",
      level: "Senior",
      location: "Remote",
      responsibilities: ["Own funnel analytics"],
      preferred_qualifications: ["Experimentation experience"],
    },
    role_archetype: "hybrid",
    job_legitimacy: {
      tier: "high_confidence",
      signals: [],
      context_notes: [],
    },
    requirements: [
      {
        text: "Strong SQL and dashboard development experience.",
        source_quote: "Strong SQL and dashboard development experience.",
        requirement_type: "hard",
        importance: 0.92,
        keywords: ["SQL", "dashboard"],
        verified: true,
      },
      {
        text: "Can partner with product stakeholders.",
        source_quote: "Can partner with product stakeholders.",
        requirement_type: "soft",
        importance: 0.8,
        keywords: ["stakeholder"],
        verified: true,
      },
    ],
    role_signals: ["analytics"],
    keywords: ["SQL", "stakeholder"],
    interview_implications: ["impact measurement"],
  };
}

function story(): StarStoryCard {
  return {
    id: "star-project-1",
    project_id: "project-1",
    title: "Onboarding analytics",
    status: "approved",
    readiness: "ready",
    situation: "Product teams could not see onboarding drop-off.",
    task: "Identify activation friction.",
    action: ["Built SQL models and dashboard slices."],
    result: ["Prioritized experiments that improved activation."],
    metrics: ["35% activation drop-off identified"],
    technologies: ["SQL", "dashboarding"],
    stakeholders: ["product managers"],
    external_safe_summary: "Improved onboarding analytics visibility.",
    source_evidence_ids: ["e1"],
    evidence_count: 1,
    interview_angles: ["analytics", "impact measurement"],
    gaps: [],
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}
