import crypto from "node:crypto";

import type { ScopeClassificationResult } from "./scope-classifier";

export type ScopeReviewCandidatePayload = {
  kind: "scope_review_candidate";
  candidateId: string;
  proposedScope:
    | "work_experience"
    | "work_initiative"
    | "portfolio_project"
    | "evidence_claim"
    | "profile_context"
    | "imported_note"
    | "enrichment_question";
  classifierAcceptedScope:
    | "work_experience"
    | "work_initiative"
    | "portfolio_project"
    | "evidence_claim"
    | "profile_context"
    | "imported_note"
    | "unassigned";
  guardrailReason: string;
  sourceDocumentId?: string | null;
  sourceLabel: string;
  sourceQuote?: string | null;
  sourceSection?: string | null;
  sourceSnippet: string;
  suggestedAction:
    | "save_as_evidence"
    | "save_as_work_initiative"
    | "save_as_portfolio_project"
    | "save_as_profile_context"
    | "review_scope"
    | "dismiss";
  resolutionStatus: "open" | "resolved" | "dismissed";
};

export function buildScopeReviewCandidatePayload(args: {
  classification: ScopeClassificationResult;
  label: string;
  proposedScope: ScopeReviewCandidatePayload["proposedScope"];
  sourceDocumentId?: string | null;
  sourceLabel: string;
  sourceSection?: string | null;
}) {
  const sourceSnippet = args.label.trim() || `Untitled ${args.proposedScope.replace(/_/g, " ")} candidate`;
  return {
    kind: "scope_review_candidate" as const,
    candidateId: `scope:${crypto
      .createHash("sha256")
      .update([
        args.sourceDocumentId ?? "",
        args.sourceLabel,
        args.proposedScope,
        sourceSnippet,
        args.classification.decision.reason,
      ].join("|"))
      .digest("hex")
      .slice(0, 24)}`,
    proposedScope: args.proposedScope,
    classifierAcceptedScope: args.classification.decision.acceptedScope,
    guardrailReason: args.classification.decision.reason,
    sourceDocumentId: args.sourceDocumentId ?? null,
    sourceLabel: args.sourceLabel,
    sourceQuote: sourceSnippet,
    sourceSection: args.sourceSection ?? args.sourceLabel,
    sourceSnippet,
    suggestedAction: suggestScopeReviewAction(args.classification),
    resolutionStatus: "open" as const,
  };
}

export function parseScopeReviewCandidatePayloadFromNote(args: {
  note: string;
  sourceDocumentId?: string | null;
  sourceLabel: string;
}): ScopeReviewCandidatePayload | null {
  const match = args.note.match(
    /Scope review needed(?: from (?<source>.*?))?: "(?<snippet>.*?)" was not saved as a (?<scope>[^.]+)\. Reason: (?<reason>.*?) Review the source and save it as the correct scope before using it in resumes\./,
  );
  if (!match?.groups) return null;
  const { reason, scope, snippet, source } = match.groups;
  if (!reason || !scope || !snippet) return null;
  const proposedScope = mapRejectedScopeLabel(scope);
  const guardrailReason = reason.trim();
  const sourceSnippet = snippet.trim();
  const acceptedScope = inferAcceptedScopeFromGuardrailReason(guardrailReason);
  return {
    kind: "scope_review_candidate",
    candidateId: `scope:${crypto.createHash("sha256").update(args.note).digest("hex").slice(0, 24)}`,
    proposedScope,
    classifierAcceptedScope: acceptedScope,
    guardrailReason,
    sourceDocumentId: args.sourceDocumentId ?? null,
    sourceLabel: args.sourceLabel,
    sourceQuote: sourceSnippet,
    sourceSection: source?.trim() || args.sourceLabel,
    sourceSnippet,
    suggestedAction: suggestActionFromAcceptedScope(acceptedScope),
    resolutionStatus: "open",
  };
}

function suggestScopeReviewAction(
  classification: ScopeClassificationResult,
): ScopeReviewCandidatePayload["suggestedAction"] {
  if (classification.decision.canonicalLinkPolicy === "reject_as_invalid_scope") {
    return "review_scope";
  }
  return suggestActionFromAcceptedScope(classification.decision.acceptedScope);
}

function suggestActionFromAcceptedScope(
  acceptedScope: ScopeReviewCandidatePayload["classifierAcceptedScope"],
): ScopeReviewCandidatePayload["suggestedAction"] {
  if (acceptedScope === "profile_context") return "save_as_profile_context";
  if (acceptedScope === "evidence_claim") return "save_as_evidence";
  if (acceptedScope === "work_initiative") return "save_as_work_initiative";
  if (acceptedScope === "portfolio_project") return "save_as_portfolio_project";
  return "review_scope";
}

function mapRejectedScopeLabel(scope: string): ScopeReviewCandidatePayload["proposedScope"] {
  const normalized = scope.trim().toLowerCase();
  if (normalized === "work experience") return "work_experience";
  if (normalized === "work initiative") return "work_initiative";
  if (normalized === "portfolio project") return "portfolio_project";
  if (normalized === "evidence claim") return "evidence_claim";
  return "imported_note";
}

function inferAcceptedScopeFromGuardrailReason(
  reason: string,
): ScopeReviewCandidatePayload["classifierAcceptedScope"] {
  const normalized = reason.toLowerCase();
  if (/\bprofile context\b|\bskills\b|\bprofile-positioning\b/.test(normalized)) {
    return "profile_context";
  }
  if (/\bimported observation\b|\backnowledged\b|\bsource\/profile review\b/.test(normalized)) {
    return "imported_note";
  }
  if (/\bmust\b|\brequires\b|\bneeds\b|\blacks\b|\bambiguous\b|\bnot\b/.test(normalized)) {
    return "unassigned";
  }
  if (/\bevidence\b|\batomic\b|\btechnology\/action fragment\b/.test(normalized)) {
    return "evidence_claim";
  }
  if (/\bwork initiative\b|\bstory\b|\bproject\/story\b/.test(normalized)) {
    return "work_initiative";
  }
  if (/\bportfolio project\b|\bnon-employer\b/.test(normalized)) {
    return "portfolio_project";
  }
  if (/\bwork experience\b|\brole-container\b/.test(normalized)) {
    return "work_experience";
  }
  return "unassigned";
}
