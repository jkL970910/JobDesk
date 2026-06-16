export type StarStoryTargetType = "initiative" | "portfolio_project" | "legacy_project";

export type StarStoryTargetInput = {
  id: string;
  type?: StarStoryTargetType;
  title: string;
  context: string | null;
  problem: string | null;
  role: string | null;
  actions: string[];
  results: string[];
  metrics: Array<Record<string, unknown>>;
  technologies: string[];
  stakeholders: string[];
  publicSafeSummary: string | null;
  internalTitle?: string | null;
  sensitivityLevel: string;
  status: string;
  updatedAt?: Date | string | null;
};

export type StarStoryProjectInput = StarStoryTargetInput;

export type StarStoryEvidenceInput = {
  id: string;
  text: string;
  sourceQuote: string;
  metrics: Array<Record<string, unknown>>;
  sensitivityLevel: string;
  allowedUsage: string[];
  publicSafeSummary: string | null;
  status: string;
  relatedProjectId: string | null;
  relatedInitiativeId?: string | null;
  relatedPortfolioProjectId?: string | null;
  relatedWorkExperienceId?: string | null;
};

export type StarStoryReadiness = "ready" | "needs_review" | "thin";

export type StarStoryCard = {
  id: string;
  project_id: string;
  story_target_id: string;
  story_target_type: StarStoryTargetType;
  title: string;
  internal_title: string | null;
  status: string;
  readiness: StarStoryReadiness;
  situation: string | null;
  task: string | null;
  action: string[];
  result: string[];
  metrics: string[];
  technologies: string[];
  stakeholders: string[];
  external_safe_summary: string | null;
  source_evidence_ids: string[];
  evidence_count: number;
  interview_angles: string[];
  gaps: string[];
  updatedAt: string | null;
};

export function buildStarStoryCards(args: {
  projects?: StarStoryProjectInput[];
  storyTargets?: StarStoryTargetInput[];
  evidenceItems?: StarStoryEvidenceInput[];
  limit?: number;
}) {
  const storyTargets = args.storyTargets ?? args.projects ?? [];
  const evidenceByStoryTarget = new Map<string, StarStoryEvidenceInput[]>();
  for (const item of args.evidenceItems ?? []) {
    const storyTargetId = getEvidenceStoryTargetId(item);
    if (!storyTargetId) continue;
    const existing = evidenceByStoryTarget.get(storyTargetId) ?? [];
    existing.push(item);
    evidenceByStoryTarget.set(storyTargetId, existing);
  }

  return storyTargets
    .map((storyTarget) =>
      buildStarStoryCard(storyTarget, evidenceByStoryTarget.get(storyTarget.id) ?? []),
    )
    .sort((left, right) => {
      const readinessDelta =
        readinessRank(right.readiness) - readinessRank(left.readiness);
      if (readinessDelta !== 0) return readinessDelta;
      return (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "");
    })
    .slice(0, args.limit ?? 8);
}

export function buildStarStoryCard(
  project: StarStoryTargetInput,
  evidenceItems: StarStoryEvidenceInput[] = [],
): StarStoryCard {
  const evidenceActions = evidenceItems
    .filter((item) => item.status !== "rejected")
    .map((item) => item.publicSafeSummary ?? item.text)
    .filter(Boolean);
  const action = uniqueStrings([...project.actions, ...evidenceActions]).slice(0, 6);
  const metrics = uniqueStrings([
    ...project.metrics.flatMap(metricToStrings),
    ...evidenceItems.flatMap((item) => item.metrics.flatMap(metricToStrings)),
  ]);
  const result = uniqueStrings([
    ...project.results,
    ...metrics.map((metric) => `Metric: ${metric}`),
  ]).slice(0, 6);
  const situation = firstNonEmpty(project.context, project.publicSafeSummary);
  const task = firstNonEmpty(project.problem, project.role);
  const gaps = buildGaps({ situation, task, action, result, metrics });
  const readiness = toReadiness(gaps);

  return {
    id: `star-${project.id}`,
    project_id: project.id,
    story_target_id: project.id,
    story_target_type: project.type ?? "legacy_project",
    title: project.title,
    internal_title: project.internalTitle ?? null,
    status: project.status,
    readiness,
    situation,
    task,
    action,
    result,
    metrics,
    technologies: uniqueStrings(project.technologies).slice(0, 10),
    stakeholders: uniqueStrings(project.stakeholders).slice(0, 10),
    external_safe_summary:
      project.sensitivityLevel === "public_safe" ? project.publicSafeSummary : null,
    source_evidence_ids: evidenceItems
      .filter((item) => item.status !== "rejected")
      .map((item) => item.id),
    evidence_count: evidenceItems.filter((item) => item.status !== "rejected").length,
    interview_angles: buildInterviewAngles(project, action, result, metrics),
    gaps,
    updatedAt: toIso(project.updatedAt),
  };
}

function buildGaps(args: {
  situation: string | null;
  task: string | null;
  action: string[];
  result: string[];
  metrics: string[];
}) {
  const gaps = [];
  if (!args.situation) gaps.push("Add situation/context.");
  if (!args.task) gaps.push("Add task/problem.");
  if (args.action.length === 0) gaps.push("Add concrete actions.");
  if (args.result.length === 0) gaps.push("Add results or outcome.");
  if (args.metrics.length === 0) gaps.push("Add grounded metrics if available.");
  return gaps;
}

function toReadiness(gaps: string[]): StarStoryReadiness {
  if (gaps.length <= 1) return "ready";
  if (gaps.length <= 3) return "needs_review";
  return "thin";
}

function buildInterviewAngles(
  project: StarStoryTargetInput,
  action: string[],
  result: string[],
  metrics: string[],
) {
  const angles = [];
  const haystack = normalizeText(
    [
      project.title,
      project.context,
      project.problem,
      project.role,
      ...action,
      ...result,
      ...project.technologies,
      ...project.stakeholders,
    ].join(" "),
  );
  if (haystack.includes("stakeholder") || project.stakeholders.length > 0) {
    angles.push("stakeholder alignment");
  }
  if (haystack.includes("sql") || haystack.includes("dashboard") || haystack.includes("analytics")) {
    angles.push("analytical execution");
  }
  if (metrics.length > 0 || haystack.includes("metric") || haystack.includes("experiment")) {
    angles.push("impact measurement");
  }
  if (haystack.includes("launch") || haystack.includes("ship") || haystack.includes("built")) {
    angles.push("delivery ownership");
  }
  return uniqueStrings(angles).slice(0, 4);
}

function getEvidenceStoryTargetId(item: StarStoryEvidenceInput) {
  return (
    item.relatedInitiativeId ??
    item.relatedPortfolioProjectId ??
    item.relatedProjectId ??
    null
  );
}

function metricToStrings(metric: Record<string, unknown>) {
  const value = stringifyMetricValue(metric.value);
  if (value) return [value];
  return Object.values(metric)
    .map(stringifyMetricValue)
    .filter((item): item is string => Boolean(item));
}

function stringifyMetricValue(value: unknown) {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return String(value);
  return null;
}

function firstNonEmpty(...values: Array<string | null | undefined>) {
  return values.map((value) => value?.trim()).find(Boolean) ?? null;
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  const result = [];
  for (const value of values) {
    const trimmed = value.trim();
    const key = normalizeText(trimmed);
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function readinessRank(readiness: StarStoryReadiness) {
  if (readiness === "ready") return 3;
  if (readiness === "needs_review") return 2;
  return 1;
}

function normalizeText(text: string) {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function toIso(value: Date | string | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}
