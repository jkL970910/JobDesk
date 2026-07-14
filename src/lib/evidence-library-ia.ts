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
  resume_eligibility?: {
    eligible: boolean;
  };
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

export type EvidenceLibraryIaStoryTargetType = "initiative" | "portfolio_project";

export type EvidenceLibraryIaStoryReviewFocus = {
  severity: "required" | "recommended" | "ready";
  label: string;
  nextAction: string;
  reasons: Array<{
    code:
      | "missing_work_experience"
      | "missing_story_context"
      | "missing_linked_evidence"
      | "missing_public_safe_summary"
      | "scope_may_be_portfolio_project";
    label: string;
    nextAction: string;
  }>;
  suggestedCorrection:
    | {
        action:
          | "attach_work_experience"
          | "strengthen_story"
          | "review_evidence"
          | "write_public_safe_summary"
          | "move_to_portfolio_project";
        label: string;
      }
    | null;
};

export type EvidenceLibraryIaWorkExperience = {
  end_date?: string | null;
  employer?: string | null;
  location?: string | null;
  role_title?: string | null;
  start_date?: string | null;
  summary?: string | null;
  team?: string | null;
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

export type EvidenceWorkQueueView =
  | "imported"
  | "roles"
  | "stories"
  | "unlinked"
  | "enrichment"
  | "claims"
  | "cleanup";

export type EvidenceWorkQueueCounts = {
  approveEvidence: number;
  buildStoryTargets: number;
  cleanup: number;
  importReview: number;
  linkEvidence: number;
  reviewWorkExperience: number;
  strengthenEvidence: number;
};

export type EvidenceWorkQueueWorkflowStep = {
  count: number;
  doneWhen: string;
  label: string;
  view: EvidenceWorkQueueView;
  why: string;
};

export function buildWorkQueueWorkflowSteps(
  counts: EvidenceWorkQueueCounts,
): EvidenceWorkQueueWorkflowStep[] {
  return [
    {
      count: counts.importReview,
      doneWhen: "Imported fragments are saved to the right scope, parked for later, or dismissed.",
      label: "Import & Scope Review",
      view: "imported",
      why: "Scope mistakes can send later evidence, links, and approvals down the wrong path.",
    },
    {
      count: counts.reviewWorkExperience,
      doneWhen: "Employer, role, dates, team, location, and summary are accurate enough to anchor stories.",
      label: "Review Work Experience",
      view: "roles",
      why: "Work Experiences are the containers that Story Targets and Evidence Claims attach to.",
    },
    {
      count: counts.buildStoryTargets,
      doneWhen: "Reusable work stories have enough context, proof, and public-safe wording to support resumes or interviews.",
      label: "Build Story Targets",
      view: "stories",
      why: "Story Targets turn scattered resume bullets into larger reusable work stories.",
    },
    {
      count: counts.linkEvidence,
      doneWhen: "Evidence Claims are attached to the correct Work Experience, Story Target, or kept as standalone facts.",
      label: "Link Evidence",
      view: "unlinked",
      why: "Linked evidence gives generated resumes the right source-backed support.",
    },
    {
      count: counts.strengthenEvidence,
      doneWhen: "Open evidence questions have been answered, routed, or intentionally dismissed.",
      label: "Strengthen Evidence",
      view: "enrichment",
      why: "These prompts fill missing metrics, ownership, results, and safe wording before approval.",
    },
    {
      count: counts.approveEvidence,
      doneWhen: "Claims are source-backed, public-safe when needed, and approved only for valid resume use.",
      label: "Approve Evidence",
      view: "claims",
      why: "Approval is the final gate before evidence can support generated resumes.",
    },
    {
      count: counts.cleanup,
      doneWhen: "Duplicate or overlapping stories and claims are merged, kept separate, or resolved.",
      label: "Cleanup",
      view: "cleanup",
      why: "Cleanup prevents duplicate stories and claims from confusing later generation.",
    },
  ];
}

export function getRecommendedWorkQueueStep(
  steps: EvidenceWorkQueueWorkflowStep[],
) {
  return steps.find((step) => step.count > 0) ?? steps[0] ?? null;
}

export function resolveActiveWorkQueueView(
  currentView: EvidenceWorkQueueView,
  steps: EvidenceWorkQueueWorkflowStep[],
) {
  const current = steps.find((step) => step.view === currentView);
  if (!current || current.count > 0) return currentView;
  return getRecommendedWorkQueueStep(steps)?.view ?? currentView;
}

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

export function getWorkExperienceReviewFocus(experience: EvidenceLibraryIaWorkExperience) {
  const required = [];
  const recommended = [];
  const employer = experience.employer?.trim() ?? "";
  const roleTitle = experience.role_title?.trim() ?? "";
  const summary = experience.summary?.trim() ?? "";

  if (!employer || isUnsafeWorkExperienceLabel(employer)) required.push("employer");
  if (!roleTitle || isUnsafeWorkExperienceLabel(roleTitle)) required.push("title");
  if (!((experience.start_date ?? "").trim() || (experience.end_date ?? "").trim())) {
    required.push("date range");
  }
  if (summary && isUnsafeWorkExperienceSummary(summary)) {
    required.push("summary is too bullet-shaped");
  }
  if (!(experience.location ?? "").trim()) recommended.push("location");
  if (!(experience.team ?? "").trim()) recommended.push("team");
  if (!summary) recommended.push("high-level summary");

  if (required.length > 0) {
    return {
      severity: "required" as const,
      label: `Review required: ${formatReviewFocusList(required)}`,
      nextAction: "Edit the missing or unsafe fields, then mark reviewed.",
      required,
      recommended,
    };
  }
  if (recommended.length > 0) {
    return {
      severity: "recommended" as const,
      label: `Optional context: ${formatReviewFocusList(recommended)}`,
      nextAction: "Add context if useful, or mark reviewed now.",
      required,
      recommended,
    };
  }
  return {
    severity: "ready" as const,
    label: "Ready to confirm",
    nextAction: "Mark reviewed to remove it from the Work Queue.",
    required,
    recommended,
  };
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

function formatReviewFocusList(items: string[]) {
  if (items.length <= 2) return items.join(" and ");
  return `${items.slice(0, 2).join(", ")} +${items.length - 2}`;
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

export function getStoryTargetReviewFocus(
  target: EvidenceLibraryIaStoryTarget,
  targetType: EvidenceLibraryIaStoryTargetType = "initiative",
): EvidenceLibraryIaStoryReviewFocus {
  const reasons: EvidenceLibraryIaStoryReviewFocus["reasons"] = [];
  const readiness = getStoryTargetReadinessState(target);
  const hasLinkedEvidence = hasLinkedEvidenceClaim(target);

  if (targetType === "initiative" && !target.work_experience_id) {
    reasons.push({
      code: "missing_work_experience",
      label: "Work Experience assignment missing",
      nextAction: "Attach this story to a Work Experience or move it to Portfolio Projects.",
    });
  }
  if (readiness !== "story_ready") {
    reasons.push({
      code: "missing_story_context",
      label: readiness === "thin" ? "Story is still a thin signal" : "Story needs more context",
      nextAction: "Add problem, ownership, actions, results, and metrics before marking it ready.",
    });
  }
  if (!hasLinkedEvidence) {
    reasons.push({
      code: "missing_linked_evidence",
      label: "No linked Evidence Claim",
      nextAction: "Link or create a source-backed Evidence Claim for this story.",
    });
  }
  if (!hasStoryTargetPublicSafeSummary(target)) {
    reasons.push({
      code: "missing_public_safe_summary",
      label: "Public-safe wording missing",
      nextAction: "Add external-safe wording before this story can be considered ready.",
    });
  }
  if (
    targetType === "initiative" &&
    !target.work_experience_id &&
    hasPersonalProjectSignal(target)
  ) {
    reasons.push({
      code: "scope_may_be_portfolio_project",
      label: "Scope may be Portfolio Project",
      nextAction: "Move this story to Portfolio Projects if it is not employer-owned work.",
    });
  }

  const required = reasons.filter((reason) =>
    reason.code === "missing_work_experience" ||
    reason.code === "missing_linked_evidence" ||
    reason.code === "missing_public_safe_summary",
  );
  const suggestedCorrection = buildStoryTargetCorrectionSuggestion(reasons);
  if (reasons.length === 0) {
    return {
      severity: "ready",
      label: "Ready to confirm",
      nextAction: "Mark reviewed when the wording and linked evidence look correct.",
      reasons,
      suggestedCorrection,
    };
  }
  return {
    severity: required.length > 0 ? "required" : "recommended",
    label: `Needs review: ${formatReviewFocusList(reasons.map((reason) => reason.label))}`,
    nextAction: suggestedCorrection?.label ?? reasons[0]?.nextAction ?? "Review this Story Target.",
    reasons,
    suggestedCorrection,
  };
}

function buildStoryTargetCorrectionSuggestion(
  reasons: EvidenceLibraryIaStoryReviewFocus["reasons"],
): EvidenceLibraryIaStoryReviewFocus["suggestedCorrection"] {
  if (reasons.some((reason) => reason.code === "scope_may_be_portfolio_project")) {
    return { action: "move_to_portfolio_project", label: "Consider moving to Portfolio Projects." };
  }
  if (reasons.some((reason) => reason.code === "missing_work_experience")) {
    return { action: "attach_work_experience", label: "Attach to a Work Experience or keep unassigned for review." };
  }
  if (reasons.some((reason) => reason.code === "missing_linked_evidence")) {
    return { action: "review_evidence", label: "Link source-backed evidence." };
  }
  if (reasons.some((reason) => reason.code === "missing_public_safe_summary")) {
    return { action: "write_public_safe_summary", label: "Add public-safe wording." };
  }
  if (reasons.some((reason) => reason.code === "missing_story_context")) {
    return { action: "strengthen_story", label: "Strengthen the story details." };
  }
  return null;
}

function hasPersonalProjectSignal(target: EvidenceLibraryIaStoryTarget) {
  const normalized = [
    target.context,
    target.problem,
    target.role,
    target.external_safe_summary,
    target.public_safe_summary,
    ...target.actions,
    ...target.results,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return /\b(personal|academic|course|open[-\s]?source|freelance|hackathon|side project|portfolio)\b/.test(
    normalized,
  );
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
  if (item.resume_eligibility) return item.resume_eligibility.eligible;
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

export function getEvidenceClaimWorkQueueDestination(item: EvidenceLibraryIaEvidenceClaim) {
  return shouldLinkEvidenceClaim(item) ? "unlinked" : "claims";
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
