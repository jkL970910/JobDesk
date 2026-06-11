"use client";

import { useEffect, useState, useTransition } from "react";

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

type EvidenceLibrary = {
  profile: { displayName: string | null; updatedAt: string } | null;
  evidenceItems: Array<{
    id: string;
    text: string;
    source_quote: string;
    source_document_id?: string | null;
    evidence_type: string;
    sensitivity_level: string;
    allowed_usage: string[];
    status: string;
    needs_user_confirmation: boolean;
  }>;
  projectCards: Array<{
    id: string;
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
  }>;
};

export function ProfileEvidenceWorkspace() {
  const [sourceText, setSourceText] = useState(sampleProfileSource);
  const [sourceTitle, setSourceTitle] = useState("Sample resume notes");
  const [projectNoteText, setProjectNoteText] = useState(sampleProjectNote);
  const [projectNoteTitle, setProjectNoteTitle] = useState("Sample project note");
  const [fileStatus, setFileStatus] = useState<string | null>(null);
  const [result, setResult] = useState<ProfileEvidenceExtraction | null>(null);
  const [library, setLibrary] = useState<EvidenceLibrary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("OpenRouter profile/evidence contract call");
  const [isPending, startTransition] = useTransition();
  const [isProjectPending, startProjectTransition] = useTransition();

  useEffect(() => {
    void loadLibrary();
  }, []);

  async function loadLibrary() {
    const response = await fetch("/api/profile-evidence/recent");
    if (!response.ok) return;
    const payload = (await response.json()) as { data?: EvidenceLibrary };
    setLibrary(payload.data ?? null);
  }

  async function refreshLibraryAfterMutation() {
    await loadLibrary();
    window.dispatchEvent(new Event("jobdesk:evidence-library-updated"));
  }

  function runExtraction() {
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/profile-evidence/extract", {
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
        setResult(payload.data);
        setStatus(formatStatus(payload.meta));
        void refreshLibraryAfterMutation();
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Profile evidence extraction failed.",
        );
      }
    });
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
        `Loaded ${file.name} · ${text.trim().length.toLocaleString()} characters`,
      );
      return;
    }

    setFileStatus(`Reading ${file.name}...`);
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch("/api/profile-evidence/parse-source", {
      method: "POST",
      body: formData,
    });
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
      `Loaded ${payload.data.sourceTitle} · ${payload.data.sourceKind.toUpperCase()} · ${payload.data.sourceText.length.toLocaleString()} characters${payload.data.warnings.length > 0 ? ` · ${payload.data.warnings.length} parser warning${payload.data.warnings.length === 1 ? "" : "s"}` : ""}`,
    );
  }

  function runProjectEnrichment() {
    setError(null);
    startProjectTransition(async () => {
      try {
        const response = await fetch("/api/profile-evidence/enrich-project", {
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
        setResult(payload.data);
        setStatus(`Project enriched · ${formatStatus(payload.meta)}`);
        void refreshLibraryAfterMutation();
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Project evidence enrichment failed.",
        );
      }
    });
  }

  const sourceIsReady = sourceText.trim().length >= 80;
  const projectNoteIsReady = projectNoteText.trim().length >= 80;
  const profile = result?.profile;
  const evidenceItems = result?.evidence_items ?? library?.evidenceItems ?? [];
  const projectCards = result?.project_cards ?? library?.projectCards ?? [];

  async function updateEvidence(
    item: { id?: string; text: string; allowed_usage?: string[] },
    action: "approve" | "approve_for_resume" | "reject" | "edit",
  ) {
    if (!item.id) return;
    const nextText =
      action === "edit" ? window.prompt("Edit evidence text", item.text) : null;
    if (action === "edit" && !nextText?.trim()) return;
    const response = await fetch(`/api/evidence/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        action === "edit"
          ? { action, text: nextText }
          : action === "approve_for_resume"
            ? { action, allowedUsage: item.allowed_usage ?? [] }
            : { action },
      ),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setError(payload?.error ?? "Failed to update evidence.");
      return;
    }
    setResult(null);
    void refreshLibraryAfterMutation();
  }

  async function updateProject(
    project: { id?: string; title: string; role: string | null },
    action: "approve" | "reject" | "edit" | "approve_project_evidence_for_resume",
  ) {
    if (!project.id) return;
    const nextTitle =
      action === "edit" ? window.prompt("Edit project title", project.title) : null;
    if (action === "edit" && !nextTitle?.trim()) return;
    const response = await fetch(`/api/projects/${project.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        action === "edit" ? { action, title: nextTitle } : { action },
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
    <section className="workspace__grid workspace__grid--stacked">
      <div className="panel">
        <div className="panel__header">
          <div>
            <h2 className="panel__title">Profile and evidence source</h2>
            <p className="panel__note">
              Paste resume text or import a PDF, DOCX, plain text, or Markdown
              resume. Extracted evidence can be reviewed and allowed for resumes.
            </p>
          </div>
        </div>
        <div className="source-controls">
          <label className="source-field">
            <span>Source title</span>
            <input
              className="source-input"
              type="text"
              value={sourceTitle}
              onChange={(event) => setSourceTitle(event.target.value)}
            />
          </label>
          <label className="file-import">
            <span>Import resume</span>
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
            disabled={isPending || !sourceIsReady}
            type="button"
            onClick={runExtraction}
          >
            {isPending ? "Extracting..." : "Extract Profile/Evidence"}
          </button>
          <span className={error ? "status status--error" : "status"}>
            {error ?? status}
          </span>
        </div>

        <section className="section-block section-block--builder">
          <h3>Project Library Builder</h3>
          <p className="panel__note">
            Add project notes, work summaries, or accomplishment drafts to grow
            the evidence library beyond a single uploaded resume.
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
              disabled={isProjectPending || !projectNoteIsReady}
              type="button"
              onClick={runProjectEnrichment}
            >
              {isProjectPending ? "Enriching..." : "Enrich Project Note"}
            </button>
          </div>
        </section>
      </div>

      <div className="panel">
        <div className="panel__header">
          <div>
            <h2 className="panel__title">Evidence library draft</h2>
            <p className="panel__note">
              Every retained item must have source provenance before it can power
              resume tailoring.
            </p>
          </div>
        </div>
        {profile ? <ProfileSummary extraction={result} /> : <LibrarySummary library={library} />}
        <EvidenceList
          items={evidenceItems}
          onUpdate={updateEvidence}
        />
        <ProjectList projects={projectCards} onUpdate={updateProject} />
      </div>
    </section>
  );
}

function formatStatus(meta: Extract<ExtractionResponse, { data: unknown }>["meta"]) {
  const saved =
    meta.persistence?.status === "saved"
      ? `${meta.persistence.evidenceCount ?? 0} evidence · ${meta.persistence.projectCount ?? 0} projects saved`
      : meta.persistence?.reason === "missing_database_url"
        ? "database not configured"
        : "not saved";
  return `Validated · retries ${meta.retryCount} · ${saved}`;
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
        Run extraction to create profile and reusable evidence drafts.
      </div>
    );
  }
  return (
    <section className="job-facts">
      <p className="requirement__text">
        Latest profile: {library?.profile?.displayName ?? "Unnamed profile"}
      </p>
      <p className="requirement__quote">
        {library?.evidenceItems.length ?? 0} recent evidence drafts ·{" "}
        {library?.projectCards.length ?? 0} project cards
      </p>
    </section>
  );
}

function EvidenceList({
  items,
  onUpdate,
}: {
  items: Array<{
    id?: string;
    text: string;
    source_quote: string;
    evidence_type: string;
    sensitivity_level: string;
    allowed_usage?: string[];
    status: string;
    needs_user_confirmation: boolean;
  }>;
  onUpdate: (
    item: { id?: string; text: string; allowed_usage?: string[] },
    action: "approve" | "approve_for_resume" | "reject" | "edit",
  ) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="result-stack result-stack--inner">
      {items.slice(0, 6).map((item, index) => (
        <article className="requirement" key={item.id ?? `${item.source_quote}-${index}`}>
          <div className="requirement__top">
            <p className="requirement__text">{item.text}</p>
            <span className="requirement__type">{item.evidence_type}</span>
          </div>
          <p className="requirement__quote">Quote: {item.source_quote}</p>
          <div className="chip-row">
            <span className="chip">{item.sensitivity_level}</span>
            <span className="chip">{item.status}</span>
            {(item.allowed_usage ?? []).map((usage) => (
              <span className="chip" key={usage}>
                {usage}
              </span>
            ))}
            {item.needs_user_confirmation ? (
              <span className="chip">needs confirmation</span>
            ) : null}
          </div>
          {item.id ? (
            <div className="actions actions--compact">
              <button
                className="secondary-button"
                type="button"
                onClick={() => onUpdate(item, "approve")}
              >
                Approve
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => onUpdate(item, "edit")}
              >
                Edit
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => onUpdate(item, "reject")}
              >
                Reject
              </button>
              {item.status !== "approved" ||
              item.needs_user_confirmation ||
              !(item.allowed_usage ?? []).includes("resume") ? (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => onUpdate(item, "approve_for_resume")}
                >
                  Approve for resume
                </button>
              ) : null}
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

function ProjectList({
  onUpdate,
  projects,
}: {
  onUpdate: (
    project: { id?: string; title: string; role: string | null },
    action: "approve" | "reject" | "edit" | "approve_project_evidence_for_resume",
  ) => void;
  projects: Array<{
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
  }>;
}) {
  if (projects.length === 0) return null;
  return (
    <section className="section-block">
      <h3>Project cards</h3>
      {projects.slice(0, 4).map((project) => (
        <article className="requirement" key={project.id ?? project.title}>
          <div className="requirement__top">
            <p className="requirement__text">{project.title}</p>
            <span className="requirement__type">{project.status}</span>
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
            {project.sensitivity_level ? (
              <span className="chip">{project.sensitivity_level}</span>
            ) : null}
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
        </article>
      ))}
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
