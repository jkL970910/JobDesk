import { describe, expect, it } from "vitest";

import {
  guardEvidenceDraftsForPersistence,
  guardInitiativeDraftsForPersistence,
  guardPortfolioProjectDraftsForPersistence,
  guardWorkExperienceDraftsForPersistence,
} from "../src/server/extraction-scope-guardrail";
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

  it("summarizes guardrail diagnostics without raw candidate text", () => {
    const result = guardWorkExperienceDraftsForPersistence([
      buildWorkExperienceDraft({
        employer: "Migrated confidential checkout service to region X",
        role_title: "Reduced latency by 35%",
      }),
    ]);

    expect(result.summary).toMatchObject({
      acceptedCount: 0,
      rejectedCount: 1,
      reviewQueueOnlyCount: 0,
      totalCount: 1,
    });
    expect(JSON.stringify(result.summary)).not.toContain("confidential checkout");
    expect(Object.keys(result.summary.reasonCounts)[0]).toContain("Bullet-shaped action");
  });

  it("routes Technical Skills initiative candidates to review instead of canonical persistence", () => {
    const result = guardInitiativeDraftsForPersistence([
      buildInitiativeDraft({
        internal_title: "Technical Skills",
        technologies: ["Java", "Python", "React", "AWS", "Redis"],
      }),
    ], {
      resolveWorkExperienceContext: () => ({
        employer: "Amazon",
        roleTitle: "Software Engineer",
      }),
      sourceTitle: "Resume import",
    });

    expect(result.accepted).toHaveLength(0);
    expect(result.decisions[0]).toMatchObject({
      disposition: "review_queue_only",
      classification: {
        decision: {
          acceptedScope: "profile_context",
          canonicalLinkPolicy: "review_queue_only",
        },
      },
    });
    expect(result.reviewNotes[0]).toContain("was not saved as a Work Initiative");
  });

  it("keeps employer-context material out of Portfolio Projects", () => {
    const result = guardPortfolioProjectDraftsForPersistence([
      buildPortfolioProjectDraft({
        title: "Amazon session latency optimization",
        context: "Employer-internal delivery service work at Amazon.",
      }),
    ]);

    expect(result.accepted).toHaveLength(0);
    expect(result.decisions[0]).toMatchObject({
      disposition: "review_queue_only",
      classification: {
        decision: {
          acceptedScope: "unassigned",
          canonicalLinkPolicy: "review_queue_only",
        },
      },
    });
  });

  it("routes broad story material to review instead of Evidence Claim persistence", () => {
    const result = guardEvidenceDraftsForPersistence([
      buildEvidenceDraft({
        text: "Led API consolidation across migration planning, dependency cleanup, rollout coordination, and service-owner enablement.",
        source_quote: "Led API consolidation across migration planning, dependency cleanup, rollout coordination, and service-owner enablement.",
      }),
    ]);

    expect(result.accepted).toHaveLength(0);
    expect(result.decisions[0]).toMatchObject({
      disposition: "review_queue_only",
      classification: {
        decision: {
          acceptedScope: "unassigned",
          canonicalLinkPolicy: "review_queue_only",
        },
      },
    });
    expect(result.reviewNotes[0]).toContain("was not saved as a Evidence Claim");
  });

  it("does not let profile-context skills bypass the classifier as short Evidence Claims", () => {
    const result = guardEvidenceDraftsForPersistence([
      buildEvidenceDraft({
        text: "Technical Skills: Java React AWS Redis",
        source_quote: "Technical Skills: Java React AWS Redis",
      }),
    ]);

    expect(result.accepted).toHaveLength(0);
    expect(result.decisions[0]).toMatchObject({
      disposition: "review_queue_only",
      classification: {
        decision: {
          acceptedScope: "profile_context",
          canonicalLinkPolicy: "review_queue_only",
        },
      },
    });
  });

  it("routes naked technology phrases to review-only even when they are short and sourced", () => {
    const result = guardEvidenceDraftsForPersistence([
      buildEvidenceDraft({
        text: "AWS CDK Redis cache",
        source_quote: "AWS CDK Redis cache",
      }),
    ]);

    expect(result.accepted).toHaveLength(0);
    expect(result.decisions[0]).toMatchObject({
      disposition: "review_queue_only",
      classification: {
        decision: {
          acceptedScope: "unassigned",
          canonicalLinkPolicy: "review_queue_only",
        },
      },
    });
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

function buildInitiativeDraft(
  overrides: Partial<ProfileEvidenceExtraction["initiatives"][number]>,
): ProfileEvidenceExtraction["initiatives"][number] {
  return {
    actions: ["Built a scoped platform workflow."],
    context: "Platform workflow",
    external_safe_summary: null,
    external_safe_title: null,
    internal_title: "Platform workflow",
    metrics: [],
    needs_redaction_review: false,
    problem: null,
    results: [],
    role: null,
    sensitivity_level: "private",
    stakeholders: [],
    status: "pending",
    technologies: [],
    work_experience_ref: "Amazon · Software Engineer",
    ...overrides,
  };
}

function buildPortfolioProjectDraft(
  overrides: Partial<ProfileEvidenceExtraction["portfolio_projects"][number]>,
): ProfileEvidenceExtraction["portfolio_projects"][number] {
  return {
    actions: ["Built a project workflow."],
    context: "Personal project",
    external_safe_summary: null,
    external_safe_title: null,
    metrics: [],
    needs_redaction_review: false,
    problem: null,
    project_type: "general_project",
    results: [],
    role: null,
    sensitivity_level: "private",
    stakeholders: [],
    status: "pending",
    technologies: [],
    title: "Personal project",
    ...overrides,
  };
}

function buildEvidenceDraft(
  overrides: Partial<ProfileEvidenceExtraction["evidence_items"][number]>,
): ProfileEvidenceExtraction["evidence_items"][number] {
  return {
    allowed_usage: [],
    evidence_type: "user_confirmed",
    metrics: [],
    needs_user_confirmation: true,
    public_safe_summary: null,
    related_initiative_id: null,
    related_portfolio_project_id: null,
    related_project_id: null,
    related_work_experience_id: null,
    sensitivity_level: "private",
    source_quote: "Reduced API count from 20+ services to 10",
    status: "pending",
    text: "Reduced API count from 20+ services to 10",
    ...overrides,
  };
}
