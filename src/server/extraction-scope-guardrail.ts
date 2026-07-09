import type { ProfileEvidenceExtraction } from "../schemas/profile-evidence-extraction";
import {
  buildScopeReviewCandidatePayload,
  type ScopeReviewCandidatePayload,
} from "./scope-review-candidate";
import { classifyExtractedAssetCandidate } from "./scope-classifier";
import type { ScopeClassificationResult } from "./scope-classifier";

export type WorkExperienceScopeGuardrailResult = {
  accepted: ProfileEvidenceExtraction["work_experiences"];
  reviewNotes: string[];
  reviewCandidates: ScopeReviewCandidate[];
  decisions: Array<{
    draft: ProfileEvidenceExtraction["work_experiences"][number];
    classification: ScopeClassificationResult;
    disposition: "accepted" | "review_queue_only" | "rejected";
  }>;
  summary: WorkExperienceScopeGuardrailSummary;
};

export type ExtractionScopeGuardrailSummary = {
  acceptedCount: number;
  rejectedCount: number;
  reviewQueueOnlyCount: number;
  totalCount: number;
  reasonCounts: Record<string, number>;
};

export type WorkExperienceScopeGuardrailSummary = ExtractionScopeGuardrailSummary;

type GuardrailDisposition = "accepted" | "review_queue_only" | "rejected";

export type ScopeReviewCandidate = {
  note: string;
  payload: ScopeReviewCandidatePayload;
};

type DraftScopeGuardrailResult<TDraft> = {
  accepted: TDraft[];
  reviewNotes: string[];
  reviewCandidates: ScopeReviewCandidate[];
  decisions: Array<{
    draft: TDraft;
    classification: ScopeClassificationResult;
    disposition: GuardrailDisposition;
  }>;
  summary: ExtractionScopeGuardrailSummary;
};

export type InitiativeScopeGuardrailResult = DraftScopeGuardrailResult<
  ProfileEvidenceExtraction["initiatives"][number]
>;
export type PortfolioProjectScopeGuardrailResult = DraftScopeGuardrailResult<
  ProfileEvidenceExtraction["portfolio_projects"][number]
>;
export type EvidenceScopeGuardrailResult = DraftScopeGuardrailResult<
  ProfileEvidenceExtraction["evidence_items"][number]
>;

export function guardWorkExperienceDraftsForPersistence(
  drafts: ProfileEvidenceExtraction["work_experiences"],
  args: {
    sourceSection?: string | null;
    sourceTitle?: string | null;
    sourceDocumentId?: string | null;
  } = {},
): WorkExperienceScopeGuardrailResult {
  const accepted: ProfileEvidenceExtraction["work_experiences"] = [];
  const reviewNotes: string[] = [];
  const reviewCandidates: ScopeReviewCandidate[] = [];
  const decisions: WorkExperienceScopeGuardrailResult["decisions"] = [];

  for (const draft of drafts) {
    const classification = classifyExtractedAssetCandidate({
      proposedScope: "work_experience",
      content: buildWorkExperienceCandidateText(draft),
      sourceSection: args.sourceSection ?? "Work Experience",
      sourceQuote: draft.summary ?? buildWorkExperienceLabel(draft),
    });
    const disposition = dispositionFromPolicy(classification);
    decisions.push({ draft, classification, disposition });
    if (disposition === "accepted") {
      accepted.push(draft);
      continue;
    }
    addScopeReviewCandidate(reviewNotes, reviewCandidates, {
      classification,
      label: buildWorkExperienceLabel(draft) || "Untitled Work Experience candidate",
      proposedScope: "work_experience",
      rejectedScope: "Work Experience",
      sourceDocumentId: args.sourceDocumentId,
      sourceSection: args.sourceSection ?? "Work Experience",
      sourceTitle: args.sourceTitle,
    });
  }

  return { accepted, reviewNotes, reviewCandidates, decisions, summary: summarizeGuardrailDecisions(decisions) };
}

export function guardInitiativeDraftsForPersistence(
  drafts: ProfileEvidenceExtraction["initiatives"],
  args: {
    resolveWorkExperienceContext?: (workExperienceRef: string | null | undefined) => {
      employer: string;
      id?: string;
      roleTitle: string;
      sourceSection?: string | null;
    } | null;
    sourceTitle?: string | null;
    sourceDocumentId?: string | null;
  } = {},
): InitiativeScopeGuardrailResult {
  const accepted: ProfileEvidenceExtraction["initiatives"] = [];
  const reviewNotes: string[] = [];
  const reviewCandidates: ScopeReviewCandidate[] = [];
  const decisions: InitiativeScopeGuardrailResult["decisions"] = [];

  for (const draft of drafts) {
    const classification = classifyExtractedAssetCandidate({
      proposedScope: "work_initiative",
      content: buildInitiativeCandidateText(draft),
      sourceSection: draft.work_experience_ref ?? "Work Initiative",
      sourceQuote: buildInitiativeCandidateText(draft),
    }, {
      linkedWorkExperience: args.resolveWorkExperienceContext?.(draft.work_experience_ref) ?? null,
    });
    const disposition = dispositionFromPolicy(classification);
    decisions.push({ draft, classification, disposition });
    if (disposition === "accepted") {
      accepted.push(draft);
      continue;
    }
    addScopeReviewCandidate(reviewNotes, reviewCandidates, {
      classification,
      label: draft.internal_title || draft.external_safe_title || "Untitled Work Initiative candidate",
      proposedScope: "work_initiative",
      rejectedScope: "Work Initiative",
      sourceDocumentId: args.sourceDocumentId,
      sourceSection: draft.work_experience_ref ?? "Work Initiative",
      sourceTitle: args.sourceTitle,
    });
  }

  return { accepted, reviewNotes, reviewCandidates, decisions, summary: summarizeGuardrailDecisions(decisions) };
}

export function guardPortfolioProjectDraftsForPersistence(
  drafts: ProfileEvidenceExtraction["portfolio_projects"],
  args: {
    sourceTitle?: string | null;
    sourceDocumentId?: string | null;
  } = {},
): PortfolioProjectScopeGuardrailResult {
  const accepted: ProfileEvidenceExtraction["portfolio_projects"] = [];
  const reviewNotes: string[] = [];
  const reviewCandidates: ScopeReviewCandidate[] = [];
  const decisions: PortfolioProjectScopeGuardrailResult["decisions"] = [];

  for (const draft of drafts) {
    const classification = classifyExtractedAssetCandidate({
      proposedScope: "portfolio_project",
      content: buildPortfolioProjectCandidateText(draft),
      sourceSection: "Portfolio Project",
      sourceQuote: buildPortfolioProjectCandidateText(draft),
    });
    const disposition = dispositionFromPolicy(classification);
    decisions.push({ draft, classification, disposition });
    if (disposition === "accepted") {
      accepted.push(draft);
      continue;
    }
    addScopeReviewCandidate(reviewNotes, reviewCandidates, {
      classification,
      label: draft.title || draft.external_safe_title || "Untitled Portfolio Project candidate",
      proposedScope: "portfolio_project",
      rejectedScope: "Portfolio Project",
      sourceDocumentId: args.sourceDocumentId,
      sourceSection: "Portfolio Project",
      sourceTitle: args.sourceTitle,
    });
  }

  return { accepted, reviewNotes, reviewCandidates, decisions, summary: summarizeGuardrailDecisions(decisions) };
}

export function guardEvidenceDraftsForPersistence(
  drafts: ProfileEvidenceExtraction["evidence_items"],
  args: {
    sourceTitle?: string | null;
    sourceDocumentId?: string | null;
  } = {},
): EvidenceScopeGuardrailResult {
  const accepted: ProfileEvidenceExtraction["evidence_items"] = [];
  const reviewNotes: string[] = [];
  const reviewCandidates: ScopeReviewCandidate[] = [];
  const decisions: EvidenceScopeGuardrailResult["decisions"] = [];

  for (const draft of drafts) {
    const classification = classifyExtractedAssetCandidate({
      proposedScope: "evidence_claim",
      content: draft.text,
      sourceSection: "Evidence Claim",
      sourceQuote: draft.source_quote,
    });
    const disposition = isReviewableEvidenceDraft(draft, classification)
      ? "accepted"
      : dispositionFromPolicy(classification);
    decisions.push({ draft, classification, disposition });
    if (disposition === "accepted") {
      accepted.push(draft);
      continue;
    }
    addScopeReviewCandidate(reviewNotes, reviewCandidates, {
      classification,
      label: draft.text,
      proposedScope: "evidence_claim",
      rejectedScope: "Evidence Claim",
      sourceDocumentId: args.sourceDocumentId,
      sourceSection: "Evidence Claim",
      sourceTitle: args.sourceTitle,
    });
  }

  return { accepted, reviewNotes, reviewCandidates, decisions, summary: summarizeGuardrailDecisions(decisions) };
}

function isReviewableEvidenceDraft(
  draft: ProfileEvidenceExtraction["evidence_items"][number],
  classification: ScopeClassificationResult,
) {
  if (
    classification.decision.acceptedScope !== "evidence_claim" ||
    classification.decision.canonicalLinkPolicy !== "can_persist_to_canonical_pending"
  ) {
    return false;
  }
  const wordCount = draft.text.trim().split(/\s+/).filter(Boolean).length;
  const broadStoryMarkers = (draft.text.match(/\b(across|planning|coordination|enablement|strategy|roadmap)\b/gi) ?? []).length;
  return Boolean(draft.source_quote.trim()) && wordCount <= 14 && broadStoryMarkers < 2;
}

function buildWorkExperienceCandidateText(
  draft: ProfileEvidenceExtraction["work_experiences"][number],
) {
  return [
    buildWorkExperienceLabel(draft),
    draft.team,
    draft.location,
    draft.start_date,
    draft.end_date,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" · ");
}

function buildWorkExperienceLabel(
  draft: ProfileEvidenceExtraction["work_experiences"][number],
) {
  return [draft.employer, draft.role_title].filter(Boolean).join(" · ");
}

function buildInitiativeCandidateText(
  draft: ProfileEvidenceExtraction["initiatives"][number],
) {
  return [
    draft.internal_title,
    draft.external_safe_title,
    draft.context,
    draft.problem,
    draft.role,
    ...draft.actions,
    ...draft.results,
    ...draft.technologies,
    ...(draft.stakeholders ?? []),
    draft.external_safe_summary,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ");
}

function buildPortfolioProjectCandidateText(
  draft: ProfileEvidenceExtraction["portfolio_projects"][number],
) {
  return [
    draft.title,
    draft.external_safe_title,
    draft.context,
    draft.problem,
    draft.role,
    ...draft.actions,
    ...draft.results,
    ...draft.technologies,
    ...(draft.stakeholders ?? []),
    draft.external_safe_summary,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ");
}

function addScopeReviewCandidate(
  reviewNotes: string[],
  reviewCandidates: ScopeReviewCandidate[],
  args: {
    classification: ScopeClassificationResult;
    label: string;
    proposedScope: ScopeReviewCandidatePayload["proposedScope"];
    rejectedScope: string;
    sourceDocumentId?: string | null;
    sourceSection?: string | null;
    sourceTitle?: string | null;
  },
) {
  const note = buildScopeReviewNote({
    label: args.label,
    classification: args.classification,
    sourceTitle: args.sourceTitle,
    rejectedScope: args.rejectedScope,
  });
  reviewNotes.push(note);
  reviewCandidates.push({
    note,
    payload: buildScopeReviewCandidatePayload({
      classification: args.classification,
      label: args.label,
      proposedScope: args.proposedScope,
      sourceDocumentId: args.sourceDocumentId,
      sourceLabel: args.sourceTitle ?? "Imported source",
      sourceSection: args.sourceSection,
    }),
  });
}

function buildScopeReviewNote(args: {
  label: string;
  classification: ScopeClassificationResult;
  sourceTitle?: string | null;
  rejectedScope: string;
}) {
  const label = args.label || `Untitled ${args.rejectedScope} candidate`;
  const sourceTitle = args.sourceTitle;
  const source = sourceTitle?.trim() ? ` from ${sourceTitle.trim()}` : "";
  return [
    `Scope review needed${source}: "${label}" was not saved as a ${args.rejectedScope}.`,
    `Reason: ${args.classification.decision.reason}`,
    "Review the source and save it as the correct scope before using it in resumes.",
  ].join(" ");
}

function dispositionFromPolicy(classification: ScopeClassificationResult): GuardrailDisposition {
  const policy = classification.decision.canonicalLinkPolicy;
  if (policy === "reject_as_invalid_scope") return "rejected";
  if (policy === "review_queue_only") return "review_queue_only";
  return "accepted";
}

function summarizeGuardrailDecisions<TDraft>(
  decisions: DraftScopeGuardrailResult<TDraft>["decisions"],
): WorkExperienceScopeGuardrailSummary {
  const reasonCounts: Record<string, number> = {};
  for (const decision of decisions) {
    const reason = normalizeReasonForDiagnostics(decision.classification.decision.reason);
    reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
  }
  return {
    acceptedCount: decisions.filter((decision) => decision.disposition === "accepted").length,
    rejectedCount: decisions.filter((decision) => decision.disposition === "rejected").length,
    reviewQueueOnlyCount: decisions.filter((decision) => decision.disposition === "review_queue_only").length,
    totalCount: decisions.length,
    reasonCounts,
  };
}

function normalizeReasonForDiagnostics(reason: string) {
  return reason.replace(/\s+/g, " ").trim().slice(0, 180) || "unspecified";
}
