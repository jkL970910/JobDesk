import type { GeneratedResumeReadinessReview } from "../schemas/generated-resume-readiness-review";
import type { ResumeEvidenceEligibility } from "./resume-evidence-eligibility";

type ClaimLike = {
  id: string;
  claimText: string;
  claimStatus: string;
  evidenceIds: string[];
  riskLevel: string;
  staleReason: string | null;
  supportStatus: string;
};

export type ResumeReadinessWorklistItemType =
  | "fact_guard_hard_blocker"
  | "evidence_eligibility_blocker"
  | "stale_claim"
  | "missing_evidence"
  | "polish_only_suggestion";

export type ResumeReadinessWorklistRoute =
  | "fact_guard"
  | "evidence_library"
  | "work_queue"
  | "resume_builder"
  | "profile_positioning";

export type ResumeReadinessWorklistItem = {
  id: string;
  type: ResumeReadinessWorklistItemType;
  severity: "blocker" | "warning" | "info";
  title: string;
  detail: string;
  nextAction: string;
  route: ResumeReadinessWorklistRoute;
  linkedClaimIds: string[];
  linkedEvidenceIds: string[];
};

export type ResumeReadinessWorklist = {
  items: ResumeReadinessWorklistItem[];
  summary: {
    blockerCount: number;
    warningCount: number;
    infoCount: number;
    nextAction: ResumeReadinessWorklistItem | null;
    readyForFinalExport: boolean;
  };
};

export function buildResumeReadinessWorklist(args: {
  claims: ClaimLike[];
  evidenceEligibilityById?: Map<string, ResumeEvidenceEligibility> | Record<string, ResumeEvidenceEligibility>;
  missingEvidenceQuestions: string[];
  readinessReview: GeneratedResumeReadinessReview | null;
  resumeStatus: string;
}): ResumeReadinessWorklist {
  const evidenceEligibilityById = normalizeEligibilityMap(args.evidenceEligibilityById);
  const items = [
    ...buildFactGuardItems(args.claims, args.resumeStatus),
    ...buildEvidenceEligibilityItems(args.claims, evidenceEligibilityById),
    ...buildMissingEvidenceItems(args.missingEvidenceQuestions),
    ...buildReviewFindingItems(args.readinessReview),
  ];
  const deduped = dedupeWorklistItems(items);
  const blockerCount = deduped.filter((item) => item.severity === "blocker").length;
  const warningCount = deduped.filter((item) => item.severity === "warning").length;
  const infoCount = deduped.filter((item) => item.severity === "info").length;
  return {
    items: deduped,
    summary: {
      blockerCount,
      warningCount,
      infoCount,
      nextAction: deduped[0] ?? null,
      readyForFinalExport: args.resumeStatus === "validated" && blockerCount === 0,
    },
  };
}

function buildEvidenceEligibilityItems(
  claims: ClaimLike[],
  evidenceEligibilityById: Map<string, ResumeEvidenceEligibility>,
) {
  if (evidenceEligibilityById.size === 0) return [];
  const claimIdsByEvidenceId = new Map<string, string[]>();
  for (const claim of claims) {
    for (const evidenceId of claim.evidenceIds) {
      claimIdsByEvidenceId.set(evidenceId, [
        ...(claimIdsByEvidenceId.get(evidenceId) ?? []),
        claim.id,
      ]);
    }
  }
  return Array.from(evidenceEligibilityById.entries())
    .filter(([, eligibility]) => !eligibility.eligible)
    .map(([evidenceId, eligibility]) => ({
      id: `evidence-eligibility-${evidenceId}`,
      type: "evidence_eligibility_blocker" as const,
      severity: "blocker" as const,
      title: "Fix resume evidence eligibility",
      detail: eligibility.summary,
      nextAction: eligibility.blockers[0]?.detail ?? "Review this evidence before final export.",
      route: "evidence_library" as const,
      linkedClaimIds: claimIdsByEvidenceId.get(evidenceId) ?? [],
      linkedEvidenceIds: [evidenceId],
    }));
}

function buildFactGuardItems(claims: ClaimLike[], resumeStatus: string) {
  const items: ResumeReadinessWorklistItem[] = [];
  if (claims.length === 0) {
    items.push({
      id: "fact-guard-no-claim-ledger",
      type: "fact_guard_hard_blocker",
      severity: "blocker",
      title: "Run Fact Guard",
      detail: "No generated claim ledger exists for this resume, so final export cannot be unlocked.",
      nextAction: "Regenerate or rerun claim review before external use.",
      route: "fact_guard",
      linkedClaimIds: [],
      linkedEvidenceIds: [],
    });
  }
  if (resumeStatus !== "validated" && claims.length > 0) {
    items.push({
      id: "fact-guard-export-blocked",
      type: "fact_guard_hard_blocker",
      severity: "blocker",
      title: "Fact Guard must pass",
      detail: "Final export is blocked until every generated claim is supported and current.",
      nextAction: "Open claim review and fix unsupported or stale claims.",
      route: "fact_guard",
      linkedClaimIds: claims.map((claim) => claim.id),
      linkedEvidenceIds: uniqueStrings(claims.flatMap((claim) => claim.evidenceIds)),
    });
  }
  for (const claim of claims) {
    const claimIsStale = claim.claimStatus === "stale";
    const supportNeedsReview = ["unsupported", "partially_supported", "unvalidated"].includes(
      claim.supportStatus,
    ) || ["unsupported", "partially_supported", "unvalidated"].includes(claim.claimStatus);
    if (claimIsStale) {
      items.push({
        id: `stale-claim-${claim.id}`,
        type: "stale_claim",
        severity: "blocker",
        title: "Refresh stale claim",
        detail: claim.staleReason ?? claim.claimText,
        nextAction: "Rerun Fact Guard after fixing or confirming the linked evidence.",
        route: "fact_guard",
        linkedClaimIds: [claim.id],
        linkedEvidenceIds: claim.evidenceIds,
      });
    } else if (supportNeedsReview) {
      items.push({
        id: `claim-support-${claim.id}`,
        type: "fact_guard_hard_blocker",
        severity: claim.riskLevel === "high" ? "blocker" : "warning",
        title: "Fix unsupported claim",
        detail: claim.staleReason ?? claim.claimText,
        nextAction: "Open Evidence Library or edit the resume claim so Fact Guard can support it.",
        route: claim.evidenceIds.length > 0 ? "evidence_library" : "work_queue",
        linkedClaimIds: [claim.id],
        linkedEvidenceIds: claim.evidenceIds,
      });
    }
  }
  return items;
}

function buildMissingEvidenceItems(questions: string[]) {
  return questions.slice(0, 8).map((question, index) => ({
    id: `missing-evidence-${index}`,
    type: "missing_evidence" as const,
    severity: "warning" as const,
    title: "Add missing evidence",
    detail: question,
    nextAction: "Answer this in the Work Queue or add source material to Evidence Library.",
    route: "work_queue" as const,
    linkedClaimIds: [],
    linkedEvidenceIds: [],
  }));
}

function buildReviewFindingItems(review: GeneratedResumeReadinessReview | null) {
  if (!review) return [];
  return review.findings.map((finding) => {
    const route = finding.route === "resume_polish"
      ? "resume_builder"
      : finding.route === "positioning_gap"
        ? "profile_positioning"
        : "evidence_library";
    const type = finding.route === "resume_polish" || finding.route === "positioning_gap"
      ? "polish_only_suggestion"
      : "evidence_eligibility_blocker";
    return {
      id: `review-${finding.id}`,
      type,
      severity: finding.severity,
      title: finding.title,
      detail: finding.detail,
      nextAction: finding.suggested_action,
      route,
      linkedClaimIds: finding.linked_claim_ids,
      linkedEvidenceIds: [],
    } satisfies ResumeReadinessWorklistItem;
  });
}

function dedupeWorklistItems(items: ResumeReadinessWorklistItem[]) {
  const seen = new Set<string>();
  const ordered = sortWorklistItems(items);
  return ordered.filter((item) => {
    const key = `${item.type}:${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sortWorklistItems(items: ResumeReadinessWorklistItem[]) {
  const severityRank = { blocker: 0, warning: 1, info: 2 };
  const typeRank: Record<ResumeReadinessWorklistItemType, number> = {
    fact_guard_hard_blocker: 0,
    stale_claim: 1,
    evidence_eligibility_blocker: 2,
    missing_evidence: 3,
    polish_only_suggestion: 4,
  };
  return [...items].sort((left, right) =>
    severityRank[left.severity] - severityRank[right.severity] ||
    typeRank[left.type] - typeRank[right.type] ||
    left.title.localeCompare(right.title),
  );
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}

function normalizeEligibilityMap(
  value?: Map<string, ResumeEvidenceEligibility> | Record<string, ResumeEvidenceEligibility>,
) {
  if (!value) return new Map<string, ResumeEvidenceEligibility>();
  if (value instanceof Map) return value;
  return new Map(Object.entries(value));
}
