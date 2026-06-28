"use client";

import { useEffect, useState, type DragEvent, type ReactNode } from "react";

import { useAccess } from "./access-provider";
import { buildDimensionDetail } from "./resume-review-dimension-detail";

export type ResumeSourceReviewSummary = {
  activeReviewRun: ResumeReviewRunSummary | null;
  id: string;
  title: string;
  sourceKind: string;
  version: number;
  status: string;
  updatedAt: string;
  latestReview: ResumeReviewReport | null;
};

type ResumeReviewRunSummary = {
  id: string;
  status: "running" | "succeeded" | "failed" | "skipped";
  stage: "queued" | "reading_source" | "analyzing" | "validating" | "saving" | "completed" | "failed";
  startedAt: string;
  finishedAt: string | null;
  errorKind: string | null;
  errorMessage: string | null;
};

type ReviewMetadata = {
  key?: string;
  provider?: string;
  model?: string;
  confidence?: number;
  scopeNote?: string;
  tenSecondScan?: string;
  atsNotes?: string[];
  fairnessCheck?: {
    applied?: boolean;
    note?: string;
    signals_not_penalized?: string[];
  };
  providerFailureKind?: string | null;
  retryCount?: number;
};

type ResumeReviewReport = {
  id: string;
  overallScore: number;
  rubric: Array<{
    evidenceQuestions?: string[];
    findings?: string[];
    helpedScore?: string[];
    key?: string;
    label?: string;
    loweredScore?: string[];
    nextAction?: string;
    raiseScore?: string[];
    score?: number;
    maxScore?: number;
    note?: string;
    provider?: string;
    model?: string;
    confidence?: number;
    scopeNote?: string;
    tenSecondScan?: string;
    atsNotes?: string[];
    fairnessCheck?: ReviewMetadata["fairnessCheck"];
    providerFailureKind?: string | null;
    retryCount?: number;
  }>;
  strengths: string[];
  weaknesses: string[];
  recommendedActions: string[];
  missingEvidenceQuestions: string[];
  riskFlags: string[];
};

type EnrichmentTaskSummary = {
  id: string;
  prompt: string;
  source_type: string;
  source_label: string;
  status: "open" | "answered" | "converted" | "dismissed";
  resume_source_version_id: string | null;
  resume_review_report_id: string | null;
};

type ReviewQuestionStatus = EnrichmentTaskSummary["status"] | "not_created";

type ParseQuality = {
  status: "usable" | "warning" | "needs_ocr" | "failed";
  charCount: number;
  wordCount: number;
  pageCount?: number;
  warnings: string[];
};

type ResumeParseStatus = {
  filename: string;
  title: string;
  parseQuality: ParseQuality;
};

export function ResumeReviewWorkspace({
  onExtractToEvidence,
  onOpenEvidenceReview,
  onOpenEvidenceTask,
}: {
  onExtractToEvidence: (resumeSourceVersionId: string) => void;
  onOpenEvidenceReview: (tab?: "enrichment" | "projects" | "unlinked" | "cleanup" | "stories") => void;
  onOpenEvidenceTask: (taskId: string) => void;
}) {
  const { fetchJson } = useAccess();
  const [resumes, setResumes] = useState<ResumeSourceReviewSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [status, setStatus] = useState("Upload a resume to create a reviewed source version.");
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [uploadElapsedSeconds, setUploadElapsedSeconds] = useState(0);
  const [activeOperation, setActiveOperation] = useState<string | null>(null);
  const [duplicateResume, setDuplicateResume] = useState<ResumeSourceReviewSummary | null>(null);
  const [parseStatus, setParseStatus] = useState<ResumeParseStatus | null>(null);
  const [enrichmentTasks, setEnrichmentTasks] = useState<EnrichmentTaskSummary[]>([]);
  const [reviewRunElapsedSeconds, setReviewRunElapsedSeconds] = useState(0);
  const selectedResume = isUploading
    ? null
    : resumes.find((resume) => resume.id === selectedId) ?? resumes[0] ?? null;
  const selectedReview = selectedResume?.latestReview ?? null;
  const selectedResumeIsExtracted = selectedResume?.status === "extracted";
  const selectedActiveReviewRun =
    selectedResume?.activeReviewRun?.status === "running"
      ? selectedResume.activeReviewRun
      : null;

  useEffect(() => {
    void loadResumes();
  }, []);

  useEffect(() => {
    if (!selectedResume?.id) {
      setEnrichmentTasks([]);
      return;
    }
    void loadEnrichmentTasks(selectedResume);
  }, [selectedResume?.id, selectedResume?.latestReview?.id]);

  useEffect(() => {
    if (!selectedActiveReviewRun) {
      setReviewRunElapsedSeconds(0);
      return;
    }
    const startedAt = new Date(selectedActiveReviewRun.startedAt).getTime();
    const updateElapsed = () => {
      setReviewRunElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
    };
    updateElapsed();
    const elapsedTimer = window.setInterval(updateElapsed, 1000);
    const pollTimer = window.setInterval(() => {
      void refreshReviewRun(selectedActiveReviewRun.id, selectedResume?.id);
    }, 2000);
    return () => {
      window.clearInterval(elapsedTimer);
      window.clearInterval(pollTimer);
    };
  }, [selectedActiveReviewRun?.id, selectedActiveReviewRun?.startedAt, selectedResume?.id]);

  useEffect(() => {
    if (!isUploading) {
      setUploadElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setUploadElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isUploading]);

  async function loadResumes(selectId?: string) {
    const response = await fetchJson("/api/resume-review");
    if (!response.ok) return;
    const payload = (await response.json()) as {
      data?: { status: string; resumes?: ResumeSourceReviewSummary[] };
    };
    const nextResumes = payload.data?.resumes ?? [];
    setResumes(nextResumes);
    setSelectedId((selectId ?? selectedId) || (nextResumes[0]?.id ?? ""));
  }

  async function loadEnrichmentTasks(resume: ResumeSourceReviewSummary) {
    const params = new URLSearchParams({
      limit: "100",
      resumeSourceVersionId: resume.id,
      sourceType: "resume_review",
    });
    if (resume.latestReview?.id) {
      params.set("resumeReviewReportId", resume.latestReview.id);
    }
    const response = await fetchJson(`/api/enrichment-tasks?${params.toString()}`);
    if (!response.ok) return;
    const payload = (await response.json()) as {
      data?: { status: string; tasks?: EnrichmentTaskSummary[] };
    };
    setEnrichmentTasks(payload.data?.tasks ?? []);
  }

  async function refreshReviewRun(runId: string, resumeId?: string) {
    const response = await fetchJson(`/api/resume-review/runs/${runId}`);
    if (!response.ok) return null;
    const payload = (await response.json().catch(() => null)) as
      | {
          data?: {
            run?: ResumeReviewRunSummary;
            status: string;
          };
        }
      | null;
    const run = payload?.data?.run;
    if (!run) return null;
    if (run.status !== "running") {
      await loadResumes(resumeId);
      if (resumeId) {
        const resume = resumes.find((item) => item.id === resumeId);
        if (resume) await loadEnrichmentTasks(resume);
      }
    }
    return run;
  }

  async function uploadResume(file: File | null) {
    setError(null);
    setDuplicateResume(null);
    setParseStatus(null);
    if (!file) return;
    setIsUploading(true);
    setUploadElapsedSeconds(0);
    setSelectedId("");
    setStatus(`Reviewing ${file.name}...`);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const response = await fetchJson("/api/resume-review", {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            data?: {
              status: "saved" | "duplicate" | "skipped";
              resume?: ResumeSourceReviewSummary;
              existingResume?: ResumeSourceReviewSummary;
              parseWarnings?: string[];
              parseQuality?: ParseQuality;
              reason?: string;
            };
            error?: string;
            kind?: string;
          }
        | null;
      if (!response.ok || !payload?.data) {
        if (payload?.data?.parseQuality) {
          setParseStatus({
            filename: file.name,
            title: file.name,
            parseQuality: payload.data.parseQuality,
          });
        }
        setError(payload?.error ?? "Resume review failed.");
        return;
      }
      if (payload.data.status === "duplicate" && payload.data.existingResume) {
        setDuplicateResume(payload.data.existingResume);
        if (payload.data.parseQuality) {
          setParseStatus({
            filename: file.name,
            title: payload.data.existingResume.title,
            parseQuality: payload.data.parseQuality,
          });
        }
        setSelectedId(payload.data.existingResume.id);
        setStatus("This exact resume has already been reviewed.");
        await loadResumes(payload.data.existingResume.id);
        await loadEnrichmentTasks(payload.data.existingResume);
        return;
      }
      if (payload.data.status === "saved" && payload.data.resume) {
        if (payload.data.parseQuality) {
          setParseStatus({
            filename: file.name,
            title: payload.data.resume.title,
            parseQuality: payload.data.parseQuality,
          });
        }
        setStatus(
          `Reviewed ${formatResumeTitle(payload.data.resume.title)}${payload.data.parseWarnings?.length ? ` · ${payload.data.parseWarnings.length} source note${payload.data.parseWarnings.length === 1 ? "" : "s"}` : ""}`,
        );
        await loadResumes(payload.data.resume.id);
        await loadEnrichmentTasks(payload.data.resume);
        return;
      }
      setError(payload.data.reason ?? "Resume review storage is not configured.");
    } finally {
      setIsUploading(false);
    }
  }

  function handleResumeDrag(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (!isUploading) setIsDragActive(true);
  }

  function handleResumeDragEnd(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    event.stopPropagation();
    setIsDragActive(false);
  }

  function handleResumeDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    event.stopPropagation();
    setIsDragActive(false);
    if (isUploading) return;
    void uploadResume(event.dataTransfer.files?.[0] ?? null);
  }

  async function deleteResume(resume: ResumeSourceReviewSummary) {
    if (
      !window.confirm(
        `Delete ${formatResumeTitle(resume.title)} v${resume.version}? This removes the stored resume source and review report, but does not delete any Evidence Library items already extracted from it.`,
      )
    ) {
      return;
    }
    setError(null);
    setActiveOperation(`delete:${resume.id}`);
    try {
      const response = await fetchJson(`/api/resume-review/${resume.id}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        setError(await formatResumeReviewError(response, "Could not delete resume source."));
        return;
      }
      setStatus(`Deleted ${formatResumeTitle(resume.title)} v${resume.version}.`);
      setDuplicateResume(null);
      await loadResumes();
      setEnrichmentTasks([]);
    } finally {
      setActiveOperation(null);
    }
  }

  async function rerunReview(resume: ResumeSourceReviewSummary) {
    if (
      !window.confirm(
        `Review ${formatResumeTitle(resume.title)} v${resume.version} again? This creates a fresh review and replaces the latest summary for this saved resume version. The uploaded resume and Evidence Library items remain intact.`,
      )
    ) {
      return;
    }
    setError(null);
    setActiveOperation(`rerun:${resume.id}`);
    setSelectedId(resume.id);
    setStatus(`Starting full review for ${formatResumeTitle(resume.title)}...`);
    try {
      const response = await fetchJson(`/api/resume-review/${resume.id}/rerun`, {
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            data?: {
              run?: ResumeReviewRunSummary;
              status: string;
              resume?: ResumeSourceReviewSummary;
            };
            error?: string;
          }
        | null;
      if (!response.ok || !payload?.data?.resume) {
        setError(formatResumeReviewPayloadError(response, payload, "Could not rerun resume review."));
        return;
      }
      await loadResumes(payload.data.resume.id);
      if (payload.data.run?.id) {
        setStatus(`Reviewing ${formatResumeTitle(payload.data.resume.title)}...`);
        const processResponse = await fetchJson(`/api/resume-review/runs/${payload.data.run.id}/process`, {
          method: "POST",
        });
        const processPayload = (await processResponse.json().catch(() => null)) as
          | {
              data?: {
                run?: ResumeReviewRunSummary;
                status: string;
                resume?: ResumeSourceReviewSummary;
              };
              error?: string;
            }
          | null;
        if (!processResponse.ok) {
          setError(formatResumeReviewPayloadError(processResponse, processPayload, "Could not complete resume review."));
          await loadResumes(payload.data.resume.id);
          return;
        }
        if (processPayload?.data?.resume) {
          setStatus(`Review refreshed for ${formatResumeTitle(processPayload.data.resume.title)}.`);
          await loadResumes(processPayload.data.resume.id);
          await loadEnrichmentTasks(processPayload.data.resume);
          return;
        }
      }
      setStatus(`Review refreshed for ${formatResumeTitle(payload.data.resume.title)}.`);
      await loadResumes(payload.data.resume.id);
      await loadEnrichmentTasks(payload.data.resume);
    } finally {
      setActiveOperation(null);
    }
  }

  return (
    <section className="resume-review-workspace">
      {selectedResume?.latestReview ? (
        <ResumeReviewReportCard
          onContinueToEvidence={() =>
            selectedResumeIsExtracted
              ? onOpenEvidenceReview("enrichment")
              : onExtractToEvidence(selectedResume.id)
          }
          onOpenEvidenceTasks={() => onOpenEvidenceReview("enrichment")}
          onOpenEvidenceTask={onOpenEvidenceTask}
          onRetry={() => void rerunReview(selectedResume)}
          enrichmentTasks={enrichmentTasks}
          retryDisabled={Boolean(activeOperation || selectedActiveReviewRun)}
          retryLabel={reviewActionLabel(selectedResume, activeOperation, selectedActiveReviewRun)}
          resume={selectedResume}
          reviewRun={selectedActiveReviewRun}
          reviewRunElapsedSeconds={reviewRunElapsedSeconds}
          resumeIsExtracted={selectedResumeIsExtracted}
          sourceControls={
            <ResumeReviewSourceControls
              activeOperation={activeOperation}
              duplicateResume={duplicateResume}
              isDragActive={isDragActive}
              isUploading={isUploading}
              onDelete={deleteResume}
              onDismissDuplicate={() => setDuplicateResume(null)}
              onDrag={handleResumeDrag}
              onDragEnd={handleResumeDragEnd}
              onDrop={handleResumeDrop}
              onReviewExistingDuplicate={() => {
                if (duplicateResume) setSelectedId(duplicateResume.id);
              }}
              onRerun={rerunReview}
              onSelect={setSelectedId}
              onUpload={uploadResume}
              resumes={resumes}
              selectedResume={selectedResume}
              status={status}
              reviewRun={selectedActiveReviewRun}
            />
          }
        />
      ) : null}
      {!selectedResume?.latestReview || isUploading ? <div className="panel">
        <div className="panel__header">
          <div>
            <h2 className="panel__title">Resume Review</h2>
            <p className="panel__note">
              {selectedResume?.latestReview
                ? "Review the saved result first. Upload another version only when the file changed."
                : "Upload a general resume, review its strengths and gaps, then decide what should become reusable evidence."}
            </p>
          </div>
        </div>
        {!selectedResume?.latestReview || isUploading ? (
          <ResumeUploadZone
            isDragActive={isDragActive}
            isUploading={isUploading}
            status={status}
            onChange={uploadResume}
            onDrag={handleResumeDrag}
            onDragEnd={handleResumeDragEnd}
            onDrop={handleResumeDrop}
          />
        ) : null}
        <span className={error ? "status status--error" : "status"}>{error ?? status}</span>
        {parseStatus ? <ResumeParseStatusCard status={parseStatus} /> : null}
        {!selectedResume && !isUploading ? (
          <section className="resume-alternative-path" aria-label="No resume path">
            <div>
              <span>Alternative path</span>
              <strong>No resume yet? Add work material directly.</strong>
              <p>
                Use project notes, guided answers, or performance summaries to create reusable evidence without uploading a resume first.
              </p>
            </div>
            <button
              className="secondary-button"
              type="button"
              onClick={() => onOpenEvidenceReview("projects")}
            >
              Build from source material
            </button>
          </section>
        ) : null}
        {isUploading ? (
          <ResumeReviewProgressNotice
            elapsedSeconds={uploadElapsedSeconds}
            fileName={fileNameFromStatus(status)}
          />
        ) : null}
        {duplicateResume ? (
          <div className="review-handoff">
            <div>
              <span>Duplicate resume detected</span>
              <p>
                {formatResumeTitle(duplicateResume.title)} already exists as v{duplicateResume.version}. Use the reviewed version, or upload a changed file as a new version.
              </p>
            </div>
            <div className="actions actions--compact">
              <button type="button" onClick={() => setSelectedId(duplicateResume.id)}>
                Review existing
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => setDuplicateResume(null)}
              >
                Dismiss
              </button>
            </div>
          </div>
        ) : null}
        {selectedResume && !selectedResume.latestReview ? (
          <section className="resume-current-summary">
            <div>
              <span>Current resume</span>
              <strong>{formatResumeTitle(selectedResume.title)}</strong>
              <p>
                Version {selectedResume.version} · {formatResumeVersionStatus(selectedResume.status)} · updated{" "}
                {new Date(selectedResume.updatedAt).toLocaleDateString()}
              </p>
            </div>
            <div>
              <span>Score</span>
              <strong>{selectedReview ? selectedReview.overallScore : "Pending"}</strong>
              <p>{selectedReview ? "Review findings available" : "Review still needed"}</p>
            </div>
          </section>
        ) : null}
        {resumes.length > 0 && !selectedResume?.latestReview ? (
          <div className="resume-version-strip" role="list" aria-label="Resume versions">
            {resumes.map((resume) => (
              <article
                data-active={resume.id === selectedResume?.id}
                key={resume.id}
                role="listitem"
              >
                <button
                  className="resume-version-select"
                  type="button"
                  onClick={() => setSelectedId(resume.id)}
                >
                  <span>v{resume.version}</span>
                  <strong>{formatResumeTitle(resume.title)}</strong>
                  <small>
                    {resume.latestReview ? `Score ${resume.latestReview.overallScore}` : "Review needed"} · {formatResumeVersionStatus(resume.status)}
                  </small>
                </button>
                <div className="resume-version-actions">
                  <button
                    className="resume-version-action"
                    disabled={Boolean(activeOperation || resume.activeReviewRun)}
                    title="Create a fresh review for this saved resume version."
                    type="button"
                    onClick={() => void rerunReview(resume)}
                  >
                    {reviewActionLabel(resume, activeOperation, resume.activeReviewRun)}
                  </button>
                  <button
                    className="resume-version-action resume-version-action--danger"
                    disabled={Boolean(activeOperation)}
                    type="button"
                    onClick={() => void deleteResume(resume)}
                  >
                    {activeOperation === `delete:${resume.id}` ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="resume-version-note">
            No reviewed resume versions yet. Your uploaded resume will appear here after review.
          </div>
        )}
      </div> : null}
    </section>
  );
}

function ResumeReviewSourceControls({
  activeOperation,
  duplicateResume,
  isDragActive,
  isUploading,
  onDelete,
  onDismissDuplicate,
  onDrag,
  onDragEnd,
  onDrop,
  onReviewExistingDuplicate,
  onRerun,
  onSelect,
  onUpload,
  reviewRun,
  resumes,
  selectedResume,
  status,
}: {
  activeOperation: string | null;
  duplicateResume: ResumeSourceReviewSummary | null;
  isDragActive: boolean;
  isUploading: boolean;
  onDelete: (resume: ResumeSourceReviewSummary) => void;
  onDismissDuplicate: () => void;
  onDrag: (event: DragEvent<HTMLLabelElement>) => void;
  onDragEnd: (event: DragEvent<HTMLLabelElement>) => void;
  onDrop: (event: DragEvent<HTMLLabelElement>) => void;
  onReviewExistingDuplicate: () => void;
  onRerun: (resume: ResumeSourceReviewSummary) => void;
  onSelect: (resumeId: string) => void;
  onUpload: (file: File | null) => void;
  reviewRun: ResumeReviewRunSummary | null;
  resumes: ResumeSourceReviewSummary[];
  selectedResume: ResumeSourceReviewSummary;
  status: string;
}) {
  return (
    <article className="review-source-card">
      <div className="review-source-card__top">
        <div>
          <span>Resume source</span>
          <strong>{formatResumeTitle(selectedResume.title)}</strong>
          <p>
            Version {selectedResume.version} · {formatResumeVersionStatus(selectedResume.status)} · updated{" "}
            {new Date(selectedResume.updatedAt).toLocaleDateString()}
          </p>
        </div>
        <button
          disabled={Boolean(activeOperation || reviewRun)}
          type="button"
          onClick={() => void onRerun(selectedResume)}
        >
          {reviewActionLabel(selectedResume, activeOperation, reviewRun)}
        </button>
      </div>
      {duplicateResume ? (
        <div className="review-source-card__notice">
          <span>Duplicate detected</span>
          <p>{formatResumeTitle(duplicateResume.title)} already exists as v{duplicateResume.version}.</p>
          <div>
            <button type="button" onClick={onReviewExistingDuplicate}>
              Review existing
            </button>
            <button type="button" onClick={onDismissDuplicate}>
              Dismiss
            </button>
          </div>
        </div>
      ) : null}
      {resumes.length > 1 ? (
        <details className="review-source-card__details">
          <summary>Switch version</summary>
          <div className="review-source-version-list">
            {resumes.map((resume) => (
              <div data-active={resume.id === selectedResume.id} key={resume.id}>
                <button type="button" onClick={() => onSelect(resume.id)}>
                  <span>v{resume.version}</span>
                  <strong>{formatResumeTitle(resume.title)}</strong>
                  <small>{resume.latestReview ? `Score ${resume.latestReview.overallScore}` : "No review"}</small>
                </button>
                <button
                  aria-label={`Delete ${formatResumeTitle(resume.title)}`}
                  disabled={Boolean(activeOperation)}
                  type="button"
                  onClick={() => void onDelete(resume)}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </details>
      ) : null}
      <details className="review-source-card__details">
        <summary>Upload another version</summary>
        <ResumeUploadZone
          compact
          isDragActive={isDragActive}
          isUploading={isUploading}
          status={status}
          onChange={onUpload}
          onDrag={onDrag}
          onDragEnd={onDragEnd}
          onDrop={onDrop}
        />
      </details>
    </article>
  );
}

function ResumeUploadZone({
  compact = false,
  isDragActive,
  isUploading,
  onChange,
  onDrag,
  onDragEnd,
  onDrop,
  status,
}: {
  compact?: boolean;
  isDragActive: boolean;
  isUploading: boolean;
  onChange: (file: File | null) => void;
  onDrag: (event: DragEvent<HTMLLabelElement>) => void;
  onDragEnd: (event: DragEvent<HTMLLabelElement>) => void;
  onDrop: (event: DragEvent<HTMLLabelElement>) => void;
  status: string;
}) {
  return (
    <label
      className="resume-upload-zone"
      data-compact={compact}
      data-disabled={isUploading}
      data-drag-active={isDragActive}
      onDragEnter={onDrag}
      onDragLeave={onDragEnd}
      onDragOver={onDrag}
      onDrop={onDrop}
    >
      <input
        accept=".pdf,.docx,.txt,.md,.markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
        disabled={isUploading}
        type="file"
        onChange={(event) => {
          onChange(event.target.files?.[0] ?? null);
          event.currentTarget.value = "";
        }}
      />
      <span>{isUploading ? "Reviewing resume..." : compact ? "Upload another version" : "Upload resume"}</span>
      <strong>
        {compact
          ? "Compare a changed resume version."
          : "Drop in or choose a PDF, DOCX, TXT, or Markdown resume."}
      </strong>
      <small>
        {compact
          ? "Use this only when the resume file changed. Existing review results stay available above."
          : "JobDesk saves the version, reviews the source, and keeps evidence creation as a separate step."}
        {isUploading ? ` ${fileNameFromStatus(status)}` : ""}
      </small>
    </label>
  );
}

async function formatResumeReviewError(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => null)) as
    | { error?: string }
    | null;
  return formatResumeReviewPayloadError(response, payload, fallback);
}

function formatResumeReviewPayloadError(
  response: Response,
  payload: { error?: string } | null,
  fallback: string,
) {
  if (response.status === 401) {
    return "Access token required. Enter your token at the top of the page, then try again.";
  }
  return payload?.error ?? fallback;
}

function ResumeReviewProgressNotice({
  elapsedSeconds,
  fileName,
  mode = "upload",
  stage,
}: {
  elapsedSeconds: number;
  fileName: string;
  mode?: "rerun" | "upload";
  stage?: ResumeReviewRunSummary["stage"];
}) {
  const progressByStage: Record<ResumeReviewRunSummary["stage"], number> = {
    analyzing: 48,
    completed: 100,
    failed: 100,
    queued: 14,
    reading_source: 28,
    saving: 86,
    validating: 72,
  };
  const stages = [
    {
      key: "reading_source",
      label: "Upload and parse",
      summary: mode === "upload" ? "Read the uploaded file and prepare resume text." : "Read the saved resume source.",
      detail: mode === "upload" ? "Uploading the resume and preparing readable text." : "Reading the saved resume source.",
    },
    {
      key: "analyzing",
      label: "Review resume",
      summary: "Assess structure, impact, readability, ATS, and evidence readiness.",
      detail: "Reviewing resume strength, gaps, ATS readability, and evidence opportunities.",
    },
    {
      key: "validating",
      label: "Check completeness",
      summary: "Make sure the report is complete before saving.",
      detail: "Checking the review for completeness.",
    },
    {
      key: "saving",
      label: "Save report",
      summary: "Store the reviewed version and refresh the page state.",
      detail: "Saving the report and preparing the Evidence Library handoff.",
    },
  ];
  const activeIndexFromStage =
    stage && stage !== "queued" && stage !== "completed" && stage !== "failed"
      ? stages.findIndex((item) => item.key === stage)
      : -1;
  const activeIndex = activeIndexFromStage >= 0
    ? activeIndexFromStage
    : Math.min(
        elapsedSeconds < 8 ? 0 : elapsedSeconds < 85 ? 1 : elapsedSeconds < 135 ? 2 : 3,
        stages.length - 1,
      );
  const activeStage = stages[activeIndex]!;
  const progress = stage ? progressByStage[stage] : Math.min(92, 16 + elapsedSeconds * 2);
  return (
    <div className="progress-notice" role="status" aria-live="polite">
      <div className="progress-notice__top">
        <strong>{mode === "upload" ? "Resume review in progress" : "Full review in progress"}</strong>
        <span>{elapsedSeconds}s</span>
      </div>
      <div className="progress-bar" aria-hidden="true">
        <span style={{ width: `${progress}%` }} />
      </div>
      <p>
        {activeStage.detail}
        {fileName ? ` File: ${fileName}.` : ""}
        {elapsedSeconds >= 60 && elapsedSeconds < 110
          ? " Resume review can take one to two minutes for longer files."
          : ""}
        {elapsedSeconds >= 110 ? " This review is taking longer than usual. Keep this page open while JobDesk finishes the report." : ""}
      </p>
      <ol className="progress-stages" aria-label="Resume review stages">
        {stages.map((stageItem, index) => (
          <li
            data-active={index === activeIndex}
            data-complete={stage === "completed" || index < activeIndex}
            key={stageItem.label}
          >
            <span>{index + 1}</span>
            <div>
              <strong>{stageItem.label}</strong>
              <small>{stageItem.summary}</small>
            </div>
          </li>
        ))}
      </ol>
      <p>Keep this page open; the report appears after the review is saved.</p>
    </div>
  );
}

function fileNameFromStatus(status: string) {
  return status.startsWith("Reviewing ") && status.endsWith("...")
    ? formatResumeTitle(status.slice("Reviewing ".length, -"...".length))
    : "";
}

function formatResumeTitle(title: string) {
  return title.replace(/(\.[A-Za-z0-9]+)(?:\1)+$/i, "$1");
}

function formatResumeVersionStatus(status: string) {
  const labels: Record<string, string> = {
    extracted: "Added to Evidence Library",
    ready: "Ready",
    reviewed: "Reviewed",
    saved: "Saved",
  };
  return labels[status] ?? status.replace(/_/g, " ");
}

function ResumeReviewReportCard({
  enrichmentTasks,
  onContinueToEvidence,
  onOpenEvidenceTasks,
  onOpenEvidenceTask,
  onRetry,
  resume,
  reviewRun,
  reviewRunElapsedSeconds,
  retryDisabled,
  retryLabel,
  sourceControls,
  resumeIsExtracted,
}: {
  enrichmentTasks: EnrichmentTaskSummary[];
  onContinueToEvidence: () => void;
  onOpenEvidenceTasks: () => void;
  onOpenEvidenceTask: (taskId: string) => void;
  onRetry: () => void;
  resume: ResumeSourceReviewSummary;
  reviewRun: ResumeReviewRunSummary | null;
  reviewRunElapsedSeconds: number;
  resumeIsExtracted: boolean;
  retryDisabled: boolean;
  retryLabel: string;
  sourceControls?: ReactNode;
}) {
  const review = resume.latestReview;
  if (!review) return null;
  const [activeDetailTab, setActiveDetailTab] = useState<ReviewDetailTab>("summary");
  const [selectedFindingId, setSelectedFindingId] = useState<string | null>(null);
  const [showAllEvidenceTasks, setShowAllEvidenceTasks] = useState(false);
  const reviewRubric = Array.isArray(review.rubric) ? review.rubric : [];
  const metadata = reviewRubric.find(
    (item): item is ReviewMetadata => item.key === "review_metadata",
  );
  const rubric = reviewRubric.filter((item) => item.key !== "review_metadata");
  const dimensions = buildReviewDimensions(rubric, review.overallScore);
  const [selectedDimensionId, setSelectedDimensionId] = useState(dimensions[0]?.id ?? "overall");
  const isFallback = metadata?.provider === "deterministic-fallback";
  const atsNotes = asStringList(metadata?.atsNotes);
  const fairnessSignals = asStringList(metadata?.fairnessCheck?.signals_not_penalized);
  const strengths = asStringList(review.strengths);
  const weaknesses = asStringList(review.weaknesses);
  const missingEvidenceQuestions = asStringList(review.missingEvidenceQuestions);
  const questionStatuses = mapMissingEvidenceQuestionStatuses({
    missingEvidenceQuestions,
    resume,
    tasks: enrichmentTasks,
  });
  const activeQuestionCount = questionStatuses.filter(
    (item) => item.taskId && (item.status === "open" || item.status === "answered"),
  ).length;
  const recommendedActions = asStringList(review.recommendedActions);
  const riskFlags = asStringList(review.riskFlags);
  const selectedDimension =
    dimensions.find((dimension) => dimension.id === selectedDimensionId) ??
    dimensions[0] ??
    fallbackReviewDimension(review.overallScore);
  const findingGroups = buildReviewFindingGroups({
    atsNotes,
    missingEvidenceQuestions,
    recommendedActions,
    riskFlags,
    strengths,
    weaknesses,
  });
  useEffect(() => {
    if (!selectedFindingId) return;
    const scrollToFinding = () => {
      document
        .getElementById(reviewFindingDomId(selectedFindingId))
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    window.requestAnimationFrame(scrollToFinding);
    const timeoutId = window.setTimeout(scrollToFinding, 120);
    return () => window.clearTimeout(timeoutId);
  }, [activeDetailTab, selectedFindingId]);

  function openReviewFinding(target: {
    findingId: string;
    tab: ReviewDetailTab;
  }) {
    setSelectedFindingId(target.findingId);
    setActiveDetailTab(target.tab);
  }
  const weaknessFindings =
    findingGroups.find((group) => group.title === "Weaknesses to fix")?.items ?? [];
  const evidenceFindings =
    findingGroups.find((group) => group.title === "Evidence gaps")?.items ?? [];
  const rewriteFindings =
    findingGroups.find((group) => group.title === "Rewrite logic")?.items ?? [];
  const topFixes = [
    ...weaknessFindings.map((finding) => ({ finding, item: finding.detail, label: "Fix" })),
    ...evidenceFindings.map((finding) => ({ finding, item: finding.detail, label: "Evidence" })),
    ...rewriteFindings.map((finding) => ({ finding, item: finding.detail, label: "Rewrite" })),
  ].slice(0, 3);
  const atsIssueCount = atsNotes.length;
  const privacyReviewCount = riskFlags.length;
  const confidenceLabel = metadata
    ? `Review depth ${Math.round((metadata.confidence ?? 0) * 100)}%`
    : "Review depth unavailable";
  const statusLabel = isFallback ? "Quick estimate" : "Review complete";
  const tenSecondScan = !isFallback ? metadata?.tenSecondScan : "";
  const primaryCtaLabel = resumeIsExtracted
    ? activeQuestionCount > 0
      ? "Review evidence tasks"
      : "Open Evidence Library"
    : "Create library items";
  const primaryCtaAction =
    resumeIsExtracted && activeQuestionCount > 0 ? onOpenEvidenceTasks : onContinueToEvidence;
  const actionCandidates = [
    ...topFixes.map((fix) => ({
      action:
        fix.label === "Evidence"
          ? "Open Evidence"
          : fix.label === "Fix"
            ? "Open fixes"
            : "Open rewrites",
      detail: fix.item,
      key: `${fix.label}-${fix.item}`,
      label: fix.label,
      onClick:
        fix.label === "Evidence"
          ? () => openReviewFinding({ findingId: fix.finding.id, tab: "evidence" })
          : () => openReviewFinding({
              findingId: fix.finding.id,
              tab: fix.label === "Fix" ? "fixes" : "rewrite",
            }),
    })),
    ...questionStatuses.map((item) => ({
      action: resumeIsExtracted && item.taskId ? "Open task" : "Create item",
      detail: item.question,
      key: `task-${item.question}`,
      label: resumeIsExtracted
        ? formatEnrichmentTaskStatus(item.status)
        : "Waiting for library material",
      onClick: resumeIsExtracted && item.taskId ? () => onOpenEvidenceTask(item.taskId!) : onContinueToEvidence,
    })),
  ];
  const reviewActions = showAllEvidenceTasks ? actionCandidates : actionCandidates.slice(0, 6);
  const hiddenActionCount = Math.max(0, actionCandidates.length - reviewActions.length);
  return (
    <section className="panel resume-review-report">
      {isFallback ? (
        <section className="review-retry-panel">
          <div>
            <h3>Full AI review needs another pass.</h3>
            <p>A quick estimate is saved. Run the full review again for recruiter-style feedback.</p>
          </div>
          <button disabled={retryDisabled} type="button" onClick={onRetry}>
            {retryLabel}
          </button>
          {reviewRun ? (
            <ResumeReviewProgressNotice
              elapsedSeconds={reviewRunElapsedSeconds}
              fileName={formatResumeTitle(resume.title)}
              mode="rerun"
              stage={reviewRun.stage}
            />
          ) : null}
        </section>
      ) : null}
      {tenSecondScan ? (
        <section className="review-scan-card">
          <h3>10-second scan</h3>
          <p>{tenSecondScan}</p>
        </section>
      ) : null}
      {!resumeIsExtracted ? (
        <section className="review-extraction-bridge" aria-live="polite">
          <div>
            <span>Next required step</span>
            <h3>Review complete. Create library material next.</h3>
            <p>
              This review scored your resume and found places to strengthen. Before answering
              those prompts, create Evidence Claims, Work Experiences, and Story Targets from
              this reviewed resume.
            </p>
          </div>
          <div className="review-extraction-bridge__actions">
            <button className="primary-button" type="button" onClick={onContinueToEvidence}>
              Create library items
            </button>
            <button
              className="secondary-button"
              type="button"
              onClick={() => setActiveDetailTab("summary")}
            >
              View review details
            </button>
          </div>
          <ol aria-label="Resume evidence workflow">
            <li data-state="complete">Reviewed resume</li>
            <li data-state="current">Create library items</li>
            <li>Review claims and stories</li>
            <li>Strengthen gaps</li>
          </ol>
        </section>
      ) : null}
      <ReviewDimensionWorkbench
        activeQuestionCount={activeQuestionCount}
        atsIssueCount={atsIssueCount}
        ctaLabel={primaryCtaLabel}
        dimensions={dimensions}
        fairnessNote={metadata?.fairnessCheck?.note ?? ""}
        fairnessSignals={fairnessSignals}
        confidenceLabel={confidenceLabel}
        missingEvidenceQuestions={missingEvidenceQuestions}
        onCtaClick={primaryCtaAction}
        onSelect={setSelectedDimensionId}
        privacyReviewCount={privacyReviewCount}
        recommendedActions={recommendedActions}
        resumeTitle={formatResumeTitle(resume.title)}
        riskFlags={riskFlags}
        selectedDimension={selectedDimension}
        showPrimaryCta={resumeIsExtracted}
        statusLabel={statusLabel}
        sourceControls={sourceControls}
        strengths={strengths}
        topFixCount={topFixes.length}
        totalScore={review.overallScore}
        weaknesses={weaknesses}
      />
      {reviewActions.length ? (
        <section className="review-action-list">
          <div className="review-action-list__header">
            <p className="panel-kicker">Review actions</p>
            {resumeIsExtracted ? (
              <button
                className="secondary-button"
                type="button"
                onClick={primaryCtaAction}
              >
                {primaryCtaLabel}
              </button>
            ) : null}
          </div>
          {!resumeIsExtracted && questionStatuses.length ? (
            <p className="review-action-list__note">
              Evidence prompts are waiting for library material. Create library items first,
              then use Work Queue to strengthen the gaps.
            </p>
          ) : null}
          <div className="review-action-list__items">
            {reviewActions.map((item) => (
              <article key={item.key}>
                <span>{item.label}</span>
                <p>{item.detail}</p>
                {item.onClick ? (
                  <button type="button" onClick={item.onClick}>
                    {item.action}
                  </button>
                ) : null}
              </article>
            ))}
          </div>
          {actionCandidates.length > 6 ? (
            <button
              className="review-enrichment-toggle"
              type="button"
              onClick={() => setShowAllEvidenceTasks((current) => !current)}
            >
              {showAllEvidenceTasks
              ? "Show fewer tasks"
                : `Show ${hiddenActionCount} more action${hiddenActionCount === 1 ? "" : "s"}`}
            </button>
          ) : null}
        </section>
      ) : null}
        <ReviewDetailTabs
          activeTab={activeDetailTab}
          atsNotes={atsNotes}
          dimensions={dimensions}
          findingGroups={findingGroups}
          metadataScan={metadata?.tenSecondScan ?? ""}
          onContinueToEvidence={onContinueToEvidence}
          onOpenEvidenceTasks={onOpenEvidenceTasks}
          onSelect={(tab) => {
            setSelectedFindingId(null);
            setActiveDetailTab(tab);
          }}
          selectedFindingId={selectedFindingId}
        />
    </section>
  );
}

type ReviewDetailTab =
  | "summary"
  | "strengths"
  | "fixes"
  | "evidence"
  | "rewrite"
  | "ats"
  | "privacy";

type ReviewDimension = {
  id: string;
  label: string;
  maxScore: number;
  note: string;
  reviewDetail?: ReviewDimensionDetail;
  percent: number;
  score: number;
  status: "strong" | "watch" | "weak";
};

type ReviewDimensionDetail = ReturnType<typeof buildDimensionDetail>;

type ReviewFindingGroup = {
  items: ReviewFinding[];
  title: string;
};

type ReviewFinding = {
  badge: string;
  detail: string;
  id: string;
  nextStep: string;
  title: string;
  tone: "positive" | "warning" | "risk" | "neutral";
  why: string;
};

function ReviewDimensionWorkbench({
  activeQuestionCount,
  atsIssueCount,
  ctaLabel,
  confidenceLabel,
  dimensions,
  fairnessNote,
  fairnessSignals,
  missingEvidenceQuestions,
  onCtaClick,
  onSelect,
  privacyReviewCount,
  recommendedActions,
  resumeTitle,
  riskFlags,
  selectedDimension,
  showPrimaryCta,
  statusLabel,
  sourceControls,
  strengths,
  topFixCount,
  totalScore,
  weaknesses,
}: {
  activeQuestionCount: number;
  atsIssueCount: number;
  ctaLabel: string;
  confidenceLabel: string;
  dimensions: ReviewDimension[];
  fairnessNote: string;
  fairnessSignals: string[];
  missingEvidenceQuestions: string[];
  onCtaClick: () => void;
  onSelect: (id: string) => void;
  privacyReviewCount: number;
  recommendedActions: string[];
  resumeTitle: string;
  riskFlags: string[];
  selectedDimension: ReviewDimension;
  showPrimaryCta: boolean;
  statusLabel: string;
  sourceControls?: ReactNode;
  strengths: string[];
  topFixCount: number;
  totalScore: number;
  weaknesses: string[];
}) {
  const dimensionDetail = buildDimensionDetail({
    dimension: selectedDimension,
    missingEvidenceQuestions,
    recommendedActions,
    riskFlags,
    strengths,
    weaknesses,
  });
  const selectedDimensionDetail = mergeDimensionDetails(
    selectedDimension.reviewDetail,
    dimensionDetail,
  );
  const evidencePrompts = selectedDimensionDetail.evidencePrompts;
  const evidenceTaskCount = activeQuestionCount || missingEvidenceQuestions.length;
  return (
    <section className="review-dimension-workbench">
      <div className="review-radar-card" aria-label="Resume review dimension scores">
        <ReviewRadar dimensions={dimensions} selectedId={selectedDimension.id} />
        <div className="review-dimension-tabs" role="tablist" aria-label="Review dimensions">
          {dimensions.map((dimension) => (
            <button
              aria-selected={dimension.id === selectedDimension.id}
              data-active={dimension.id === selectedDimension.id}
              key={dimension.id}
              onClick={() => onSelect(dimension.id)}
              role="tab"
              type="button"
            >
              <span>{dimension.label}</span>
              <strong>{Math.round(dimension.percent * 100)}%</strong>
            </button>
          ))}
        </div>
      </div>
      <div className="review-dimension-side">
        <article className="review-score-compact">
          <div className="review-score-compact__identity">
              <span>Resume Review</span>
              <strong>{resumeTitle}</strong>
            <p>
              <b>{totalScore}</b>
              <small>Score</small>
            </p>
          </div>
          <div className="review-score-compact__actions">
            <div className="review-score-compact__badges">
              <span>{confidenceLabel}</span>
              <span>{statusLabel}</span>
            </div>
            {showPrimaryCta ? (
              <button className="primary-button" type="button" onClick={onCtaClick}>
                {ctaLabel}
              </button>
            ) : null}
          </div>
          <div className="review-score-compact__stats" aria-label="Review summary">
            <span>
              <strong>{topFixCount}</strong>
              Fixes
            </span>
            <span>
              <strong>{evidenceTaskCount}</strong>
              Evidence
            </span>
            <span>
              <strong>{atsIssueCount}</strong>
              ATS
            </span>
            <span>
              <strong>{privacyReviewCount}</strong>
              Privacy
            </span>
          </div>
        </article>
        <article className="review-dimension-card" data-state={selectedDimension.status}>
          <div className="review-dimension-card__top">
            <div>
              <p className="panel-kicker">Selected dimension</p>
              <h3>{selectedDimension.label}</h3>
            </div>
            <strong>
              {selectedDimension.score}/{selectedDimension.maxScore}
              <span>{selectedDimensionDetail.scoreLabel}</span>
            </strong>
          </div>
          <div className="review-dimension-card__body">
            <div className="review-dimension-card__note">
              <span>Reviewer note</span>
              <p>{selectedDimension.note}</p>
            </div>
            <div className="review-dimension-card__tile review-dimension-card__tile--helped">
              <span>What helped the score</span>
              <ul>
                {selectedDimensionDetail.helpedScore.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="review-dimension-card__tile review-dimension-card__tile--lowered">
              <span>What lowered the score</span>
              <ul>
                {selectedDimensionDetail.loweredScore.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="review-dimension-card__tile review-dimension-card__tile--raise">
              <span>What would raise it</span>
              <ul>
                {selectedDimensionDetail.wouldRaiseScore.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            {selectedDimensionDetail.findings.length ? (
              <div className="review-dimension-card__supporting">
                <span>Supporting reviewer signals</span>
                <ul>
                  {selectedDimensionDetail.findings.map((finding) => (
                    <li key={`${finding.kind}-${finding.text}`}>{finding.text}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="review-dimension-card__evidence">
              <span>Evidence to add</span>
              {evidencePrompts.length ? (
                <ul>
                  {evidencePrompts.map((prompt) => (
                    <li key={prompt}>{prompt}</li>
                  ))}
                </ul>
              ) : (
                <p>Add material only if this dimension needs more metrics, project context, or public-safe wording.</p>
              )}
            </div>
            <div className="review-dimension-card__next-step">
              <span>Suggested next action</span>
              <p>{selectedDimensionDetail.nextAction}</p>
            </div>
          </div>
          <p className="review-dimension-card__hint">
            Create library items from this reviewed resume before using these prompts to strengthen evidence.
          </p>
        </article>
        {fairnessNote ? (
          <article className="review-side-note">
            <div>
              <span>Fairness check</span>
              <strong>Reviewed neutrally</strong>
            </div>
            <p>{fairnessNote}</p>
            {fairnessSignals.length ? (
              <ul>
                {fairnessSignals.slice(0, 3).map((signal) => (
                  <li key={signal}>{signal}</li>
                ))}
              </ul>
            ) : null}
          </article>
        ) : null}
        {sourceControls}
      </div>
    </section>
  );
}

function mapMissingEvidenceQuestionStatuses({
  missingEvidenceQuestions,
  resume,
  tasks,
}: {
  missingEvidenceQuestions: string[];
  resume: ResumeSourceReviewSummary;
  tasks: EnrichmentTaskSummary[];
}): Array<{ question: string; status: ReviewQuestionStatus; taskId: string | null }> {
  return missingEvidenceQuestions.map((question) => {
    const normalized = normalizeReviewText(question);
    const task = tasks.find((candidate) => {
      if (candidate.source_type !== "resume_review") return false;
      const matchesResume =
        candidate.resume_source_version_id === resume.id ||
        candidate.resume_review_report_id === resume.latestReview?.id ||
        normalizeReviewText(candidate.source_label).includes(
          normalizeReviewText(formatResumeTitle(resume.title)),
        );
      return matchesResume && normalizeReviewText(candidate.prompt) === normalized;
    });
    return {
      question,
      status: task?.status ?? "not_created",
      taskId: task?.id ?? null,
    };
  });
}

function formatEnrichmentTaskStatus(status: ReviewQuestionStatus) {
  if (status === "answered") return "answered";
  if (status === "converted") return "converted";
  if (status === "dismissed") return "dismissed";
  if (status === "not_created") return "queued";
  return "open";
}

function ReviewRadar({
  dimensions,
  selectedId,
}: {
  dimensions: ReviewDimension[];
  selectedId: string;
}) {
  if (dimensions.length < 3) {
    return (
      <div className="review-radar review-radar--bars">
        {dimensions.map((dimension) => (
          <div className="review-radar-bar" data-active={dimension.id === selectedId} key={dimension.id}>
            <span>{dimension.label}</span>
            <div>
              <i style={{ width: `${Math.round(dimension.percent * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
    );
  }
  const center = 110;
  const radius = 64;
  const labelRadius = 78;
  const axisPoints = dimensions.map((dimension, index) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / dimensions.length;
    const outerX = center + Math.cos(angle) * radius;
    const outerY = center + Math.sin(angle) * radius;
    const scoreX = center + Math.cos(angle) * radius * dimension.percent;
    const scoreY = center + Math.sin(angle) * radius * dimension.percent;
    return {
      dimension,
      outer: `${outerX},${outerY}`,
      outerX,
      outerY,
      score: `${scoreX},${scoreY}`,
      scoreX,
      scoreY,
      textX: center + Math.cos(angle) * labelRadius,
      textY: center + Math.sin(angle) * labelRadius,
    };
  });
  const polygon = axisPoints.map((point) => point.score).join(" ");
  return (
    <svg className="review-radar" role="img" viewBox="0 0 220 220" aria-label="Radar chart of resume review dimensions">
      {[0.33, 0.66, 1].map((scale) => (
        <polygon
          className="review-radar__grid"
          key={scale}
          points={axisPoints
            .map((point) => {
              return `${center + (point.outerX - center) * scale},${center + (point.outerY - center) * scale}`;
            })
            .join(" ")}
        />
      ))}
      {axisPoints.map((point) => (
        <line className="review-radar__axis" key={point.dimension.id} x1={center} x2={point.outerX} y1={center} y2={point.outerY} />
      ))}
      <polygon className="review-radar__score" points={polygon} />
      {axisPoints.map((point) => (
        <g key={point.dimension.id}>
          <circle
            className="review-radar__dot"
            data-active={point.dimension.id === selectedId}
            cx={point.scoreX}
            cy={point.scoreY}
            r={point.dimension.id === selectedId ? 4.5 : 3.2}
          />
          <text
            className="review-radar__label"
            dominantBaseline="middle"
            textAnchor={point.textX < center - 8 ? "end" : point.textX > center + 8 ? "start" : "middle"}
            x={point.textX}
            y={point.textY}
          >
            {shortDimensionLabel(point.dimension.label)}
          </text>
        </g>
      ))}
    </svg>
  );
}

function ReviewFindingBoard({
  groups,
  onContinueToEvidence,
  onOpenEvidenceTasks,
  selectedFindingId,
  visibleTitles,
}: {
  groups: ReviewFindingGroup[];
  onContinueToEvidence: () => void;
  onOpenEvidenceTasks: () => void;
  selectedFindingId: string | null;
  visibleTitles?: string[];
}) {
  const visibleGroups = groups.filter(
    (group) =>
      group.items.length > 0 && (!visibleTitles || visibleTitles.includes(group.title)),
  );
  if (!visibleGroups.length) return null;
  return (
    <section className="review-finding-board">
      <div className="review-finding-board__header">
        <div>
          <p className="panel-kicker">Detail notes</p>
          <h3>{activeDetailHeading(visibleTitles)}</h3>
        </div>
        <span>{visibleGroups.reduce((sum, group) => sum + group.items.length, 0)} items</span>
      </div>
      {visibleGroups.map((group) => (
        <div className="review-finding-group" key={group.title}>
          <div className="review-finding-group__top">
            <h4>{group.title}</h4>
          </div>
          <div className="review-finding-list">
            {group.items.map((item) => (
              <article
                className="review-finding-card"
                data-selected={item.id === selectedFindingId}
                data-tone={item.tone}
                id={reviewFindingDomId(item.id)}
                key={item.id}
              >
                <div>
                  <span className="review-finding-card__badge">{item.badge}</span>
                  <strong>{item.title}</strong>
                  <p>{item.detail}</p>
                </div>
                <div className="review-finding-card__meta">
                  <span>{item.nextStep}</span>
                  <small>{item.why}</small>
                </div>
                <ReviewFindingAction
                  finding={item}
                  groupTitle={group.title}
                  onContinueToEvidence={onContinueToEvidence}
                  onOpenEvidenceTasks={onOpenEvidenceTasks}
                />
              </article>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function ReviewDetailTabs({
  activeTab,
  atsNotes,
  dimensions,
  findingGroups,
  metadataScan,
  onContinueToEvidence,
  onOpenEvidenceTasks,
  onSelect,
  selectedFindingId,
}: {
  activeTab: ReviewDetailTab;
  atsNotes: string[];
  dimensions: ReviewDimension[];
  findingGroups: ReviewFindingGroup[];
  metadataScan: string;
  onContinueToEvidence: () => void;
  onOpenEvidenceTasks: () => void;
  onSelect: (tab: ReviewDetailTab) => void;
  selectedFindingId: string | null;
}) {
  const tabs: Array<{ id: ReviewDetailTab; label: string; titles?: string[] }> = [
    { id: "summary", label: "Summary" },
    { id: "strengths", label: "Strengths", titles: ["Strengths to preserve"] },
    { id: "fixes", label: "Fixes", titles: ["Weaknesses to fix"] },
    { id: "evidence", label: "Evidence Gaps", titles: ["Evidence gaps"] },
    { id: "rewrite", label: "Rewrite Suggestions", titles: ["Rewrite logic"] },
    { id: "ats", label: "ATS", titles: ["ATS notes"] },
    { id: "privacy", label: "Privacy", titles: ["Privacy and confidentiality"] },
  ];
  const active = tabs.find((tab) => tab.id === activeTab) ?? tabs[0]!;
  const summaryItems = findingGroups
    .flatMap((group) => group.items.slice(0, 2).map((item) => ({ ...item, groupTitle: group.title })))
    .slice(0, 6);
  const topStrength = findingGroups.find((group) => group.title === "Strengths to preserve")?.items[0];
  const topFix = findingGroups.find((group) => group.title === "Weaknesses to fix")?.items[0];
  const topGap = findingGroups.find((group) => group.title === "Evidence gaps")?.items[0];
  const topAts = findingGroups.find((group) => group.title === "ATS notes")?.items[0];
  const strongestDimension = [...dimensions].sort((a, b) => b.percent - a.percent)[0];
  const weakestDimension = [...dimensions].sort((a, b) => a.percent - b.percent)[0];
  return (
    <section className="review-detail-panel">
      <div className="review-detail-panel__header">
        <p className="panel-kicker">Details</p>
      </div>
      <div className="review-detail-tabs" role="tablist" aria-label="Resume review details">
        {tabs.map((tab) => (
          <button
            aria-selected={tab.id === active.id}
            data-active={tab.id === active.id}
            key={tab.id}
            onClick={() => onSelect(tab.id)}
            role="tab"
            type="button"
          >
            {tab.label}
          </button>
        ))}
      </div>
      {active.id === "summary" ? (
        <ReviewSummaryReport
          dimensions={dimensions}
          metadataScan={metadataScan}
          onSelect={onSelect}
          strongestDimension={strongestDimension}
          summaryItems={summaryItems}
          tabs={tabs}
          topAts={topAts}
          topFix={topFix}
          topGap={topGap}
          topStrength={topStrength}
          weakestDimension={weakestDimension}
        />
      ) : (
        <ReviewFindingBoard
          groups={findingGroups}
          onContinueToEvidence={onContinueToEvidence}
          onOpenEvidenceTasks={onOpenEvidenceTasks}
          selectedFindingId={selectedFindingId}
          visibleTitles={active.titles}
        />
      )}
      {active.id === "ats" && atsNotes.length === 0 ? (
        <div className="empty-state empty-state--compact">No ATS-specific notes were returned.</div>
      ) : null}
    </section>
  );
}

function ReviewFindingAction({
  finding,
  groupTitle,
  onContinueToEvidence,
  onOpenEvidenceTasks,
}: {
  finding: ReviewFinding;
  groupTitle: string;
  onContinueToEvidence: () => void;
  onOpenEvidenceTasks: () => void;
}) {
  const action = getReviewFindingTarget(finding, groupTitle);
  const onClick =
    action.route === "evidence_tasks"
      ? onOpenEvidenceTasks
      : action.route === "evidence_library"
        ? onContinueToEvidence
        : undefined;
  return (
    <div className="review-finding-card__action">
      <div>
        <span>Suggested fix</span>
        <p>{action.guidance}</p>
      </div>
      {onClick ? (
        <button type="button" onClick={onClick}>
          {action.cta}
        </button>
      ) : (
        <span className="review-finding-card__action-note">{action.cta}</span>
      )}
    </div>
  );
}

function ReviewSummaryReport({
  dimensions,
  metadataScan,
  onSelect,
  strongestDimension,
  summaryItems,
  tabs,
  topAts,
  topFix,
  topGap,
  topStrength,
  weakestDimension,
}: {
  dimensions: ReviewDimension[];
  metadataScan: string;
  onSelect: (tab: ReviewDetailTab) => void;
  strongestDimension?: ReviewDimension;
  summaryItems: Array<ReviewFinding & { groupTitle: string }>;
  tabs: Array<{ id: ReviewDetailTab; label: string; titles?: string[] }>;
  topAts?: ReviewFinding;
  topFix?: ReviewFinding;
  topGap?: ReviewFinding;
  topStrength?: ReviewFinding;
  weakestDimension?: ReviewDimension;
}) {
  return (
    <section className="review-summary-report">
      {metadataScan ? <p className="review-summary-report__scan">{metadataScan}</p> : null}
      <div className="review-summary-report__grid">
        <article className="review-summary-report__main">
          <div className="review-summary-report__section">
            <span>Recruiter skim</span>
            <strong>{topStrength?.title ?? strongestDimension?.label ?? "No strong signal captured yet"}</strong>
            <p>{topStrength?.detail ?? strongestDimension?.note ?? "Add reviewed evidence to make the strongest profile signal clear."}</p>
          </div>
          <div className="review-summary-report__section" data-tone="warning">
            <span>Highest-priority fix</span>
            <strong>{topFix?.title ?? weakestDimension?.label ?? "No fix listed"}</strong>
            <p>{topFix?.detail ?? weakestDimension?.note ?? "Keep this section concise and source-backed before rewriting."}</p>
          </div>
          <div className="review-summary-report__section" data-tone="risk">
            <span>Evidence gap</span>
            <strong>{topGap?.title ?? "No evidence gap listed"}</strong>
            <p>{topGap?.detail ?? "If the resume already has enough proof, continue to the detail tabs for ATS and rewrite checks."}</p>
          </div>
        </article>
        <aside className="review-summary-report__side">
          <div className="review-summary-report__mini">
            <span>Dimensions</span>
            <strong>{dimensions.length}</strong>
            <p>
              Strongest: {strongestDimension?.label ?? "n/a"} · Weakest: {weakestDimension?.label ?? "n/a"}
            </p>
          </div>
          <div className="review-summary-report__mini">
            <span>ATS / privacy</span>
            <strong>{topAts ? "Review" : "Clear"}</strong>
            <p>{topAts?.detail ?? "No ATS-specific issue was returned in this review."}</p>
          </div>
          {summaryItems.length ? (
            <div className="review-summary-report__links">
              {summaryItems.slice(0, 4).map((item) => (
                <button
                  data-tone={item.tone}
                  key={`${item.groupTitle}-${item.id}`}
                  type="button"
                  onClick={() => {
                    const matchingTab = tabs.find((tab) => tab.titles?.includes(item.groupTitle));
                    if (matchingTab) onSelect(matchingTab.id);
                  }}
                >
                  <span>{item.groupTitle}</span>
                  <strong>{item.nextStep}</strong>
                </button>
              ))}
            </div>
          ) : null}
        </aside>
      </div>
    </section>
  );
}

function activeDetailHeading(visibleTitles?: string[]) {
  const title = visibleTitles?.[0];
  if (!title) return "Review detail";
  return title;
}

function reviewActionLabel(
  resume: ResumeSourceReviewSummary,
  activeOperation: string | null,
  reviewRun?: ResumeReviewRunSummary | null,
) {
  if (reviewRun?.status === "running" || activeOperation === `rerun:${resume.id}`) return "Reviewing...";
  return isFallbackResume(resume) ? "Review again" : "Refresh review";
}

function buildReviewDimensions(
  rubric: ResumeReviewReport["rubric"],
  overallScore: number,
): ReviewDimension[] {
  const dimensions = rubric
    .map((item, index) => {
      const label = item.label?.trim() || item.key?.trim() || `Dimension ${index + 1}`;
      const score = normalizeScore(item.score, 0);
      const maxScore = Math.max(normalizeScore(item.maxScore, 100), 1);
      const percent = Math.max(0, Math.min(score / maxScore, 1));
      return {
        id: item.key?.trim() || slugify(label) || `dimension-${index}`,
        label,
        maxScore,
        note: item.note?.trim() || "No detailed note was returned for this dimension.",
        percent,
        reviewDetail: buildRubricItemDetail(item),
        score,
        status: dimensionStatus(percent),
      };
    })
    .filter((dimension) => dimension.label.toLowerCase() !== "review metadata");
  if (dimensions.length) return dimensions;
  return [fallbackReviewDimension(overallScore)];
}

function buildRubricItemDetail(
  item: ResumeReviewReport["rubric"][number],
): ReviewDimensionDetail | undefined {
  const evidencePrompts = asStringList(item.evidenceQuestions);
  const findings = asStringList(item.findings).map((text) => ({
    kind: "weakness" as const,
    text,
  }));
  const helpedScore = asStringList(item.helpedScore);
  const loweredScore = asStringList(item.loweredScore);
  const nextAction = item.nextAction?.trim() ?? "";
  const wouldRaiseScore = asStringList(item.raiseScore);
  if (
    !evidencePrompts.length &&
    !findings.length &&
    !helpedScore.length &&
    !loweredScore.length &&
    !nextAction &&
    !wouldRaiseScore.length
  ) {
    return undefined;
  }
  return {
    evidencePrompts,
    findings,
    helpedScore,
    loweredScore,
    nextAction,
    scoreLabel: "Moderate",
    wouldRaiseScore,
  };
}

function mergeDimensionDetails(
  stored: ReviewDimensionDetail | undefined,
  fallback: ReviewDimensionDetail,
): ReviewDimensionDetail {
  if (!stored) return fallback;
  return {
    evidencePrompts: stored.evidencePrompts.length
      ? stored.evidencePrompts
      : fallback.evidencePrompts,
    findings: stored.findings.length ? stored.findings : fallback.findings,
    helpedScore: stored.helpedScore.length ? stored.helpedScore : fallback.helpedScore,
    loweredScore: stored.loweredScore.length ? stored.loweredScore : fallback.loweredScore,
    nextAction: stored.nextAction || fallback.nextAction,
    scoreLabel: fallback.scoreLabel,
    wouldRaiseScore: stored.wouldRaiseScore.length
      ? stored.wouldRaiseScore
      : fallback.wouldRaiseScore,
  };
}

function fallbackReviewDimension(overallScore: number): ReviewDimension {
  const percent = Math.max(0, Math.min(overallScore / 100, 1));
  return {
    id: "overall",
    label: "Overall readiness",
    maxScore: 100,
    note: "Overall resume readiness based on the available review output.",
    percent,
    reviewDetail: undefined,
    score: overallScore,
    status: dimensionStatus(percent),
  };
}

function buildReviewFindingGroups({
  atsNotes,
  missingEvidenceQuestions,
  recommendedActions,
  riskFlags,
  strengths,
  weaknesses,
}: {
  atsNotes: string[];
  missingEvidenceQuestions: string[];
  recommendedActions: string[];
  riskFlags: string[];
  strengths: string[];
  weaknesses: string[];
}): ReviewFindingGroup[] {
  return [
    {
      items: strengths.map((item, index) => ({
        badge: "Strength",
        detail: item,
        id: `strength-${index}-${item}`,
        nextStep: "Preserve in rewrites",
        title: findingTitle("strength", item),
        tone: "positive",
        why: "Recruiter-visible signal",
      })),
      title: "Strengths to preserve",
    },
    {
      items: weaknesses.map((item, index) => ({
        badge: "Fix",
        detail: item,
        id: `weakness-${index}-${item}`,
        nextStep: "Add context before rewriting",
        title: findingTitle("weakness", item),
        tone: "warning",
        why: "Needs stronger proof",
      })),
      title: "Weaknesses to fix",
    },
    {
      items: missingEvidenceQuestions.map((item, index) => ({
        badge: "Evidence gap",
        detail: item,
        id: `missing-${index}-${item}`,
        nextStep: "Answer after library items exist",
        title: findingTitle("evidence", item),
        tone: "warning",
        why: "Missing reusable source",
      })),
      title: "Evidence gaps",
    },
    {
      items: recommendedActions.map((item, index) => ({
        badge: "Rewrite",
        detail: item,
        id: `action-${index}-${item}`,
        nextStep: "Apply in next draft",
        title: findingTitle("rewrite", item),
        tone: "neutral",
        why: "Drafting rule",
      })),
      title: "Rewrite logic",
    },
    {
      items: atsNotes.map((item, index) => ({
        badge: "ATS",
        detail: item,
        id: `ats-${index}-${item}`,
        nextStep: "Keep format parseable",
        title: findingTitle("ats", item),
        tone: "neutral",
        why: "Parser-readability guardrail",
      })),
      title: "ATS notes",
    },
    {
      items: riskFlags.map((item, index) => ({
        badge: "Privacy",
        detail: item,
        id: `risk-${index}-${item}`,
        nextStep: "Use external-safe wording",
        title: findingTitle("privacy", item),
        tone: "risk",
        why: "External-use risk",
      })),
      title: "Privacy and confidentiality",
    },
  ];
}

function dimensionRewriteGuidance(dimension: ReviewDimension) {
  const label = dimension.label.toLowerCase();
  if (label.includes("metric") || label.includes("impact") || label.includes("result")) {
    return "Prioritize before/after numbers, scope, cost, latency, reliability, users, revenue, or operational impact. Avoid generic responsibility wording.";
  }
  if (label.includes("star") || label.includes("action")) {
    return "Convert responsibilities into situation, action, and result. Each strong bullet should make ownership and outcome explicit.";
  }
  if (label.includes("ats") || label.includes("keyword")) {
    return "Keep language parseable, mirror important role keywords only when truthful, and avoid formatting tricks that hide core skills.";
  }
  if (label.includes("risk") || label.includes("privacy") || label.includes("confidential")) {
    return "Replace internal-sensitive wording with external-safe summaries while preserving the business and technical signal.";
  }
  if (label.includes("clarity") || label.includes("scan")) {
    return "Make the first ten seconds obvious: target role, strongest scope, highest-impact achievements, and clear section hierarchy.";
  }
  return "Use this dimension as a rewrite constraint: preserve strong evidence, fill missing context, and only generate claims that are source-backed.";
}

function dimensionStatus(percent: number): ReviewDimension["status"] {
  if (percent >= 0.8) return "strong";
  if (percent >= 0.62) return "watch";
  return "weak";
}

function normalizeScore(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function shortDimensionLabel(label: string) {
  const normalized = label.trim().toLowerCase();
  if (normalized.includes("evidence") && normalized.includes("impact")) return "Evidence";
  if (normalized.includes("role") || normalized.includes("ownership") || normalized.includes("depth")) return "Depth";
  if (normalized.includes("ats")) return "ATS";
  if (normalized.includes("clarity") || normalized.includes("scan")) return "Clarity";
  if (normalized.includes("library")) return "Library";
  if (normalized.includes("project")) return "Projects";
  if (normalized.includes("privacy") || normalized.includes("confidential")) return "Privacy";
  if (normalized.includes("metric") || normalized.includes("impact")) return "Impact";
  const trimmed = label.trim();
  return trimmed.length <= 10 ? trimmed : trimFindingText(trimmed, 10);
}

function findingTitle(
  category: "ats" | "evidence" | "privacy" | "rewrite" | "strength" | "weakness",
  item: string,
) {
  const subject = findingSubject(item);
  if (subject) {
    const subjectPrefix = trimFindingText(subject, 42);
    if (category === "strength") return `${subjectPrefix}: preserve this signal`;
    if (category === "weakness") return `${subjectPrefix}: strengthen the proof`;
    if (category === "evidence") return `${subjectPrefix}: add missing evidence`;
    if (category === "rewrite") return `${subjectPrefix}: apply rewrite logic`;
    if (category === "ats") return `${subjectPrefix}: keep parser-readable`;
    return `${subjectPrefix}: make wording safe`;
  }
  return trimFindingText(item, 78);
}

function getReviewFindingTarget(finding: ReviewFinding, groupTitle: string) {
  const text = normalizeReviewText(`${groupTitle} ${finding.title} ${finding.detail}`);
  if (groupTitle === "Evidence gaps") {
    return {
      cta: "Open matching task",
      guidance: "Answer the matching evidence question or add source material before rewriting this claim.",
      route: "evidence_tasks" as const,
    };
  }
  if (text.includes("date") || text.includes("duration") || text.includes("current status")) {
    return {
      cta: "Open profile source",
      guidance: "Update the role timeline or current-status source, then rerun extraction/review.",
      route: "evidence_library" as const,
    };
  }
  if (
    text.includes("project") ||
    text.includes("proof") ||
    text.includes("metric") ||
    text.includes("impact") ||
    text.includes("scope")
  ) {
    return {
      cta: "Add evidence",
      guidance: "Add source-backed project context, metrics, ownership, or linked evidence before regenerating.",
      route: "evidence_library" as const,
    };
  }
  if (groupTitle === "Rewrite logic" || text.includes("rewrite") || text.includes("wording")) {
    return {
      cta: "Use in next draft",
      guidance: "Apply this rewrite rule when generating or editing the next resume draft.",
      route: "none" as const,
    };
  }
  if (groupTitle === "ATS notes") {
    return {
      cta: "Review formatting",
      guidance: "Keep section labels, bullets, dates, and ordering parser-friendly before exporting.",
      route: "none" as const,
    };
  }
  if (groupTitle === "Privacy and confidentiality") {
    return {
      cta: "Review safe wording",
      guidance: "Use external-safe wording before approving evidence for resume use.",
      route: "evidence_library" as const,
    };
  }
  return {
    cta: "Open Evidence",
    guidance: "Add or review source-backed material related to this finding.",
    route: "evidence_library" as const,
  };
}

function findingSubject(item: string) {
  const normalized = item.replace(/\s+/g, " ").trim();
  const colonIndex = normalized.indexOf(":");
  if (colonIndex > 0 && colonIndex <= 48) {
    return normalized.slice(0, colonIndex).trim();
  }
  const firstSentence = normalized.match(/^(.+?)(?:\.|\?|!)(?:\s|$)/)?.[1]?.trim();
  return firstSentence && firstSentence.length <= 58 ? firstSentence : "";
}

function trimFindingText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  const trimmedAtWord = normalized.slice(0, maxLength - 1).replace(/\s+\S*$/, "");
  return `${trimmedAtWord || normalized.slice(0, maxLength - 1)}...`;
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function reviewFindingDomId(findingId: string) {
  return `resume-review-finding-${slugify(findingId)}`;
}

function normalizeReviewText(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function formatReviewConfidence(confidence: number | undefined) {
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) {
    return "Confidence unavailable.";
  }
  if (confidence >= 0.85) return "High confidence.";
  if (confidence >= 0.65) return "Moderate confidence.";
  return "Use as directional guidance.";
}

function formatReviewLimitReason(reason: string) {
  const copy: Record<string, string> = {
    contract_invalid: "The full review came back incomplete.",
    invalid_response: "The full review was not usable.",
    provider_error: "The review service did not complete successfully.",
    timeout: "The full review took too long to finish.",
  };
  return copy[reason] ?? "The full review was not available.";
}

function isFallbackResume(resume: ResumeSourceReviewSummary) {
  const metadata = Array.isArray(resume.latestReview?.rubric)
    ? resume.latestReview.rubric.find((item) => item.key === "review_metadata")
    : null;
  return metadata?.provider === "deterministic-fallback";
}

function ResumeParseStatusCard({ status }: { status: ResumeParseStatus }) {
  const quality = status.parseQuality;
  const label =
    quality.status === "needs_ocr"
      ? "Needs OCR"
      : quality.status === "warning"
        ? "Parse warning"
        : quality.status === "failed"
          ? "Parse failed"
          : "Ready to review";
  return (
    <article className="source-parse-card" data-status={quality.status}>
      <div className="source-parse-card__top">
        <div>
          <span className="eyebrow">Resume source parsed</span>
          <h3>{formatResumeTitle(status.title)}</h3>
          <p>{status.filename}</p>
        </div>
        <strong>{label}</strong>
      </div>
      <div className="source-parse-card__metrics">
        <span>{quality.charCount.toLocaleString()} chars</span>
        <span>{quality.wordCount.toLocaleString()} words</span>
        {typeof quality.pageCount === "number" ? <span>{quality.pageCount} pages</span> : null}
      </div>
      {quality.warnings.length > 0 ? (
        <ul className="source-parse-card__warnings">
          {quality.warnings.map((warning) => (
            <li key={warning}>{formatParseWarning(warning)}</li>
          ))}
        </ul>
      ) : null}
      <p className="source-parse-card__next">
        {quality.status === "needs_ocr"
          ? "This PDF has no reliable text layer. Paste text manually, upload a DOCX, or export the PDF with selectable text."
          : quality.status === "failed"
            ? "This file cannot be reviewed reliably. Paste text manually or upload a DOCX/text-layer PDF."
          : "Resume Review evaluates this uploaded source. It does not update your final resume until you generate one from approved Evidence Library material."}
      </p>
    </article>
  );
}

function formatParseWarning(warning: string) {
  const copy: Record<string, string> = {
    formatting_not_preserved: "Formatting is not preserved; review section breaks before extraction.",
    low_text_density: "Extracted text is short; the source may be incomplete.",
    low_text_quality: "Text was extracted, but quality is lower than expected; review the parsed content.",
    low_word_count: "Extracted word count is low for AI review.",
    possible_header_footer_noise: "Repeated header/footer text may add noise.",
    possible_scanned_pdf: "This PDF appears image-based or does not expose selectable text.",
    pdf_text_content_fallback_used: "A secondary PDF text extractor was used for this file.",
    replacement_characters_detected: "Some unreadable replacement characters were found.",
    text_extraction_failed: "No reliable text layer could be read.",
  };
  return copy[warning] ?? warning.replace(/_/g, " ");
}

function ReviewList({ items, title }: { items: string[]; title: string }) {
  if (items.length === 0) return null;
  return (
    <section className="review-list">
      <h3>{title}</h3>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => formatReviewListItem(item))
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) return [formatReviewListItem(value)];
  return [];
}

function formatReviewListItem(item: unknown): string {
  if (typeof item === "string") {
    const trimmed = item.trim();
    if (!looksLikeJsonObject(trimmed)) return trimmed;
    try {
      return formatReviewListItem(JSON.parse(trimmed));
    } catch {
      return trimmed;
    }
  }
  if (!item || typeof item !== "object") return "";
  const record = item as Record<string, unknown>;
  const preferred =
    record.note ??
    record.summary ??
    record.text ??
    record.value ??
    record.suggestion ??
    record.question ??
    record.risk ??
    record.action ??
    record.finding;
  const preferredText = typeof preferred === "string" ? preferred.trim() : "";
  const section = typeof record.section === "string" ? record.section.trim() : "";
  if (preferredText && section) return `${section}: ${preferredText}`;
  if (preferredText) return preferredText;
  return Object.values(record)
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim())
    .join(" ");
}

function looksLikeJsonObject(value: string) {
  return value.startsWith("{") && value.endsWith("}");
}
