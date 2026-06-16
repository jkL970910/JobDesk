"use client";

import { useEffect, useState } from "react";

import { useAccess } from "./access-provider";

export type ResumeSourceReviewSummary = {
  id: string;
  title: string;
  sourceKind: string;
  version: number;
  status: string;
  updatedAt: string;
  latestReview: ResumeReviewReport | null;
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
    key?: string;
    label?: string;
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

export function ResumeReviewWorkspace({
  onExtractToEvidence,
}: {
  onExtractToEvidence: (resumeSourceVersionId: string) => void;
}) {
  const { fetchJson } = useAccess();
  const [resumes, setResumes] = useState<ResumeSourceReviewSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [status, setStatus] = useState("Upload a resume to create a reviewed source version.");
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadElapsedSeconds, setUploadElapsedSeconds] = useState(0);
  const [activeOperation, setActiveOperation] = useState<string | null>(null);
  const [duplicateResume, setDuplicateResume] = useState<ResumeSourceReviewSummary | null>(null);
  const selectedResume = isUploading
    ? null
    : resumes.find((resume) => resume.id === selectedId) ?? resumes[0] ?? null;
  const selectedReview = selectedResume?.latestReview ?? null;
  const selectedResumeIsExtracted = selectedResume?.status === "extracted";

  useEffect(() => {
    void loadResumes();
  }, []);

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

  async function uploadResume(file: File | null) {
    setError(null);
    setDuplicateResume(null);
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
              reason?: string;
            };
            error?: string;
            kind?: string;
          }
        | null;
      if (!response.ok || !payload?.data) {
        setError(payload?.error ?? "Resume review failed.");
        return;
      }
      if (payload.data.status === "duplicate" && payload.data.existingResume) {
        setDuplicateResume(payload.data.existingResume);
        setSelectedId(payload.data.existingResume.id);
        setStatus("This exact resume has already been reviewed.");
        await loadResumes(payload.data.existingResume.id);
        return;
      }
      if (payload.data.status === "saved" && payload.data.resume) {
        setStatus(
          `Reviewed ${formatResumeTitle(payload.data.resume.title)}${payload.data.parseWarnings?.length ? ` · ${payload.data.parseWarnings.length} parser note${payload.data.parseWarnings.length === 1 ? "" : "s"}` : ""}`,
        );
        await loadResumes(payload.data.resume.id);
        return;
      }
      setError(payload.data.reason ?? "Resume review storage is not configured.");
    } finally {
      setIsUploading(false);
    }
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
    } finally {
      setActiveOperation(null);
    }
  }

  async function rerunReview(resume: ResumeSourceReviewSummary) {
    if (
      !window.confirm(
        `Rerun AI review for ${formatResumeTitle(resume.title)} v${resume.version}? This will make another model/provider call and replace the latest review summary for this saved resume version. The uploaded resume and extracted Evidence Library items remain intact.`,
      )
    ) {
      return;
    }
    setError(null);
    setActiveOperation(`rerun:${resume.id}`);
    setSelectedId(resume.id);
    setStatus(`Rerunning review for ${formatResumeTitle(resume.title)}...`);
    try {
      const response = await fetchJson(`/api/resume-review/${resume.id}/rerun`, {
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            data?: {
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
      setStatus(`Review refreshed for ${formatResumeTitle(payload.data.resume.title)}.`);
      await loadResumes(payload.data.resume.id);
    } finally {
      setActiveOperation(null);
    }
  }

  return (
    <section className="resume-review-workspace">
      <div className="panel">
        <div className="panel__header">
          <div>
            <h2 className="panel__title">Resume Review</h2>
            <p className="panel__note">
              Upload, score, and version a general resume before extracting reusable evidence.
            </p>
          </div>
        </div>
        <label className="resume-upload-zone" data-disabled={isUploading}>
          <input
            accept=".pdf,.docx,.txt,.md,.markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
            disabled={isUploading}
            type="file"
            onChange={(event) => {
              void uploadResume(event.target.files?.[0] ?? null);
              event.currentTarget.value = "";
            }}
          />
          <span>{isUploading ? "Reviewing resume..." : "Upload resume"}</span>
          <strong>Drop in or choose a PDF, DOCX, TXT, or Markdown resume.</strong>
          <small>JobDesk will run a general resume review, save a version, then offer evidence extraction.</small>
        </label>
        <span className={error ? "status status--error" : "status"}>{error ?? status}</span>
        {!selectedResume && !isUploading ? (
          <section className="resume-empty-steps" aria-label="Resume Review workflow">
            <article>
              <span>1</span>
              <strong>Upload</strong>
              <p>Add the resume you use today.</p>
            </article>
            <article>
              <span>2</span>
              <strong>Review</strong>
              <p>Check score, strengths, gaps, and risks.</p>
            </article>
            <article>
              <span>3</span>
              <strong>Extract evidence</strong>
              <p>Send source-backed claims to Evidence Library.</p>
            </article>
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
        {selectedResume ? (
          <section className="resume-current-summary">
            <div>
              <span>Current resume</span>
              <strong>{formatResumeTitle(selectedResume.title)}</strong>
              <p>
                v{selectedResume.version} · {selectedResume.status} · updated{" "}
                {new Date(selectedResume.updatedAt).toLocaleDateString()}
              </p>
            </div>
            <div>
              <span>Score</span>
              <strong>{selectedReview ? selectedReview.overallScore : "Pending"}</strong>
              <p>{selectedReview ? "Review findings available" : "Review still needed"}</p>
            </div>
          <button
            aria-label={
              selectedReview
                ? selectedResumeIsExtracted
                  ? "Continue in Evidence Library"
                  : "Extract this reviewed resume into Evidence Library"
                : "Resume review is still pending"
            }
            className="primary-button"
            disabled={!selectedReview}
              type="button"
              onClick={() => onExtractToEvidence(selectedResume.id)}
            >
              {selectedReview
                ? selectedResumeIsExtracted
                  ? "Continue in Evidence Library"
                  : "Extract evidence now"
                : "Review pending"}
            </button>
          </section>
        ) : null}
        {resumes.length > 0 ? (
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
                    {resume.latestReview ? `Score ${resume.latestReview.overallScore}` : "No review"} · {resume.status}
                  </small>
                </button>
                <div className="resume-version-actions">
              <button
                    className="resume-version-action"
                    disabled={Boolean(activeOperation)}
                    title="Runs another AI review call for this saved resume version."
                    type="button"
                    onClick={() => void rerunReview(resume)}
                  >
                    {reviewActionLabel(resume, activeOperation)}
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
          <div className="empty-state empty-state--compact">
            No resume versions yet. Upload a PDF, DOCX, TXT, or Markdown resume.
          </div>
        )}
      </div>

      {selectedResume?.latestReview ? (
        <ResumeReviewReportCard
          onExtract={() => onExtractToEvidence(selectedResume.id)}
          onRetry={() => void rerunReview(selectedResume)}
          retryDisabled={Boolean(activeOperation)}
          retryLabel={reviewActionLabel(selectedResume, activeOperation)}
          resume={selectedResume}
        />
      ) : null}
    </section>
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
}: {
  elapsedSeconds: number;
  fileName: string;
}) {
  const progress = Math.min(92, 16 + elapsedSeconds * 2);
  const stages = [
    {
      label: "Upload and parse",
      summary: "Read the uploaded file and normalize resume text.",
      detail: "Uploading the resume and extracting readable text.",
    },
    {
      label: "Run AI review",
      summary: "Assess structure, impact, readability, ATS, and evidence readiness.",
      detail: "AI is reviewing resume strength, gaps, ATS readability, and evidence opportunities.",
    },
    {
      label: "Validate contract",
      summary: "Check that the AI output matches JobDesk's review schema.",
      detail: "Validating the AI review contract and retrying once if the output is malformed.",
    },
    {
      label: "Save report",
      summary: "Store the reviewed version and refresh the page state.",
      detail: "Saving the report and preparing the Evidence Library handoff.",
    },
  ];
  const activeIndex = Math.min(
    elapsedSeconds < 8 ? 0 : elapsedSeconds < 85 ? 1 : elapsedSeconds < 135 ? 2 : 3,
    stages.length - 1,
  );
  const activeStage = stages[activeIndex]!;
  return (
    <div className="progress-notice" role="status" aria-live="polite">
      <div className="progress-notice__top">
        <strong>Resume review in progress</strong>
        <span>{elapsedSeconds}s</span>
      </div>
      <div className="progress-bar" aria-hidden="true">
        <span style={{ width: `${progress}%` }} />
      </div>
      <p>
        {activeStage.detail}
        {fileName ? ` File: ${fileName}.` : ""}
        {elapsedSeconds >= 135 ? " Long resumes or provider retries can take about three minutes." : ""}
      </p>
      <ol className="progress-stages" aria-label="Resume review stages">
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
      <p>Keep this page open; the score appears only after the review is saved.</p>
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

function ResumeReviewReportCard({
  onExtract,
  onRetry,
  resume,
  retryDisabled,
  retryLabel,
}: {
  onExtract: () => void;
  onRetry: () => void;
  resume: ResumeSourceReviewSummary;
  retryDisabled: boolean;
  retryLabel: string;
}) {
  const review = resume.latestReview;
  if (!review) return null;
  const [activeDetailTab, setActiveDetailTab] = useState<ReviewDetailTab>("summary");
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
  const topFixes = [
    ...weaknesses.map((item) => ({ item, label: "Fix" })),
    ...missingEvidenceQuestions.map((item) => ({ item, label: "Evidence" })),
    ...recommendedActions.map((item) => ({ item, label: "Rewrite" })),
  ].slice(0, 3);
  return (
    <section className="panel resume-review-report">
      <div className="resume-review-report__hero">
        <div>
          <p className="panel-kicker">General resume score</p>
          <h2>{formatResumeTitle(resume.title)}</h2>
          <p>
            v{resume.version} · {resume.sourceKind.toUpperCase()} · {resume.status}
          </p>
          {metadata?.scopeNote ? <p>{metadata.scopeNote}</p> : null}
          {isFallback ? (
            <p className="review-warning">
              This is a local fallback estimate, not a full AI resume review. The AI response failed validation, so treat this score as directional.
            </p>
          ) : null}
        </div>
        <strong>{review.overallScore}</strong>
      </div>
      {isFallback ? (
        <section className="review-retry-panel">
          <div>
            <h3>AI review did not complete cleanly.</h3>
            <p>
              The uploaded resume is already saved. Retry runs another AI review call for this version; use it instead of uploading the same file again.
            </p>
          </div>
          <button disabled={retryDisabled} type="button" onClick={onRetry}>
            {retryLabel}
          </button>
        </section>
      ) : null}
      {metadata ? (
        <section className="resume-review-meta">
          <article>
            <span>Reviewer</span>
            <strong>{metadata.provider ?? "unknown"}</strong>
            <p>
              {metadata.model ?? "model unknown"}
              {metadata.providerFailureKind ? ` · fallback after ${metadata.providerFailureKind}` : ""}
            </p>
          </article>
          <article>
            <span>Confidence</span>
            <strong>{Math.round((metadata.confidence ?? 0) * 100)}%</strong>
            <p>Retry count: {metadata.retryCount ?? 0}</p>
          </article>
        </section>
      ) : null}
      {metadata?.tenSecondScan ? (
        <section className="review-scan-card">
          <h3>10-second scan</h3>
          <p>{metadata.tenSecondScan}</p>
        </section>
      ) : null}
      {topFixes.length ? (
        <section className="review-top-fixes">
          <div className="review-top-fixes__header">
            <div>
              <p className="panel-kicker">Triage</p>
              <h3>Top recommended fixes</h3>
            </div>
            <span className="review-next-step">
              {resume.status === "extracted" ? "Next: review claim gaps in Evidence Library" : "Next: extract evidence into the library"}
            </span>
          </div>
          <div className="review-top-fixes__grid">
            {topFixes.map((fix) => (
              <article key={`${fix.label}-${fix.item}`}>
                <span>{fix.label}</span>
                <p>{fix.item}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      <ReviewDimensionWorkbench
        dimensions={dimensions}
        missingEvidenceQuestions={missingEvidenceQuestions}
        onExtract={onExtract}
        onSelect={setSelectedDimensionId}
        selectedDimension={selectedDimension}
      />
      <ReviewDetailTabs
        activeTab={activeDetailTab}
        atsNotes={atsNotes}
        findingGroups={findingGroups}
        metadataScan={metadata?.tenSecondScan ?? ""}
        onExtract={onExtract}
        onSelect={setActiveDetailTab}
        resumeStatus={resume.status}
      />
      {metadata?.fairnessCheck ? (
        <section className="review-scan-card">
          <h3>Fairness check</h3>
          <p>{metadata.fairnessCheck.note}</p>
          {fairnessSignals.length ? (
            <ul>
              {fairnessSignals.map((signal) => (
                <li key={signal}>{signal}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
      <div className="handoff-panel">
        <div>
          <p className="panel-kicker">Review-driven enrich</p>
          <h3>
            {resume.status === "extracted"
              ? "Use extracted evidence or update it with new source material."
              : "Turn review gaps into source-backed evidence."}
          </h3>
          <p>
            {resume.status === "extracted"
              ? "Re-extraction creates new reviewable drafts and relies on library dedupe; it does not silently overwrite approved evidence."
              : "Use Evidence Library to answer missing evidence questions, add project/source docs, and create reusable claims before generating a main or tailored resume."}
          </p>
        </div>
        <ul className="review-next-steps">
          <li>Review evidence gaps from this resume.</li>
          <li>Approve resume-safe claims in Evidence Library.</li>
          <li>Use Source Intake to update extraction when new source material exists.</li>
        </ul>
      </div>
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
  percent: number;
  score: number;
  status: "strong" | "watch" | "weak";
};

type ReviewFindingGroup = {
  ctaLabel?: string;
  items: ReviewFinding[];
  title: string;
};

type ReviewFinding = {
  detail: string;
  id: string;
  nextStep: string;
  title: string;
  tone: "positive" | "warning" | "risk" | "neutral";
  why: string;
};

function ReviewDimensionWorkbench({
  dimensions,
  missingEvidenceQuestions,
  onExtract,
  onSelect,
  selectedDimension,
}: {
  dimensions: ReviewDimension[];
  missingEvidenceQuestions: string[];
  onExtract: () => void;
  onSelect: (id: string) => void;
  selectedDimension: ReviewDimension;
}) {
  const evidencePrompts = missingEvidenceQuestions.slice(0, 3);
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
      <article className="review-dimension-card" data-state={selectedDimension.status}>
        <div className="review-dimension-card__top">
          <div>
            <p className="panel-kicker">Selected dimension</p>
            <h3>{selectedDimension.label}</h3>
          </div>
          <strong>
            {selectedDimension.score}/{selectedDimension.maxScore}
          </strong>
        </div>
        <div className="review-dimension-card__body">
          <div>
            <span>Reviewer note</span>
            <p>{selectedDimension.note}</p>
          </div>
          <div>
            <span>Rewrite logic</span>
            <p>{dimensionRewriteGuidance(selectedDimension)}</p>
          </div>
          <div>
            <span>Evidence/history to enrich</span>
            {evidencePrompts.length ? (
              <ul>
                {evidencePrompts.map((prompt) => (
                  <li key={prompt}>{prompt}</li>
                ))}
              </ul>
            ) : (
              <p>Use Source Intake only if this dimension needs more specific metrics, project context, or external-safe wording.</p>
            )}
          </div>
        </div>
        <button type="button" onClick={onExtract}>
          Enrich supporting evidence
        </button>
      </article>
    </section>
  );
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
  const center = 96;
  const radius = 74;
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
      textX: center + Math.cos(angle) * (radius + 22),
      textY: center + Math.sin(angle) * (radius + 22),
    };
  });
  const polygon = axisPoints.map((point) => point.score).join(" ");
  return (
    <svg className="review-radar" role="img" viewBox="0 0 192 192" aria-label="Radar chart of resume review dimensions">
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
  onExtract,
  visibleTitles,
}: {
  groups: ReviewFindingGroup[];
  onExtract: () => void;
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
          <p className="panel-kicker">Actionable findings</p>
          <h3>Use the review as an edit and evidence backlog.</h3>
        </div>
        <p>Cards separate what to preserve, what to rewrite, and what needs source-backed proof.</p>
      </div>
      {visibleGroups.map((group) => (
        <div className="review-finding-group" key={group.title}>
          <div className="review-finding-group__top">
            <h4>{group.title}</h4>
            {group.ctaLabel ? (
              <button type="button" onClick={onExtract}>
                {group.ctaLabel}
              </button>
            ) : null}
          </div>
          <div className="review-finding-grid">
            {group.items.map((item) => (
              <article
                className="review-finding-card"
                data-tone={item.tone}
                key={item.id}
              >
                <span>{item.title}</span>
                <p>{item.detail}</p>
                <dl>
                  <div>
                    <dt>Why it matters</dt>
                    <dd>{item.why}</dd>
                  </div>
                  <div>
                    <dt>Next action</dt>
                    <dd>{item.nextStep}</dd>
                  </div>
                </dl>
                <button type="button" onClick={onExtract}>
                  {findingCardActionLabel(item.tone)}
                </button>
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
  findingGroups,
  metadataScan,
  onExtract,
  onSelect,
  resumeStatus,
}: {
  activeTab: ReviewDetailTab;
  atsNotes: string[];
  findingGroups: ReviewFindingGroup[];
  metadataScan: string;
  onExtract: () => void;
  onSelect: (tab: ReviewDetailTab) => void;
  resumeStatus: string;
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
  return (
    <section className="review-detail-panel">
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
        <section className="review-summary-card">
          <div>
            <p className="panel-kicker">Summary</p>
            <h3>{metadataScan ? "Recruiter skim result" : "Review summary"}</h3>
            <p>{metadataScan || "Use the tabs to inspect strengths, fixes, evidence gaps, rewrite suggestions, ATS notes, and privacy risks."}</p>
          </div>
          <span className="review-next-step">
            {resumeStatus === "extracted" ? "Next: approve resume-safe evidence in Evidence Library" : "Next: extract evidence after review"}
          </span>
        </section>
      ) : (
        <ReviewFindingBoard
          groups={findingGroups}
          onExtract={onExtract}
          visibleTitles={active.titles}
        />
      )}
      {active.id === "ats" && atsNotes.length === 0 ? (
        <div className="empty-state empty-state--compact">No ATS-specific notes were returned.</div>
      ) : null}
    </section>
  );
}

function reviewActionLabel(
  resume: ResumeSourceReviewSummary,
  activeOperation: string | null,
) {
  if (activeOperation === `rerun:${resume.id}`) return "Retrying...";
  return isFallbackResume(resume) ? "Retry AI review" : "Rerun review";
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
        score,
        status: dimensionStatus(percent),
      };
    })
    .filter((dimension) => dimension.label.toLowerCase() !== "review metadata");
  if (dimensions.length) return dimensions;
  return [fallbackReviewDimension(overallScore)];
}

function fallbackReviewDimension(overallScore: number): ReviewDimension {
  const percent = Math.max(0, Math.min(overallScore / 100, 1));
  return {
    id: "overall",
    label: "Overall readiness",
    maxScore: 100,
    note: "Overall resume readiness based on the available review output.",
    percent,
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
        detail: item,
        id: `strength-${index}-${item}`,
        nextStep: "Preserve this signal when rewriting. If it is tied to a project, make sure the supporting evidence stays approved.",
        title: "Keep this signal",
        tone: "positive",
        why: "Strong signals should survive tailoring instead of being edited away for keyword matching.",
      })),
      title: "Strengths to preserve",
    },
    {
      ctaLabel: "Add evidence",
      items: weaknesses.map((item, index) => ({
        detail: item,
        id: `weakness-${index}-${item}`,
        nextStep: "Rewrite the bullet only after adding missing context, metric, scope, or outcome in Evidence Library.",
        title: "Rewrite candidate",
        tone: "warning",
        why: "Weak sections usually need stronger proof, not just better wording.",
      })),
      title: "Weaknesses to fix",
    },
    {
      ctaLabel: "Answer questions",
      items: missingEvidenceQuestions.map((item, index) => ({
        detail: item,
        id: `missing-${index}-${item}`,
        nextStep: "Use Source Intake or project/source docs to answer this question, then approve the resulting claim.",
        title: "Evidence needed",
        tone: "warning",
        why: "Tailored resumes work better when claims are backed by reusable source material.",
      })),
      title: "Evidence gaps",
    },
    {
      items: recommendedActions.map((item, index) => ({
        detail: item,
        id: `action-${index}-${item}`,
        nextStep: "Treat this as rewrite logic for the next generated resume draft.",
        title: "Rewrite instruction",
        tone: "neutral",
        why: "This converts review feedback into a rule the resume generator can follow.",
      })),
      title: "Rewrite logic",
    },
    {
      items: atsNotes.map((item, index) => ({
        detail: item,
        id: `ats-${index}-${item}`,
        nextStep: "Keep formatting parseable and avoid adding layout complexity when improving content.",
        title: "ATS consideration",
        tone: "neutral",
        why: "A strong resume still needs to survive parser and recruiter skim constraints.",
      })),
      title: "ATS notes",
    },
    {
      ctaLabel: "Review source wording",
      items: riskFlags.map((item, index) => ({
        detail: item,
        id: `risk-${index}-${item}`,
        nextStep: "Move sensitive details into internal notes and use external-safe wording before resume generation.",
        title: "Confidentiality risk",
        tone: "risk",
        why: "Internal system names, sensitive metrics, or confidential context should not leak into external resumes.",
      })),
      title: "Privacy and confidentiality",
    },
  ];
}

function findingCardActionLabel(tone: ReviewFinding["tone"]) {
  if (tone === "positive") return "Open evidence backing";
  if (tone === "risk") return "Review source wording";
  if (tone === "neutral") return "Use in rewrite plan";
  return "Add missing evidence";
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
  const trimmed = label.trim();
  if (trimmed.length <= 14) return trimmed;
  return `${trimmed.slice(0, 12)}...`;
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function isFallbackResume(resume: ResumeSourceReviewSummary) {
  const metadata = Array.isArray(resume.latestReview?.rubric)
    ? resume.latestReview.rubric.find((item) => item.key === "review_metadata")
    : null;
  return metadata?.provider === "deterministic-fallback";
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
