import { describe, expect, it } from "vitest";

import type { generatedClaims } from "../src/db/schema";
import { buildGeneratedResumeReadinessReview } from "../src/server/generated-resume-readiness-review";
import { buildResumeReadinessWorklist } from "../src/server/resume-readiness-worklist";

type ClaimRow = typeof generatedClaims.$inferSelect;

describe("resume readiness worklist", () => {
  it("separates hard gates, stale claims, missing evidence, and polish-only suggestions", () => {
    const review = buildGeneratedResumeReadinessReview({
      baseline: null,
      claims: [claim({ id: "c1", claimStatus: "supported", supportStatus: "supported" })],
      documentId: "11111111-1111-4111-8111-111111111111",
      documentType: "main_resume",
      generatedLabel: "Generated main resume · general readiness review",
      now: new Date("2026-07-07T12:00:00.000Z"),
      resumeMarkdown: "## Experience\n- Built onboarding dashboards.",
      resumeStatus: "validated",
      scope: "general_readiness",
    });

    const worklist = buildResumeReadinessWorklist({
      claims: [
        claim({
          id: "c2",
          claimStatus: "stale",
          staleReason: "Evidence was quarantined.",
          supportStatus: "supported",
        }),
        claim({
          id: "c3",
          claimStatus: "unsupported",
          riskLevel: "high",
          staleReason: "claim references missing evidence",
          supportStatus: "unsupported",
        }),
      ],
      evidenceEligibilityById: {
        "e-c2": {
          blockers: [
            {
              code: "quarantined_evidence_not_allowed",
              detail: "Quarantined evidence is preserved for audit but cannot support resume generation.",
              label: "Quarantined evidence blocked",
              nextAction: "quarantine_restore_required",
            },
          ],
          canUsePublicSafeSummary: true,
          eligible: false,
          nextAction: "quarantine_restore_required",
          summary: "Quarantined evidence blocked",
        },
      },
      missingEvidenceQuestions: ["What metric proves onboarding impact?"],
      readinessReview: review,
      resumeStatus: "unvalidated",
    });

    expect(worklist.summary).toMatchObject({
      readyForFinalExport: false,
    });
    expect(worklist.items.map((item) => item.type)).toEqual(
      expect.arrayContaining([
        "fact_guard_hard_blocker",
        "evidence_eligibility_blocker",
        "stale_claim",
        "missing_evidence",
        "polish_only_suggestion",
      ]),
    );
    expect(worklist.items[0]).toMatchObject({
      severity: "blocker",
      type: "fact_guard_hard_blocker",
    });
    expect(worklist.items.find((item) => item.type === "stale_claim")).toMatchObject({
      route: "fact_guard",
      linkedClaimIds: ["c2"],
    });
    expect(worklist.items.find((item) => item.type === "missing_evidence")).toMatchObject({
      route: "work_queue",
    });
    expect(worklist.items.find((item) => item.type === "evidence_eligibility_blocker")).toMatchObject({
      linkedClaimIds: ["c2"],
      linkedEvidenceIds: ["e-c2"],
      route: "evidence_library",
    });
    expect(worklist.items.find((item) => item.type === "polish_only_suggestion")).toMatchObject({
      route: expect.stringMatching(/resume_builder|profile_positioning/),
    });
  });

  it("marks validated resumes ready when no blocker exists", () => {
    const worklist = buildResumeReadinessWorklist({
      claims: [claim({ id: "c1", claimStatus: "supported", supportStatus: "supported" })],
      missingEvidenceQuestions: [],
      readinessReview: null,
      resumeStatus: "validated",
    });

    expect(worklist.summary).toMatchObject({
      blockerCount: 0,
      nextAction: null,
      readyForFinalExport: true,
    });
    expect(worklist.items).toHaveLength(0);
  });
});

function claim(patch: {
  claimStatus?: ClaimRow["claimStatus"];
  id: string;
  riskLevel?: ClaimRow["riskLevel"];
  staleReason?: string | null;
  supportStatus?: ClaimRow["supportStatus"];
}): ClaimRow {
  return {
    claimStatus: patch.claimStatus ?? "unvalidated",
    claimText: `Generated claim ${patch.id}`,
    createdAt: new Date("2026-07-07T12:00:00.000Z"),
    evidenceIds: patch.id === "c3" ? [] : [`e-${patch.id}`],
    generatedDocumentId: null,
    id: patch.id,
    jobId: null,
    lastValidatedAt: null,
    mainResumeVersionId: "11111111-1111-4111-8111-111111111111",
    resumeVersionId: null,
    riskLevel: patch.riskLevel ?? "low",
    section: "experience",
    sourceQuotes: ["Built dashboards"],
    staleReason: patch.staleReason ?? null,
    supportStatus: patch.supportStatus ?? "unvalidated",
    workspaceId: "99999999-9999-4999-8999-999999999999",
  };
}
