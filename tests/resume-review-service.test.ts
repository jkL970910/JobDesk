import { describe, expect, it } from "vitest";

import { buildResumeReviewReport } from "../src/server/resume-review-service";

describe("resume review service", () => {
  it("scores stronger resumes above thin resumes and surfaces missing evidence", () => {
    const strong = buildResumeReviewReport(
      [
        "Jane Doe jane@example.com linkedin.com/in/jane",
        "Experience",
        "- Led onboarding dashboard launch for 3 product teams and improved activation by 12%.",
        "- Built SQL models and automated weekly reporting for 40 stakeholders.",
        "Projects",
        "- Migrated analytics taxonomy and reduced manual QA by 8 hours per week.",
        "Skills: SQL, Python, analytics, experimentation",
        "Education: BSc Statistics, University of Toronto",
      ].join("\n"),
    );
    const thin = buildResumeReviewReport(
      [
        "Jane Doe",
        "Worked on dashboards.",
        "Responsible for analytics.",
        "Skills: SQL",
      ].join("\n"),
    );

    expect(strong.overallScore).toBeGreaterThan(thin.overallScore);
    expect(strong.overallScore).toBeLessThan(100);
    expect(thin.missingEvidenceQuestions.length).toBeGreaterThan(0);
    expect(thin.weaknesses.join(" ")).toContain("quantified");
  });

  it("returns dimension-specific feedback and evidence questions", () => {
    const review = buildResumeReviewReport(
      [
        "Jane Doe jane@example.com",
        "Experience",
        "- Built onboarding dashboard for product teams.",
        "Projects",
        "- Launched usage taxonomy migration.",
        "Skills: SQL, Python",
      ].join("\n"),
    );

    const projectDepth = review.rubric.find((item) => item.key === "project_depth");

    expect(projectDepth?.findings.join(" ")).toContain("Project");
    expect(projectDepth?.evidenceQuestions.join(" ")).toContain("project");
    expect(projectDepth?.evidenceQuestions.join(" ")).not.toContain("safe to share publicly");
    expect(projectDepth?.nextAction).toContain("project context");
  });
});
