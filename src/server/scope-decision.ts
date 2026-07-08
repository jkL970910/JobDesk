export type ScopeConfidence = "low" | "medium" | "high";

export type ExtractedAssetScope =
  | "work_experience"
  | "work_initiative"
  | "portfolio_project"
  | "evidence_claim"
  | "profile_context"
  | "imported_note"
  | "enrichment_question";

export type AcceptedAssetScope =
  | "work_experience"
  | "work_initiative"
  | "portfolio_project"
  | "evidence_claim"
  | "profile_context"
  | "imported_note"
  | "unassigned";

export type CanonicalLinkPolicy =
  | "can_persist_to_canonical_pending"
  | "persist_unassigned_pending"
  | "review_queue_only"
  | "reject_as_invalid_scope";

export type ScopeDecision = {
  acceptedScope: AcceptedAssetScope;
  canonicalLinkPolicy: CanonicalLinkPolicy;
  confidence: ScopeConfidence;
  needsUserReview: boolean;
  possibleAlternatives: AcceptedAssetScope[];
  reason: string;
};

export function reviewQueueScopeDecision(args: {
  acceptedScope?: AcceptedAssetScope;
  confidence?: ScopeConfidence;
  possibleAlternatives?: AcceptedAssetScope[];
  reason: string;
}): ScopeDecision {
  return {
    acceptedScope: args.acceptedScope ?? "unassigned",
    canonicalLinkPolicy: "review_queue_only",
    confidence: args.confidence ?? "low",
    needsUserReview: true,
    possibleAlternatives: args.possibleAlternatives ?? [],
    reason: args.reason,
  };
}

export function pendingCanonicalScopeDecision(args: {
  acceptedScope: Exclude<AcceptedAssetScope, "unassigned">;
  confidence: ScopeConfidence;
  needsUserReview?: boolean;
  possibleAlternatives?: AcceptedAssetScope[];
  reason: string;
}): ScopeDecision {
  return {
    acceptedScope: args.acceptedScope,
    canonicalLinkPolicy: "can_persist_to_canonical_pending",
    confidence: args.confidence,
    needsUserReview: args.needsUserReview ?? args.confidence !== "high",
    possibleAlternatives: args.possibleAlternatives ?? [],
    reason: args.reason,
  };
}

export function invalidScopeDecision(reason: string): ScopeDecision {
  return {
    acceptedScope: "unassigned",
    canonicalLinkPolicy: "reject_as_invalid_scope",
    confidence: "low",
    needsUserReview: true,
    possibleAlternatives: [],
    reason,
  };
}
