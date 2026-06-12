"use client";

import { useEffect, useState, useTransition } from "react";

import { useAccess } from "./access-provider";

import type { JDAnalysis } from "../schemas/jd-analysis";
import type { InterviewPrepPack } from "../server/interview-prep-service";

type RecentJob = {
  id: string;
  title: string;
  job_facts: JDAnalysis["job_facts"];
  analyzedAt: string | null;
  requirementCount: number;
};

type GenerateResponse =
  | { data: { status: "saved"; pack: InterviewPrepPack } }
  | { data: { status: "skipped"; reason: string } }
  | { error: string; kind?: string };

export function InterviewPrepWorkspace() {
  const { fetchJson } = useAccess();
  const [jobs, setJobs] = useState<RecentJob[]>([]);
  const [selectedJobId, setSelectedJobId] = useState("");
  const [latestPack, setLatestPack] = useState<InterviewPrepPack | null>(null);
  const [recentPacks, setRecentPacks] = useState<InterviewPrepPack[]>([]);
  const [status, setStatus] = useState(
    "Select a role workspace to create an interview prep pack.",
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    void loadJobs();
    void loadRecentPacks();
  }, []);

  async function loadJobs() {
    const response = await fetchJson("/api/jobs/recent");
    if (!response.ok) return;
    const payload = (await response.json()) as { data?: RecentJob[] };
    const nextJobs = payload.data ?? [];
    setJobs(nextJobs);
    setSelectedJobId((current) => current || nextJobs[0]?.id || "");
  }

  async function loadRecentPacks() {
    const response = await fetchJson("/api/interview-prep/recent");
    if (!response.ok) return;
    const payload = (await response.json()) as { data?: InterviewPrepPack[] };
    const packs = payload.data ?? [];
    setRecentPacks(packs);
    setLatestPack((current) => current ?? packs[0] ?? null);
  }

  function generatePrep() {
    if (!selectedJobId) return;
    setError(null);
    startTransition(async () => {
      const response = await fetchJson("/api/interview-prep/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: selectedJobId }),
      });
      const payload = (await response.json().catch(() => null)) as GenerateResponse | null;
      if (!response.ok || !payload || "error" in payload) {
        setError(
          payload && "error" in payload
            ? `${payload.error}${payload.kind ? ` (${payload.kind})` : ""}`
            : "Interview prep generation failed.",
        );
        return;
      }
      if (payload.data.status === "skipped") {
        setError("Database is not configured for interview prep persistence.");
        return;
      }
      setLatestPack(payload.data.pack);
      setStatus(
        `Prep pack ready · ${payload.data.pack.behavioral_questions.length} behavioral questions · ${payload.data.pack.technical_review_topics.length} review topics`,
      );
      void loadRecentPacks();
    });
  }

  const selectedJob = jobs.find((job) => job.id === selectedJobId);

  return (
    <section className="workspace__grid workspace__grid--interview">
      <div className="panel panel--control">
        <div className="panel__header">
          <div>
            <h2 className="panel__title">Interview prep control</h2>
            <p className="panel__note">
              Build a focused plan from the selected JD plus STAR stories in the material library.
            </p>
          </div>
        </div>
        <label className="source-field">
          <span>Target job</span>
          <select
            className="source-input"
            value={selectedJobId}
            onChange={(event) => setSelectedJobId(event.target.value)}
          >
            {jobs.length === 0 ? <option value="">No analyzed jobs yet</option> : null}
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {job.title}
              </option>
            ))}
          </select>
        </label>
        {selectedJob ? (
          <div className="readiness-panel">
            <div className="readiness-item" data-ready="true">
              <span className="readiness-item__state">job</span>
              <div>
                <p className="readiness-item__label">{selectedJob.title}</p>
                <p className="readiness-item__detail">
                  {selectedJob.requirementCount} requirements
                  {selectedJob.analyzedAt
                    ? ` · ${new Date(selectedJob.analyzedAt).toLocaleDateString()}`
                    : ""}
                </p>
              </div>
            </div>
          </div>
        ) : null}
        <div className="actions">
          <button
            className="primary-button"
            disabled={!selectedJobId || isPending}
            type="button"
            onClick={generatePrep}
          >
            {isPending ? "Building prep..." : "Create prep pack"}
          </button>
          <span className={error ? "status status--error" : "status"}>
            {error ?? status}
          </span>
        </div>
        {recentPacks.length > 0 ? (
          <div className="recent-jobs" aria-label="Recent interview prep packs">
            {recentPacks.map((pack) => (
              <button
                className="recent-job"
                key={pack.id ?? pack.title}
                type="button"
                data-selected={pack.id === latestPack?.id}
                onClick={() => setLatestPack(pack)}
              >
                <span>{pack.title}</span>
                <small>
                  {pack.behavioral_questions.length} questions ·{" "}
                  {pack.technical_review_topics.length} topics
                </small>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="panel panel--output">
        <div className="panel__header">
          <div>
            <h2 className="panel__title">Prep pack</h2>
            <p className="panel__note">
              Behavioral questions stay tied to STAR material and evidence gaps.
            </p>
          </div>
        </div>
        {latestPack ? <PrepPackView pack={latestPack} /> : <EmptyPrepState />}
      </div>
    </section>
  );
}

function PrepPackView({ pack }: { pack: InterviewPrepPack }) {
  return (
    <div className="result-stack">
      <section className="job-facts">
        <div className="chip-row">
          <span className="chip">{pack.job_snapshot.role_title ?? "target role"}</span>
          <span className="chip">{pack.job_snapshot.role_archetype}</span>
          <span className="chip">{pack.status}</span>
          <span className="chip">{pack.retrieved_context.length} retrieved context</span>
        </div>
      </section>
      <section className="section-block">
        <h3>Behavioral questions</h3>
        <div className="result-stack result-stack--inner">
          {pack.behavioral_questions.slice(0, 5).map((question) => (
            <article className="requirement" key={question.question}>
              <div className="requirement__top">
                <p className="requirement__text">{question.question}</p>
                <span className="requirement__type">{question.focus}</span>
              </div>
              {question.recommended_story_title ? (
                <p className="requirement__quote">
                  Story: {question.recommended_story_title}
                </p>
              ) : null}
              <SectionList title="Action" items={question.star_outline.action} />
              <SectionList title="Result" items={question.star_outline.result} />
              <SectionList title="Gaps" items={question.gaps.slice(0, 3)} />
            </article>
          ))}
        </div>
      </section>
      <section className="section-block">
        <h3>Technical review</h3>
        <div className="result-stack result-stack--inner">
          {pack.technical_review_topics.slice(0, 5).map((topic) => (
            <article className="requirement" key={topic.topic}>
              <div className="requirement__top">
                <p className="requirement__text">{topic.topic}</p>
                <span className="requirement__type">review</span>
              </div>
              <p className="requirement__quote">{topic.practice_prompt}</p>
            </article>
          ))}
        </div>
      </section>
      <SectionList title="Practice plan" items={pack.practice_plan} />
      <SectionList title="Company research prompts" items={pack.company_research_prompts} />
      <SectionList title="Evidence gaps" items={pack.evidence_gaps.slice(0, 6)} />
    </div>
  );
}

function EmptyPrepState() {
  return (
    <div className="empty-state empty-state--compact">
      Create a prep pack after selecting a role workspace and preparing STAR-ready material.
    </div>
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
