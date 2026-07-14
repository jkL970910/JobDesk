import { describe, expect, it } from "vitest";

import { buildProfileEvidenceInstructions } from "../src/ai/profile-evidence-extraction";
import {
  buildConservativeEvidenceRewrite,
  deriveEnrichmentTaskTargetMetadataForTest,
  buildExtractionNoteEnrichmentTasks,
  buildEvidenceUpdateProposalPatch,
  buildInitialProposalGenerationInstruction,
  buildResumeReviewEnrichmentTasks,
  isBroadProfilePositioningQuestion,
  normalizeReusableLibraryAnchorForTest,
} from "../src/server/enrichment-task-repository";
import { consolidateInitiativeDrafts } from "../src/server/initiative-consolidation";
import type { ProfileEvidenceExtraction } from "../src/schemas/profile-evidence-extraction";

describe("Evidence Library Builder instructions", () => {
  it("biases project-note sources toward reusable project cards and evidence", () => {
    const instructions = buildProfileEvidenceInstructions("project_note");

    expect(instructions).toContain("project note");
    expect(instructions).toContain("work_experiences are employer/role containers");
    expect(instructions).toContain("Detailed bullets and achievements belong in initiatives and evidence_items");
    expect(instructions).toContain("create either one initiative");
    expect(instructions).toContain("Return at most 8 evidence_items");
    expect(instructions).toContain("redaction");
  });

  it("keeps resume sources constrained to resume/profile extraction", () => {
    const instructions = buildProfileEvidenceInstructions("resume");

    expect(instructions).toContain("resume or career-notes source");
    expect(instructions).toContain("Return at most 6 evidence_items");
    expect(instructions).toContain("extract work_experiences from Experience sections");
    expect(instructions).toContain("portfolio_projects only from non-employer Projects sections");
  });

  it("defines initiative granularity rules in the extraction prompt", () => {
    const instructions = buildProfileEvidenceInstructions("resume");

    expect(instructions).toContain("Initiative granularity rules");
    expect(instructions).toContain("not a single tool, task, system component, or result");
    expect(instructions).toContain("Every initiative must set work_experience_ref");
    expect(instructions).toContain("Amazon · Software Dev Engineer Intern");
    expect(instructions).toContain("Null work_experience_ref means the initiative cannot be safely auto-consolidated");
    expect(instructions).toContain("AWS infrastructure provisioning with CDK");
    expect(instructions).toContain("Distributed caching infrastructure for session latency optimization");
  });

  it("consolidates complementary initiative fragments under one role", () => {
    const initiatives: ProfileEvidenceExtraction["initiatives"] = [
      buildInitiative({
        internal_title: "AWS infrastructure provisioning with CDK",
        actions: ["Provisioned cloud infrastructure using AWS CDK."],
        technologies: ["AWS CDK"],
      }),
      buildInitiative({
        internal_title: "Session latency optimization with distributed caching",
        results: ["Optimized session latency."],
        technologies: ["distributed cache"],
      }),
      buildInitiative({
        internal_title: "Distributed cloud caching for high-scale delivery service",
        context: "High-scale delivery service had session latency constraints.",
        problem: "Session dependency latency affected delivery service reliability.",
        technologies: ["distributed cache"],
      }),
    ];

    const result = consolidateInitiativeDrafts(initiatives);

    expect(result.initiatives).toHaveLength(1);
    expect(result.initiatives[0]).toMatchObject({
      status: "pending",
      sensitivity_level: "private",
    });
    expect(result.initiatives[0]?.technologies).toEqual(
      expect.arrayContaining(["AWS CDK", "distributed cache"]),
    );
    expect(result.initiatives[0]?.results).toContain("Optimized session latency.");
    expect(result.draftRefRedirects.get("Session latency optimization with distributed caching")).toBe(
      result.initiatives[0]?.internal_title,
    );
    expect(result.extractionNotes[0]).toContain("These story fragments were merged");
  });

  it("does not consolidate similar initiatives across different roles", () => {
    const result = consolidateInitiativeDrafts([
      buildInitiative({
        internal_title: "AWS infrastructure provisioning with CDK",
        technologies: ["AWS CDK"],
        work_experience_ref: "Amazon · Software Engineer",
      }),
      buildInitiative({
        internal_title: "Distributed cloud caching for session latency",
        technologies: ["distributed cache"],
        work_experience_ref: "Shopify · Data Engineer",
      }),
    ]);

    expect(result.initiatives).toHaveLength(2);
    expect(result.draftRefRedirects.size).toBe(0);
    expect(result.extractionNotes).toHaveLength(0);
  });

  it("does not consolidate initiatives when role references are missing", () => {
    const result = consolidateInitiativeDrafts([
      buildInitiative({
        internal_title: "AWS infrastructure provisioning with CDK",
        technologies: ["AWS CDK"],
        work_experience_ref: null,
      }),
      buildInitiative({
        internal_title: "Distributed cloud caching for session latency",
        technologies: ["distributed cache"],
        work_experience_ref: null,
      }),
    ]);

    expect(result.initiatives).toHaveLength(2);
    expect(result.draftRefRedirects.size).toBe(0);
    expect(result.extractionNotes).toHaveLength(0);
  });

  it("marks source-section extraction notes as imported material review tasks", () => {
    const tasks = buildExtractionNoteEnrichmentTasks({
      sourceTitle: "Resume import",
      notes: [
        "Work experience entries were extracted from the WORK EXPERIENCES section.",
        "Returned at most 4 work_experiences; omitted additional work experience beyond the cap if any.",
        "Project type for Full-Stack Shopping Market System is classified as personal_project because it appears under PROJECTS and not under an employer.",
        "No certifications were found in the source.",
        "NVIDIA work experience line does not state a location.",
        "Shopify role line does not state a team.",
        "Amazon role end date is stated as Present.",
      ],
    });

    for (const task of tasks) {
      expect(task).toMatchObject({
        taskType: "source_section_review",
        sourceType: "extraction_note",
        sourceLabel: "Resume import",
        targetScope: "source_material",
        expectedOutcome: "review_imported_material",
      });
      expect(task?.expectedAction).not.toBe("answer_enrichment_question");
      expect(task?.targetReason).toMatch(/not a missing-information answer|instead of answering|Edit|Add|Review/i);
    }
    expect(tasks[1]).toMatchObject({
      noteKind: "extraction_limit",
      expectedAction: "review_import",
    });
    expect(tasks[3]).toMatchObject({
      noteKind: "missing_profile_fact",
      expectedAction: "add_profile_fact",
      targetField: "certifications",
    });
    expect(tasks[4]).toMatchObject({
      noteKind: "missing_role_field",
      expectedAction: "edit_role_field",
      targetField: "location",
    });
    expect(tasks[5]).toMatchObject({
      noteKind: "missing_role_field",
      expectedAction: "edit_role_field",
      targetField: "team",
    });
    expect(tasks[6]).toMatchObject({
      noteKind: "missing_role_field",
      expectedAction: "edit_role_field",
      targetField: "end_date",
    });
  });

  it("keeps concrete extraction notes as ordinary enrichment questions", () => {
    const [task] = buildExtractionNoteEnrichmentTasks({
      sourceTitle: "Resume import",
      notes: ["Add a concrete activation metric for the onboarding dashboard."],
    });

    expect(task).toMatchObject({
      taskType: "metric",
      sourceType: "extraction_note",
      sourceLabel: "Resume import",
      prompt: "Add a concrete activation metric for the onboarding dashboard.",
    });
    expect(task).not.toHaveProperty("expectedOutcome", "review_imported_material");
  });

  it("routes legacy scope guardrail notes to imported material review without parsing candidate truth from text", () => {
    const [task] = buildExtractionNoteEnrichmentTasks({
      sourceTitle: "Resume import",
      notes: [
        'Scope review needed from Resume import: "Migrated service to region X · Reduced latency by 35%" was not saved as a Work Experience. Reason: Work Experience must be an employer/title/date/team container, not an action-result bullet. Review the source and save it as the correct scope before using it in resumes.',
      ],
    });

    expect(task).toMatchObject({
      taskType: "source_section_review",
      sourceType: "extraction_note",
      targetScope: "source_material",
      expectedOutcome: "review_imported_material",
      expectedAction: "review_import",
      noteKind: "import_review",
    });
    expect(task?.reviewPayload).toBeNull();
  });

  it("keeps structured scope review payloads as candidate truth", () => {
    const note =
      'Scope review needed from Resume import: "Mapped Redis cache dependency path" was not saved as a Work Initiative. Reason: Candidate needs a confirmed story target before reuse. Review the source and save it as the correct scope before using it in resumes.';
    const [task] = buildExtractionNoteEnrichmentTasks({
      sourceTitle: "Resume import",
      sourceDocumentId: "00000000-0000-0000-0000-000000000001",
      notes: [note],
      reviewPayloads: [
        {
          note,
          payload: {
            kind: "scope_review_candidate",
            candidateId: "scope:test-candidate",
            proposedScope: "work_initiative",
            classifierAcceptedScope: "work_initiative",
            guardrailDecision: "review_queue_only",
            guardrailReason: "Candidate needs a confirmed story target before reuse.",
            confidence: "medium",
            sourceDocumentId: null,
            sourceLabel: "Resume import",
            sourceQuote: "Mapped Redis cache dependency path",
            sourceSection: "Experience",
            rawCandidateText: "Mapped Redis cache dependency path",
            sourceSnippet: "Mapped Redis cache dependency path",
            suggestedAction: "save_as_work_initiative",
            resolutionStatus: "open",
          },
        },
      ],
    });

    expect(task).toMatchObject({
      taskType: "source_section_review",
      reviewPayload: {
        candidateId: "scope:test-candidate",
        kind: "scope_review_candidate",
        sourceDocumentId: "00000000-0000-0000-0000-000000000001",
        suggestedAction: "save_as_work_initiative",
      },
    });
  });

  it("keeps section retry payloads on timed-out extraction notes", () => {
    const note =
      "AI evidence extraction timed out for NFC rollout; JobDesk created partial conservative source-grounded drafts for review.";
    const [task] = buildExtractionNoteEnrichmentTasks({
      sourceTitle: "Resume import",
      notes: [note],
      reviewPayloads: [
        {
          note,
          payload: {
            kind: "section_retry",
            confidence: "high",
            originalRunId: "run-original",
            segmentId: "work_experience-1",
            segmentKind: "work_experience",
            segmentText: "NFC rollout source text",
            segmentTextHash: "abc123",
            segmentTitle: "NFC rollout",
            sourceDocumentId: "00000000-0000-0000-0000-000000000001",
            sourceLabel: "Resume import",
            sourceSnippet: "NFC rollout source text",
          },
        },
      ],
    });

    expect(task).toMatchObject({
      expectedAction: "rerun_extraction",
      noteKind: "extraction_limit",
      reviewPayload: {
        kind: "section_retry",
        segmentId: "work_experience-1",
      },
    });
  });

  it("does not route generic project description notes to role summary editing", () => {
    const [task] = buildExtractionNoteEnrichmentTasks({
      sourceTitle: "Resume import",
      notes: ["Project description missing for portfolio project entry."],
    });

    expect(task).toMatchObject({
      taskType: "source_section_review",
      sourceType: "extraction_note",
      targetScope: "source_material",
      expectedOutcome: "review_imported_material",
      expectedAction: "review_import",
    });
    expect(task).not.toMatchObject({
      noteKind: "missing_role_field",
      expectedAction: "edit_role_field",
      targetField: "summary",
    });
  });

  it("classifies broad profile positioning questions without evidence anchors", () => {
    const [task] = buildResumeReviewEnrichmentTasks({
      resumeTitle: "Main resume",
      resumeSourceVersionId: "resume-source-1",
      resumeReviewReportId: "review-1",
      missingEvidenceQuestions: [
        "Technical Skills: Which listed skills are strongest and most recent? Which would you want emphasized for future software engineering roles?",
      ],
    });

    expect(task).toMatchObject({
      sourceType: "resume_review",
      targetScope: "profile_context",
      targetConfidence: "low",
      expectedOutcome: "save_profile_answer",
    });
    expect(task?.targetReason).toContain("profile-level positioning preference");
    expect(task).not.toHaveProperty("evidenceItemId");
    expect(task).not.toHaveProperty("initiativeId");
    expect(task).not.toHaveProperty("workExperienceId");
  });

  it("routes concrete unanchored resume questions to target assignment before proposal review", () => {
    const [task] = buildResumeReviewEnrichmentTasks({
      resumeTitle: "Main resume",
      resumeSourceVersionId: "resume-source-1",
      resumeReviewReportId: "review-1",
      missingEvidenceQuestions: [
        "Which project should this latency result support in your evidence library?",
      ],
    });

    expect(task).toBeDefined();
    if (!task) throw new Error("Expected enrichment task.");
    const targetMetadata = deriveEnrichmentTaskTargetMetadataForTest(task);

    expect(task).toMatchObject({
      sourceType: "resume_review",
    });
    expect(targetMetadata).toMatchObject({
      targetScope: "assign_later",
      targetConfidence: "low",
      expectedOutcome: "route_answer",
    });
    expect(task).not.toHaveProperty("evidenceItemId");
    expect(task).not.toHaveProperty("initiativeId");
    expect(task).not.toHaveProperty("workExperienceId");
  });

  it("does not treat concrete project follow-up questions as broad profile positioning", () => {
    expect(
      isBroadProfilePositioningQuestion(
        "Cloud cache project: Which latency metric changed after the AWS CDK rollout?",
      ),
    ).toBe(false);
    expect(
      isBroadProfilePositioningQuestion(
        "Which listed skills are strongest and most recent for future software engineering roles?",
      ),
    ).toBe(true);
  });

  it("keeps user answers as supporting detail unless a conservative evidence rewrite is safe", () => {
    const task = {
      evidenceItemId: "11111111-1111-4111-8111-111111111111",
    } as Parameters<typeof buildEvidenceUpdateProposalPatch>[0];
    const vaguePatch = buildEvidenceUpdateProposalPatch(
      task,
      "There were fewer endpoints and better schema, so the workflow had fewer steps.",
      "Reduced backend request APIs from more than 20 to 10.",
    );

    expect(vaguePatch).toMatchObject({
      patch_type: "update_evidence",
      evidence_id: "11111111-1111-4111-8111-111111111111",
      source_quote_patch:
        "There were fewer endpoints and better schema, so the workflow had fewer steps.",
    });
    expect(vaguePatch).not.toHaveProperty("text_patch");

    const rewrite = buildConservativeEvidenceRewrite(
      "Reduced backend request APIs from more than 20 to 10 and shortened raw-data crawl/fetch time from 2 weeks to 1 week.",
      "There were fewer endpoints and better schema, so the raw data processing workflow required fewer steps and faster validation.",
    );
    expect(rewrite).toBe(
      "Reduced raw-data crawl/fetch time from 2 weeks to 1 week by simplifying backend request flow from 20+ APIs to 10 and improving schema validation.",
    );
  });

  it("generates initial proposal instructions by proposal type without treating every task as evidence", () => {
    expect(buildInitialProposalGenerationInstruction("update_initiative")).toContain(
      "story-context update",
    );
    expect(buildInitialProposalGenerationInstruction("update_work_experience")).toContain(
      "role-context update",
    );
    expect(buildInitialProposalGenerationInstruction("update_evidence")).toContain(
      "conservative suggested evidence update",
    );
    expect(buildInitialProposalGenerationInstruction("update_initiative")).toContain(
      "do not turn it into resume-ready evidence",
    );
  });

  it("preserves evidence story and role target chain links together", () => {
    expect(
      normalizeReusableLibraryAnchorForTest({
        evidenceItemId: "evidence-1",
        initiativeId: "initiative-1",
        portfolioProjectId: "portfolio-should-drop",
        workExperienceId: "role-1",
      }),
    ).toEqual({
      evidenceItemId: "evidence-1",
      initiativeId: "initiative-1",
      portfolioProjectId: null,
      workExperienceId: "role-1",
    });
  });
});

function buildInitiative(
  overrides: Partial<ProfileEvidenceExtraction["initiatives"][number]>,
): ProfileEvidenceExtraction["initiatives"][number] {
  return {
    actions: [],
    context: null,
    external_safe_summary: null,
    external_safe_title: null,
    internal_title: "Untitled initiative",
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
