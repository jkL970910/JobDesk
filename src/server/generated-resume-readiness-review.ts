import { and, desc, eq } from "drizzle-orm";

import { skillRegistry } from "../ai/skills-registry";
import { getDb, hasDatabaseUrl } from "../db/client";
import {
  generatedClaims,
  generatedResumeReadinessReviews,
  mainResumeVersions,
  resumeReviewReports,
  resumeSourceVersions,
  resumeVersions,
  workflowRuns,
} from "../db/schema";
import {
  GeneratedResumePolishProposal,
  GeneratedResumeReadinessReview,
  type GeneratedResumeDocumentType,
  type GeneratedResumeFindingRoute,
} from "../schemas/generated-resume-readiness-review";
import { workflowSkillFields } from "./workflow-run-metadata";
import { getCurrentWorkspace } from "./workspace-repository";

type GeneratedClaimRow = typeof generatedClaims.$inferSelect;
type MainResumeRow = typeof mainResumeVersions.$inferSelect;
type DbHandle = ReturnType<typeof getDb>;

type GeneratedResumeReadinessDto = GeneratedResumeReadinessReview & {
  id: string;
  workflow_run_id: string | null;
  updated_at: string;
};

type GeneratedResumePolishProposalDto = GeneratedResumePolishProposal & {
  generated_resume_id: string | null;
  fact_guard_status: string | null;
  readiness_review: GeneratedResumeReadinessDto | null;
};

export async function reviewGeneratedMainResumeReadiness(mainResumeVersionId: string) {
  if (!hasDatabaseUrl()) return { status: "skipped" as const, reason: "missing_database_url" as const };

  return getDb().transaction(async (tx) => {
    const workspace = await getCurrentWorkspace(tx);
    const [resume] = await tx
      .select()
      .from(mainResumeVersions)
      .where(
        and(
          eq(mainResumeVersions.workspaceId, workspace.id),
          eq(mainResumeVersions.id, mainResumeVersionId),
        ),
      )
      .limit(1);
    if (!resume) return { status: "not_found" as const };

    const claims = await tx
      .select()
      .from(generatedClaims)
      .where(
        and(
          eq(generatedClaims.workspaceId, workspace.id),
          eq(generatedClaims.mainResumeVersionId, mainResumeVersionId),
        ),
      );
    const baseline = resume.refreshSourceResumeId
      ? await getSourceResumeBaseline(tx, workspace.id, resume.refreshSourceResumeId)
      : null;
    const now = new Date();
    const review = buildGeneratedResumeReadinessReview({
      baseline,
      claims,
      documentId: resume.id,
      documentType: "main_resume",
      generatedLabel: formatMainResumeReadinessLabel(resume),
      resumeMarkdown: resume.resumeMarkdown,
      resumeStatus: resume.status,
      scope: "general_readiness",
      now,
    });
    const [workflowRun] = await tx
      .insert(workflowRuns)
      .values({
        workspaceId: workspace.id,
        workflowType: skillRegistry.generatedResumeReadinessReview.workflowType,
        status: "succeeded",
        provider: "deterministic",
        model: "generated-readiness-v0",
        ...workflowSkillFields(skillRegistry.generatedResumeReadinessReview),
        retryCount: 0,
        startedAt: now,
        finishedAt: now,
      })
      .returning({ id: workflowRuns.id });
    const [saved] = await tx
      .insert(generatedResumeReadinessReviews)
      .values({
        workspaceId: workspace.id,
        workflowRunId: workflowRun?.id ?? null,
        mainResumeVersionId: resume.id,
        documentType: "main_resume",
        scope: review.scope,
        reviewJson: review,
        score: review.score,
        verdict: review.verdict,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!saved) throw new Error("Failed to save generated resume readiness review.");
    return {
      status: "saved" as const,
      review: toGeneratedResumeReadinessDto(saved),
    };
  });
}

export async function reviewGeneratedTailoredResumeReadiness(resumeVersionId: string) {
  if (!hasDatabaseUrl()) return { status: "skipped" as const, reason: "missing_database_url" as const };

  return getDb().transaction(async (tx) => {
    const workspace = await getCurrentWorkspace(tx);
    const [resume] = await tx
      .select()
      .from(resumeVersions)
      .where(
        and(
          eq(resumeVersions.workspaceId, workspace.id),
          eq(resumeVersions.id, resumeVersionId),
        ),
      )
      .limit(1);
    if (!resume) return { status: "not_found" as const };

    const claims = await tx
      .select()
      .from(generatedClaims)
      .where(
        and(
          eq(generatedClaims.workspaceId, workspace.id),
          eq(generatedClaims.resumeVersionId, resumeVersionId),
        ),
      );
    const now = new Date();
    const review = buildGeneratedResumeReadinessReview({
      baseline: null,
      claims,
      documentId: resume.id,
      documentType: "tailored_resume",
      generatedLabel: "Tailored resume · JD-specific readiness review",
      resumeMarkdown: resume.resumeMarkdown,
      resumeStatus: resume.status,
      scope: "jd_specific_readiness",
      now,
    });
    const [workflowRun] = await tx
      .insert(workflowRuns)
      .values({
        workspaceId: workspace.id,
        jobId: resume.jobId,
        workflowType: skillRegistry.generatedResumeReadinessReview.workflowType,
        status: "succeeded",
        provider: "deterministic",
        model: "generated-readiness-v0",
        ...workflowSkillFields(skillRegistry.generatedResumeReadinessReview),
        retryCount: 0,
        startedAt: now,
        finishedAt: now,
      })
      .returning({ id: workflowRuns.id });
    const [saved] = await tx
      .insert(generatedResumeReadinessReviews)
      .values({
        workspaceId: workspace.id,
        workflowRunId: workflowRun?.id ?? null,
        resumeVersionId: resume.id,
        documentType: "tailored_resume",
        scope: review.scope,
        reviewJson: review,
        score: review.score,
        verdict: review.verdict,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!saved) throw new Error("Failed to save generated resume readiness review.");
    return {
      status: "saved" as const,
      review: toGeneratedResumeReadinessDto(saved),
    };
  });
}

export async function getLatestGeneratedMainResumeReadinessReview(
  mainResumeVersionId: string,
) {
  if (!hasDatabaseUrl()) return null;
  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const [review] = await db
    .select()
    .from(generatedResumeReadinessReviews)
    .where(
      and(
        eq(generatedResumeReadinessReviews.workspaceId, workspace.id),
        eq(generatedResumeReadinessReviews.mainResumeVersionId, mainResumeVersionId),
      ),
    )
    .orderBy(desc(generatedResumeReadinessReviews.createdAt))
    .limit(1);
  return review ? toGeneratedResumeReadinessDto(review) : null;
}

export async function getLatestGeneratedTailoredResumeReadinessReview(
  resumeVersionId: string,
) {
  if (!hasDatabaseUrl()) return null;
  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const [review] = await db
    .select()
    .from(generatedResumeReadinessReviews)
    .where(
      and(
        eq(generatedResumeReadinessReviews.workspaceId, workspace.id),
        eq(generatedResumeReadinessReviews.resumeVersionId, resumeVersionId),
      ),
    )
    .orderBy(desc(generatedResumeReadinessReviews.createdAt))
    .limit(1);
  return review ? toGeneratedResumeReadinessDto(review) : null;
}

export async function getMainResumePolishProposal(mainResumeVersionId: string) {
  if (!hasDatabaseUrl()) return { status: "skipped" as const, reason: "missing_database_url" as const };

  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const [resume] = await db
    .select()
    .from(mainResumeVersions)
    .where(
      and(
        eq(mainResumeVersions.workspaceId, workspace.id),
        eq(mainResumeVersions.id, mainResumeVersionId),
      ),
    )
    .limit(1);
  if (!resume) return { status: "not_found" as const };

  const review = await getLatestGeneratedMainResumeReadinessReview(mainResumeVersionId);
  if (!review) return { status: "review_required" as const };

  return {
    status: "ready" as const,
    proposal: buildGeneratedResumePolishProposal({
      mainResumeId: resume.id,
      readinessReview: review,
      resumeMarkdown: resume.resumeMarkdown,
    }),
  };
}

export async function applyMainResumePolishProposal(mainResumeVersionId: string) {
  if (!hasDatabaseUrl()) return { status: "skipped" as const, reason: "missing_database_url" as const };

  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const [resume] = await db
    .select()
    .from(mainResumeVersions)
    .where(
      and(
        eq(mainResumeVersions.workspaceId, workspace.id),
        eq(mainResumeVersions.id, mainResumeVersionId),
      ),
    )
    .limit(1);
  if (!resume) return { status: "not_found" as const };

  const review = await getLatestGeneratedMainResumeReadinessReview(mainResumeVersionId);
  if (!review) return { status: "review_required" as const };

  const proposal = buildGeneratedResumePolishProposal({
    mainResumeId: resume.id,
    readinessReview: review,
    resumeMarkdown: resume.resumeMarkdown,
  });
  const claims = await db
    .select()
    .from(generatedClaims)
    .where(
      and(
        eq(generatedClaims.workspaceId, workspace.id),
        eq(generatedClaims.mainResumeVersionId, mainResumeVersionId),
      ),
    );
  const now = new Date();

  const saved = await db.transaction(async (tx) => {
    const [workflowRun] = await tx
      .insert(workflowRuns)
      .values({
        workspaceId: workspace.id,
        workflowType: skillRegistry.generatedResumeReadinessReview.workflowType,
        status: "succeeded",
        provider: "deterministic",
        model: "generated-polish-proposal-v0",
        ...workflowSkillFields(skillRegistry.generatedResumeReadinessReview),
        retryCount: 0,
        startedAt: now,
        finishedAt: now,
      })
      .returning({ id: workflowRuns.id });
    if (!workflowRun) throw new Error("Failed to create generated polish workflow run.");

    const [mainResume] = await tx
      .insert(mainResumeVersions)
      .values({
        workspaceId: workspace.id,
        workflowRunId: workflowRun.id,
        positioningReportId: resume.positioningReportId,
        positioningDirectionId: resume.positioningDirectionId,
        positioningTitle: resume.positioningTitle,
        generationMode: resume.generationMode,
        refreshSourceResumeId: resume.refreshSourceResumeId,
        refreshMode: resume.refreshMode,
        refreshStyleConstraints: resume.refreshStyleConstraints,
        title: `${resume.title} · polish proposal`,
        resumeJson: resume.resumeJson,
        resumeMarkdown: proposal.preview_markdown,
        missingEvidenceQuestions: resume.missingEvidenceQuestions,
        version: resume.version + 1,
        status: "unvalidated",
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: mainResumeVersions.id });
    if (!mainResume) throw new Error("Failed to create polished main resume version.");

    if (claims.length > 0) {
      await tx.insert(generatedClaims).values(
        claims.map((claim) => ({
          workspaceId: workspace.id,
          mainResumeVersionId: mainResume.id,
          claimText: claim.claimText,
          section: claim.section,
          evidenceIds: claim.evidenceIds,
          sourceQuotes: claim.sourceQuotes,
          supportStatus: "unvalidated" as const,
          claimStatus: "unvalidated" as const,
          riskLevel: claim.riskLevel,
          createdAt: now,
        })),
      );
    }

    return {
      mainResumeVersionId: mainResume.id,
      workflowRunId: workflowRun.id,
    };
  });

  return {
    status: "applied" as const,
    mainResumeVersionId: saved.mainResumeVersionId,
    proposal: {
      ...proposal,
      generated_resume_id: saved.mainResumeVersionId,
      fact_guard_status: null,
      readiness_review: null,
    } satisfies GeneratedResumePolishProposalDto,
  };
}

export function buildGeneratedResumeReadinessReview(args: {
  baseline: { label: string; score: number } | null;
  claims: GeneratedClaimRow[];
  documentId: string;
  documentType: GeneratedResumeDocumentType;
  generatedLabel: string;
  resumeMarkdown: string;
  resumeStatus: string;
  scope: "general_readiness" | "jd_specific_readiness";
  now: Date;
}) {
  const totalClaims = args.claims.length;
  const supportedClaims = args.claims.filter(isSupportedClaim).length;
  const unsupportedClaims = args.claims.filter((claim) =>
    ["unsupported", "partially_supported", "unvalidated"].includes(claim.claimStatus) ||
    ["unsupported", "partially_supported", "unvalidated"].includes(claim.supportStatus),
  );
  const highRiskClaims = args.claims.filter((claim) => claim.riskLevel === "high");
  const mediumRiskClaims = args.claims.filter((claim) => claim.riskLevel === "medium");
  const sectionCount = countResumeSections(args.resumeMarkdown);
  const bulletCount = countResumeBullets(args.resumeMarkdown);
  const hasSummary = /^#{1,3}\s*(summary|profile|professional summary)\b/im.test(
    args.resumeMarkdown,
  );
  const claimCoverageScore = totalClaims
    ? Math.round((supportedClaims / totalClaims) * 100)
    : 35;
  const structureScore = Math.min(
    100,
    45 + Math.min(sectionCount, 5) * 8 + Math.min(bulletCount, 10) * 2 + (hasSummary ? 10 : 0),
  );
  const polishScore = Math.max(
    45,
    Math.min(96, structureScore - (mediumRiskClaims.length > 0 ? 4 : 0)),
  );
  const positioningScore =
    args.documentType === "main_resume"
      ? Math.max(50, Math.min(92, hasSummary ? structureScore - 4 : structureScore - 12))
      : Math.max(55, Math.min(94, structureScore - 2));
  const score = clampScore(
    Math.round(
      claimCoverageScore * 0.48 +
        polishScore * 0.28 +
        positioningScore * 0.16 +
        (args.resumeStatus === "validated" ? 8 : 0),
    ),
  );
  const blockers = [
    totalClaims === 0 ? "No generated claim ledger exists for this resume." : null,
    unsupportedClaims.length
      ? `${unsupportedClaims.length} generated claim${unsupportedClaims.length === 1 ? "" : "s"} still need evidence support or safer wording.`
      : null,
    highRiskClaims.length
      ? `${highRiskClaims.length} high-risk claim${highRiskClaims.length === 1 ? "" : "s"} need review before final use.`
      : null,
  ].filter((item): item is string => Boolean(item));
  const verdict =
    blockers.length > 0
      ? "needs_evidence_before_export"
      : score >= 84
        ? "ready_to_export"
        : "recommended_polish";
  const findings = [
    ...buildEvidenceGapFindings(unsupportedClaims),
    ...buildResumePolishFindings({ bulletCount, hasSummary, score: polishScore, sectionCount }),
    ...buildPositioningFindings({
      documentType: args.documentType,
      hasSummary,
      positioningScore,
    }),
  ];
  return GeneratedResumeReadinessReview.parse({
    document_type: args.documentType,
    document_id: args.documentId,
    scope: args.scope,
    scope_label:
      args.scope === "jd_specific_readiness"
        ? "Tailored resume · JD-specific readiness review"
        : "Generated main resume · general readiness review",
    score,
    verdict,
    summary: summarizeReadiness({ blockers, score, verdict }),
    before_after: {
      baseline_label: args.baseline?.label ?? null,
      baseline_score: args.baseline?.score ?? null,
      generated_label: args.generatedLabel,
      generated_score: score,
      delta: args.baseline ? score - args.baseline.score : null,
    },
    readiness_dimensions: [
      {
        key: "claim_support_strength",
        label: "Claim support strength",
        score: claimCoverageScore,
        rationale: `${supportedClaims}/${totalClaims} generated claims are currently supported by Fact Guard.`,
      },
      {
        key: "resume_polish",
        label: "Resume polish",
        score: polishScore,
        rationale: "Checks scan structure, section coverage, and whether the draft is readable as a finished artifact.",
      },
      {
        key: "positioning_clarity",
        label: "Positioning clarity",
        score: positioningScore,
        rationale:
          args.documentType === "tailored_resume"
            ? "Tailored drafts inherit JD focus; this checks whether the generated version is coherent enough to use."
            : "General main resumes need a clear target direction even without a specific JD.",
      },
    ],
    hard_gate_status: {
      fact_guard:
        args.resumeStatus === "validated"
          ? "passed"
          : totalClaims > 0
            ? "needs_review"
            : "not_run",
      public_safe: highRiskClaims.length > 0 ? "needs_review" : "passed",
      export_policy: args.resumeStatus === "validated" ? "enabled" : "blocked",
      blockers,
    },
    findings,
    created_at: args.now.toISOString(),
  });
}

export function buildGeneratedResumePolishProposal(args: {
  mainResumeId: string;
  readinessReview: GeneratedResumeReadinessDto | GeneratedResumeReadinessReview;
  resumeMarkdown: string;
}) {
  const polishFindings = args.readinessReview.findings.filter(
    (finding) => finding.route === "resume_polish" || finding.route === "positioning_gap",
  );
  const selectedFindings =
    polishFindings.length > 0
      ? polishFindings
      : args.readinessReview.findings.filter((finding) => finding.route !== "evidence_gap");
  const edits = selectedFindings.slice(0, 4).map((finding) => ({
    id: `polish-${finding.id}`,
    route: finding.route,
    title: finding.title,
    rationale: finding.detail,
    proposed_change: finding.suggested_action,
  }));

  return GeneratedResumePolishProposal.parse({
    source_main_resume_id: args.mainResumeId,
    readiness_review_id: "id" in args.readinessReview ? args.readinessReview.id : null,
    title: "Resume polish proposal",
    summary:
      edits.length > 0
        ? "Creates a revised generated draft from the current readiness findings. Evidence gaps stay routed to Evidence Library; this proposal only adjusts generated-resume polish and positioning guidance."
        : "Creates a conservative revised generated draft while preserving the current claim ledger and evidence grounding.",
    edits,
    preview_markdown: buildPolishPreviewMarkdown({
      markdown: args.resumeMarkdown,
      findings: edits,
    }),
  });
}

async function getSourceResumeBaseline(
  tx: Pick<DbHandle, "select">,
  workspaceId: string,
  resumeSourceVersionId: string,
) {
  const [report] = await tx
    .select({
      overallScore: resumeReviewReports.overallScore,
      title: resumeSourceVersions.title,
    })
    .from(resumeReviewReports)
    .innerJoin(
      resumeSourceVersions,
      eq(resumeReviewReports.resumeSourceVersionId, resumeSourceVersions.id),
    )
    .where(
      and(
        eq(resumeReviewReports.workspaceId, workspaceId),
        eq(resumeReviewReports.resumeSourceVersionId, resumeSourceVersionId),
        eq(resumeReviewReports.status, "ready"),
      ),
    )
    .orderBy(desc(resumeReviewReports.updatedAt))
    .limit(1);
  return report
    ? {
        label: `${report.title} · original source review`,
        score: report.overallScore,
      }
    : null;
}

function toGeneratedResumeReadinessDto(
  review: typeof generatedResumeReadinessReviews.$inferSelect,
): GeneratedResumeReadinessDto {
  const parsed = GeneratedResumeReadinessReview.parse(review.reviewJson);
  return {
    ...parsed,
    id: review.id,
    workflow_run_id: review.workflowRunId,
    updated_at: review.updatedAt.toISOString(),
  };
}

function isSupportedClaim(claim: GeneratedClaimRow) {
  return claim.claimStatus === "supported" || claim.supportStatus === "supported";
}

function buildEvidenceGapFindings(claims: GeneratedClaimRow[]) {
  return claims.slice(0, 6).map((claim, index) => ({
    id: `evidence-gap-${claim.id}`,
    route: "evidence_gap" as const,
    severity: claim.riskLevel === "high" ? ("blocker" as const) : ("warning" as const),
    title: "Strengthen claim support",
    detail: claim.staleReason ?? claim.claimText,
    suggested_action:
      "Open Evidence Library to add stronger metrics, source quotes, ownership, or public-safe wording for this claim.",
    linked_claim_ids: [claim.id],
  }));
}

function buildResumePolishFindings(args: {
  bulletCount: number;
  hasSummary: boolean;
  score: number;
  sectionCount: number;
}) {
  const findings = [];
  if (!args.hasSummary) {
    findings.push({
      id: "resume-polish-summary",
      route: "resume_polish" as GeneratedResumeFindingRoute,
      severity: "warning" as const,
      title: "Add a sharper opening summary",
      detail: "The generated draft does not expose a clear summary/profile section in the first scan.",
      suggested_action:
        "Use Resume Builder polish to add a concise target headline and strongest evidence near the top.",
      linked_claim_ids: [],
    });
  }
  if (args.bulletCount < 4 || args.sectionCount < 3) {
    findings.push({
      id: "resume-polish-structure",
      route: "resume_polish" as GeneratedResumeFindingRoute,
      severity: "warning" as const,
      title: "Improve scan structure",
      detail: "The draft may be too thin or under-sectioned for a recruiter scan.",
      suggested_action:
        "Use Resume Builder to adjust section order, bullet density, and top-page emphasis.",
      linked_claim_ids: [],
    });
  }
  if (!findings.length && args.score < 84) {
    findings.push({
      id: "resume-polish-refine",
      route: "resume_polish" as GeneratedResumeFindingRoute,
      severity: "info" as const,
      title: "Polish wording before final use",
      detail: "Fact Guard can pass before the draft reaches a strong recruiter-readiness score.",
      suggested_action:
        "Review bullet clarity, ordering, and summary focus in Resume Builder before export.",
      linked_claim_ids: [],
    });
  }
  return findings;
}

function buildPositioningFindings(args: {
  documentType: GeneratedResumeDocumentType;
  hasSummary: boolean;
  positioningScore: number;
}) {
  if (args.documentType === "tailored_resume" || (args.hasSummary && args.positioningScore >= 82)) {
    return [];
  }
  return [
    {
      id: "positioning-gap-target",
      route: "positioning_gap" as const,
      severity: "warning" as const,
      title: "Clarify target positioning",
      detail: "The generated main resume needs a clearer target role angle before it can prove improvement over the old resume.",
      suggested_action:
        "Use Profile Positioning to choose the target direction, then regenerate a direction-specific main resume.",
      linked_claim_ids: [],
    },
  ];
}

function summarizeReadiness(args: {
  blockers: string[];
  score: number;
  verdict: "ready_to_export" | "recommended_polish" | "needs_evidence_before_export";
}) {
  if (args.verdict === "needs_evidence_before_export") {
    return `Generated resume is not export-ready yet because ${args.blockers[0] ?? "claim support still needs review"}`;
  }
  if (args.verdict === "ready_to_export") {
    return `Generated resume is ready to export with a readiness score of ${args.score}.`;
  }
  return `Generated resume is usable as a draft, but polish could raise readiness beyond ${args.score}.`;
}

function buildPolishPreviewMarkdown(args: {
  findings: GeneratedResumePolishProposal["edits"];
  markdown: string;
}) {
  const baseMarkdown = args.markdown.trim();
  const normalized = baseMarkdown.replace(/\n{3,}/g, "\n\n");
  if (/^#{1,3}\s*(summary|profile|professional summary)\b/im.test(normalized)) {
    return normalized;
  }

  const firstBullet = normalized
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^[-*]\s+\S/.test(line))
    ?.replace(/^[-*]\s+/, "")
    .trim();
  if (!firstBullet) return normalized;

  return [
    "## Summary",
    `Evidence-backed candidate profile led by: ${firstBullet}`,
    "",
    normalized,
  ].join("\n");
}

function countResumeSections(markdown: string) {
  const headings = markdown.match(/^#{1,4}\s+\S.+$/gm);
  if (headings?.length) return headings.length;
  return ["experience", "education", "skills", "projects", "summary"].filter((heading) =>
    new RegExp(`\\b${heading}\\b`, "i").test(markdown),
  ).length;
}

function countResumeBullets(markdown: string) {
  return markdown.split(/\n/).filter((line) => /^\s*[-*]\s+\S/.test(line)).length;
}

function clampScore(score: number) {
  return Math.max(0, Math.min(100, score));
}

function formatMainResumeReadinessLabel(resume: MainResumeRow) {
  if (resume.positioningTitle) {
    return `${resume.positioningTitle} variant · generated readiness review`;
  }
  if (resume.generationMode === "resume_refresh") {
    return "Refreshed resume · generated readiness review";
  }
  return "Generated main resume · general readiness review";
}
