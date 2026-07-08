import { describe, expect, it } from "vitest";

import { guardWorkExperienceDraftsForPersistence } from "../src/server/extraction-scope-guardrail";
import type { ProfileEvidenceExtraction } from "../src/schemas/profile-evidence-extraction";

describe("extraction scope persistence guardrails", () => {
  it("keeps valid role containers eligible for canonical Work Experience persistence", () => {
    const result = guardWorkExperienceDraftsForPersistence([
      buildWorkExperienceDraft({
        employer: "Amazon",
        role_title: "Software Development Engineer Intern",
        start_date: "2022",
        end_date: "2022",
        team: "Delivery Service Partner",
      }),
    ]);

    expect(result.accepted).toHaveLength(1);
    expect(result.reviewNotes).toHaveLength(0);
    expect(result.decisions[0]).toMatchObject({
      disposition: "accepted",
      classification: {
        decision: {
          acceptedScope: "work_experience",
          canonicalLinkPolicy: "can_persist_to_canonical_pending",
        },
      },
    });
  });

  it("routes bullet-shaped Work Experience candidates to review instead of canonical persistence", () => {
    const result = guardWorkExperienceDraftsForPersistence(
      [
        buildWorkExperienceDraft({
          employer: "Migrated service to region X",
          role_title: "Reduced latency by 35%",
          summary: "Built AWS CDK infrastructure for distributed cache rollout.",
        }),
      ],
      { sourceTitle: "Resume import" },
    );

    expect(result.accepted).toHaveLength(0);
    expect(result.decisions[0]).toMatchObject({
      disposition: "rejected",
      classification: {
        decision: {
          acceptedScope: "unassigned",
          canonicalLinkPolicy: "reject_as_invalid_scope",
        },
      },
    });
    expect(result.reviewNotes[0]).toContain("Scope review needed from Resume import");
    expect(result.reviewNotes[0]).toContain("was not saved as a Work Experience");
  });
});

function buildWorkExperienceDraft(
  overrides: Partial<ProfileEvidenceExtraction["work_experiences"][number]>,
): ProfileEvidenceExtraction["work_experiences"][number] {
  return {
    employer: "Acme",
    role_title: "Software Engineer",
    team: null,
    location: null,
    start_date: "2020",
    end_date: "2021",
    summary: null,
    status: "pending",
    ...overrides,
  };
}
