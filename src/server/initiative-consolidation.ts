import type { ProfileEvidenceExtraction } from "../schemas/profile-evidence-extraction";
import type { SensitivityLevel } from "../schemas/shared";

type InitiativeDraft = ProfileEvidenceExtraction["initiatives"][number];

export type InitiativeConsolidationResult = {
  initiatives: InitiativeDraft[];
  draftRefRedirects: Map<string, string>;
  extractionNotes: string[];
};

const INITIATIVE_DOMAIN_TOKENS = new Set([
  "activation",
  "analytics",
  "cache",
  "caching",
  "cdk",
  "cloud",
  "dashboard",
  "dashboards",
  "delivery",
  "distributed",
  "experiment",
  "funnel",
  "infrastructure",
  "instrumentation",
  "latency",
  "looker",
  "migration",
  "onboarding",
  "pipeline",
  "provisioning",
  "redis",
  "reliability",
  "reporting",
  "retention",
  "service",
  "session",
  "sql",
]);

export function consolidateInitiativeDrafts(
  drafts: InitiativeDraft[],
): InitiativeConsolidationResult {
  const draftRefRedirects = new Map<string, string>();
  const extractionNotes: string[] = [];
  if (drafts.length < 2) return { initiatives: drafts, draftRefRedirects, extractionNotes };

  const pending = [...drafts];
  const initiatives: InitiativeDraft[] = [];
  while (pending.length > 0) {
    const seed = pending.shift()!;
    const cluster = [seed];
    let changed = true;
    while (changed) {
      changed = false;
      for (let index = pending.length - 1; index >= 0; index -= 1) {
        const candidate = pending[index]!;
        const confidence = cluster.some(
          (member) => scoreInitiativeMergeConfidence(member, candidate) === "high",
        );
        if (confidence) {
          cluster.push(candidate);
          pending.splice(index, 1);
          changed = true;
        }
      }
    }
    if (cluster.length === 1) {
      initiatives.push(seed);
      continue;
    }

    const merged = mergeInitiativeDraftCluster(cluster);
    initiatives.push(merged);
    for (const draft of cluster) {
      for (const ref of initiativeDraftRefs(draft)) {
        draftRefRedirects.set(ref, merged.internal_title);
      }
    }
    extractionNotes.push(
      `These story fragments were merged; please review: ${cluster
        .map((draft) => draft.internal_title)
        .join(" / ")}.`,
    );
  }
  return { initiatives, draftRefRedirects, extractionNotes };
}

function scoreInitiativeMergeConfidence(
  first: InitiativeDraft,
  second: InitiativeDraft,
): "none" | "medium" | "high" {
  if (!compatibleWorkExperienceRef(first.work_experience_ref, second.work_experience_ref)) {
    return "none";
  }
  const firstTokens = initiativeSignalTokens(first);
  const secondTokens = initiativeSignalTokens(second);
  const sharedTokens = countSetOverlap(firstTokens.all, secondTokens.all);
  const sharedDomainTokens = countSetOverlap(firstTokens.domain, secondTokens.domain);
  const sharedTechnologies = countSetOverlap(firstTokens.technologies, secondTokens.technologies);
  const titleOverlap = countSetOverlap(firstTokens.title, secondTokens.title);
  const infrastructurePerformancePair =
    (hasInfrastructureSignal(firstTokens) && hasPerformanceCacheSignal(secondTokens)) ||
    (hasInfrastructureSignal(secondTokens) && hasPerformanceCacheSignal(firstTokens));
  const distinctNamedStories =
    titleOverlap === 0 &&
    firstTokens.title.size >= 2 &&
    secondTokens.title.size >= 2 &&
    !infrastructurePerformancePair;

  if (distinctNamedStories) return "none";

  if (
    sharedDomainTokens >= 2 &&
    sharedTokens >= 4 &&
    (sharedTechnologies >= 1 || titleOverlap >= 1)
  ) {
    return "high";
  }
  if (infrastructurePerformancePair && sharedDomainTokens >= 1) return "high";
  if (sharedDomainTokens >= 2 && sharedTokens >= 3) return "medium";
  return "none";
}

function mergeInitiativeDraftCluster(cluster: InitiativeDraft[]): InitiativeDraft {
  const title = pickMostCompleteTitle(cluster);
  const sensitivityLevel = maxSensitivity(cluster.map((draft) => draft.sensitivity_level));
  return {
    ...cluster[0]!,
    internal_title: title,
    external_safe_title: preferFirstText(cluster.map((draft) => draft.external_safe_title)),
    context: mergeTextFields(cluster.map((draft) => draft.context)),
    problem: mergeTextFields(cluster.map((draft) => draft.problem)),
    role: mergeTextFields(cluster.map((draft) => draft.role)),
    actions: mergeStringValues([], cluster.flatMap((draft) => draft.actions)),
    results: mergeStringValues([], cluster.flatMap((draft) => draft.results)),
    metrics: mergeInitiativeMetrics(cluster.flatMap((draft) => draft.metrics)),
    technologies: mergeStringValues([], cluster.flatMap((draft) => draft.technologies)),
    stakeholders: mergeStringValues([], cluster.flatMap((draft) => draft.stakeholders ?? [])),
    external_safe_summary: preferFirstText(cluster.map((draft) => draft.external_safe_summary)),
    sensitivity_level: sensitivityLevel,
    needs_redaction_review: cluster.some((draft) => draft.needs_redaction_review),
    status: "pending",
    work_experience_ref: cluster[0]!.work_experience_ref,
  };
}

function initiativeDraftRefs(draft: InitiativeDraft) {
  return [draft.internal_title, draft.external_safe_title].filter(
    (value): value is string => hasText(value),
  );
}

function initiativeSignalTokens(draft: InitiativeDraft) {
  const title = new Set(tokenizeInitiativeText(draft.internal_title));
  const technologies = new Set(draft.technologies.flatMap(tokenizeInitiativeText));
  const outcome = new Set(draft.results.flatMap(tokenizeInitiativeText));
  const action = new Set(draft.actions.flatMap(tokenizeInitiativeText));
  const all = new Set(
    [
      draft.internal_title,
      draft.external_safe_title,
      draft.context,
      draft.problem,
      draft.role,
      draft.external_safe_summary,
      ...draft.actions,
      ...draft.results,
      ...draft.technologies,
      ...(draft.stakeholders ?? []),
    ].flatMap((value) => tokenizeInitiativeText(value ?? "")),
  );
  const domain = new Set([...all].filter((token) => INITIATIVE_DOMAIN_TOKENS.has(token)));
  return { action, all, domain, outcome, technologies, title };
}

function hasInfrastructureSignal(tokens: ReturnType<typeof initiativeSignalTokens>) {
  return ["aws", "cdk", "cloud", "infrastructure", "provision", "provisioning"].some((token) =>
    tokens.all.has(token),
  );
}

function hasPerformanceCacheSignal(tokens: ReturnType<typeof initiativeSignalTokens>) {
  return ["cache", "caching", "distributed", "latency", "redis", "session"].some((token) =>
    tokens.all.has(token),
  );
}

function tokenizeInitiativeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3)
    .map(normalizeInitiativeToken);
}

function normalizeInitiativeToken(token: string) {
  if (["cached", "caches", "caching"].includes(token)) return "cache";
  if (["optimized", "optimization", "optimizing"].includes(token)) return "optimize";
  if (["provisioned", "provisioning"].includes(token)) return "provision";
  return token;
}

function countSetOverlap(first: Set<string>, second: Set<string>) {
  let count = 0;
  for (const item of first) {
    if (second.has(item)) count += 1;
  }
  return count;
}

function hasAny(values: Set<string>) {
  return values.size > 0;
}

function compatibleWorkExperienceRef(first: string | null | undefined, second: string | null | undefined) {
  if (!hasText(first) || !hasText(second)) return true;
  const normalizedFirst = normalizeMatchText(first!);
  const normalizedSecond = normalizeMatchText(second!);
  if (normalizedFirst === normalizedSecond) return true;
  const firstTokens = new Set(tokenizeInitiativeText(normalizedFirst));
  const secondTokens = new Set(tokenizeInitiativeText(normalizedSecond));
  const sharedTokens = countSetOverlap(firstTokens, secondTokens);
  return sharedTokens >= 2 && !hasConflictingRoleQualifier(firstTokens, secondTokens);
}

function hasConflictingRoleQualifier(first: Set<string>, second: Set<string>) {
  const qualifiers = ["intern", "internship", "full", "time", "contract", "manager", "lead"];
  return qualifiers.some((token) => first.has(token) !== second.has(token));
}

function pickMostCompleteTitle(cluster: InitiativeDraft[]) {
  return [...cluster].sort((left, right) => {
    const leftScore =
      tokenizeInitiativeText(left.internal_title).length +
      left.actions.length * 2 +
      left.results.length * 2 +
      left.technologies.length;
    const rightScore =
      tokenizeInitiativeText(right.internal_title).length +
      right.actions.length * 2 +
      right.results.length * 2 +
      right.technologies.length;
    return rightScore - leftScore;
  })[0]!.internal_title;
}

function preferFirstText(values: Array<string | null | undefined>) {
  return values.find((value): value is string => hasText(value))?.trim() ?? null;
}

function mergeTextFields(values: Array<string | null | undefined>) {
  const unique = mergeStringValues([], values.filter((value): value is string => hasText(value)));
  if (unique.length === 0) return null;
  return unique.join(" ");
}

function mergeInitiativeMetrics(metrics: InitiativeDraft["metrics"]) {
  const values = new Map<string, InitiativeDraft["metrics"][number]>();
  for (const metric of metrics) {
    values.set(JSON.stringify(metric), metric);
  }
  return Array.from(values.values());
}

function maxSensitivity(values: SensitivityLevel[]) {
  if (values.includes("sensitive")) return "sensitive";
  if (values.includes("private")) return "private";
  return "public_safe";
}

function mergeStringValues(existing: string[] | null | undefined, incoming: string[] | null | undefined) {
  const values = new Map<string, string>();
  for (const value of [...(existing ?? []), ...(incoming ?? [])]) {
    if (!hasText(value)) continue;
    const trimmed = value.trim();
    values.set(normalizeMatchText(trimmed), trimmed);
  }
  return Array.from(values.values());
}

function hasText(value: string | null | undefined) {
  return Boolean(value && value.trim().length > 0);
}

function normalizeMatchText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}
