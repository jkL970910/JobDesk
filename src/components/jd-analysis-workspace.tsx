"use client";

import { useEffect, useState, useTransition } from "react";

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
  const [jdText, setJdText] = useState(sampleJd);
  const [result, setResult] = useState<JDAnalysis | null>(null);
  const [recentJobs, setRecentJobs] = useState<RecentJob[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState<number | null>(null);
  const [persistenceLabel, setPersistenceLabel] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    void loadRecentJobs();
  }, []);

  async function loadRecentJobs() {
    const response = await fetch("/api/jobs/recent");
    if (!response.ok) return;
    const payload = (await response.json()) as { data?: RecentJob[] };
    setRecentJobs(payload.data ?? []);
  }

  function runAnalysis() {
    setError(null);
    startTransition(async () => {
      try {
        const response = await fetch("/api/ai/jd-analysis", {
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
        setRetryCount(payload.meta.retryCount);
        setPersistenceLabel(formatPersistence(payload.meta.persistence));
        void loadRecentJobs();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "JD analysis failed.");
      }
    });
  }

  async function loadJob(jobId: string) {
    setError(null);
    const response = await fetch(`/api/jobs/${jobId}`);
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
    setPersistenceLabel("loaded from database");
  }

  async function archiveSelectedJob() {
    if (!selectedJobId) return;
    setError(null);
    const response = await fetch(`/api/jobs/${selectedJobId}`, {
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
    setRetryCount(null);
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

  return (
    <section className="workspace__grid">
      <div className="panel">
        <div className="panel__header">
          <div>
            <h2 className="panel__title">Job description</h2>
            <p className="panel__note">
              The first Phase 0 workflow validates JD extraction before the app
              grows into profile, evidence, and resume generation.
            </p>
          </div>
        </div>
        <textarea
          className="jd-input"
          value={jdText}
          onChange={(event) => setJdText(event.target.value)}
          spellCheck={false}
        />
        <div className="actions">
          <button
            className="primary-button"
            disabled={isPending || jdText.trim().length < 20}
            type="button"
            onClick={runAnalysis}
          >
            {isPending ? "Analyzing..." : "Analyze JD"}
          </button>
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
              (retryCount == null
                ? "OpenRouter JSON contract call"
                : `Validated · retries ${retryCount}${persistenceLabel ? ` · ${persistenceLabel}` : ""}`)}
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
              Every requirement should carry a source quote from the original JD.
            </p>
          </div>
        </div>
        {result ? <ResultView result={result} /> : <EmptyState />}
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
  if (persistence.status === "saved") return "saved to database";
  if (persistence.reason === "missing_database_url") return "database not configured";
  return "not saved";
}

function EmptyState() {
  return (
    <div className="empty-state">
      Run the analysis to see hard requirements, soft signals, keywords, and
      interview implications.
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
          <p className="requirement__quote">Quote: {requirement.source_quote}</p>
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
