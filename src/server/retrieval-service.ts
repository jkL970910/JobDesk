import { and, desc, eq } from "drizzle-orm";

import { getDb, hasDatabaseUrl } from "../db/client";
import { searchPersonalEmbeddings } from "./embedding-service";
import { evidenceItems } from "../db/schema";
import { getCurrentWorkspace } from "./workspace-repository";
import {
  AllowedUsage,
  type EvidenceType,
  type SensitivityLevel,
} from "../schemas/shared";

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
  status: string;
  needs_user_confirmation: boolean;
  updatedAt?: string;
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
  reason_for_selection: string[];
};

export type EvidenceRetrievalPolicy = {
  allowedUsage: AllowedUsage;
  externalFacing: boolean;
  excludeInferred: boolean;
  limit: number;
};

const resumePolicy: EvidenceRetrievalPolicy = {
  allowedUsage: "resume",
  externalFacing: true,
  excludeInferred: true,
  limit: 12,
};

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
    policy: { ...resumePolicy, limit: options.limit ?? resumePolicy.limit },
  });
}

export function rankEvidenceForPolicy(args: {
  candidates: EvidenceRetrievalCandidate[];
  job?: ResumeRetrievalJobContext | null;
  policy: EvidenceRetrievalPolicy;
}) {
  const queryTerms = buildQueryTerms(args.job);
  return args.candidates
    .filter((candidate) => isEvidenceEligible(candidate, args.policy))
    .map((candidate) => scoreEvidence(candidate, queryTerms))
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
  if (candidate.status !== "approved") return false;
  if (candidate.needs_user_confirmation) return false;
  if (!candidate.allowed_usage.includes(policy.allowedUsage)) return false;
  if (policy.externalFacing && candidate.allowed_usage.includes("internal_only")) {
    return false;
  }
  if (policy.externalFacing && candidate.sensitivity_level === "sensitive") {
    return false;
  }
  if (policy.excludeInferred && candidate.evidence_type === "inferred") {
    return false;
  }
  return true;
}

function scoreEvidence(
  candidate: EvidenceRetrievalCandidate,
  queryTerms: string[],
): EvidenceRetrievalCandidate & {
  retrieval_score: number;
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
  const matchedTerms = queryTerms.filter((term) => haystack.includes(term));
  const uniqueMatchedTerms = Array.from(new Set(matchedTerms));
  const metricBonus = candidate.metrics.length > 0 ? 2 : 0;
  const semanticBonus = Math.max(0, candidate.semantic_similarity ?? 0) * 12;
  const score = uniqueMatchedTerms.length * 10 + semanticBonus + metricBonus + 1;
  const reason =
    uniqueMatchedTerms.length > 0
      ? [`matches job terms: ${uniqueMatchedTerms.slice(0, 5).join(", ")}`]
      : ["eligible resume evidence"];
  if ((candidate.semantic_similarity ?? 0) > 0.15) {
    reason.push(`semantic match ${Math.round((candidate.semantic_similarity ?? 0) * 100)}%`);
  }
  if (metricBonus) reason.push("contains grounded metric");

  return {
    ...candidate,
    retrieval_score: score,
    reason_for_selection: reason,
  };
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

function splitTerms(value: string) {
  return value
    .split(/[^A-Za-z0-9+#.]+/)
    .map((term) => term.trim())
    .filter(Boolean);
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
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
    status: item.status,
    needs_user_confirmation: item.needsUserConfirmation === 1,
    updatedAt: item.updatedAt.toISOString(),
  };
}
