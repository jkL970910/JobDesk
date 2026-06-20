"use client";

import { useEffect, useState, useTransition } from "react";

import { useAccess } from "./access-provider";

import type { JDAnalysis } from "../schemas/jd-analysis";
import type { TailoredResumeDraft } from "../schemas/tailored-resume";

type RecentJob = {
  id: string;
  title: string;
  job_facts: JDAnalysis["job_facts"];
  analyzedAt: string | null;
  requirementCount: number;
};

type ResumeClaim = {
  id: string;
  claim_text: string;
  section: string;
  evidence_ids: string[];
  source_quotes: string[];
  risk_level: string;
  support_status?: string;
  claim_status?: string;
  stale_reason?: string | null;
  last_validated_at?: string | null;
};

type RecentResume = {
  id: string;
  jobId: string;
  title: string;
  resume_markdown: string;
  missing_evidence_questions: string[];
  status: string;
  updatedAt: string;
  claims: ResumeClaim[];
};

type EvidenceLibrary = {
  profile: { displayName: string | null; updatedAt: string } | null;
  evidenceItems: Array<{
    id: string;
    text: string;
    allowed_usage: string[];
    status: string;
    needs_user_confirmation: boolean;
  }>;
};

type ResumeReadiness = {
  profileName: string | null;
  profileReady: boolean;
  approvedResumeEvidenceCount: number;
  needsReviewEvidenceCount: number;
  evidenceSamples: string[];
};

const emptyReadiness: ResumeReadiness = {
  profileName: null,
  profileReady: false,
  approvedResumeEvidenceCount: 0,
  needsReviewEvidenceCount: 0,
  evidenceSamples: [],
};

type TailorResponse =
  | {
      data: TailoredResumeDraft;
      meta: {
        retryCount: number;
        evidenceCount: number;
        persistence?: {
          status: "saved" | "skipped";
          reason?: string;
          resumeVersionId?: string;
          claimCount?: number;
        };
        factGuard?: {
          status: "validated" | "skipped" | "not_found" | "failed";
          reason?: string;
          supportedCount?: number;
          claimCount?: number;
          resumeStatus?: string;
          coveragePassed?: boolean;
          coverageReason?: string | null;
          claims?: ResumeClaim[];
        } | null;
        selectedEvidence?: Array<{
          id: string;
          retrieval_score: number;
          reason_for_selection: string[];
        }>;
      };
    }
  | { error: string; kind?: string };

export function TailoredResumeWorkspace() {
  const { fetchJson } = useAccess();
  const [jobs, setJobs] = useState<RecentJob[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [latestResume, setLatestResume] = useState<RecentResume | null>(null);
  const [readiness, setReadiness] = useState<ResumeReadiness>(emptyReadiness);
  const [draft, setDraft] = useState<TailoredResumeDraft | null>(null);
  const [draftMeta, setDraftMeta] = useState<{
    id?: string;
    status: string;
    claims?: ResumeClaim[];
  } | null>(null);
  const [status, setStatus] = useState(
    "Select a role workspace and approved material-library evidence.",
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isFactGuardPending, startFactGuardTransition] = useTransition();

  useEffect(() => {
    void loadJobs();
    void loadRecentResumes();
    void loadReadiness();
    const refreshReadiness = () => void loadReadiness();
    window.addEventListener("jobdesk:evidence-library-updated", refreshReadiness);
    return () =>
      window.removeEventListener("jobdesk:evidence-library-updated", refreshReadiness);
  }, []);

  async function loadJobs() {
    const response = await fetchJson("/api/jobs/recent");
    if (!response.ok) {
      setError(await formatLoadError(response, "Could not load saved jobs."));
      return;
    }
    const payload = (await response.json()) as { data?: RecentJob[] };
    const nextJobs = payload.data ?? [];
    setJobs(nextJobs);
    setSelectedJobId((current) => current || nextJobs[0]?.id || "");
  }

  async function loadRecentResumes() {
    const response = await fetchJson("/api/resumes/recent");
    if (!response.ok) {
      setError(await formatLoadError(response, "Could not load resume versions."));
      return [];
    }
    const payload = (await response.json()) as { data?: RecentResume[] };
    const resumes = payload.data ?? [];
    setLatestResume(resumes[0] ?? null);
    return resumes;
  }

  async function loadReadiness() {
    const response = await fetchJson("/api/profile-evidence/recent");
    if (!response.ok) {
      setError(await formatLoadError(response, "Could not load material library readiness."));
      setReadiness(emptyReadiness);
      return;
    }
    const payload = (await response.json()) as { data?: EvidenceLibrary };
    const library = payload.data;
    const items = library?.evidenceItems ?? [];
    const approvedResumeEvidence = items.filter(
      (item) =>
        item.status === "approved" &&
        item.allowed_usage.includes("resume") &&
        !item.needs_user_confirmation,
    );
    setReadiness({
      profileName: library?.profile?.displayName ?? null,
      profileReady: Boolean(library?.profile),
      approvedResumeEvidenceCount: approvedResumeEvidence.length,
      needsReviewEvidenceCount: items.length - approvedResumeEvidence.length,
      evidenceSamples: approvedResumeEvidence.slice(0, 3).map((item) => item.text),
    });
  }

  function generateResume() {
    if (!selectedJobId) return;
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetchJson("/api/resumes/tailor", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jobId: selectedJobId }),
        });
        const payload = (await response.json()) as TailorResponse;
        if (!response.ok || "error" in payload) {
          setError(
            "error" in payload
              ? `${payload.error}${payload.kind ? ` (${payload.kind})` : ""}`
              : "Tailored resume generation failed.",
          );
          return;
        }
        const factGuard = payload.meta.factGuard;
        setStatus(buildGenerationStatus(payload));
        void loadReadiness();
        const resumes = await loadRecentResumes();
        const savedResumeId = payload.meta.persistence?.resumeVersionId;
        const savedResume = savedResumeId
          ? resumes.find((resume) => resume.id === savedResumeId)
          : null;
        setDraft(payload.data);
        setDraftMeta({
          id: savedResumeId,
          status:
            factGuard?.status === "validated"
              ? factGuard.resumeStatus ?? savedResume?.status ?? "validated"
              : savedResume?.status && savedResume.id === savedResumeId
                ? savedResume.status
                : "unvalidated",
          claims: factGuard?.claims,
        });
        if (savedResume) {
          setLatestResume(
            factGuard?.status === "validated"
              ? {
                  ...savedResume,
                  status: factGuard.resumeStatus ?? savedResume.status,
                  claims: factGuard.claims ?? savedResume.claims,
                }
              : savedResume,
          );
          if (factGuard?.status === "validated") setDraft(null);
          if (factGuard?.status === "validated") setDraftMeta(null);
        }
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "Tailored resume generation failed.",
        );
      }
    });
  }

  async function runFactGuard() {
    if (!latestResume?.id) return;
    setError(null);
    startFactGuardTransition(async () => {
      const response = await fetchJson(`/api/resumes/${latestResume.id}/fact-guard`, {
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            data?: {
              supportedCount: number;
              claimCount: number;
              resumeStatus: string;
              coveragePassed: boolean;
              coverageReason: string | null;
              claims: ResumeClaim[];
            };
            error?: string;
          }
        | null;
      if (!response.ok) {
        setError(payload?.error ?? "Resume review failed.");
        return;
      }
      if (!payload?.data) {
        setError("Resume review did not return a claim report.");
        return;
      }
      const report = payload.data;
      setStatus(
        `Review complete · ${report.supportedCount}/${report.claimCount} claims supported · ${report.resumeStatus}`,
      );
      setLatestResume((current) =>
        current
          ? {
              ...current,
              status: report.resumeStatus,
              claims: report.claims,
            }
          : current,
      );
      setDraft(null);
      setDraftMeta(null);
      void loadRecentResumes();
    });
  }

  const selectedJob = jobs.find((job) => job.id === selectedJobId);
  const canGenerateResume =
    Boolean(selectedJobId) &&
    readiness.profileReady &&
    readiness.approvedResumeEvidenceCount > 0;
  const displayResume = draft
    ? {
        id: draftMeta?.id,
        title: draft.title,
        resume_markdown: draft.resume_markdown,
        missing_evidence_questions: draft.missing_evidence_questions,
        status: draftMeta?.status ?? "unvalidated",
        claims: draftMeta?.claims ?? draft.claims.map((claim, index) => ({
          id: `${claim.claim_text}-${index}`,
          claim_text: claim.claim_text,
          section: claim.section,
          evidence_ids: claim.evidence_ids,
          source_quotes: claim.source_quotes,
          risk_level: claim.risk_level,
        })),
      }
    : latestResume;

  async function exportResume(resumeId: string, format: "markdown" | "json") {
    const response = await fetchJson(
      `/api/resumes/${resumeId}/export?format=${format}`,
    );
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setError(payload?.error ?? "Resume export failed.");
      return;
    }
    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") ?? "";
    const fileName =
      disposition.match(/filename="([^"]+)"/)?.[1] ??
      `jobdesk-resume.${format === "json" ? "json" : "md"}`;
    downloadBlob(fileName, blob);
  }

  return (
    <section className="workspace__grid">
      <div className="panel">
        <div className="panel__header">
          <div>
            <h2 className="panel__title">Tailored resume input</h2>
            <p className="panel__note">
              Requires one analyzed JD plus material-library evidence approved
              for resume use.
            </p>
          </div>
        </div>
        <ResumeReadinessChecklist
          approvedResumeEvidenceCount={readiness.approvedResumeEvidenceCount}
          evidenceSamples={readiness.evidenceSamples}
          hasSelectedJob={Boolean(selectedJobId)}
          needsReviewEvidenceCount={readiness.needsReviewEvidenceCount}
          profileName={readiness.profileName}
          profileReady={readiness.profileReady}
        />
        {jobs.length > 0 ? (
          <div className="recent-jobs" aria-label="Recent jobs for resume tailoring">
            {jobs.map((job) => (
              <button
                className="recent-job"
                data-selected={job.id === selectedJobId}
                key={job.id}
                type="button"
                onClick={() => setSelectedJobId(job.id)}
              >
                <span>{job.title}</span>
                <small>
                  {job.requirementCount} requirements
                  {job.job_facts.company ? ` · ${job.job_facts.company}` : ""}
                </small>
              </button>
            ))}
          </div>
        ) : (
          <div className="empty-state empty-state--compact">
            Analyze a target JD after preparing reusable evidence.
          </div>
        )}
        <div className="actions">
          <button
            className="primary-button"
            disabled={isPending || !canGenerateResume}
            type="button"
            onClick={generateResume}
          >
            {isPending ? "Generating..." : "Generate Tailored Resume"}
          </button>
          {latestResume ? (
            <button
              className="secondary-button"
              disabled={isPending || isFactGuardPending}
              type="button"
              onClick={() => void runFactGuard()}
            >
              {isFactGuardPending ? "Checking..." : "Review Claims"}
            </button>
          ) : null}
          <span className={error ? "status status--error" : "status"}>
            {error ?? status}
          </span>
        </div>
        {selectedJob ? (
          <section className="job-facts">
            <p className="requirement__text">{selectedJob.title}</p>
            <p className="requirement__quote">
              Target role context comes from the selected job workspace.
            </p>
          </section>
        ) : null}
      </div>

      <div className="panel">
        <div className="panel__header">
          <div>
            <h2 className="panel__title">Resume draft and claim review</h2>
            <p className="panel__note">
              Review claim support before using the resume externally.
            </p>
          </div>
        </div>
        {displayResume ? (
          <ResumeResult exportResume={exportResume} resume={displayResume} />
        ) : (
          <div className="empty-state empty-state--compact">
            Approve evidence for resume use, then generate a tailored draft.
          </div>
        )}
      </div>
    </section>
  );
}

function ResumeReadinessChecklist({
  approvedResumeEvidenceCount,
  evidenceSamples,
  hasSelectedJob,
  needsReviewEvidenceCount,
  profileName,
  profileReady,
}: {
  approvedResumeEvidenceCount: number;
  evidenceSamples: string[];
  hasSelectedJob: boolean;
  needsReviewEvidenceCount: number;
  profileName: string | null;
  profileReady: boolean;
}) {
  return (
    <section className="readiness-panel" aria-label="Resume readiness checklist">
      <ReadinessItem
        isReady={hasSelectedJob}
        label="Target JD"
        readyText="Role workspace selected"
        todoText="Analyze or select a target JD"
      />
      <ReadinessItem
        isReady={profileReady}
        label="Profile"
        readyText={profileName ? `Profile loaded: ${profileName}` : "Profile loaded"}
        todoText="Extract profile from resume notes"
      />
      <ReadinessItem
        isReady={approvedResumeEvidenceCount > 0}
        label="Resume evidence"
        readyText={`${approvedResumeEvidenceCount} approved resume item${approvedResumeEvidenceCount === 1 ? "" : "s"}`}
        todoText={
          needsReviewEvidenceCount > 0
            ? `${needsReviewEvidenceCount} item${needsReviewEvidenceCount === 1 ? "" : "s"} need review or resume approval`
            : "Approve at least one evidence item for resume use"
        }
      />
      {evidenceSamples.length > 0 ? (
        <ul className="readiness-samples" aria-label="Approved evidence samples">
          {evidenceSamples.map((sample) => (
            <li key={sample}>{sample}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function ReadinessItem({
  isReady,
  label,
  readyText,
  todoText,
}: {
  isReady: boolean;
  label: string;
  readyText: string;
  todoText: string;
}) {
  return (
    <div className="readiness-item" data-ready={isReady}>
      <span className="readiness-item__state">{isReady ? "Ready" : "Needed"}</span>
      <div>
        <p className="readiness-item__label">{label}</p>
        <p className="readiness-item__detail">{isReady ? readyText : todoText}</p>
      </div>
    </div>
  );
}

function buildGenerationStatus(payload: Extract<TailorResponse, { data: TailoredResumeDraft }>) {
  const factGuard = payload.meta.factGuard;
  if (factGuard?.status === "validated") {
    return `Resume drafted and reviewed · ${factGuard.supportedCount ?? 0}/${factGuard.claimCount ?? payload.data.claims.length} claims supported · ${factGuard.resumeStatus ?? "unvalidated"}`;
  }
  if (factGuard?.status === "failed") {
    return `Resume drafted · automatic claim review failed · ${factGuard.reason ?? "run Review Claims before external use"}`;
  }
  if (factGuard?.status === "skipped") {
    return `Resume drafted · claim review unavailable · ${factGuard.reason ?? "run Review Claims when storage is available"}`;
  }
  return `Resume drafted · ${payload.meta.evidenceCount} evidence items used · ${payload.meta.persistence?.claimCount ?? payload.data.claims.length} claims to review`;
}

function ResumeResult({
  exportResume,
  resume,
}: {
  exportResume: (resumeId: string, format: "markdown" | "json") => Promise<void>;
  resume: {
    id?: string;
    title: string;
    resume_markdown: string;
    missing_evidence_questions: string[];
    status?: string;
    claims: ResumeClaim[];
  };
}) {
  const isValidated = resume.status === "validated";
  return (
    <div className="result-stack">
      <article className="requirement">
        <p className="requirement__text">{resume.title}</p>
        {resume.status ? (
          <div className="chip-row">
            <span className="chip">{resume.status}</span>
          </div>
        ) : null}
        <div className="actions actions--compact">
          <button
            className="secondary-button"
            type="button"
            disabled={!isValidated}
            onClick={() => void copyMarkdown(resume.resume_markdown)}
            title={isValidated ? "Copy validated resume Markdown" : "Blocked until Fact Guard validates this resume"}
          >
            Copy Markdown
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={!isValidated}
            onClick={() => downloadMarkdown(resume.title, resume.resume_markdown)}
            title={isValidated ? "Download validated resume Markdown" : "Blocked until Fact Guard validates this resume"}
          >
            Download .md
          </button>
          {resume.id ? (
            <>
              <button
                className="secondary-button"
                type="button"
                disabled={!isValidated}
                onClick={() => void exportResume(resume.id!, "markdown")}
                title={isValidated ? "Export validated Markdown" : "Blocked until Fact Guard validates this resume"}
              >
                Export Markdown
              </button>
              <button
                className="secondary-button secondary-button--quiet"
                type="button"
                onClick={() => void exportResume(resume.id!, "json")}
              >
                JSON audit
              </button>
            </>
          ) : null}
        </div>
        {!isValidated ? (
          <p className="requirement__quote">
            Draft only. Final Markdown export unlocks after Fact Guard validates every generated claim.
            Use JSON audit for review data.
          </p>
        ) : null}
        <pre className="resume-preview">{resume.resume_markdown}</pre>
      </article>
      {resume.missing_evidence_questions.length > 0 ? (
        <Section title="Missing evidence questions" items={resume.missing_evidence_questions} />
      ) : null}
      <ClaimReviewPanel claims={resume.claims} />
    </div>
  );
}

function ClaimReviewPanel({ claims }: { claims: ResumeClaim[] }) {
  const supported = claims.filter((claim) => claim.support_status === "supported").length;
  const unsupported = claims.filter((claim) => claim.support_status === "unsupported").length;
  const partial = claims.filter(
    (claim) => claim.support_status === "partially_supported",
  ).length;
  const unvalidated = claims.filter((claim) => !claim.support_status || claim.support_status === "unvalidated").length;
  const needsReview = unsupported + partial + unvalidated;

  return (
    <section className="section-block claim-review">
      <div className="claim-review__header">
        <div>
          <h3>Claim support review</h3>
          <p className="claim-review__note">
            Review any unsupported or partial claim before using this resume.
          </p>
        </div>
        <div className="claim-review__score" data-ready={needsReview === 0 && claims.length > 0}>
          {supported}/{claims.length} supported
        </div>
      </div>
      <div className="claim-review__metrics">
        <span>Supported {supported}</span>
        <span>Partial {partial}</span>
        <span>Unsupported {unsupported}</span>
        <span>Unvalidated {unvalidated}</span>
      </div>
      <div className="result-stack result-stack--inner">
        {claims.slice(0, 12).map((claim) => (
          <ClaimCard claim={claim} key={claim.id} />
        ))}
      </div>
    </section>
  );
}

function ClaimCard({ claim }: { claim: ResumeClaim }) {
  const status = claim.support_status ?? "unvalidated";
  return (
    <article className="claim-card" data-status={status}>
      <div className="requirement__top">
        <p className="requirement__text">{claim.claim_text}</p>
        <span className="requirement__type">{claim.risk_level}</span>
      </div>
      <p className="requirement__quote">Section: {claim.section}</p>
      <div className="chip-row">
        <span className="chip">{status}</span>
        {claim.claim_status && claim.claim_status !== status ? (
          <span className="chip">{claim.claim_status}</span>
        ) : null}
        {claim.evidence_ids.map((id) => (
          <span className="chip" key={id}>
            evidence
          </span>
        ))}
      </div>
      {claim.source_quotes[0] ? (
        <p className="requirement__quote">Support: {claim.source_quotes[0]}</p>
      ) : null}
      {claim.stale_reason ? (
        <p className="claim-card__warning">Needs review: {claim.stale_reason}</p>
      ) : null}
      {claim.last_validated_at ? (
        <p className="requirement__quote">
          Last validated: {new Date(claim.last_validated_at).toLocaleString()}
        </p>
      ) : null}
    </article>
  );
}

async function copyMarkdown(markdown: string) {
  await navigator.clipboard.writeText(markdown);
}

function downloadMarkdown(title: string, markdown: string) {
  const safeTitle = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeTitle || "tailored-resume"}.md`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadBlob(fileName: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
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

function Section({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <section className="section-block">
      <h3>{title}</h3>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}
