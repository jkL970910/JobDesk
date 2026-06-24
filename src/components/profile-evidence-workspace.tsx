"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";

import { useAccess } from "./access-provider";
import {
  AnimatedQueueList,
  GradualBlur,
  MotionPanel,
} from "./ui/motion-primitives";
import {
  RetrievalExplanationPanel,
  type RetrievalEvidenceExplanation,
  type RetrievalSourceMaterialExplanation,
} from "./retrieval-explanation-panel";
import { SuggestedUpdatePanel } from "./ui/suggested-update-panel";

import {
  buildGuidedMaterialMarkdown,
  emptyGuidedMaterialFields,
  getGuidedMaterialReadiness,
  hasGuidedMaterialContent,
  type GuidedMaterialFields,
} from "../lib/guided-material";
import { buildProfileFactPatchFromText } from "../schemas/profile-facts";
import type { ProfileEvidenceExtraction } from "../schemas/profile-evidence-extraction";

type ExtractionResponse =
  | {
      data: ProfileEvidenceExtraction;
      meta: {
        retryCount: number;
        persistence?: {
          status: "saved" | "skipped";
          reason?: string;
          evidenceCount?: number;
          projectCount?: number;
          initiativeCount?: number;
          portfolioProjectCount?: number;
          workExperienceCount?: number;
          sourceDocumentRecovered?: boolean;
        };
      };
    }
  | { error: string; kind?: string };

type DedupeCandidate = {
  primary: {
    id: string;
    text: string;
    status: string;
    allowed_usage: string[];
    sensitivity_level: string;
  };
  duplicate: {
    id: string;
    text: string;
    status: string;
    allowed_usage: string[];
    sensitivity_level: string;
  };
  score: number;
  reasons: string[];
};

type StoryDedupeCandidate = {
  primary: StoryDedupeItem;
  duplicate: StoryDedupeItem;
  duplicateCount: number;
  duplicateStoryIds: string[];
  score: number;
  reasons: string[];
  primaryEvidenceCount: number;
  duplicateEvidenceCount: number;
};

type StoryDedupeItem = {
  id: string;
  storyType: "initiative" | "portfolio_project";
  title: string;
  internalTitle: string | null;
  externalSafeTitle: string | null;
  context: string | null;
  problem: string | null;
  role: string | null;
  actions: string[];
  results: string[];
  technologies: string[];
  stakeholders: string[];
  sensitivityLevel: string;
  needsRedactionReview: boolean;
  status: string;
};

type StarStory = {
  id: string;
  project_id: string;
  story_target_id: string;
  story_target_type: "initiative" | "portfolio_project" | "legacy_project";
  title: string;
  internal_title?: string | null;
  status: string;
  readiness: "ready" | "needs_review" | "thin";
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
};

type EvidenceLibrary = {
  profile: { displayName: string | null; updatedAt: string } | null;
  evidenceItems: EvidenceCardItem[];
  workExperiences: WorkExperienceItem[];
  initiatives: InitiativeItem[];
  portfolioProjects: PortfolioProjectItem[];
  projectCards: ProjectCardItem[];
};

type EvidenceCardItem = {
  id?: string;
  text: string;
  source_quote: string;
  source_document_id?: string | null;
  related_project_id?: string | null;
  related_work_experience_id?: string | null;
  related_initiative_id?: string | null;
  related_portfolio_project_id?: string | null;
  evidence_type: string;
  sensitivity_level: string;
  allowed_usage?: string[];
  public_safe_summary?: string | null;
  status: string;
  needs_user_confirmation: boolean;
  enrichment_task_count?: number;
  updatedAt?: string;
};

type ExternalSafeSummarySuggestion = {
  provider: "ai" | "deterministic";
  safeSummary: string;
  confidence: "low" | "medium" | "high";
  needsUserReview: boolean;
  blockedTerms: string[];
  redactionReport: {
    hasBlockedTerms: boolean;
    blockedTerms: string[];
    suggestedSummary: string;
    diff: Array<{
      from: string;
      to: string;
      reason?: string;
    }>;
  };
};

type EnrichmentTaskItem = {
  id: string;
  task_type: string;
  status: "open" | "answered" | "converted" | "dismissed";
  source_type: string;
  source_label: string;
  prompt: string;
  user_answer: string | null;
  target_scope:
    | "evidence_detail"
    | "story_context"
    | "role_context"
    | "source_material"
    | "assign_later"
    | "profile_context"
    | "profile_fact";
  target_confidence: "low" | "medium" | "high";
  target_reason: string | null;
  expected_outcome:
    | "create_evidence"
    | "update_evidence"
    | "update_story"
    | "update_role"
    | "clarify_assignment"
    | "review_imported_material"
    | "save_profile_answer"
    | "update_profile_fact"
    | "route_answer";
  note_kind:
    | "observation"
    | "missing_profile_fact"
    | "missing_role_field"
    | "extraction_limit"
    | "import_review"
    | "evidence_gap"
    | "story_gap"
    | null;
  expected_action:
    | "acknowledge"
    | "dismiss"
    | "add_profile_fact"
    | "edit_profile_fact"
    | "edit_role_field"
    | "review_import"
    | "rerun_extraction"
    | "answer_enrichment_question"
    | null;
  target_field: string | null;
  targets: Array<{
    target_kind: "evidence" | "initiative" | "portfolio_project" | "work_experience";
    target_id: string;
    target_role: "primary" | "parent" | "suggested" | "previous";
    confidence: "low" | "medium" | "high";
    reason: string | null;
  }>;
  proposals: Array<{
    id: string;
    proposal_type:
      | "create_evidence"
      | "update_evidence"
      | "create_initiative"
      | "update_initiative"
      | "update_work_experience"
      | "clarify_assignment"
      | "link_evidence_to_story"
      | "link_story_to_role";
    status: "pending_review" | "accepted" | "rejected";
    target_kind: "evidence" | "initiative" | "portfolio_project" | "work_experience" | null;
    target_id: string | null;
    schema_version: string;
    proposed_patch_json: Record<string, unknown>;
    evidence_delta_json: Record<string, unknown> | null;
    committed_evidence_item_id: string | null;
    createdAt: string;
    updatedAt: string;
    reviewedAt: string | null;
  }>;
  proposal_revisions: Array<{
    id: string;
    proposal_id: string | null;
    next_proposal_id: string | null;
    actor: "user" | "ai";
    mode: "manual_edit" | "ai_revision";
    instruction: string | null;
    previous_text: string;
    revised_text: string;
    createdAt: string;
  }>;
  evidence_item_id: string | null;
  work_experience_id: string | null;
  initiative_id: string | null;
  portfolio_project_id: string | null;
  resume_source_version_id: string | null;
  resume_review_report_id: string | null;
  updatedAt: string;
  answeredAt: string | null;
  convertedAt: string | null;
  dismissedAt: string | null;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  resolution_kind:
    | "acknowledged"
    | "dismissed"
    | "profile_answer_saved"
    | "profile_fact_updated"
    | "role_field_updated"
    | "import_reviewed"
    | "rerun_requested"
    | "converted_to_enrichment_question"
    | null;
};

type EnrichmentPendingAction =
  | "accept"
  | "discard"
  | "generate"
  | "manual_edit"
  | "ai_revision"
  | "save_context"
  | "other";

type EnrichmentTaskAnchorPatch = {
  evidenceItemId?: string | null;
  initiativeId?: string | null;
  portfolioProjectId?: string | null;
  workExperienceId?: string | null;
};

type EnrichmentTaskUpdatePayload =
  | { action: "answer"; userAnswer: string }
  | { action: "acknowledge" }
  | { action: "dismiss" }
  | { action: "mark_import_reviewed" }
  | { action: "request_rerun" }
  | { action: "convert_to_enrichment_question" }
  | { action: "reopen" }
  | { action: "convert" }
  | { action: "accept_proposal"; proposalId: string }
  | { action: "reject_proposal"; proposalId: string }
  | {
      action: "revise_proposal";
      proposalId: string;
      revisedText?: string;
      revisionInstruction?: string;
    }
  | { action: "link"; anchor: EnrichmentTaskAnchorPatch };

type WorkExperienceItem = {
  id?: string;
  employer: string;
  role_title: string;
  team?: string | null;
  location?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  summary?: string | null;
  status: string;
};

type InitiativeItem = {
  id?: string;
  work_experience_id?: string | null;
  internal_title: string;
  external_safe_title?: string | null;
  context: string | null;
  problem: string | null;
  role: string | null;
  actions: string[];
  results: string[];
  metrics?: Array<{ value: string; source_quote: string }>;
  technologies: string[];
  stakeholders?: string[];
  external_safe_summary?: string | null;
  sensitivity_level?: string;
  needs_redaction_review?: boolean;
  status: string;
};

type PortfolioProjectItem = {
  id?: string;
  project_type: string;
  title: string;
  external_safe_title?: string | null;
  context: string | null;
  problem: string | null;
  role: string | null;
  actions: string[];
  results: string[];
  metrics?: Array<{ value: string; source_quote: string }>;
  technologies: string[];
  stakeholders?: string[];
  external_safe_summary?: string | null;
  sensitivity_level?: string;
  needs_redaction_review?: boolean;
  status: string;
};

type EvidenceLinkTargets = {
  initiatives: InitiativeItem[];
  portfolioProjects: PortfolioProjectItem[];
  projects: ProjectCardItem[];
  workExperiences: WorkExperienceItem[];
};

type ProjectCardItem = {
  id?: string;
  title: string;
  context: string | null;
  problem: string | null;
  role: string | null;
  actions: string[];
  results: string[];
  metrics?: Array<{ value: string; source_quote: string }>;
  technologies: string[];
  stakeholders?: string[];
  public_safe_summary?: string | null;
  sensitivity_level?: string;
  status: string;
};

export type MaterialEntryIntent = "resume" | "scratch" | "jd";
export type ProfileGapIntent = {
  field: "certifications" | "contact" | "education" | "location" | "skills";
  label: string;
  taskId?: string | null;
};
export type MaterialReviewTab =
  | "enrichment"
  | "projects"
  | "claims"
  | "unlinked"
  | "cleanup"
  | "stories";
type EvidenceLibraryMode = "library" | "work_queue";
type EvidenceAssetView = "all" | "stories" | "interview_stories";
type EvidenceWorkQueueView = "enrichment" | "imported" | "claims" | "unlinked" | "cleanup";
type EvidenceLibraryFilters = {
  hasMetricOnly: boolean;
  query: string;
  roleOrStory: string;
  sensitivity: string;
  source: string;
  status: string;
  unlinkedOnly: boolean;
  usage: string;
};
type ProjectSourceMode = "upload" | "paste" | "guided";
type StoryEnrichmentTargetType = "initiative" | "portfolio_project" | "legacy_project";

type StoryEnrichmentTarget = {
  targetType: StoryEnrichmentTargetType;
  targetId: string;
  targetTitle: string;
  context?: string | null;
  problem?: string | null;
  role?: string | null;
  actions?: string[];
  results?: string[];
  missingFields?: string[];
};

type EvidenceFocus = {
  targetType: StoryEnrichmentTargetType;
  targetId: string;
  title: string;
} | null;

type StarStoryFocus = {
  targetType: StoryEnrichmentTargetType;
  targetId: string;
  title: string;
} | null;

type ResumeSourceSummary = {
  id: string;
  title: string;
  version: number;
  status: string;
  updatedAt: string;
  latestReview: {
    overallScore: number;
    weaknesses: string[];
  } | null;
};

type SourceDraft = {
  text: string;
  title: string;
  sourceDocumentId?: string;
};

type ParseQuality = {
  status: "usable" | "warning" | "needs_ocr" | "failed";
  charCount: number;
  wordCount: number;
  pageCount?: number;
  warnings: string[];
};

type SourceParseCard = {
  filename: string;
  sourceType: string;
  sourceDocumentId?: string;
  title: string;
  parseQuality: ParseQuality;
  duplicate?: {
    sourceDocumentId: string;
    title: string;
    createdAt: string;
  };
  nextAction: "resume_review" | "extract" | "manual_paste";
};

type FileProcessingState = {
  filename: string;
  mode: "resume-review" | "source-parse" | "project-import";
  fileCount?: number;
};

type EvidenceUpdateAction =
  | "approve"
  | "approve_for_resume"
  | "reject"
  | "edit"
  | "mark_external_safe";

type EvidenceUpdatePatch = {
  text?: string;
  publicSafeSummary?: string | null;
  allowedUsage?: string[];
  sensitivityLevel?: string;
  relatedProjectId?: string | null;
  relatedWorkExperienceId?: string | null;
  relatedInitiativeId?: string | null;
  relatedPortfolioProjectId?: string | null;
};

type StoryAssignmentPatch =
  | {
      action: "assign_work_experience";
      targetType: "initiative";
      workExperienceId: string | null;
    }
  | {
      action: "create_work_experience_and_assign";
      targetType: "initiative";
      employer: string;
      roleTitle: string;
      team?: string | null;
      location?: string | null;
      startDate?: string | null;
      endDate?: string | null;
      summary?: string | null;
    };

export function ProfileEvidenceWorkspace({
  entryIntent = "resume",
  initialFocusedTaskId = null,
  initialProfileGap = null,
  initialSection = "review",
  initialReviewTab = "enrichment",
  initialResumeSourceVersionId = null,
}: {
  entryIntent?: MaterialEntryIntent;
  initialFocusedTaskId?: string | null;
  initialProfileGap?: ProfileGapIntent | null;
  initialSection?: "review" | "intake";
  initialReviewTab?: MaterialReviewTab;
  initialResumeSourceVersionId?: string | null;
}) {
  const { fetchJson } = useAccess();
  const [activeSection, setActiveSection] = useState<"review" | "intake">(initialSection);
  const [selectedEntryIntent, setSelectedEntryIntent] =
    useState<MaterialEntryIntent>(entryIntent);
  const [hasChosenMaterialType, setHasChosenMaterialType] = useState(
    Boolean(initialResumeSourceVersionId),
  );
  const [isEditingMaterialType, setIsEditingMaterialType] = useState(false);
  const [libraryMode, setLibraryMode] = useState<EvidenceLibraryMode>("library");
  const [libraryView, setLibraryView] = useState<EvidenceAssetView>("all");
  const [workQueueView, setWorkQueueView] =
    useState<EvidenceWorkQueueView>("enrichment");
  const [libraryFilters, setLibraryFilters] = useState<EvidenceLibraryFilters>({
    hasMetricOnly: false,
    query: "",
    roleOrStory: "all",
    sensitivity: "all",
    source: "all",
    status: "all",
    unlinkedOnly: false,
    usage: "all",
  });
  const [sourceDrafts, setSourceDrafts] = useState<Record<"resume" | "jd", SourceDraft>>({
    jd: { text: "", title: "" },
    resume: { text: "", title: "" },
  });
  const [projectNoteText, setProjectNoteText] = useState("");
  const [projectNoteTitle, setProjectNoteTitle] = useState("");
  const [projectSourceDocumentId, setProjectSourceDocumentId] = useState<string | undefined>();
  const [projectSourceMode, setProjectSourceMode] = useState<ProjectSourceMode>("guided");
  const [guidedMaterialFields, setGuidedMaterialFields] = useState<GuidedMaterialFields>(
    emptyGuidedMaterialFields,
  );
  const [guidedPreviewState, setGuidedPreviewState] =
    useState<"synced" | "edited" | "stale">("synced");
  const [selectedStoryTarget, setSelectedStoryTarget] =
    useState<StoryEnrichmentTarget | null>(null);
  const [activeProfileGap, setActiveProfileGap] = useState<ProfileGapIntent | null>(null);
  const [evidenceFocus, setEvidenceFocus] = useState<EvidenceFocus>(null);
  const [starStoryFocus, setStarStoryFocus] = useState<StarStoryFocus>(null);
  const [fileStatus, setFileStatus] = useState<string | null>(null);
  const [fileProcessing, setFileProcessing] = useState<FileProcessingState | null>(null);
  const [parseCard, setParseCard] = useState<SourceParseCard | null>(null);
  const [resumeSources, setResumeSources] = useState<ResumeSourceSummary[]>([]);
  const [selectedResumeSourceId, setSelectedResumeSourceId] = useState<string>(
    initialResumeSourceVersionId ?? "",
  );
  const [resumeSourceEditable, setResumeSourceEditable] = useState(false);
  const [selectedResumeSourceLoading, setSelectedResumeSourceLoading] = useState(false);
  const [result, setResult] = useState<ProfileEvidenceExtraction | null>(null);
  const [library, setLibrary] = useState<EvidenceLibrary | null>(null);
  const [dedupeCandidates, setDedupeCandidates] = useState<DedupeCandidate[]>([]);
  const [storyDedupeCandidates, setStoryDedupeCandidates] = useState<StoryDedupeCandidate[]>(
    [],
  );
  const [starStories, setStarStories] = useState<StarStory[]>([]);
  const [enrichmentTasks, setEnrichmentTasks] = useState<EnrichmentTaskItem[]>([]);
  const [enrichmentTaskQueueStatus, setEnrichmentTaskQueueStatus] =
    useState<"ready" | "skipped" | "error">("ready");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Add material to continue.");
  const [retrievalPreview, setRetrievalPreview] = useState<{
    evidence: RetrievalEvidenceExplanation[];
    sourceMaterial: RetrievalSourceMaterialExplanation[];
  }>({ evidence: [], sourceMaterial: [] });
  const [lastIntakeSummary, setLastIntakeSummary] = useState<{
    evidenceCount: number;
    projectCount: number;
    storyCount: number;
    workExperienceCount: number;
    sourceTitle: string;
    type: "resume" | "project";
  } | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isProjectEnriching, setIsProjectEnriching] = useState(false);
  const [extractElapsedSeconds, setExtractElapsedSeconds] = useState(0);
  const [projectElapsedSeconds, setProjectElapsedSeconds] = useState(0);
  const [fileProcessingElapsedSeconds, setFileProcessingElapsedSeconds] = useState(0);

  useEffect(() => {
    void loadLibrary();
    void loadDedupeCandidates();
    void loadStoryDedupeCandidates();
    void loadStarStories();
    void loadEnrichmentTasks();
    void loadResumeSources();
  }, []);

  useEffect(() => {
    if (!initialResumeSourceVersionId) return;
    setSelectedResumeSourceId(initialResumeSourceVersionId);
    void loadResumeSourceIntoIntake(initialResumeSourceVersionId);
  }, [initialResumeSourceVersionId]);

  useEffect(() => {
    setSelectedEntryIntent(entryIntent);
    setHasChosenMaterialType(Boolean(initialResumeSourceVersionId));
    setIsEditingMaterialType(false);
  }, [entryIntent, initialResumeSourceVersionId]);

  useEffect(() => {
    setActiveSection(initialSection);
  }, [initialSection]);

  useEffect(() => {
    openReviewDestination(initialReviewTab);
  }, [initialReviewTab]);

  useEffect(() => {
    if (!initialFocusedTaskId) return;
    setActiveSection("review");
    setLibraryMode("work_queue");
    setWorkQueueView("enrichment");
  }, [initialFocusedTaskId]);

  useEffect(() => {
    if (!initialProfileGap) return;
    const guidance = profileGapGuidance(initialProfileGap.field);
    setActiveSection("intake");
    setSelectedEntryIntent("scratch");
    setHasChosenMaterialType(true);
    setIsEditingMaterialType(false);
    setProjectSourceMode("guided");
    setActiveProfileGap(initialProfileGap);
    setSelectedStoryTarget(null);
    setProjectNoteTitle(initialProfileGap.label);
    setGuidedMaterialFields(emptyGuidedMaterialFields);
    setProjectNoteText(guidance.template);
    setProjectSourceDocumentId(undefined);
    setGuidedPreviewState("edited");
    setStatus(guidance.status);
    setError(null);
  }, [initialProfileGap]);

  useEffect(() => {
    if (!isExtracting) {
      setExtractElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setExtractElapsedSeconds(Math.max(1, Math.round((Date.now() - startedAt) / 1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isExtracting]);

  useEffect(() => {
    if (!isProjectEnriching) {
      setProjectElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setProjectElapsedSeconds(Math.max(1, Math.round((Date.now() - startedAt) / 1000)));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isProjectEnriching]);

  useEffect(() => {
    if (!fileProcessing) {
      setFileProcessingElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setFileProcessingElapsedSeconds(
        Math.max(1, Math.round((Date.now() - startedAt) / 1000)),
      );
    }, 1000);
    return () => window.clearInterval(timer);
  }, [fileProcessing]);

  const activeSourceIntent = selectedEntryIntent === "jd" ? "jd" : "resume";
  const sourceText = sourceDrafts[activeSourceIntent].text;
  const sourceTitle = sourceDrafts[activeSourceIntent].title;
  const sourceDocumentId = sourceDrafts[activeSourceIntent].sourceDocumentId;

  useEffect(() => {
    const query =
      activeSection === "intake"
        ? selectedEntryIntent === "scratch"
          ? projectNoteText
          : sourceText
        : libraryFilters.query;
    void loadRetrievalPreview(query);
  }, [activeSection, libraryFilters.query, projectNoteText, selectedEntryIntent, sourceText]);

  function updateActiveSourceDraft(patch: Partial<SourceDraft>) {
    setSourceDrafts((current) => ({
      ...current,
      [activeSourceIntent]: {
        ...current[activeSourceIntent],
        ...patch,
      },
    }));
  }

  function updateSourceDraft(intent: "resume" | "jd", patch: Partial<SourceDraft>) {
    setSourceDrafts((current) => ({
      ...current,
      [intent]: {
        ...current[intent],
        ...patch,
      },
    }));
  }

  function jumpToSourceMaterial(source: RetrievalSourceMaterialExplanation) {
    setActiveSection("intake");
    setHasChosenMaterialType(true);
    setIsEditingMaterialType(false);
    setSelectedEntryIntent("scratch");
    setProjectSourceMode("paste");
    setSelectedStoryTarget(null);
    setActiveProfileGap(null);
    setProjectNoteTitle(`${source.title} evidence enrichment`);
    setProjectNoteText(source.chunk_excerpt);
    setProjectSourceDocumentId(source.source_document_id || undefined);
    setStatus("Loaded source chunk into Add Material. Convert or enrich evidence before resume use.");
    setError(null);
  }

  async function loadLibrary() {
    const response = await fetchJson("/api/profile-evidence/recent");
    if (!response.ok) {
      setError(await formatLoadError(response, "Could not load the material library."));
      return;
    }
    const payload = (await response.json()) as { data?: EvidenceLibrary };
    setLibrary(payload.data ?? null);
  }

  async function loadRetrievalPreview(query: string) {
    const trimmed = query.trim();
    if (trimmed.length < 3) {
      setRetrievalPreview({ evidence: [], sourceMaterial: [] });
      return;
    }
    const response = await fetchJson("/api/retrieval/resume-explanations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: trimmed, limit: 6 }),
    });
    if (!response.ok) return;
    const payload = (await response.json()) as {
      data?: {
        evidence?: RetrievalEvidenceExplanation[];
        sourceMaterial?: RetrievalSourceMaterialExplanation[];
      };
    };
    setRetrievalPreview({
      evidence: payload.data?.evidence ?? [],
      sourceMaterial: payload.data?.sourceMaterial ?? [],
    });
  }

  async function loadDedupeCandidates() {
    const response = await fetchJson("/api/evidence/dedupe");
    if (!response.ok) return;
    const payload = (await response.json()) as {
      data?: { status: string; candidates?: DedupeCandidate[] };
    };
    setDedupeCandidates(payload.data?.candidates ?? []);
  }

  async function loadStoryDedupeCandidates() {
    const response = await fetchJson("/api/story-targets/dedupe");
    if (!response.ok) return;
    const payload = (await response.json()) as {
      data?: { status: string; candidates?: StoryDedupeCandidate[] };
    };
    setStoryDedupeCandidates(payload.data?.candidates ?? []);
  }

  async function loadStarStories() {
    const response = await fetchJson("/api/profile-evidence/star-stories");
    if (!response.ok) return;
    const payload = (await response.json()) as {
      data?: { status: string; stories?: StarStory[] };
    };
    setStarStories(payload.data?.stories ?? []);
  }

  async function loadEnrichmentTasks() {
    const params = new URLSearchParams({
      limit: "100",
      status: "open,answered,converted",
    });
    const response = await fetchJson(`/api/enrichment-tasks?${params.toString()}`);
    if (!response.ok) {
      setEnrichmentTaskQueueStatus("error");
      return;
    }
    const payload = (await response.json()) as {
      data?: { status: string; tasks?: EnrichmentTaskItem[] };
    };
    setEnrichmentTaskQueueStatus(payload.data?.status === "skipped" ? "skipped" : "ready");
    setEnrichmentTasks(payload.data?.tasks ?? []);
  }

  async function loadResumeSources() {
    const response = await fetchJson("/api/resume-review");
    if (!response.ok) return;
    const payload = (await response.json()) as {
      data?: { status: string; resumes?: ResumeSourceSummary[] };
    };
    setResumeSources(payload.data?.resumes ?? []);
  }

  async function loadResumeSourceIntoIntake(resumeSourceVersionId: string) {
    if (!resumeSourceVersionId) {
      setSelectedResumeSourceId("");
      setResumeSourceEditable(false);
      updateSourceDraft("resume", { text: "", title: "", sourceDocumentId: undefined });
      setFileStatus(null);
      setStatus("Ready for a new resume. Select a reviewed version, upload a file, or paste resume text.");
      return;
    }
    setSelectedResumeSourceLoading(true);
    setError(null);
    try {
      const response = await fetchJson(`/api/resume-review/${resumeSourceVersionId}`);
      const payload = (await response.json().catch(() => null)) as
        | {
            data?: {
              status: string;
              resume?: {
                id: string;
                sourceDocumentId?: string;
                title: string;
                sourceText: string;
              };
            };
            error?: string;
          }
        | null;
      if (response.status === 404) {
        setSelectedResumeSourceId("");
        setResumeSourceEditable(false);
        updateSourceDraft("resume", { text: "", title: "", sourceDocumentId: undefined });
        setFileStatus(null);
        setError("That reviewed resume was deleted. Select another resume or upload a new one.");
        await loadResumeSources();
        return;
      }
      if (!response.ok || payload?.data?.status !== "ready" || !payload.data.resume) {
        setError(payload?.error ?? "Could not load selected resume.");
        return;
      }
      updateSourceDraft("resume", {
        text: payload.data.resume.sourceText,
        title: formatResumeTitle(payload.data.resume.title),
        sourceDocumentId: payload.data.resume.sourceDocumentId,
      });
      setResumeSourceEditable(false);
      setFileStatus(`Using reviewed resume ${formatResumeTitle(payload.data.resume.title)}`);
    } finally {
      setSelectedResumeSourceLoading(false);
    }
  }

  async function refreshLibraryAfterMutation() {
    await loadLibrary();
    await loadDedupeCandidates();
    await loadStoryDedupeCandidates();
    await loadStarStories();
    await loadEnrichmentTasks();
    window.dispatchEvent(new Event("jobdesk:evidence-library-updated"));
  }

  function runExtraction() {
    setError(null);
    setStatus("Turning this material into reusable evidence.");
    setIsExtracting(true);
    void (async () => {
      try {
        const response = await fetchJson("/api/profile-evidence/extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceText,
            sourceTitle: sourceTitle.trim() || undefined,
            sourceDocumentId,
            sourceType: selectedEntryIntent === "jd" ? "jd-gap-note" : undefined,
            resumeSourceVersionId: selectedResumeSourceId || undefined,
          }),
        });
        const payload = (await response.json()) as ExtractionResponse;
        if (!response.ok || "error" in payload) {
          setError(
            "error" in payload
              ? `${payload.error}${payload.kind ? ` (${payload.kind})` : ""}`
              : "Profile evidence extraction failed.",
          );
          return;
        }
        setStatus(formatStatus(payload.meta));
        if (payload.meta.persistence?.status === "saved") {
          await refreshLibraryAfterMutation();
          await loadResumeSources();
          setResult(null);
          setLastIntakeSummary({
            evidenceCount: payload.meta.persistence.evidenceCount ?? payload.data.evidence_items.length,
            projectCount: payload.meta.persistence.projectCount ?? payload.data.project_cards.length,
            storyCount:
              (payload.meta.persistence.initiativeCount ?? payload.data.initiatives.length) +
              (payload.meta.persistence.portfolioProjectCount ??
                payload.data.portfolio_projects.length),
            workExperienceCount:
              payload.meta.persistence.workExperienceCount ?? payload.data.work_experiences.length,
            sourceTitle: sourceTitle.trim() || "Resume/source",
            type: "resume",
          });
          setActiveSection("review");
        } else {
          setResult(payload.data);
          await refreshLibraryAfterMutation();
          await loadResumeSources();
          setLastIntakeSummary({
            evidenceCount: payload.data.evidence_items.length,
            projectCount: payload.data.project_cards.length,
            storyCount: payload.data.initiatives.length + payload.data.portfolio_projects.length,
            workExperienceCount: payload.data.work_experiences.length,
            sourceTitle: sourceTitle.trim() || "Resume/source",
            type: "resume",
          });
          setActiveSection("review");
        }
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Profile evidence extraction failed.",
        );
      } finally {
        setIsExtracting(false);
      }
    })();
  }

  async function importResumeFile(file: File | null) {
    setError(null);
    setFileStatus(null);
    setParseCard(null);
    if (!file) return;
    const allowedExtensions = [".pdf", ".docx", ".txt", ".md", ".markdown"];
    const lowerName = file.name.toLowerCase();
    if (!allowedExtensions.some((extension) => lowerName.endsWith(extension))) {
      setError("Upload a resume as PDF, DOCX, plain text, or Markdown.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError("Resume source file is too large. Keep it under 8 MB.");
      return;
    }

    if (selectedEntryIntent === "resume") {
      setFileStatus(`Reviewing ${file.name}...`);
      setFileProcessing({ filename: file.name, mode: "resume-review" });
      const formData = new FormData();
      formData.append("file", file);
      let response: Response;
      try {
        response = await fetchJson("/api/resume-review", {
          method: "POST",
          body: formData,
        });
      } catch (caught) {
        setFileProcessing(null);
        setFileStatus(null);
        setError(
          caught instanceof Error ? caught.message : "Resume review failed.",
        );
        return;
      }
      const payload = (await response.json().catch(() => null)) as
        | {
            data?: {
              status: "saved" | "duplicate" | "skipped";
              resume?: { id: string; title: string; version: number };
              existingResume?: { id: string; title: string; version: number };
              parseWarnings?: string[];
              parseQuality?: ParseQuality;
              reason?: string;
            };
            error?: string;
          }
        | null;
      if (!response.ok || !payload?.data) {
        setFileProcessing(null);
        setFileStatus(null);
        setError(payload?.error ?? "Resume review failed.");
        return;
      }
      if (payload.data.status === "duplicate" && payload.data.existingResume) {
        setSelectedResumeSourceId(payload.data.existingResume.id);
        await loadResumeSources();
        await loadResumeSourceIntoIntake(payload.data.existingResume.id);
        setFileStatus(
          `This exact resume already exists as v${payload.data.existingResume.version}. Using ${formatResumeTitle(payload.data.existingResume.title)}.`,
        );
        setFileProcessing(null);
        if (payload.data.parseQuality) {
          setParseCard({
            filename: file.name,
            sourceType: "resume",
            title: payload.data.existingResume.title,
            parseQuality: payload.data.parseQuality,
            nextAction: "resume_review",
          });
        }
        return;
      }
      if (payload.data.status === "saved" && payload.data.resume) {
        setSelectedResumeSourceId(payload.data.resume.id);
        await loadResumeSources();
        await loadResumeSourceIntoIntake(payload.data.resume.id);
        setFileStatus(
          `Reviewed ${formatResumeTitle(payload.data.resume.title)}${payload.data.parseWarnings?.length ? ` · ${payload.data.parseWarnings.length} parser note${payload.data.parseWarnings.length === 1 ? "" : "s"}` : ""}`,
        );
        setFileProcessing(null);
        if (payload.data.parseQuality) {
          setParseCard({
            filename: file.name,
            sourceType: "resume",
            title: payload.data.resume.title,
            parseQuality: payload.data.parseQuality,
            nextAction: "resume_review",
          });
        }
        return;
      }
      setFileProcessing(null);
      setFileStatus(null);
      setError(payload.data.reason ?? "Resume review storage is not configured.");
      return;
    }

    setFileStatus(`Reading ${file.name}...`);
    setFileProcessing({ filename: file.name, mode: "source-parse" });
    const formData = new FormData();
    formData.append("file", file);
    formData.append(
      "sourceIntent",
      selectedEntryIntent === "jd" ? "jd_gap_note" : "generic_source",
    );
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 30_000);
    let response: Response;
    try {
      response = await fetchJson("/api/profile-evidence/parse-source", {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });
    } catch (caught) {
      window.clearTimeout(timeoutId);
      setFileProcessing(null);
      setFileStatus(null);
      setError(
        caught instanceof DOMException && caught.name === "AbortError"
          ? "Resume import timed out. Check that the local dev server is still running, then try again."
          : caught instanceof Error
            ? caught.message
            : "Resume source parsing failed.",
      );
      return;
    } finally {
      window.clearTimeout(timeoutId);
    }
    const payload = (await response.json().catch(() => null)) as
      | {
          data?: {
            sourceTitle: string;
            sourceText: string;
            sourceKind: string;
            sourceType: string;
            sourceDocumentId?: string;
            parseQuality: ParseQuality;
            warnings: string[];
            duplicate?: SourceParseCard["duplicate"];
          };
          error?: string;
          kind?: string;
        }
      | null;
    if (!response.ok || !payload?.data) {
      setFileProcessing(null);
      setFileStatus(null);
      setError(payload?.error ?? "Resume source parsing failed.");
      return;
    }
    const parseNextAction =
      payload.data.parseQuality.status === "needs_ocr" ||
      payload.data.parseQuality.status === "failed"
        ? "manual_paste"
        : "extract";
    if (parseNextAction === "manual_paste") {
      setParseCard({
        filename: file.name,
        sourceType: payload.data.sourceType,
        sourceDocumentId: payload.data.sourceDocumentId,
        title: payload.data.sourceTitle,
        parseQuality: payload.data.parseQuality,
        duplicate: payload.data.duplicate,
        nextAction: parseNextAction,
      });
      setFileStatus("This file needs manual text input before JobDesk can use it.");
      setFileProcessing(null);
      return;
    }
    if (selectedEntryIntent === "scratch") {
      setProjectNoteText(payload.data.sourceText);
      setProjectNoteTitle(payload.data.sourceTitle);
      setProjectSourceDocumentId(payload.data.sourceDocumentId);
    } else {
      updateActiveSourceDraft({
        text: payload.data.sourceText,
        title: payload.data.sourceTitle,
        sourceDocumentId: payload.data.sourceDocumentId,
      });
    }
    setSelectedResumeSourceId("");
    setParseCard({
      filename: file.name,
      sourceType: payload.data.sourceType,
      sourceDocumentId: payload.data.sourceDocumentId,
      title: payload.data.sourceTitle,
      parseQuality: payload.data.parseQuality,
      duplicate: payload.data.duplicate,
      nextAction: parseNextAction,
    });
    setFileStatus(
      `Imported ${payload.data.sourceTitle}${payload.data.warnings.length > 0 ? ` · ${payload.data.warnings.length} note${payload.data.warnings.length === 1 ? "" : "s"} to review` : ""}`,
    );
    setFileProcessing(null);
  }

  async function parseSourceFile(file: File) {
    const allowedExtensions = [".pdf", ".docx", ".txt", ".md", ".markdown"];
    const lowerName = file.name.toLowerCase();
    if (!allowedExtensions.some((extension) => lowerName.endsWith(extension))) {
      throw new Error(`${file.name}: unsupported file type`);
    }
    if (file.size > 8 * 1024 * 1024) {
      throw new Error(`${file.name}: file is too large; keep each file under 8 MB`);
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("sourceIntent", "project_note");
    const response = await fetchJson("/api/profile-evidence/parse-source", {
      method: "POST",
      body: formData,
    });
    const payload = (await response.json().catch(() => null)) as
      | {
          data?: {
            sourceTitle: string;
            sourceText: string;
            sourceDocumentId?: string;
            parseQuality: ParseQuality;
            warnings: string[];
          };
          error?: string;
        }
      | null;
    if (!response.ok || !payload?.data) {
      throw new Error(`${file.name}: ${payload?.error ?? "source parsing failed"}`);
    }
    if (
      payload.data.parseQuality.status === "needs_ocr" ||
      payload.data.parseQuality.status === "failed"
    ) {
      throw new Error(`${file.name}: needs manual text input before extraction`);
    }
    return { ...payload.data, filename: file.name };
  }

  async function importProjectNoteFiles(files: FileList | null) {
    setError(null);
    if (!files || files.length === 0) return;
    setFileStatus(`Reading ${files.length} project source file${files.length === 1 ? "" : "s"}...`);
    const fileArray = Array.from(files);
    setFileProcessing({
      filename: fileArray.length === 1 ? fileArray[0]?.name ?? "Project file" : `${fileArray.length} project files`,
      mode: "project-import",
      fileCount: fileArray.length,
    });
    const parsedSources: Awaited<ReturnType<typeof parseSourceFile>>[] = [];
    const failures = [];
    for (const file of fileArray) {
      try {
        parsedSources.push(await parseSourceFile(file));
      } catch (caught) {
        failures.push(caught instanceof Error ? caught.message : `${file.name}: parse failed`);
      }
    }
    if (parsedSources.length === 0) {
      setFileProcessing(null);
      setFileStatus(null);
      setError(failures[0] ?? "No project source files could be parsed.");
      return;
    }
    const firstParsedSource = parsedSources[0];
    const hasExistingProjectText = projectNoteText.trim().length > 0;
    const canBindSingleParsedSource =
      parsedSources.length === 1 && Boolean(firstParsedSource) && !hasExistingProjectText;
    const appendedText = parsedSources
      .map((source) => [`## ${source.sourceTitle}`, source.sourceText].join("\n\n"))
      .join("\n\n---\n\n");
    setProjectNoteText((current) => {
      const trimmedCurrent = current.trim();
      if (parsedSources.length === 1 && firstParsedSource && !trimmedCurrent) {
        return firstParsedSource.sourceText;
      }
      return trimmedCurrent ? `${trimmedCurrent}\n\n---\n\n${appendedText}` : appendedText;
    });
    setProjectNoteTitle((current) =>
      current.trim()
        ? current
        : parsedSources.length === 1
          ? parsedSources[0]?.sourceTitle ?? "Project source"
          : `${parsedSources.length} project source files`,
    );
    const warningCount = parsedSources.reduce(
      (count, source) => count + source.warnings.length,
      0,
    );
    if (firstParsedSource) {
      setProjectSourceDocumentId(
        canBindSingleParsedSource ? firstParsedSource.sourceDocumentId : undefined,
      );
      setParseCard({
        filename:
          parsedSources.length === 1
            ? firstParsedSource.filename
            : `${parsedSources.length} project source files`,
        sourceType: "project_note",
        title:
          parsedSources.length === 1
            ? firstParsedSource.sourceTitle
            : `${parsedSources.length} project source files`,
        parseQuality: firstParsedSource.parseQuality,
        sourceDocumentId:
          canBindSingleParsedSource ? firstParsedSource.sourceDocumentId : undefined,
        nextAction:
          firstParsedSource.parseQuality.status === "needs_ocr"
            ? "manual_paste"
            : "extract",
      });
    }
    setFileStatus(
      `Imported ${parsedSources.length} project source file${parsedSources.length === 1 ? "" : "s"}${warningCount ? ` · ${warningCount} parser note${warningCount === 1 ? "" : "s"}` : ""}${failures.length ? ` · ${failures.length} failed` : ""}`,
    );
    setFileProcessing(null);
  }

  function runProjectEnrichment() {
    setError(null);
    if (activeProfileGap) {
      void saveProfileFactFromIntake();
      return;
    }
    setStatus("Enriching project notes into reusable evidence.");
    setIsProjectEnriching(true);
    void (async () => {
      try {
        const response = await fetchJson("/api/profile-evidence/enrich-project", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceText: projectNoteText,
            sourceTitle: projectNoteTitle.trim() || undefined,
            sourceDocumentId: projectSourceDocumentId,
            target: selectedStoryTarget
              ? {
                  missingFields: selectedStoryTarget.missingFields ?? [],
                  targetId: selectedStoryTarget.targetId,
                  targetTitle: selectedStoryTarget.targetTitle,
                  targetType: selectedStoryTarget.targetType,
                }
              : undefined,
          }),
        });
        const payload = (await response.json()) as ExtractionResponse;
        if (!response.ok || "error" in payload) {
          setError(
            "error" in payload
              ? `${payload.error}${payload.kind ? ` (${payload.kind})` : ""}`
              : "Project evidence enrichment failed.",
          );
          return;
        }
        setStatus(
          activeProfileGap
            ? `Profile source saved · ${formatStatus(payload.meta)}`
            : `Project material added · ${formatStatus(payload.meta)}`,
        );
        if (payload.meta.persistence?.status === "saved") {
          await refreshLibraryAfterMutation();
          setResult(null);
          setSelectedStoryTarget(null);
          setLastIntakeSummary({
            evidenceCount: payload.meta.persistence.evidenceCount ?? payload.data.evidence_items.length,
            projectCount: payload.meta.persistence.projectCount ?? payload.data.project_cards.length,
            storyCount:
              (payload.meta.persistence.initiativeCount ?? payload.data.initiatives.length) +
              (payload.meta.persistence.portfolioProjectCount ??
                payload.data.portfolio_projects.length),
            workExperienceCount:
              payload.meta.persistence.workExperienceCount ?? payload.data.work_experiences.length,
            sourceTitle: projectNoteTitle.trim() || "Project source",
            type: "project",
          });
          setActiveSection("review");
        } else {
          setResult(payload.data);
          await refreshLibraryAfterMutation();
          setSelectedStoryTarget(null);
          setLastIntakeSummary({
            evidenceCount: payload.data.evidence_items.length,
            projectCount: payload.data.project_cards.length,
            storyCount: payload.data.initiatives.length + payload.data.portfolio_projects.length,
            workExperienceCount: payload.data.work_experiences.length,
            sourceTitle: projectNoteTitle.trim() || "Project source",
            type: "project",
          });
          setActiveSection("review");
        }
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : activeProfileGap
              ? "Profile source save failed."
              : "Project evidence enrichment failed.",
        );
      } finally {
        setIsProjectEnriching(false);
      }
    })();
  }

  async function saveProfileFactFromIntake() {
    if (!activeProfileGap) return;
    setError(null);
    setStatus("Saving profile fact.");
    setIsProjectEnriching(true);
    try {
      const patch = activeProfileFactPatch;
      if (!patch) {
        setError("Add at least one usable profile fact before saving.");
        return;
      }
      const response = await fetchJson("/api/profile/facts", {
        body: JSON.stringify(patch),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; kind?: string }
        | null;
      if (!response.ok) {
        setError(
          payload?.error
            ? `${payload.error}${payload.kind ? ` (${payload.kind})` : ""}`
            : "Profile fact save failed.",
        );
        return;
      }
      setStatus("Profile fact saved.");
      setProjectNoteText("");
      setProjectNoteTitle("");
      setActiveProfileGap(null);
      await refreshLibraryAfterMutation();
      setActiveSection("review");
      setLibraryMode("work_queue");
      setWorkQueueView("imported");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Profile fact save failed.");
    } finally {
      setIsProjectEnriching(false);
    }
  }

  const sourceIsReady = sourceText.trim().length >= 80;
  const guidedReadiness = getGuidedMaterialReadiness(guidedMaterialFields);
  const activeProfileFactPatch = activeProfileGap
    ? buildProfileFactPatchFromText(activeProfileGap.field, projectNoteText, {
        taskId: activeProfileGap.taskId,
      })
    : null;
  const projectNoteIsReady =
    activeProfileGap
      ? Boolean(activeProfileFactPatch)
      : projectSourceMode === "guided"
        ? guidedReadiness.isReady && hasGuidedMaterialContent(projectNoteText)
        : projectNoteText.trim().length >= 80;
  const sourceFormState = getLocalFormState({
    error,
    isRunning: isExtracting,
    ready: sourceIsReady && sourceTitle.trim().length > 0,
    success: Boolean(lastIntakeSummary && lastIntakeSummary.type === "resume"),
  });
  const projectFormState = getLocalFormState({
    error,
    isRunning: isProjectEnriching,
    ready: projectNoteIsReady && projectNoteTitle.trim().length > 0,
    success: Boolean(lastIntakeSummary && lastIntakeSummary.type === "project"),
  });
  const hasActiveSourceMaterial =
    selectedEntryIntent === "scratch"
      ? projectNoteTitle.trim().length > 0 || projectNoteText.trim().length > 0
      : sourceTitle.trim().length > 0 || sourceText.trim().length > 0 || Boolean(selectedResumeSourceId);
  const profile = result?.profile;
  const rawEvidenceItems = result?.evidence_items ?? library?.evidenceItems ?? [];
  const enrichmentTaskCountByEvidenceId = new Map<string, number>();
  for (const task of enrichmentTasks) {
    if (!task.evidence_item_id || (task.status !== "open" && task.status !== "answered")) {
      continue;
    }
    enrichmentTaskCountByEvidenceId.set(
      task.evidence_item_id,
      (enrichmentTaskCountByEvidenceId.get(task.evidence_item_id) ?? 0) + 1,
    );
  }
  const evidenceItems = rawEvidenceItems.map((item) => ({
    ...item,
    enrichment_task_count: "id" in item && item.id
      ? enrichmentTaskCountByEvidenceId.get(item.id) ?? 0
      : 0,
  }));
  const workExperiences = result?.work_experiences ?? library?.workExperiences ?? [];
  const initiatives = result?.initiatives ?? library?.initiatives ?? [];
  const portfolioProjects = result?.portfolio_projects ?? library?.portfolioProjects ?? [];
  const projectCards = result?.project_cards ?? library?.projectCards ?? [];
  const activeEnrichmentTasks = enrichmentTasks.filter(
    (task) => task.status === "open" || task.status === "answered",
  );
  const importedMaterialTasks = activeEnrichmentTasks.filter(isSourceSectionReviewTask);
  const answerEnrichmentTasks = activeEnrichmentTasks.filter(
    (task) => !isSourceSectionReviewTask(task),
  );
  const linkTargets = {
    initiatives,
    portfolioProjects,
    projects: projectCards,
    workExperiences,
  };
  const unlinkedEvidenceItems = getUnlinkedEvidenceItems(linkTargets, evidenceItems);
  const claimReviewEvidenceItems = evidenceItems.filter(
    (item) => getEvidenceReadiness(item).state !== "resume_ready",
  );
  const focusedEvidenceItems = evidenceFocus
    ? evidenceItems.filter((item) => evidenceMatchesFocus(item, evidenceFocus))
    : unlinkedEvidenceItems;
  const libraryReadiness = summarizeLibraryReadiness({
    cleanupCount: storyDedupeCandidates.length + dedupeCandidates.length,
    evidenceItems,
    initiatives,
    portfolioProjects,
    projectCards,
    workExperiences,
  });
  const safeLibraryFilters =
    libraryFilters.status === "needs_review"
      ? { ...libraryFilters, status: "all" }
      : libraryFilters;
  const filteredEvidenceItems = filterEvidenceLibraryItems(
    evidenceItems,
    safeLibraryFilters,
    linkTargets,
    projectCards,
  );
  const reusableEvidenceItems = filteredEvidenceItems.filter(isReusableReadyEvidence);
  const allEvidenceItems = reusableEvidenceItems;
  const toolbarOptions = buildEvidenceLibraryFilterOptions(
    reusableEvidenceItems,
    linkTargets,
    projectCards,
  );
  const entryGuidance = getEntryGuidance(selectedEntryIntent);
  const selectedResumeSource =
    resumeSources.find((resume) => resume.id === selectedResumeSourceId) ?? null;
  const showMaterialTypePicker = isEditingMaterialType || !hasChosenMaterialType;

  function buildGuidedPreview(fields: GuidedMaterialFields) {
    return buildGuidedMaterialMarkdown(fields, selectedStoryTarget
      ? {
          missingFields: selectedStoryTarget.missingFields,
          targetTitle: selectedStoryTarget.targetTitle,
          targetType: selectedStoryTarget.targetType,
        }
      : { targetTitle: fields.projectOrInitiativeTitle });
  }

  function syncGuidedPreview(fields = guidedMaterialFields) {
    setProjectNoteText(buildGuidedPreview(fields));
    setProjectSourceDocumentId(undefined);
    setGuidedPreviewState("synced");
    setStatus("Guided answers are synced into the source preview.");
  }

  function clearSharedFileState() {
    setFileStatus(null);
    setFileProcessing(null);
    setParseCard(null);
  }

  function openReviewDestination(destination: MaterialReviewTab) {
    if (destination === "projects") {
      setLibraryMode("library");
      setLibraryView("stories");
      return;
    }
    if (destination === "stories") {
      setLibraryMode("library");
      setLibraryView("interview_stories");
      return;
    }
    setLibraryMode("work_queue");
    if (destination === "enrichment") setWorkQueueView("enrichment");
    if (destination === "claims") setWorkQueueView("claims");
    if (destination === "unlinked") setWorkQueueView("unlinked");
    if (destination === "cleanup") setWorkQueueView("cleanup");
  }

  function openLibraryAssetView(view: EvidenceAssetView) {
    setLibraryMode("library");
    setLibraryView(view);
  }

  function openWorkQueueView(view: EvidenceWorkQueueView) {
    setLibraryMode("work_queue");
    setWorkQueueView(view);
  }

  function resetProjectMaterialDraft() {
    setProjectNoteText("");
    setProjectNoteTitle("");
    setProjectSourceDocumentId(undefined);
    setProjectSourceMode("guided");
    setGuidedMaterialFields(emptyGuidedMaterialFields);
    setGuidedPreviewState("synced");
    setSelectedStoryTarget(null);
    setActiveProfileGap(null);
  }

  function resetResumeSourceDraft() {
    setSelectedResumeSourceId("");
    setResumeSourceEditable(false);
    updateSourceDraft("resume", { sourceDocumentId: undefined, text: "", title: "" });
  }

  function resetJdSourceDraft() {
    updateSourceDraft("jd", { sourceDocumentId: undefined, text: "", title: "" });
  }

  function selectProjectSourceMode(mode: ProjectSourceMode) {
    if (mode === projectSourceMode) return;
    setError(null);
    clearSharedFileState();
    setProjectSourceMode(mode);
    setProjectSourceDocumentId(undefined);
    if (mode === "guided") {
      const nextText = hasGuidedMaterialContent(buildGuidedPreview(guidedMaterialFields))
        ? buildGuidedPreview(guidedMaterialFields)
        : "";
      setProjectNoteText(nextText);
      setGuidedPreviewState("synced");
      return;
    }
    setProjectNoteText("");
    setProjectNoteTitle("");
    if (mode === "paste") {
      setGuidedPreviewState("edited");
    }
  }

  function selectEntryIntent(intent: MaterialEntryIntent) {
    setSelectedEntryIntent(intent);
    setActiveProfileGap(null);
    if (intent !== "resume") setResumeSourceEditable(false);
    setHasChosenMaterialType(true);
    setIsEditingMaterialType(false);
    setError(null);
    clearSharedFileState();
    setEvidenceFocus(null);
    setStarStoryFocus(null);
    if (intent === "resume") {
      resetProjectMaterialDraft();
      resetJdSourceDraft();
      setStatus("Resume path selected. Choose an already reviewed resume version.");
    } else if (intent === "jd") {
      resetProjectMaterialDraft();
      resetResumeSourceDraft();
      setStatus("JD gap path selected. Add JD gap notes; resume drafts stay separate.");
    } else {
      resetResumeSourceDraft();
      resetJdSourceDraft();
      resetProjectMaterialDraft();
      setStatus("Story material path selected. Add notes, files, or guided answers to strengthen your evidence.");
    }
  }

  function openGenericSourceIntake() {
    setActiveProfileGap(null);
    setResumeSourceEditable(false);
    setHasChosenMaterialType(false);
    setSelectedStoryTarget(null);
    setEvidenceFocus(null);
    setStarStoryFocus(null);
    setIsEditingMaterialType(false);
    setActiveSection("intake");
  }

  function openCreateLibraryItemsForTask(task: EnrichmentTaskItem) {
    clearSharedFileState();
    setHasChosenMaterialType(true);
    setSelectedStoryTarget(null);
    setEvidenceFocus(null);
    setStarStoryFocus(null);
    setIsEditingMaterialType(false);
    if (task.source_type === "resume_review") {
      setSelectedEntryIntent("resume");
      resetProjectMaterialDraft();
      resetJdSourceDraft();
      if (task.resume_source_version_id) {
        setSelectedResumeSourceId(task.resume_source_version_id);
        void loadResumeSourceIntoIntake(task.resume_source_version_id);
      }
      setStatus("Create library items from the reviewed resume before saving enrichment answers.");
    } else if (task.source_type === "jd_gap") {
      setSelectedEntryIntent("jd");
      resetProjectMaterialDraft();
      resetResumeSourceDraft();
      setStatus("Add JD gap material before saving enrichment answers.");
    } else {
      setSelectedEntryIntent("scratch");
      resetResumeSourceDraft();
      resetJdSourceDraft();
      resetProjectMaterialDraft();
      setStatus("Add work story material before saving enrichment answers.");
    }
    setActiveSection("intake");
  }

  function openProfileFactFromImportedNote(task: EnrichmentTaskItem) {
    const field = profileGapFieldFromImportedNote(task);
    if (!field) {
      openCreateLibraryItemsForTask(task);
      return;
    }
    const guidance = profileGapGuidance(field);
    const copy = profileFactSourceCopy(field);
    clearSharedFileState();
    resetResumeSourceDraft();
    resetJdSourceDraft();
    setSelectedEntryIntent("scratch");
    setHasChosenMaterialType(true);
    setIsEditingMaterialType(false);
    setProjectSourceMode("guided");
    setActiveProfileGap({ field, label: copy.title, taskId: task.id });
    setSelectedStoryTarget(null);
    setEvidenceFocus(null);
    setStarStoryFocus(null);
    setProjectNoteTitle(copy.title);
    setGuidedMaterialFields(emptyGuidedMaterialFields);
    setProjectNoteText(guidance.template);
    setProjectSourceDocumentId(undefined);
    setGuidedPreviewState("edited");
    setStatus(guidance.status);
    setError(null);
    setActiveSection("intake");
  }

  function startProjectEnrichment(project: StoryEnrichmentTarget | {
    title: string;
    context?: string | null;
    problem?: string | null;
    role?: string | null;
    actions?: string[];
    results?: string[];
  }) {
    const isTarget = isStoryEnrichmentTarget(project);
    const target = isTarget ? project : null;
    const title = isTarget ? project.targetTitle : project.title;
    const fields = {
      ...emptyGuidedMaterialFields,
      actions: project.actions?.join("\n") ?? "",
      businessImpact: project.results?.join("\n") ?? "",
      companyOrContext: project.context ?? "",
      ownership: project.role ?? "",
      problem: project.problem ?? "",
      projectOrInitiativeTitle: title,
      roleAndTimeframe: project.role ?? "",
    };
    setGuidedMaterialFields(fields);
    setSelectedStoryTarget(target);
    setProjectSourceMode("guided");
    setProjectNoteTitle(`${title} enrichment notes`);
    setProjectNoteText(
      buildGuidedMaterialMarkdown(fields, target
        ? {
            missingFields: target.missingFields,
            targetTitle: target.targetTitle,
            targetType: target.targetType,
          }
        : { targetTitle: title }),
    );
    setGuidedPreviewState("synced");
    setProjectSourceDocumentId(undefined);
    setSelectedEntryIntent("scratch");
    setHasChosenMaterialType(true);
    clearSharedFileState();
    resetResumeSourceDraft();
    resetJdSourceDraft();
    setEvidenceFocus(null);
    setStarStoryFocus(null);
    setStatus(`Answer guided prompts for ${title}, edit the preview, then enrich the story.`);
    setActiveSection("intake");
  }

  function reviewClaimsForStory(target: StoryEnrichmentTarget) {
    setEvidenceFocus({
      targetId: target.targetId,
      targetType: target.targetType,
      title: target.targetTitle,
    });
    openWorkQueueView("claims");
  }

  function reviewStarStoryForStory(target: StoryEnrichmentTarget) {
    setEvidenceFocus(null);
    setStarStoryFocus({
      targetId: target.targetId,
      targetType: target.targetType,
      title: target.targetTitle,
    });
    openLibraryAssetView("interview_stories");
  }

  async function updateEvidence(
    item: EvidenceCardItem,
    action: EvidenceUpdateAction,
    patch: EvidenceUpdatePatch = {},
  ): Promise<{ ok: boolean; message: string }> {
    if (!item.id) {
      return { ok: false, message: "This draft has not been saved yet." };
    }
    const externalAllowedUsage = Array.from(
      new Set([
        ...(item.allowed_usage ?? []).filter((usage) => usage !== "internal_only"),
        "resume",
        "interview",
      ]),
    );
    const response = await fetchJson(`/api/evidence/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        action === "edit"
          ? { action, ...patch }
          : action === "mark_external_safe"
            ? {
                action: "edit",
                publicSafeSummary: patch.publicSafeSummary ?? item.public_safe_summary ?? item.text,
                sensitivityLevel: "public_safe",
                allowedUsage: patch.allowedUsage ?? externalAllowedUsage,
                relatedProjectId: patch.relatedProjectId,
                relatedWorkExperienceId: patch.relatedWorkExperienceId,
                relatedInitiativeId: patch.relatedInitiativeId,
                relatedPortfolioProjectId: patch.relatedPortfolioProjectId,
              }
            : action === "approve_for_resume"
              ? { action, allowedUsage: item.allowed_usage ?? [] }
              : { action },
      ),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      const message = payload?.error ?? "Failed to update evidence.";
      setError(message);
      return { ok: false, message };
    }
    setResult(null);
    await refreshLibraryAfterMutation();
    const message = formatEvidenceActionMessage(action);
    setStatus(message);
    return { ok: true, message };
  }

  async function updateStoryAssignment(
    target: StoryEnrichmentTarget,
    patch: StoryAssignmentPatch,
  ): Promise<{ ok: boolean; message: string }> {
    if (target.targetType !== "initiative") {
      return { ok: false, message: "Only work initiatives can be assigned to a role." };
    }
    const response = await fetchJson(`/api/story-targets/${target.targetId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const payload = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    if (!response.ok) {
      const message = payload?.error ?? "Could not update story assignment.";
      setError(message);
      return { ok: false, message };
    }
    await refreshLibraryAfterMutation();
    const message =
      patch.action === "create_work_experience_and_assign"
        ? "Created role and assigned initiative."
        : patch.workExperienceId
          ? "Assigned initiative to selected role."
          : "Kept initiative as standalone.";
    setStatus(message);
    return { ok: true, message };
  }

  async function updateEnrichmentTask(
    taskId: string,
    payload: EnrichmentTaskUpdatePayload,
  ): Promise<{ ok: boolean; message: string }> {
    const response = await fetchJson(`/api/enrichment-tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = (await response.json().catch(() => null)) as
      | { data?: { status: string }; error?: string }
      | null;
    if (!response.ok) {
      const message = body?.error ?? "Failed to update enrichment task.";
      setError(message);
      return { ok: false, message };
    }
    await refreshLibraryAfterMutation();
    const task = enrichmentTasks.find((item) => item.id === taskId) ?? null;
    const message =
      payload.action === "answer"
        ? task && isProfileContextTask(task)
          ? "Saved profile answer."
          : "Saved answer and prepared a suggested update."
        : payload.action === "acknowledge"
          ? "Confirmed import note."
        : payload.action === "mark_import_reviewed"
          ? "Marked imported material reviewed."
        : payload.action === "request_rerun"
          ? "Marked this import for rerun."
        : payload.action === "convert_to_enrichment_question"
          ? "Converted note to an enrichment question."
        : payload.action === "link"
          ? "Updated destination and regenerated a suggested update."
        : payload.action === "accept_proposal"
          ? "Accepted update and saved draft evidence."
        : payload.action === "reject_proposal"
          ? "Rejected suggested update."
        : payload.action === "revise_proposal"
          ? "Updated suggested draft evidence."
        : payload.action === "convert"
          ? "Saved draft evidence. Next: review wording, then approve for resume use."
        : payload.action === "dismiss"
          ? "Dismissed enrichment task."
          : "Reopened enrichment task.";
    setStatus(message);
    return { ok: true, message };
  }

  async function mergeEvidenceCandidate(candidate: DedupeCandidate) {
    const confirmed = window.confirm(
      "Merge this possible overlap into the kept item? Only do this when both items describe the same claim. Resume claims linked to either item may need another check.",
    );
    if (!confirmed) return;
    const response = await fetchJson("/api/evidence/dedupe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        primaryEvidenceId: candidate.primary.id,
        duplicateEvidenceId: candidate.duplicate.id,
      }),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setError(payload?.error ?? "Failed to merge evidence.");
      return;
    }
    setResult(null);
    setStatus("Merged possible overlap into the kept evidence item.");
    void refreshLibraryAfterMutation();
  }

  async function keepEvidenceCandidateSeparate(candidate: DedupeCandidate) {
    const response = await fetchJson("/api/evidence/dedupe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "keep_separate",
        primaryEvidenceId: candidate.primary.id,
        duplicateEvidenceId: candidate.duplicate.id,
      }),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setError(payload?.error ?? "Failed to keep evidence separate.");
      return;
    }
    setResult(null);
    setStatus("Marked this evidence overlap as separate claims.");
    await refreshLibraryAfterMutation();
  }

  async function keepStoryCandidateSeparate(candidate: StoryDedupeCandidate) {
    const response = await fetchJson("/api/story-targets/dedupe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "keep_separate",
        storyType: candidate.primary.storyType,
        primaryStoryId: candidate.primary.id,
        duplicateStoryIds: candidate.duplicateStoryIds,
      }),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      const message = payload?.error ?? "Failed to keep story targets separate.";
      setError(message);
      throw new Error(message);
    }
    setResult(null);
    setStatus("Marked this story overlap as separate targets.");
    await refreshLibraryAfterMutation();
  }

  async function mergeStoryCandidate(candidate: StoryDedupeCandidate) {
    const confirmed = window.confirm(
      "Merge these story targets into the kept story? Linked evidence will move to the kept story, and duplicate stories will leave the active list.",
    );
    if (!confirmed) return;
    const response = await fetchJson("/api/story-targets/dedupe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "merge",
        storyType: candidate.primary.storyType,
        primaryStoryId: candidate.primary.id,
        duplicateStoryIds: candidate.duplicateStoryIds,
      }),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      const message = payload?.error ?? "Failed to merge story targets.";
      setError(message);
      throw new Error(message);
    }
    setResult(null);
    setStatus("Merged duplicate stories into the kept story.");
    await refreshLibraryAfterMutation();
  }

  async function mergeStoryTargetsManually(primaryStoryId: string, duplicateStoryId: string) {
    const confirmed = window.confirm(
      "Merge the selected story into this story? Linked evidence will move to this story, and the duplicate will leave the active list.",
    );
    if (!confirmed) return { ok: false, message: "Merge cancelled." };
    const response = await fetchJson("/api/story-targets/dedupe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "merge",
        storyType: "initiative",
        primaryStoryId,
        duplicateStoryIds: [duplicateStoryId],
      }),
    });
    const payload = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    if (!response.ok) {
      const message = payload?.error ?? "Failed to merge stories.";
      setError(message);
      return { ok: false, message };
    }
    setResult(null);
    setStatus("Merged story and moved linked evidence.");
    await refreshLibraryAfterMutation();
    return { ok: true, message: "Merged story and moved linked evidence." };
  }

  async function updateProject(
    project: {
      id?: string;
      title: string;
      role: string | null;
      public_safe_summary?: string | null;
    },
    action:
      | "approve"
      | "reject"
      | "edit"
      | "mark_external_safe"
      | "approve_project_evidence_for_resume",
  ) {
    if (!project.id) return;
    const nextTitle =
      action === "edit" ? window.prompt("Edit project title", project.title) : null;
    if (action === "edit" && !nextTitle?.trim()) return;
    const nextSummary =
      action === "mark_external_safe"
        ? window.prompt(
            "External-safe project summary",
            project.public_safe_summary ?? project.title,
          )
        : null;
    if (action === "mark_external_safe" && !nextSummary?.trim()) return;
    const response = await fetchJson(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        action === "edit"
          ? { action, title: nextTitle }
          : action === "mark_external_safe"
            ? {
                action: "edit",
                publicSafeSummary: nextSummary,
                sensitivityLevel: "public_safe",
              }
            : { action },
      ),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setError(payload?.error ?? "Failed to update project card.");
      return;
    }
    setResult(null);
    void refreshLibraryAfterMutation();
  }

  return (
    <section className="material-workspace">
      <div
        className="workspace-tabs material-workspace__tabs"
        role="tablist"
        aria-label="Evidence Library sections"
      >
        <button
          data-active={activeSection === "review"}
          type="button"
          onClick={() => setActiveSection("review")}
        >
          Review Material
        </button>
        <button
          data-active={activeSection === "intake"}
          type="button"
          onClick={() => setActiveSection("intake")}
        >
          Add Material
        </button>
      </div>

      {activeSection === "intake" ? (
        <div className="panel">
          <div className="panel__header">
            <div>
              <h2 className="panel__title">Add Material</h2>
              <p className="panel__note">
                {activeProfileGap
                  ? "Add missing profile facts directly without turning them into work stories."
                  : entryGuidance.summary}
              </p>
            </div>
          </div>
          <IntakeStageHeader
            activeIntent={selectedEntryIntent}
            isChoosingMaterialType={showMaterialTypePicker}
            profileGap={activeProfileGap}
            onChangeMaterialType={() => {
              setHasChosenMaterialType(false);
              setIsEditingMaterialType(true);
            }}
            onReviewMaterial={() => setActiveSection("review")}
            onShowSource={() => setIsEditingMaterialType(false)}
            projectFormState={projectFormState}
            sourceFormState={sourceFormState}
          />
          {showMaterialTypePicker ? (
            <section className="material-type-picker" aria-labelledby="material-type-picker-title">
              <div className="material-type-picker__header">
                <span>Step 1</span>
                <div>
                  <h3 id="material-type-picker-title">Choose material type</h3>
                  <p>Select the source you want to add. This controls the form below.</p>
                </div>
              </div>
              <OnboardingPaths
                activeIntent={selectedEntryIntent}
                onSelect={selectEntryIntent}
              />
            </section>
          ) : (
            <MaterialSelectionSummary
              activeIntent={selectedEntryIntent}
              onChangeType={() => {
                setHasChosenMaterialType(false);
                setIsEditingMaterialType(true);
              }}
              profileGap={activeProfileGap}
              selectedResume={selectedResumeSource}
              sourceTitle={
                selectedEntryIntent === "scratch"
                  ? projectNoteTitle
                  : sourceTitle
              }
            />
          )}
          {!showMaterialTypePicker && selectedEntryIntent !== "scratch" ? (
            <section className="source-active-form">
              {selectedEntryIntent === "resume" ? (
                <>
                  <ResumeSourcePicker
                    isLoading={selectedResumeSourceLoading}
                    onOpenResumeReview={() => {
                      window.location.hash = "resume-review";
                    }}
                    onSelect={(resumeSourceVersionId) => {
                      clearSharedFileState();
                      setSelectedResumeSourceId(resumeSourceVersionId);
                      setResumeSourceEditable(false);
                      void loadResumeSourceIntoIntake(resumeSourceVersionId);
                    }}
                    resumes={resumeSources}
                    selectedId={selectedResumeSourceId}
                  />
                  {resumeSources.length > 0 ? (
                    <ResumeReviewUploadRedirect
                      onOpenResumeReview={() => {
                        window.location.hash = "resume-review";
                      }}
                    />
                  ) : null}
                </>
              ) : (
                <div className="source-controls">
                  <label className="source-field">
                    <span>{entryGuidance.primaryTitleLabel}</span>
                    <input
                      className="source-input"
                      type="text"
                      value={sourceTitle}
                      onChange={(event) => updateActiveSourceDraft({ title: event.target.value })}
                    />
                  </label>
                  <label className="file-import">
                    <span>{entryGuidance.fileImportLabel}</span>
                    <input
                      accept=".pdf,.docx,.txt,.md,.markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
                      type="file"
                      onChange={(event) => {
                        void importResumeFile(event.target.files?.[0] ?? null);
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>
                </div>
              )}
              {fileStatus ? <p className="source-status">{fileStatus}</p> : null}
              {fileProcessing ? (
                <FileProcessingNotice
                  elapsedSeconds={fileProcessingElapsedSeconds}
                  processing={fileProcessing}
                />
              ) : null}
              {parseCard ? <SourceParseStatusCard card={parseCard} /> : null}
              <label className="source-field source-field--textarea">
                <span>{selectedEntryIntent === "jd" ? "JD gap source text" : "Resume extraction copy"}</span>
                <small>
                  {selectedEntryIntent === "jd"
                    ? "Paste evidence-gap notes from a JD review, or route to Jobs for full JD analysis later."
                    : resumeSourceEditable
                      ? "Editing this copy affects this extraction only. The original Resume Review version stays unchanged."
                      : "Locked to the reviewed resume. Edit a copy only when parsing or review text needs correction before extraction."}
                </small>
                <textarea
                  aria-label="Resume or career source text"
                  className="jd-input jd-input--compact"
                  placeholder={
                    selectedEntryIntent === "jd"
                      ? "Paste JD gap notes or missing-evidence prompts here..."
                      : "Select a reviewed resume version from Resume Review..."
                  }
                  readOnly={selectedEntryIntent === "resume" && !resumeSourceEditable}
                  value={sourceText}
                  onChange={(event) => {
                    if (selectedEntryIntent === "resume" && !resumeSourceEditable) return;
                    updateActiveSourceDraft({
                      sourceDocumentId: undefined,
                      text: event.target.value,
                    });
                    clearSharedFileState();
                  }}
                  spellCheck={false}
                />
              </label>
              {selectedEntryIntent === "resume" ? (
                <div className="source-copy-controls">
                  <div>
                    <strong>
                      {resumeSourceEditable ? "Extraction copy is editable" : "Using reviewed resume source"}
                    </strong>
                    <p>
                      {resumeSourceEditable
                        ? "Create Library Items will use this edited text and keep the reviewed resume intact."
                        : "Use the reviewed source as-is, or edit a copy if the parsed text needs cleanup before extraction."}
                    </p>
                  </div>
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() => {
                      if (!resumeSourceEditable) {
                        setResumeSourceEditable(true);
                        updateActiveSourceDraft({ sourceDocumentId: undefined });
                        setStatus("Editing extraction copy. Original reviewed resume stays unchanged.");
                      } else {
                        if (selectedResumeSourceId) {
                          void loadResumeSourceIntoIntake(selectedResumeSourceId);
                        }
                        setStatus("Restored reviewed resume source.");
                      }
                    }}
                  >
                    {resumeSourceEditable ? "Reset to reviewed source" : "Edit extraction copy"}
                  </button>
                </div>
              ) : null}
              <div className="actions">
                <button
                  className="primary-button"
                  disabled={isExtracting || sourceFormState !== "ready"}
                  type="button"
                  onClick={runExtraction}
                >
                  {isExtracting ? "Processing..." : entryGuidance.primaryActionLabel}
                </button>
                <span className={error ? "status status--error" : "status"}>
                  {error ?? status}
                </span>
              </div>
              <FormStatePill state={sourceFormState} />
              <p className="source-status">{entryGuidance.primaryHint}</p>
              {isExtracting ? (
                <ProgressNotice
                  elapsedSeconds={extractElapsedSeconds}
                  label="Adding material to library"
                  mode="evidence"
                />
              ) : null}
            </section>
          ) : null}

          {!showMaterialTypePicker && selectedEntryIntent === "scratch" ? (
            activeProfileGap ? (
              <ProfileFactSourceForm
                error={error}
                field={activeProfileGap.field}
                isRunning={isProjectEnriching}
                onRun={runProjectEnrichment}
                onTextChange={(value) => {
                  setProjectNoteText(value);
                  setProjectSourceDocumentId(undefined);
                  setGuidedPreviewState("edited");
                }}
                projectFormState={projectFormState}
                sourceText={projectNoteText}
                status={status}
              />
            ) : (
              <section className="section-block section-block--builder source-active-form">
                <h3>Work Story Builder</h3>
                <p className="panel__note">
                  {entryGuidance.enrichmentHint}
                </p>
                <ProjectSourceModePicker
                  activeMode={projectSourceMode}
                  onSelect={selectProjectSourceMode}
                />
                {selectedStoryTarget ? (
                  <section className="guided-target-card">
                    <span>Target-aware enrichment</span>
                    <strong>{selectedStoryTarget.targetTitle}</strong>
                    <p>
                      Guided answers will be saved as source material and linked back to this{" "}
                      {selectedStoryTarget.targetType.replace(/_/g, " ")} when extracted evidence is safe to associate.
                    </p>
                    {selectedStoryTarget.missingFields?.length ? (
                      <small>Missing: {selectedStoryTarget.missingFields.join(", ")}</small>
                    ) : null}
                  </section>
                ) : null}
                <div className="source-controls">
                  <label className="source-field">
                    <span>Work story title</span>
                    <input
                      className="source-input"
                      type="text"
                      value={projectNoteTitle}
                      onChange={(event) => setProjectNoteTitle(event.target.value)}
                    />
                  </label>
                  {projectSourceMode === "upload" ? (
                    <label className="file-import">
                      <span>Import project files</span>
                      <input
                        accept=".pdf,.docx,.txt,.md,.markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
                        multiple
                        type="file"
                        onChange={(event) => {
                          void importProjectNoteFiles(event.target.files);
                          event.currentTarget.value = "";
                        }}
                      />
                    </label>
                  ) : null}
                </div>
                {fileStatus ? <p className="source-status">{fileStatus}</p> : null}
                {fileProcessing ? (
                  <FileProcessingNotice
                    elapsedSeconds={fileProcessingElapsedSeconds}
                    processing={fileProcessing}
                  />
                ) : null}
                {parseCard ? <SourceParseStatusCard card={parseCard} /> : null}
                {projectSourceMode === "guided" ? (
                  <GuidedMaterialBuilder
                    fields={guidedMaterialFields}
                    onChange={(fields) => {
                      setGuidedMaterialFields(fields);
                      setProjectSourceDocumentId(undefined);
                      if (guidedPreviewState === "synced") {
                        setProjectNoteText(buildGuidedPreview(fields));
                      } else {
                        setGuidedPreviewState("stale");
                      }
                      if (!projectNoteTitle.trim() && fields.projectOrInitiativeTitle.trim()) {
                        setProjectNoteTitle(`${fields.projectOrInitiativeTitle.trim()} guided material`);
                      }
                    }}
                    onSyncPreview={() => syncGuidedPreview()}
                    syncState={guidedPreviewState}
                  />
                ) : null}
                <label className="source-field source-field--textarea">
                  <span>{projectSourceMode === "guided" ? "Generated source preview" : "Work story material"}</span>
                  <small>
                    {projectSourceMode === "guided"
                      ? guidedPreviewState === "stale"
                        ? "Guided answers changed after manual edits. Update the preview when you want to replace it with the structured answers."
                        : guidedPreviewState === "edited"
                          ? "This preview has manual edits and will be sent to extraction as written."
                          : "Guided answers sync here as the final material sent to extraction. Edit only if you want to adjust the source wording."
                      : projectSourceMode === "upload"
                        ? "Imported files append here. Edit or combine the parsed material before adding it."
                        : "Paste project notes, work summaries, performance review excerpts, or STAR notes here."}
                  </small>
                  <textarea
                    aria-label="Project note source text"
                    className="jd-input jd-input--compact"
                    placeholder="Paste project notes, design docs, project summaries, performance review excerpts, or guided STAR notes here..."
                    value={projectNoteText}
                    onChange={(event) => {
                      setProjectNoteText(event.target.value);
                      setProjectSourceDocumentId(undefined);
                      if (projectSourceMode !== "guided") {
                        clearSharedFileState();
                      }
                      if (projectSourceMode === "guided") {
                        setGuidedPreviewState("edited");
                      }
                    }}
                    spellCheck={false}
                  />
                </label>
                <div className="actions">
                  <button
                    className="primary-button"
                    disabled={isProjectEnriching || !projectNoteIsReady}
                    type="button"
                    onClick={runProjectEnrichment}
                  >
                    {isProjectEnriching
                      ? "Adding..."
                      : selectedStoryTarget
                        ? "Strengthen selected story"
                        : "Add material to library"}
                  </button>
                  <span className="status">
                    {projectSourceMode === "guided" && !projectNoteIsReady
                      ? guidedReadiness.missingReason ?? "Add real guided answers before continuing."
                      : status}
                  </span>
                </div>
                <FormStatePill state={projectFormState} />
                {isProjectEnriching ? (
                  <ProgressNotice
                    elapsedSeconds={projectElapsedSeconds}
                    label="Adding work story material"
                    mode="project"
                  />
                ) : null}
              </section>
            )
          ) : !showMaterialTypePicker && selectedEntryIntent === "resume" ? (
            <section className="source-path-handoff">
              <div>
                <span>Story context comes next</span>
                <p>
                  After adding this material, Review Material will show whether claims need approval or stories need more context.
                </p>
              </div>
              <button type="button" onClick={() => selectEntryIntent("scratch")}>
                Add work notes
              </button>
            </section>
          ) : !showMaterialTypePicker ? (
            <section className="source-path-handoff" data-secondary="true">
              <div>
                <span>JD-first is secondary during resume prep</span>
                <p>
                  Use this only for evidence-gap notes. Full JD analysis belongs in Jobs once resume evidence is ready.
                </p>
              </div>
              <button type="button" onClick={() => selectEntryIntent("resume")}>
                Back to resume intake
              </button>
            </section>
          ) : null}
        </div>
      ) : null}

      {activeSection === "review" ? (
        <div className="panel material-review-panel">
          <div className="panel__header">
            <div>
              <h2 className="panel__title">Review Material</h2>
              <p className="panel__note">
                See what is ready, what needs answers, and what blocks resume export.
              </p>
            </div>
            <button
              className="secondary-button"
              type="button"
              onClick={openGenericSourceIntake}
            >
              Add source
            </button>
          </div>
          {lastIntakeSummary ? (
            <ReviewHandoffNotice
              summary={lastIntakeSummary}
              onDismiss={() => setLastIntakeSummary(null)}
              onReturnToIntake={() => setActiveSection("intake")}
            />
          ) : null}
          <LibraryOverviewSummary
            extraction={profile ? result : null}
            library={library}
            summary={libraryReadiness}
          />
          <RetrievalExplanationPanel
            evidence={retrievalPreview.evidence}
            onJumpToSourceMaterial={jumpToSourceMaterial}
            sourceMaterial={retrievalPreview.sourceMaterial}
            title="Retrieval explanation"
          />
          <div className="library-mode-switcher" role="tablist" aria-label="Evidence Library mode">
            <button
              data-active={libraryMode === "library"}
              type="button"
              onClick={() => setLibraryMode("library")}
            >
              Library
            </button>
            <button
              data-active={libraryMode === "work_queue"}
              type="button"
              onClick={() => setLibraryMode("work_queue")}
            >
              Work Queue
            </button>
          </div>

          {libraryMode === "library" ? (
            <>
              <EvidenceLibraryToolbar
                filters={safeLibraryFilters}
                onChange={setLibraryFilters}
                options={toolbarOptions}
              />
              <div className="review-switcher review-switcher--library" role="tablist" aria-label="Library asset views">
                <button
                  data-active={libraryView === "all"}
                  type="button"
                  onClick={() => openLibraryAssetView("all")}
                >
                  All Evidence ({allEvidenceItems.length})
                </button>
                <button
                  data-active={libraryView === "stories"}
                  type="button"
                  onClick={() => openLibraryAssetView("stories")}
                >
                  Stories ({workExperiences.length} roles · {initiatives.length + portfolioProjects.length})
                </button>
                <button
                  data-active={libraryView === "interview_stories"}
                  type="button"
                  onClick={() => openLibraryAssetView("interview_stories")}
                >
                  Interview Stories ({starStories.length})
                </button>
              </div>
              {libraryView === "all" ? (
                <EvidenceList
                  description="Browse reviewed library material. Use filters to find resume-ready, interview-ready, or approved evidence."
                  emptyMessage="No evidence matches the current library filters."
                  items={allEvidenceItems}
                  mode="library"
                  onUpdate={updateEvidence}
                  projects={projectCards}
                  linkTargets={linkTargets}
                  title="All Evidence"
                />
              ) : null}
              {libraryView === "stories" ? (
                <StoryMaterialList
                  evidenceItems={evidenceItems}
                  initiatives={initiatives}
                  onMergeStory={mergeStoryTargetsManually}
                  onAssignStory={updateStoryAssignment}
                  onEnrichStory={startProjectEnrichment}
                  onReviewClaims={reviewClaimsForStory}
                  onReviewStarStory={reviewStarStoryForStory}
                  portfolioProjects={portfolioProjects}
                  workExperiences={workExperiences}
                />
              ) : null}
              {libraryView === "interview_stories" ? (
                <StarStoryPanel
                  focus={starStoryFocus}
                  onImproveStory={startProjectEnrichment}
                  stories={starStories}
                  onRefresh={() => void loadStarStories()}
                />
              ) : null}
            </>
          ) : null}

          {libraryMode === "work_queue" ? (
            <>
          <div className="review-switcher review-switcher--queue" role="tablist" aria-label="Work Queue panels">
            <button
              data-active={workQueueView === "enrichment"}
              type="button"
              onClick={() => openWorkQueueView("enrichment")}
            >
              Improve Evidence ({answerEnrichmentTasks.length})
            </button>
            <button
              data-active={workQueueView === "imported"}
              type="button"
              onClick={() => openWorkQueueView("imported")}
            >
              Imported Material ({importedMaterialTasks.length})
            </button>
            <button
              data-active={workQueueView === "claims"}
              type="button"
              onClick={() => {
                setEvidenceFocus(null);
                openWorkQueueView("claims");
              }}
            >
              Evidence Review ({claimReviewEvidenceItems.length})
            </button>
            <button
              data-active={workQueueView === "unlinked"}
              type="button"
              onClick={() => {
                setEvidenceFocus(null);
                openWorkQueueView("unlinked");
              }}
            >
              {evidenceFocus ? "Focused" : "Unlinked"} ({focusedEvidenceItems.length})
            </button>
            <button
              data-active={workQueueView === "cleanup"}
              type="button"
              onClick={() => openWorkQueueView("cleanup")}
            >
              Cleanup ({storyDedupeCandidates.length + dedupeCandidates.length})
            </button>
          </div>
          {workQueueView === "enrichment" ? (
            <EnrichmentTaskQueue
              evidenceItems={evidenceItems}
              focusedTaskId={initialFocusedTaskId}
              initiatives={initiatives}
              linkTargets={linkTargets}
              onCreateLibraryItems={openCreateLibraryItemsForTask}
              onOpenProfileFact={openProfileFactFromImportedNote}
              onRefresh={() => refreshLibraryAfterMutation()}
              onReviewImportedMaterial={() => openLibraryAssetView("stories")}
              onReturnToIntake={() => setActiveSection("intake")}
              onUpdate={updateEnrichmentTask}
              portfolioProjects={portfolioProjects}
              queueStatus={enrichmentTaskQueueStatus}
              tasks={answerEnrichmentTasks}
              variant="questions"
              workExperiences={workExperiences}
            />
          ) : null}
          {workQueueView === "imported" ? (
            <EnrichmentTaskQueue
              evidenceItems={evidenceItems}
              focusedTaskId={initialFocusedTaskId}
              initiatives={initiatives}
              linkTargets={linkTargets}
              onCreateLibraryItems={openCreateLibraryItemsForTask}
              onOpenProfileFact={openProfileFactFromImportedNote}
              onRefresh={() => refreshLibraryAfterMutation()}
              onReviewImportedMaterial={() => openLibraryAssetView("stories")}
              onReturnToIntake={() => setActiveSection("intake")}
              onUpdate={updateEnrichmentTask}
              portfolioProjects={portfolioProjects}
              queueStatus={enrichmentTaskQueueStatus}
              tasks={importedMaterialTasks}
              variant="imported"
              workExperiences={workExperiences}
            />
          ) : null}
          {workQueueView === "claims" ? (
            <>
            {evidenceFocus ? (
              <section className="focused-claims-banner">
                <div>
                  <span>Story claims focus</span>
                  <strong>{evidenceFocus.title}</strong>
                  <p>Review claims linked to this story target, then approve, edit, or mark public-safe as needed.</p>
                </div>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setEvidenceFocus(null)}
                >
                  Show all claims
                </button>
              </section>
            ) : null}
            <EvidenceList
              description={
                evidenceFocus
                  ? "These claims are already linked to the selected story target. Review truth, sensitivity, public-safe wording, and resume usage."
                  : "Approve evidence, review safe wording, and choose whether it can support generated resumes."
              }
              emptyMessage={
                evidenceFocus
                  ? "No claims are linked to this story target yet. Use Enrich story to add source context."
                  : "All current evidence claims are approved and resume-ready."
              }
              items={evidenceFocus ? focusedEvidenceItems : claimReviewEvidenceItems}
              mode="review"
              onUpdate={updateEvidence}
              projects={projectCards}
              linkTargets={linkTargets}
              title={evidenceFocus ? "Claims for " + evidenceFocus.title : "Evidence Review"}
            />
            </>
          ) : null}
          {workQueueView === "unlinked" ? (
            <>
            {evidenceFocus ? (
              <section className="focused-claims-banner">
                <div>
                  <span>Story claims focus</span>
                  <strong>{evidenceFocus.title}</strong>
                  <p>Review claims linked to this story target, then approve, edit, or mark public-safe as needed.</p>
                </div>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setEvidenceFocus(null)}
                >
                  Show unlinked only
                </button>
              </section>
            ) : null}
            <EvidenceList
              description={
                evidenceFocus
                  ? "These claims are already linked to the selected story target. Review truth, sensitivity, public-safe wording, and resume usage."
                  : "These evidence claims are not attached to a work experience, initiative, or portfolio project yet. Link them to a story target or keep them as standalone profile facts."
              }
              emptyMessage={
                evidenceFocus
                  ? "No claims are linked to this story target yet. Use Enrich story to add source context."
                  : "All current evidence is attached to story targets."
              }
              items={focusedEvidenceItems}
              mode="review"
              onUpdate={updateEvidence}
              projects={projectCards}
              linkTargets={linkTargets}
              title={evidenceFocus ? `Claims for ${evidenceFocus.title}` : "Unlinked Evidence Claims"}
            />
            </>
          ) : null}
          {workQueueView === "cleanup" ? (
            <DedupePanel
              evidenceCandidates={dedupeCandidates}
              onEvidenceKeepSeparate={keepEvidenceCandidateSeparate}
              onEvidenceMerge={mergeEvidenceCandidate}
              onStoryKeepSeparate={keepStoryCandidateSeparate}
              onStoryMerge={mergeStoryCandidate}
              onRefresh={() => void refreshLibraryAfterMutation()}
              storyCandidates={storyDedupeCandidates}
            />
          ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function FileProcessingNotice({
  elapsedSeconds,
  processing,
}: {
  elapsedSeconds: number;
  processing: FileProcessingState;
}) {
  const stages = getFileProcessingStages(processing.mode, processing.fileCount ?? 1);
  const activeIndex = Math.min(stages.length - 1, Math.floor(elapsedSeconds / 5));
  const activeStage = stages[activeIndex]!;
  return (
    <div className="file-processing-notice" role="status" aria-live="polite">
      <div className="file-processing-notice__top">
        <div>
          <span>Processing file</span>
          <strong>{processing.filename}</strong>
        </div>
        <span>{elapsedSeconds || 1}s</span>
      </div>
      <p>
        {activeStage.detail}
        {elapsedSeconds >= 25
          ? " Larger DOCX/PDF files can take a little longer while text is extracted and reviewed."
          : ""}
      </p>
      <ol className="file-processing-steps" aria-label="File processing stages">
        {stages.map((stage, index) => (
          <li
            data-active={index === activeIndex}
            data-complete={index < activeIndex}
            key={stage.label}
          >
            <span>{index + 1}</span>
            <div>
              <strong>{stage.label}</strong>
              <small>{stage.summary}</small>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function getFileProcessingStages(
  mode: FileProcessingState["mode"],
  fileCount: number,
) {
  if (mode === "resume-review") {
    return [
      {
        label: "Upload file",
        summary: "Send the selected resume to the review service.",
        detail: "Uploading the file and checking that the format is supported.",
      },
      {
        label: "Extract text",
        summary: "Read the DOCX/PDF text layer and parser warnings.",
        detail: "Extracting readable resume text, page metadata, and parser quality signals.",
      },
      {
        label: "Review resume",
        summary: "Score the resume and create recruiter-style findings.",
        detail: "Running the resume review skill to identify strengths, fixes, gaps, and ATS notes.",
      },
      {
        label: "Load source",
        summary: "Save the reviewed version and load editable source text.",
        detail: "Saving the reviewed resume version and loading it back into this workspace.",
      },
    ];
  }
  if (mode === "project-import") {
    return [
      {
        label: fileCount > 1 ? "Read files" : "Read file",
        summary:
          fileCount > 1
            ? `Prepare ${fileCount} project source files.`
            : "Prepare the selected project source file.",
        detail:
          fileCount > 1
            ? `Reading ${fileCount} project files and checking their formats.`
            : "Reading the project file and checking that it has usable text.",
      },
      {
        label: "Extract text",
        summary: "Parse DOCX/PDF/text content into source material.",
        detail: "Extracting project notes, parser warnings, and document quality metadata.",
      },
      {
        label: "Preserve source",
        summary: "Keep a trace back to the original file.",
        detail: "Preparing the source link so draft evidence can trace back to this file.",
      },
      {
        label: "Prepare draft",
        summary: "Load work-story text for library extraction.",
        detail: "Loading the parsed material into the Work Story Builder for review before extraction.",
      },
    ];
  }
  return [
    {
      label: "Upload source",
      summary: "Send the selected file for reading.",
      detail: "Uploading the source file and validating the file type.",
    },
    {
      label: "Extract text",
      summary: "Read the document text and quality notes.",
      detail: "Extracting text, word count, and document quality notes.",
    },
    {
      label: "Store source",
      summary: "Save the source for later review.",
      detail: "Saving the parsed source so later evidence can trace back to the original file.",
    },
    {
      label: "Load editor",
      summary: "Fill the source editor with parsed text.",
      detail: "Loading the parsed material into the editor for review before extraction.",
    },
  ];
}

function ProgressNotice({
  elapsedSeconds,
  label,
  mode,
}: {
  elapsedSeconds: number;
  label: string;
  mode: "evidence" | "project";
}) {
  const progress = Math.min(92, 18 + elapsedSeconds * 2);
  const stages = getProgressStages(mode);
  const activeIndex = Math.min(
    elapsedSeconds < 8 ? 0 : elapsedSeconds < 22 ? 1 : elapsedSeconds < 40 ? 2 : 3,
    stages.length - 1,
  );
  const activeStage = stages[activeIndex]!;
  return (
    <div className="progress-notice" role="status" aria-live="polite">
      <div className="progress-notice__top">
        <strong>{label}</strong>
        <span>{elapsedSeconds}s</span>
      </div>
      <div className="progress-bar" aria-hidden="true">
        <span style={{ width: `${progress}%` }} />
      </div>
      <p>
        {activeStage.detail}
        {elapsedSeconds >= 40 ? " Longer sources can take about a minute." : ""}
      </p>
      <ol className="progress-stages" aria-label="Current extraction stages">
        {stages.map((stage, index) => (
          <li
            data-active={index === activeIndex}
            data-complete={index < activeIndex}
            key={stage.label}
          >
            <span>{index + 1}</span>
            <div>
              <strong>{stage.label}</strong>
              <small>{stage.summary}</small>
            </div>
          </li>
        ))}
      </ol>
      <p>Keep this page open; the library will switch to review mode when this finishes.</p>
    </div>
  );
}

function getProgressStages(mode: "evidence" | "project") {
  if (mode === "project") {
    return [
      {
        label: "Read project note",
        summary: "Normalize the pasted project source.",
        detail: "Reading the project note and preparing reusable career signals.",
      },
      {
        label: "Extract project evidence",
        summary: "Identify claims, impact, tools, and scope.",
        detail: "Finding grounded project claims, impact signals, and missing proof points.",
      },
      {
        label: "Build project card",
        summary: "Create a story container for resume/interview use.",
        detail: "Organizing the project into a reusable card and linking supporting evidence.",
      },
      {
        label: "Save and refresh",
        summary: "Save results and prepare cleanup checks.",
        detail: "Saving project material, refreshing the library, and checking possible overlaps.",
      },
    ];
  }
  return [
    {
      label: "Read source",
      summary: "Use the selected reviewed resume or added source text.",
      detail: "Reading the source and preparing it for evidence extraction.",
    },
    {
      label: "Find useful details",
      summary: "Find profile facts, evidence claims, and project drafts.",
      detail: "Finding profile facts, reusable claims, and project drafts.",
    },
    {
      label: "Structure library items",
      summary: "Convert raw signals into reviewable cards.",
      detail: "Turning source material into Evidence Library cards with missing details and questions.",
    },
    {
      label: "Save and review",
      summary: "Save results and surface possible overlaps.",
      detail: "Saving library items, refreshing review tabs, and preparing possible-overlap cleanup.",
    },
  ];
}

function ReviewHandoffNotice({
  onDismiss,
  onReturnToIntake,
  summary,
}: {
  onDismiss: () => void;
  onReturnToIntake: () => void;
  summary: {
    evidenceCount: number;
    projectCount: number;
    storyCount: number;
    workExperienceCount: number;
    sourceTitle: string;
    type: "resume" | "project";
  };
}) {
  const sourceType = summary.type === "resume" ? "source" : "project source";
  return (
    <section className="review-handoff" aria-live="polite">
      <div>
        <span>New material ready for review</span>
        <p>
          {summary.sourceTitle} created {summary.evidenceCount} evidence claim
          {summary.evidenceCount === 1 ? "" : "s"}, {summary.workExperienceCount} work
          experience{summary.workExperienceCount === 1 ? "" : "s"}, and{" "}
          {summary.storyCount} story target{summary.storyCount === 1 ? "" : "s"}.
          Review the material below, then enrich thin stories with more {sourceType}
          context if needed.
        </p>
      </div>
      <div className="actions actions--compact">
        <button className="secondary-button" type="button" onClick={onReturnToIntake}>
          Add more context
        </button>
        <button className="secondary-button" type="button" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </section>
  );
}

function OnboardingPaths({
  activeIntent,
  onSelect,
}: {
  activeIntent: MaterialEntryIntent;
  onSelect: (intent: MaterialEntryIntent) => void;
}) {
  const paths = [
    {
      ariaLabel: "Use reviewed resume path",
      intent: "resume" as const,
      title: "Use a reviewed resume",
      body:
        "Turn a reviewed resume into reusable material. This does not replace the Resume Review report.",
      steps: "Resume review -> reusable material -> main resume",
    },
    {
      ariaLabel: "Work notes and guided answers path",
      intent: "scratch" as const,
      title: "Work notes or guided answers",
      body:
        "Add project summaries, performance notes, or guided answers to strengthen work stories.",
      steps: "Work context -> story strength -> resume-ready evidence",
    },
    {
      ariaLabel: "JD gap evidence path",
      intent: "jd" as const,
      title: "I have a JD now",
      body:
        "Use Jobs for a specific role. Missing proof becomes follow-up material to add here.",
      steps: "JD analysis -> draft -> missing proof",
    },
  ];
  return (
    <section className="onboarding-paths" aria-label="Material Library paths" role="tablist">
      {paths.map((path) => (
        <button
          aria-label={path.ariaLabel}
          aria-selected={path.intent === activeIntent}
          className="onboarding-path"
          data-active={path.intent === activeIntent}
          key={path.title}
          role="tab"
          type="button"
          onClick={() => onSelect(path.intent)}
        >
          <span>{path.title}</span>
          <p>{path.body}</p>
          <small>{path.steps}</small>
        </button>
      ))}
    </section>
  );
}

function MaterialSelectionSummary({
  activeIntent,
  onChangeType,
  profileGap,
  selectedResume,
  sourceTitle,
}: {
  activeIntent: MaterialEntryIntent;
  onChangeType: () => void;
  profileGap?: ProfileGapIntent | null;
  selectedResume: ResumeSourceSummary | null;
  sourceTitle: string;
}) {
  const sourceLabel =
    profileGap
      ? "Profile facts"
      : activeIntent === "scratch"
      ? "Work notes or guided answers"
      : activeIntent === "jd"
        ? "JD gap notes"
        : "Reviewed resume";
  const title =
    profileGap
      ? profileFactSourceCopy(profileGap.field).title
      : activeIntent === "resume" && selectedResume
      ? `v${selectedResume.version} · ${formatResumeTitle(selectedResume.title)}`
      : sourceTitle.trim() || "Source selected";
  const detail =
    profileGap
      ? "Add or correct profile facts. This is not a work story."
      : activeIntent === "resume"
      ? selectedResume?.status === "extracted"
        ? "Library items already exist for this resume. You can review or add more material below."
        : "Create library items before answering review-generated enrichment prompts."
      : activeIntent === "jd"
        ? "Use this only for evidence-gap material from a JD analysis."
        : "This source will become reusable story and evidence material.";
  return (
    <section className="material-selection-summary" aria-label="Selected material source">
      <article>
        <span>Material type</span>
        <strong>{sourceLabel}</strong>
        <p>{detail}</p>
      </article>
      <article>
        <span>Selected source</span>
        <strong>{title}</strong>
        <p>
          {profileGap
            ? "Use the form below to add or correct this profile section."
            : activeIntent === "resume" && selectedResume?.latestReview
            ? `Resume Review score ${selectedResume.latestReview.overallScore}`
            : "Edit the source below if the material is incomplete."}
        </p>
      </article>
      <button className="secondary-button" type="button" onClick={onChangeType}>
        Change material type
      </button>
    </section>
  );
}

function ResumeSourcePicker({
  isLoading,
  onOpenResumeReview,
  onSelect,
  resumes,
  selectedId,
}: {
  isLoading: boolean;
  onOpenResumeReview: () => void;
  onSelect: (resumeSourceVersionId: string) => void;
  resumes: ResumeSourceSummary[];
  selectedId: string;
}) {
  if (resumes.length === 0) {
    return (
      <section className="resume-source-picker">
        <div>
          <span>Reviewed resumes</span>
          <p>No reviewed resume versions yet. Upload and review a resume before creating reusable evidence from it.</p>
        </div>
        <button className="secondary-button" type="button" onClick={onOpenResumeReview}>
          Open Resume Review
        </button>
      </section>
    );
  }
  return (
    <section className="resume-source-picker">
      <div>
        <span>Use reviewed resume</span>
        <p>Use this reviewed resume to create draft evidence and work stories. This does not replace the Resume Review report.</p>
      </div>
      <select
        aria-label="Reviewed resume version"
        disabled={isLoading}
        value={selectedId}
        onChange={(event) => onSelect(event.target.value)}
      >
        <option value="">Select a reviewed resume version</option>
        {resumes.map((resume) => (
          <option key={resume.id} value={resume.id}>
            v{resume.version} · {formatResumeTitle(resume.title)}
            {resume.latestReview ? ` · score ${resume.latestReview.overallScore}` : ""}
            {resume.status === "extracted" ? " · extracted" : ""}
          </option>
        ))}
      </select>
    </section>
  );
}

function ResumeReviewUploadRedirect({
  onOpenResumeReview,
}: {
  onOpenResumeReview: () => void;
}) {
  return (
    <section className="source-path-handoff source-path-handoff--compact">
      <div>
        <span>Need a different resume?</span>
        <p>
          Uploading a resume here would skip the review report and blur the source lifecycle.
          Use Resume Review first, then return here to create reusable Evidence Library items.
        </p>
      </div>
      <button type="button" onClick={onOpenResumeReview}>
        Open Resume Review
      </button>
    </section>
  );
}

function ProjectSourceModePicker({
  activeMode,
  onSelect,
}: {
  activeMode: ProjectSourceMode;
  onSelect: (mode: ProjectSourceMode) => void;
}) {
  const modes: Array<{
    body: string;
    label: string;
    mode: ProjectSourceMode;
  }> = [
    {
      body: "Parse PDF, DOCX, TXT, or Markdown source files before enrichment.",
      label: "Upload files",
      mode: "upload",
    },
    {
      body: "Paste rough notes, project docs, or performance review excerpts.",
      label: "Paste notes",
      mode: "paste",
    },
    {
      body: "Answer structured prompts when you do not have prepared source docs.",
      label: "Guide me",
      mode: "guided",
    },
  ];
  return (
    <div className="project-source-modes" role="tablist" aria-label="Project source input mode">
      {modes.map((mode) => (
        <button
          aria-selected={activeMode === mode.mode}
          data-active={activeMode === mode.mode}
          key={mode.mode}
          role="tab"
          type="button"
          onClick={() => onSelect(mode.mode)}
        >
          <span>{mode.label}</span>
          <small>{mode.body}</small>
        </button>
      ))}
    </div>
  );
}

function ProfileFactSourceForm({
  error,
  field,
  isRunning,
  onRun,
  onTextChange,
  projectFormState,
  sourceText,
  status,
}: {
  error: string | null;
  field: ProfileGapIntent["field"];
  isRunning: boolean;
  onRun: () => void;
  onTextChange: (value: string) => void;
  projectFormState: LocalFormState;
  sourceText: string;
  status: string;
}) {
  const copy = profileFactSourceCopy(field);
  const canSave = Boolean(buildProfileFactPatchFromText(field, sourceText));
  return (
    <section className="profile-fact-source-form source-active-form">
      <div className="profile-fact-source-form__header">
        <div>
          <span>Profile fact editor</span>
          <h3>
            {copy.title}
            <HelpHint text={copy.description} />
          </h3>
        </div>
      </div>
      <label className="source-field source-field--textarea profile-fact-source-form__input">
        <span>
          {copy.inputLabel}
          <HelpHint text={copy.helper} />
        </span>
        <textarea
          aria-label={copy.inputLabel}
          className="jd-input jd-input--compact"
          placeholder={copy.placeholder}
          value={sourceText}
          onChange={(event) => onTextChange(event.target.value)}
          spellCheck
        />
      </label>
      <div className="profile-fact-source-form__examples" aria-label="Suggested fields">
        {copy.examples.map((example) => (
          <span key={example}>{example}</span>
        ))}
      </div>
      <div className="actions">
        <button
          className="primary-button"
          disabled={isRunning || !canSave}
          type="button"
          onClick={onRun}
        >
          {isRunning ? "Saving..." : "Save profile fact"}
        </button>
        <span className={error ? "status status--error" : "status"}>
          {error ?? status}
        </span>
      </div>
      <FormStatePill state={projectFormState} />
    </section>
  );
}

function GuidedMaterialBuilder({
  fields,
  onChange,
  onSyncPreview,
  syncState,
}: {
  fields: GuidedMaterialFields;
  onChange: (fields: GuidedMaterialFields) => void;
  onSyncPreview: () => void;
  syncState: "synced" | "edited" | "stale";
}) {
  const fieldConfig: Array<{
    key: keyof GuidedMaterialFields;
    label: string;
    placeholder: string;
    textarea?: boolean;
  }> = [
    {
      key: "projectOrInitiativeTitle",
      label: "Project / initiative",
      placeholder: "Activation dashboard redesign",
    },
    {
      key: "companyOrContext",
      label: "Company / context",
      placeholder: "B2B onboarding, growth team, school project, open-source project...",
    },
    {
      key: "roleAndTimeframe",
      label: "Role and timeframe",
      placeholder: "Product analyst, Q2-Q3 2025",
    },
    {
      key: "problem",
      label: "Problem",
      placeholder: "What problem did it solve?",
      textarea: true,
    },
    {
      key: "ownership",
      label: "My ownership",
      placeholder: "What did you personally own?",
      textarea: true,
    },
    {
      key: "actions",
      label: "Actions",
      placeholder: "What did you do? One action per line is fine.",
      textarea: true,
    },
    {
      key: "metricsBefore",
      label: "Metrics before",
      placeholder: "Baseline, before state, or unknown.",
    },
    {
      key: "metricsAfter",
      label: "Metrics after",
      placeholder: "Measured result, after state, or directional result.",
    },
    {
      key: "businessImpact",
      label: "Business impact",
      placeholder: "Revenue, activation, retention, cost, speed, quality, risk...",
      textarea: true,
    },
    {
      key: "userOrCustomerImpact",
      label: "User / customer impact",
      placeholder: "Who benefited and how?",
      textarea: true,
    },
    {
      key: "toolsAndDomainKnowledge",
      label: "Tools / domain knowledge",
      placeholder: "SQL, experimentation, LLM workflows, fintech, healthcare...",
    },
    {
      key: "difficultyOrTradeoff",
      label: "Difficulty / tradeoff",
      placeholder: "What made it hard? What did you trade off?",
      textarea: true,
    },
    {
      key: "publicSafeWording",
      label: "Public-safe wording",
      placeholder: "What can be said safely in public?",
      textarea: true,
    },
    {
      key: "confidentialDetailsToAvoid",
      label: "Confidential details to avoid",
      placeholder: "Client names, internal code names, exact private metrics...",
      textarea: true,
    },
  ];
  return (
    <section className="guided-material-builder">
      <div className="guided-material-builder__top">
        <div>
          <span>Guided Material Builder</span>
          <p>
            Answer what you know. The preview becomes source material, then JobDesk
            creates draft evidence for review.
          </p>
        </div>
        <div className="guided-sync-status" data-state={syncState} aria-live="polite">
          <i aria-hidden="true" />
          <span>
            {syncState === "synced"
              ? "Preview syncs as you type"
              : syncState === "stale"
                ? "Structured answers changed"
                : "Preview edited manually"}
          </span>
          {syncState === "stale" ? (
            <button type="button" onClick={onSyncPreview}>
              Update preview
            </button>
          ) : null}
        </div>
      </div>
      <div className="guided-material-builder__grid">
        {fieldConfig.map((field) => {
          const commonProps = {
            placeholder: field.placeholder,
            value: fields[field.key],
            onChange: (
              event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
            ) => onChange({ ...fields, [field.key]: event.target.value }),
          };
          return (
            <label
              className={field.textarea ? "source-field source-field--wide" : "source-field"}
              key={field.key}
            >
              <span>{field.label}</span>
              {field.textarea ? (
                <textarea className="source-input source-input--guided" {...commonProps} />
              ) : (
                <input className="source-input" type="text" {...commonProps} />
              )}
            </label>
          );
        })}
      </div>
    </section>
  );
}

function LibraryOverviewSummary({
  extraction,
  library,
  summary,
}: {
  extraction: ProfileEvidenceExtraction | null;
  library: EvidenceLibrary | null;
  summary: ReturnType<typeof summarizeLibraryReadiness>;
}) {
  const profileName =
    extraction?.profile.name.value ?? library?.profile?.displayName ?? "No profile yet";
  const evidenceCount = library?.evidenceItems.length ?? extraction?.evidence_items.length ?? 0;
  const roleCount = library?.workExperiences.length ?? extraction?.work_experiences.length ?? 0;
  const initiativeCount = library?.initiatives.length ?? extraction?.initiatives.length ?? 0;
  const portfolioCount =
    library?.portfolioProjects.length ?? extraction?.portfolio_projects.length ?? 0;
  return (
    <section className="library-overview" aria-label="Material Library readiness">
      <div className="library-overview__top">
        <div>
          <span>Material health</span>
          <strong>{profileName}</strong>
        </div>
        <p>
          {evidenceCount} evidence · {roleCount} roles · {initiativeCount} initiatives ·{" "}
          {portfolioCount} portfolio projects
        </p>
      </div>
      <div className="library-readiness">
        <article>
          <span>Thin stories</span>
          <strong>{summary.projectsNeedingContext}</strong>
          <p>{summary.storyReadyProjects} ready</p>
        </article>
        <article>
          <span>Claims to review</span>
          <strong>{summary.evidenceNeedingReview}</strong>
          <p>{summary.resumeReadyEvidence} resume-ready</p>
        </article>
        <article>
          <span>Next</span>
          <strong>{summary.nextActionTitle}</strong>
          <p>{summary.nextActionDetail}</p>
        </article>
      </div>
    </section>
  );
}

function EvidenceLibraryToolbar({
  filters,
  onChange,
  options,
}: {
  filters: EvidenceLibraryFilters;
  onChange: (filters: EvidenceLibraryFilters) => void;
  options: {
    rolesAndStories: Array<{ label: string; value: string }>;
    sensitivities: string[];
    sources: Array<{ label: string; value: string }>;
    statuses: string[];
    usages: string[];
  };
}) {
  function update(patch: Partial<EvidenceLibraryFilters>) {
    onChange({ ...filters, ...patch });
  }
  return (
    <section className="evidence-library-toolbar" aria-label="Evidence Library search and filters">
      <label className="evidence-library-toolbar__search">
        <span>Search evidence, stories, roles</span>
        <input
          value={filters.query}
          onChange={(event) => update({ query: event.target.value })}
          placeholder="Search claims, source quotes, roles, or stories..."
        />
      </label>
      <div className="evidence-library-toolbar__filters">
        <ThemeSelect
          label="Usage"
          value={filters.usage}
          options={[
            { label: "All usage", value: "all" },
            ...options.usages.map((usage) => ({
              label: formatFilterLabel(usage),
              value: usage,
            })),
          ]}
          onChange={(usage) => update({ usage })}
        />
        <ThemeSelect
          label="Status"
          value={filters.status}
          options={[
            { label: "All status", value: "all" },
            ...options.statuses.map((status) => ({
              label: formatFilterLabel(status),
              value: status,
            })),
          ]}
          onChange={(status) => update({ status })}
        />
        <ThemeSelect
          label="Role / story"
          value={filters.roleOrStory}
          options={[{ label: "All roles and stories", value: "all" }, ...options.rolesAndStories]}
          onChange={(roleOrStory) => update({ roleOrStory })}
        />
        <ThemeSelect
          label="Source"
          value={filters.source}
          options={[{ label: "All sources", value: "all" }, ...options.sources]}
          onChange={(source) => update({ source })}
        />
        <ThemeSelect
          label="Sensitivity"
          value={filters.sensitivity}
          options={[
            { label: "All sensitivity", value: "all" },
            ...options.sensitivities.map((sensitivity) => ({
              label: formatFilterLabel(sensitivity),
              value: sensitivity,
            })),
          ]}
          onChange={(sensitivity) => update({ sensitivity })}
        />
        <ThemeToggleFilter
          active={filters.hasMetricOnly}
          label="Metric"
          activeText="Has metric"
          inactiveText="Any metric"
          onToggle={() => update({ hasMetricOnly: !filters.hasMetricOnly })}
        />
        <ThemeToggleFilter
          active={filters.unlinkedOnly}
          label="Link status"
          activeText="Unlinked only"
          inactiveText="Any link"
          onToggle={() => update({ unlinkedOnly: !filters.unlinkedOnly })}
        />
      </div>
    </section>
  );
}

function ThemeToggleFilter({
  active,
  activeText,
  inactiveText,
  label,
  onToggle,
}: {
  active: boolean;
  activeText: string;
  inactiveText: string;
  label: string;
  onToggle: () => void;
}) {
  return (
    <div className="theme-select theme-toggle-filter">
      <span>{label}</span>
      <button
        aria-pressed={active}
        className="theme-select__trigger theme-toggle-filter__trigger"
        type="button"
        onClick={onToggle}
      >
        <span>{active ? activeText : inactiveText}</span>
        <em aria-hidden="true">{active ? "On" : "Off"}</em>
      </button>
    </div>
  );
}

function ThemeSelect({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
  value: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const selected = options.find((option) => option.value === value) ?? options[0];
  const listboxId = `theme-select-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <div className="theme-select">
      <span>{label}</span>
      <button
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        className="theme-select__trigger"
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        onBlur={(event) => {
          if (!event.currentTarget.parentElement?.contains(event.relatedTarget)) {
            setIsOpen(false);
          }
        }}
      >
        <span>{selected?.label ?? "Select"}</span>
        <em aria-hidden="true">⌄</em>
      </button>
      {isOpen ? (
        <div
          className="theme-select__menu"
          id={listboxId}
          role="listbox"
          tabIndex={-1}
          onBlur={(event) => {
            if (!event.currentTarget.parentElement?.contains(event.relatedTarget)) {
              setIsOpen(false);
            }
          }}
        >
          {options.map((option) => (
            <button
              aria-selected={option.value === value}
              className="theme-select__option"
              data-selected={option.value === value}
              key={option.value}
              role="option"
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function HelpHint({ label = "More info", text }: { label?: string; text?: string | null }) {
  if (!text) return null;
  return (
    <span className="enrichment-proposal__help help-hint" tabIndex={0} aria-label={label}>
      ?
      <small>{text}</small>
    </span>
  );
}

function EnrichmentTaskQueue({
  evidenceItems,
  focusedTaskId,
  initiatives,
  linkTargets,
  onCreateLibraryItems,
  onOpenProfileFact,
  onRefresh,
  onReviewImportedMaterial,
  onReturnToIntake,
  onUpdate,
  portfolioProjects,
  queueStatus,
  tasks,
  variant,
  workExperiences,
}: {
  evidenceItems: EvidenceCardItem[];
  focusedTaskId?: string | null;
  initiatives: InitiativeItem[];
  linkTargets: EvidenceLinkTargets;
  onCreateLibraryItems: (task: EnrichmentTaskItem) => void;
  onOpenProfileFact: (task: EnrichmentTaskItem) => void;
  onRefresh: () => Promise<void>;
  onReviewImportedMaterial: () => void;
  onReturnToIntake: () => void;
  onUpdate: (
    taskId: string,
    payload: EnrichmentTaskUpdatePayload,
  ) => Promise<{ ok: boolean; message: string }>;
  portfolioProjects: PortfolioProjectItem[];
  queueStatus: "ready" | "skipped" | "error";
  tasks: EnrichmentTaskItem[];
  variant?: "questions" | "imported";
  workExperiences: WorkExperienceItem[];
}) {
  const queueVariant = variant ?? "questions";
  const actionableTasks = tasks.filter(
    (task) => task.status === "open" || task.status === "answered",
  );
  const questionTaskCount = actionableTasks.filter(
    (task) => !isSourceSectionReviewTask(task),
  ).length;
  const sourceSectionTaskCount = actionableTasks.length - questionTaskCount;
  const convertedCount = tasks.filter((task) => task.status === "converted").length;
  const [pendingTasks, setPendingTasks] = useState<Record<string, EnrichmentPendingAction>>({});
  const [batchPending, setBatchPending] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [messages, setMessages] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [taskFilters, setTaskFilters] = useState({
    query: "",
    scope: "all",
    sourceType: "all",
    status: "all",
    unlinkedOnly: false,
  });
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const consumedFocusedTaskId = useRef<string | null>(null);
  const filteredTasks = filterEnrichmentTasks(actionableTasks, taskFilters);
  const groupedTasks = groupEnrichmentTasks(filteredTasks);
  const selectedTask =
    filteredTasks.find((task) => task.id === selectedTaskId) ?? filteredTasks[0] ?? null;
  const selectedTaskIndex = selectedTask
    ? filteredTasks.findIndex((task) => task.id === selectedTask.id)
    : -1;
  const selectedBatchIds = filteredTasks
    .filter(
      (task) =>
        task.status === "open" &&
        !taskHasReusableLibraryAnchor(task) &&
        !isSourceSectionReviewTask(task),
    )
    .slice(0, 10)
    .map((task) => task.id);
  const taskFilterOptions = buildEnrichmentTaskFilterOptions(actionableTasks);

  useEffect(() => {
    if (
      focusedTaskId &&
      consumedFocusedTaskId.current !== focusedTaskId &&
      filteredTasks.some((task) => task.id === focusedTaskId)
    ) {
      consumedFocusedTaskId.current = focusedTaskId;
      if (selectedTaskId !== focusedTaskId) setSelectedTaskId(focusedTaskId);
      return;
    }
    if (filteredTasks.length === 0) {
      if (selectedTaskId !== null) setSelectedTaskId(null);
      return;
    }
    if (!selectedTaskId || !filteredTasks.some((task) => task.id === selectedTaskId)) {
      setSelectedTaskId(filteredTasks[0]!.id);
    }
  }, [filteredTasks, focusedTaskId, selectedTaskId]);

  async function handleUpdate(
    task: EnrichmentTaskItem,
    payload: EnrichmentTaskUpdatePayload,
  ) {
    setPendingTasks((current) => ({
      ...current,
      [task.id]: getPendingEnrichmentAction(payload, task),
    }));
    try {
      const result = await onUpdate(task.id, payload);
      setMessages((current) => ({
        ...current,
        [task.id]: { ok: result.ok, text: result.message },
      }));
    } finally {
      setPendingTasks((current) => {
        const next = { ...current };
        delete next[task.id];
        return next;
      });
    }
  }

  function selectRelativeTask(direction: -1 | 1) {
    if (selectedTaskIndex < 0) return;
    const nextIndex = Math.min(
      filteredTasks.length - 1,
      Math.max(0, selectedTaskIndex + direction),
    );
    setSelectedTaskId(filteredTasks[nextIndex]?.id ?? null);
  }

  async function dismissFilteredUnassigned() {
    if (selectedBatchIds.length === 0) return;
    setBatchPending(true);
    try {
      for (const taskId of selectedBatchIds) {
        const task = filteredTasks.find((item) => item.id === taskId);
        if (!task) continue;
        await handleUpdate(task, { action: "dismiss" });
      }
    } finally {
      setBatchPending(false);
    }
  }

  return (
    <section className="section-block enrichment-queue">
      <div className="section-block__top">
        <div>
          <h3>{queueVariant === "imported" ? "Imported Material" : "Improve Evidence"}</h3>
            <p>
              {queueVariant === "imported"
                ? "Review imported sections, then decide whether they should become roles, stories, or evidence."
                : "Answer these questions to strengthen your work stories and resume proof."}
            </p>
        </div>
        <span>
          {queueVariant === "imported"
            ? `${sourceSectionTaskCount} imported sections`
            : `${questionTaskCount} questions`}
          {convertedCount > 0 ? ` · ${convertedCount} converted` : ""}
        </span>
      </div>
      {queueStatus === "skipped" ? (
        <div className="empty-state-row">
          <div>
            <strong>Storage is unavailable.</strong>
            <p>Try again after setup is fixed.</p>
          </div>
          <button className="secondary-button" type="button" onClick={onReturnToIntake}>
            Open Add Material
          </button>
        </div>
      ) : queueStatus === "error" ? (
        <div className="empty-state-row">
          <div>
            <strong>Could not load review items.</strong>
            <p>Try reloading the workspace.</p>
          </div>
          <button className="secondary-button" type="button" onClick={onReturnToIntake}>
            Open Add Material
          </button>
        </div>
      ) : actionableTasks.length === 0 ? (
        <div className="empty-state-row">
          <div>
            <strong>
              {queueVariant === "imported"
                ? "No imported material notes need review."
                : "No evidence questions are open."}
            </strong>
            <p>
              {queueVariant === "imported"
                ? "Imported section reviews will appear here."
                : "Add material or rerun Resume Review to surface missing details."}
            </p>
          </div>
          <button className="secondary-button" type="button" onClick={onReturnToIntake}>
            Add guided material
          </button>
        </div>
      ) : (
        <>
        <EnrichmentTaskControls
          batchCount={selectedBatchIds.length}
          disabled={batchPending}
          filters={taskFilters}
          onBatchDismiss={() => void dismissFilteredUnassigned()}
          onChange={setTaskFilters}
          options={taskFilterOptions}
          resultCount={filteredTasks.length}
          totalCount={actionableTasks.length}
        />
        {filteredTasks.length === 0 ? (
          <div className="empty-state-row">
            <div>
              <strong>No items match these filters.</strong>
              <p>Clear search or broaden the filters.</p>
            </div>
          </div>
        ) : (
        <MotionPanel className="enrichment-focus-shell">
          <aside className="enrichment-task-rail" aria-label="Enrichment task queue">
            {groupedTasks.map((group) => (
              <section className="enrichment-task-group" key={group.key}>
                <div className="enrichment-task-group__header">
                  <span>{group.label}</span>
                  <strong>{group.tasks.length}</strong>
                </div>
                <AnimatedQueueList
                  className="enrichment-task-list"
                  getKey={(task) => task.id}
                  items={group.tasks}
                >
                  {(task) => (
                    <button
                      className="enrichment-task-row"
                      data-active={selectedTask?.id === task.id}
                      key={task.id}
                      onClick={() => setSelectedTaskId(task.id)}
                      type="button"
                    >
                      <span className="enrichment-task-row__header">
                        <span>{formatEnrichmentTaskScope(task.target_scope)}</span>
                        <small>{formatEnrichmentTaskStatus(task)}</small>
                      </span>
                      <strong>{task.prompt}</strong>
                      <small className="enrichment-task-row__meta">
                        {formatEnrichmentSourceType(task.source_type)}
                      </small>
                    </button>
                  )}
                </AnimatedQueueList>
              </section>
            ))}
            <GradualBlur />
          </aside>
          {selectedTask ? (
            <EnrichmentTaskFocusPane
              answer={answers[selectedTask.id] ?? selectedTask.user_answer ?? ""}
              canGoNext={selectedTaskIndex >= 0 && selectedTaskIndex < filteredTasks.length - 1}
              canGoPrevious={selectedTaskIndex > 0}
              evidenceItems={evidenceItems}
              initiatives={initiatives}
              isPending={Boolean(pendingTasks[selectedTask.id])}
              linkTargets={linkTargets}
              message={messages[selectedTask.id]}
              onAnswerChange={(answer) =>
                setAnswers((current) => ({ ...current, [selectedTask.id]: answer }))
              }
              onCreateLibraryItems={() => onCreateLibraryItems(selectedTask)}
              onOpenProfileFact={() => onOpenProfileFact(selectedTask)}
              onReviewImportedMaterial={onReviewImportedMaterial}
              onAcknowledge={() => void handleUpdate(selectedTask, { action: "acknowledge" })}
              onConvertToQuestion={() =>
                void handleUpdate(selectedTask, { action: "convert_to_enrichment_question" })
              }
              onMarkImportReviewed={() =>
                void handleUpdate(selectedTask, { action: "mark_import_reviewed" })
              }
              onRoleFieldUpdated={onRefresh}
              onRequestRerun={() => void handleUpdate(selectedTask, { action: "request_rerun" })}
              onDismiss={() => void handleUpdate(selectedTask, { action: "dismiss" })}
              onLink={(anchor) =>
                void handleUpdate(selectedTask, {
                  action: "link",
                  anchor,
                })
              }
              onNext={() => selectRelativeTask(1)}
              onPrevious={() => selectRelativeTask(-1)}
              onSaveAnswer={(answer) =>
                void handleUpdate(selectedTask, {
                  action: "answer",
                  userAnswer: answer,
                })
              }
              onAcceptProposal={(proposalId) =>
                void handleUpdate(selectedTask, { action: "accept_proposal", proposalId })
              }
              onRejectProposal={(proposalId) =>
                void handleUpdate(selectedTask, { action: "reject_proposal", proposalId })
              }
              onReviseProposal={(proposalId, revision) =>
                void handleUpdate(selectedTask, {
                  action: "revise_proposal",
                  proposalId,
                  ...revision,
                })
              }
              pendingAction={pendingTasks[selectedTask.id] ?? null}
              portfolioProjects={portfolioProjects}
              task={selectedTask}
              taskIndex={selectedTaskIndex + 1}
              taskTotal={filteredTasks.length}
              workExperiences={workExperiences}
            />
          ) : null}
        </MotionPanel>
        )}
        </>
      )}
    </section>
  );
}

function getPendingEnrichmentAction(
  payload: EnrichmentTaskUpdatePayload,
  task: EnrichmentTaskItem,
): EnrichmentPendingAction {
  if (payload.action === "accept_proposal") return "accept";
  if (payload.action === "reject_proposal") return "discard";
  if (payload.action === "answer") {
    return isProfileContextTask(task) ? "save_context" : "generate";
  }
  if (payload.action === "revise_proposal") {
    return payload.revisionInstruction ? "ai_revision" : "manual_edit";
  }
  return "other";
}

function EnrichmentTaskFocusPane({
  answer,
  canGoNext,
  canGoPrevious,
  evidenceItems,
  initiatives,
  isPending,
  linkTargets,
  message,
  onAnswerChange,
  onAcceptProposal,
  onAcknowledge,
  onConvertToQuestion,
  onCreateLibraryItems,
  onDismiss,
  onLink,
  onMarkImportReviewed,
  onNext,
  onOpenProfileFact,
  onPrevious,
  onReviewImportedMaterial,
  onRejectProposal,
  onRequestRerun,
  onReviseProposal,
  onRoleFieldUpdated,
  onSaveAnswer,
  portfolioProjects,
  pendingAction,
  task,
  taskIndex,
  taskTotal,
  workExperiences,
}: {
  answer: string;
  canGoNext: boolean;
  canGoPrevious: boolean;
  evidenceItems: EvidenceCardItem[];
  initiatives: InitiativeItem[];
  isPending: boolean;
  linkTargets: EvidenceLinkTargets;
  message?: { ok: boolean; text: string };
  onAnswerChange: (answer: string) => void;
  onAcceptProposal: (proposalId: string) => void;
  onAcknowledge: () => void;
  onConvertToQuestion: () => void;
  onCreateLibraryItems: () => void;
  onDismiss: () => void;
  onLink: (anchor: EnrichmentTaskAnchorPatch) => void;
  onMarkImportReviewed: () => void;
  onNext: () => void;
  onOpenProfileFact: () => void;
  onPrevious: () => void;
  onReviewImportedMaterial: () => void;
  onRejectProposal: (proposalId: string) => void;
  onRequestRerun: () => void;
  onReviseProposal: (
    proposalId: string,
    revision: { revisedText?: string; revisionInstruction?: string },
  ) => void;
  onRoleFieldUpdated: () => Promise<void>;
  onSaveAnswer: (answer: string) => void;
  portfolioProjects: PortfolioProjectItem[];
  pendingAction: EnrichmentPendingAction | null;
  task: EnrichmentTaskItem;
  taskIndex: number;
  taskTotal: number;
  workExperiences: WorkExperienceItem[];
}) {
  const hasLibraryAnchor = taskHasReusableLibraryAnchor(task);
  const requiresTargetBeforeAnswer = shouldRequireTargetBeforeAnswer(task);
  const canAnswerNow = hasLibraryAnchor || !requiresTargetBeforeAnswer;
  const linkedLabel = formatEnrichmentTaskAnchor(task, evidenceItems, linkTargets);
  const parentLabel = formatEnrichmentTaskParent(task, linkTargets);
  const pendingProposal =
    task.proposals.find((proposal) => proposal.status === "pending_review") ?? null;
  const proposalType = pendingProposal?.proposal_type ?? proposalTypePreviewForTask(task);
  const currentAnswer = answer.trim() ? answer : task.user_answer ?? "";
  if (isSourceSectionReviewTask(task)) {
    return (
      <SourceSectionReviewPane
        canGoNext={canGoNext}
        canGoPrevious={canGoPrevious}
        isPending={isPending}
        message={message}
        onAcknowledge={onAcknowledge}
        onConvertToQuestion={onConvertToQuestion}
        onCreateLibraryItems={onCreateLibraryItems}
        onDismiss={onDismiss}
        onMarkImportReviewed={onMarkImportReviewed}
        onNext={onNext}
        onOpenProfileFact={onOpenProfileFact}
        onPrevious={onPrevious}
        onReviewImportedMaterial={onReviewImportedMaterial}
        onRequestRerun={onRequestRerun}
        onRoleFieldUpdated={onRoleFieldUpdated}
        task={task}
        taskIndex={taskIndex}
        taskTotal={taskTotal}
        workExperiences={workExperiences}
      />
    );
  }
  return (
    <article className="enrichment-focus-pane">
      <div className="enrichment-focus-pane__top">
        <div>
          <span>
            Question {taskIndex} of {taskTotal} · {formatEnrichmentTaskScope(task.target_scope)}
          </span>
          <h3>{task.prompt}</h3>
          <p>From {task.source_label}</p>
        </div>
        <em data-state={task.status}>{formatEnrichmentTaskStatus(task)}</em>
      </div>
      {!hasLibraryAnchor && requiresTargetBeforeAnswer ? (
        <div className="enrichment-task-card__stage">
          <div className="enrichment-task-card__stage-header">
            <span>Step 1</span>
            <strong>Choose where this answer belongs</strong>
            <p>Link this question before answering.</p>
          </div>
          <EnrichmentTaskTargetPicker
            disabled={isPending}
            evidenceItems={evidenceItems}
            initiatives={initiatives}
            onLink={onLink}
            portfolioProjects={portfolioProjects}
            task={task}
            workExperiences={workExperiences}
          />
          <div className="enrichment-task-card__gate">
            <div>
              <strong>No matching target?</strong>
              <p>Create new material only if nothing fits.</p>
            </div>
            <button
              className="secondary-button secondary-button--quiet"
              type="button"
              onClick={onCreateLibraryItems}
            >
              Create new material instead
            </button>
          </div>
        </div>
      ) : (
        <>
          <details className="enrichment-task-card__target-picker">
            <summary>Task context and target</summary>
            <div className="enrichment-task-card__context">
              <div>
                <span>Linked to</span>
                <strong>{linkedLabel}</strong>
              </div>
              <div>
                <span>Under</span>
                <strong>{parentLabel}</strong>
              </div>
              <div>
                <span>Why we ask</span>
                <strong>{formatEnrichmentTargetReason(task)}</strong>
              </div>
              <div>
                <span>Answer will</span>
                <strong>{formatEnrichmentExpectedOutcome(task)}</strong>
              </div>
            </div>
            <EnrichmentTaskTargetPicker
              disabled={isPending}
              evidenceItems={evidenceItems}
              initiatives={initiatives}
              onLink={onLink}
              portfolioProjects={portfolioProjects}
              task={task}
              workExperiences={workExperiences}
            />
          </details>
          {pendingProposal ? (
            <EnrichmentProposalPreview
              answer={currentAnswer}
              disabled={isPending}
              evidenceItems={evidenceItems}
              initiatives={initiatives}
              pendingAction={pendingAction}
              portfolioProjects={portfolioProjects}
              proposal={pendingProposal}
              question={task.prompt}
              revisions={task.proposal_revisions}
              targetLabel={linkedLabel}
              workExperiences={workExperiences}
              onAccept={() => onAcceptProposal(pendingProposal.id)}
              onAnswerChange={onAnswerChange}
              onReject={() => onRejectProposal(pendingProposal.id)}
              onRevise={(revision) => onReviseProposal(pendingProposal.id, revision)}
            />
          ) : (
            <EnrichmentAnswerWorkspace
              answer={currentAnswer}
              disabled={isPending}
              evidenceItems={evidenceItems}
              initiatives={initiatives}
              pendingAction={pendingAction}
              portfolioProjects={portfolioProjects}
              task={task}
              targetLabel={linkedLabel}
              workExperiences={workExperiences}
              onAnswerChange={onAnswerChange}
            />
          )}
        </>
      )}
      <div className="enrichment-focus-pane__footer">
        <div className="actions actions--compact">
          {canAnswerNow && !pendingProposal ? (
            <>
              <button
                className="primary-button"
                disabled={isPending || currentAnswer.trim().length < 3}
                type="button"
                onClick={() => onSaveAnswer(currentAnswer)}
              >
                {formatPrimaryAnswerCta(task, proposalType, task.status, pendingAction)}
              </button>
            </>
          ) : null}
          <button
            className="ghost-button enrichment-task-card__dismiss"
            disabled={isPending}
            type="button"
            onClick={onDismiss}
          >
            Dismiss
          </button>
          {message ? (
            <span className={message.ok ? "status" : "status status--error"}>
              {message.text}
            </span>
          ) : null}
        </div>
        <div className="enrichment-focus-pane__nav">
          <button
            className="secondary-button"
            disabled={!canGoPrevious}
            type="button"
            onClick={onPrevious}
          >
            Previous
          </button>
          <button
            className="secondary-button"
            disabled={!canGoNext}
            type="button"
            onClick={onNext}
          >
            Next
          </button>
        </div>
      </div>
    </article>
  );
}

function EnrichmentAnswerWorkspace({
  answer,
  disabled,
  evidenceItems,
  initiatives,
  onAnswerChange,
  pendingAction,
  portfolioProjects,
  targetLabel,
  task,
  workExperiences,
}: {
  answer: string;
  disabled: boolean;
  evidenceItems: EvidenceCardItem[];
  initiatives: InitiativeItem[];
  onAnswerChange: (answer: string) => void;
  pendingAction: EnrichmentPendingAction | null;
  portfolioProjects: PortfolioProjectItem[];
  targetLabel: string;
  task: EnrichmentTaskItem;
  workExperiences: WorkExperienceItem[];
}) {
  const proposalType = proposalTypePreviewForTask(task);
  const isProfileContext = isProfileContextTask(task);
  const referenceItems = buildEnrichmentTaskReferences(task, {
    evidenceItems,
    initiatives,
    portfolioProjects,
    workExperiences,
  });
  const answerSaved = task.status === "answered" && answer.trim().length > 0;
  const isGenerating = disabled && pendingAction === "generate";
  const isSavingContext = disabled && pendingAction === "save_context";
  return (
    <div className="enrichment-proposal enrichment-proposal--draft enrichment-proposal--answer-collection">
      <div className="enrichment-proposal__header">
        <div>
          <span>{answerSaved ? "Answer saved" : "Answer this question"}</span>
          <strong>{formatEnrichmentTaskWorkspaceTitle(proposalType)}</strong>
        </div>
        <em data-state="drafting">{answerSaved ? "Preview needed" : "Not saved"}</em>
      </div>
      <div className="enrichment-proposal__workspace">
        <section className="enrichment-proposal__output">
          {referenceItems.length > 0 ? (
            <div className="enrichment-proposal__references">
              <span>Related material</span>
              {referenceItems.map((item) => (
                <article key={`${item.label}-${item.text}`}>
                  <strong>{item.label}</strong>
                  <p>{item.text}</p>
                </article>
              ))}
            </div>
          ) : (
            <div className="enrichment-proposal__context-note">
              <span>Related material</span>
              <p>
                {isProfileContext
                  ? "This is a profile-level answer. It will guide your profile direction, not create evidence."
                  : "This answer needs a target before JobDesk can turn it into reusable evidence or story context."}
              </p>
            </div>
          )}
          <dl className="enrichment-proposal__meta">
            <div>
              <dt>Target</dt>
              <dd>{targetLabel}</dd>
            </div>
            <div>
              <dt>Next step</dt>
              <dd>{formatEnrichmentPreProposalNextStep(task, proposalType)}</dd>
            </div>
          </dl>
        </section>
        <aside className="enrichment-proposal__conversation">
          <label className="enrichment-proposal__answer">
            <span>{answerSaved ? "Saved answer" : "Your answer"}</span>
            <textarea
              className="jd-input jd-input--compact"
              disabled={disabled}
              onChange={(event) => onAnswerChange(event.target.value)}
              placeholder={formatEnrichmentConversationPlaceholder(task, proposalType)}
              value={answer}
            />
          </label>
          <div className="enrichment-proposal__history">
            <span>
              {isProfileContext
                ? answerSaved
                  ? "Saved"
                  : "After you save"
                : answerSaved
                  ? "Ready to generate"
                  : "After you generate"}
            </span>
            <p>{formatEnrichmentAnswerWorkspaceHelp(task, proposalType, answerSaved)}</p>
          </div>
          {isGenerating || isSavingContext ? (
            <div className="enrichment-proposal__progress" role="status" aria-live="polite">
              <span />
              <p>
                {isGenerating
                  ? "JobDesk is generating a suggested update from this answer. You can select another task while it runs."
                  : "JobDesk is saving this context."}
              </p>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function SourceSectionReviewPane({
  canGoNext,
  canGoPrevious,
  isPending,
  message,
  onCreateLibraryItems,
  onAcknowledge,
  onConvertToQuestion,
  onDismiss,
  onMarkImportReviewed,
  onNext,
  onOpenProfileFact,
  onPrevious,
  onReviewImportedMaterial,
  onRequestRerun,
  onRoleFieldUpdated,
  task,
  taskIndex,
  taskTotal,
  workExperiences,
}: {
  canGoNext: boolean;
  canGoPrevious: boolean;
  isPending: boolean;
  message?: { ok: boolean; text: string };
  onAcknowledge: () => void;
  onConvertToQuestion: () => void;
  onCreateLibraryItems: () => void;
  onDismiss: () => void;
  onMarkImportReviewed: () => void;
  onNext: () => void;
  onOpenProfileFact: () => void;
  onPrevious: () => void;
  onReviewImportedMaterial: () => void;
  onRequestRerun: () => void;
  onRoleFieldUpdated: () => Promise<void>;
  task: EnrichmentTaskItem;
  taskIndex: number;
  taskTotal: number;
  workExperiences: WorkExperienceItem[];
}) {
  const { fetchJson } = useAccess();
  const [customizing, setCustomizing] = useState(false);
  const [roleEditStatus, setRoleEditStatus] = useState<string | null>(null);
  const taskWorkExperienceId = getEnrichmentTargetId(task, "work_experience");
  const [selectedRoleId, setSelectedRoleId] = useState(() => taskWorkExperienceId);
  const [roleFieldValue, setRoleFieldValue] = useState("");
  const [isSavingRoleField, setIsSavingRoleField] = useState(false);
  const sectionName = extractSourceSectionName(task.prompt);
  const actionModel = getImportedNoteActionModel(task, sectionName);
  const showRoleFieldEditor = task.expected_action === "edit_role_field";
  const roleFieldKey = normalizeImportedRoleTargetField(task.target_field);
  const roleFieldConfig = getRoleFieldEditorConfig(roleFieldKey);
  useEffect(() => {
    setSelectedRoleId(taskWorkExperienceId);
    setRoleFieldValue("");
    setRoleEditStatus(null);
    setCustomizing(false);
  }, [task.id, taskWorkExperienceId]);
  const handlePrimaryAction =
    actionModel.primaryAction === "acknowledge"
      ? onAcknowledge
      : actionModel.primaryAction === "edit_role_field"
        ? () => setCustomizing(true)
      : actionModel.primaryAction === "add_material"
        ? onOpenProfileFact
      : actionModel.primaryAction === "mark_reviewed"
        ? onMarkImportReviewed
      : actionModel.primaryAction === "request_rerun"
        ? onRequestRerun
        : onReviewImportedMaterial;
  async function saveRoleField() {
    if (!selectedRoleId) {
      setRoleEditStatus("Choose the matching role first.");
      return;
    }
    if (roleFieldValue.trim().length < 2) {
      setRoleEditStatus(`Add ${roleFieldConfig.label.toLowerCase()} before saving.`);
      return;
    }
    setIsSavingRoleField(true);
    setRoleEditStatus("Saving role field...");
    try {
      const response = await fetchJson(`/api/work-experiences/${selectedRoleId}`, {
        body: JSON.stringify({
          action: "update_fields",
          [roleFieldConfig.requestKey]: roleFieldValue,
          taskId: task.id,
        }),
        headers: { "Content-Type": "application/json" },
        method: "PATCH",
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; kind?: string }
        | null;
      if (!response.ok) {
        setRoleEditStatus(
          payload?.error
            ? `${payload.error}${payload.kind ? ` (${payload.kind})` : ""}`
            : "Role field update failed.",
        );
        return;
      }
      setRoleEditStatus("Role field saved.");
      await onRoleFieldUpdated();
    } catch (error) {
      setRoleEditStatus(error instanceof Error ? error.message : "Role field update failed.");
    } finally {
      setIsSavingRoleField(false);
    }
  }
  return (
    <article className="enrichment-focus-pane enrichment-focus-pane--source-section">
      <div className="enrichment-focus-pane__top">
        <div>
          <span>
            Review item {taskIndex} of {taskTotal} · Imported material
          </span>
          <h3>{actionModel.title}</h3>
          <p>From {task.source_label}</p>
        </div>
        <em data-state={task.status}>{formatEnrichmentTaskStatus(task)}</em>
      </div>
      <div className="source-section-review">
        <div className="source-section-review__summary">
          <span>{actionModel.eyebrow}</span>
          <strong>
            {actionModel.heading}
            <HelpHint text={actionModel.description} />
          </strong>
        </div>
        <dl className="source-section-review__meta">
          <div>
            <dt>Note</dt>
            <dd>{task.prompt}</dd>
          </div>
          <div>
            <dt>Why this appears</dt>
            <dd>{formatEnrichmentTargetReason(task)}</dd>
          </div>
          <div>
            <dt>Recommended action</dt>
            <dd>{actionModel.recommendedAction}</dd>
          </div>
          {task.target_field ? (
            <div>
              <dt>Field</dt>
              <dd>{formatImportedNoteTargetField(task.target_field)}</dd>
            </div>
          ) : null}
        </dl>
        {showRoleFieldEditor ? (
          <div className="source-section-review__customize">
            <label className="source-field">
              <span>Matching role</span>
              <select
                className="jd-input jd-input--compact"
                disabled={isPending || isSavingRoleField}
                value={selectedRoleId}
                onChange={(event) => setSelectedRoleId(event.target.value)}
              >
                <option value="">Choose role</option>
                {workExperiences.map((experience) => (
                  <option key={experience.id} value={experience.id}>
                    {experience.employer} · {experience.role_title}
                  </option>
                ))}
              </select>
            </label>
            <label className="source-field">
              <span>{roleFieldConfig.label}</span>
              {roleFieldKey === "summary" ? (
                <textarea
                  className="jd-input jd-input--compact"
                  disabled={isPending || isSavingRoleField}
                  placeholder={roleFieldConfig.placeholder}
                  rows={3}
                  value={roleFieldValue}
                  onChange={(event) => setRoleFieldValue(event.target.value)}
                />
              ) : (
                <input
                  className="jd-input jd-input--compact"
                  disabled={isPending || isSavingRoleField}
                  placeholder={roleFieldConfig.placeholder}
                  value={roleFieldValue}
                  onChange={(event) => setRoleFieldValue(event.target.value)}
                />
              )}
            </label>
            <button
              className="primary-action"
              disabled={isPending || isSavingRoleField || !selectedRoleId || roleFieldValue.trim().length < 2}
              type="button"
              onClick={() => void saveRoleField()}
            >
              {isSavingRoleField ? "Saving..." : `Save ${roleFieldConfig.shortLabel}`}
            </button>
            {roleEditStatus ? <span className="status">{roleEditStatus}</span> : null}
          </div>
        ) : null}
        <div className="source-section-review__actions">
          <button
            className="primary-action"
            disabled={isPending}
            type="button"
            onClick={handlePrimaryAction}
          >
            {actionModel.primaryLabel}
          </button>
          <button
            className="secondary-button"
            disabled={isPending}
            type="button"
            onClick={() => setCustomizing((value) => !value)}
          >
            More options
          </button>
          <button
            className="ghost-button enrichment-task-card__dismiss"
            disabled={isPending}
            type="button"
            onClick={onDismiss}
          >
            Dismiss note
          </button>
        </div>
        {customizing ? (
          <div className="source-section-review__customize">
            <button
              className="secondary-button secondary-button--quiet"
              type="button"
              disabled={isPending}
              onClick={onMarkImportReviewed}
            >
              Mark import reviewed
            </button>
            <button
              className="secondary-button secondary-button--quiet"
              type="button"
              disabled={isPending}
              onClick={onRequestRerun}
            >
              Mark for rerun
            </button>
            <button
              className="secondary-button secondary-button--quiet"
              type="button"
              disabled={isPending}
              onClick={onConvertToQuestion}
            >
              Convert to evidence question
            </button>
            <button
              className="secondary-button secondary-button--quiet"
              type="button"
              onClick={onReviewImportedMaterial}
            >
              Review imported library items
            </button>
            <button
              className="secondary-button secondary-button--quiet"
              type="button"
              onClick={onOpenProfileFact}
            >
              Add profile fact
            </button>
            <button
              className="secondary-button secondary-button--quiet"
              type="button"
              onClick={onCreateLibraryItems}
            >
              Add a specific evidence answer
            </button>
            <button
              className="secondary-button secondary-button--quiet"
              disabled={isPending}
              type="button"
              onClick={onDismiss}
            >
              Ignore this imported section
            </button>
          </div>
        ) : null}
      </div>
      <div className="enrichment-focus-pane__footer">
        <div className="actions actions--compact">
          {message ? (
            <span className={message.ok ? "status" : "status status--error"}>
              {message.text}
            </span>
          ) : null}
        </div>
        <div className="enrichment-focus-pane__nav">
          <button
            className="secondary-button"
            disabled={!canGoPrevious}
            type="button"
            onClick={onPrevious}
          >
            Previous
          </button>
          <button
            className="secondary-button"
            disabled={!canGoNext}
            type="button"
            onClick={onNext}
          >
            Next
          </button>
        </div>
      </div>
    </article>
  );
}

function getImportedNoteActionModel(task: EnrichmentTaskItem, sectionName: string | null) {
  const expectedAction = task.expected_action ?? "review_import";
  if (expectedAction === "acknowledge") {
    return {
      description: "This is an import observation. Confirm it if the imported result is correct.",
      eyebrow: "Imported note",
      heading: "Confirm this import note.",
      primaryAction: "acknowledge" as const,
      primaryLabel: "Confirm note",
      recommendedAction: "Confirm if this observation matches the source, or dismiss it if it is not useful.",
      title: sectionName ? `${sectionName} import note` : "Import note",
    };
  }
  if (expectedAction === "add_profile_fact" || expectedAction === "edit_profile_fact") {
    const field = task.target_field ? formatImportedNoteTargetField(task.target_field) : "profile fact";
    return {
      description: `This note points to missing ${field}. Add or edit the profile fact from source material instead of answering this as evidence.`,
      eyebrow: "Profile fact",
      heading: `Review missing ${field}.`,
      primaryAction: "add_material" as const,
      primaryLabel: expectedAction === "add_profile_fact" ? "Add profile fact" : "Edit profile fact",
      recommendedAction: `Add or edit ${field}; do not save this as a generic answer.`,
      title: `Missing ${field}`,
    };
  }
  if (expectedAction === "edit_role_field") {
    const field = task.target_field ? formatImportedNoteTargetField(task.target_field) : "role field";
    return {
      description: `This note points to a missing ${field} on a work experience. Edit the role field directly.`,
      eyebrow: "Role field",
      heading: `Review missing ${field}.`,
      primaryAction: "edit_role_field" as const,
      primaryLabel: `Edit role ${field}`,
      recommendedAction: `Open the extracted roles and edit ${field} on the matching role.`,
      title: `Missing role ${field}`,
    };
  }
  if (expectedAction === "rerun_extraction" || expectedAction === "review_import") {
    const isRerun = expectedAction === "rerun_extraction";
    return {
      description: isRerun
        ? "This note reports an import limit. Mark it for rerun if the source should be processed again."
        : "This note reports an import limit or source classification. Mark it reviewed once you have checked the imported material.",
      eyebrow: "Import review",
      heading: isRerun ? "Rerun extraction if needed." : "Review imported material.",
      primaryAction: isRerun ? ("request_rerun" as const) : ("mark_reviewed" as const),
      primaryLabel: isRerun ? "Mark for rerun" : "Mark import reviewed",
      recommendedAction: isRerun
        ? "Use rerun when this import was capped or incomplete. Otherwise review or dismiss it."
        : "Mark reviewed after checking the extracted roles, stories, and source material.",
      title: "Imported material needs review",
    };
  }
  return {
    description: "This imported note needs review before it becomes a specific evidence or profile update.",
    eyebrow: "Imported note",
    heading: "Review this note.",
    primaryAction: "review_import" as const,
    primaryLabel: "Review imported material",
    recommendedAction: "Review or dismiss this note. Do not answer it as a normal enrichment question.",
    title: "Imported note",
  };
}

function formatImportedNoteTargetField(field: string) {
  const labels: Record<string, string> = {
    certifications: "certifications",
    certification: "certifications",
    contact: "contact info",
    education: "education",
    end_date: "end date",
    location: "location",
    personal_location: "location",
    skills: "skills",
    skill: "skills",
    start_date: "start date",
    summary: "summary",
    team: "team",
  };
  return labels[field] ?? field.replace(/_/g, " ");
}

function normalizeImportedRoleTargetField(
  field: string | null | undefined,
): "location" | "team" | "start_date" | "end_date" | "summary" {
  if (field === "team" || field === "start_date" || field === "end_date" || field === "summary") {
    return field;
  }
  if (field === "startDate") return "start_date";
  if (field === "endDate") return "end_date";
  return "location";
}

function getRoleFieldEditorConfig(
  field: "location" | "team" | "start_date" | "end_date" | "summary",
) {
  const configs = {
    end_date: {
      label: "End date",
      placeholder: "Aug 2025 or Present",
      requestKey: "endDate",
      shortLabel: "end date",
    },
    location: {
      label: "Location",
      placeholder: "City, region, or Remote",
      requestKey: "location",
      shortLabel: "location",
    },
    start_date: {
      label: "Start date",
      placeholder: "May 2025",
      requestKey: "startDate",
      shortLabel: "start date",
    },
    summary: {
      label: "Role summary",
      placeholder: "One sentence about this role's scope or focus",
      requestKey: "summary",
      shortLabel: "summary",
    },
    team: {
      label: "Team",
      placeholder: "Platform, Growth, Infrastructure...",
      requestKey: "team",
      shortLabel: "team",
    },
  } satisfies Record<
    "location" | "team" | "start_date" | "end_date" | "summary",
    { label: string; placeholder: string; requestKey: string; shortLabel: string }
  >;
  return configs[field];
}

function profileGapFieldFromImportedNote(
  task: EnrichmentTaskItem,
): ProfileGapIntent["field"] | null {
  const directField = profileGapFieldFromRawValue(task.target_field);
  if (directField) return directField;
  if (
    task.expected_action !== "add_profile_fact" &&
    task.expected_action !== "edit_profile_fact"
  ) {
    return null;
  }
  const prompt = task.prompt.toLowerCase();
  if (/\b(certification|certifications|credential|credentials)\b/.test(prompt)) {
    return "certifications";
  }
  if (/\b(email|phone|contact|linkedin|portfolio|github|personal site)\b/.test(prompt)) {
    return "contact";
  }
  if (/\b(education|school|university|college|degree|gpa|coursework)\b/.test(prompt)) {
    return "education";
  }
  if (/\b(location|city|region|country|remote|relocation)\b/.test(prompt)) {
    return "location";
  }
  if (/\b(skill|skills|languages|frameworks|tools|technologies)\b/.test(prompt)) {
    return "skills";
  }
  return null;
}

function profileGapFieldFromRawValue(value: string | null | undefined): ProfileGapIntent["field"] | null {
  const normalized = value?.toLowerCase().trim().replace(/[\s-]+/g, "_");
  if (!normalized) return null;
  if (normalized === "certification" || normalized === "certifications" || normalized === "credentials") {
    return "certifications";
  }
  if (
    normalized === "contact" ||
    normalized === "contact_info" ||
    normalized === "email" ||
    normalized === "phone"
  ) {
    return "contact";
  }
  if (normalized === "education" || normalized === "school" || normalized === "degree") {
    return "education";
  }
  if (normalized === "location" || normalized === "personal_location" || normalized === "city") {
    return "location";
  }
  if (normalized === "skill" || normalized === "skills" || normalized === "technologies") {
    return "skills";
  }
  return null;
}

function EnrichmentProposalPreview({
  answer,
  disabled,
  evidenceItems,
  initiatives,
  onAccept,
  onAnswerChange,
  onReject,
  onRevise,
  pendingAction,
  portfolioProjects,
  proposal,
  question,
  revisions,
  targetLabel,
  workExperiences,
}: {
  answer: string;
  disabled: boolean;
  evidenceItems: EvidenceCardItem[];
  initiatives: InitiativeItem[];
  onAccept: () => void;
  onAnswerChange: (answer: string) => void;
  onReject: () => void;
  onRevise: (revision: { revisedText?: string; revisionInstruction?: string }) => void;
  pendingAction: EnrichmentPendingAction | null;
  portfolioProjects: PortfolioProjectItem[];
  proposal: EnrichmentTaskItem["proposals"][number];
  question: string;
  revisions: EnrichmentTaskItem["proposal_revisions"];
  targetLabel: string;
  workExperiences: WorkExperienceItem[];
}) {
  const text = formatEnrichmentPatchPreview(proposal.proposed_patch_json);
  const sourceQuote = getEnrichmentPatchSourceQuote(proposal.proposed_patch_json) ?? text;
  const referenceItems = buildEnrichmentProposalReferences(proposal, {
    evidenceItems,
    initiatives,
    portfolioProjects,
    workExperiences,
  });
  const previewItems = buildEnrichmentPatchPreviewItems(proposal.proposed_patch_json);
  const hasProposedLibraryWording = previewItems.some((item) => item.kind === "proposed");
  const hasSupportOnly =
    previewItems.some((item) => item.kind === "support") && !hasProposedLibraryWording;
  return (
    <SuggestedUpdatePanel
      acceptLabel={
        hasSupportOnly
          ? "Save original answer"
          : hasProposedLibraryWording
            ? "Accept evidence update"
            : "Accept context update"
      }
      aiRevisionLabel="Ask AI to revise"
      aiRevisionPlaceholder={formatEnrichmentRevisionPlaceholder(proposal.proposal_type)}
      disabled={disabled}
      draftLabel={formatEnrichmentDraftLabel(proposal.proposal_type)}
      initialText={text}
      originalPrompt={question}
      originalAnswer={answer}
      previewItems={previewItems}
      referenceItems={referenceItems}
      pendingAction={pendingAction === "other" ? null : pendingAction}
      onAccept={onAccept}
      onAnswerChange={onAnswerChange}
      onDiscard={onReject}
      onRevise={onRevise}
      revisionHistory={revisions.map((revision) => ({
        actor: revision.actor,
        createdAt: revision.createdAt,
        id: revision.id,
        instruction: revision.instruction,
        mode: revision.mode,
        revisedText: revision.revised_text,
      }))}
      sourceQuote={sourceQuote}
      showOriginalPrompt={false}
      statusLabel={formatEnrichmentProposalStatus(proposal.status)}
      statusState={proposal.status}
      title={formatEnrichmentProposalType(proposal.proposal_type)}
      titleEyebrow="Answer saved"
    />
  );
}

function formatEnrichmentPatchPreview(patch: Record<string, unknown>) {
  const lines: string[] = [];
  const text = getStringPatchValue(patch, "text");
  if (text) return text;
  const textPatch = getStringPatchValue(patch, "text_patch");
  const sourceQuotePatch = getStringPatchValue(patch, "source_quote_patch");
  addPatchLine(lines, "Suggested evidence update", textPatch);
  if (sourceQuotePatch && sourceQuotePatch !== textPatch) {
    addPatchLine(lines, "Your original answer", sourceQuotePatch);
  }
  addPatchLine(lines, "Context", getStringPatchValue(patch, "context_patch"));
  addPatchLine(lines, "Problem", getStringPatchValue(patch, "problem_patch"));
  addPatchLine(lines, "Role", getStringPatchValue(patch, "role_patch"));
  addPatchLine(lines, "Summary", getStringPatchValue(patch, "summary_patch"));
  addPatchLine(lines, "Team", getStringPatchValue(patch, "team_patch"));
  addPatchLine(lines, "Location", getStringPatchValue(patch, "location_patch"));
  addPatchLine(lines, "Public-safe summary", getStringPatchValue(patch, "public_safe_summary_patch"));
  addArrayPatchLine(lines, "Actions", patch.actions_add);
  addArrayPatchLine(lines, "Results", patch.results_add);
  addArrayPatchLine(lines, "Technologies", patch.technologies_add);
  addArrayPatchLine(lines, "Stakeholders", patch.stakeholders_add);
  addArrayPatchLine(lines, "Metrics", patch.metrics_add);
  return lines.length > 0 ? lines.join("\n") : "No suggested update text available.";
}

function buildEnrichmentPatchPreviewItems(patch: Record<string, unknown>) {
  const items: Array<{
    description?: string;
    kind?: "context" | "needs_more" | "proposed" | "support";
    label: string;
    values: string[];
  }> = [];
  const textPatch = getStringPatchValue(patch, "text_patch");
  const sourceQuotePatch = getStringPatchValue(patch, "source_quote_patch");
  addPatchPreviewItem(items, "Proposed library wording", getStringPatchValue(patch, "text"), {
    description: "Draft evidence wording for the library. Resume approval remains separate.",
    kind: "proposed",
  });
  addPatchPreviewItem(items, "Proposed library wording", textPatch, {
    description: "This will update the evidence wording in your library, not a resume bullet.",
    kind: "proposed",
  });
  if (sourceQuotePatch && sourceQuotePatch !== textPatch) {
    addPatchPreviewItem(items, "Your original answer", sourceQuotePatch, {
      description: "This is the answer you typed. JobDesk keeps it as source context for the library update.",
      kind: "support",
    });
  }
  if (sourceQuotePatch && !textPatch && !getStringPatchValue(patch, "text")) {
    items.push({
      description: "The answer is useful context, but not specific enough to rewrite the evidence yet.",
      kind: "needs_more",
      label: "What to add next",
      values: [
        "Specific action or ownership",
        "Technical mechanism or tool used",
        "Outcome, metric, scale, or before/after detail",
      ],
    });
  }
  addPatchPreviewItem(items, "Story context", getStringPatchValue(patch, "context_patch"), {
    kind: "context",
  });
  addPatchPreviewItem(items, "Problem", getStringPatchValue(patch, "problem_patch"), {
    kind: "context",
  });
  addPatchPreviewItem(items, "Role", getStringPatchValue(patch, "role_patch"), {
    kind: "context",
  });
  addPatchPreviewItem(items, "Role summary", getStringPatchValue(patch, "summary_patch"), {
    kind: "context",
  });
  addPatchPreviewItem(items, "Team", getStringPatchValue(patch, "team_patch"), {
    kind: "context",
  });
  addPatchPreviewItem(items, "Location", getStringPatchValue(patch, "location_patch"), {
    kind: "context",
  });
  addPatchPreviewItem(
    items,
    "Public-safe wording",
    getStringPatchValue(patch, "public_safe_summary_patch"),
    { kind: "context" },
  );
  addArrayPatchPreviewItem(items, "Actions to add", patch.actions_add, { kind: "context" });
  addArrayPatchPreviewItem(items, "Results to add", patch.results_add, { kind: "context" });
  addArrayPatchPreviewItem(items, "Technologies to add", patch.technologies_add, {
    kind: "context",
  });
  addArrayPatchPreviewItem(items, "Stakeholders to add", patch.stakeholders_add, {
    kind: "context",
  });
  addArrayPatchPreviewItem(items, "Metrics to add", patch.metrics_add, { kind: "context" });
  return items;
}

function addPatchPreviewItem(
  items: Array<{
    description?: string;
    kind?: "context" | "needs_more" | "proposed" | "support";
    label: string;
    values: string[];
  }>,
  label: string,
  value: string | null,
  options: { description?: string; kind?: "context" | "needs_more" | "proposed" | "support" } = {},
) {
  if (value) items.push({ ...options, label, values: [value] });
}

function addArrayPatchPreviewItem(
  items: Array<{
    description?: string;
    kind?: "context" | "needs_more" | "proposed" | "support";
    label: string;
    values: string[];
  }>,
  label: string,
  value: unknown,
  options: { description?: string; kind?: "context" | "needs_more" | "proposed" | "support" } = {},
) {
  if (!Array.isArray(value) || value.length === 0) return;
  const values = value
    .map((item) => formatPatchArrayValue(item))
    .filter((item): item is string => Boolean(item));
  if (values.length > 0) items.push({ ...options, label, values });
}

function formatPatchArrayValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const label = getFirstString(record, ["label", "name", "metric", "title", "value"]);
  const amount = getFirstString(record, ["amount", "number", "result"]);
  const source = getFirstString(record, ["source_quote", "source", "evidence"]);
  return [label, amount, source ? `source: ${source}` : null]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(" · ");
}

function getFirstString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return null;
}

function getEnrichmentPatchSourceQuote(patch: Record<string, unknown>) {
  return getStringPatchValue(patch, "source_quote") ?? getStringPatchValue(patch, "source_quote_patch");
}

type EnrichmentReferenceSources = {
  evidenceItems: EvidenceCardItem[];
  initiatives: InitiativeItem[];
  portfolioProjects: PortfolioProjectItem[];
  workExperiences: WorkExperienceItem[];
};

function buildEnrichmentProposalReferences(
  proposal: EnrichmentTaskItem["proposals"][number],
  sources: EnrichmentReferenceSources,
) {
  const { evidenceItems } = sources;
  if (proposal.proposal_type === "update_evidence") {
    const evidenceId =
      getStringPatchValue(proposal.proposed_patch_json, "evidence_id") ?? proposal.target_id;
    const evidence = evidenceItems.find((item) => item.id === evidenceId);
    return evidence
      ? [
          {
            label: "Current evidence",
            text: evidence.text,
          },
        ]
      : [];
  }

  const proposalTypesWithTargetContext = new Set([
    "create_evidence",
    "create_initiative",
    "update_initiative",
    "update_work_experience",
  ]);
  if (
    !proposalTypesWithTargetContext.has(proposal.proposal_type) ||
    !proposal.target_id ||
    !proposal.target_kind
  ) {
    return [];
  }
  const targetReference = buildTargetObjectReference(
    proposal.target_kind,
    proposal.target_id,
    sources,
  );
  const linkedEvidence = getEvidenceItemsForTarget(
    evidenceItems,
    proposal.target_kind,
    proposal.target_id,
  ).slice(0, 3);
  const evidenceReferences = linkedEvidence.map((item, index) => ({
    label: `Existing evidence ${index + 1}`,
    text: item.text,
  }));
  return targetReference ? [targetReference, ...evidenceReferences] : evidenceReferences;
}

function buildEnrichmentTaskReferences(
  task: EnrichmentTaskItem,
  sources: EnrichmentReferenceSources,
) {
  const { evidenceItems } = sources;
  if (task.evidence_item_id) {
    const evidence = evidenceItems.find((item) => item.id === task.evidence_item_id);
    return evidence
      ? [
          {
            label: "Current evidence",
            text: evidence.text,
          },
        ]
      : [];
  }

  const target = getEnrichmentTaskReferenceTarget(task);
  if (!target) return [];
  const targetReference = buildTargetObjectReference(target.kind, target.id, sources);
  const evidenceReferences = getEvidenceItemsForTarget(evidenceItems, target.kind, target.id)
    .slice(0, 3)
    .map((item, index) => ({
      label: `Existing evidence ${index + 1}`,
      text: item.text,
    }));
  return targetReference ? [targetReference, ...evidenceReferences] : evidenceReferences;
}

function getEnrichmentTaskReferenceTarget(task: EnrichmentTaskItem) {
  if (task.initiative_id) {
    return { kind: "initiative" as const, id: task.initiative_id };
  }
  if (task.portfolio_project_id) {
    return { kind: "portfolio_project" as const, id: task.portfolio_project_id };
  }
  if (task.work_experience_id) {
    return { kind: "work_experience" as const, id: task.work_experience_id };
  }
  const primaryTarget = task.targets.find((target) => target.target_role === "primary");
  if (!primaryTarget) return null;
  return {
    kind: primaryTarget.target_kind,
    id: primaryTarget.target_id,
  };
}

function getEvidenceItemsForTarget(
  evidenceItems: EvidenceCardItem[],
  targetKind: "evidence" | "initiative" | "portfolio_project" | "work_experience",
  targetId: string,
) {
  if (targetKind === "evidence") {
    return evidenceItems.filter((item) => item.id === targetId);
  }
  return evidenceItems.filter((item) => {
    if (targetKind === "initiative") return item.related_initiative_id === targetId;
    if (targetKind === "portfolio_project") return item.related_portfolio_project_id === targetId;
    return item.related_work_experience_id === targetId;
  });
}

function buildTargetObjectReference(
  targetKind: "evidence" | "initiative" | "portfolio_project" | "work_experience",
  targetId: string,
  sources: EnrichmentReferenceSources,
) {
  if (targetKind === "initiative") {
    const initiative = sources.initiatives.find((item) => item.id === targetId);
    if (!initiative) return null;
    return {
      label: `Current story · ${initiative.internal_title}`,
      text: formatStoryTargetReferenceText(initiative),
    };
  }
  if (targetKind === "portfolio_project") {
    const project = sources.portfolioProjects.find((item) => item.id === targetId);
    if (!project) return null;
    return {
      label: `Current project · ${project.title}`,
      text: formatStoryTargetReferenceText(project),
    };
  }
  if (targetKind === "work_experience") {
    const experience = sources.workExperiences.find((item) => item.id === targetId);
    if (!experience) return null;
    return {
      label: `Current role · ${experience.employer}`,
      text: formatWorkExperienceReferenceText(experience),
    };
  }
  const evidence = sources.evidenceItems.find((item) => item.id === targetId);
  return evidence ? { label: "Current evidence", text: evidence.text } : null;
}

function formatStoryTargetReferenceText(target: InitiativeItem | PortfolioProjectItem) {
  const title = "internal_title" in target ? target.internal_title : target.title;
  const parts = [
    target.external_safe_title || title,
    target.context,
    target.problem,
    target.role,
    target.actions.length ? `Actions: ${target.actions.join("; ")}` : null,
    target.results.length ? `Results: ${target.results.join("; ")}` : null,
    target.technologies.length ? `Technologies: ${target.technologies.join(", ")}` : null,
  ];
  return parts.filter((part): part is string => Boolean(part && part.trim())).join(" · ");
}

function formatWorkExperienceReferenceText(experience: WorkExperienceItem) {
  const parts = [
    experience.role_title,
    experience.team ? `Team: ${experience.team}` : null,
    experience.location ? `Location: ${experience.location}` : null,
    experience.summary,
  ];
  return parts.filter((part): part is string => Boolean(part && part.trim())).join(" · ");
}

function getStringPatchValue(patch: Record<string, unknown>, key: string) {
  const value = patch[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function addPatchLine(lines: string[], label: string, value: string | null) {
  if (value) lines.push(`${label}: ${value}`);
}

function addArrayPatchLine(lines: string[], label: string, value: unknown) {
  if (!Array.isArray(value) || value.length === 0) return;
  const rendered = value
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (item && typeof item === "object") return JSON.stringify(item);
      return null;
    })
    .filter((item): item is string => Boolean(item));
  if (rendered.length > 0) lines.push(`${label}: ${rendered.join("; ")}`);
}

function EnrichmentTaskControls({
  batchCount,
  disabled,
  filters,
  onBatchDismiss,
  onChange,
  options,
  resultCount,
  totalCount,
}: {
  batchCount: number;
  disabled: boolean;
  filters: {
    query: string;
    scope: string;
    sourceType: string;
    status: string;
    unlinkedOnly: boolean;
  };
  onBatchDismiss: () => void;
  onChange: (filters: {
    query: string;
    scope: string;
    sourceType: string;
    status: string;
    unlinkedOnly: boolean;
  }) => void;
  options: {
    scopes: string[];
    sourceTypes: string[];
    statuses: string[];
  };
  resultCount: number;
  totalCount: number;
}) {
  function update(patch: Partial<typeof filters>) {
    onChange({ ...filters, ...patch });
  }
  return (
    <section className="enrichment-task-controls" aria-label="Enrichment task filters">
      <label className="enrichment-task-controls__search">
        <span>Search tasks</span>
        <input
          value={filters.query}
          onChange={(event) => update({ query: event.target.value })}
          placeholder="Search prompt, source, target, or reason..."
        />
      </label>
      <ThemeSelect
        label="Scope"
        value={filters.scope}
        options={[
          { label: "All scopes", value: "all" },
          ...options.scopes.map((scope) => ({
            label: formatEnrichmentTaskScope(scope as EnrichmentTaskItem["target_scope"]),
            value: scope,
          })),
        ]}
        onChange={(scope) => update({ scope })}
      />
      <ThemeSelect
        label="Source"
        value={filters.sourceType}
        options={[
          { label: "All sources", value: "all" },
          ...options.sourceTypes.map((sourceType) => ({
            label: formatEnrichmentSourceType(sourceType),
            value: sourceType,
          })),
        ]}
        onChange={(sourceType) => update({ sourceType })}
      />
      <ThemeSelect
        label="Status"
        value={filters.status}
        options={[
          { label: "All status", value: "all" },
          ...options.statuses.map((status) => ({
            label: formatEnrichmentStatus(status as EnrichmentTaskItem["status"]),
            value: status,
          })),
        ]}
        onChange={(status) => update({ status })}
      />
      <ThemeToggleFilter
        active={filters.unlinkedOnly}
        label="Target"
        activeText="Needs target"
        inactiveText="Any target"
        onToggle={() => update({ unlinkedOnly: !filters.unlinkedOnly })}
      />
      <div className="enrichment-task-controls__batch">
        <span>{resultCount} of {totalCount} shown</span>
        <button
          className="secondary-button secondary-button--quiet"
          disabled={disabled || batchCount === 0}
          type="button"
          onClick={onBatchDismiss}
        >
          Dismiss {batchCount > 0 ? `${batchCount} unassigned` : "unassigned"}
        </button>
      </div>
    </section>
  );
}

function EnrichmentTaskTargetPicker({
  disabled,
  evidenceItems,
  initiatives,
  onLink,
  portfolioProjects,
  task,
  workExperiences,
}: {
  disabled: boolean;
  evidenceItems: EvidenceCardItem[];
  initiatives: InitiativeItem[];
  onLink: (anchor: EnrichmentTaskAnchorPatch) => void;
  portfolioProjects: PortfolioProjectItem[];
  task: EnrichmentTaskItem;
  workExperiences: WorkExperienceItem[];
}) {
  const selectedEvidenceId = getEnrichmentTargetId(task, "evidence");
  const selectedInitiativeId = getEnrichmentTargetId(task, "initiative");
  const selectedPortfolioProjectId = getEnrichmentTargetId(task, "portfolio_project");
  const selectedWorkExperienceId = getEnrichmentTargetId(task, "work_experience");
  return (
    <div className="enrichment-task-card__target-grid">
      <label className="source-field enrichment-task-card__destination">
        <span>Specific claim</span>
        <select
          className="jd-input jd-input--compact"
          disabled={disabled}
          onChange={(event) => {
            onLink(buildMergedEnrichmentTaskAnchor(task, "evidence", event.target.value));
          }}
          value={selectedEvidenceId ? `evidence:${selectedEvidenceId}` : ""}
        >
          <option value="">Choose a claim</option>
          {evidenceItems.slice(0, 80).map((item) => (
            item.id ? (
              <option key={`evidence:${item.id}`} value={`evidence:${item.id}`}>
                {truncateOptionText(item.text)}
              </option>
            ) : null
          ))}
        </select>
      </label>
      <label className="source-field enrichment-task-card__destination">
        <span>Project / story</span>
        <select
          className="jd-input jd-input--compact"
          disabled={disabled}
          onChange={(event) => {
            onLink(buildMergedEnrichmentTaskAnchor(task, "story", event.target.value));
          }}
          value={
            selectedInitiativeId
              ? `initiative:${selectedInitiativeId}`
              : selectedPortfolioProjectId
                ? `portfolio_project:${selectedPortfolioProjectId}`
                : ""
          }
        >
          <option value="">Choose a project or story</option>
          {initiatives.map((item) => (
            item.id ? (
              <option key={`initiative:${item.id}`} value={`initiative:${item.id}`}>
                {item.external_safe_title ?? item.internal_title}
              </option>
            ) : null
          ))}
          {portfolioProjects.map((item) => (
            item.id ? (
              <option key={`portfolio_project:${item.id}`} value={`portfolio_project:${item.id}`}>
                {item.external_safe_title ?? item.title}
              </option>
            ) : null
          ))}
        </select>
      </label>
      <label className="source-field enrichment-task-card__destination">
        <span>Role-level experience</span>
        <select
          className="jd-input jd-input--compact"
          disabled={disabled}
          onChange={(event) => {
            onLink(buildMergedEnrichmentTaskAnchor(task, "work_experience", event.target.value));
          }}
          value={selectedWorkExperienceId ? `work_experience:${selectedWorkExperienceId}` : ""}
        >
          <option value="">Choose a role</option>
          {workExperiences.map((item) => (
            item.id ? (
              <option key={`work_experience:${item.id}`} value={`work_experience:${item.id}`}>
                {item.employer} · {item.role_title}
              </option>
            ) : null
          ))}
        </select>
      </label>
    </div>
  );
}

function getEnrichmentTargetId(
  task: EnrichmentTaskItem,
  kind: EnrichmentTaskItem["targets"][number]["target_kind"],
) {
  if (kind === "evidence" && task.evidence_item_id) return task.evidence_item_id;
  if (kind === "initiative" && task.initiative_id) return task.initiative_id;
  if (kind === "portfolio_project" && task.portfolio_project_id) return task.portfolio_project_id;
  if (kind === "work_experience" && task.work_experience_id) return task.work_experience_id;
  return (
    task.targets.find(
      (target) =>
        target.target_kind === kind &&
        (target.target_role === "primary" || target.target_role === "parent"),
    )?.target_id ?? ""
  );
}

function IntakeStageHeader({
  activeIntent,
  isChoosingMaterialType,
  onChangeMaterialType,
  onReviewMaterial,
  onShowSource,
  profileGap,
  projectFormState,
  sourceFormState,
}: {
  activeIntent: MaterialEntryIntent;
  isChoosingMaterialType: boolean;
  onChangeMaterialType: () => void;
  onReviewMaterial: () => void;
  onShowSource: () => void;
  profileGap?: ProfileGapIntent | null;
  projectFormState: LocalFormState;
  sourceFormState: LocalFormState;
}) {
  const activeFormState = activeIntent === "scratch" ? projectFormState : sourceFormState;
  const sourceComplete = activeFormState === "success";
  const sourceReady = activeFormState === "ready" || activeFormState === "extracting" || sourceComplete;
  const isRunning = activeFormState === "extracting";
  const addMaterialState = isChoosingMaterialType
    ? sourceReady
      ? "complete"
      : "blocked"
    : sourceReady
      ? "complete"
      : "current";
  const createLibraryState = isChoosingMaterialType
    ? "blocked"
    : isRunning
      ? "current"
      : sourceComplete
        ? "complete"
        : sourceReady
          ? "current"
          : "blocked";
  const reviewMaterialState = isChoosingMaterialType
    ? sourceComplete
      ? "complete"
      : "blocked"
    : sourceComplete
      ? "current"
      : "blocked";
  const steps = [
    {
      label: "Material type selected",
      onSelect: onChangeMaterialType,
      state: isChoosingMaterialType ? "current" : "complete",
      summary: formatIntakeIntent(activeIntent),
    },
    {
      label: "Add material",
      onSelect: onShowSource,
      state: addMaterialState,
      summary: sourceReady ? "source ready" : "add source",
    },
    {
      label: profileGap
        ? "Save profile fact"
        : activeIntent === "scratch"
          ? "Strengthen story"
          : "Create library items",
      state: createLibraryState,
      summary: profileGap
        ? sourceComplete
          ? "saved"
          : sourceReady
            ? "ready"
            : "waiting"
        : sourceComplete
          ? "created"
          : sourceReady
            ? "ready"
            : "waiting",
    },
    {
      label: "Review material",
      onSelect: sourceComplete ? onReviewMaterial : undefined,
      state: reviewMaterialState,
      summary: sourceComplete ? "review queue" : "after creation",
    },
    {
      label: "Approve for resume",
      state: sourceComplete ? "blocked" : "blocked",
      summary: "after review",
    },
  ] satisfies Array<{
    label: string;
    onSelect?: () => void;
    state: "complete" | "current" | "blocked";
    summary: string;
  }>;
  return (
    <ol className="intake-stage-bar" aria-label="Add Material workflow">
      {steps.map((step, index) => (
        <li
          aria-current={step.state === "current" ? "step" : undefined}
          data-actionable={Boolean(step.onSelect)}
          data-state={step.state}
          key={step.label}
        >
          {step.onSelect ? (
            <button type="button" onClick={step.onSelect}>
              <span>{index + 1}</span>
              <strong>{step.label}</strong>
              <small>{step.summary}</small>
            </button>
          ) : (
            <div>
              <span>{index + 1}</span>
              <strong>{step.label}</strong>
              <small>{step.summary}</small>
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}

type LocalFormState = "unsaved" | "ready" | "extracting" | "success" | "failed";

function getLocalFormState({
  error,
  isRunning,
  ready,
  success,
}: {
  error: string | null;
  isRunning: boolean;
  ready: boolean;
  success: boolean;
}): LocalFormState {
  if (error) return "failed";
  if (isRunning) return "extracting";
  if (success) return "success";
  if (ready) return "ready";
  return "unsaved";
}

function FormStatePill({ state }: { state: LocalFormState }) {
  const label = {
    extracting: "extracting",
    failed: "failed",
    ready: "ready",
    success: "success",
    unsaved: "unsaved",
  } satisfies Record<LocalFormState, string>;
  return (
    <div className="source-stage-status" data-state={state}>
      {label[state]}
    </div>
  );
}

function formatIntakeIntent(intent: MaterialEntryIntent) {
  if (intent === "scratch") return "work notes";
  if (intent === "jd") return "JD gaps";
  return "resume";
}

function formatStatus(meta: Extract<ExtractionResponse, { data: unknown }>["meta"]) {
  if (meta.persistence?.status === "saved") {
    const storyCount =
      (meta.persistence.initiativeCount ?? 0) + (meta.persistence.portfolioProjectCount ?? 0);
    return `${meta.persistence.evidenceCount ?? 0} evidence items · ${storyCount} story targets added`;
  }
  if (meta.persistence?.reason === "missing_database_url") {
    return "Draft created · save storage is not configured";
  }
  return "Draft created";
}

async function formatLoadError(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => null)) as
    | { error?: string }
    | null;
  if (response.status === 401) {
    return "Access token required. Enter your token at the top of the page, then try again.";
  }
  return payload?.error ?? fallback;
}

function formatEvidenceActionMessage(
  action: "approve" | "approve_for_resume" | "reject" | "edit" | "mark_external_safe",
) {
  if (action === "approve") {
    return "Evidence approved. It is confirmed, but use Approve for resume before resume generation.";
  }
  if (action === "approve_for_resume") {
    return "Evidence approved for resume use. It can support main and tailored resume generation.";
  }
  if (action === "reject") {
    return "Evidence rejected. Related resume claims may need another check.";
  }
  if (action === "edit") {
    return "Evidence updated. Related resume claims may need another check.";
  }
  return "External-safe summary saved and resume/interview use enabled.";
}

function formatEnrichmentTaskType(type: string) {
  const labels: Record<string, string> = {
    impact: "Impact",
    metric: "Metric",
    ownership: "Ownership",
    public_safe_wording: "Public-safe wording",
    scope: "Scope",
    source_section_review: "Imported section",
    stakeholder: "Stakeholder",
    star: "STAR detail",
    technical_depth: "Technical depth",
  };
  return labels[type] ?? type;
}

function formatEnrichmentTaskScope(scope: EnrichmentTaskItem["target_scope"]) {
  const labels: Record<EnrichmentTaskItem["target_scope"], string> = {
    assign_later: "Profile/context question",
    evidence_detail: "Evidence question",
    profile_context: "Profile question",
    profile_fact: "Profile fact",
    role_context: "Role question",
    source_material: "Imported material",
    story_context: "Story question",
  };
  return labels[scope];
}

function formatEnrichmentSourceType(type: string) {
  const labels: Record<string, string> = {
    evidence: "evidence card",
    extraction_note: "imported note",
    jd_gap: "JD gap",
    resume_review: "resume review",
    story_target: "story target",
    user_input: "user input",
  };
  return labels[type] ?? type;
}

function formatEnrichmentTargetReason(task: EnrichmentTaskItem) {
  if (isSourceSectionReviewTask(task)) {
    return (
      task.target_reason ||
      "This imported section was saved as structured material. It is not a missing-detail question."
    );
  }
  if (!shouldRequireTargetBeforeAnswer(task)) {
    return task.target_reason || "This is a general context question. You can answer first and assign it later if needed.";
  }
  return task.target_reason || "This question needs a target before the answer can be reused safely.";
}

function formatEnrichmentExpectedOutcome(task: EnrichmentTaskItem) {
  if (isSourceSectionReviewTask(task)) {
    return "be reviewed as imported material before it becomes specific evidence or story updates.";
  }
  if (task.target_scope === "assign_later") {
    return "be saved as context first, then reviewed before it becomes reusable evidence.";
  }
  if (task.target_scope === "evidence_detail") {
    return "be used to create or strengthen material for this specific claim.";
  }
  if (task.target_scope === "story_context") {
    return "be used to create or strengthen material under this project/story.";
  }
  if (task.target_scope === "role_context") {
    return "be used to clarify role-level context before it supports claims.";
  }
  return "be used as source material for future evidence review.";
}

function formatEnrichmentStatus(status: EnrichmentTaskItem["status"]) {
  if (status === "answered") return "answer saved";
  if (status === "converted") return "draft saved";
  if (status === "dismissed") return "dismissed";
  return "open";
}

function formatEnrichmentTaskStatus(task: EnrichmentTaskItem) {
  if (task.status === "converted") {
    if (task.resolution_kind === "profile_answer_saved") return "profile answer saved";
    if (task.resolution_kind === "acknowledged") return "confirmed";
    if (task.resolution_kind === "profile_fact_updated") return "profile fact updated";
    if (task.resolution_kind === "role_field_updated") return "role field updated";
    if (task.resolution_kind === "import_reviewed") return "import reviewed";
    if (task.resolution_kind === "rerun_requested") return "rerun requested";
    if (task.resolution_kind === "converted_to_enrichment_question") return "converted to question";
  }
  return formatEnrichmentStatus(task.status);
}

function formatEnrichmentProposalType(
  type: EnrichmentTaskItem["proposals"][number]["proposal_type"],
) {
  const labels: Record<EnrichmentTaskItem["proposals"][number]["proposal_type"], string> = {
    create_evidence: "Create new draft evidence",
    update_evidence: "Update evidence",
    create_initiative: "Create story",
    update_initiative: "Update story",
    update_work_experience: "Update role",
    clarify_assignment: "Save context",
    link_evidence_to_story: "Link evidence to story",
    link_story_to_role: "Clarify role link",
  };
  return labels[type];
}

function formatEnrichmentProposalStatus(
  status: EnrichmentTaskItem["proposals"][number]["status"],
) {
  if (status === "pending_review") return "ready to review";
  if (status === "accepted") return "accepted";
  return "discarded";
}

function proposalTypePreviewForTask(
  task: EnrichmentTaskItem,
): EnrichmentTaskItem["proposals"][number]["proposal_type"] {
  if (
    task.expected_outcome === "update_evidence" ||
    task.evidence_item_id
  ) {
    return "update_evidence";
  }
  if (task.expected_outcome === "create_evidence") return "create_evidence";
  if (
    task.expected_outcome === "update_story" ||
    task.initiative_id ||
    task.portfolio_project_id
  ) {
    return "update_initiative";
  }
  if (task.expected_outcome === "update_role" || task.work_experience_id) {
    return "update_work_experience";
  }
  return "clarify_assignment";
}

function formatEnrichmentTaskWorkspaceTitle(
  type: EnrichmentTaskItem["proposals"][number]["proposal_type"],
) {
  if (type === "create_evidence") return "Prepare a draft evidence update";
  if (type === "update_evidence") return "Prepare an evidence update";
  if (type === "update_initiative" || type === "create_initiative") return "Prepare a story update";
  if (type === "update_work_experience") return "Prepare a role update";
  return "Save profile context";
}

function formatEnrichmentDraftLabel(
  type: EnrichmentTaskItem["proposals"][number]["proposal_type"],
) {
  if (type === "create_evidence") return "New draft evidence";
  if (type === "update_evidence") return "Updated evidence draft";
  if (type === "update_initiative" || type === "create_initiative") {
    return "Suggested story update";
  }
  if (type === "update_work_experience") return "Suggested role update";
  return "Profile context";
}

function formatEnrichmentProposalNextStep(
  type: EnrichmentTaskItem["proposals"][number]["proposal_type"],
) {
  if (type === "create_evidence") {
    return "Accepting creates a new draft evidence card. Resume use still requires a separate review and approval.";
  }
  if (type === "update_evidence") {
    return "Accepting updates the existing evidence draft. Resume use still requires a separate review and approval.";
  }
  if (type === "update_initiative" || type === "create_initiative") {
    return "Accepting applies this as story context. It will not become resume evidence until linked to a concrete claim.";
  }
  if (type === "update_work_experience") {
    return "Accepting applies this as role context. It will not become resume evidence by itself.";
  }
  return "Accepting saves this as profile context. Choose a target later before creating evidence.";
}

function formatEnrichmentPreProposalNextStep(
  task: EnrichmentTaskItem,
  type: EnrichmentTaskItem["proposals"][number]["proposal_type"],
) {
  if (isProfileContextTask(task)) {
    return "Save this answer as profile direction. It will not become evidence or a resume claim.";
  }
  if (isAssignLaterRoutingTask(task)) {
    return "Choose a target first. This answer cannot become reusable material until JobDesk knows where it belongs.";
  }
  if (type === "create_evidence") {
    return "Generate a suggested draft evidence update from your answer. Nothing changes until you review and accept it.";
  }
  if (type === "update_evidence") {
    return "Generate a suggested evidence change from your answer. Nothing changes until you review and accept it.";
  }
  if (type === "update_initiative" || type === "create_initiative") {
    return "Generate a suggested story change from your answer. Nothing changes until you review and accept it.";
  }
  if (type === "update_work_experience") {
    return "Generate a suggested role change from your answer. Nothing changes until you review and accept it.";
  }
  return "Generate a suggested update from your answer. Nothing changes until you review and accept it.";
}

function formatPrimaryAnswerCta(
  task: EnrichmentTaskItem,
  type: EnrichmentTaskItem["proposals"][number]["proposal_type"],
  status: EnrichmentTaskItem["status"],
  pendingAction?: EnrichmentPendingAction | null,
) {
  if (pendingAction === "generate") return "Generating update...";
  if (pendingAction === "save_context") return "Saving answer...";
  if (isProfileContextTask(task)) return status === "answered" ? "Update saved answer" : "Save answer";
  if (isAssignLaterRoutingTask(task)) return "Choose target first";
  if (type === "clarify_assignment") return "Save answer";
  if (status === "answered") return "Regenerate suggested update";
  return "Generate suggested update";
}

function formatEnrichmentAnswerWorkspaceHelp(
  task: EnrichmentTaskItem,
  type: EnrichmentTaskItem["proposals"][number]["proposal_type"],
  answerSaved: boolean,
) {
  if (isProfileContextTask(task)) {
    return answerSaved
      ? "Saved as profile direction. It will not create evidence or change a resume by itself."
      : "Answer with preference or positioning context. Saving completes this task.";
  }
  if (isAssignLaterRoutingTask(task)) {
    return "Choose a target before JobDesk turns this answer into reusable evidence, story context, or role context.";
  }
  if (answerSaved) {
    return "Generate a suggested update from this answer. Nothing changes until you review and accept it.";
  }
  if (type === "create_evidence") {
    return "Answer with concrete facts, metrics, scope, or source wording. JobDesk will generate a suggested update for review.";
  }
  if (type === "update_evidence") {
    return "Answer with the missing detail or correction. JobDesk will generate a suggested evidence change before anything is saved.";
  }
  if (type === "update_initiative" || type === "create_initiative") {
    return "Add project context such as scope, actions, tools, results, or missing metrics. JobDesk will preview the story change first.";
  }
  if (type === "update_work_experience") {
    return "Add role-level context such as team, scope, timeframe, or ownership. JobDesk will preview the role change first.";
  }
  return "Answer with your preference or context. This will be saved first, not turned into resume evidence.";
}

function formatEnrichmentConversationPlaceholder(
  task: EnrichmentTaskItem,
  type: EnrichmentTaskItem["proposals"][number]["proposal_type"],
) {
  if (isProfileContextTask(task)) {
    return "Answer with your preference, direction, or emphasis. This will guide your profile, not create evidence.";
  }
  if (isAssignLaterRoutingTask(task)) {
    return "Choose where this belongs before writing a reusable evidence or story update.";
  }
  if (type === "create_evidence" || type === "update_evidence") {
    return "Add facts or instructions, e.g. make this focus on backend ownership and remove dashboard wording.";
  }
  if (type === "update_initiative" || type === "create_initiative") {
    return "Add story context or instructions, e.g. connect this to the onboarding analytics project and focus on metric definition.";
  }
  if (type === "update_work_experience") {
    return "Add role-level context or instructions, e.g. clarify team scope, timeframe, or ownership.";
  }
  return "Tell JobDesk where this answer belongs, or ask it to make the next step more specific.";
}

function formatEnrichmentRevisionPlaceholder(
  type: EnrichmentTaskItem["proposals"][number]["proposal_type"],
) {
  if (type === "create_evidence" || type === "update_evidence") {
    return "Tell JobDesk what to change in this evidence suggestion.";
  }
  if (type === "update_initiative" || type === "create_initiative") {
    return "Tell JobDesk what to change in this story suggestion.";
  }
  if (type === "update_work_experience") {
    return "Tell JobDesk what to change in this role suggestion.";
  }
  return "Tell JobDesk how to refine this context.";
}

function taskHasReusableLibraryAnchor(task: EnrichmentTaskItem) {
  return Boolean(
    task.evidence_item_id ||
      task.work_experience_id ||
      task.initiative_id ||
      task.portfolio_project_id,
  );
}

function shouldRequireTargetBeforeAnswer(task: EnrichmentTaskItem) {
  if (isSourceSectionReviewTask(task)) return false;
  return isAssignLaterRoutingTask(task);
}

function isProfileContextTask(task: EnrichmentTaskItem) {
  return task.target_scope === "profile_context" || task.expected_outcome === "save_profile_answer";
}

function isAssignLaterRoutingTask(task: EnrichmentTaskItem) {
  return task.target_scope === "assign_later" || task.expected_outcome === "route_answer";
}

function isSourceSectionReviewTask(task: EnrichmentTaskItem) {
  return (
    Boolean(task.note_kind && task.expected_action !== "answer_enrichment_question") ||
    task.task_type === "source_section_review" ||
    task.expected_outcome === "review_imported_material" ||
    (task.source_type === "extraction_note" && looksLikeImportedReviewNote(task.prompt)) ||
    (task.source_type === "extraction_note" &&
      task.target_scope === "source_material" &&
      looksLikeSourceSectionNote(task.prompt))
  );
}

function looksLikeImportedReviewNote(prompt: string) {
  const normalized = prompt.trim().toLowerCase().replace(/\s+/g, " ");
  return (
    looksLikeSourceSectionNote(prompt) ||
    /\breturned\s+at\s+most\s+\d+\b/.test(normalized) ||
    /\bomitted\s+additional\b/.test(normalized) ||
    /\bclassified\s+as\s+[a-z_]+\s+because\b/.test(normalized) ||
    /\bnot\s+under\s+an\s+employer\b/.test(normalized) ||
    /\bnot\s+user-facing\b/.test(normalized) ||
    /\bcapped\s+at\s+\d+\b/.test(normalized)
  );
}

function looksLikeSourceSectionNote(prompt: string) {
  const normalized = prompt.trim().toLowerCase().replace(/\s+/g, " ");
  return (
    /\b(work\s+experience|work\s+experiences|experience|education|skills?|projects?|certifications?|summary|profile)\s+section\b/.test(normalized) ||
    /\b(extraction|extracted|imported)\s+notes?\b/.test(normalized) ||
    /\bthese\s+story\s+fragments\s+were\s+merged\b/.test(normalized) ||
    /\bwere\s+merged;\s*please\s+review\b/.test(normalized) ||
    /\b(entries|items|details)\s+were\s+extracted\s+from\s+the\s+.+\s+section\b/.test(normalized) ||
    /\b.+\s+was\s+extracted\s+from\s+the\s+.+\s+section\b/.test(normalized) ||
    /\bextracted\s+from\s+the\s+.+\s+section\b/.test(normalized)
  );
}

function extractSourceSectionName(prompt: string) {
  const match =
    prompt.match(/from the\s+(.+?)\s+section/i) ??
    prompt.match(/from\s+(.+?)\s+section/i);
  return match?.[1]?.replace(/[.。]+$/, "").trim() || null;
}

function toEnrichmentTaskAnchorValue(task: EnrichmentTaskItem) {
  if (task.evidence_item_id) return `evidence:${task.evidence_item_id}`;
  if (task.initiative_id) return `initiative:${task.initiative_id}`;
  if (task.portfolio_project_id) return `portfolio_project:${task.portfolio_project_id}`;
  if (task.work_experience_id) return `work_experience:${task.work_experience_id}`;
  return "";
}

function parseEnrichmentTaskAnchorValue(value: string): EnrichmentTaskAnchorPatch {
  const [kind, id] = value.split(":");
  return {
    evidenceItemId: kind === "evidence" ? id : null,
    initiativeId: kind === "initiative" ? id : null,
    portfolioProjectId: kind === "portfolio_project" ? id : null,
    workExperienceId: kind === "work_experience" ? id : null,
  };
}

function buildMergedEnrichmentTaskAnchor(
  task: EnrichmentTaskItem,
  field: "evidence" | "story" | "work_experience",
  value: string,
): EnrichmentTaskAnchorPatch {
  const current: EnrichmentTaskAnchorPatch = {
    evidenceItemId: getEnrichmentTargetId(task, "evidence") || null,
    initiativeId: getEnrichmentTargetId(task, "initiative") || null,
    portfolioProjectId: getEnrichmentTargetId(task, "portfolio_project") || null,
    workExperienceId: getEnrichmentTargetId(task, "work_experience") || null,
  };
  if (!value) {
    if (field === "evidence") current.evidenceItemId = null;
    if (field === "story") {
      current.initiativeId = null;
      current.portfolioProjectId = null;
    }
    if (field === "work_experience") current.workExperienceId = null;
    return current;
  }
  const next = parseEnrichmentTaskAnchorValue(value);
  if (field === "evidence") current.evidenceItemId = next.evidenceItemId ?? null;
  if (field === "story") {
    current.initiativeId = next.initiativeId ?? null;
    current.portfolioProjectId = next.portfolioProjectId ?? null;
  }
  if (field === "work_experience") current.workExperienceId = next.workExperienceId ?? null;
  return current;
}

function formatEnrichmentTaskAnchor(
  task: EnrichmentTaskItem,
  evidenceItems: EvidenceCardItem[],
  linkTargets: EvidenceLinkTargets,
) {
  if (task.evidence_item_id) {
    const item = evidenceItems.find((candidate) => candidate.id === task.evidence_item_id);
    return item ? `Evidence · ${truncateOptionText(item.text, 72)}` : "Evidence item";
  }
  if (task.initiative_id) {
    const item = linkTargets.initiatives.find((candidate) => candidate.id === task.initiative_id);
    return item
      ? `Initiative · ${item.external_safe_title ?? item.internal_title}`
      : "Initiative";
  }
  if (task.portfolio_project_id) {
    const item = linkTargets.portfolioProjects.find((candidate) => candidate.id === task.portfolio_project_id);
    return item ? `Portfolio · ${item.external_safe_title ?? item.title}` : "Portfolio project";
  }
  if (task.work_experience_id) {
    const item = linkTargets.workExperiences.find((candidate) => candidate.id === task.work_experience_id);
    return item ? `Role · ${item.employer} · ${item.role_title}` : "Work experience";
  }
  return "Not linked yet";
}

function formatEnrichmentTaskParent(
  task: EnrichmentTaskItem,
  linkTargets: EvidenceLinkTargets,
) {
  const parentTargets = task.targets.filter((target) => target.target_role === "parent");
  const primaryTargets = task.targets.filter((target) => target.target_role === "primary");
  const candidates = parentTargets.length ? parentTargets : primaryTargets.slice(1);
  const labels = candidates
    .map((target) => formatEnrichmentTargetPayload(target, linkTargets))
    .filter(Boolean);
  return labels.length ? labels.join(" · ") : "No parent context yet";
}

function formatEnrichmentTargetPayload(
  target: EnrichmentTaskItem["targets"][number],
  linkTargets: EvidenceLinkTargets,
) {
  if (target.target_kind === "initiative") {
    const item = linkTargets.initiatives.find((candidate) => candidate.id === target.target_id);
    return item ? `Project/story · ${item.external_safe_title ?? item.internal_title}` : "Project/story";
  }
  if (target.target_kind === "portfolio_project") {
    const item = linkTargets.portfolioProjects.find((candidate) => candidate.id === target.target_id);
    return item ? `Portfolio story · ${item.external_safe_title ?? item.title}` : "Portfolio story";
  }
  if (target.target_kind === "work_experience") {
    const item = linkTargets.workExperiences.find((candidate) => candidate.id === target.target_id);
    return item ? `Role · ${item.employer} · ${item.role_title}` : "Role";
  }
  if (target.target_kind === "evidence") return "Specific claim";
  return "";
}

function truncateOptionText(value: string, maxLength = 96) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function groupEnrichmentTasks(tasks: EnrichmentTaskItem[]) {
  const sourceSectionTasks = tasks.filter(isSourceSectionReviewTask);
  const normalTasks = tasks.filter((task) => !isSourceSectionReviewTask(task));
  const order = ["resume_review", "extraction_note", "evidence", "jd_gap", "story_target", "user_input"];
  const labels: Record<string, string> = {
    evidence: "From Evidence Card",
    extraction_note: "From Imported Notes",
    jd_gap: "From JD Gap",
    resume_review: "From Resume Review",
    story_target: "From Story Target",
    user_input: "From User Input",
  };
  const groups = order
    .map((key) => ({
      key,
      label: labels[key] ?? key,
      tasks: normalTasks.filter((task) => task.source_type === key),
    }))
    .filter((group) => group.tasks.length > 0);
  if (sourceSectionTasks.length > 0) {
    groups.unshift({
      key: "source_section_review",
      label: "Imported Material to Review",
      tasks: sourceSectionTasks,
    });
  }
  return groups;
}

function filterEnrichmentTasks(
  tasks: EnrichmentTaskItem[],
  filters: {
    query: string;
    scope: string;
    sourceType: string;
    status: string;
    unlinkedOnly: boolean;
  },
) {
  const query = filters.query.trim().toLowerCase();
  return tasks.filter((task) => {
    if (filters.scope !== "all" && task.target_scope !== filters.scope) return false;
    if (filters.sourceType !== "all" && task.source_type !== filters.sourceType) return false;
    if (filters.status !== "all" && task.status !== filters.status) return false;
    if (filters.unlinkedOnly && taskHasReusableLibraryAnchor(task)) return false;
    if (!query) return true;
    return [
      task.prompt,
      task.source_label,
      task.source_type,
      task.target_reason ?? "",
      task.expected_outcome,
      task.target_scope,
      task.user_answer ?? "",
    ]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
}

function buildEnrichmentTaskFilterOptions(tasks: EnrichmentTaskItem[]) {
  return {
    scopes: Array.from(new Set(tasks.map((task) => task.target_scope))).sort(),
    sourceTypes: Array.from(new Set(tasks.map((task) => task.source_type))).sort(),
    statuses: Array.from(new Set(tasks.map((task) => task.status))).sort(),
  };
}

function getEntryGuidance(intent: MaterialEntryIntent) {
  if (intent === "scratch") {
    return {
      enrichmentHint:
        "Use project notes, design docs, performance reviews, or guided answers to create or strengthen work stories.",
      fileImportLabel: "Import work files",
      primaryActionLabel: "Add to library",
      primaryHint:
        "Use this path with or without an initial resume. Guided answers are often the fastest start.",
      primaryTitleLabel: "Material title",
      summary:
        "Add work notes, files, or guided answers to create stronger story material. Focus on context, ownership, actions, outcomes, metrics, and public-safe wording.",
    };
  }
  if (intent === "jd") {
    return {
      enrichmentHint:
        "After JD analysis exposes missing evidence, add project notes or source docs here to close those gaps.",
      fileImportLabel: "Import gap notes",
      primaryActionLabel: "Add gap material",
      primaryHint:
        "JD-first starts in Jobs. Use this library when the tailored draft needs stronger evidence or missing project context.",
      primaryTitleLabel: "Evidence gap title",
      summary:
        "JD-first is a quick path: analyze the role in Jobs first, then return here to fill evidence gaps with source-backed material.",
    };
  }
  return {
    enrichmentHint:
      "Add project notes, design docs, performance reviews, or accomplishment drafts to turn thin resume signals into richer project stories and stronger evidence.",
      fileImportLabel: "Reviewed resume source",
    primaryActionLabel: "Create library items",
    primaryHint:
      "Select a resume that has already been processed in Resume Review. Upload new resumes from Resume Review first.",
      primaryTitleLabel: "Reviewed resume title",
    summary:
      "Start from an already reviewed resume, then turn it into reusable material for evidence and resume generation.",
  };
}

function summarizeLibraryReadiness({
  cleanupCount,
  evidenceItems,
  initiatives,
  portfolioProjects,
  projectCards,
  workExperiences,
}: {
  cleanupCount: number;
  evidenceItems: EvidenceCardItem[];
  initiatives: InitiativeItem[];
  portfolioProjects: PortfolioProjectItem[];
  projectCards: ProjectCardItem[];
  workExperiences: WorkExperienceItem[];
}) {
  const storyTargets = [...initiatives, ...portfolioProjects];
  const storyReadyProjects = storyTargets.filter(
    (target) => getStoryReadiness(target).state === "story_ready",
  ).length;
  const projectsNeedingContext = storyTargets.filter(
    (target) => getStoryReadiness(target).state !== "story_ready",
  ).length;
  const resumeReadyEvidence = evidenceItems.filter(
    (item) => getEvidenceReadiness(item).state === "resume_ready",
  ).length;
  const evidenceNeedingReview = evidenceItems.filter(
    (item) => getEvidenceReadiness(item).state !== "resume_ready",
  ).length;
  let nextActionTitle = "Add source material";
  let nextActionDetail = "Upload a resume or paste project notes to start the library.";
  if (evidenceItems.length > 0 && evidenceNeedingReview > 0) {
    nextActionTitle = "Review evidence claims";
    nextActionDetail = "Approve supported claims for resume use before tailoring.";
  } else if (storyTargets.length > 0 && projectsNeedingContext > 0) {
    nextActionTitle = "Enrich story context";
    nextActionDetail = "Add docs, review notes, metrics, or guided answers for thin initiatives/projects.";
  } else if (workExperiences.length > 0 && storyTargets.length === 0) {
    nextActionTitle = "Extract initiatives";
    nextActionDetail = "Work experiences exist, but need initiative/story cards before resume generation.";
  } else if (resumeReadyEvidence > 0) {
    nextActionTitle = "Generate resume";
    nextActionDetail = "Use the approved library to create a main resume or a JD-tailored draft.";
  }
  return {
    cleanupCount,
    evidenceNeedingReview,
    nextActionDetail,
    nextActionTitle,
    projectsNeedingContext,
    resumeReadyEvidence,
    storyReadyProjects,
    storyTargetCount: storyTargets.length,
  };
}

function getProjectReadiness(project: ProjectCardItem) {
  return getStoryReadiness(project);
}

function getStoryReadiness(
  project: ProjectCardItem | InitiativeItem | PortfolioProjectItem,
) {
  const actionCount = project.actions.filter(Boolean).length;
  const resultCount = project.results.filter(Boolean).length;
  const hasMetric = (project.metrics ?? []).length > 0;
  const hasCoreStory = Boolean(project.context || project.problem) && Boolean(project.role);
  if (hasCoreStory && actionCount > 0 && resultCount > 0 && hasMetric) {
    return {
      label: "Story-ready",
      state: "story_ready" as const,
      next: "Ready for STAR stories and stronger resume bullets.",
    };
  }
  if (hasCoreStory || actionCount > 0 || resultCount > 0) {
    return {
      label: "Needs context",
      state: "needs_context" as const,
      next: "Add missing problem, role, actions, results, and metrics.",
    };
  }
  return {
    label: "Thin signal",
    state: "thin" as const,
    next: "Add project background or upload a detailed source document.",
  };
}

function getStoryMissingFields(
  project: ProjectCardItem | InitiativeItem | PortfolioProjectItem,
) {
  const missing = [];
  if (!project.context) missing.push("context");
  if (!project.problem) missing.push("problem");
  if (!project.role) missing.push("ownership / role");
  if (project.actions.filter(Boolean).length === 0) missing.push("actions");
  if (project.results.filter(Boolean).length === 0) missing.push("results");
  if ((project.metrics ?? []).length === 0) missing.push("metrics");
  if ("public_safe_summary" in project && !project.public_safe_summary) {
    missing.push("public-safe wording");
  } else if ("external_safe_summary" in project && !project.external_safe_summary) {
    missing.push("public-safe wording");
  }
  return missing;
}

function isStoryEnrichmentTarget(
  project: StoryEnrichmentTarget | {
    title: string;
    context?: string | null;
    problem?: string | null;
    role?: string | null;
    actions?: string[];
    results?: string[];
  },
): project is StoryEnrichmentTarget {
  return "targetType" in project && Boolean(project.targetId);
}

function getEvidenceReadiness(item: EvidenceCardItem) {
  if (isResumeReadyEvidence(item)) {
    const usesSafeSummary = item.sensitivity_level !== "public_safe" && Boolean(item.public_safe_summary?.trim());
    return {
      label: usesSafeSummary ? "Resume-ready via safe wording" : "Resume-ready",
      state: "resume_ready" as const,
      next: usesSafeSummary
        ? "Resume generation will use the public-safe wording, not the private source text."
        : "Can support main resume or tailored resume generation.",
    };
  }
  if (item.status === "approved") {
    return {
      label: "Approved",
      state: "approved" as const,
      next: "Approve for resume use or add an external-safe summary if needed.",
    };
  }
  return {
    label: "Needs review",
    state: "needs_review" as const,
    next: "Review truth, sensitivity, and allowed usage before using it.",
  };
}

function filterEvidenceLibraryItems(
  items: EvidenceCardItem[],
  filters: EvidenceLibraryFilters,
  linkTargets: EvidenceLinkTargets,
  projects: ProjectCardItem[],
) {
  const query = filters.query.trim().toLowerCase();
  return items.filter((item) => {
    if (query) {
      const haystack = [
        item.text,
        item.source_quote,
        item.evidence_type,
        item.sensitivity_level,
        formatEvidenceLinkedTarget(item, linkTargets, projects),
        formatReusableUsage(item),
        formatEvidenceAssetStatus(item),
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    if (filters.usage !== "all" && !(item.allowed_usage ?? []).includes(filters.usage)) {
      return false;
    }
    if (filters.status !== "all") {
      const readiness = getEvidenceReadiness(item).state;
      if (filters.status === "resume_ready" && readiness !== "resume_ready") return false;
      if (filters.status === "approved" && item.status !== "approved") return false;
      if (filters.status === "needs_review" && readiness === "resume_ready") return false;
      if (
        filters.status !== "resume_ready" &&
        filters.status !== "approved" &&
        filters.status !== "needs_review" &&
        item.status !== filters.status
      ) {
        return false;
      }
    }
    if (filters.sensitivity !== "all" && item.sensitivity_level !== filters.sensitivity) {
      return false;
    }
    if (filters.source !== "all") {
      const source = item.source_document_id ? `source:${item.source_document_id}` : "source:extracted";
      if (source !== filters.source) return false;
    }
    if (filters.roleOrStory !== "all" && !evidenceMatchesTargetFilter(item, filters.roleOrStory)) {
      return false;
    }
    if (filters.hasMetricOnly && !evidenceLooksMetricBacked(item)) return false;
    if (filters.unlinkedOnly && !isEvidenceUnlinked(item)) return false;
    return true;
  });
}

function buildEvidenceLibraryFilterOptions(
  items: EvidenceCardItem[],
  linkTargets: EvidenceLinkTargets,
  projects: ProjectCardItem[],
) {
  const rolesAndStories = buildEvidenceTargetOptions(linkTargets, projects);
  const sensitivities = Array.from(new Set(items.map((item) => item.sensitivity_level))).sort();
  const statuses = Array.from(
    new Set([
      ...items.map((item) => item.status),
      "resume_ready",
      "approved",
    ]),
  ).sort();
  const usages = Array.from(new Set(items.flatMap((item) => item.allowed_usage ?? []))).sort();
  const sourceIds = Array.from(
    new Set(items.map((item) => item.source_document_id).filter((id): id is string => Boolean(id))),
  );
  const sources = [
    ...(items.some((item) => !item.source_document_id)
      ? [{ label: "Extracted source", value: "source:extracted" }]
      : []),
    ...sourceIds.map((id, index) => ({
      label: `Source document ${index + 1}`,
      value: `source:${id}`,
    })),
  ];
  return { rolesAndStories, sensitivities, sources, statuses, usages };
}

function evidenceMatchesTargetFilter(item: EvidenceCardItem, value: string) {
  const [kind, id] = value.split(":");
  if (!id) return false;
  if (kind === "initiative") return item.related_initiative_id === id;
  if (kind === "portfolio_project") return item.related_portfolio_project_id === id;
  if (kind === "work_experience") return item.related_work_experience_id === id;
  if (kind === "legacy_project") return item.related_project_id === id;
  return false;
}

function evidenceLooksMetricBacked(item: EvidenceCardItem) {
  return /\b\d+[%x]?\b|\bpercent\b|\bhours?\b|\bweeks?\b|\busers?\b|\brevenue\b|\bcost\b/i.test(
    `${item.text} ${item.source_quote}`,
  );
}

function isEvidenceUnlinked(item: EvidenceCardItem) {
  return (
    !item.related_work_experience_id &&
    !item.related_initiative_id &&
    !item.related_portfolio_project_id &&
    !item.related_project_id
  );
}

function isResumeReadyEvidence(item: EvidenceCardItem) {
  return (
    item.status === "approved" &&
    !item.needs_user_confirmation &&
    (item.allowed_usage ?? []).includes("resume") &&
    hasExternalSafeDisclosure(item)
  );
}

function isReusableReadyEvidence(item: EvidenceCardItem) {
  const reusableUsages = new Set(["resume", "interview", "cover_letter"]);
  return (
    item.status === "approved" &&
    !item.needs_user_confirmation &&
    hasExternalSafeDisclosure(item) &&
    (item.allowed_usage ?? []).some((usage) => reusableUsages.has(usage))
  );
}

function formatStoryReadinessLabel(readiness: StarStory["readiness"]) {
  if (readiness === "ready") return "Ready";
  if (readiness === "needs_review") return "Needs review";
  return "Needs context";
}

function formatEvidenceTypeLabel(type: string) {
  return formatFilterLabel(type);
}

function formatFilterLabel(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function hasExternalSafeDisclosure(item: EvidenceCardItem) {
  return Boolean(getPublicSafeSummaryCandidate(item));
}

function getPublicSafeSummaryCandidate(item: EvidenceCardItem) {
  const summary = item.public_safe_summary?.trim();
  if (summary) return summary;
  if (item.sensitivity_level === "public_safe" && isClientPublicSafeText(item.text)) {
    return item.text;
  }
  return "";
}

function isClientPublicSafeText(text: string) {
  return getClientUnsafeMatches(text).length === 0;
}

function getClientUnsafeMatches(text: string) {
  const checks = [
    { label: "confidential wording", pattern: /\bconfidential\b/gi },
    { label: "internal-only wording", pattern: /\binternal[-\s]?only\b/gi },
    { label: "named client", pattern: /\bclient\s+[A-Z][A-Za-z0-9&.-]+\b/g },
    { label: "named customer", pattern: /\bcustomer\s+[A-Z][A-Za-z0-9&.-]+\b/g },
    { label: "codename/project name", pattern: /\bproject\s+[A-Z][A-Za-z0-9&.-]+\b/g },
    {
      label: "specific company/client name",
      pattern: /\b[A-Z][A-Za-z0-9&.-]+\s+(?:Bank|Finance|Capital|Labs|Corp|Inc|LLC)\b/g,
    },
  ];
  return checks.flatMap((check) =>
    Array.from(text.matchAll(check.pattern)).map((match) => ({
      label: check.label,
      text: match[0],
    })),
  );
}

function getEvidenceSafetyNote(item: EvidenceCardItem) {
  if (getPublicSafeSummaryCandidate(item)) return "";
  const matches = getClientUnsafeMatches(`${item.text} ${item.source_quote}`);
  if (matches.length > 0) {
    const unique = Array.from(new Map(matches.map((match) => [match.text, match])).values());
    const preview = unique
      .slice(0, 3)
      .map((match) => `"${match.text}" (${match.label})`)
      .join(", ");
    return `Needs safe wording because this claim/source includes ${preview}.`;
  }
  if (item.sensitivity_level === "sensitive") {
    return "Needs safe wording because the extracted evidence is marked sensitive.";
  }
  if (item.sensitivity_level === "private") {
    return "Needs safe wording because this evidence is private until you confirm an external-safe summary.";
  }
  return "";
}

function formatReusableUsage(item: EvidenceCardItem) {
  const allowedUsage = item.allowed_usage ?? [];
  if (allowedUsage.length === 0) return "Not approved for reuse yet";
  return allowedUsage
    .map((usage) => usage.replace(/_/g, " "))
    .map((usage) => usage.charAt(0).toUpperCase() + usage.slice(1))
    .join(", ");
}

function formatEvidenceSource(item: EvidenceCardItem) {
  if (item.source_document_id) return "Source document";
  return "Extracted source";
}

function formatEvidenceLinkedTarget(
  item: EvidenceCardItem,
  linkTargets?: EvidenceLinkTargets,
  legacyProjects: ProjectCardItem[] = [],
) {
  if (item.related_initiative_id) {
    const initiative = linkTargets?.initiatives.find(
      (target) => target.id === item.related_initiative_id,
    );
    return initiative
      ? initiative.external_safe_title ?? initiative.internal_title
      : "initiative";
  }
  if (item.related_portfolio_project_id) {
    const project = linkTargets?.portfolioProjects.find(
      (target) => target.id === item.related_portfolio_project_id,
    );
    return project ? project.external_safe_title ?? project.title : "portfolio project";
  }
  if (item.related_work_experience_id) {
    const experience = linkTargets?.workExperiences.find(
      (target) => target.id === item.related_work_experience_id,
    );
    return experience
      ? `${experience.employer} · ${experience.role_title}`
      : "work experience";
  }
  if (item.related_project_id) {
    const project = legacyProjects.find((target) => target.id === item.related_project_id);
    return project ? project.title : "legacy project";
  }
  return "general profile";
}

function formatEvidenceAssetStatus(item: EvidenceCardItem) {
  if (
    item.status === "approved" &&
    !item.needs_user_confirmation &&
    (item.allowed_usage ?? []).includes("resume")
  ) {
    return "Approved for resume";
  }
  if (item.status === "approved" && !item.needs_user_confirmation) {
    return "User-confirmed";
  }
  if (item.status === "rejected") return "Rejected";
  return "Draft evidence";
}

function formatEvidenceMissingInfo(item: EvidenceCardItem) {
  const missing = [];
  if (item.status !== "approved" || item.needs_user_confirmation) {
    missing.push("user confirmation");
  }
  if (!(item.allowed_usage ?? []).includes("resume")) {
    missing.push("resume usage");
  }
  if (!getPublicSafeSummaryCandidate(item)) {
    missing.push("public-safe wording");
  }
  if (
    !item.related_work_experience_id &&
    !item.related_initiative_id &&
    !item.related_portfolio_project_id &&
    !item.related_project_id
  ) {
    missing.push("story link");
  }
  if ((item.enrichment_task_count ?? 0) > 0) {
    missing.push(
      `${item.enrichment_task_count} enrichment task${item.enrichment_task_count === 1 ? "" : "s"}`,
    );
  }
  return missing.length ? missing.join(", ") : "none";
}

function formatRelativeDate(value?: string | null) {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown";
  return date.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
  });
}

function formatSourceQuotePreview(quote: string) {
  const normalized = quote.replace(/\s+/g, " ").trim();
  if (!normalized) return "No source quote captured";
  return normalized.length > 120 ? `${normalized.slice(0, 117)}...` : normalized;
}

function getEvidenceBlocker(item: EvidenceCardItem) {
  const allowedUsage = item.allowed_usage ?? [];
  if (item.status !== "approved") {
    return {
      action: "approve_for_resume" as const,
      label: !getPublicSafeSummaryCandidate(item)
        ? "Review safe wording"
        : "Review claim",
      reason:
        !getPublicSafeSummaryCandidate(item)
          ? "Public-safe wording is required before this can support a resume."
          : "Truth review is still pending.",
    };
  }
  if (item.needs_user_confirmation) {
    return {
      action: "approve_for_resume" as const,
      label: !getPublicSafeSummaryCandidate(item)
        ? "Review safe wording"
        : "Confirm claim",
      reason:
        !getPublicSafeSummaryCandidate(item)
          ? "Public-safe wording is required before this can support a resume."
          : "User confirmation is required before resume use.",
    };
  }
  if (!getPublicSafeSummaryCandidate(item)) {
    return {
      action: "mark_external_safe" as const,
      label: "Review external-safe wording",
      reason: "Sensitive evidence needs external-safe wording.",
    };
  }
  if (item.sensitivity_level !== "public_safe") {
    return {
      action: "mark_external_safe" as const,
      label: "Approve external-safe wording",
      reason: "Confirm the public-safe summary before resume use.",
    };
  }
  if (!allowedUsage.includes("resume")) {
    return {
      action: "approve_for_resume" as const,
      label: "Enable resume use",
      reason: "Resume usage has not been enabled.",
    };
  }
  return {
    action: "edit" as const,
    label: "Edit",
    reason: "Resume-ready.",
  };
}

function estimateLinkedEvidenceCount(project: ProjectCardItem, evidenceItems: EvidenceCardItem[]) {
  return getProjectEvidence(project, evidenceItems).length;
}

function getProjectEvidence(project: ProjectCardItem, evidenceItems: EvidenceCardItem[]) {
  if (!project.id) return [];
  return evidenceItems.filter((item) => item.related_project_id === project.id);
}

function evidenceMatchesFocus(item: EvidenceCardItem, focus: NonNullable<EvidenceFocus>) {
  if (focus.targetType === "initiative") {
    return item.related_initiative_id === focus.targetId;
  }
  if (focus.targetType === "portfolio_project") {
    return item.related_portfolio_project_id === focus.targetId;
  }
  return item.related_project_id === focus.targetId;
}

function starStoryMatchesFocus(story: StarStory, focus: NonNullable<StarStoryFocus>) {
  return story.story_target_type === focus.targetType && story.story_target_id === focus.targetId;
}

function getUnlinkedEvidenceItems(
  targets: EvidenceLinkTargets,
  evidenceItems: EvidenceCardItem[],
) {
  const projectIds = new Set(
    targets.projects.map((project) => project.id).filter((id): id is string => Boolean(id)),
  );
  const workExperienceIds = new Set(
    targets.workExperiences
      .map((experience) => experience.id)
      .filter((id): id is string => Boolean(id)),
  );
  const initiativeIds = new Set(
    targets.initiatives
      .map((initiative) => initiative.id)
      .filter((id): id is string => Boolean(id)),
  );
  const portfolioProjectIds = new Set(
    targets.portfolioProjects
      .map((project) => project.id)
      .filter((id): id is string => Boolean(id)),
  );
  return evidenceItems.filter(
    (item) =>
      !(item.related_project_id && projectIds.has(item.related_project_id)) &&
      !(
        item.related_work_experience_id &&
        workExperienceIds.has(item.related_work_experience_id)
      ) &&
      !(item.related_initiative_id && initiativeIds.has(item.related_initiative_id)) &&
      !(
        item.related_portfolio_project_id &&
        portfolioProjectIds.has(item.related_portfolio_project_id)
      ),
  );
}

function formatOverlapTitle(candidate: DedupeCandidate) {
  if (candidate.reasons.includes("same source quote")) {
    return "Same source quote";
  }
  if (candidate.score >= 0.999) {
    return "Exact text match";
  }
  return `Wording similarity ${Math.round(candidate.score * 100)}%`;
}

function formatStoryOverlapTitle(candidate: StoryDedupeCandidate) {
  if (candidate.score >= 0.999) {
    return "Exact story title match";
  }
  return `Story similarity ${Math.round(candidate.score * 100)}%`;
}

function DedupePanel({
  evidenceCandidates,
  onEvidenceKeepSeparate,
  onEvidenceMerge,
  onStoryKeepSeparate,
  onStoryMerge,
  onRefresh,
  storyCandidates,
}: {
  evidenceCandidates: DedupeCandidate[];
  onEvidenceKeepSeparate: (candidate: DedupeCandidate) => Promise<void>;
  onEvidenceMerge: (candidate: DedupeCandidate) => void;
  onStoryKeepSeparate: (candidate: StoryDedupeCandidate) => Promise<void>;
  onStoryMerge: (candidate: StoryDedupeCandidate) => Promise<void>;
  onRefresh: () => void;
  storyCandidates: StoryDedupeCandidate[];
}) {
  const [activeOverlap, setActiveOverlap] = useState<"stories" | "evidence">("stories");
  const activeCount =
    activeOverlap === "stories" ? storyCandidates.length : evidenceCandidates.length;
  return (
    <section className="section-block">
      <div className="requirement__top">
        <h3>Possible overlap cleanup</h3>
        <button className="secondary-button" type="button" onClick={onRefresh}>
          Refresh overlaps
        </button>
      </div>
      <p className="requirement__quote">
        Review story-target overlaps separately from evidence-level overlaps.
        Story cleanup supports keep-separate decisions now; evidence merge keeps one
        atomic claim and rejects the duplicate claim.
      </p>
      <div className="filter-row" role="group" aria-label="Overlap cleanup type">
        <button
          data-active={activeOverlap === "stories"}
          type="button"
          onClick={() => setActiveOverlap("stories")}
        >
          Story overlaps ({storyCandidates.length})
        </button>
        <button
          data-active={activeOverlap === "evidence"}
          type="button"
          onClick={() => setActiveOverlap("evidence")}
        >
          Evidence overlaps ({evidenceCandidates.length})
        </button>
      </div>
      {activeCount === 0 ? (
        <p className="requirement__quote">
          No {activeOverlap === "stories" ? "story" : "evidence"} overlaps need review right now.
        </p>
      ) : activeOverlap === "stories" ? (
        <StoryOverlapPanel
          candidates={storyCandidates}
          onKeepSeparate={onStoryKeepSeparate}
          onMerge={onStoryMerge}
        />
      ) : (
        <EvidenceOverlapPanel
          candidates={evidenceCandidates}
          onKeepSeparate={onEvidenceKeepSeparate}
          onMerge={onEvidenceMerge}
        />
      )}
    </section>
  );
}

function StoryOverlapPanel({
  candidates,
  onKeepSeparate,
  onMerge,
}: {
  candidates: StoryDedupeCandidate[];
  onKeepSeparate: (candidate: StoryDedupeCandidate) => Promise<void>;
  onMerge: (candidate: StoryDedupeCandidate) => Promise<void>;
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [messageById, setMessageById] = useState<Record<string, string>>({});
  async function keepSeparate(candidate: StoryDedupeCandidate) {
    const key = `${candidate.primary.id}-${candidate.duplicate.id}`;
    setPendingId(key);
    setMessageById((messages) => ({
      ...messages,
      [key]: "Saving keep-separate decision...",
    }));
    try {
      await onKeepSeparate(candidate);
      setMessageById((messages) => ({
        ...messages,
        [key]: "Kept as separate story targets.",
      }));
    } catch (caught) {
      setMessageById((messages) => ({
        ...messages,
        [key]: caught instanceof Error ? caught.message : "Keep-separate decision failed.",
      }));
    } finally {
      setPendingId(null);
    }
  }
  async function merge(candidate: StoryDedupeCandidate) {
    const key = `${candidate.primary.id}-${candidate.duplicate.id}`;
    setPendingId(key);
    setMessageById((messages) => ({
      ...messages,
      [key]: "Merging story targets...",
    }));
    try {
      await onMerge(candidate);
      setMessageById((messages) => ({
        ...messages,
        [key]: "Merged into the kept story.",
      }));
    } catch (caught) {
      setMessageById((messages) => ({
        ...messages,
        [key]: caught instanceof Error ? caught.message : "Story merge failed.",
      }));
    } finally {
      setPendingId(null);
    }
  }
  return (
    <div className="result-stack result-stack--inner">
      {candidates.map((candidate) => {
        const key = `${candidate.primary.id}-${candidate.duplicate.id}`;
        const isPending = pendingId === key;
        return (
          <article className="requirement overlap-card" key={key}>
            <div className="requirement__top">
              <div>
                <p className="requirement__text">Possible duplicate story target</p>
                <p className="requirement__quote">
                  {formatStoryOverlapTitle(candidate)} · {candidate.duplicateCount} duplicate
                  target{candidate.duplicateCount === 1 ? "" : "s"} ·{" "}
                  {candidate.reasons.join(", ")}
                </p>
              </div>
              <span className="requirement__type">
                {candidate.primary.storyType.replaceAll("_", " ")} overlap
              </span>
            </div>
            <div className="overlap-project-grid">
              <StoryOverlapSummary label="Primary target" story={candidate.primary} />
              <StoryOverlapSummary label="Possible duplicate" story={candidate.duplicate} />
            </div>
            <div className="actions actions--compact">
              {candidate.primary.storyType === "initiative" ? (
                <button
                  className="primary-button"
                  disabled={Boolean(pendingId)}
                  type="button"
                  onClick={() => void merge(candidate)}
                >
                  {isPending ? "Merging..." : "Merge stories"}
                </button>
              ) : null}
              <button
                className="secondary-button"
                disabled={Boolean(pendingId)}
                type="button"
                onClick={() => void keepSeparate(candidate)}
              >
                {isPending ? "Saving..." : "Keep separate"}
              </button>
            </div>
            {messageById[key] ? <p className="card-message">{messageById[key]}</p> : null}
          </article>
        );
      })}
    </div>
  );
}

function StoryOverlapSummary({
  label,
  story,
}: {
  label: string;
  story: StoryDedupeItem;
}) {
  const signals = [
    story.context,
    story.problem,
    story.role,
    ...story.actions.slice(0, 2),
    ...story.results.slice(0, 2),
  ].filter((item): item is string => Boolean(item));
  return (
    <div className="overlap-project">
      <span>{label}</span>
      <strong>{story.title}</strong>
      {story.internalTitle && story.internalTitle !== story.title ? (
        <p>Internal: {story.internalTitle}</p>
      ) : null}
      {signals.length > 0 ? (
        <ul>
          {signals.slice(0, 4).map((signal) => (
            <li key={signal}>{signal}</li>
          ))}
        </ul>
      ) : (
        <p>No story details captured yet.</p>
      )}
    </div>
  );
}

function EvidenceOverlapPanel({
  candidates,
  onKeepSeparate,
  onMerge,
}: {
  candidates: DedupeCandidate[];
  onKeepSeparate: (candidate: DedupeCandidate) => Promise<void>;
  onMerge: (candidate: DedupeCandidate) => void;
}) {
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [messageById, setMessageById] = useState<Record<string, string>>({});
  async function keepSeparate(candidate: DedupeCandidate) {
    const key = `${candidate.primary.id}-${candidate.duplicate.id}`;
    setPendingId(key);
    setMessageById((messages) => ({
      ...messages,
      [key]: "Saving keep-separate decision...",
    }));
    try {
      await onKeepSeparate(candidate);
      setMessageById((messages) => ({
        ...messages,
        [key]: "Kept as separate evidence claims.",
      }));
      setReviewingId(null);
    } catch (caught) {
      setMessageById((messages) => ({
        ...messages,
        [key]: caught instanceof Error ? caught.message : "Keep-separate decision failed.",
      }));
    } finally {
      setPendingId(null);
    }
  }
  return (
    <div className="result-stack result-stack--inner">
      {candidates.map((candidate) => {
        const key = `${candidate.primary.id}-${candidate.duplicate.id}`;
        const isReviewing = reviewingId === key;
        const isPending = pendingId === key;
        return (
          <article className="requirement overlap-card" key={key}>
            <div className="requirement__top">
              <div>
                <p className="requirement__text">Possible duplicate evidence</p>
                <p className="requirement__quote">
                  {formatOverlapTitle(candidate)} · {candidate.reasons.join(", ")}
                </p>
              </div>
              <span className="requirement__type">evidence overlap</span>
            </div>
            <div className="overlap-project-grid">
              <EvidenceOverlapSummary label="Kept evidence" item={candidate.primary} />
              <EvidenceOverlapSummary label="Merged-away evidence" item={candidate.duplicate} />
            </div>
            <div className="actions actions--compact">
              <button
                className="secondary-button"
                disabled={Boolean(pendingId)}
                type="button"
                onClick={() => setReviewingId(isReviewing ? null : key)}
              >
                {isReviewing ? "Hide merge review" : "Review merge"}
              </button>
              <button
                className="secondary-button"
                disabled={Boolean(pendingId)}
                type="button"
                onClick={() => void keepSeparate(candidate)}
              >
                {isPending ? "Saving..." : "Keep separate"}
              </button>
            </div>
            {isReviewing ? (
              <div className="merge-review">
                <p className="requirement__text">Merge confirmation</p>
                <p className="requirement__quote">
                  Keep the first evidence claim, merge safe metadata into it, reject
                  the duplicate claim, and flag related resume claims for another check.
                </p>
                <div className="merge-review__facts">
                  <span>Kept status: {candidate.primary.status}</span>
                  <span>Duplicate status: {candidate.duplicate.status}</span>
                  <span>Kept usage: {candidate.primary.allowed_usage.join(", ") || "none"}</span>
                  <span>
                    Duplicate usage: {candidate.duplicate.allowed_usage.join(", ") || "none"}
                  </span>
                </div>
                <div className="actions actions--compact">
                  <button
                    className="primary-button"
                    disabled={Boolean(pendingId)}
                    type="button"
                    onClick={() => onMerge(candidate)}
                  >
                    Confirm evidence merge
                  </button>
                </div>
              </div>
            ) : null}
            {messageById[key] ? <p className="card-message">{messageById[key]}</p> : null}
          </article>
        );
      })}
    </div>
  );
}

function EvidenceOverlapSummary({
  item,
  label,
}: {
  item: DedupeCandidate["primary"];
  label: string;
}) {
  return (
    <div className="overlap-project">
      <span>{label}</span>
      <strong>{item.text}</strong>
      <p>Status: {item.status}</p>
      <p>Usage: {item.allowed_usage.join(", ") || "none"}</p>
      <p>Sensitivity: {item.sensitivity_level}</p>
    </div>
  );
}

function StarStoryPanel({
  focus,
  onImproveStory,
  onRefresh,
  stories,
}: {
  focus: StarStoryFocus;
  onImproveStory: (project: ProjectCardItem) => void;
  onRefresh: () => void;
  stories: StarStory[];
}) {
  const focusedStories = focus
    ? stories.filter((story) => starStoryMatchesFocus(story, focus))
    : [];
  const visibleStories = focus
    ? [...focusedStories, ...stories.filter((story) => !starStoryMatchesFocus(story, focus))]
    : stories;
  return (
    <section className="section-block interview-stories">
      <div className="section-block__top">
        <div>
          <h3>Interview Stories</h3>
          <p>Reusable STAR stories generated from approved stories and evidence.</p>
          {focus ? (
            <p>
              Focus: {focus.title} · {focusedStories.length > 0 ? "matched story first" : "no generated STAR story yet"}
            </p>
          ) : null}
        </div>
        <button className="secondary-button" type="button" onClick={onRefresh}>
          Refresh stories
        </button>
      </div>
      {stories.length === 0 ? (
        <p className="requirement__quote">
          No initiatives or portfolio projects are ready to promote into STAR stories yet.
        </p>
      ) : (
        <div className="interview-story-grid">
          {visibleStories.slice(0, 4).map((story) => (
            <article
              className="interview-story-card"
              data-focused={focus ? starStoryMatchesFocus(story, focus) : undefined}
              key={story.id}
            >
              <div className="interview-story-card__top">
                <div>
                  <span>Behavioral interview story</span>
                  <strong>{story.title}</strong>
                </div>
                <em data-readiness={story.readiness}>
                  {formatStoryReadinessLabel(story.readiness)}
                </em>
              </div>
              {story.internal_title && story.internal_title !== story.title ? (
                <p className="interview-story-card__caption">Internal title: {story.internal_title}</p>
              ) : null}
              <dl className="interview-story-card__star">
                <div>
                  <dt>S</dt>
                  <dd>{story.situation || "Situation needs clearer context."}</dd>
                </div>
                <div>
                  <dt>T</dt>
                  <dd>{story.task || "Task needs clearer responsibility framing."}</dd>
                </div>
                <div>
                  <dt>A</dt>
                  <dd>
                    {story.action.length > 0
                      ? story.action.slice(0, 3).join(" · ")
                      : "Actions need more detail."}
                  </dd>
                </div>
                <div>
                  <dt>R</dt>
                  <dd>
                    {story.result.length > 0
                      ? story.result.slice(0, 3).join(" · ")
                      : "Result needs evidence-backed impact."}
                  </dd>
                </div>
              </dl>
              {story.external_safe_summary ? (
                <p className="interview-story-card__summary">
                  External-safe: {story.external_safe_summary}
                </p>
              ) : null}
              <div className="interview-story-card__meta">
                <span>Evidence backing: {story.evidence_count} claims</span>
                <span>Type: {story.story_target_type.replaceAll("_", " ")}</span>
              </div>
              <div className="chip-row">
                {story.metrics.slice(0, 3).map((metric) => (
                  <span className="chip" key={metric}>
                    {metric}
                  </span>
                ))}
                {story.interview_angles.map((angle) => (
                  <span className="chip" key={angle}>
                    {angle}
                  </span>
                ))}
              </div>
              {story.gaps.length > 0 ? (
                <div className="interview-story-card__gaps">
                  <span>Gaps</span>
                  <p>{story.gaps.slice(0, 3).join(" · ")}</p>
                </div>
              ) : null}
              {story.story_target_type === "legacy_project" ? (
                <div className="actions actions--compact">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={() =>
                      onImproveStory({
                        id: story.project_id,
                        title: story.title,
                        context: story.situation,
                        problem: story.task,
                        role: null,
                        actions: story.action,
                        results: story.result,
                        metrics: story.metrics.map((metric) => ({
                          value: metric,
                          source_quote: metric,
                        })),
                        technologies: story.technologies,
                        stakeholders: story.stakeholders,
                        public_safe_summary: story.external_safe_summary,
                        sensitivity_level: "private",
                        status: story.status,
                      })
                    }
                  >
                    Improve story
                  </button>
                </div>
              ) : (
                <div className="actions actions--compact">
                  <button className="secondary-button" type="button" disabled>
                    Use in interview prep
                  </button>
                  <button className="secondary-button" type="button" disabled>
                    View evidence
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function EvidenceList({
  description = "Review claims before using them in resumes or interviews.",
  emptyMessage = "No evidence has been created yet.",
  items,
  linkTargets,
  mode = "review",
  onUpdate,
  projects,
  title = "Evidence Claims",
}: {
  description?: string;
  emptyMessage?: string;
  items: EvidenceCardItem[];
  mode?: "library" | "review";
  onUpdate: (
    item: EvidenceCardItem,
    action: EvidenceUpdateAction,
    patch?: EvidenceUpdatePatch,
  ) => Promise<{ ok: boolean; message: string }>;
  linkTargets?: EvidenceLinkTargets;
  projects?: ProjectCardItem[];
  title?: string;
}) {
  type EvidenceListFilter = "needs_review" | "approved" | "resume_ready" | "all";
  const [filter, setFilter] = useState<EvidenceListFilter>(mode === "library" ? "all" : "needs_review");
  const [showAll, setShowAll] = useState(false);
  const [pendingEvidenceId, setPendingEvidenceId] = useState<string | null>(null);
  const [cardMessages, setCardMessages] = useState<Record<string, { ok: boolean; text: string }>>(
    {},
  );
  const libraryItems = mode === "library" ? items.filter(isReusableReadyEvidence) : items;
  const counts = {
    all: libraryItems.length,
    approved: libraryItems.filter((item) => item.status === "approved").length,
    resume_ready: libraryItems.filter(isResumeReadyEvidence).length,
    needs_review: items.filter(
      (item) =>
        item.status !== "approved" ||
        item.needs_user_confirmation ||
        !(item.allowed_usage ?? []).includes("resume"),
    ).length,
  };
  const baseItems = mode === "library" ? libraryItems : items;
  const filteredItems = baseItems.filter((item) => {
    if (filter === "all") return true;
    if (filter === "approved") return item.status === "approved";
    if (filter === "resume_ready") {
      return isResumeReadyEvidence(item);
    }
    return (
      item.status !== "approved" ||
      item.needs_user_confirmation ||
      !(item.allowed_usage ?? []).includes("resume")
    );
  });
  const filterOptions: Array<{ id: EvidenceListFilter; label: string; count: number }> =
    mode === "library"
      ? [
          { id: "all", label: "All reusable", count: counts.all },
          { id: "resume_ready", label: "Resume-ready", count: counts.resume_ready },
          { id: "approved", label: "Approved", count: counts.approved },
        ]
      : [
          { id: "needs_review", label: "Needs review", count: counts.needs_review },
          { id: "resume_ready", label: "Resume-ready", count: counts.resume_ready },
          { id: "approved", label: "Approved", count: counts.approved },
          { id: "all", label: "All", count: counts.all },
        ];
  const visibleItems = showAll ? filteredItems : filteredItems.slice(0, 6);
  async function handleUpdate(
    item: (typeof items)[number],
    action: EvidenceUpdateAction,
    patch?: EvidenceUpdatePatch,
  ) {
    if (!item.id) return;
    setPendingEvidenceId(item.id);
    setCardMessages((messages) => ({
      ...messages,
      [item.id as string]: { ok: true, text: "Updating..." },
    }));
    try {
      const result = await onUpdate(item, action, patch);
      setCardMessages((messages) => ({
        ...messages,
        [item.id as string]: { ok: result.ok, text: result.message },
      }));
    } finally {
      setPendingEvidenceId(null);
    }
  }
  if (items.length === 0) {
    return (
      <section className="section-block evidence-review">
        <div className="section-block__top">
          <div>
            <h3>
              {title}
              <HelpHint text={description} />
            </h3>
          </div>
          <span>0 total</span>
        </div>
        <p className="requirement__quote">{emptyMessage}</p>
      </section>
    );
  }
  return (
    <section className="section-block evidence-review">
      <div className="section-block__top">
        <div>
          <h3>
            {title}
            <HelpHint text={description} />
          </h3>
        </div>
        <span>
          {mode === "library"
            ? `${counts.resume_ready} resume-ready · ${counts.all} reusable`
            : `${counts.needs_review} need review · ${counts.resume_ready} resume-ready · ${counts.all} total`}
        </span>
      </div>
      <div className="filter-row" role="group" aria-label="Evidence filters">
        {filterOptions.map((option) => (
          <button
            data-active={filter === option.id}
            key={option.id}
            type="button"
            onClick={() => {
              setFilter(option.id);
              setShowAll(false);
            }}
          >
            {option.label} ({option.count})
          </button>
        ))}
      </div>
      {filteredItems.length === 0 ? (
        <p className="requirement__quote">
          {mode === "library"
            ? "No reusable evidence matches this filter. Review pending claims in Work Queue."
            : "No evidence matches this filter."}
        </p>
      ) : null}
      <div className="evidence-row-table result-stack--inner">
        {visibleItems.map((item, index) => {
          return (
            <EvidenceCard
              cardMessage={item.id ? cardMessages[item.id] : null}
              isUpdating={item.id ? pendingEvidenceId === item.id : false}
              item={item}
              key={item.id ?? `${item.source_quote}-${index}`}
              linkTargets={linkTargets}
              onUpdate={handleUpdate}
              projects={projects}
            />
          );
        })}
      </div>
      {filteredItems.length > 6 ? (
        <button
          className="secondary-button evidence-review__toggle"
          type="button"
          onClick={() => setShowAll((current) => !current)}
        >
          {showAll ? "Show fewer" : `Show all ${filteredItems.length}`}
        </button>
      ) : null}
    </section>
  );
}

function buildEvidenceTargetOptions(
  linkTargets?: EvidenceLinkTargets,
  legacyProjects: ProjectCardItem[] = [],
) {
  const targets: Array<{ label: string; value: string }> = [];
  for (const experience of linkTargets?.workExperiences ?? []) {
    if (!experience.id) continue;
    targets.push({
      label: `Work experience · ${experience.employer} · ${experience.role_title}`,
      value: `work_experience:${experience.id}`,
    });
  }
  for (const initiative of linkTargets?.initiatives ?? []) {
    if (!initiative.id) continue;
    targets.push({
      label: `Work initiative · ${initiative.external_safe_title ?? initiative.internal_title}`,
      value: `initiative:${initiative.id}`,
    });
  }
  for (const project of linkTargets?.portfolioProjects ?? []) {
    if (!project.id) continue;
    targets.push({
      label: `Portfolio project · ${project.external_safe_title ?? project.title}`,
      value: `portfolio_project:${project.id}`,
    });
  }
  for (const project of legacyProjects) {
    if (!project.id) continue;
    targets.push({
      label: `Legacy project · ${project.title}`,
      value: `legacy_project:${project.id}`,
    });
  }
  return targets;
}

function toEvidenceTargetValue(item: EvidenceCardItem) {
  if (item.related_initiative_id) return `initiative:${item.related_initiative_id}`;
  if (item.related_portfolio_project_id) {
    return `portfolio_project:${item.related_portfolio_project_id}`;
  }
  if (item.related_work_experience_id) {
    return `work_experience:${item.related_work_experience_id}`;
  }
  if (item.related_project_id) return `legacy_project:${item.related_project_id}`;
  return "";
}

function toEvidenceTargetPatch(target: string, legacyProjectId = "") {
  const [kind, id] = target.split(":");
  return {
    relatedInitiativeId: kind === "initiative" ? id : null,
    relatedPortfolioProjectId: kind === "portfolio_project" ? id : null,
    relatedProjectId: kind === "legacy_project" ? id : legacyProjectId || null,
    relatedWorkExperienceId: kind === "work_experience" ? id : null,
  };
}

function EvidenceCard({
  cardMessage,
  isUpdating,
  item,
  linkTargets,
  onUpdate,
  projects = [],
  variant = "default",
}: {
  cardMessage?: { ok: boolean; text: string } | null;
  isUpdating?: boolean;
  item: EvidenceCardItem;
  onUpdate: (
    item: EvidenceCardItem,
    action: EvidenceUpdateAction,
    patch?: EvidenceUpdatePatch,
  ) => void;
  linkTargets?: EvidenceLinkTargets;
  projects?: ProjectCardItem[];
  variant?: "default" | "nested";
}) {
  const readiness = getEvidenceReadiness(item);
  const blocker = getEvidenceBlocker(item);
  const linkedTarget = formatEvidenceLinkedTarget(item, linkTargets, projects);
  const missingInfo = formatEvidenceMissingInfo(item);
  const safetyNote = getEvidenceSafetyNote(item);
  const publicSafeSummary = getPublicSafeSummaryCandidate(item);
  const displayText =
    readiness.state === "resume_ready" && publicSafeSummary ? publicSafeSummary : item.text;
  const hasPrivateSourceText =
    readiness.state === "resume_ready" &&
    item.sensitivity_level !== "public_safe" &&
    Boolean(publicSafeSummary);
  const [isEditing, setIsEditing] = useState(false);
  const [draftText, setDraftText] = useState(item.text);
  const [draftSummary, setDraftSummary] = useState(item.public_safe_summary ?? "");
  const [draftSensitivity, setDraftSensitivity] = useState(item.sensitivity_level);
  const [draftProjectId, setDraftProjectId] = useState(item.related_project_id ?? "");
  const [draftTarget, setDraftTarget] = useState(() => toEvidenceTargetValue(item));
  const [draftAllowedUsage, setDraftAllowedUsage] = useState<string[]>(
    item.allowed_usage ?? [],
  );
  const [safeSuggestion, setSafeSuggestion] =
    useState<ExternalSafeSummarySuggestion | null>(null);
  const [safeSuggestionStatus, setSafeSuggestionStatus] = useState<string | null>(null);
  const [isSuggestingSafeSummary, setIsSuggestingSafeSummary] = useState(false);

  useEffect(() => {
    setDraftText(item.text);
    setDraftSummary(item.public_safe_summary ?? "");
    setDraftSensitivity(item.sensitivity_level);
    setDraftProjectId(item.related_project_id ?? "");
    setDraftTarget(toEvidenceTargetValue(item));
    setDraftAllowedUsage(item.allowed_usage ?? []);
    setSafeSuggestion(null);
    setSafeSuggestionStatus(null);
  }, [
    item.allowed_usage,
    item.public_safe_summary,
    item.related_initiative_id,
    item.related_portfolio_project_id,
    item.related_project_id,
    item.related_work_experience_id,
    item.sensitivity_level,
    item.text,
  ]);

  function toggleAllowedUsage(usage: string) {
    setDraftAllowedUsage((current) =>
      current.includes(usage)
        ? current.filter((item) => item !== usage)
        : [...current, usage],
    );
  }

  function submitEdit(externalSafe = false) {
    if (!draftText.trim()) return;
    onUpdate(item, externalSafe ? "mark_external_safe" : "edit", {
      allowedUsage: draftAllowedUsage,
      publicSafeSummary: draftSummary.trim() || null,
      ...toEvidenceTargetPatch(draftTarget, draftProjectId),
      sensitivityLevel: externalSafe ? "public_safe" : draftSensitivity,
      text: draftText.trim(),
    });
    setIsEditing(false);
  }

  function openPublicSafeConfirmation() {
    setDraftSummary(getPublicSafeSummaryCandidate(item) || item.public_safe_summary || "");
    setDraftAllowedUsage((current) =>
      Array.from(new Set([...current.filter((usage) => usage !== "internal_only"), "resume", "interview"])),
    );
    setIsEditing(true);
  }

  async function suggestSafeSummary() {
    if (!item.id) return;
    setIsSuggestingSafeSummary(true);
    setSafeSuggestionStatus(null);
    try {
      const response = await fetch(`/api/evidence/${item.id}/external-safe-summary`, {
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as
        | { data?: ExternalSafeSummarySuggestion; error?: string }
        | null;
      if (!response.ok || !payload?.data) {
        setSafeSuggestionStatus(payload?.error ?? "Could not generate safe wording.");
        return;
      }
      setSafeSuggestion(payload.data);
      setDraftSummary(payload.data.safeSummary);
      setDraftAllowedUsage((current) =>
        Array.from(new Set([...current.filter((usage) => usage !== "internal_only"), "resume", "interview"])),
      );
      setSafeSuggestionStatus(
        payload.data.provider === "ai"
          ? "AI suggested external-safe wording. Review before saving."
          : "Suggested wording needs review before saving.",
      );
    } finally {
      setIsSuggestingSafeSummary(false);
    }
  }

  if (variant === "nested") {
    return (
      <article className="requirement evidence-subcard">
        <div className="requirement__top">
          <p className="requirement__text">{displayText}</p>
          <span className="requirement__type">{readiness.label}</span>
        </div>
        <p className="requirement__quote">{readiness.next}</p>
        <p className="requirement__quote">Status: {item.status}</p>
        <p className="requirement__quote">Use: {formatReusableUsage(item)}</p>
        <p className="requirement__quote">From: {formatEvidenceSource(item)}</p>
        <p className="requirement__quote">For: {linkedTarget}</p>
        <p className="requirement__quote">Missing info: {missingInfo}</p>
        <p className="requirement__quote">Quote: {item.source_quote}</p>
        {item.public_safe_summary ? (
          <p className="requirement__quote">External-safe: {item.public_safe_summary}</p>
        ) : null}
      </article>
    );
  }

  return (
    <article className="evidence-row">
      <div className="evidence-row__main">
        <div className="evidence-row__content">
          <span>{item.evidence_type}</span>
          <strong>{displayText}</strong>
          <div className="evidence-row__meta">
            <span>{readiness.label}</span>
            <small>For {linkedTarget}</small>
          </div>
          {hasPrivateSourceText ? (
            <p className="evidence-row__safety-note">
              Private source retained. Resume uses the public-safe wording above.
            </p>
          ) : null}
        </div>
        <div className="evidence-row__action">
          <button
            className="primary-button"
            disabled={isUpdating || !item.id}
            type="button"
            onClick={() => {
              if (!item.id) return;
              if (blocker.action === "edit") {
                setIsEditing((current) => !current);
              } else if (blocker.action === "mark_external_safe") {
                if (!getPublicSafeSummaryCandidate(item)) {
                  openPublicSafeConfirmation();
                  return;
                }
                onUpdate(item, "mark_external_safe");
              } else {
                if (!getPublicSafeSummaryCandidate(item)) {
                  openPublicSafeConfirmation();
                  return;
                }
                onUpdate(item, "approve_for_resume");
              }
            }}
          >
            {blocker.action === "edit"
              ? isEditing
                ? "Close review"
                : "Review/edit"
              : blocker.label}
          </button>
        </div>
      </div>
      {cardMessage ? (
        <p className={cardMessage.ok ? "card-message" : "card-message card-message--error"}>
          {cardMessage.text}
        </p>
      ) : null}
      <details className="evidence-row__details" {...(isEditing ? { open: true } : {})}>
        <summary>More</summary>
        <div className="evidence-row__detail-grid">
          <p>Why: {blocker.reason}</p>
          <p>Missing: {missingInfo}</p>
          <p>Sensitivity: {formatFilterLabel(item.sensitivity_level)}</p>
          <p>From: {formatEvidenceSource(item)}</p>
          <p>Use: {formatReusableUsage(item)}</p>
          <p>Status: {formatEvidenceAssetStatus(item)}</p>
          <p>Updated: {formatRelativeDate(item.updatedAt)}</p>
          {hasPrivateSourceText ? <p>Private source text: {item.text}</p> : null}
          <p>Quote: {formatSourceQuotePreview(item.source_quote)}</p>
          {publicSafeSummary ? (
            <p>Public-safe wording: {publicSafeSummary}</p>
          ) : null}
        </div>
        {safetyNote ? <p className="evidence-row__safety-note">{safetyNote}</p> : null}
        {item.id ? (
        <div className="actions actions--compact evidence-row__secondary-actions">
          <button
            className="secondary-button"
            disabled={isUpdating}
            type="button"
            onClick={() => onUpdate(item, "approve")}
          >
            Approve
          </button>
          <button
            className="secondary-button"
            disabled={isUpdating}
            type="button"
            onClick={() => setIsEditing((current) => !current)}
          >
            {isEditing ? "Close edit" : "Edit"}
          </button>
          <button
            className="secondary-button"
            disabled={isUpdating}
            type="button"
            onClick={() => onUpdate(item, "reject")}
          >
            Reject
          </button>
          <button
            className="secondary-button"
            disabled={isUpdating}
            type="button"
            onClick={() => {
              if (!getPublicSafeSummaryCandidate(item)) {
                openPublicSafeConfirmation();
                return;
              }
              onUpdate(item, "mark_external_safe");
            }}
          >
            Review external-safe wording
          </button>
          {item.status !== "approved" ||
          item.needs_user_confirmation ||
          !(item.allowed_usage ?? []).includes("resume") ? (
            <button
              className="secondary-button"
              disabled={isUpdating}
              type="button"
              onClick={() => {
                if (!getPublicSafeSummaryCandidate(item)) {
                  openPublicSafeConfirmation();
                  return;
                }
                onUpdate(item, "approve_for_resume");
              }}
            >
              {!getPublicSafeSummaryCandidate(item)
                ? "Review safe wording first"
                : "Approve for resume"}
            </button>
          ) : null}
        </div>
        ) : null}
        {isEditing ? (
        <div className="inline-editor">
          <div className="safe-wording-review">
            <div>
              <span>External-safe review</span>
              <p>Review safe wording before resume or interview use.</p>
            </div>
            {safetyNote ? <p className="safe-wording-review__reason">{safetyNote}</p> : null}
            {safeSuggestion?.blockedTerms.length ? (
              <div className="safe-wording-review__terms">
                {safeSuggestion.blockedTerms.map((term) => (
                  <span key={term}>{term}</span>
                ))}
              </div>
            ) : null}
            {safeSuggestion?.redactionReport.diff.length ? (
              <div className="safe-wording-review__diff">
                {safeSuggestion.redactionReport.diff.slice(0, 4).map((entry) => (
                  <p key={`${entry.from}-${entry.to}`}>
                    <strong>{entry.from}</strong> → {entry.to}
                    {entry.reason ? <small>{entry.reason}</small> : null}
                  </p>
                ))}
              </div>
            ) : null}
            <div className="actions actions--compact">
              <button
                className="secondary-button"
                disabled={isSuggestingSafeSummary || isUpdating || !item.id}
                type="button"
                onClick={suggestSafeSummary}
              >
                {isSuggestingSafeSummary ? "Suggesting..." : "Suggest safe wording"}
              </button>
            </div>
            {safeSuggestionStatus ? <p className="form-note">{safeSuggestionStatus}</p> : null}
          </div>
          <label>
            Evidence text
            <textarea
              value={draftText}
              onChange={(event) => setDraftText(event.target.value)}
            />
          </label>
          <label>
            External-safe summary
            <textarea
              value={draftSummary}
              onChange={(event) => setDraftSummary(event.target.value)}
              placeholder="Review or generate public-safe wording before resume use."
            />
          </label>
          <div className="inline-editor__grid">
            <label>
              Sensitivity
              <select
                value={draftSensitivity}
                onChange={(event) => setDraftSensitivity(event.target.value)}
              >
                <option value="public_safe">public_safe</option>
                <option value="private">private</option>
                <option value="sensitive">sensitive</option>
              </select>
            </label>
            <label>
              Link to story target
              <select
                value={draftTarget || (draftProjectId ? `legacy_project:${draftProjectId}` : "")}
                onChange={(event) => {
                  setDraftTarget(event.target.value);
                  setDraftProjectId("");
                }}
              >
                <option value="">Unlinked evidence</option>
                {buildEvidenceTargetOptions(linkTargets, projects).map((target) => (
                  <option key={target.value} value={target.value}>
                    {target.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <fieldset className="inline-editor__usage">
            <legend>Allowed usage</legend>
            {["resume", "interview", "cover_letter", "internal_only"].map((usage) => (
              <label key={usage}>
                <input
                  checked={draftAllowedUsage.includes(usage)}
                  type="checkbox"
                  onChange={() => toggleAllowedUsage(usage)}
                />
                {usage}
              </label>
            ))}
          </fieldset>
          <div className="actions actions--compact">
            <button
              className="primary-button"
              disabled={isUpdating || !draftText.trim()}
              type="button"
              onClick={() => submitEdit(false)}
            >
              Save changes
            </button>
            <button
              className="secondary-button"
              disabled={isUpdating || !draftText.trim()}
              type="button"
              onClick={() => submitEdit(true)}
            >
              Save reviewed external-safe wording
            </button>
          </div>
        </div>
        ) : null}
      </details>
    </article>
  );
}

function StoryMaterialList({
  evidenceItems,
  initiatives,
  onAssignStory,
  onEnrichStory,
  onMergeStory,
  onReviewClaims,
  onReviewStarStory,
  portfolioProjects,
  workExperiences,
}: {
  evidenceItems: EvidenceCardItem[];
  initiatives: InitiativeItem[];
  onAssignStory: (
    target: StoryEnrichmentTarget,
    patch: StoryAssignmentPatch,
  ) => Promise<{ ok: boolean; message: string }>;
  onEnrichStory: (project: StoryEnrichmentTarget) => void;
  onMergeStory: (
    primaryStoryId: string,
    duplicateStoryId: string,
  ) => Promise<{ ok: boolean; message: string }>;
  onReviewClaims: (target: StoryEnrichmentTarget) => void;
  onReviewStarStory: (target: StoryEnrichmentTarget) => void;
  portfolioProjects: PortfolioProjectItem[];
  workExperiences: WorkExperienceItem[];
}) {
  const hasAny =
    workExperiences.length > 0 || initiatives.length > 0 || portfolioProjects.length > 0;
  const evidenceCountByInitiative = new Map<string, number>();
  for (const item of evidenceItems) {
    if (!item.related_initiative_id) continue;
    evidenceCountByInitiative.set(
      item.related_initiative_id,
      (evidenceCountByInitiative.get(item.related_initiative_id) ?? 0) + 1,
    );
  }
  if (!hasAny) {
    return (
      <section className="section-block">
        <div className="section-block__top">
          <div>
            <h3>Experience & Story Library</h3>
            <p>
              Import a resume or source document to create work experiences,
              internal initiatives, and portfolio projects.
            </p>
          </div>
          <span>0 story targets</span>
        </div>
      </section>
    );
  }

  return (
    <section className="section-block">
      <div className="section-block__top">
        <div>
          <h3>Experience & Story Library</h3>
          <p>
            Work experience is the employer/role container. Initiatives are
            internal work stories. Portfolio projects are personal, academic,
            open-source, freelance, or hackathon projects.
          </p>
        </div>
        <span>
          {workExperiences.length} roles · {initiatives.length} initiatives ·{" "}
          {portfolioProjects.length} portfolio projects
        </span>
      </div>

      {workExperiences.length > 0 ? (
        <div className="story-table story-table--work result-stack--inner">
          {workExperiences.map((experience) => {
            const childInitiatives = initiatives.filter(
              (initiative) => initiative.work_experience_id === experience.id,
            );
            const directEvidence = evidenceItems.filter(
              (item) => item.related_work_experience_id === experience.id,
            );
            return (
              <article className="story-group-row" key={experience.id}>
                <div className="story-group-row__summary">
                  <span>Work experience</span>
                  <div>
                    <strong>{experience.employer} · {experience.role_title}</strong>
                    <p>
                      {[experience.team, experience.location, experience.start_date, experience.end_date]
                        .filter(Boolean)
                        .join(" · ") || "Work experience"}
                    </p>
                  </div>
                  <em>{experience.status}</em>
                  <small>{childInitiatives.length} initiatives · {directEvidence.length} direct claims</small>
                </div>
                {experience.summary ? (
                  <p className="story-group-row__note">{experience.summary}</p>
                ) : null}
                {childInitiatives.map((initiative) => (
                  <StoryTargetRow
                    evidenceItems={evidenceItems.filter(
                      (item) => item.related_initiative_id === initiative.id,
                    )}
                    key={initiative.id ?? initiative.internal_title}
                    kind="Work initiative"
                    onAssignStory={onAssignStory}
                    onEnrichStory={onEnrichStory}
                    onMergeStory={onMergeStory}
                    onReviewClaims={onReviewClaims}
                    onReviewStarStory={onReviewStarStory}
                    story={initiative}
                    title={initiative.external_safe_title ?? initiative.internal_title}
                    targetType="initiative"
                    workExperiences={workExperiences}
                    mergeOptions={initiatives.filter(
                      (option) =>
                        option.id &&
                        option.id !== initiative.id,
                    )}
                    mergeOptionEvidenceCounts={evidenceCountByInitiative}
                  />
                ))}
              </article>
            );
          })}
        </div>
      ) : null}

      {initiatives.some((initiative) => !initiative.work_experience_id) ? (
        <div className="story-table result-stack--inner">
          {initiatives
            .filter((initiative) => !initiative.work_experience_id)
            .map((initiative) => (
              <StoryTargetRow
                evidenceItems={evidenceItems.filter(
                  (item) => item.related_initiative_id === initiative.id,
                )}
                key={initiative.id ?? initiative.internal_title}
                kind="Standalone initiative"
                onAssignStory={onAssignStory}
                onEnrichStory={onEnrichStory}
                onMergeStory={onMergeStory}
                onReviewClaims={onReviewClaims}
                onReviewStarStory={onReviewStarStory}
                story={initiative}
                title={initiative.external_safe_title ?? initiative.internal_title}
                targetType="initiative"
                workExperiences={workExperiences}
                mergeOptions={initiatives.filter(
                  (option) =>
                    option.id &&
                    option.id !== initiative.id,
                )}
                mergeOptionEvidenceCounts={evidenceCountByInitiative}
              />
            ))}
        </div>
      ) : null}

      {portfolioProjects.length > 0 ? (
        <div className="story-table result-stack--inner">
          {portfolioProjects.map((project) => (
            <StoryTargetRow
              evidenceItems={evidenceItems.filter(
                (item) => item.related_portfolio_project_id === project.id,
              )}
              key={project.id ?? project.title}
              kind={formatPortfolioProjectType(project.project_type)}
              onAssignStory={onAssignStory}
              onEnrichStory={onEnrichStory}
              onMergeStory={onMergeStory}
              onReviewClaims={onReviewClaims}
              onReviewStarStory={onReviewStarStory}
              story={project}
              title={project.external_safe_title ?? project.title}
              targetType="portfolio_project"
              workExperiences={workExperiences}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function StoryTargetRow({
  evidenceItems,
  kind,
  mergeOptions = [],
  mergeOptionEvidenceCounts,
  onAssignStory,
  onEnrichStory,
  onMergeStory,
  onReviewClaims,
  onReviewStarStory,
  story,
  targetType,
  title,
  workExperiences,
}: {
  evidenceItems: EvidenceCardItem[];
  kind: string;
  mergeOptions?: InitiativeItem[];
  mergeOptionEvidenceCounts?: Map<string, number>;
  onAssignStory: (
    target: StoryEnrichmentTarget,
    patch: StoryAssignmentPatch,
  ) => Promise<{ ok: boolean; message: string }>;
  onEnrichStory: (project: StoryEnrichmentTarget) => void;
  onMergeStory: (
    primaryStoryId: string,
    duplicateStoryId: string,
  ) => Promise<{ ok: boolean; message: string }>;
  onReviewClaims: (target: StoryEnrichmentTarget) => void;
  onReviewStarStory: (target: StoryEnrichmentTarget) => void;
  story: InitiativeItem | PortfolioProjectItem;
  targetType: Exclude<StoryEnrichmentTargetType, "legacy_project">;
  title: string;
  workExperiences: WorkExperienceItem[];
}) {
  const [assignmentMode, setAssignmentMode] = useState<"existing" | "new">("existing");
  const [isEditingAssignment, setIsEditingAssignment] = useState(false);
  const [assignmentMessage, setAssignmentMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const [isAssigning, setIsAssigning] = useState(false);
  const [mergeMessage, setMergeMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState("");
  const [isMergingStory, setIsMergingStory] = useState(false);
  const [newRoleDraft, setNewRoleDraft] = useState({
    employer: "",
    endDate: "",
    roleTitle: "",
    summary: "",
    startDate: "",
  });
  const readiness = getStoryReadiness(story);
  const metrics = story.metrics?.map((metric) => metric.value) ?? [];
  const primaryAction: "Review STAR story" | "Review claims" | "Enrich story" =
    readiness.state === "story_ready"
      ? "Review STAR story"
      : evidenceItems.length > 0
        ? "Review claims"
        : "Enrich story";
  const missingFields = getStoryMissingFields(story);
  const target: StoryEnrichmentTarget | null = story.id
    ? {
        actions: story.actions,
        context: story.context,
        missingFields,
        problem: story.problem,
        results: story.results,
        role: story.role,
        targetId: story.id,
        targetTitle: title,
        targetType,
      }
    : null;
  const meta = [
    story.status,
    story.sensitivity_level,
    story.needs_redaction_review ? "redaction review" : null,
  ].filter((item): item is string => Boolean(item));
  const linkedUsage = formatStoryReusableUsage(evidenceItems);
  const linkedSource = formatStorySourceSummary(evidenceItems);
  const linkedStatus = formatStoryEvidenceStatus(evidenceItems);
  const currentWorkExperienceId =
    targetType === "initiative" && "work_experience_id" in story
      ? story.work_experience_id ?? ""
      : "";
  const assignedWorkExperience = currentWorkExperienceId
    ? workExperiences.find((experience) => experience.id === currentWorkExperienceId) ?? null
    : null;
  const canAssignRole = targetType === "initiative" && Boolean(target);
  const canMergeStory = targetType === "initiative" && Boolean(story.id) && mergeOptions.length > 0;
  async function handleAssignExisting(workExperienceId: string) {
    if (!target || target.targetType !== "initiative") return;
    setIsAssigning(true);
    setAssignmentMessage({ ok: true, text: "Saving role assignment..." });
    try {
      const result = await onAssignStory(target, {
        action: "assign_work_experience",
        targetType: "initiative",
        workExperienceId: workExperienceId || null,
      });
      setAssignmentMessage({ ok: result.ok, text: result.message });
      if (result.ok && workExperienceId) {
        setIsEditingAssignment(false);
        setAssignmentMode("existing");
      }
    } finally {
      setIsAssigning(false);
    }
  }
  async function handleCreateRole() {
    if (!target || target.targetType !== "initiative") return;
    const employer = newRoleDraft.employer.trim();
    const roleTitle = newRoleDraft.roleTitle.trim();
    if (!employer || !roleTitle) {
      setAssignmentMessage({
        ok: false,
        text: "Add employer and role title before creating a role.",
      });
      return;
    }
    setIsAssigning(true);
    setAssignmentMessage({ ok: true, text: "Creating role and assigning initiative..." });
    try {
      const result = await onAssignStory(target, {
        action: "create_work_experience_and_assign",
        targetType: "initiative",
        employer,
        roleTitle,
        startDate: newRoleDraft.startDate.trim() || null,
        endDate: newRoleDraft.endDate.trim() || null,
        summary: newRoleDraft.summary.trim() || null,
      });
      setAssignmentMessage({ ok: result.ok, text: result.message });
      if (result.ok) {
        setNewRoleDraft({ employer: "", endDate: "", roleTitle: "", startDate: "", summary: "" });
        setAssignmentMode("existing");
        setIsEditingAssignment(false);
      }
    } finally {
      setIsAssigning(false);
    }
  }
  async function handleMergeStory() {
    if (!story.id || !mergeTargetId) {
      setMergeMessage({ ok: false, text: "Choose another story to merge first." });
      return;
    }
    setIsMergingStory(true);
    setMergeMessage({ ok: true, text: "Merging story..." });
    try {
      const result = await onMergeStory(story.id, mergeTargetId);
      setMergeMessage({ ok: result.ok, text: result.message });
      if (result.ok) {
        setMergeTargetId("");
      }
    } finally {
      setIsMergingStory(false);
    }
  }
  return (
    <article className="story-target-row">
      <div className="story-target-row__main">
        <div>
          <span>{kind}</span>
          <strong>{title}</strong>
          {"internal_title" in story && story.internal_title !== title ? (
            <p>Internal: {story.internal_title}</p>
          ) : null}
        </div>
        <em data-ready={readiness.state === "story_ready"}>{readiness.label}</em>
        <small>{evidenceItems.length} claims</small>
        <button
          className="story-target-row__action"
          disabled={!target}
          type="button"
          onClick={() => {
            if (!target) return;
            if (primaryAction === "Review STAR story") {
              onReviewStarStory(target);
            } else if (primaryAction === "Review claims") {
              onReviewClaims(target);
            } else {
              onEnrichStory(target);
            }
          }}
        >
          {primaryAction}
        </button>
      </div>
      <div className="story-target-row__meta">
        <span>{readiness.next}</span>
        <small>Status: {linkedStatus}</small>
        <small>Use: {linkedUsage}</small>
        <small>From: {linkedSource}</small>
        {meta.map((item) => (
          <small key={item}>{item}</small>
        ))}
      </div>
      {canAssignRole ? (
        <div
          className="story-target-row__assignment"
          data-state={assignedWorkExperience && !isEditingAssignment ? "assigned" : "editing"}
        >
          <div>
            <strong>Role assignment</strong>
            <p>
              {assignedWorkExperience && !isEditingAssignment
                ? "This story is linked to a confirmed role. Edit only if the match is wrong."
                : "Choose where this story happened, or keep it standalone until context is clear."}
            </p>
          </div>
          {assignedWorkExperience && !isEditingAssignment ? (
            <div className="story-assignment-confirmed">
              <div>
                <span>Assigned role</span>
                <strong>
                  {assignedWorkExperience.employer} · {assignedWorkExperience.role_title}
                </strong>
                <small>
                  {[assignedWorkExperience.start_date, assignedWorkExperience.end_date]
                    .filter(Boolean)
                    .join(" - ") || "Timeline not set"}
                </small>
              </div>
              <button
                className="secondary-button secondary-button--quiet"
                type="button"
                onClick={() => {
                  setIsEditingAssignment(true);
                  setAssignmentMode("existing");
                  setAssignmentMessage(null);
                }}
              >
                Edit role
              </button>
            </div>
          ) : (
            <>
              <div className="story-assignment-control">
                <label>
                  <span>Existing role</span>
                  <select
                    disabled={isAssigning || assignmentMode === "new"}
                    value={currentWorkExperienceId}
                    onChange={(event) => void handleAssignExisting(event.target.value)}
                  >
                    <option value="">Keep standalone / assign later</option>
                    {workExperiences.map((experience) => (
                      <option key={experience.id} value={experience.id}>
                        {experience.employer} · {experience.role_title}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="secondary-button secondary-button--quiet"
                  type="button"
                  onClick={() =>
                    setAssignmentMode((mode) => (mode === "new" ? "existing" : "new"))
                  }
                >
                  {assignmentMode === "new" ? "Use existing role" : "Create new role"}
                </button>
                {assignedWorkExperience ? (
                  <button
                    className="secondary-button secondary-button--quiet"
                    type="button"
                    onClick={() => {
                      setIsEditingAssignment(false);
                      setAssignmentMode("existing");
                      setAssignmentMessage(null);
                    }}
                  >
                    Cancel
                  </button>
                ) : null}
              </div>
              {assignmentMode === "new" ? (
                <div className="story-new-role-form">
                  <label>
                    <span>Employer</span>
                    <input
                      value={newRoleDraft.employer}
                      onChange={(event) =>
                        setNewRoleDraft((draft) => ({ ...draft, employer: event.target.value }))
                      }
                      placeholder="Company or organization"
                    />
                  </label>
                  <label>
                    <span>Role title</span>
                    <input
                      value={newRoleDraft.roleTitle}
                      onChange={(event) =>
                        setNewRoleDraft((draft) => ({ ...draft, roleTitle: event.target.value }))
                      }
                      placeholder="Product Manager, Data Analyst..."
                    />
                  </label>
                  <label>
                    <span>Start date</span>
                    <input
                      value={newRoleDraft.startDate}
                      onChange={(event) =>
                        setNewRoleDraft((draft) => ({ ...draft, startDate: event.target.value }))
                      }
                      placeholder="Optional"
                    />
                  </label>
                  <label>
                    <span>End date</span>
                    <input
                      value={newRoleDraft.endDate}
                      onChange={(event) =>
                        setNewRoleDraft((draft) => ({ ...draft, endDate: event.target.value }))
                      }
                      placeholder="Optional, e.g. Present"
                    />
                  </label>
                  <label>
                    <span>Role note</span>
                    <input
                      value={newRoleDraft.summary}
                      onChange={(event) =>
                        setNewRoleDraft((draft) => ({ ...draft, summary: event.target.value }))
                      }
                      placeholder="Optional user-confirmed context"
                    />
                  </label>
                  <button
                    className="secondary-button"
                    disabled={isAssigning}
                    type="button"
                    onClick={() => void handleCreateRole()}
                  >
                    Create role and assign
                  </button>
                </div>
              ) : null}
            </>
          )}
          {assignmentMessage ? (
            <p className={assignmentMessage.ok ? "status" : "error"}>
              {assignmentMessage.text}
            </p>
          ) : null}
        </div>
      ) : null}
      {canMergeStory ? (
        <details className="story-target-row__details">
          <summary>Merge with another story</summary>
          <p>
            Use this when two initiatives are fragments of the same project. This story stays,
            including its role assignment; linked evidence from the selected story moves here.
          </p>
          <div className="story-assignment-control">
            <label>
              <span>Story to merge into this one</span>
              <select
                disabled={isMergingStory}
                value={mergeTargetId}
                onChange={(event) => {
                  setMergeTargetId(event.target.value);
                  setMergeMessage(null);
                }}
              >
                <option value="">Choose a duplicate story</option>
                {mergeOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {formatMergeStoryOptionLabel({
                      claimCount: option.id ? mergeOptionEvidenceCounts?.get(option.id) ?? 0 : 0,
                      option,
                      workExperiences,
                    })}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="secondary-button"
              disabled={isMergingStory || !mergeTargetId}
              type="button"
              onClick={() => void handleMergeStory()}
            >
              {isMergingStory ? "Merging..." : "Merge selected story"}
            </button>
          </div>
          {mergeMessage ? (
            <p className={mergeMessage.ok ? "status" : "error"}>{mergeMessage.text}</p>
          ) : null}
        </details>
      ) : null}
      <details className="story-target-row__details">
        <summary>View story detail</summary>
        {story.context ? <p>Context: {story.context}</p> : null}
        {story.problem ? <p>Problem: {story.problem}</p> : null}
        {story.role ? <p>Role: {story.role}</p> : null}
        {story.external_safe_summary ? <p>External-safe: {story.external_safe_summary}</p> : null}
        <div className="story-target-row__detail-grid">
          <SectionList title="Actions" items={story.actions} />
          <SectionList title="Results" items={story.results} />
          <SectionList title="Metrics" items={metrics} />
        </div>
      </details>
    </article>
  );
}

function formatStoryReusableUsage(evidenceItems: EvidenceCardItem[]) {
  const usage = Array.from(
    new Set(evidenceItems.flatMap((item) => item.allowed_usage ?? [])),
  );
  if (usage.length === 0) return "not approved yet";
  return usage
    .map((item) => item.replace(/_/g, " "))
    .map((item) => item.charAt(0).toUpperCase() + item.slice(1))
    .join(", ");
}

function formatStorySourceSummary(evidenceItems: EvidenceCardItem[]) {
  if (evidenceItems.length === 0) return "no linked evidence yet";
  const sourcedCount = evidenceItems.filter((item) => item.source_document_id).length;
  return sourcedCount > 0
    ? `${sourcedCount} linked source document${sourcedCount === 1 ? "" : "s"}`
    : "extracted source";
}

function formatStoryEvidenceStatus(evidenceItems: EvidenceCardItem[]) {
  if (evidenceItems.length === 0) return "needs source";
  if (evidenceItems.some((item) => getEvidenceReadiness(item).state === "resume_ready")) {
    return "has resume-ready evidence";
  }
  if (evidenceItems.some((item) => item.status === "approved")) return "has approved evidence";
  return "needs review";
}

function formatMergeStoryOptionLabel({
  claimCount,
  option,
  workExperiences,
}: {
  claimCount: number;
  option: InitiativeItem;
  workExperiences: WorkExperienceItem[];
}) {
  const title = option.external_safe_title ?? option.internal_title;
  const role = option.work_experience_id
    ? workExperiences.find((experience) => experience.id === option.work_experience_id)
    : null;
  const roleLabel = role ? `${role.employer} ${role.role_title}` : "Standalone";
  return `${title} · ${roleLabel} · ${claimCount} claim${claimCount === 1 ? "" : "s"}`;
}

function formatPortfolioProjectType(type: string) {
  return type.replace(/_/g, " ");
}

function compactStoryTitle(title: string) {
  const trimmed = title.trim();
  if (trimmed.length <= 28) return trimmed;
  return `${trimmed.slice(0, 25)}...`;
}

function ProjectList({
  evidenceItems,
  linkTargets,
  onEnrichProject,
  onEvidenceUpdate,
  onUpdate,
  projects,
}: {
  evidenceItems: EvidenceCardItem[];
  linkTargets?: EvidenceLinkTargets;
  onEnrichProject: (project: ProjectCardItem) => void;
  onEvidenceUpdate: (
    item: EvidenceCardItem,
    action: EvidenceUpdateAction,
    patch?: EvidenceUpdatePatch,
  ) => Promise<{ ok: boolean; message: string }>;
  onUpdate: (
    project: {
      id?: string;
      title: string;
      role: string | null;
      public_safe_summary?: string | null;
    },
    action:
      | "approve"
      | "reject"
      | "edit"
      | "mark_external_safe"
      | "approve_project_evidence_for_resume",
  ) => void;
  projects: ProjectCardItem[];
}) {
  const [expandedProjectIds, setExpandedProjectIds] = useState<Record<string, boolean>>({});
  const [pendingEvidenceId, setPendingEvidenceId] = useState<string | null>(null);
  const [cardMessages, setCardMessages] = useState<Record<string, { ok: boolean; text: string }>>(
    {},
  );
  const [showAllProjects, setShowAllProjects] = useState(false);
  async function handleEvidenceUpdate(
    item: EvidenceCardItem,
    action: EvidenceUpdateAction,
    patch?: EvidenceUpdatePatch,
  ) {
    if (!item.id) return;
    setPendingEvidenceId(item.id);
    setCardMessages((messages) => ({
      ...messages,
      [item.id as string]: { ok: true, text: "Updating..." },
    }));
    try {
      const result = await onEvidenceUpdate(item, action, patch);
      setCardMessages((messages) => ({
        ...messages,
        [item.id as string]: { ok: result.ok, text: result.message },
      }));
    } finally {
      setPendingEvidenceId(null);
    }
  }
  if (projects.length === 0) return null;
  const visibleProjects = showAllProjects ? projects : projects.slice(0, 4);
  return (
    <section className="section-block">
      <div className="section-block__top">
        <div>
          <h3>Project Library</h3>
          <p>
            Project cards are the main story containers. Resume uploads often
            create thin project signals; enrich them with docs or guided answers.
          </p>
        </div>
        <span>{projects.length} projects</span>
      </div>
      {visibleProjects.map((project) => {
        const linkedEvidence = getProjectEvidence(project, evidenceItems);
        const isExpanded = project.id ? expandedProjectIds[project.id] ?? false : false;
        return (
        <article className="requirement project-card" key={project.id ?? project.title}>
          <div className="requirement__top project-card__top">
            <div>
              <p className="requirement__text">{project.title}</p>
              <p className="requirement__quote">{getProjectReadiness(project).next}</p>
            </div>
            <span className="requirement__type">{getProjectReadiness(project).label}</span>
          </div>
          {project.context ? (
            <p className="requirement__quote">Context: {project.context}</p>
          ) : null}
          {project.problem ? (
            <p className="requirement__quote">Problem: {project.problem}</p>
          ) : null}
          {project.role ? <p className="requirement__quote">Role: {project.role}</p> : null}
          {project.public_safe_summary ? (
            <p className="requirement__quote">External-safe: {project.public_safe_summary}</p>
          ) : null}
          <div className="chip-row">
            <span className="chip">{project.status}</span>
            {project.sensitivity_level ? (
              <span className="chip">{project.sensitivity_level}</span>
            ) : null}
            <span className="chip">{linkedEvidence.length} linked evidence</span>
            {project.technologies.map((technology) => (
              <span className="chip" key={technology}>
                {technology}
              </span>
            ))}
          </div>
          <SectionList title="Actions" items={project.actions} />
          <SectionList title="Results" items={project.results} />
          {project.metrics && project.metrics.length > 0 ? (
            <SectionList
              title="Metrics"
              items={project.metrics.map((metric) => metric.value)}
            />
          ) : null}
          {project.id ? (
            <div className="actions actions--compact">
              <button
                className="secondary-button"
                type="button"
                onClick={() => onUpdate(project, "approve")}
              >
                Approve project
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => onUpdate(project, "edit")}
              >
                Edit title
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => onEnrichProject(project)}
              >
                Enrich this project
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => onUpdate(project, "mark_external_safe")}
              >
                Review external-safe wording
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => onUpdate(project, "approve_project_evidence_for_resume")}
              >
                Approve linked evidence
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => onUpdate(project, "reject")}
              >
                Reject project
              </button>
            </div>
          ) : null}
          <div className="project-evidence">
            <button
              className="project-evidence__toggle"
              disabled={linkedEvidence.length === 0}
              type="button"
              onClick={() => {
                if (!project.id) return;
                setExpandedProjectIds((current) => ({
                  ...current,
                  [project.id as string]: !isExpanded,
                }));
              }}
            >
              <span>{isExpanded ? "Hide" : "Review"} project evidence</span>
              <small>{linkedEvidence.length} linked claim{linkedEvidence.length === 1 ? "" : "s"}</small>
            </button>
            {isExpanded ? (
              <div className="project-evidence__list">
                {linkedEvidence.length === 0 ? (
                  <p className="requirement__quote">
                    No evidence is linked to this project yet. Add richer project context
                    from Add Material to strengthen this story.
                  </p>
                ) : (
                  linkedEvidence.map((item, index) => (
                    <EvidenceCard
                      cardMessage={item.id ? cardMessages[item.id] : null}
                      isUpdating={item.id ? pendingEvidenceId === item.id : false}
                      item={item}
                      key={item.id ?? `${project.title}-${index}`}
                      linkTargets={linkTargets}
                      onUpdate={handleEvidenceUpdate}
                      projects={projects}
                      variant="nested"
                    />
                  ))
                )}
              </div>
            ) : null}
          </div>
        </article>
        );
      })}
      {projects.length > 4 ? (
        <button
          className="secondary-button evidence-review__toggle"
          type="button"
          onClick={() => setShowAllProjects((current) => !current)}
        >
          {showAllProjects ? "Show fewer projects" : `Show all ${projects.length} projects`}
        </button>
      ) : null}
    </section>
  );
}

function SectionList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="section-block section-block--nested">
      <h3>{title}</h3>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function SourceParseStatusCard({ card }: { card: SourceParseCard }) {
  const quality = card.parseQuality;
  const statusLabel =
    quality.status === "needs_ocr"
      ? "Needs OCR"
      : quality.status === "warning"
        ? "Parse warning"
        : quality.status === "failed"
          ? "Parse failed"
          : card.duplicate
            ? "Duplicate source"
            : card.nextAction === "resume_review"
              ? "Ready to review"
              : "Ready to add";
  const nextCopy =
    quality.status === "needs_ocr"
      ? "This PDF has no reliable text layer. Paste text manually, upload a DOCX, or export the PDF with selectable text."
      : quality.status === "failed"
        ? "Paste text manually or upload a DOCX/text-layer PDF."
      : card.nextAction === "resume_review"
        ? "Continue in Resume Review, then send useful material to Evidence Library."
        : "Review the parsed text, then add it as reusable Evidence Library material.";
  return (
    <article className="source-parse-card" data-status={quality.status}>
      <div className="source-parse-card__top">
        <div>
          <span className="eyebrow">Parsed material</span>
          <h3>{card.title}</h3>
          <p>{card.filename}</p>
        </div>
        <strong>{statusLabel}</strong>
      </div>
      <div className="source-parse-card__metrics">
        <span>{card.sourceType.replace(/_/g, " ")}</span>
        <span>{quality.charCount.toLocaleString()} chars</span>
        <span>{quality.wordCount.toLocaleString()} words</span>
        {typeof quality.pageCount === "number" ? <span>{quality.pageCount} pages</span> : null}
      </div>
      {card.duplicate ? (
        <p className="source-parse-card__warning">
          Duplicate of {card.duplicate.title}. Reuse it or decide whether to re-extract.
        </p>
      ) : null}
      {quality.warnings.length > 0 ? (
        <ul className="source-parse-card__warnings">
          {quality.warnings.map((warning) => (
            <li key={warning}>{formatParseWarning(warning)}</li>
          ))}
        </ul>
      ) : null}
      <p className="source-parse-card__next">{nextCopy}</p>
    </article>
  );
}

function formatParseWarning(warning: string) {
  const copy: Record<string, string> = {
    formatting_not_preserved: "Formatting is not preserved; review section breaks before extraction.",
    low_text_density: "Extracted text is short; the source may be incomplete.",
    low_text_quality: "Text was extracted, but quality is lower than expected; review the parsed content.",
    low_word_count: "Extracted word count is low for AI review or extraction.",
    possible_header_footer_noise: "Repeated header/footer text may add noise.",
    possible_scanned_pdf: "This PDF appears image-based or does not expose selectable text.",
    pdf_text_content_fallback_used: "A secondary PDF text extractor was used for this file.",
    replacement_characters_detected: "Some unreadable replacement characters were found.",
    text_extraction_failed: "No reliable text layer could be extracted.",
  };
  return copy[warning] ?? warning.replace(/_/g, " ");
}

function profileGapGuidance(field: ProfileGapIntent["field"]) {
  if (field === "contact") {
    return {
      template:
        "Contact details to add:\n- Name:\n- Email:\n- Phone:\n- City / region:\n- LinkedIn:\n- Portfolio / GitHub / personal site:\n\nUse only details I want JobDesk to remember for resume and profile workflows.",
      status: "Add contact details below, then save them as profile facts.",
    };
  }
  if (field === "location") {
    return {
      template:
        "Location details to add:\n- City / region:\n- Country:\n- Remote / relocation preferences, if relevant:\n\nUse only location details I want JobDesk to remember for resume and profile workflows.",
      status: "Add location details below, then save them as profile facts.",
    };
  }
  if (field === "education") {
    return {
      template:
        "Education details to add:\n- School:\n- Degree / program:\n- Graduation date:\n- GPA / honors, if relevant:\n- Relevant coursework:\n- Certifications or academic projects:\n\nUse only education facts that are accurate and reusable for resume/profile workflows.",
      status: "Add education details below, then save them as profile facts.",
    };
  }
  if (field === "certifications") {
    return {
      template:
        "Certifications to add:\n- Certification name:\n- Issuer:\n- Date earned / expiration, if relevant:\n- Credential URL or ID, if relevant:\n\nOnly include certifications I want JobDesk to reuse.",
      status: "Add certification details below, then save them as profile facts.",
    };
  }
  return {
    template:
      "Skills to add or correct:\n- Programming languages:\n- Frameworks / libraries:\n- Tools / platforms:\n- Methods / domain knowledge:\n- Skills to remove or avoid:\n\nGroup skills clearly so JobDesk can update the profile without turning this into a work story.",
    status: "Add skill details below, then save them as profile facts.",
  };
}

function profileFactSourceCopy(field: ProfileGapIntent["field"]) {
  if (field === "contact") {
    return {
      description: "Add only contact details you want reused across resume and profile workflows.",
      examples: ["Name", "Email", "Phone", "LinkedIn", "Portfolio", "Location"],
      helper: "This is profile data, not a work story. It will be saved directly to profile facts.",
      inputLabel: "Contact details",
      placeholder: "Name:\nEmail:\nPhone:\nLinkedIn:\nPortfolio:\nCity / region:",
      title: "Add contact information",
    };
  }
  if (field === "location") {
    return {
      description: "Add location details you want reused across resume and profile workflows.",
      examples: ["City", "Region", "Country", "Remote preference", "Relocation"],
      helper: "This is profile data, not a work story. It will be saved directly to profile facts.",
      inputLabel: "Location details",
      placeholder: "City / region:\nCountry:\nRemote / relocation preference:",
      title: "Add location details",
    };
  }
  if (field === "education") {
    return {
      description: "Add education facts that should appear in your career profile.",
      examples: ["School", "Degree", "Program", "Graduation", "GPA", "Coursework"],
      helper: "This updates profile facts directly. It is not treated as a project or role.",
      inputLabel: "Education details",
      placeholder: "School:\nDegree / program:\nGraduation date:\nRelevant coursework:\nCertifications:\nAcademic projects:",
      title: "Add education details",
    };
  }
  if (field === "certifications") {
    return {
      description: "Add certifications that should appear in your career profile.",
      examples: ["Certification", "Issuer", "Earned date", "Expiration", "Credential URL"],
      helper: "This updates profile facts only. It is not treated as a project or role.",
      inputLabel: "Certification details",
      placeholder: "Certification name:\nIssuer:\nDate earned:\nExpiration:\nCredential URL / ID:",
      title: "Add certifications",
    };
  }
  return {
    description: "Add or clean up skills that should be reusable in resumes and interviews.",
    examples: ["Languages", "Frameworks", "Tools", "Methods", "Domain knowledge"],
    helper: "Group skills clearly. Remove anything that should not be reused.",
    inputLabel: "Skills details",
    placeholder: "Programming languages:\nFrameworks:\nTools:\nMethods:\nSkills to remove:",
    title: "Add skills details",
  };
}

function formatResumeTitle(title: string) {
  return title.replace(/(\.[A-Za-z0-9]+)(?:\1)+$/i, "$1");
}
