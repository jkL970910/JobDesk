"use client";

import { useEffect, useState, useTransition } from "react";

import { useAccess } from "./access-provider";
import {
  RetrievalExplanationPanel,
  type RetrievalEvidenceExplanation,
  type RetrievalSourceMaterialExplanation,
} from "./retrieval-explanation-panel";

import type { JDAnalysis } from "../schemas/jd-analysis";

const sampleJd = [
  "Senior Product Analyst",
  "We are looking for 5+ years of experience in product analytics, SQL, and dashboard development.",
  "Experience with experimentation, stakeholder communication, and financial services is preferred.",
  "The role partners with product managers and engineering teams to define metrics and improve customer journeys.",
].join("\n");

type ApiResponse =
  | {
      data: JDAnalysis;
      meta: {
        retryCount: number;
        persistence?: {
          status: "saved" | "skipped";
          reason?: string;
          jobId?: string;
        };
      };
    }
  | { error: string; kind?: string };

type RecentJob = {
  id: string;
  title: string;
  job_facts: JDAnalysis["job_facts"];
  analyzedAt: string | null;
  requirementCount: number;
  requirements: JDAnalysis["requirements"];
  role_archetype: JDAnalysis["role_archetype"];
  job_legitimacy: JDAnalysis["job_legitimacy"];
  application_status?: string;
  role_signals: string[];
  keywords: string[];
  interview_implications: string[];
  originalJdText: string;
};

export function JdAnalysisWorkspace() {
  const { fetchJson } = useAccess();
  const [jdText, setJdText] = useState(sampleJd);
  const [result, setResult] = useState<JDAnalysis | null>(null);
  const [recentJobs, setRecentJobs] = useState<RecentJob[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [persistenceLabel, setPersistenceLabel] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [retrievalEvidence, setRetrievalEvidence] = useState<RetrievalEvidenceExplanation[]>([]);
  const [sourceMaterial, setSourceMaterial] = useState<RetrievalSourceMaterialExplanation[]>([]);

  useEffect(() => {
    void loadRecentJobs();
  }, []);

  async function loadRecentJobs() {
    const response = await fetchJson("/api/jobs/recent");
    if (!response.ok) {
      setError(await formatLoadError(response, "Could not load saved jobs."));
      return;
    }
    const payload = (await response.json()) as { data?: RecentJob[] };
    setRecentJobs(payload.data ?? []);
  }

  function runAnalysis() {
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetchJson("/api/ai/jd-analysis", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobId: selectedJobId ?? "jd-workbench",
            targetJobId: selectedJobId ?? undefined,
            jdText,
          }),
        });
        const payload = (await response.json()) as ApiResponse;
        if (!response.ok || "error" in payload) {
          setError(
            "error" in payload
              ? `${payload.error}${payload.kind ? ` (${payload.kind})` : ""}`
              : "JD analysis failed.",
          );
          return;
        }
        setResult(payload.data);
        setSelectedJobId(payload.meta.persistence?.jobId ?? selectedJobId);
        setPersistenceLabel(formatPersistence(payload.meta.persistence));
        if (payload.meta.persistence?.jobId) {
          void loadRetrievalExplanation(payload.meta.persistence.jobId);
        }
        void loadRecentJobs();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "JD analysis failed.");
      }
    });
  }

  async function loadJob(jobId: string) {
    setError(null);
    const response = await fetchJson(`/api/jobs/${jobId}`);
    const payload = (await response.json()) as
      | { data: RecentJob }
      | { error: string; kind?: string };
    if (!response.ok || "error" in payload) {
      setError(
        "error" in payload
          ? `${payload.error}${payload.kind ? ` (${payload.kind})` : ""}`
          : "Failed to load job.",
      );
      return;
    }
    applyJob(payload.data);
    setPersistenceLabel("loaded");
    void loadRetrievalExplanation(jobId);
  }

  async function archiveSelectedJob() {
    if (!selectedJobId) return;
    setError(null);
    const response = await fetchJson(`/api/jobs/${selectedJobId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "archive" }),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string; kind?: string }
        | null;
      setError(payload?.error ?? "Failed to archive job.");
      return;
    }
    setSelectedJobId(null);
    setResult(null);
    setPersistenceLabel("archived");
    void loadRecentJobs();
  }

  function applyJob(job: RecentJob) {
    setSelectedJobId(job.id);
    setJdText(job.originalJdText);
    setResult({
      job_id: job.id,
      original_jd_text: job.originalJdText,
      job_facts: job.job_facts,
      requirements: job.requirements,
      role_archetype: job.role_archetype,
      job_legitimacy: job.job_legitimacy,
      role_signals: job.role_signals,
      keywords: job.keywords,
      interview_implications: job.interview_implications,
    });
  }

  async function loadRetrievalExplanation(jobId: string) {
    const response = await fetchJson("/api/retrieval/resume-explanations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, limit: 8 }),
    });
    if (!response.ok) return;
    const payload = (await response.json()) as {
      data?: {
        evidence?: RetrievalEvidenceExplanation[];
        sourceMaterial?: RetrievalSourceMaterialExplanation[];
      };
    };
    setRetrievalEvidence(payload.data?.evidence ?? []);
    setSourceMaterial(payload.data?.sourceMaterial ?? []);
  }

  return (
    <section className="workspace__grid">
      <div className="panel">
        <div className="panel__header">
          <div>
            <h2 className="panel__title">Job description</h2>
            <p className="panel__note">
              Create or refresh one role workspace. This step is separate from
              the reusable material library.
            </p>
          </div>
          <button
            className="primary-button"
            disabled={isPending || jdText.trim().length < 20}
            type="button"
            onClick={runAnalysis}
          >
            {isPending ? "Analyzing..." : "Analyze JD"}
          </button>
        </div>
        {jdText === sampleJd ? <p className="sample-marker">Sample JD loaded</p> : null}
        <textarea
          className="jd-input"
          value={jdText}
          onChange={(event) => setJdText(event.target.value)}
          spellCheck={false}
        />
        <div className="actions">
          {selectedJobId ? (
            <button
              className="secondary-button"
              disabled={isPending}
              type="button"
              onClick={archiveSelectedJob}
            >
              Archive
            </button>
          ) : null}
          <span className={error ? "status status--error" : "status"}>
            {error ??
              (persistenceLabel
                ? `Analysis ready · ${persistenceLabel}`
                : "Ready to analyze a job description")}
          </span>
        </div>
        {recentJobs.length > 0 ? (
          <div className="recent-jobs" aria-label="Recent analyzed jobs">
            {recentJobs.map((job) => (
              <button
                className="recent-job"
                key={job.id}
                type="button"
                data-selected={job.id === selectedJobId}
                onClick={() => void loadJob(job.id)}
              >
                <span>{job.title}</span>
                <small>
                  {job.requirementCount} requirements
                  {job.analyzedAt ? ` · ${new Date(job.analyzedAt).toLocaleDateString()}` : ""}
                </small>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="panel">
        <div className="panel__header">
          <div>
            <h2 className="panel__title">Requirement matrix</h2>
            <p className="panel__note">
              Requirements are grouped with the exact JD text that supports them.
            </p>
          </div>
        </div>
        {result ? (
          <>
            <ResultView result={result} />
            <RetrievalExplanationPanel
              evidence={retrievalEvidence}
              sourceMaterial={sourceMaterial}
              title="Why this evidence may fit the JD"
            />
          </>
        ) : (
          <EmptyState />
        )}
      </div>
    </section>
  );
}

function formatPersistence(
  persistence:
    | { status: "saved" | "skipped"; reason?: string; jobId?: string }
    | undefined,
) {
  if (!persistence) return null;
  if (persistence.status === "saved") return "saved";
  if (persistence.reason === "missing_database_url") return "draft only";
  return "not saved";
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

function EmptyState() {
  return (
    <div className="empty-state jd-empty-state">
      <strong>Analyze a JD to build the requirement matrix.</strong>
      <p>The matrix will show hard requirements, soft signals, keywords, evidence matches, and interview implications.</p>
    </div>
  );
}

function ResultView({ result }: { result: JDAnalysis }) {
  return (
    <div className="result-stack">
      <JobFactsView facts={result.job_facts} />
      <LegitimacyView
        archetype={result.role_archetype}
        legitimacy={result.job_legitimacy}
      />
      {result.requirements.map((requirement, index) => (
        <article className="requirement" key={`${requirement.source_quote}-${index}`}>
          <div className="requirement__top">
            <p className="requirement__text">{requirement.text}</p>
            <span
              className={
                requirement.requirement_type === "soft"
                  ? "requirement__type requirement__type--soft"
                  : "requirement__type"
              }
            >
              {requirement.requirement_type}
            </span>
          </div>
          <p className="requirement__quote">From JD: {requirement.source_quote}</p>
          {requirement.keywords.length > 0 ? (
            <div className="chip-row" aria-label="Requirement keywords">
              {requirement.keywords.map((keyword) => (
                <span className="chip" key={keyword}>
                  {keyword}
                </span>
              ))}
            </div>
          ) : null}
        </article>
      ))}

      <Section title="Role signals" items={result.role_signals} />
      <Section title="Keywords" items={result.keywords} chip />
      <Section title="Interview implications" items={result.interview_implications} />
    </div>
  );
}

function LegitimacyView({
  archetype,
  legitimacy,
}: {
  archetype: JDAnalysis["role_archetype"];
  legitimacy: JDAnalysis["job_legitimacy"];
}) {
  return (
    <section className="job-facts">
      <div className="chip-row">
        <span className="chip">archetype: {archetype}</span>
        <span className="chip">legitimacy: {legitimacy.tier}</span>
      </div>
      {legitimacy.signals.length > 0 ? (
        <ul>
          {legitimacy.signals.slice(0, 4).map((signal) => (
            <li key={`${signal.signal}-${signal.finding}`}>
              {signal.weight}: {signal.signal} - {signal.finding}
            </li>
          ))}
        </ul>
      ) : null}
      {legitimacy.context_notes[0] ? (
        <p className="requirement__quote">{legitimacy.context_notes[0]}</p>
      ) : null}
    </section>
  );
}

function JobFactsView({ facts }: { facts: JDAnalysis["job_facts"] }) {
  const summary = [
    facts.company ? `Company: ${facts.company}` : null,
    facts.role_title ? `Role: ${facts.role_title}` : null,
    facts.level ? `Level: ${facts.level}` : null,
    facts.location ? `Location: ${facts.location}` : null,
  ].filter(Boolean);

  if (
    summary.length === 0 &&
    facts.responsibilities.length === 0 &&
    facts.preferred_qualifications.length === 0
  ) {
    return null;
  }

  return (
    <section className="job-facts">
      {summary.length > 0 ? (
        <div className="chip-row">
          {summary.map((item) => (
            <span className="chip" key={item}>
              {item}
            </span>
          ))}
        </div>
      ) : null}
      <Section title="Responsibilities" items={facts.responsibilities} />
      <Section
        title="Preferred qualifications"
        items={facts.preferred_qualifications}
      />
    </section>
  );
}

function Section({
  title,
  items,
  chip = false,
}: {
  title: string;
  items: string[];
  chip?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <section className="section-block">
      <h3>{title}</h3>
      {chip ? (
        <div className="chip-row">
          {items.map((item) => (
            <span className="chip" key={item}>
              {item}
            </span>
          ))}
        </div>
      ) : (
        <ul>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
