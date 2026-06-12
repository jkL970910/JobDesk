import { describe, expect, it } from "vitest";

import {
  buildStarStoryCard,
  buildStarStoryCards,
} from "../src/server/star-story-service";

describe("STAR story service", () => {
  it("promotes a project card and linked evidence into a ready STAR story", () => {
    const story = buildStarStoryCard(project(), [
      {
        id: "e1",
        text: "Built SQL models and dashboard slices for onboarding cohorts.",
        sourceQuote: "Built SQL models and dashboard slices for onboarding cohorts.",
        metrics: [{ value: "35% activation drop-off", source_quote: "35% activation drop-off" }],
        sensitivityLevel: "private",
        allowedUsage: ["interview"],
        publicSafeSummary: null,
        status: "approved",
        relatedProjectId: "p1",
      },
    ]);

    expect(story).toMatchObject({
      project_id: "p1",
      readiness: "ready",
      situation: "Product teams could not see onboarding drop-off.",
      task: "Identify activation friction.",
      evidence_count: 1,
    });
    expect(story.action.join(" ")).toContain("SQL models");
    expect(story.metrics).toContain("35% activation drop-off");
    expect(story.interview_angles).toContain("analytical execution");
  });

  it("flags thin stories with actionable gaps", () => {
    const story = buildStarStoryCard({
      ...project(),
      context: null,
      problem: null,
      actions: [],
      results: [],
      metrics: [],
      publicSafeSummary: null,
    });

    expect(story.readiness).toBe("thin");
    expect(story.gaps).toContain("Add situation/context.");
    expect(story.gaps).toContain("Add concrete actions.");
  });

  it("sorts ready stories before thinner stories", () => {
    const stories = buildStarStoryCards({
      projects: [
        {
          ...project(),
          id: "thin",
          context: null,
          problem: null,
          actions: [],
          results: [],
          metrics: [],
        },
        project({ id: "ready" }),
      ],
    });

    expect(stories.map((story) => story.project_id)).toEqual(["ready", "thin"]);
  });
});

function project(patch = {}) {
  return {
    id: "p1",
    title: "Onboarding analytics",
    context: "Product teams could not see onboarding drop-off.",
    problem: "Identify activation friction.",
    role: "Product analyst",
    actions: ["Mapped funnel steps and validated event quality."],
    results: ["Prioritized follow-up onboarding experiments."],
    metrics: [{ value: "35% activation drop-off", source_quote: "35% activation drop-off" }],
    technologies: ["SQL", "dashboarding"],
    stakeholders: ["product managers"],
    publicSafeSummary: "Improved visibility into onboarding conversion.",
    sensitivityLevel: "public_safe",
    status: "approved",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...patch,
  };
}
