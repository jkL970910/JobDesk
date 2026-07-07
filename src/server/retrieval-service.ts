import { and, desc, eq } from "drizzle-orm";

import { getDb, hasDatabaseUrl } from "../db/client";
import { searchPersonalEmbeddings } from "./embedding-service";
import type { EmbeddingSearchResult } from "./embedding-service";
import { evidenceItems } from "../db/schema";
import { hasResumeSafeDisclosure } from "./deidentification-service";
import { evaluateResumeEvidenceEligibility } from "./resume-evidence-eligibility";
import { getCurrentWorkspace } from "./workspace-repository";
import {
  AllowedUsage,
  type EvidenceType,
  type SensitivityLevel,
} from "../schemas/shared";
import {
  getRetrievalPolicy,
  type EvidenceRetrievalPolicy,
  type RetrievalPolicyId,
} from "./retrieval-policy";
import {
  searchSourceChunksForGaps,
  selectMatchedSourceChunkPhrase,
  sourceChunkIndexType,
  type SourceChunkGapResult,
} from "./source-chunk-service";

export type EvidenceRetrievalCandidate = {
  id: string;
  semantic_similarity?: number;
  text: string;
  source_quote: string;
  evidence_type: EvidenceType;
  metrics: Array<Record<string, unknown>>;
  sensitivity_level: SensitivityLevel;
  allowed_usage: AllowedUsage[];
  public_safe_summary: string | null;
  quarantined_at?: string | null;
  status: string;
  needs_user_confirmation: boolean;
  updatedAt?: string;
  related_project_id?: string | null;
  related_work_experience_id?: string | null;
  related_initiative_id?: string | null;
  related_portfolio_project_id?: string | null;
};

export type ResumeRetrievalJobContext = {
  keywords?: string[];
  role_signals?: string[];
  requirements?: Array<{
    text: string;
    keywords?: string[];
    requirement_type?: "hard" | "soft";
    importance?: number;
  }>;
  job_facts?: {
    role_title?: string | null;
    responsibilities?: string[];
    preferred_qualifications?: string[];
  };
};

export type RetrievedEvidenceItem = Omit<
  EvidenceRetrievalCandidate,
  "status" | "needs_user_confirmation"
> & {
  retrieval_score: number;
  retrieval_policy: RetrievalPolicyId;
  eligibility_reason: string;
  blocked_reason: string | null;
  matched_requirement: string | null;
  matched_question: string | null;
  keyword_matches: string[];
  semantic_score: number;
  metric_bonus: number;
  recency_bonus: number;
  primary_linkage: {
    kind: "work_experience" | "initiative" | "portfolio_project" | "legacy_project" | "unlinked";
    id: string | null;
    label: string;
  };
  score_breakdown: {
    keyword_score: number;
    semantic_score: number;
    metric_bonus: number;
    recency_bonus: number;
    base: number;
    total: number;
  };
  reason_for_selection: string[];
};

export type RetrievedSourceMaterialItem = {
  source_document_id: string;
  source_type: string;
  title: string;
  chunk_index: number;
  chunk_text: string;
  chunk_excerpt: string;
  matched_phrase: string | null;
  why_this_may_help: string;
  required_next_step: "convert_or_enrich_evidence_before_resume_use";
  retrieval_policy: "evidence_enrichment";
  retrieval_score: number;
  reason_for_selection: string[];
  parse_quality_status: string | null;
  lifecycle_status: string;
  sensitivity_hint: string;
  convert_to_evidence_first: true;
};

export function buildResumeRetrievalContextFromQuery(
  query: string,
): ResumeRetrievalJobContext {
  const normalizedQuery = query.trim();
  const keywords = Array.from(
    new Set(
      splitTerms(normalizedQuery)
        .map(normalizeText)
        .filter((term) => term.length >= 3),
    ),
  );
  return {
    keywords,
    requirements: [
      {
        text: normalizedQuery,
        keywords,
        requirement_type: "hard",
        importance: 1,
      },
    ],
    job_facts: {
      responsibilities: [normalizedQuery],
      preferred_qualifications: [],
    },
  };
}

export async function retrieveResumeEvidenceForJob(
  job: ResumeRetrievalJobContext | null | undefined,
  options: { limit?: number } = {},
) {
  if (!hasDatabaseUrl()) return [];

  const db = getDb();
  const workspace = await getCurrentWorkspace(db);
  const candidates = await db
    .select()
    .from(evidenceItems)
    .where(
      and(
        eq(evidenceItems.workspaceId, workspace.id),
        eq(evidenceItems.status, "approved"),
        eq(evidenceItems.needsUserConfirmation, 0),
      ),
    )
    .orderBy(desc(evidenceItems.updatedAt))
    .limit(100);

  const semanticMatches = job
    ? await searchPersonalEmbeddings({
        query: buildEmbeddingQuery(job),
        indexTypes: ["evidence_index"],
        limit: 30,
      }).catch(() => [])
    : [];
  const semanticScoreByEvidenceId = new Map(
    semanticMatches
      .filter((match) => match.source_entity_type === "evidence")
      .map((match) => [match.source_entity_id, match.similarity]),
  );

  return rankEvidenceForPolicy({
    candidates: candidates.map((item) => ({
      ...toRetrievalCandidate(item),
      semantic_similarity: semanticScoreByEvidenceId.get(item.id) ?? 0,
    })),
    job,
    policy: getRetrievalPolicy("resume_generation", { limit: options.limit }),
  });
}

export async function retrieveSourceMaterialForEvidenceGaps(
  query: string,
  options: { limit?: number } = {},
): Promise<RetrievedSourceMaterialItem[]> {
  const policy = getRetrievalPolicy("evidence_enrichment", { limit: options.limit });
  if (!policy.allowedIndexTypes.includes(sourceChunkIndexType)) return [];
  return searchSourceChunksForGaps(query, { limit: policy.limit }).catch(() => []);
}

export function toRetrievedSourceMaterialItem(
  match: EmbeddingSearchResult,
  query = "",
): RetrievedSourceMaterialItem {
  const metadata = match.metadata;
  const chunkText = match.chunk_text;
  return {
    source_document_id: String(metadata.source_document_id ?? ""),
    source_type: String(metadata.source_type ?? "generic_source"),
    title: String(metadata.title ?? "Source material"),
    chunk_index: Number(metadata.chunk_index ?? 0),
    chunk_text: chunkText,
    chunk_excerpt: buildChunkExcerpt(chunkText),
    matched_phrase: selectMatchedSourceChunkPhrase(chunkText, query),
    why_this_may_help:
      "This source chunk may contain concrete facts, scope, or metrics that can be converted into evidence or used to enrich an existing evidence card.",
    required_next_step: "convert_or_enrich_evidence_before_resume_use",
    retrieval_policy: "evidence_enrichment",
    retrieval_score: Number((Math.max(0, match.similarity) * 100).toFixed(3)),
    reason_for_selection: [
      "possible source material for evidence gap",
      "convert to evidence before resume use",
      `semantic match ${Math.round(Math.max(0, match.similarity) * 100)}%`,
    ],
    parse_quality_status:
      typeof metadata.parse_quality_status === "string"
        ? metadata.parse_quality_status
        : null,
    lifecycle_status: String(metadata.lifecycle_status ?? "unknown"),
    sensitivity_hint: String(metadata.sensitivity_hint ?? "unknown"),
    convert_to_evidence_first: true,
  };
}

export function fromSourceChunkGapResult(match: SourceChunkGapResult): RetrievedSourceMaterialItem {
  return match;
}

export function rankEvidenceForPolicy(args: {
  candidates: EvidenceRetrievalCandidate[];
  job?: ResumeRetrievalJobContext | null;
  policy: EvidenceRetrievalPolicy;
}) {
  const queryContext = buildQueryContext(args.job);
  return args.candidates
    .filter((candidate) => isEvidenceEligible(candidate, args.policy))
    .map((candidate) => scoreEvidence(candidate, queryContext, args.policy))
    .sort((left, right) => {
      if (right.retrieval_score !== left.retrieval_score) {
        return right.retrieval_score - left.retrieval_score;
      }
      return (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "");
    })
    .slice(0, args.policy.limit)
    .map(({ status: _status, needs_user_confirmation: _needs, ...item }) => item);
}

export function isEvidenceEligible(
  candidate: EvidenceRetrievalCandidate,
  policy: EvidenceRetrievalPolicy,
) {
  if (policy.id === "resume_generation") {
    return evaluateResumeEvidenceEligibility({
      allowedUsage: candidate.allowed_usage,
      evidenceType: candidate.evidence_type,
      needsUserConfirmation: candidate.needs_user_confirmation,
      publicSafeSummary: candidate.public_safe_summary,
      quarantinedAt: candidate.quarantined_at ?? null,
      sensitivityLevel: candidate.sensitivity_level,
      sourceQuote: candidate.source_quote,
      status: candidate.status,
      text: candidate.text,
    }).eligible;
  }
  if (policy.statusPolicy === "approved_only" && candidate.status !== "approved") {
    return false;
  }
  if (
    policy.statusPolicy === "approved_or_pending" &&
    !["approved", "pending"].includes(candidate.status)
  ) {
    return false;
  }
  if (policy.requireNoUserConfirmation && candidate.needs_user_confirmation) {
    return false;
  }
  if (policy.allowedUsage && !candidate.allowed_usage.includes(policy.allowedUsage)) {
    return false;
  }
  if (policy.externalFacing && candidate.allowed_usage.includes("internal_only")) {
    return false;
  }
  if (
    policy.externalFacing &&
    !hasResumeSafeDisclosure({
      text: candidate.text,
      sensitivityLevel: candidate.sensitivity_level,
      publicSafeSummary: candidate.public_safe_summary,
    })
  ) {
    return false;
  }
  if (policy.excludeInferred && candidate.evidence_type === "inferred") {
    return false;
  }
  return true;
}

function scoreEvidence(
  candidate: EvidenceRetrievalCandidate,
  queryContext: ReturnType<typeof buildQueryContext>,
  policy: EvidenceRetrievalPolicy,
): EvidenceRetrievalCandidate & {
  retrieval_score: number;
  retrieval_policy: RetrievalPolicyId;
  eligibility_reason: string;
  blocked_reason: string | null;
  matched_requirement: string | null;
  matched_question: string | null;
  keyword_matches: string[];
  semantic_score: number;
  metric_bonus: number;
  recency_bonus: number;
  primary_linkage: RetrievedEvidenceItem["primary_linkage"];
  score_breakdown: RetrievedEvidenceItem["score_breakdown"];
  reason_for_selection: string[];
} {
  const haystack = normalizeText(
    [
      candidate.text,
      candidate.source_quote,
      candidate.public_safe_summary ?? "",
      candidate.metrics.map((metric) => Object.values(metric).join(" ")).join(" "),
    ].join(" "),
  );
  const matchedTerms = queryContext.queryTerms.filter((term) => haystack.includes(term));
  const uniqueMatchedTerms = Array.from(new Set(matchedTerms));
  const metricBonus = candidate.metrics.length > 0 ? 2 : 0;
  const semanticBonus = Number((Math.max(0, candidate.semantic_similarity ?? 0) * 12).toFixed(3));
  const recencyBonus = computeRecencyBonus(candidate.updatedAt);
  const keywordScore = uniqueMatchedTerms.length * 10;
  const baseScore = 1;
  const score = Number(
    (keywordScore + semanticBonus + metricBonus + recencyBonus + baseScore).toFixed(3),
  );
  const requirementMatch = findBestRequirementMatch(haystack, queryContext.requirements);
  const matchedQuestion = buildMatchedQuestion(queryContext.questions, uniqueMatchedTerms, requirementMatch?.text ?? null);
  const linkage = buildPrimaryLinkage(candidate);
  const reason = [
    requirementMatch?.text
      ? `matches requirement: ${requirementMatch.text}`
      : matchedQuestion
        ? `helps answer: ${matchedQuestion}`
        : "eligible resume evidence",
    uniqueMatchedTerms.length > 0
      ? `keyword matches: ${uniqueMatchedTerms.slice(0, 5).join(", ")}`
      : "semantic similarity carried more weight than direct keyword overlap",
    linkage.kind === "unlinked" ? "not yet linked to a primary role or story" : `linked to ${linkage.label}`,
  ];
  if ((candidate.semantic_similarity ?? 0) > 0.15) {
    reason.push(`semantic match ${Math.round((candidate.semantic_similarity ?? 0) * 100)}%`);
  }
  if (metricBonus) reason.push("contains grounded metric");

  return {
    ...candidate,
    retrieval_score: score,
    retrieval_policy: policy.id,
    eligibility_reason: buildEligibilityReason(policy),
    blocked_reason: null,
    matched_requirement: requirementMatch?.text ?? null,
    matched_question: matchedQuestion,
    keyword_matches: uniqueMatchedTerms,
    semantic_score: semanticBonus,
    metric_bonus: metricBonus,
    recency_bonus: recencyBonus,
    primary_linkage: linkage,
    score_breakdown: {
      keyword_score: Number(keywordScore.toFixed(3)),
      semantic_score: Number(semanticBonus.toFixed(3)),
      metric_bonus: metricBonus,
      recency_bonus: Number(recencyBonus.toFixed(3)),
      base: baseScore,
      total: Number(score.toFixed(3)),
    },
    reason_for_selection: reason,
  };
}

function buildEligibilityReason(policy: EvidenceRetrievalPolicy) {
  const rules = [
    policy.statusPolicy === "approved_only" ? "approved evidence" : "approved or pending evidence",
    policy.allowedUsage ? `${policy.allowedUsage} usage` : "any usage",
    policy.externalFacing ? "public-safe external disclosure" : "internal analysis allowed",
    policy.requireNoUserConfirmation ? "user-confirmed" : "may need user review",
  ];
  if (policy.excludeInferred) rules.push("non-inferred");
  return rules.join("; ");
}

function buildEmbeddingQuery(job: ResumeRetrievalJobContext) {
  return [
    ...(job.keywords ?? []),
    ...(job.role_signals ?? []),
    ...(job.job_facts?.responsibilities ?? []),
    ...(job.job_facts?.preferred_qualifications ?? []),
    job.job_facts?.role_title ?? "",
    ...(job.requirements ?? []).flatMap((requirement) => [
      requirement.text,
      ...(requirement.keywords ?? []),
    ]),
  ]
    .filter(Boolean)
    .join(" ");
}

function buildQueryTerms(job: ResumeRetrievalJobContext | null | undefined) {
  if (!job) return [];
  const terms = [
    ...(job.keywords ?? []),
    ...(job.role_signals ?? []),
    ...(job.job_facts?.responsibilities ?? []),
    ...(job.job_facts?.preferred_qualifications ?? []),
    job.job_facts?.role_title ?? "",
    ...(job.requirements ?? []).flatMap((requirement) => [
      requirement.text,
      ...(requirement.keywords ?? []),
    ]),
  ];

  return Array.from(
    new Set(
      terms
        .flatMap(splitTerms)
        .map(normalizeText)
        .filter((term) => term.length >= 3),
    ),
  );
}

function buildQueryContext(job: ResumeRetrievalJobContext | null | undefined) {
  return {
    queryTerms: buildQueryTerms(job),
    requirements:
      job?.requirements?.map((requirement) => ({
        text: requirement.text,
        importance: requirement.importance ?? 0,
        normalizedText: normalizeText(requirement.text),
        normalizedKeywords: (requirement.keywords ?? []).map((keyword) => normalizeText(keyword)),
      })) ?? [],
    questions: [
      ...(job?.job_facts?.responsibilities ?? []),
      ...(job?.job_facts?.preferred_qualifications ?? []),
    ]
      .map((value) => value.trim())
      .filter(Boolean),
  };
}

function computeRecencyBonus(updatedAt?: string) {
  if (!updatedAt) return 0;
  const updatedAtMs = new Date(updatedAt).getTime();
  if (!Number.isFinite(updatedAtMs)) return 0;
  const ageDays = (Date.now() - updatedAtMs) / (1000 * 60 * 60 * 24);
  if (ageDays <= 30) return 1.5;
  if (ageDays <= 90) return 1;
  if (ageDays <= 180) return 0.5;
  return 0;
}

function findBestRequirementMatch(
  haystack: string,
  requirements: Array<{
    text: string;
    importance: number;
    normalizedText: string;
    normalizedKeywords: string[];
  }>,
) {
  let best:
    | {
        text: string;
        score: number;
      }
    | null = null;
  for (const requirement of requirements) {
    const directHit = haystack.includes(requirement.normalizedText) ? 1 : 0;
    const keywordHits = requirement.normalizedKeywords.filter((term) => haystack.includes(term)).length;
    const score = directHit + keywordHits + requirement.importance;
    if (!best || score > best.score) {
      best = { text: requirement.text, score };
    }
  }
  return best && best.score > 0 ? best : null;
}

function buildMatchedQuestion(
  questions: string[],
  keywordMatches: string[],
  matchedRequirement: string | null,
) {
  if (matchedRequirement) {
    return `What evidence shows ${matchedRequirement.toLowerCase()}?`;
  }
  const question = questions.find((candidate) =>
    keywordMatches.some((term) => normalizeText(candidate).includes(term)),
  );
  if (question) return question;
  if (keywordMatches[0]) return `What evidence supports ${keywordMatches[0]}?`;
  return null;
}

function buildPrimaryLinkage(candidate: EvidenceRetrievalCandidate): RetrievedEvidenceItem["primary_linkage"] {
  if (candidate.related_work_experience_id) {
    return {
      kind: "work_experience",
      id: candidate.related_work_experience_id,
      label: "linked work experience",
    };
  }
  if (candidate.related_initiative_id) {
    return {
      kind: "initiative",
      id: candidate.related_initiative_id,
      label: "linked initiative",
    };
  }
  if (candidate.related_portfolio_project_id) {
    return {
      kind: "portfolio_project",
      id: candidate.related_portfolio_project_id,
      label: "linked portfolio project",
    };
  }
  if (candidate.related_project_id) {
    return {
      kind: "legacy_project",
      id: candidate.related_project_id,
      label: "linked legacy project",
    };
  }
  return {
    kind: "unlinked",
    id: null,
    label: "unlinked evidence",
  };
}

function splitTerms(value: string) {
  return value
    .split(/[^A-Za-z0-9+#.]+/)
    .map((term) => term.trim())
    .filter(Boolean);
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function buildChunkExcerpt(chunkText: string) {
  return chunkText.length <= 260 ? chunkText : `${chunkText.slice(0, 257).trimEnd()}...`;
}

function toRetrievalCandidate(
  item: typeof evidenceItems.$inferSelect,
): EvidenceRetrievalCandidate {
  return {
    id: item.id,
    text: item.text,
    source_quote: item.sourceQuote,
    evidence_type: item.evidenceType,
    metrics: item.metrics,
    sensitivity_level: item.sensitivityLevel,
    allowed_usage: item.allowedUsage.filter((value): value is AllowedUsage =>
      AllowedUsage.options.includes(value as AllowedUsage),
    ),
    public_safe_summary: item.publicSafeSummary,
    quarantined_at: item.quarantinedAt?.toISOString() ?? null,
    status: item.status,
    needs_user_confirmation: item.needsUserConfirmation === 1,
    updatedAt: item.updatedAt.toISOString(),
    related_project_id: item.relatedProjectId,
    related_work_experience_id: item.relatedWorkExperienceId,
    related_initiative_id: item.relatedInitiativeId,
    related_portfolio_project_id: item.relatedPortfolioProjectId,
  };
}
