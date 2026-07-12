import { describe, expect, it } from "vitest";

import { buildStorySeedCandidatesFromProfileExperiences } from "../src/server/story-seeding";
import type { ProfileEvidenceExtraction } from "../src/schemas/profile-evidence-extraction";

describe("story seeding", () => {
  it("clusters related role bullets into one pending Work Initiative seed", () => {
    const result = buildStorySeedCandidatesFromProfileExperiences(
      [
        profileExperience({
          bullets: [
            "Built Redis cache infrastructure that reduced session lookup latency.",
            "Provisioned AWS CDK infrastructure for distributed cache dependencies.",
            "Optimized session latency for the delivery service cache path.",
            "Technical Skills: Java React AWS Redis",
          ],
          employer: "Nimbus Labs",
          title: "Software Engineer",
        }),
      ],
      [],
      { sourceDocumentId: "source-1", sourceTitle: "Resume source" },
    );

    expect(result.initiativeDrafts).toHaveLength(1);
    expect(result.reviewCandidates).toHaveLength(0);
    expect(result.initiativeDrafts[0]).toMatchObject({
      work_experience_ref: "Nimbus Labs · Software Engineer",
      actions: [
        "Built Redis cache infrastructure that reduced session lookup latency.",
        "Provisioned AWS CDK infrastructure for distributed cache dependencies.",
        "Optimized session latency for the delivery service cache path.",
      ],
      technologies: expect.arrayContaining(["AWS", "CDK", "Redis"]),
      status: "pending",
    });
  });

  it("routes ambiguous single-bullet story seeds to review candidates", () => {
    const result = buildStorySeedCandidatesFromProfileExperiences(
      [
        profileExperience({
          bullets: ["Built internal tooling for service owners."],
          employer: "Nimbus Labs",
          title: "Software Engineer",
        }),
      ],
      [],
      { sourceDocumentId: "source-2", sourceTitle: "Resume source" },
    );

    expect(result.initiativeDrafts).toHaveLength(0);
    expect(result.reviewCandidates).toHaveLength(1);
    expect(result.reviewCandidates[0]?.payload).toMatchObject({
      kind: "scope_review_candidate",
      proposedScope: "work_initiative",
      classifierAcceptedScope: "work_initiative",
      sourceDocumentId: "source-2",
      suggestedAction: "save_as_work_initiative",
    });
  });

  it("keeps same-company roles separated", () => {
    const result = buildStorySeedCandidatesFromProfileExperiences(
      [
        profileExperience({
          bullets: ["Built Redis cache infrastructure that reduced session lookup latency."],
          employer: "Amazon",
          title: "Software Engineer Intern",
        }),
        profileExperience({
          bullets: ["Built Redis cache observability that improved service reliability."],
          employer: "Amazon",
          title: "Software Development Engineer",
        }),
      ],
      [],
      { sourceDocumentId: "source-3", sourceTitle: "Resume source" },
    );

    expect(result.initiativeDrafts.map((draft) => draft.work_experience_ref)).toEqual([
      "Amazon · Software Engineer Intern",
      "Amazon · Software Development Engineer",
    ]);
  });
});

function profileExperience(args: {
  bullets: string[];
  employer: string;
  title: string;
}): ProfileEvidenceExtraction["profile"]["experience"][number] {
  return {
    bullets: args.bullets.map((bullet) => field(bullet)),
    employer: field(args.employer),
    end_date: null,
    start_date: field("2024"),
    title: field(args.title),
  };
}

function field(value: string) {
  return {
    confidence: 0.95,
    source_quote: value,
    value,
    verified: true,
  };
}
