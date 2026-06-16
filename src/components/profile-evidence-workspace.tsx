"use client";

import { useEffect, useState } from "react";

import { useAccess } from "./access-provider";

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

type EnrichmentTaskItem = {
  id: string;
  task_type: string;
  status: "open" | "answered" | "converted" | "dismissed";
  source_type: string;
  source_label: string;
  prompt: string;
  user_answer: string | null;
  evidence_item_id: string | null;
  work_experience_id: string | null;
  initiative_id: string | null;
  portfolio_project_id: string | null;
  resume_source_version_id: string | null;
  resume_review_report_id: string | null;
  updatedAt: string;
};

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
export type MaterialReviewTab = "enrichment" | "projects" | "unlinked" | "cleanup" | "stories";

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

export function ProfileEvidenceWorkspace({
  entryIntent = "resume",
  initialSection = "review",
  initialReviewTab = "enrichment",
  initialResumeSourceVersionId = null,
}: {
  entryIntent?: MaterialEntryIntent;
  initialSection?: "review" | "intake";
  initialReviewTab?: MaterialReviewTab;
  initialResumeSourceVersionId?: string | null;
}) {
  const { fetchJson } = useAccess();
  const [activeSection, setActiveSection] = useState<"review" | "intake">(initialSection);
  const [selectedEntryIntent, setSelectedEntryIntent] =
    useState<MaterialEntryIntent>(entryIntent);
  const [reviewTab, setReviewTab] = useState<
    MaterialReviewTab
  >(initialReviewTab);
  const [sourceDrafts, setSourceDrafts] = useState<Record<"resume" | "jd", SourceDraft>>({
    jd: { text: "", title: "" },
    resume: { text: "", title: "" },
  });
  const [projectNoteText, setProjectNoteText] = useState("");
  const [projectNoteTitle, setProjectNoteTitle] = useState("");
  const [fileStatus, setFileStatus] = useState<string | null>(null);
  const [resumeSources, setResumeSources] = useState<ResumeSourceSummary[]>([]);
  const [selectedResumeSourceId, setSelectedResumeSourceId] = useState<string>(
    initialResumeSourceVersionId ?? "",
  );
  const [selectedResumeSourceLoading, setSelectedResumeSourceLoading] = useState(false);
  const [result, setResult] = useState<ProfileEvidenceExtraction | null>(null);
  const [library, setLibrary] = useState<EvidenceLibrary | null>(null);
  const [dedupeCandidates, setDedupeCandidates] = useState<DedupeCandidate[]>([]);
  const [storyDedupeCandidates, setStoryDedupeCandidates] = useState<StoryDedupeCandidate[]>(
    [],
  );
  const [starStories, setStarStories] = useState<StarStory[]>([]);
  const [enrichmentTasks, setEnrichmentTasks] = useState<EnrichmentTaskItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Add a source to continue.");
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
  }, [entryIntent]);

  useEffect(() => {
    setActiveSection(initialSection);
  }, [initialSection]);

  useEffect(() => {
    setReviewTab(initialReviewTab);
  }, [initialReviewTab]);

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

  const activeSourceIntent = selectedEntryIntent === "jd" ? "jd" : "resume";
  const sourceText = sourceDrafts[activeSourceIntent].text;
  const sourceTitle = sourceDrafts[activeSourceIntent].title;

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

  async function loadLibrary() {
    const response = await fetchJson("/api/profile-evidence/recent");
    if (!response.ok) {
      setError(await formatLoadError(response, "Could not load the material library."));
      return;
    }
    const payload = (await response.json()) as { data?: EvidenceLibrary };
    setLibrary(payload.data ?? null);
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
    const response = await fetchJson("/api/enrichment-tasks");
    if (!response.ok) return;
    const payload = (await response.json()) as {
      data?: { status: string; tasks?: EnrichmentTaskItem[] };
    };
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
      updateSourceDraft("resume", { text: "", title: "" });
      setFileStatus(null);
      setStatus("Ready for a new resume source. Select a reviewed resume, upload a file, or paste resume text.");
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
                title: string;
                sourceText: string;
              };
            };
            error?: string;
          }
        | null;
      if (response.status === 404) {
        setSelectedResumeSourceId("");
        updateSourceDraft("resume", { text: "", title: "" });
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
      });
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
    setStatus("Extracting reusable evidence from the uploaded source.");
    setIsExtracting(true);
    void (async () => {
      try {
        const response = await fetchJson("/api/profile-evidence/extract", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceText,
            sourceTitle: sourceTitle.trim() || undefined,
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
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetchJson("/api/resume-review", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            data?: {
              status: "saved" | "duplicate" | "skipped";
              resume?: { id: string; title: string; version: number };
              existingResume?: { id: string; title: string; version: number };
              parseWarnings?: string[];
              reason?: string;
            };
            error?: string;
          }
        | null;
      if (!response.ok || !payload?.data) {
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
        return;
      }
      if (payload.data.status === "saved" && payload.data.resume) {
        setSelectedResumeSourceId(payload.data.resume.id);
        await loadResumeSources();
        await loadResumeSourceIntoIntake(payload.data.resume.id);
        setFileStatus(
          `Reviewed ${formatResumeTitle(payload.data.resume.title)}${payload.data.parseWarnings?.length ? ` · ${payload.data.parseWarnings.length} parser note${payload.data.parseWarnings.length === 1 ? "" : "s"}` : ""}`,
        );
        return;
      }
      setError(payload.data.reason ?? "Resume review storage is not configured.");
      return;
    }

    if (
      lowerName.endsWith(".txt") ||
      lowerName.endsWith(".md") ||
      lowerName.endsWith(".markdown")
    ) {
      const text = await file.text();
      if (text.trim().length < 80) {
        setError("Resume source file does not contain enough readable text.");
        return;
      }
    updateActiveSourceDraft({ text, title: file.name });
      setFileStatus(
        `Imported ${file.name}`,
      );
      return;
    }

    setFileStatus(`Reading ${file.name}...`);
    const formData = new FormData();
    formData.append("file", file);
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
            warnings: string[];
          };
          error?: string;
          kind?: string;
        }
      | null;
    if (!response.ok || !payload?.data) {
      setFileStatus(null);
      setError(payload?.error ?? "Resume source parsing failed.");
      return;
    }
    updateActiveSourceDraft({
      text: payload.data.sourceText,
      title: payload.data.sourceTitle,
    });
    setSelectedResumeSourceId("");
    setFileStatus(
      `Imported ${payload.data.sourceTitle}${payload.data.warnings.length > 0 ? ` · ${payload.data.warnings.length} note${payload.data.warnings.length === 1 ? "" : "s"} to review` : ""}`,
    );
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

    if (
      lowerName.endsWith(".txt") ||
      lowerName.endsWith(".md") ||
      lowerName.endsWith(".markdown")
    ) {
      const text = await file.text();
      if (text.trim().length < 80) {
        throw new Error(`${file.name}: not enough readable text`);
      }
      return {
        sourceTitle: file.name,
        sourceText: text.trim(),
        warnings: [] as string[],
      };
    }

    const formData = new FormData();
    formData.append("file", file);
    const response = await fetchJson("/api/profile-evidence/parse-source", {
      method: "POST",
      body: formData,
    });
    const payload = (await response.json().catch(() => null)) as
      | {
          data?: {
            sourceTitle: string;
            sourceText: string;
            warnings: string[];
          };
          error?: string;
        }
      | null;
    if (!response.ok || !payload?.data) {
      throw new Error(`${file.name}: ${payload?.error ?? "source parsing failed"}`);
    }
    return payload.data;
  }

  async function importProjectNoteFiles(files: FileList | null) {
    setError(null);
    if (!files || files.length === 0) return;
    setFileStatus(`Reading ${files.length} project source file${files.length === 1 ? "" : "s"}...`);
    const parsedSources: Awaited<ReturnType<typeof parseSourceFile>>[] = [];
    const failures = [];
    for (const file of Array.from(files)) {
      try {
        parsedSources.push(await parseSourceFile(file));
      } catch (caught) {
        failures.push(caught instanceof Error ? caught.message : `${file.name}: parse failed`);
      }
    }
    if (parsedSources.length === 0) {
      setFileStatus(null);
      setError(failures[0] ?? "No project source files could be parsed.");
      return;
    }
    const appendedText = parsedSources
      .map((source) => [`## ${source.sourceTitle}`, source.sourceText].join("\n\n"))
      .join("\n\n---\n\n");
    setProjectNoteText((current) =>
      current.trim() ? `${current.trim()}\n\n---\n\n${appendedText}` : appendedText,
    );
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
    setFileStatus(
      `Imported ${parsedSources.length} project source file${parsedSources.length === 1 ? "" : "s"}${warningCount ? ` · ${warningCount} parser note${warningCount === 1 ? "" : "s"}` : ""}${failures.length ? ` · ${failures.length} failed` : ""}`,
    );
  }

  function runProjectEnrichment() {
    setError(null);
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
        setStatus(`Project material added · ${formatStatus(payload.meta)}`);
        if (payload.meta.persistence?.status === "saved") {
          await refreshLibraryAfterMutation();
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
            sourceTitle: projectNoteTitle.trim() || "Project source",
            type: "project",
          });
          setActiveSection("review");
        } else {
          setResult(payload.data);
          await refreshLibraryAfterMutation();
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
            : "Project evidence enrichment failed.",
        );
      } finally {
        setIsProjectEnriching(false);
      }
    })();
  }

  const sourceIsReady = sourceText.trim().length >= 80;
  const projectNoteIsReady = projectNoteText.trim().length >= 80;
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
  const linkTargets = {
    initiatives,
    portfolioProjects,
    projects: projectCards,
    workExperiences,
  };
  const unlinkedEvidenceItems = getUnlinkedEvidenceItems(linkTargets, evidenceItems);
  const libraryReadiness = summarizeLibraryReadiness({
    cleanupCount: storyDedupeCandidates.length + dedupeCandidates.length,
    evidenceItems,
    initiatives,
    portfolioProjects,
    projectCards,
    workExperiences,
  });
  const entryGuidance = getEntryGuidance(selectedEntryIntent);

  function selectEntryIntent(intent: MaterialEntryIntent) {
    setSelectedEntryIntent(intent);
    setFileStatus(null);
    if (intent === "resume") {
      setStatus("Resume path selected. Select a reviewed resume, upload a file, or paste resume text.");
    } else if (intent === "jd") {
      setSelectedResumeSourceId("");
      setStatus("JD gap path selected. Add JD gap notes; resume drafts stay separate.");
    } else {
      setSelectedResumeSourceId("");
      setStatus("Project/source path selected. Add source notes or files to enrich story material.");
    }
  }

  function startProjectEnrichment(project: {
    title: string;
    context?: string | null;
    problem?: string | null;
    role?: string | null;
    actions?: string[];
    results?: string[];
  }) {
    setProjectNoteTitle(`${project.title} enrichment notes`);
    setProjectNoteText(
      [
        project.title,
        project.context ? `Context: ${project.context}` : "Context: ",
        project.problem ? `Problem: ${project.problem}` : "Problem: ",
        project.role ? `Role: ${project.role}` : "Role: ",
        project.actions?.length ? `Actions: ${project.actions.join("; ")}` : "Actions: ",
        project.results?.length ? `Results: ${project.results.join("; ")}` : "Results: ",
        "Metrics: ",
        "Additional details to add: ",
      ].join("\n"),
    );
    setSelectedEntryIntent("scratch");
    setStatus(`Add more context for ${project.title}, then run Project Library Builder.`);
    setActiveSection("intake");
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

  async function updateEnrichmentTask(
    taskId: string,
    payload:
      | { action: "answer"; userAnswer: string }
      | { action: "dismiss" }
      | { action: "reopen" }
      | { action: "convert" },
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
    const message =
      payload.action === "answer"
        ? "Saved enrichment answer."
        : payload.action === "convert"
          ? "Converted into a pending evidence candidate. Next: review truth, add public-safe wording if needed, then approve for resume."
          : payload.action === "dismiss"
            ? "Dismissed enrichment task."
            : "Reopened enrichment task.";
    setStatus(message);
    return { ok: true, message };
  }

  async function mergeEvidenceCandidate(candidate: DedupeCandidate) {
    const confirmed = window.confirm(
      "Merge this possible overlap into the kept item? Only do this when both items describe the same claim. The merged-away item will be rejected and linked claims will be marked stale.",
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
          Library Review
        </button>
        <button
          data-active={activeSection === "intake"}
          type="button"
          onClick={() => setActiveSection("intake")}
        >
          Source Intake
        </button>
      </div>

      {activeSection === "intake" ? (
        <div className="panel">
          <div className="panel__header">
            <div>
              <h2 className="panel__title">Source Intake</h2>
              <p className="panel__note">
                {entryGuidance.summary}
              </p>
            </div>
          </div>
          <IntakeStageHeader
            activeIntent={selectedEntryIntent}
            onExplain={(message) => setStatus(message)}
            projectFormState={projectFormState}
            sourceFormState={sourceFormState}
          />
          <OnboardingPaths
            activeIntent={selectedEntryIntent}
            onSelect={selectEntryIntent}
          />
          {selectedEntryIntent !== "scratch" ? (
            <section className="source-active-form">
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
              {selectedEntryIntent === "resume" ? (
                <ResumeSourcePicker
                  isLoading={selectedResumeSourceLoading}
                  onSelect={(resumeSourceVersionId) => {
                    setSelectedResumeSourceId(resumeSourceVersionId);
                    void loadResumeSourceIntoIntake(resumeSourceVersionId);
                  }}
                  resumes={resumeSources}
                  selectedId={selectedResumeSourceId}
                />
              ) : null}
              {fileStatus ? <p className="source-status">{fileStatus}</p> : null}
              <label className="source-field source-field--textarea">
                <span>{selectedEntryIntent === "jd" ? "JD gap source text" : "Resume source text"}</span>
                <small>{selectedEntryIntent === "jd" ? "Paste evidence-gap notes from a JD review, or route to Jobs for full JD analysis later." : "Paste resume text or load a reviewed resume version."}</small>
                <textarea
                  aria-label="Resume or career source text"
                  className="jd-input jd-input--compact"
                  placeholder={
                    selectedEntryIntent === "jd"
                      ? "Paste JD gap notes or missing-evidence prompts here..."
                      : "Paste your real resume text here, upload a file, or select a reviewed resume version..."
                  }
                  value={sourceText}
                  onChange={(event) => {
                    updateActiveSourceDraft({ text: event.target.value });
                    setFileStatus(null);
                  }}
                  spellCheck={false}
                />
              </label>
              <div className="actions">
                <button
                  className="primary-button"
                  disabled={isExtracting || sourceFormState !== "ready"}
                  type="button"
                  onClick={runExtraction}
                >
                  {isExtracting ? "Building..." : entryGuidance.primaryActionLabel}
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
                  label="Material Library build in progress"
                  mode="evidence"
                />
              ) : null}
            </section>
          ) : null}

          {selectedEntryIntent === "scratch" ? (
          <section className="section-block section-block--builder source-active-form">
            <h3>Project Library Builder</h3>
            <p className="panel__note">
              {entryGuidance.enrichmentHint}
            </p>
            <div className="source-controls">
              <label className="source-field">
                <span>Project source title</span>
                <input
                  className="source-input"
                  type="text"
                  value={projectNoteTitle}
                  onChange={(event) => setProjectNoteTitle(event.target.value)}
                />
              </label>
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
            </div>
            <label className="source-field source-field--textarea">
              <span>Project or story source</span>
              <small>Paste text or import multiple PDF, DOCX, TXT, or Markdown files. Each file must be under 8 MB.</small>
              <textarea
                aria-label="Project note source text"
                className="jd-input jd-input--compact"
                placeholder="Paste project notes, design docs, project summaries, performance review excerpts, or guided STAR notes here..."
                value={projectNoteText}
                onChange={(event) => setProjectNoteText(event.target.value)}
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
                {isProjectEnriching ? "Enriching..." : "Enrich Project Note"}
              </button>
              <span className="status">
                {status}
              </span>
            </div>
            <FormStatePill state={projectFormState} />
            {isProjectEnriching ? (
              <ProgressNotice
                elapsedSeconds={projectElapsedSeconds}
                label="Project enrichment in progress"
                mode="project"
              />
            ) : null}
          </section>
          ) : selectedEntryIntent === "resume" ? (
            <section className="source-path-handoff">
              <div>
                <span>Story enrichment comes next</span>
                <p>
                  After extracting this source, Library Review will show whether claims need approval or story targets need more context.
                </p>
              </div>
              <button type="button" onClick={() => selectEntryIntent("scratch")}>
                Switch to project/source docs
              </button>
            </section>
          ) : (
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
          )}
        </div>
      ) : null}

      {activeSection === "review" ? (
        <div className="panel">
          <div className="panel__header">
            <div>
              <h2 className="panel__title">Library Review</h2>
              <p className="panel__note">
                Work experiences, initiatives, portfolio projects, and evidence
                claims form the source-backed material library for resumes,
                interviews, and Fact Guard.
              </p>
            </div>
            <button
              className="secondary-button"
              type="button"
              onClick={() => setActiveSection("intake")}
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
          <EvidencePriorityQueue
            onOpenEnrichment={() => setReviewTab("enrichment")}
            onOpenCleanup={() => setReviewTab("cleanup")}
            onOpenClaims={() => setReviewTab("unlinked")}
            onOpenStories={() => setReviewTab("stories")}
            onOpenStoryTargets={() => setReviewTab("projects")}
            onReturnToIntake={() => setActiveSection("intake")}
            enrichmentTaskCount={
              enrichmentTasks.filter((task) => task.status === "open" || task.status === "answered")
                .length
            }
            summary={libraryReadiness}
          />
          {profile ? <ProfileSummary extraction={result} /> : <LibrarySummary library={library} />}
          <LibraryReadinessSummary summary={libraryReadiness} />
          <div className="review-switcher" role="tablist" aria-label="Library Review panels">
            <button
              data-active={reviewTab === "enrichment"}
              type="button"
              onClick={() => setReviewTab("enrichment")}
            >
              Needs Enrichment ({enrichmentTasks.filter((task) => task.status === "open" || task.status === "answered").length})
            </button>
            <button
              data-active={reviewTab === "projects"}
              type="button"
              onClick={() => setReviewTab("projects")}
            >
              Experience & Stories ({workExperiences.length + initiatives.length + portfolioProjects.length})
            </button>
            <button
              data-active={reviewTab === "unlinked"}
              type="button"
              onClick={() => setReviewTab("unlinked")}
            >
              Unlinked Evidence ({unlinkedEvidenceItems.length})
            </button>
            <button
              data-active={reviewTab === "cleanup"}
              type="button"
              onClick={() => setReviewTab("cleanup")}
            >
              Overlap Cleanup ({storyDedupeCandidates.length + dedupeCandidates.length})
            </button>
            <button
              data-active={reviewTab === "stories"}
              type="button"
              onClick={() => setReviewTab("stories")}
            >
              STAR Stories ({starStories.length})
            </button>
          </div>
          {reviewTab === "enrichment" ? (
            <EnrichmentTaskQueue
              onReturnToIntake={() => setActiveSection("intake")}
              onUpdate={updateEnrichmentTask}
              tasks={enrichmentTasks}
            />
          ) : null}
          {reviewTab === "projects" ? (
            <StoryMaterialList
              evidenceItems={evidenceItems}
              initiatives={initiatives}
              onEnrichStory={startProjectEnrichment}
              portfolioProjects={portfolioProjects}
              workExperiences={workExperiences}
            />
          ) : null}
          {reviewTab === "unlinked" ? (
            <EvidenceList
              description="These evidence claims are not attached to a work experience, initiative, or portfolio project yet. Link them to a story target or keep them as standalone profile facts."
              emptyMessage="All current evidence is attached to story targets."
              items={unlinkedEvidenceItems}
              onUpdate={updateEvidence}
              projects={projectCards}
              linkTargets={linkTargets}
              title="Unlinked Evidence Claims"
            />
          ) : null}
          {reviewTab === "cleanup" ? (
            <DedupePanel
              evidenceCandidates={dedupeCandidates}
              onEvidenceKeepSeparate={keepEvidenceCandidateSeparate}
              onEvidenceMerge={mergeEvidenceCandidate}
              onStoryKeepSeparate={keepStoryCandidateSeparate}
              onRefresh={() => void refreshLibraryAfterMutation()}
              storyCandidates={storyDedupeCandidates}
            />
          ) : null}
          {reviewTab === "stories" ? (
            <StarStoryPanel
              onImproveStory={startProjectEnrichment}
              stories={starStories}
              onRefresh={() => void loadStarStories()}
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
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
        {elapsedSeconds >= 40 ? " Long sources or provider retries can take about a minute." : ""}
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
        detail: "AI is extracting grounded project claims, impact signals, and missing proof points.",
      },
      {
        label: "Build project card",
        summary: "Create a story container for resume/interview use.",
        detail: "Organizing the project into a reusable card and linking supporting evidence.",
      },
      {
        label: "Save and refresh",
        summary: "Persist results and prepare cleanup checks.",
        detail: "Saving project material, refreshing the library, and checking possible overlaps.",
      },
    ];
  }
  return [
    {
      label: "Read source",
      summary: "Use the uploaded/reviewed resume or pasted text.",
      detail: "Reading the source and preparing it for evidence extraction.",
    },
    {
      label: "Extract signals",
      summary: "Find profile facts, evidence claims, and project candidates.",
      detail: "AI is extracting profile facts, reusable evidence claims, and project-card candidates.",
    },
    {
      label: "Structure library items",
      summary: "Convert raw signals into reviewable cards.",
      detail: "Structuring the extracted material into Evidence Library cards with gaps and questions.",
    },
    {
      label: "Save and dedupe",
      summary: "Persist results and surface possible overlaps.",
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
      ariaLabel: "Extract from reviewed resume path",
      intent: "resume" as const,
      title: "Extract from reviewed resume",
      body:
        "Use a reviewed resume version to create reusable evidence candidates. This does not replace the Resume Review report.",
      steps: "Resume review -> extract signals -> enrich projects -> main resume",
    },
    {
      ariaLabel: "Project source intake path",
      intent: "scratch" as const,
      title: "Project/source docs",
      body:
        "Add design docs, project summaries, performance notes, or guided answers to create or enrich story material.",
      steps: "Source docs -> story context -> evidence claims",
    },
    {
      ariaLabel: "JD gap evidence path",
      intent: "jd" as const,
      title: "I have a JD now",
      body:
        "Use the Jobs workspace for a quick tailored draft, but treat missing evidence as follow-up tasks for the library.",
      steps: "JD analysis -> tailored draft -> evidence gaps",
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

function ResumeSourcePicker({
  isLoading,
  onSelect,
  resumes,
  selectedId,
}: {
  isLoading: boolean;
  onSelect: (resumeSourceVersionId: string) => void;
  resumes: ResumeSourceSummary[];
  selectedId: string;
}) {
  if (resumes.length === 0) {
    return (
      <section className="resume-source-picker">
        <div>
          <span>Reviewed resumes</span>
        <p>No reviewed resume versions yet. Upload one in Resume Review, or import an external source below for ad hoc extraction.</p>
        </div>
      </section>
    );
  }
  return (
    <section className="resume-source-picker">
      <div>
        <span>Use reviewed resume</span>
        <p>Use reviewed resume version as a provenance source for reusable evidence candidates. This does not replace the Resume Review report.</p>
      </div>
      <select
        aria-label="Reviewed resume version"
        disabled={isLoading}
        value={selectedId}
        onChange={(event) => onSelect(event.target.value)}
      >
        <option value="">Upload or paste a new resume source</option>
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

function LibraryReadinessSummary({
  summary,
}: {
  summary: ReturnType<typeof summarizeLibraryReadiness>;
}) {
  return (
    <section className="library-readiness" aria-label="Material Library readiness">
      <article>
        <span>Projects needing context</span>
        <strong>{summary.projectsNeedingContext}</strong>
        <p>
          {summary.projectsNeedingContext > 0
            ? "Add problem, role, actions, results, metrics, and public-safe wording."
            : `${summary.storyReadyProjects} story target${summary.storyReadyProjects === 1 ? "" : "s"} ready`}
        </p>
      </article>
      <article>
        <span>Claims awaiting review</span>
        <strong>{summary.evidenceNeedingReview}</strong>
        <p>
          {summary.evidenceNeedingReview > 0
            ? "Review truth, confirmation, sensitivity, and resume usage."
            : `${summary.resumeReadyEvidence} resume-ready claim${summary.resumeReadyEvidence === 1 ? "" : "s"}`}
        </p>
      </article>
      <article>
        <span>Next best action</span>
        <strong>{summary.nextActionTitle}</strong>
        <p>{summary.nextActionDetail}</p>
      </article>
    </section>
  );
}

function EvidencePriorityQueue({
  enrichmentTaskCount,
  onOpenEnrichment,
  onOpenClaims,
  onOpenCleanup,
  onOpenStories,
  onOpenStoryTargets,
  onReturnToIntake,
  summary,
}: {
  enrichmentTaskCount: number;
  onOpenEnrichment: () => void;
  onOpenClaims: () => void;
  onOpenCleanup: () => void;
  onOpenStories: () => void;
  onOpenStoryTargets: () => void;
  onReturnToIntake: () => void;
  summary: ReturnType<typeof summarizeLibraryReadiness>;
}) {
  const queue = [
    {
      action: enrichmentTaskCount > 0 ? onOpenEnrichment : onReturnToIntake,
      button: enrichmentTaskCount > 0 ? "Answer enrichment tasks" : "Add source material",
      count: enrichmentTaskCount,
      detail: "Answer missing metric, scope, ownership, technical-depth, and impact prompts to strengthen reusable evidence.",
      label: "1. Needs enrichment",
      state: enrichmentTaskCount > 0 ? "active" : "empty",
    },
    {
      action: summary.evidenceNeedingReview > 0 ? onOpenClaims : onReturnToIntake,
      button: summary.evidenceNeedingReview > 0 ? "Review claims" : "Add source material",
      count: summary.evidenceNeedingReview,
      detail: "Claims must be approved before they are safe for resume generation.",
      label: "2. Claims awaiting review",
      state: summary.evidenceNeedingReview > 0 ? "active" : "empty",
    },
    {
      action: summary.projectsNeedingContext > 0 ? onOpenStoryTargets : onReturnToIntake,
      button: summary.projectsNeedingContext > 0 ? "Enrich thin projects" : "Add project/source docs",
      count: summary.projectsNeedingContext,
      detail: "Thin story targets need problem, role, actions, results, metrics, and external-safe context.",
      label: "3. Thin projects needing context",
      state: summary.projectsNeedingContext > 0 ? "active" : "empty",
    },
    {
      action: summary.cleanupCount > 0 ? onOpenCleanup : onOpenStoryTargets,
      button: summary.cleanupCount > 0 ? "Resolve overlaps" : "No cleanup needed",
      count: summary.cleanupCount,
      detail: "Possible duplicate claims or story targets should be resolved before reuse.",
      label: "4. Duplicate cleanup",
      state: summary.cleanupCount > 0 ? "active" : "empty",
    },
    {
      action: summary.storyReadyProjects > 0 ? onOpenStories : onOpenStoryTargets,
      button: summary.storyReadyProjects > 0 ? "Review STAR stories" : "Prepare stories first",
      count: summary.storyReadyProjects,
      detail: `${summary.storyReadyProjects} STAR stories ready · ${summary.storyTargetCount} story targets available.`,
      label: "5. STAR stories ready",
      state: summary.storyReadyProjects > 0 ? "active" : "empty",
    },
  ];
  const next = queue.find((item) => item.state === "active") ?? queue[0]!;
  return (
    <section className="evidence-priority-queue" aria-label="Evidence Library priority queue">
      <div className="evidence-priority-queue__header">
        <div>
          <span>Next best queue</span>
          <strong>{next.label}</strong>
          <p>{next.detail}</p>
        </div>
        <button className="primary-button" type="button" onClick={next.action}>
          {next.button}
        </button>
      </div>
      <div className="evidence-priority-queue__items">
        {queue.map((item) => (
          <button
            data-state={item.state}
            key={item.label}
            onClick={item.action}
            type="button"
          >
            <span>{item.label}</span>
            <strong>{item.count}</strong>
            <small>{item.detail}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

function EnrichmentTaskQueue({
  onReturnToIntake,
  onUpdate,
  tasks,
}: {
  onReturnToIntake: () => void;
  onUpdate: (
    taskId: string,
    payload:
      | { action: "answer"; userAnswer: string }
      | { action: "dismiss" }
      | { action: "reopen" }
      | { action: "convert" },
  ) => Promise<{ ok: boolean; message: string }>;
  tasks: EnrichmentTaskItem[];
}) {
  const actionableTasks = tasks.filter(
    (task) => task.status === "open" || task.status === "answered",
  );
  const groupedTasks = groupEnrichmentTasks(actionableTasks);
  const convertedCount = tasks.filter((task) => task.status === "converted").length;
  const [pendingTaskId, setPendingTaskId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [messages, setMessages] = useState<Record<string, { ok: boolean; text: string }>>({});

  async function handleUpdate(
    task: EnrichmentTaskItem,
    payload:
      | { action: "answer"; userAnswer: string }
      | { action: "dismiss" }
      | { action: "reopen" }
      | { action: "convert" },
  ) {
    setPendingTaskId(task.id);
    try {
      const result = await onUpdate(task.id, payload);
      setMessages((current) => ({
        ...current,
        [task.id]: { ok: result.ok, text: result.message },
      }));
      if (result.ok && payload.action === "answer") {
        setAnswers((current) => ({ ...current, [task.id]: "" }));
      }
    } finally {
      setPendingTaskId(null);
    }
  }

  return (
    <section className="section-block enrichment-queue">
      <div className="section-block__top">
        <div>
          <h3>Needs Enrichment</h3>
          <p>
            These prompts come from resume review findings and extraction notes. Answer
            them to create stronger pending evidence candidates, then approve only the
            claims that are accurate and reusable.
          </p>
        </div>
        <span>
          {actionableTasks.length} active · {convertedCount} converted
        </span>
      </div>
      {actionableTasks.length === 0 ? (
        <div className="empty-state-row">
          <div>
            <strong>No enrichment tasks are open.</strong>
            <p>Add source material or rerun Resume Review to surface new gaps.</p>
          </div>
          <button className="secondary-button" type="button" onClick={onReturnToIntake}>
            Add source material
          </button>
        </div>
      ) : (
        <div className="enrichment-task-list">
          {groupedTasks.map((group) => (
            <section className="enrichment-task-group" key={group.key}>
              <div className="enrichment-task-group__header">
                <span>{group.label}</span>
                <strong>{group.tasks.length}</strong>
              </div>
              {group.tasks.map((task) => {
                const answer = answers[task.id] ?? task.user_answer ?? "";
                const isPending = pendingTaskId === task.id;
                const message = messages[task.id];
                return (
                  <article className="enrichment-task-card" key={task.id}>
                    <div className="enrichment-task-card__top">
                      <div>
                        <span>{formatEnrichmentTaskType(task.task_type)}</span>
                        <strong>{task.prompt}</strong>
                        <p>
                          Source: {task.source_label} · {formatEnrichmentSourceType(task.source_type)}
                        </p>
                      </div>
                      <em data-state={task.status}>{formatEnrichmentStatus(task.status)}</em>
                    </div>
                    <label className="source-field source-field--textarea">
                      <span>Your answer</span>
                      <textarea
                        className="jd-input jd-input--compact enrichment-task-card__answer"
                        disabled={isPending}
                        onChange={(event) =>
                          setAnswers((current) => ({
                            ...current,
                            [task.id]: event.target.value,
                          }))
                        }
                        placeholder="Add concrete numbers, scope, ownership, actions, results, or public-safe wording..."
                        value={answer}
                      />
                    </label>
                    <div className="actions actions--compact">
                      <button
                        className="secondary-button"
                        disabled={isPending || answer.trim().length < 12}
                        type="button"
                        onClick={() =>
                          void handleUpdate(task, {
                            action: "answer",
                            userAnswer: answer,
                          })
                        }
                      >
                        Save answer
                      </button>
                      <button
                        className="secondary-button"
                        disabled={isPending || task.status !== "answered"}
                        type="button"
                        onClick={() => void handleUpdate(task, { action: "convert" })}
                      >
                        Convert to evidence candidate
                      </button>
                      <button
                        className="ghost-button"
                        disabled={isPending}
                        type="button"
                        onClick={() => void handleUpdate(task, { action: "dismiss" })}
                      >
                        Dismiss
                      </button>
                      {message ? (
                        <span className={message.ok ? "status" : "status status--error"}>
                          {message.text}
                        </span>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

function IntakeStageHeader({
  activeIntent,
  onExplain,
  projectFormState,
  sourceFormState,
}: {
  activeIntent: MaterialEntryIntent;
  onExplain: (message: string) => void;
  projectFormState: LocalFormState;
  sourceFormState: LocalFormState;
}) {
  const activeFormState = activeIntent === "scratch" ? projectFormState : sourceFormState;
  const sourceComplete = activeFormState === "success";
  const sourceReady = activeFormState === "ready" || activeFormState === "extracting" || sourceComplete;
  const isRunning = activeFormState === "extracting";
  const steps = [
    {
      label: "Choose intake path",
      message: `Selected path: ${formatIntakeIntent(activeIntent)}.`,
      state: "complete",
    },
    {
      label: "Add source",
      message: sourceReady
        ? "Source content is ready for extraction."
        : "Add a title and at least 80 characters of source text first.",
      state: sourceReady ? "complete" : "current",
    },
    {
      label: activeIntent === "scratch" ? "Enrich project note" : "Extract signals",
      message: sourceReady
        ? "Run the primary action near the active form."
        : "Blocked until the source section is ready.",
      state: isRunning ? "current" : sourceComplete ? "complete" : sourceReady ? "current" : "blocked",
    },
    {
      label: "Review output",
      message: sourceComplete
        ? "Switch to Library Review to approve claims and inspect story targets."
        : "Blocked until extraction finishes successfully.",
      state: sourceComplete ? "current" : "blocked",
    },
    {
      label: "Approve evidence",
      message: "Approve claims from Library Review after extraction creates reviewable material.",
      state: sourceComplete ? "blocked" : "blocked",
    },
  ] satisfies Array<{ label: string; message: string; state: "complete" | "current" | "blocked" }>;
  return (
    <section className="intake-stage-bar" aria-label="Source Intake workflow">
      {steps.map((step, index) => (
        <button
          data-state={step.state}
          key={step.label}
          onClick={() => onExplain(step.message)}
          type="button"
        >
          <span>{index + 1}</span>
          <strong>{step.label}</strong>
          {index === 0 ? <small>{formatIntakeIntent(activeIntent)}</small> : null}
        </button>
      ))}
    </section>
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
  if (intent === "scratch") return "project/source docs";
  if (intent === "jd") return "JD gap source";
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
    return "Evidence approved for resume use and available to tailored resume generation.";
  }
  if (action === "reject") {
    return "Evidence rejected. Existing generated claims that used it are marked stale.";
  }
  if (action === "edit") {
    return "Evidence updated. Existing generated claims that used edited text may need revalidation.";
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
    stakeholder: "Stakeholder",
    star: "STAR detail",
    technical_depth: "Technical depth",
  };
  return labels[type] ?? type;
}

function formatEnrichmentSourceType(type: string) {
  const labels: Record<string, string> = {
    evidence: "evidence card",
    extraction_note: "extraction note",
    jd_gap: "JD gap",
    resume_review: "resume review",
    story_target: "story target",
    user_input: "user input",
  };
  return labels[type] ?? type;
}

function formatEnrichmentStatus(status: EnrichmentTaskItem["status"]) {
  if (status === "answered") return "answer saved";
  if (status === "converted") return "candidate created";
  if (status === "dismissed") return "dismissed";
  return "open";
}

function groupEnrichmentTasks(tasks: EnrichmentTaskItem[]) {
  const order = ["resume_review", "extraction_note", "evidence", "jd_gap", "story_target", "user_input"];
  const labels: Record<string, string> = {
    evidence: "From Evidence Card",
    extraction_note: "From Extraction Notes",
    jd_gap: "From JD Gap",
    resume_review: "From Resume Review",
    story_target: "From Story Target",
    user_input: "From User Input",
  };
  return order
    .map((key) => ({
      key,
      label: labels[key] ?? key,
      tasks: tasks.filter((task) => task.source_type === key),
    }))
    .filter((group) => group.tasks.length > 0);
}

function getEntryGuidance(intent: MaterialEntryIntent) {
  if (intent === "scratch") {
    return {
      enrichmentHint:
        "Use project notes, design docs, performance reviews, or guided answers to create new story material or enrich thin resume-derived stories.",
      fileImportLabel: "Import source doc",
      primaryActionLabel: "Extract Source Signals",
      primaryHint:
        "Use this path with or without an initial resume. The Project Library Builder below is the main enrich workflow.",
      primaryTitleLabel: "Source title",
      summary:
        "Add project/source documents to create or enrich work stories. Prioritize context, ownership, actions, outcomes, metrics, and public-safe wording.",
    };
  }
  if (intent === "jd") {
    return {
      enrichmentHint:
        "After JD analysis exposes missing evidence, add project notes or source docs here to close those gaps.",
      fileImportLabel: "Import gap source",
      primaryActionLabel: "Build Gap Evidence",
      primaryHint:
        "JD-first starts in Jobs. Use this library when the tailored draft needs stronger evidence or missing project context.",
      primaryTitleLabel: "Evidence gap source title",
      summary:
        "JD-first is a quick path: analyze the role in Jobs first, then return here to fill evidence gaps with source-backed material.",
    };
  }
  return {
    enrichmentHint:
      "Add project notes, design docs, performance reviews, or accomplishment drafts to turn thin resume signals into richer project stories and stronger evidence.",
      fileImportLabel: "Import external source",
    primaryActionLabel: "Extract Resume Signals",
    primaryHint:
      "Upload or paste your current resume. Expect initial cards to be thin until enriched with deeper source material.",
      primaryTitleLabel: "Reviewed resume or external source title",
    summary:
      "Start from your existing resume, review its weak spots, then extract profile, project, and evidence signals for enrichment.",
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
    nextActionDetail = "Approve source-backed claims and mark resume-safe summaries before tailoring.";
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

function getEvidenceReadiness(item: EvidenceCardItem) {
  const allowedUsage = item.allowed_usage ?? [];
  if (
    item.status === "approved" &&
    !item.needs_user_confirmation &&
    allowedUsage.includes("resume")
  ) {
    return {
      label: "Resume-ready",
      state: "resume_ready" as const,
      next: "Can support main resume or tailored resume generation.",
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
    return "User-confirmed · resume-safe";
  }
  if (item.status === "approved" && !item.needs_user_confirmation) {
    return "User-confirmed";
  }
  if (item.status === "rejected") return "Rejected";
  return "Extracted candidate";
}

function formatEvidenceMissingInfo(item: EvidenceCardItem) {
  const missing = [];
  if (item.status !== "approved" || item.needs_user_confirmation) {
    missing.push("user confirmation");
  }
  if (!(item.allowed_usage ?? []).includes("resume")) {
    missing.push("resume usage");
  }
  if (item.sensitivity_level !== "public_safe" && !item.public_safe_summary) {
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
      label: "Review truth and approve",
      reason: "Truth review is still pending.",
    };
  }
  if (item.needs_user_confirmation) {
    return {
      action: "approve_for_resume" as const,
      label: "Confirm claim for resume",
      reason: "User confirmation is required before resume use.",
    };
  }
  if (item.sensitivity_level !== "public_safe" && !item.public_safe_summary) {
    return {
      action: "mark_external_safe" as const,
      label: "Add external-safe wording",
      reason: "Sensitive evidence needs external-safe wording.",
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

function ProfileSummary({
  extraction,
}: {
  extraction: ProfileEvidenceExtraction | null;
}) {
  if (!extraction) return null;
  const profile = extraction.profile;
  return (
    <section className="job-facts">
      <div className="chip-row">
        <span className="chip">Name: {profile.name.value}</span>
        {profile.location ? (
          <span className="chip">Location: {profile.location.value}</span>
        ) : null}
        {profile.skills.slice(0, 5).map((skill) => (
          <span className="chip" key={skill.value}>
            {skill.value}
          </span>
        ))}
      </div>
    </section>
  );
}

function LibrarySummary({ library }: { library: EvidenceLibrary | null }) {
  if (!library?.profile && library?.evidenceItems.length === 0) {
    return (
      <div className="empty-state empty-state--compact">
        Import a resume or project notes to create reusable evidence.
      </div>
    );
  }
  return (
    <section className="job-facts">
      <p className="requirement__text">
        Latest profile: {library?.profile?.displayName ?? "Unnamed profile"}
      </p>
      <p className="requirement__quote">
        {library?.evidenceItems.length ?? 0} evidence items ·{" "}
        {library?.workExperiences.length ?? 0} roles ·{" "}
        {library?.initiatives.length ?? 0} initiatives ·{" "}
        {library?.portfolioProjects.length ?? 0} portfolio projects
      </p>
    </section>
  );
}

function DedupePanel({
  evidenceCandidates,
  onEvidenceKeepSeparate,
  onEvidenceMerge,
  onStoryKeepSeparate,
  onRefresh,
  storyCandidates,
}: {
  evidenceCandidates: DedupeCandidate[];
  onEvidenceKeepSeparate: (candidate: DedupeCandidate) => Promise<void>;
  onEvidenceMerge: (candidate: DedupeCandidate) => void;
  onStoryKeepSeparate: (candidate: StoryDedupeCandidate) => Promise<void>;
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
}: {
  candidates: StoryDedupeCandidate[];
  onKeepSeparate: (candidate: StoryDedupeCandidate) => Promise<void>;
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
                  the duplicate claim, and mark generated claims that used either
                  item as stale.
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
  onImproveStory,
  onRefresh,
  stories,
}: {
  onImproveStory: (project: ProjectCardItem) => void;
  onRefresh: () => void;
  stories: StarStory[];
}) {
  return (
    <section className="section-block">
      <div className="requirement__top">
        <h3>STAR story bank</h3>
        <button className="secondary-button" type="button" onClick={onRefresh}>
          Refresh stories
        </button>
      </div>
      {stories.length === 0 ? (
        <p className="requirement__quote">
          No initiatives or portfolio projects are ready to promote into STAR stories yet.
        </p>
      ) : (
        <div className="result-stack result-stack--inner">
          {stories.slice(0, 4).map((story) => (
            <article className="requirement" key={story.id}>
              <div className="requirement__top">
                <p className="requirement__text">{story.title}</p>
                <span className="requirement__type">
                  {story.story_target_type.replaceAll("_", " ")} · {story.readiness}
                </span>
              </div>
              {story.internal_title && story.internal_title !== story.title ? (
                <p className="requirement__quote">Internal title: {story.internal_title}</p>
              ) : null}
              {story.situation ? (
                <p className="requirement__quote">S: {story.situation}</p>
              ) : null}
              {story.task ? (
                <p className="requirement__quote">T: {story.task}</p>
              ) : null}
              {story.action.length > 0 ? (
                <SectionList title="A" items={story.action.slice(0, 3)} />
              ) : null}
              {story.result.length > 0 ? (
                <SectionList title="R" items={story.result.slice(0, 3)} />
              ) : null}
              {story.external_safe_summary ? (
                <p className="requirement__quote">
                  External-safe: {story.external_safe_summary}
                </p>
              ) : null}
              <div className="chip-row">
                <span className="chip">{story.evidence_count} evidence</span>
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
                <SectionList title="Gaps" items={story.gaps.slice(0, 3)} />
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
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function EvidenceList({
  description = "Evidence cards are atomic source-backed claims. They support project stories, resumes, interviews, and Fact Guard.",
  emptyMessage = "No evidence has been created yet.",
  items,
  linkTargets,
  onUpdate,
  projects,
  title = "Evidence Claims",
}: {
  description?: string;
  emptyMessage?: string;
  items: EvidenceCardItem[];
  onUpdate: (
    item: EvidenceCardItem,
    action: EvidenceUpdateAction,
    patch?: EvidenceUpdatePatch,
  ) => Promise<{ ok: boolean; message: string }>;
  linkTargets?: EvidenceLinkTargets;
  projects?: ProjectCardItem[];
  title?: string;
}) {
  const [filter, setFilter] = useState<"needs_review" | "approved" | "resume_ready" | "all">(
    "needs_review",
  );
  const [showAll, setShowAll] = useState(false);
  const [pendingEvidenceId, setPendingEvidenceId] = useState<string | null>(null);
  const [cardMessages, setCardMessages] = useState<Record<string, { ok: boolean; text: string }>>(
    {},
  );
  const counts = {
    all: items.length,
    approved: items.filter((item) => item.status === "approved").length,
    resume_ready: items.filter(
      (item) =>
        item.status === "approved" &&
        !item.needs_user_confirmation &&
        (item.allowed_usage ?? []).includes("resume"),
    ).length,
    needs_review: items.filter(
      (item) =>
        item.status !== "approved" ||
        item.needs_user_confirmation ||
        !(item.allowed_usage ?? []).includes("resume"),
    ).length,
  };
  const filteredItems = items.filter((item) => {
    if (filter === "all") return true;
    if (filter === "approved") return item.status === "approved";
    if (filter === "resume_ready") {
      return (
        item.status === "approved" &&
        !item.needs_user_confirmation &&
        (item.allowed_usage ?? []).includes("resume")
      );
    }
    return (
      item.status !== "approved" ||
      item.needs_user_confirmation ||
      !(item.allowed_usage ?? []).includes("resume")
    );
  });
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
            <h3>{title}</h3>
            <p>{description}</p>
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
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <span>
          {counts.needs_review} need review · {counts.resume_ready} resume-ready ·{" "}
          {counts.all} total
        </span>
      </div>
      <div className="filter-row" role="group" aria-label="Evidence filters">
        <button
          data-active={filter === "needs_review"}
          type="button"
          onClick={() => {
            setFilter("needs_review");
            setShowAll(false);
          }}
        >
          Needs review ({counts.needs_review})
        </button>
        <button
          data-active={filter === "resume_ready"}
          type="button"
          onClick={() => {
            setFilter("resume_ready");
            setShowAll(false);
          }}
        >
          Resume-ready ({counts.resume_ready})
        </button>
        <button
          data-active={filter === "approved"}
          type="button"
          onClick={() => {
            setFilter("approved");
            setShowAll(false);
          }}
        >
          Approved ({counts.approved})
        </button>
        <button
          data-active={filter === "all"}
          type="button"
          onClick={() => {
            setFilter("all");
            setShowAll(false);
          }}
        >
          All ({counts.all})
        </button>
      </div>
      {filteredItems.length === 0 ? (
        <p className="requirement__quote">
          No evidence matches this filter.
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
  const [isEditing, setIsEditing] = useState(false);
  const [draftText, setDraftText] = useState(item.text);
  const [draftSummary, setDraftSummary] = useState(item.public_safe_summary ?? "");
  const [draftSensitivity, setDraftSensitivity] = useState(item.sensitivity_level);
  const [draftProjectId, setDraftProjectId] = useState(item.related_project_id ?? "");
  const [draftTarget, setDraftTarget] = useState(() => toEvidenceTargetValue(item));
  const [draftAllowedUsage, setDraftAllowedUsage] = useState<string[]>(
    item.allowed_usage ?? [],
  );

  useEffect(() => {
    setDraftText(item.text);
    setDraftSummary(item.public_safe_summary ?? "");
    setDraftSensitivity(item.sensitivity_level);
    setDraftProjectId(item.related_project_id ?? "");
    setDraftTarget(toEvidenceTargetValue(item));
    setDraftAllowedUsage(item.allowed_usage ?? []);
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

  if (variant === "nested") {
    return (
      <article className="requirement evidence-subcard">
        <div className="requirement__top">
          <p className="requirement__text">{item.text}</p>
          <span className="requirement__type">{readiness.label}</span>
        </div>
        <p className="requirement__quote">{readiness.next}</p>
        <p className="requirement__quote">Status: {item.status}</p>
        <p className="requirement__quote">Reusable in: {formatReusableUsage(item)}</p>
        <p className="requirement__quote">Source: {formatEvidenceSource(item)}</p>
        <p className="requirement__quote">Linked to: {linkedTarget}</p>
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
        <div>
          <span>{item.evidence_type}</span>
          <strong>{item.text}</strong>
          <p>{readiness.next}</p>
        </div>
        <em data-ready={readiness.state === "resume_ready"}>{readiness.label}</em>
        <small>{item.sensitivity_level}</small>
        <button
          className="secondary-button"
          disabled={isUpdating || !item.id}
          type="button"
          onClick={() => {
            if (!item.id) return;
            if (blocker.action === "edit") {
              setIsEditing((current) => !current);
            } else if (blocker.action === "mark_external_safe") {
              onUpdate(item, "mark_external_safe");
            } else {
              onUpdate(item, "approve_for_resume");
            }
          }}
        >
          {blocker.action === "edit"
            ? isEditing
              ? "Close edit"
              : "Edit"
            : blocker.label}
        </button>
      </div>
      <div className="evidence-row__meta">
        <span>Status: {formatEvidenceAssetStatus(item)}</span>
        <small>Reusable in: {formatReusableUsage(item)}</small>
        <small>Source: {formatEvidenceSource(item)}</small>
        <small>Linked to: {linkedTarget}</small>
        <small>Missing info: {missingInfo}</small>
        <small>Updated: {formatRelativeDate(item.updatedAt)}</small>
        <small>{blocker.reason}</small>
        {(item.allowed_usage ?? []).map((usage) => (
          <small key={usage}>
            {usage}
          </small>
        ))}
        {item.needs_user_confirmation ? <small>needs confirmation</small> : null}
      </div>
      {cardMessage ? (
        <p className={cardMessage.ok ? "card-message" : "card-message card-message--error"}>
          {cardMessage.text}
        </p>
      ) : null}
      <details className="evidence-row__details" {...(isEditing ? { open: true } : {})}>
        <summary>View evidence detail</summary>
        <p>Source: {formatEvidenceSource(item)}</p>
        <p>Reusable in: {formatReusableUsage(item)}</p>
        <p>Status: {formatEvidenceAssetStatus(item)}</p>
        <p>Linked to: {linkedTarget}</p>
        <p>Missing info: {missingInfo}</p>
        <p>Last updated: {formatRelativeDate(item.updatedAt)}</p>
        <p>Quote: {formatSourceQuotePreview(item.source_quote)}</p>
        {item.public_safe_summary ? <p>External-safe: {item.public_safe_summary}</p> : null}
        {item.id ? (
        <div className="actions actions--compact">
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
            onClick={() => onUpdate(item, "mark_external_safe")}
          >
            Mark external-safe
          </button>
          {item.status !== "approved" ||
          item.needs_user_confirmation ||
          !(item.allowed_usage ?? []).includes("resume") ? (
            <button
              className="secondary-button"
              disabled={isUpdating}
              type="button"
              onClick={() => onUpdate(item, "approve_for_resume")}
            >
              Approve for resume
            </button>
          ) : null}
        </div>
        ) : null}
        {isEditing ? (
        <div className="inline-editor">
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
              placeholder="Optional resume-safe wording"
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
              Save as external-safe
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
  onEnrichStory,
  portfolioProjects,
  workExperiences,
}: {
  evidenceItems: EvidenceCardItem[];
  initiatives: InitiativeItem[];
  onEnrichStory: (project: {
    title: string;
    context?: string | null;
    problem?: string | null;
    role?: string | null;
    actions?: string[];
    results?: string[];
  }) => void;
  portfolioProjects: PortfolioProjectItem[];
  workExperiences: WorkExperienceItem[];
}) {
  const hasAny =
    workExperiences.length > 0 || initiatives.length > 0 || portfolioProjects.length > 0;
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
                    onEnrichStory={onEnrichStory}
                    story={initiative}
                    title={initiative.external_safe_title ?? initiative.internal_title}
                  />
                ))}
              </article>
            );
          })}
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
              onEnrichStory={onEnrichStory}
              story={project}
              title={project.external_safe_title ?? project.title}
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
  onEnrichStory,
  story,
  title,
}: {
  evidenceItems: EvidenceCardItem[];
  kind: string;
  onEnrichStory: (project: {
    title: string;
    context?: string | null;
    problem?: string | null;
    role?: string | null;
    actions?: string[];
    results?: string[];
  }) => void;
  story: InitiativeItem | PortfolioProjectItem;
  title: string;
}) {
  const readiness = getStoryReadiness(story);
  const metrics = story.metrics?.map((metric) => metric.value) ?? [];
  const primaryAction =
    readiness.state === "story_ready"
      ? "Generate STAR story"
      : evidenceItems.length > 0
        ? "Review claims"
        : "Enrich";
  const actionLabel = `${primaryAction} ${compactStoryTitle(title)}`;
  const meta = [
    story.status,
    story.sensitivity_level,
    story.needs_redaction_review ? "redaction review" : null,
  ].filter((item): item is string => Boolean(item));
  const linkedUsage = formatStoryReusableUsage(evidenceItems);
  const linkedSource = formatStorySourceSummary(evidenceItems);
  const linkedStatus = formatStoryEvidenceStatus(evidenceItems);
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
          type="button"
          onClick={() =>
            onEnrichStory({
              title,
              context: story.context,
              problem: story.problem,
              role: story.role,
              actions: story.actions,
              results: story.results,
            })
          }
        >
          {actionLabel}
        </button>
      </div>
      <div className="story-target-row__meta">
        <span>{readiness.next}</span>
        <small>Status: {linkedStatus}</small>
        <small>Reusable in: {linkedUsage}</small>
        <small>Source: {linkedSource}</small>
        {meta.map((item) => (
          <small key={item}>{item}</small>
        ))}
      </div>
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
    return "has resume-safe evidence";
  }
  if (evidenceItems.some((item) => item.status === "approved")) return "has approved evidence";
  return "needs review";
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
                Mark external-safe
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
                    from Source Intake to strengthen this story.
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

function formatResumeTitle(title: string) {
  return title.replace(/(\.[A-Za-z0-9]+)(?:\1)+$/i, "$1");
}
