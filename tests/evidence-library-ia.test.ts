import { describe, expect, it } from "vitest";

import {
  buildEvidenceLibraryIaCounts,
  isCanonicalLibraryAsset,
  shouldApproveEvidenceClaim,
  shouldBuildStoryTarget,
  shouldLinkEvidenceClaim,
  shouldReviewWorkExperienceAsset,
} from "../src/lib/evidence-library-ia";

describe("Evidence Library IA semantics", () => {
  it("counts Library tabs as canonical assets even when they still need work", () => {
    const counts = buildEvidenceLibraryIaCounts({
      cleanupCount: 0,
      evidenceClaims: [
        evidenceClaim({ status: "approved", allowed_usage: ["resume"] }),
        evidenceClaim({ status: "pending", public_safe_summary: null }),
        evidenceClaim({ status: "rejected" }),
      ],
      importReviewTasks: [],
      interviewStories: [{ readiness: "ready" }, { readiness: "needs_review" }],
      storyTargets: [
        storyTarget({ status: "approved", complete: true }),
        storyTarget({ status: "pending", complete: false }),
        storyTarget({ status: "rejected", complete: false }),
      ],
      strengthenEvidenceTasks: [],
      workExperiences: [
        { status: "approved" },
        { status: "pending" },
        { status: "rejected" },
      ],
    });

    expect(counts.library).toEqual({
      evidenceClaims: 2,
      interviewStories: 2,
      storyTargets: 2,
      workExperiences: 2,
    });
  });

  it("counts Work Queue tabs as unresolved actions instead of asset totals", () => {
    const counts = buildEvidenceLibraryIaCounts({
      cleanupCount: 3,
      evidenceClaims: [
        evidenceClaim({ status: "approved", allowed_usage: ["resume"] }),
        evidenceClaim({ status: "approved", allowed_usage: ["interview"] }),
        evidenceClaim({ status: "pending", related_initiative_id: "initiative-1" }),
        evidenceClaim({ status: "pending" }),
        evidenceClaim({ status: "rejected" }),
      ],
      importReviewTasks: [
        { status: "open" },
        { status: "answered" },
        { status: "converted" },
        { status: "dismissed" },
      ],
      interviewStories: [],
      storyTargets: [
        storyTarget({ status: "approved", complete: true }),
        storyTarget({ status: "approved", complete: false }),
        storyTarget({ status: "pending", complete: false }),
        storyTarget({ status: "rejected", complete: false }),
      ],
      strengthenEvidenceTasks: [
        { status: "open" },
        { status: "answered" },
        { status: "converted" },
      ],
      workExperiences: [
        { status: "approved" },
        { status: "pending" },
        { status: "needs_update" },
        { status: "rejected" },
      ],
    });

    expect(counts.workQueue).toEqual({
      approveEvidence: 3,
      buildStoryTargets: 2,
      cleanup: 3,
      importReview: 2,
      linkEvidence: 3,
      reviewWorkExperience: 2,
      strengthenEvidence: 2,
    });
  });

  it("keeps guardrail units separate across Work Experience, Story Target, and Evidence Claim actions", () => {
    expect(shouldReviewWorkExperienceAsset({ status: "pending" })).toBe(true);
    expect(shouldReviewWorkExperienceAsset({ status: "approved" })).toBe(false);

    expect(shouldBuildStoryTarget(storyTarget({ status: "pending", complete: false }))).toBe(true);
    expect(shouldBuildStoryTarget(storyTarget({ status: "approved", complete: true }))).toBe(false);

    expect(
      shouldApproveEvidenceClaim(
        evidenceClaim({
          allowed_usage: ["resume"],
          public_safe_summary: "External-safe summary.",
          sensitivity_level: "private",
          status: "approved",
        }),
      ),
    ).toBe(false);
    expect(shouldApproveEvidenceClaim(evidenceClaim({ status: "pending" }))).toBe(true);
    expect(shouldLinkEvidenceClaim(evidenceClaim({ status: "pending" }))).toBe(true);
    expect(
      shouldLinkEvidenceClaim(evidenceClaim({ status: "pending", related_initiative_id: "initiative-1" })),
    ).toBe(false);

    expect(isCanonicalLibraryAsset({ status: "pending" })).toBe(true);
    expect(isCanonicalLibraryAsset({ status: "rejected" })).toBe(false);
  });
});

function evidenceClaim(
  patch: Partial<Parameters<typeof shouldApproveEvidenceClaim>[0]> = {},
): Parameters<typeof shouldApproveEvidenceClaim>[0] {
  return {
    allowed_usage: [],
    needs_user_confirmation: false,
    public_safe_summary: "Safe summary",
    sensitivity_level: "public_safe",
    status: "pending",
    ...patch,
  };
}

function storyTarget({
  complete,
  status,
}: {
  complete: boolean;
  status: string;
}): Parameters<typeof shouldBuildStoryTarget>[0] {
  return complete
    ? {
        actions: ["Led implementation"],
        context: "Customer onboarding reporting",
        external_safe_summary: "Built onboarding reporting.",
        metrics: [{ value: "6 hours saved weekly" }],
        problem: "Manual reporting slowed decisions.",
        results: ["Reduced reporting effort"],
        role: "Owner",
        status,
      }
    : {
        actions: [],
        context: null,
        external_safe_summary: null,
        metrics: [],
        problem: null,
        results: [],
        role: null,
        status,
      };
}
