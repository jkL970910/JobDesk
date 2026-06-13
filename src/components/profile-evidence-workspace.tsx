"use client";

import { useEffect, useState } from "react";

import { useAccess } from "./access-provider";

import type { ProfileEvidenceExtraction } from "../schemas/profile-evidence-extraction";

const sampleProfileSource = [
  "Jane Doe",
  "Senior Product Analyst at Acme Finance, 2019 - Present",
  "Built SQL dashboards for onboarding funnel analysis and partnered with product managers to define activation metrics.",
  "Led experimentation readouts for three product teams and improved weekly stakeholder reporting.",
  "Skills: SQL, product analytics, experimentation, dashboard development, stakeholder communication.",
  "Education: BSc Statistics, University of Toronto.",
].join("\n");

const sampleProjectNote = [
  "Onboarding activation dashboard project",
  "Problem: Product teams could not see where new users dropped during onboarding.",
  "Role: I partnered with product managers and engineers to define activation events, build SQL models, and ship dashboard views for weekly reviews.",
  "Actions: mapped funnel steps, validated event quality, created dashboard slices by cohort and traffic source, and presented findings to stakeholders.",
  "Result: teams identified the largest activation drop-off and prioritized follow-up experiments.",
  "Tools: SQL, dashboarding, product analytics, stakeholder communication.",
].join("\n");

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

type ProjectDedupeCandidate = {
  primary: ProjectDedupeItem;
  duplicate: ProjectDedupeItem;
  duplicateCount: number;
  duplicateProjectIds: string[];
  score: number;
  reasons: string[];
  primaryEvidenceCount: number;
  duplicateEvidenceCount: number;
};

type ProjectDedupeItem = {
  id: string;
  title: string;
  context: string | null;
  problem: string | null;
  role: string | null;
  actions: string[];
  results: string[];
  technologies: string[];
  stakeholders: string[];
  status: string;
};

type ProjectMergeResult = {
  duplicateProjectCount: number;
  movedEvidenceCount: number;
  mergedMetricCount: number;
};

type StarStory = {
  id: string;
  project_id: string;
  title: string;
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
  projectCards: ProjectCardItem[];
};

type EvidenceCardItem = {
  id?: string;
  text: string;
  source_quote: string;
  source_document_id?: string | null;
  related_project_id?: string | null;
  evidence_type: string;
  sensitivity_level: string;
  allowed_usage?: string[];
  public_safe_summary?: string | null;
  status: string;
  needs_user_confirmation: boolean;
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
};

export function ProfileEvidenceWorkspace({
  entryIntent = "resume",
  initialSection = "review",
}: {
  entryIntent?: MaterialEntryIntent;
  initialSection?: "review" | "intake";
}) {
  const { fetchJson } = useAccess();
  const [activeSection, setActiveSection] = useState<"review" | "intake">(initialSection);
  const [reviewTab, setReviewTab] = useState<"projects" | "unlinked" | "cleanup" | "stories">(
    "projects",
  );
  const [sourceText, setSourceText] = useState(sampleProfileSource);
  const [sourceTitle, setSourceTitle] = useState("Sample resume notes");
  const [projectNoteText, setProjectNoteText] = useState(sampleProjectNote);
  const [projectNoteTitle, setProjectNoteTitle] = useState("Sample project note");
  const [fileStatus, setFileStatus] = useState<string | null>(null);
  const [result, setResult] = useState<ProfileEvidenceExtraction | null>(null);
  const [library, setLibrary] = useState<EvidenceLibrary | null>(null);
  const [dedupeCandidates, setDedupeCandidates] = useState<DedupeCandidate[]>([]);
  const [projectDedupeCandidates, setProjectDedupeCandidates] = useState<ProjectDedupeCandidate[]>(
    [],
  );
  const [starStories, setStarStories] = useState<StarStory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("Ready to build your material library.");
  const [lastIntakeSummary, setLastIntakeSummary] = useState<{
    evidenceCount: number;
    projectCount: number;
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
    void loadProjectDedupeCandidates();
    void loadStarStories();
  }, []);

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

  async function loadProjectDedupeCandidates() {
    const response = await fetchJson("/api/projects/dedupe");
    if (!response.ok) return;
    const payload = (await response.json()) as {
      data?: { status: string; candidates?: ProjectDedupeCandidate[] };
    };
    setProjectDedupeCandidates(payload.data?.candidates ?? []);
  }

  async function loadStarStories() {
    const response = await fetchJson("/api/profile-evidence/star-stories");
    if (!response.ok) return;
    const payload = (await response.json()) as {
      data?: { status: string; stories?: StarStory[] };
    };
    setStarStories(payload.data?.stories ?? []);
  }

  async function refreshLibraryAfterMutation() {
    await loadLibrary();
    await loadDedupeCandidates();
    await loadProjectDedupeCandidates();
    await loadStarStories();
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
          setResult(null);
          setLastIntakeSummary({
            evidenceCount: payload.meta.persistence.evidenceCount ?? payload.data.evidence_items.length,
            projectCount: payload.meta.persistence.projectCount ?? payload.data.project_cards.length,
            sourceTitle: sourceTitle.trim() || "Resume/source",
            type: "resume",
          });
          setActiveSection("review");
        } else {
          setResult(payload.data);
          await refreshLibraryAfterMutation();
          setLastIntakeSummary({
            evidenceCount: payload.data.evidence_items.length,
            projectCount: payload.data.project_cards.length,
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
      setSourceText(text);
      setSourceTitle(file.name);
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
    setSourceText(payload.data.sourceText);
    setSourceTitle(payload.data.sourceTitle);
    setFileStatus(
      `Imported ${payload.data.sourceTitle}${payload.data.warnings.length > 0 ? ` · ${payload.data.warnings.length} note${payload.data.warnings.length === 1 ? "" : "s"} to review` : ""}`,
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
  const profile = result?.profile;
  const evidenceItems = result?.evidence_items ?? library?.evidenceItems ?? [];
  const projectCards = result?.project_cards ?? library?.projectCards ?? [];
  const unlinkedEvidenceItems = getUnlinkedEvidenceItems(projectCards, evidenceItems);
  const libraryReadiness = summarizeLibraryReadiness({
    evidenceItems,
    projectCards,
  });
  const entryGuidance = getEntryGuidance(entryIntent);

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

  async function mergeProjectCandidate(candidate: ProjectDedupeCandidate): Promise<ProjectMergeResult> {
    const response = await fetchJson("/api/projects/dedupe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        primaryProjectId: candidate.primary.id,
        duplicateProjectIds: candidate.duplicateProjectIds,
      }),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      const message = payload?.error ?? "Failed to merge project cards.";
      setError(message);
      throw new Error(message);
    }
    const payload = (await response.json()) as {
      data?: {
        duplicateProjectCount?: number;
        movedEvidenceCount?: number;
        mergedMetricCount?: number;
      };
    };
    setResult(null);
    const movedEvidenceCount = payload.data?.movedEvidenceCount ?? 0;
    const mergedMetricCount = payload.data?.mergedMetricCount ?? 0;
    const duplicateProjectCount = payload.data?.duplicateProjectCount ?? candidate.duplicateCount;
    setStatus(
      `Merged ${duplicateProjectCount} duplicate project card${duplicateProjectCount === 1 ? "" : "s"}. Moved ${movedEvidenceCount} linked evidence item${movedEvidenceCount === 1 ? "" : "s"} to the kept project.`,
    );
    await refreshLibraryAfterMutation();
    return { duplicateProjectCount, movedEvidenceCount, mergedMetricCount };
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
          <OnboardingPaths activeIntent={entryIntent} />
          <div className="source-controls">
            <label className="source-field">
              <span>{entryGuidance.primaryTitleLabel}</span>
              <input
                className="source-input"
                type="text"
                value={sourceTitle}
                onChange={(event) => setSourceTitle(event.target.value)}
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
          {fileStatus ? <p className="source-status">{fileStatus}</p> : null}
          <textarea
            aria-label="Resume or career source text"
            className="jd-input jd-input--compact"
            value={sourceText}
            onChange={(event) => {
              setSourceText(event.target.value);
              setFileStatus(null);
            }}
            spellCheck={false}
          />
          <div className="actions">
            <button
              className="primary-button"
              disabled={isExtracting || !sourceIsReady}
              type="button"
              onClick={runExtraction}
            >
              {isExtracting ? "Building..." : entryGuidance.primaryActionLabel}
            </button>
            <span className={error ? "status status--error" : "status"}>
              {error ?? status}
            </span>
          </div>
          <p className="source-status">{entryGuidance.primaryHint}</p>
          {isExtracting ? (
            <ProgressNotice
              elapsedSeconds={extractElapsedSeconds}
              label="Material Library build in progress"
            />
          ) : null}

          <section className="section-block section-block--builder">
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
            </div>
            <textarea
              aria-label="Project note source text"
              className="jd-input jd-input--compact"
              value={projectNoteText}
              onChange={(event) => setProjectNoteText(event.target.value)}
              spellCheck={false}
            />
            <div className="actions">
              <button
                className="primary-button"
                disabled={isProjectEnriching || !projectNoteIsReady}
                type="button"
                onClick={runProjectEnrichment}
              >
                {isProjectEnriching ? "Enriching..." : "Enrich Project Note"}
              </button>
            </div>
            {isProjectEnriching ? (
              <ProgressNotice
                elapsedSeconds={projectElapsedSeconds}
                label="Project enrichment in progress"
              />
            ) : null}
          </section>
        </div>
      ) : null}

      {activeSection === "review" ? (
        <div className="panel">
          <div className="panel__header">
            <div>
              <h2 className="panel__title">Library Review</h2>
              <p className="panel__note">
                Project cards are story containers. Evidence cards are source-backed
                claims that support resumes, interviews, and Fact Guard.
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
          {profile ? <ProfileSummary extraction={result} /> : <LibrarySummary library={library} />}
          <LibraryReadinessSummary summary={libraryReadiness} />
          <div className="review-switcher" role="tablist" aria-label="Library Review panels">
            <button
              data-active={reviewTab === "projects"}
              type="button"
              onClick={() => setReviewTab("projects")}
            >
              Projects ({projectCards.length})
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
              Overlap Cleanup ({projectDedupeCandidates.length + dedupeCandidates.length})
            </button>
            <button
              data-active={reviewTab === "stories"}
              type="button"
              onClick={() => setReviewTab("stories")}
            >
              STAR Stories ({starStories.length})
            </button>
          </div>
          {reviewTab === "projects" ? (
            <ProjectList
              evidenceItems={evidenceItems}
              onEnrichProject={startProjectEnrichment}
              onEvidenceUpdate={updateEvidence}
              projects={projectCards}
              onUpdate={updateProject}
            />
          ) : null}
          {reviewTab === "unlinked" ? (
            <EvidenceList
              description="These evidence claims are not attached to a project card yet. Review them as standalone facts or add richer project context from Source Intake."
              emptyMessage="All current evidence is attached to project cards."
              items={unlinkedEvidenceItems}
              onUpdate={updateEvidence}
              projects={projectCards}
              title="Unlinked Evidence Claims"
            />
          ) : null}
          {reviewTab === "cleanup" ? (
            <DedupePanel
              evidenceCandidates={dedupeCandidates}
              onEvidenceMerge={mergeEvidenceCandidate}
              onProjectMerge={mergeProjectCandidate}
              onRefresh={() => void refreshLibraryAfterMutation()}
              projectCandidates={projectDedupeCandidates}
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
}: {
  elapsedSeconds: number;
  label: string;
}) {
  const progress = Math.min(92, 18 + elapsedSeconds * 2);
  const phase =
    elapsedSeconds < 12
      ? "Reading source and preparing evidence extraction"
      : elapsedSeconds < 35
        ? "AI is extracting profile facts, evidence, and project cards"
        : "Still working; larger resumes can take about a minute";
  return (
    <div className="progress-notice" role="status" aria-live="polite">
      <div className="progress-notice__top">
        <strong>{label}</strong>
        <span>{elapsedSeconds}s</span>
      </div>
      <div className="progress-bar" aria-hidden="true">
        <span style={{ width: `${progress}%` }} />
      </div>
      <p>{phase}. Keep this page open.</p>
    </div>
  );
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
          {summary.evidenceCount === 1 ? "" : "s"} and {summary.projectCount} project
          card{summary.projectCount === 1 ? "" : "s"}. Review the cards below,
          then enrich thin projects with more {sourceType} context if needed.
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

function OnboardingPaths({ activeIntent }: { activeIntent: MaterialEntryIntent }) {
  const paths = [
    {
      intent: "resume" as const,
      title: "I have a resume",
      body:
        "Start with resume review and extraction. Expect thin project/evidence drafts, then enrich them with follow-up material.",
      steps: "Resume review -> extract signals -> enrich projects -> main resume",
    },
    {
      intent: "scratch" as const,
      title: "Build from scratch",
      body:
        "Use project notes, guided answers, or detailed docs first. Project stories become the backbone, then evidence claims support them.",
      steps: "Project intake -> evidence claims -> main resume",
    },
    {
      intent: "jd" as const,
      title: "I have a JD now",
      body:
        "Use the Jobs workspace for a quick tailored draft, but treat missing evidence as follow-up tasks for the library.",
      steps: "JD analysis -> tailored draft -> evidence gaps",
    },
  ];
  return (
    <section className="onboarding-paths" aria-label="Material Library paths">
      {paths.map((path) => (
        <article data-active={path.intent === activeIntent} key={path.title}>
          <span>{path.title}</span>
          <p>{path.body}</p>
          <small>{path.steps}</small>
        </article>
      ))}
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
        <span>Project stories</span>
        <strong>{summary.storyReadyProjects}</strong>
        <p>{summary.projectsNeedingContext} need more context</p>
      </article>
      <article>
        <span>Evidence claims</span>
        <strong>{summary.resumeReadyEvidence}</strong>
        <p>{summary.evidenceNeedingReview} need review or resume approval</p>
      </article>
      <article>
        <span>Next best action</span>
        <strong>{summary.nextActionTitle}</strong>
        <p>{summary.nextActionDetail}</p>
      </article>
    </section>
  );
}

function formatStatus(meta: Extract<ExtractionResponse, { data: unknown }>["meta"]) {
  if (meta.persistence?.status === "saved") {
    return `${meta.persistence.evidenceCount ?? 0} evidence items · ${meta.persistence.projectCount ?? 0} projects added`;
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

function getEntryGuidance(intent: MaterialEntryIntent) {
  if (intent === "scratch") {
    return {
      enrichmentHint:
        "Start with project notes, design docs, performance reviews, or guided answers. Project cards should become the backbone before generating a main resume.",
      fileImportLabel: "Import source doc",
      primaryActionLabel: "Extract Career Signals",
      primaryHint:
        "Optional: paste a short career summary above. For from-scratch intake, the Project Library Builder below is usually the higher-value first step.",
      primaryTitleLabel: "Career summary or source title",
      summary:
        "You are building the library from source material rather than starting from a resume. Prioritize project context, actions, outcomes, and metrics.",
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
    fileImportLabel: "Import resume/source",
    primaryActionLabel: "Extract Resume Signals",
    primaryHint:
      "Upload or paste your current resume. Expect initial cards to be thin until enriched with deeper source material.",
    primaryTitleLabel: "Resume or source title",
    summary:
      "Start from your existing resume, review its weak spots, then extract profile, project, and evidence signals for enrichment.",
  };
}

function summarizeLibraryReadiness({
  evidenceItems,
  projectCards,
}: {
  evidenceItems: EvidenceCardItem[];
  projectCards: ProjectCardItem[];
}) {
  const storyReadyProjects = projectCards.filter(
    (project) => getProjectReadiness(project).state === "story_ready",
  ).length;
  const projectsNeedingContext = projectCards.filter(
    (project) => getProjectReadiness(project).state !== "story_ready",
  ).length;
  const resumeReadyEvidence = evidenceItems.filter(
    (item) => getEvidenceReadiness(item).state === "resume_ready",
  ).length;
  const evidenceNeedingReview = evidenceItems.filter(
    (item) => getEvidenceReadiness(item).state !== "resume_ready",
  ).length;
  let nextActionTitle = "Add source material";
  let nextActionDetail = "Upload a resume or paste project notes to start the library.";
  if (projectCards.length > 0 && projectsNeedingContext > 0) {
    nextActionTitle = "Enrich project context";
    nextActionDetail = "Add project docs, review notes, metrics, or guided answers for thin stories.";
  } else if (evidenceItems.length > 0 && evidenceNeedingReview > 0) {
    nextActionTitle = "Review evidence claims";
    nextActionDetail = "Approve source-backed claims and mark resume-safe summaries before tailoring.";
  } else if (resumeReadyEvidence > 0) {
    nextActionTitle = "Generate resume";
    nextActionDetail = "Use the approved library to create a main resume or a JD-tailored draft.";
  }
  return {
    evidenceNeedingReview,
    nextActionDetail,
    nextActionTitle,
    projectsNeedingContext,
    resumeReadyEvidence,
    storyReadyProjects,
  };
}

function getProjectReadiness(project: ProjectCardItem) {
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

function estimateLinkedEvidenceCount(project: ProjectCardItem, evidenceItems: EvidenceCardItem[]) {
  return getProjectEvidence(project, evidenceItems).length;
}

function getProjectEvidence(project: ProjectCardItem, evidenceItems: EvidenceCardItem[]) {
  if (!project.id) return [];
  return evidenceItems.filter((item) => item.related_project_id === project.id);
}

function getUnlinkedEvidenceItems(
  projects: ProjectCardItem[],
  evidenceItems: EvidenceCardItem[],
) {
  const projectIds = new Set(
    projects.map((project) => project.id).filter((id): id is string => Boolean(id)),
  );
  return evidenceItems.filter(
    (item) => !item.related_project_id || !projectIds.has(item.related_project_id),
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

function formatProjectOverlapTitle(candidate: ProjectDedupeCandidate) {
  if (candidate.score >= 0.999) {
    return "Exact project title match";
  }
  return `Project similarity ${Math.round(candidate.score * 100)}%`;
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
        {library?.projectCards.length ?? 0} project cards
      </p>
    </section>
  );
}

function DedupePanel({
  evidenceCandidates,
  onEvidenceMerge,
  onProjectMerge,
  onRefresh,
  projectCandidates,
}: {
  evidenceCandidates: DedupeCandidate[];
  onEvidenceMerge: (candidate: DedupeCandidate) => void;
  onProjectMerge: (candidate: ProjectDedupeCandidate) => Promise<ProjectMergeResult>;
  onRefresh: () => void;
  projectCandidates: ProjectDedupeCandidate[];
}) {
  const [activeOverlap, setActiveOverlap] = useState<"projects" | "evidence">("projects");
  const activeCount =
    activeOverlap === "projects" ? projectCandidates.length : evidenceCandidates.length;
  return (
    <section className="section-block">
      <div className="requirement__top">
        <h3>Possible overlap cleanup</h3>
        <button className="secondary-button" type="button" onClick={onRefresh}>
          Refresh overlaps
        </button>
      </div>
      <p className="requirement__quote">
        Review project-level overlaps separately from evidence-level overlaps.
        Project merge combines story containers and moves linked evidence;
        evidence merge keeps one atomic claim and rejects the duplicate claim.
      </p>
      <div className="filter-row" role="group" aria-label="Overlap cleanup type">
        <button
          data-active={activeOverlap === "projects"}
          type="button"
          onClick={() => setActiveOverlap("projects")}
        >
          Project overlaps ({projectCandidates.length})
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
          No {activeOverlap === "projects" ? "project" : "evidence"} overlaps need review right now.
        </p>
      ) : activeOverlap === "projects" ? (
        <ProjectOverlapPanel candidates={projectCandidates} onMerge={onProjectMerge} />
      ) : (
        <EvidenceOverlapPanel candidates={evidenceCandidates} onMerge={onEvidenceMerge} />
      )}
    </section>
  );
}

function ProjectOverlapPanel({
  candidates,
  onMerge,
}: {
  candidates: ProjectDedupeCandidate[];
  onMerge: (candidate: ProjectDedupeCandidate) => Promise<ProjectMergeResult>;
}) {
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [messageById, setMessageById] = useState<Record<string, string>>({});
  async function confirmMerge(candidate: ProjectDedupeCandidate) {
    const key = `${candidate.primary.id}-${candidate.duplicate.id}`;
    setPendingId(key);
    setMessageById((messages) => ({
      ...messages,
      [key]: "Merging project cards...",
    }));
    try {
      const result = await onMerge(candidate);
      setMessageById((messages) => ({
        ...messages,
        [key]: `Merged ${result.duplicateProjectCount} duplicate project card${result.duplicateProjectCount === 1 ? "" : "s"}. Moved ${result.movedEvidenceCount} linked evidence item${result.movedEvidenceCount === 1 ? "" : "s"} to the kept project.`,
      }));
      setReviewingId(null);
    } catch (caught) {
      setMessageById((messages) => ({
        ...messages,
        [key]: caught instanceof Error ? caught.message : "Project merge failed.",
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
                <p className="requirement__text">Possible duplicate project</p>
                <p className="requirement__quote">
                  {formatProjectOverlapTitle(candidate)} · {candidate.duplicateCount} duplicate
                  project{candidate.duplicateCount === 1 ? "" : "s"} ·{" "}
                  {candidate.reasons.join(", ")}
                </p>
              </div>
              <span className="requirement__type">project overlap</span>
            </div>
            <div className="overlap-project-grid">
              <ProjectOverlapSummary label="Kept project" project={candidate.primary} />
              <ProjectOverlapSummary label="Duplicate example" project={candidate.duplicate} />
            </div>
            <div className="actions actions--compact">
              <button
                className="secondary-button"
                type="button"
                onClick={() => setReviewingId(isReviewing ? null : key)}
              >
                {isReviewing ? "Hide merge review" : "Review merge"}
              </button>
            </div>
            {isReviewing ? (
              <div className="merge-review">
                <p className="requirement__text">Merge confirmation</p>
                <p className="requirement__quote">
                  Keep <strong>{candidate.primary.title}</strong>. Merge{" "}
                  <strong>{candidate.duplicateCount} duplicate project card{candidate.duplicateCount === 1 ? "" : "s"}</strong>{" "}
                  into it, move{" "}
                  {candidate.duplicateEvidenceCount} linked evidence item
                  {candidate.duplicateEvidenceCount === 1 ? "" : "s"}, combine project
                  details, and mark the duplicate project as rejected.
                </p>
                <div className="merge-review__facts">
                  <span>Kept project status: {candidate.primary.status}</span>
                  <span>Duplicates to merge: {candidate.duplicateCount}</span>
                  <span>Kept evidence: {candidate.primaryEvidenceCount}</span>
                  <span>Evidence to move: {candidate.duplicateEvidenceCount}</span>
                </div>
                <div className="actions actions--compact">
	                  <button
	                    className="primary-button"
	                    disabled={Boolean(pendingId)}
	                    type="button"
                    onClick={() => void confirmMerge(candidate)}
                  >
                    {isPending ? "Merging..." : "Confirm merge"}
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

function ProjectOverlapSummary({
  label,
  project,
}: {
  label: string;
  project: ProjectDedupeItem;
}) {
  const signals = [
    project.context,
    project.problem,
    project.role,
    ...project.actions.slice(0, 2),
    ...project.results.slice(0, 2),
  ].filter((item): item is string => Boolean(item));
  return (
    <div className="overlap-project">
      <span>{label}</span>
      <strong>{project.title}</strong>
      {signals.length > 0 ? (
        <ul>
          {signals.slice(0, 4).map((signal) => (
            <li key={signal}>{signal}</li>
          ))}
        </ul>
      ) : (
        <p>No project details captured yet.</p>
      )}
    </div>
  );
}

function EvidenceOverlapPanel({
  candidates,
  onMerge,
}: {
  candidates: DedupeCandidate[];
  onMerge: (candidate: DedupeCandidate) => void;
}) {
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  return (
    <div className="result-stack result-stack--inner">
      {candidates.map((candidate) => {
        const key = `${candidate.primary.id}-${candidate.duplicate.id}`;
        const isReviewing = reviewingId === key;
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
                type="button"
                onClick={() => setReviewingId(isReviewing ? null : key)}
              >
                {isReviewing ? "Hide merge review" : "Review merge"}
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
                    type="button"
                    onClick={() => onMerge(candidate)}
                  >
                    Confirm evidence merge
                  </button>
                </div>
              </div>
            ) : null}
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
          No project cards are ready to promote into STAR stories yet.
        </p>
      ) : (
        <div className="result-stack result-stack--inner">
          {stories.slice(0, 4).map((story) => (
            <article className="requirement" key={story.id}>
              <div className="requirement__top">
                <p className="requirement__text">{story.title}</p>
                <span className="requirement__type">{story.readiness}</span>
              </div>
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
  onUpdate,
  projects,
  title = "Evidence Claims",
}: {
  description?: string;
  emptyMessage?: string;
  items: Array<{
    id?: string;
    text: string;
    source_quote: string;
    related_project_id?: string | null;
    evidence_type: string;
    sensitivity_level: string;
    allowed_usage?: string[];
    public_safe_summary?: string | null;
    status: string;
    needs_user_confirmation: boolean;
  }>;
  onUpdate: (
    item: EvidenceCardItem,
    action: EvidenceUpdateAction,
    patch?: EvidenceUpdatePatch,
  ) => Promise<{ ok: boolean; message: string }>;
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
      <div className="result-stack result-stack--inner">
        {visibleItems.map((item, index) => {
          return (
            <EvidenceCard
              cardMessage={item.id ? cardMessages[item.id] : null}
              isUpdating={item.id ? pendingEvidenceId === item.id : false}
              item={item}
              key={item.id ?? `${item.source_quote}-${index}`}
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

function EvidenceCard({
  cardMessage,
  isUpdating,
  item,
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
  projects?: ProjectCardItem[];
  variant?: "default" | "nested";
}) {
  const readiness = getEvidenceReadiness(item);
  const [isEditing, setIsEditing] = useState(false);
  const [draftText, setDraftText] = useState(item.text);
  const [draftSummary, setDraftSummary] = useState(item.public_safe_summary ?? "");
  const [draftSensitivity, setDraftSensitivity] = useState(item.sensitivity_level);
  const [draftProjectId, setDraftProjectId] = useState(item.related_project_id ?? "");
  const [draftAllowedUsage, setDraftAllowedUsage] = useState<string[]>(
    item.allowed_usage ?? [],
  );

  useEffect(() => {
    setDraftText(item.text);
    setDraftSummary(item.public_safe_summary ?? "");
    setDraftSensitivity(item.sensitivity_level);
    setDraftProjectId(item.related_project_id ?? "");
    setDraftAllowedUsage(item.allowed_usage ?? []);
  }, [
    item.allowed_usage,
    item.public_safe_summary,
    item.related_project_id,
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
      relatedProjectId: draftProjectId || null,
      sensitivityLevel: externalSafe ? "public_safe" : draftSensitivity,
      text: draftText.trim(),
    });
    setIsEditing(false);
  }

  return (
    <article
      className={variant === "nested" ? "requirement evidence-subcard" : "requirement"}
    >
      <div className="requirement__top">
        <p className="requirement__text">{item.text}</p>
        <span className="requirement__type">{readiness.label}</span>
      </div>
      <p className="requirement__quote">{readiness.next}</p>
      <p className="requirement__quote">Quote: {item.source_quote}</p>
      {item.public_safe_summary ? (
        <p className="requirement__quote">External-safe: {item.public_safe_summary}</p>
      ) : null}
      <div className="chip-row">
        <span className="chip">{item.evidence_type}</span>
        <span className="chip">{item.sensitivity_level}</span>
        <span className="chip">{item.status}</span>
        {(item.allowed_usage ?? []).map((usage) => (
          <span className="chip" key={usage}>
            {usage}
          </span>
        ))}
        {item.needs_user_confirmation ? <span className="chip">needs confirmation</span> : null}
      </div>
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
      {cardMessage ? (
        <p className={cardMessage.ok ? "card-message" : "card-message card-message--error"}>
          {cardMessage.text}
        </p>
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
              Link to project
              <select
                value={draftProjectId}
                onChange={(event) => setDraftProjectId(event.target.value)}
              >
                <option value="">Unlinked evidence</option>
                {projects.map((project) => (
                  <option key={project.id ?? project.title} value={project.id ?? ""}>
                    {project.title}
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
    </article>
  );
}

function ProjectList({
  evidenceItems,
  onEnrichProject,
  onEvidenceUpdate,
  onUpdate,
  projects,
}: {
  evidenceItems: EvidenceCardItem[];
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
