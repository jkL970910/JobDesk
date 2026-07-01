export type EvidenceLibraryIaEvidenceClaim = {
  allowed_usage?: string[];
  needs_user_confirmation?: boolean;
  public_safe_summary?: string | null;
  related_initiative_id?: string | null;
  related_portfolio_project_id?: string | null;
  related_project_id?: string | null;
  related_work_experience_id?: string | null;
  sensitivity_level: string;
  status: string;
};

export type EvidenceLibraryIaStoryTarget = {
  actions: string[];
  context: string | null;
  external_safe_summary?: string | null;
  linked_evidence_claim_count?: number;
  metrics?: Array<unknown>;
  problem: string | null;
  public_safe_summary?: string | null;
  results: string[];
  role: string | null;
  status: string;
  work_experience_id?: string | null;
};

export type EvidenceLibraryIaWorkExperience = {
  employer?: string | null;
  role_title?: string | null;
  summary?: string | null;
  status: string;
};

export type EvidenceLibraryIaStarStory = {
  readiness: "ready" | "needs_review" | "thin";
};

export type EvidenceLibraryIaEnrichmentTask = {
  status: "open" | "answered" | "converted" | "dismissed";
};

export type EvidenceLibraryIaCountsInput = {
  cleanupCount: number;
  evidenceClaims: EvidenceLibraryIaEvidenceClaim[];
  importReviewTasks: EvidenceLibraryIaEnrichmentTask[];
  interviewStories: EvidenceLibraryIaStarStory[];
  storyTargets: EvidenceLibraryIaStoryTarget[];
  strengthenEvidenceTasks: EvidenceLibraryIaEnrichmentTask[];
  workExperiences: EvidenceLibraryIaWorkExperience[];
};

export function isOpenWorkQueueTask(task: EvidenceLibraryIaEnrichmentTask) {
  return task.status === "open" || task.status === "answered";
}

export function isCanonicalLibraryAsset<T extends { status?: string }>(asset: T) {
  return asset.status !== "rejected";
}

export function filterCanonicalLibraryAssets<T extends { status?: string }>(assets: T[]) {
  return assets.filter(isCanonicalLibraryAsset);
}

export function shouldReviewWorkExperienceAsset(experience: EvidenceLibraryIaWorkExperience) {
  return (
    isCanonicalLibraryAsset(experience) &&
    (experience.status !== "approved" || hasUnsafeWorkExperienceFields(experience))
  );
}

export function hasUnsafeWorkExperienceFields(experience: EvidenceLibraryIaWorkExperience) {
  return (
    isUnsafeWorkExperienceLabel(experience.employer) ||
    isUnsafeWorkExperienceLabel(experience.role_title) ||
    isUnsafeWorkExperienceSummary(experience.summary)
  );
}

function isUnsafeWorkExperienceLabel(value?: string | null) {
  const normalized = value?.trim() ?? "";
  if (!normalized) return false;
  return (
    normalized.length > 96 ||
    normalized.split(/\s+/).length > 12 ||
    /^[-*•]/.test(normalized) ||
    /[.!?](?:\s|$)/.test(normalized) ||
    /\b(worked|built|launched|delivered|implemented|optimized|scaled|improved|reduced|increased)\b/i.test(normalized)
  );
}

function isUnsafeWorkExperienceSummary(value?: string | null) {
  const normalized = value?.trim() ?? "";
  if (!normalized) return false;
  return (
    normalized.length > 220 ||
    /^[-*•]/.test(normalized) ||
    /\b(increased|reduced|improved|built|launched|delivered|implemented|optimized|scaled)\b/i.test(normalized)
  );
}

export function getStoryTargetReadinessState(target: EvidenceLibraryIaStoryTarget) {
  const actionCount = target.actions.filter(Boolean).length;
  const resultCount = target.results.filter(Boolean).length;
  const hasMetric = (target.metrics ?? []).length > 0;
  const hasCoreStory = Boolean(target.context || target.problem) && Boolean(target.role);
  if (hasCoreStory && actionCount > 0 && resultCount > 0 && hasMetric) {
    return "story_ready" as const;
  }
  if (hasCoreStory || actionCount > 0 || resultCount > 0) {
    return "needs_context" as const;
  }
  return "thin" as const;
}

export function shouldBuildStoryTarget(target: EvidenceLibraryIaStoryTarget) {
  return (
    isCanonicalLibraryAsset(target) &&
    (target.status !== "approved" || getStoryTargetReadinessState(target) !== "story_ready")
  );
}

export function canMarkStoryTargetReady(target: EvidenceLibraryIaStoryTarget) {
  return (
    isCanonicalLibraryAsset(target) &&
    getStoryTargetReadinessState(target) === "story_ready" &&
    hasStoryTargetPublicSafeSummary(target) &&
    hasLinkedEvidenceClaim(target)
  );
}

export function collectQueuedStoryTargetWorkExperienceIds(
  targets: EvidenceLibraryIaStoryTarget[],
) {
  const ids = new Set<string>();
  for (const target of targets) {
    if (shouldBuildStoryTarget(target) && target.work_experience_id) {
      ids.add(target.work_experience_id);
    }
  }
  return ids;
}

export function isResumeReadyEvidenceClaim(item: EvidenceLibraryIaEvidenceClaim) {
  return (
    item.status === "approved" &&
    !item.needs_user_confirmation &&
    (item.allowed_usage ?? []).includes("resume") &&
    hasExternalSafeDisclosure(item)
  );
}

export function shouldApproveEvidenceClaim(item: EvidenceLibraryIaEvidenceClaim) {
  return isCanonicalLibraryAsset(item) && !isResumeReadyEvidenceClaim(item);
}

export function shouldLinkEvidenceClaim(item: EvidenceLibraryIaEvidenceClaim) {
  return (
    isCanonicalLibraryAsset(item) &&
    !item.related_work_experience_id &&
    !item.related_initiative_id &&
    !item.related_portfolio_project_id &&
    !item.related_project_id
  );
}

export function buildEvidenceLibraryIaCounts(input: EvidenceLibraryIaCountsInput) {
  const canonicalEvidenceClaims = input.evidenceClaims.filter(isCanonicalLibraryAsset);
  const canonicalStoryTargets = input.storyTargets.filter(isCanonicalLibraryAsset);
  const canonicalWorkExperiences = input.workExperiences.filter(isCanonicalLibraryAsset);
  const canonicalInterviewStories = input.interviewStories;

  return {
    library: {
      evidenceClaims: canonicalEvidenceClaims.length,
      interviewStories: canonicalInterviewStories.length,
      storyTargets: canonicalStoryTargets.length,
      workExperiences: canonicalWorkExperiences.length,
    },
    workQueue: {
      approveEvidence: canonicalEvidenceClaims.filter(shouldApproveEvidenceClaim).length,
      buildStoryTargets: canonicalStoryTargets.filter(shouldBuildStoryTarget).length,
      cleanup: input.cleanupCount,
      importReview: input.importReviewTasks.filter(isOpenWorkQueueTask).length,
      linkEvidence: canonicalEvidenceClaims.filter(shouldLinkEvidenceClaim).length,
      reviewWorkExperience: canonicalWorkExperiences.filter(shouldReviewWorkExperienceAsset).length,
      strengthenEvidence: input.strengthenEvidenceTasks.filter(isOpenWorkQueueTask).length,
    },
  };
}

function hasExternalSafeDisclosure(item: EvidenceLibraryIaEvidenceClaim) {
  if (item.sensitivity_level === "public_safe") return true;
  return Boolean(item.public_safe_summary?.trim());
}

function hasStoryTargetPublicSafeSummary(target: EvidenceLibraryIaStoryTarget) {
  return Boolean(
    target.external_safe_summary?.trim() ||
      target.public_safe_summary?.trim(),
  );
}

function hasLinkedEvidenceClaim(target: EvidenceLibraryIaStoryTarget) {
  return (target.linked_evidence_claim_count ?? 0) > 0;
}
