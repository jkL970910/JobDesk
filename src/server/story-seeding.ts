import type { ProfileEvidenceExtraction } from "../schemas/profile-evidence-extraction";
import type { ScopeReviewCandidate } from "./extraction-scope-guardrail";
import { classifyExtractedAssetCandidate } from "./scope-classifier";
import { buildScopeReviewCandidatePayload } from "./scope-review-candidate";

type InitiativeDraft = ProfileEvidenceExtraction["initiatives"][number];
type ProfileExperience = ProfileEvidenceExtraction["profile"]["experience"][number];

export type StorySeedResult = {
  initiativeDrafts: InitiativeDraft[];
  reviewCandidates: ScopeReviewCandidate[];
};

export function buildStorySeedCandidatesFromProfileExperiences(
  experiences: ProfileEvidenceExtraction["profile"]["experience"],
  existingInitiatives: ProfileEvidenceExtraction["initiatives"],
  args: {
    sourceDocumentId?: string | null;
    sourceTitle?: string | null;
  } = {},
): StorySeedResult {
  const existingRoleRefs = new Set(
    existingInitiatives
      .map((initiative) => normalizeInitiativeSeedKey(initiative.work_experience_ref))
      .filter((value): value is string => Boolean(value)),
  );
  const initiativeDrafts: InitiativeDraft[] = [];
  const reviewCandidates: ScopeReviewCandidate[] = [];

  for (const experience of experiences) {
    const employer = experience.employer.value.trim();
    const roleTitle = experience.title.value.trim();
    const roleRef = [employer, roleTitle].filter(Boolean).join(" · ");
    const roleKey = normalizeInitiativeSeedKey(roleRef);
    if (!roleRef || !roleKey || existingRoleRefs.has(roleKey)) continue;

    const bullets = experience.bullets
      .map((bullet) => bullet.value.trim())
      .filter(isStorySeedBullet)
      .slice(0, 6);
    for (const cluster of clusterStorySeedBullets(bullets)) {
      const primaryBullet = cluster[0];
      if (!primaryBullet) continue;
      if (shouldPersistStorySeedCluster(cluster)) {
        initiativeDrafts.push(buildInitiativeDraftFromCluster(cluster, roleRef));
      } else {
        reviewCandidates.push(buildStorySeedReviewCandidate({
          cluster,
          experience,
          roleRef,
          sourceDocumentId: args.sourceDocumentId,
          sourceTitle: args.sourceTitle,
        }));
      }
    }
  }

  return { initiativeDrafts, reviewCandidates };
}

function buildInitiativeDraftFromCluster(cluster: string[], roleRef: string): InitiativeDraft {
  const primaryBullet = cluster[0]!;
  return {
    work_experience_ref: roleRef,
    internal_title: buildStorySeedTitle(primaryBullet),
    external_safe_title: null,
    context: `Resume bullet under ${roleRef}.`,
    problem: null,
    role: null,
    actions: cluster,
    results: [],
    metrics: [],
    technologies: mergeStringArrays(cluster.flatMap((bullet) => extractTechnologySeedTokens(bullet))),
    stakeholders: [],
    external_safe_summary: null,
    sensitivity_level: "private",
    needs_redaction_review: true,
    status: "pending",
  };
}

function buildStorySeedReviewCandidate(args: {
  cluster: string[];
  experience: ProfileExperience;
  roleRef: string;
  sourceDocumentId?: string | null;
  sourceTitle?: string | null;
}): ScopeReviewCandidate {
  const label = args.cluster.join(" ");
  const classification = classifyExtractedAssetCandidate(
    {
      proposedScope: "work_initiative",
      content: label,
      sourceDocumentId: args.sourceDocumentId,
      sourceQuote: label,
      sourceSection: args.roleRef,
    },
    {
      linkedWorkExperience: {
        employer: args.experience.employer.value,
        roleTitle: args.experience.title.value,
        sourceSection: args.roleRef,
      },
    },
  );
  const payload = buildScopeReviewCandidatePayload({
    classification,
    label,
    proposedScope: "work_initiative",
    sourceDocumentId: args.sourceDocumentId,
    sourceLabel: args.sourceTitle ?? "Profile story seed",
    sourceQuote: label,
    sourceSection: args.roleRef,
  });
  return {
    note: `Story seed needs review before it becomes a Story Target: ${buildStorySeedTitle(label)}.`,
    payload,
  };
}

function shouldPersistStorySeedCluster(cluster: string[]) {
  if (cluster.length >= 2) return true;
  const text = cluster[0] ?? "";
  return hasOutcomeSignal(text) && getStorySeedSignals(text).size >= 2;
}

function clusterStorySeedBullets(bullets: string[]) {
  const clusters: string[][] = [];
  for (const bullet of bullets) {
    const matchingCluster = clusters.find((cluster) =>
      cluster.some((existing) => shouldClusterStorySeedBullets(existing, bullet)),
    );
    if (matchingCluster) {
      matchingCluster.push(bullet);
    } else {
      clusters.push([bullet]);
    }
  }
  return clusters;
}

function shouldClusterStorySeedBullets(left: string, right: string) {
  const leftSignals = getStorySeedSignals(left);
  const rightSignals = getStorySeedSignals(right);
  const sharedSignalCount = Array.from(leftSignals).filter((signal) => rightSignals.has(signal)).length;
  if (sharedSignalCount >= 2) return true;
  return (
    (leftSignals.has("cache") && rightSignals.has("latency")) ||
    (leftSignals.has("latency") && rightSignals.has("cache")) ||
    (leftSignals.has("infrastructure") && rightSignals.has("cache")) ||
    (leftSignals.has("cache") && rightSignals.has("infrastructure"))
  );
}

function getStorySeedSignals(value: string) {
  const normalized = value.toLowerCase();
  const signals = new Set<string>();
  for (const signal of [
    "api",
    "cache",
    "caching",
    "cdk",
    "delivery",
    "infrastructure",
    "latency",
    "migration",
    "performance",
    "redis",
    "reliability",
    "service",
    "session",
  ]) {
    if (normalized.includes(signal)) signals.add(signal === "caching" ? "cache" : signal);
  }
  return signals;
}

function isStorySeedBullet(value: string) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length < 5 || words.length > 42) return false;
  if (/^(technical skills|skills|languages|tools|certifications?)\b/i.test(value)) return false;
  return /\b(led|built|created|designed|implemented|migrated|optimized|provisioned|reduced|improved|launched|owned|partnered|delivered|automated|developed|managed|shipped)\b/i.test(
    value,
  );
}

function buildStorySeedTitle(value: string) {
  return value
    .replace(/^[•*\-\s]+/, "")
    .split(/\s+/)
    .slice(0, 9)
    .join(" ")
    .replace(/[.,;:]+$/, "")
    .slice(0, 240);
}

function extractTechnologySeedTokens(value: string) {
  const knownTokens = [
    "AWS",
    "CDK",
    "Redis",
    "React",
    "Next.js",
    "TypeScript",
    "JavaScript",
    "Python",
    "Postgres",
    "SQL",
    "GraphQL",
    "Docker",
    "Kubernetes",
  ];
  const normalized = value.toLowerCase();
  return knownTokens.filter((token) => normalized.includes(token.toLowerCase()));
}

function hasOutcomeSignal(value: string) {
  return /\b(reduced|increased|improved|optimized|latency|reliability|conversion|retention|performance|cost|time|%|percent|faster)\b/i.test(
    value,
  );
}

function mergeStringArrays(values: string[]) {
  const seen = new Set<string>();
  return values.filter((item) => {
    const normalized = item.toLowerCase();
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function normalizeInitiativeSeedKey(value: string | null | undefined) {
  const normalized = value?.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() ?? "";
  return normalized || null;
}
