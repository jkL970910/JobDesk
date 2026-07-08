import type { ExtractedAssetScope, ScopeConfidence } from "./scope-decision";

export type ExtractedAssetCandidate = {
  aiConfidence?: ScopeConfidence;
  content: string;
  id?: string;
  linkedInitiativeHint?: string | null;
  linkedWorkExperienceHint?: string | null;
  nearbyHeadings?: string[];
  proposedScope: ExtractedAssetScope;
  resumeSourceVersionId?: string | null;
  sourceDocumentId?: string | null;
  sourceQuote?: string | null;
  sourceSection?: string | null;
};

export type NormalizedExtractedAssetCandidate = ExtractedAssetCandidate & {
  content: string;
  nearbyHeadings: string[];
  sourceQuote: string | null;
  sourceSection: string | null;
};

export function normalizeExtractedAssetCandidate(
  candidate: ExtractedAssetCandidate,
): NormalizedExtractedAssetCandidate {
  return {
    ...candidate,
    content: normalizeCandidateText(candidate.content),
    nearbyHeadings: normalizeCandidateHeadings(candidate.nearbyHeadings),
    sourceQuote: normalizeNullableCandidateText(candidate.sourceQuote),
    sourceSection: normalizeNullableCandidateText(candidate.sourceSection),
  };
}

function normalizeCandidateText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeNullableCandidateText(value?: string | null) {
  const normalized = value ? normalizeCandidateText(value) : "";
  return normalized || null;
}

function normalizeCandidateHeadings(value?: string[]) {
  if (!value?.length) return [];
  return Array.from(
    new Set(
      value
        .map((item) => normalizeCandidateText(item))
        .filter(Boolean),
    ),
  );
}
