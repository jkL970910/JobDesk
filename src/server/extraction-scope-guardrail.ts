import type { ProfileEvidenceExtraction } from "../schemas/profile-evidence-extraction";
import { classifyExtractedAssetCandidate } from "./scope-classifier";
import type { ScopeClassificationResult } from "./scope-classifier";

export type WorkExperienceScopeGuardrailResult = {
  accepted: ProfileEvidenceExtraction["work_experiences"];
  reviewNotes: string[];
  decisions: Array<{
    draft: ProfileEvidenceExtraction["work_experiences"][number];
    classification: ScopeClassificationResult;
    disposition: "accepted" | "review_queue_only" | "rejected";
  }>;
};

export function guardWorkExperienceDraftsForPersistence(
  drafts: ProfileEvidenceExtraction["work_experiences"],
  args: {
    sourceSection?: string | null;
    sourceTitle?: string | null;
  } = {},
): WorkExperienceScopeGuardrailResult {
  const accepted: ProfileEvidenceExtraction["work_experiences"] = [];
  const reviewNotes: string[] = [];
  const decisions: WorkExperienceScopeGuardrailResult["decisions"] = [];

  for (const draft of drafts) {
    const classification = classifyExtractedAssetCandidate({
      proposedScope: "work_experience",
      content: buildWorkExperienceCandidateText(draft),
      sourceSection: args.sourceSection ?? "Work Experience",
      sourceQuote: draft.summary ?? buildWorkExperienceLabel(draft),
    });
    const policy = classification.decision.canonicalLinkPolicy;
    const disposition =
      policy === "reject_as_invalid_scope"
        ? "rejected"
        : policy === "review_queue_only"
          ? "review_queue_only"
          : "accepted";
    decisions.push({ draft, classification, disposition });
    if (disposition === "accepted") {
      accepted.push(draft);
      continue;
    }
    reviewNotes.push(buildScopeReviewNote(draft, classification, args.sourceTitle));
  }

  return { accepted, reviewNotes, decisions };
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

function buildScopeReviewNote(
  draft: ProfileEvidenceExtraction["work_experiences"][number],
  classification: ScopeClassificationResult,
  sourceTitle?: string | null,
) {
  const label = buildWorkExperienceLabel(draft) || "Untitled Work Experience candidate";
  const source = sourceTitle?.trim() ? ` from ${sourceTitle.trim()}` : "";
  return [
    `Scope review needed${source}: "${label}" was not saved as a Work Experience.`,
    `Reason: ${classification.decision.reason}`,
    "Review the source and save it as the correct scope before using it in resumes.",
  ].join(" ");
}
