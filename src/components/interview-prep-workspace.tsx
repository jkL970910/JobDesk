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

type LibrarySummary = {
  evidenceItems: Array<{
    id: string;
    status: string;
  }>;
};

type StarStorySummary = {
  stories: Array<{
    id: string;
    readiness: string;
  }>;
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
  const [approvedEvidenceCount, setApprovedEvidenceCount] = useState(0);
  const [starStoryCount, setStarStoryCount] = useState(0);
  const [tailoredResumeCount, setTailoredResumeCount] = useState(0);
  const [status, setStatus] = useState(
    "Select a role workspace to create an interview prep pack.",
  );
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    void loadJobs();
    void loadRecentPacks();
    void loadPrepReadiness();
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

  async function loadRecentPacks() {
    const response = await fetchJson("/api/interview-prep/recent");
    if (!response.ok) {
      setError(await formatLoadError(response, "Could not load interview prep packs."));
      return;
    }
    const payload = (await response.json()) as { data?: InterviewPrepPack[] };
    const packs = payload.data ?? [];
    setRecentPacks(packs);
    setLatestPack((current) => current ?? packs[0] ?? null);
  }

  async function loadPrepReadiness() {
    const [libraryResponse, starResponse, resumesResponse] = await Promise.all([
      fetchJson("/api/profile-evidence/recent"),
      fetchJson("/api/profile-evidence/star-stories"),
      fetchJson("/api/resumes/recent"),
    ]);

    if (libraryResponse.ok) {
      const payload = (await libraryResponse.json()) as { data?: LibrarySummary | null };
      setApprovedEvidenceCount(
        payload.data?.evidenceItems.filter((item) => item.status === "approved").length ?? 0,
      );
    }
    if (starResponse.ok) {
      const payload = (await starResponse.json()) as { data?: StarStorySummary };
      setStarStoryCount(payload.data?.stories.length ?? 0);
    }
    if (resumesResponse.ok) {
      const payload = (await resumesResponse.json()) as { data?: unknown[] };
      setTailoredResumeCount(payload.data?.length ?? 0);
    }
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
        setError("Interview prep could not be saved in this environment.");
        return;
      }
      setLatestPack(payload.data.pack);
      setStatus(
        `Prep pack ready · ${payload.data.pack.behavioral_questions.length} questions · ${payload.data.pack.technical_review_topics.length} review topics`,
      );
      void loadRecentPacks();
    });
  }

  const selectedJob = jobs.find((job) => job.id === selectedJobId);
  const disabledReason = !selectedJobId
    ? "Analyze a JD in Jobs before creating an interview prep pack."
    : null;
  const prerequisites = [
    {
      label: "Analyzed JD required",
      detail: selectedJob
        ? `${selectedJob.requirementCount} requirements available`
        : "Create or select a JD Analysis workspace first.",
      ready: Boolean(selectedJob),
    },
    {
      label: "Approved evidence recommended",
      detail:
        approvedEvidenceCount > 0
          ? `${approvedEvidenceCount} approved evidence items available`
          : "Improves answer grounding and weak-area detection.",
      ready: approvedEvidenceCount > 0,
      optional: true,
    },
    {
      label: "STAR stories recommended",
      detail:
        starStoryCount > 0
          ? `${starStoryCount} STAR-ready story candidates available`
          : "Used for behavioral question story matching.",
      ready: starStoryCount > 0,
      optional: true,
    },
    {
      label: "Tailored resume optional",
      detail:
        tailoredResumeCount > 0
          ? `${tailoredResumeCount} tailored resume versions available`
          : "Useful for checking likely resume follow-up questions.",
      ready: tailoredResumeCount > 0,
      optional: true,
    },
  ];

  return (
    <section className="workspace__grid workspace__grid--interview">
      <div className="panel panel--control">
        <div className="panel__header">
          <div>
            <h2 className="panel__title">Interview Prep Setup</h2>
            <p className="panel__note">
              Build from one analyzed JD. Evidence and STAR stories make the plan stronger.
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
        <div className="prep-prereq-list" aria-label="Interview prep prerequisites">
          {prerequisites.map((item) => (
            <div className="prep-prereq" data-ready={item.ready} key={item.label}>
              <span>{item.ready ? "Ready" : item.optional ? "Recommended" : "Required"}</span>
              <div>
                <strong>{item.label}</strong>
                <p>{item.detail}</p>
              </div>
            </div>
          ))}
        </div>
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
            {error ?? disabledReason ?? status}
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
            <h2 className="panel__title">Prep Pack Output</h2>
            <p className="panel__note">
              Themes, questions, story recommendations, and weak areas for the selected role.
            </p>
          </div>
        </div>
        {latestPack ? <PrepPackView pack={latestPack} /> : <EmptyPrepState hasJobs={jobs.length > 0} />}
      </div>
    </section>
  );
}

function PrepPackView({ pack }: { pack: InterviewPrepPack }) {
  const likelyThemes = buildLikelyThemes(pack);
  const storyRecommendations = pack.behavioral_questions
    .filter((question) => question.recommended_story_title)
    .slice(0, 4);
  const jdChecklist = [
    ...pack.technical_review_topics.slice(0, 3).map((topic) => topic.practice_prompt),
    ...pack.company_research_prompts.slice(0, 3),
  ];
  return (
    <div className="result-stack">
      <section className="job-facts">
        <div className="chip-row">
          <span className="chip">{pack.job_snapshot.role_title ?? "target role"}</span>
          <span className="chip">{pack.job_snapshot.role_archetype}</span>
          <span className="chip">{pack.status}</span>
          <span className="chip">{pack.retrieved_context.length} supporting notes</span>
        </div>
      </section>
      <section className="section-block prep-summary-grid">
        <div>
          <h3>Likely interview themes</h3>
          <ul>
            {likelyThemes.map((theme) => (
              <li key={theme}>{theme}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3>Weak areas to review</h3>
          <ul>
            {(pack.evidence_gaps.length > 0
              ? pack.evidence_gaps
              : ["Add more approved evidence and STAR-ready material."]
            )
              .slice(0, 5)
              .map((gap) => (
                <li key={gap}>{gap}</li>
              ))}
          </ul>
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
      {storyRecommendations.length > 0 ? (
        <section className="section-block">
          <h3>STAR story recommendations</h3>
          <div className="result-stack result-stack--inner">
            {storyRecommendations.map((question) => (
              <article className="requirement" key={`${question.question}-${question.recommended_story_title}`}>
                <div className="requirement__top">
                  <p className="requirement__text">{question.recommended_story_title}</p>
                  <span className="requirement__type">{question.focus}</span>
                </div>
                <p className="requirement__quote">{question.question}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      <section className="section-block">
        <h3>Company / JD-specific prep checklist</h3>
        <div className="result-stack result-stack--inner">
          {jdChecklist.slice(0, 6).map((item) => (
            <article className="requirement" key={item}>
              <p className="requirement__text">{item}</p>
            </article>
          ))}
        </div>
      </section>
      <SectionList title="Practice plan" items={pack.practice_plan} />
    </div>
  );
}

function buildLikelyThemes(pack: InterviewPrepPack) {
  const themes = [
    ...pack.behavioral_questions.map((question) => question.focus),
    ...pack.technical_review_topics.map((topic) => topic.topic),
  ];
  return Array.from(new Set(themes.filter(Boolean))).slice(0, 6);
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

function EmptyPrepState({ hasJobs }: { hasJobs: boolean }) {
  return (
    <div className="empty-state empty-state--compact prep-empty-state">
      <strong>{hasJobs ? "Select a role and create a prep pack." : "No analyzed JD yet."}</strong>
      <p>
        {hasJobs
          ? "The output will show likely themes, behavioral questions, STAR story matches, a JD-specific checklist, and weak areas."
          : "Go to Jobs, analyze a JD, then return here to generate interview prep."}
      </p>
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
