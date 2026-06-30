import { describe, expect, it } from "vitest";

import {
  resolveResumeReviewSelectedId,
  upsertResumeReviewSummary,
  type ResumeSourceReviewSummary,
} from "../src/components/resume-review-workspace";

describe("resume review workspace state", () => {
  it("keeps a requested newly uploaded resume selected instead of falling back to an older reviewed resume", () => {
    const selectedId = resolveResumeReviewSelectedId({
      currentId: "",
      requestedId: "resume-v2",
      resumes: [resumeSummary({ id: "resume-v1", latestReview: reviewSummary(), version: 1 })],
    });

    expect(selectedId).toBe("resume-v2");
  });

  it("puts an uploaded resume at the front of the local list before the workspace reloads", () => {
    const next = upsertResumeReviewSummary(
      [resumeSummary({ id: "resume-v1", latestReview: reviewSummary(), version: 1 })],
      resumeSummary({ id: "resume-v2", latestReview: null, version: 2 }),
    );

    expect(next.map((resume) => resume.id)).toEqual(["resume-v2", "resume-v1"]);
  });
});

function resumeSummary(patch: Partial<ResumeSourceReviewSummary>): ResumeSourceReviewSummary {
  return {
    activeReviewRun: null,
    id: "resume",
    latestReview: null,
    sourceKind: "docx",
    status: "uploaded",
    title: "Jiekun Liu - Resume.docx",
    updatedAt: "2026-06-30T12:00:00.000Z",
    version: 1,
    ...patch,
  };
}

function reviewSummary(): NonNullable<ResumeSourceReviewSummary["latestReview"]> {
  return {
    id: "review-v1",
    missingEvidenceQuestions: [],
    overallScore: 76,
    recommendedActions: [],
    riskFlags: [],
    rubric: [],
    strengths: [],
    weaknesses: [],
  };
}
