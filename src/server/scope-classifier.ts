import {
  normalizeExtractedAssetCandidate,
  type ExtractedAssetCandidate,
  type NormalizedExtractedAssetCandidate,
} from "./extracted-asset-candidate";
import {
  invalidScopeDecision,
  pendingCanonicalScopeDecision,
  reviewQueueScopeDecision,
  type ScopeDecision,
} from "./scope-decision";

export type ScopeClassifierWorkExperienceContext = {
  employer: string;
  id?: string;
  roleTitle: string;
  sourceSection?: string | null;
};

export type ScopeClassifierContext = {
  linkedWorkExperience?: ScopeClassifierWorkExperienceContext | null;
};

export type ScopeClassificationResult = {
  candidate: NormalizedExtractedAssetCandidate;
  decision: ScopeDecision;
  initiativeClusterKey: string | null;
  signals: string[];
};

const ACTION_VERBS = new Set([
  "architected",
  "built",
  "created",
  "delivered",
  "designed",
  "developed",
  "implemented",
  "improved",
  "increased",
  "launched",
  "led",
  "migrated",
  "optimized",
  "reduced",
  "scaled",
  "shipped",
]);

const TECHNOLOGY_TERMS = [
  "aws",
  "cdk",
  "cache",
  "caching",
  "distributed",
  "dynamodb",
  "graphql",
  "java",
  "kafka",
  "kubernetes",
  "lambda",
  "node",
  "postgres",
  "python",
  "react",
  "redis",
  "sql",
  "typescript",
];

const DOMAIN_TERMS = [
  "api",
  "delivery",
  "infrastructure",
  "latency",
  "onboarding",
  "pipeline",
  "provisioning",
  "reporting",
  "service",
  "session",
];

export function classifyExtractedAssetCandidate(
  candidate: ExtractedAssetCandidate,
  context: ScopeClassifierContext = {},
): ScopeClassificationResult {
  const normalized = normalizeExtractedAssetCandidate(candidate);
  const text = normalized.content;
  const sectionText = [normalized.sourceSection, ...normalized.nearbyHeadings].join(" ");
  const signals = collectScopeSignals(text, sectionText);

  if (isImportedObservation(text)) {
    return result(normalized, signals, reviewQueueScopeDecision({
      acceptedScope: "imported_note",
      confidence: "high",
      reason: "Imported observation should be acknowledged or routed to source/profile review, not saved as evidence or story.",
    }));
  }

  if (isSkillsOrProfileContext(text, sectionText)) {
    return result(normalized, signals, reviewQueueScopeDecision({
      acceptedScope: "profile_context",
      confidence: "medium",
      possibleAlternatives: ["unassigned"],
      reason: "Skills or profile-positioning material is guidance/context and must not bind to a random project.",
    }));
  }

  if (candidate.proposedScope === "work_experience") {
    return classifyWorkExperienceCandidate(normalized, signals);
  }

  if (candidate.proposedScope === "work_initiative") {
    return classifyWorkInitiativeCandidate(normalized, signals, context);
  }

  if (candidate.proposedScope === "portfolio_project") {
    return classifyPortfolioProjectCandidate(normalized, signals, context);
  }

  if (candidate.proposedScope === "evidence_claim") {
    return classifyEvidenceCandidate(normalized, signals);
  }

  if (candidate.proposedScope === "profile_context") {
    return result(normalized, signals, pendingCanonicalScopeDecision({
      acceptedScope: "profile_context",
      confidence: "medium",
      needsUserReview: true,
      reason: "Profile context is guidance, not factual proof for resume claims.",
    }));
  }

  return result(normalized, signals, reviewQueueScopeDecision({
    acceptedScope: candidate.proposedScope === "imported_note" ? "imported_note" : "unassigned",
    confidence: "low",
    reason: "Candidate needs review before canonical persistence.",
  }));
}

function classifyWorkExperienceCandidate(
  candidate: NormalizedExtractedAssetCandidate,
  signals: string[],
): ScopeClassificationResult {
  if (isBulletShaped(candidate.content) || isPureTechnologyPhrase(candidate.content)) {
    return result(candidate, signals, invalidScopeDecision("Bullet-shaped action or technology phrase cannot become a Work Experience."));
  }
  const hasContainerSignal = hasEmployerLikeSignal(candidate.content) && hasRoleLikeSignal(candidate.content);
  const hasDateOrTeamSignal = hasDateSignal(candidate.content) || /\b(team|org|organization|department|group)\b/i.test(candidate.content);
  if (!hasContainerSignal || !hasDateOrTeamSignal) {
    return result(candidate, signals, reviewQueueScopeDecision({
      acceptedScope: "unassigned",
      confidence: "low",
      possibleAlternatives: ["work_initiative", "evidence_claim"],
      reason: "Work Experience needs employer/title plus date or team-like container evidence.",
    }));
  }
  return result(candidate, signals, pendingCanonicalScopeDecision({
    acceptedScope: "work_experience",
    confidence: "high",
    reason: "Candidate has role-container signals.",
  }));
}

function classifyWorkInitiativeCandidate(
  candidate: NormalizedExtractedAssetCandidate,
  signals: string[],
  context: ScopeClassifierContext,
): ScopeClassificationResult {
  if (!context.linkedWorkExperience) {
    return result(candidate, signals, reviewQueueScopeDecision({
      acceptedScope: "unassigned",
      confidence: "medium",
      possibleAlternatives: ["portfolio_project", "evidence_claim"],
      reason: "Work Initiative requires a confirmed Work Experience or an explicit unassigned review path.",
    }));
  }
  if (isPureTechnologyPhrase(candidate.content)) {
    return result(candidate, signals, reviewQueueScopeDecision({
      acceptedScope: "evidence_claim",
      confidence: "medium",
      possibleAlternatives: ["work_initiative"],
      reason: "Pure technology/action fragment is evidence or thin story context until business goal/outcome is confirmed.",
    }));
  }
  const hasStorySignal = signals.some((signal) =>
    ["action", "domain", "outcome", "technology"].includes(signal),
  );
  if (!hasStorySignal) {
    return result(candidate, signals, reviewQueueScopeDecision({
      acceptedScope: "unassigned",
      confidence: "low",
      possibleAlternatives: ["evidence_claim"],
      reason: "Candidate lacks enough project/story signals for a Work Initiative.",
    }));
  }
  return result(candidate, signals, pendingCanonicalScopeDecision({
    acceptedScope: "work_initiative",
    confidence: signals.includes("outcome") ? "high" : "medium",
    needsUserReview: !signals.includes("outcome"),
    possibleAlternatives: signals.includes("outcome") ? [] : ["evidence_claim"],
    reason: "Candidate has role-linked story/action/domain signals.",
  }));
}

function classifyPortfolioProjectCandidate(
  candidate: NormalizedExtractedAssetCandidate,
  signals: string[],
  context: ScopeClassifierContext,
): ScopeClassificationResult {
  if (context.linkedWorkExperience || hasEmployerLikeSignal(candidate.content)) {
    return result(candidate, signals, reviewQueueScopeDecision({
      acceptedScope: "unassigned",
      confidence: "medium",
      possibleAlternatives: ["work_initiative"],
      reason: "Employer-context material should not automatically become a Portfolio Project.",
    }));
  }
  if (hasPortfolioSignal(candidate.content) || !hasEmployerLikeSignal(candidate.content)) {
    return result(candidate, signals, pendingCanonicalScopeDecision({
      acceptedScope: "portfolio_project",
      confidence: hasPortfolioSignal(candidate.content) ? "high" : "medium",
      needsUserReview: !hasPortfolioSignal(candidate.content),
      possibleAlternatives: hasPortfolioSignal(candidate.content) ? [] : ["unassigned"],
      reason: "Candidate is non-employer project material.",
    }));
  }
  return result(candidate, signals, reviewQueueScopeDecision({
    reason: "Portfolio Project scope is ambiguous.",
  }));
}

function classifyEvidenceCandidate(
  candidate: NormalizedExtractedAssetCandidate,
  signals: string[],
): ScopeClassificationResult {
  if (isAtomicFact(candidate.content) || isShortSourcedEvidencePhrase(candidate)) {
    return result(candidate, signals, pendingCanonicalScopeDecision({
      acceptedScope: "evidence_claim",
      confidence: candidate.sourceQuote ? "high" : "medium",
      needsUserReview: !candidate.sourceQuote,
      reason: candidate.sourceQuote
        ? "Atomic sourced fact can persist as pending evidence."
        : "Atomic fact lacks source quote and needs evidence review.",
    }));
  }
  return result(candidate, signals, reviewQueueScopeDecision({
    acceptedScope: "unassigned",
    confidence: "medium",
    possibleAlternatives: ["work_initiative"],
    reason: "Candidate is broader than an atomic evidence claim.",
  }));
}

function isShortSourcedEvidencePhrase(candidate: NormalizedExtractedAssetCandidate) {
  const wordCount = candidate.content.trim().split(/\s+/).filter(Boolean).length;
  const broadStoryMarkers = (candidate.content.match(/\b(across|planning|coordination|enablement|strategy|roadmap)\b/gi) ?? []).length;
  return (
    Boolean(candidate.sourceQuote?.trim()) &&
    wordCount <= 14 &&
    broadStoryMarkers < 2 &&
    !isPureTechnologyPhrase(candidate.content)
  );
}

function result(
  candidate: NormalizedExtractedAssetCandidate,
  signals: string[],
  decision: ScopeDecision,
): ScopeClassificationResult {
  return {
    candidate,
    decision,
    initiativeClusterKey:
      decision.acceptedScope === "work_initiative" || decision.possibleAlternatives.includes("work_initiative")
        ? buildInitiativeClusterKey(candidate, signals)
        : null,
    signals,
  };
}

function collectScopeSignals(text: string, sectionText: string) {
  const signals = new Set<string>();
  if (isBulletShaped(text)) signals.add("bullet");
  if (hasTechnologySignal(text)) signals.add("technology");
  if (hasDomainSignal(text)) signals.add("domain");
  if (hasOutcomeSignal(text)) signals.add("outcome");
  if (hasActionSignal(text)) signals.add("action");
  if (hasDateSignal(text)) signals.add("date");
  if (isSkillsOrProfileContext(text, sectionText)) signals.add("profile_context");
  if (isImportedObservation(text)) signals.add("imported_observation");
  return Array.from(signals).sort();
}

function buildInitiativeClusterKey(
  candidate: NormalizedExtractedAssetCandidate,
  signals: string[],
) {
  const section = normalizeClusterPart(candidate.sourceSection ?? candidate.nearbyHeadings[0] ?? "unknown");
  return [section, signals.includes("technology") || signals.includes("domain") ? "technical-story" : "general"].join(":");
}

function isBulletShaped(text: string) {
  const normalized = text.trim();
  const firstWord = normalized.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, "") ?? "";
  return (
    /^[-*•]/.test(normalized) ||
    ACTION_VERBS.has(firstWord) ||
    /\b(reduced|increased|improved|migrated|built|implemented|optimized|scaled)\b/i.test(normalized)
  );
}

function isPureTechnologyPhrase(text: string) {
  const tokens = tokenize(text);
  if (tokens.length === 0 || tokens.length > 8) return false;
  const techCount = tokens.filter((token) => TECHNOLOGY_TERMS.includes(token) || DOMAIN_TERMS.includes(token)).length;
  return techCount >= Math.max(2, Math.ceil(tokens.length * 0.6)) && !hasOutcomeSignal(text);
}

function isAtomicFact(text: string) {
  const normalized = text.trim();
  const sentenceCount = normalized.split(/[.!?]+/).filter((item) => item.trim()).length;
  const actionCount = tokenize(text).filter((token) => ACTION_VERBS.has(token)).length;
  const broadStoryMarkers = (normalized.match(/\b(across|planning|coordination|enablement|strategy|roadmap)\b/gi) ?? []).length;
  const commaOrConjunctionCount = (normalized.match(/,|\band\b/gi) ?? []).length;
  if (actionCount > 1 || broadStoryMarkers >= 2 || commaOrConjunctionCount >= 3) return false;
  return sentenceCount <= 1 && (hasOutcomeSignal(text) || hasActionSignal(text) || /\d/.test(text));
}

function isSkillsOrProfileContext(text: string, sectionText: string) {
  const normalized = `${sectionText} ${text}`.toLowerCase();
  return (
    /\b(technical skills|skills|technologies|tools|programming languages)\b/.test(normalized) ||
    /\b(prefer|preference|target role|career direction|emphasize|de-emphasize|avoid)\b/.test(normalized)
  );
}

function isImportedObservation(text: string) {
  return /\b(no certifications found|no certification|not found|missing from source|omitted additional|returned at most)\b/i.test(text);
}

function hasEmployerLikeSignal(text: string) {
  return /\b(inc\.?|corp\.?|ltd\.?|llc|amazon|google|microsoft|shopify|meta|company|employer)\b/i.test(text);
}

function hasRoleLikeSignal(text: string) {
  return /\b(engineer|developer|manager|analyst|intern|consultant|lead|title|role)\b/i.test(text);
}

function hasDateSignal(text: string) {
  return /\b(20\d{2}|19\d{2}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|present)\b/i.test(text);
}

function hasTechnologySignal(text: string) {
  const tokens = tokenize(text);
  return tokens.some((token) => TECHNOLOGY_TERMS.includes(token));
}

function hasDomainSignal(text: string) {
  const tokens = tokenize(text);
  return tokens.some((token) => DOMAIN_TERMS.includes(token));
}

function hasActionSignal(text: string) {
  return tokenize(text).some((token) => ACTION_VERBS.has(token));
}

function hasOutcomeSignal(text: string) {
  return /\b(reduced|increased|improved|optimized|latency|reliability|conversion|retention|performance|cost|time|%|percent|x faster)\b/i.test(text);
}

function hasPortfolioSignal(text: string) {
  return /\b(personal|academic|course|open source|open-source|freelance|hackathon|capstone|side project)\b/i.test(text);
}

function tokenize(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9+\s-]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim().replace(/^\W+|\W+$/g, ""))
    .filter(Boolean);
}

function isOutcomeToken(token: string) {
  return ["latency", "performance", "reliability", "cost", "conversion", "retention"].includes(token);
}

function normalizeClusterPart(value: string) {
  return tokenize(value).slice(0, 6).join("-");
}
