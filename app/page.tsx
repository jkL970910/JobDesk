"use client";

import { useEffect, useMemo, useState } from "react";

import { ApplicationTrackerWorkspace } from "../src/components/application-tracker-workspace";
import { InterviewPrepWorkspace } from "../src/components/interview-prep-workspace";
import { JdAnalysisWorkspace } from "../src/components/jd-analysis-workspace";
import {
  ProfileEvidenceWorkspace,
  type MaterialEntryIntent,
} from "../src/components/profile-evidence-workspace";
import { ResumeReviewWorkspace } from "../src/components/resume-review-workspace";
import { TailoredResumeWorkspace } from "../src/components/tailored-resume-workspace";
import { useAccess } from "../src/components/access-provider";

type View =
  | "dashboard"
  | "profile"
  | "resumeReview"
  | "evidence"
  | "jobs"
  | "applications"
  | "interview"
  | "recommendations"
  | "growth"
  | "settings";

type NavGroup = {
  label: string;
  items: Array<{
    id: View;
    label: string;
    hint: string;
    status: "live" | "partial" | "planned";
  }>;
};

type EvidenceLibrarySummary = {
  profile: {
    displayName: string | null;
    updatedAt: string;
    profile?: Record<string, unknown> | null;
  } | null;
  evidenceItems: Array<{
    id: string;
    status: string;
    evidence_type: string;
    sensitivity_level: string;
    allowed_usage: string[];
    needs_user_confirmation?: boolean;
  }>;
  workExperiences: Array<{ id: string; status: string }>;
  initiatives: Array<{ id: string; status: string }>;
  portfolioProjects: Array<{ id: string; status: string }>;
  projectCards: Array<{ id: string; status: string }>;
};

type ResumeReviewSummary = {
  id: string;
  title: string;
  status: string;
  latestReview: { overallScore: number } | null;
};

type MainResumeSummary = {
  id: string;
  title: string;
  resume_markdown: string;
  missing_evidence_questions: string[];
  status: string;
  updatedAt: string;
  claims: Array<{
    id: string;
    claim_text: string;
    support_status: string;
    claim_status: string;
    risk_level: string;
  }>;
};

type RecentJobSummary = {
  id: string;
  title: string;
  application_status?: string;
  requirementCount: number;
};

type SystemDiagnostics = {
  db: {
    configured: boolean;
    connected: boolean;
  };
  ai: {
    providerEnabled: boolean;
    apiKeyConfigured: boolean;
    transport: string;
    model: string;
    endpointHost: string;
    responseStorageEnabled: boolean;
  };
  skills: {
    registryEntries: number;
    runtimeSkillIds: string[];
  };
  workflows: {
    latest: Array<{
      id: string;
      workflowType: string;
      status: string;
      skillId: string | null;
      promptVersion: string | null;
      model: string | null;
      finishedAt: string | null;
    }>;
    failedCount: number;
    lastFinishedAt: string | null;
  };
};

type InterviewPrepSummary = {
  id?: string;
  status: string;
};

type ResumePrepWorkflowState =
  | "no_resume"
  | "resume_uploaded"
  | "resume_reviewed"
  | "evidence_extracted"
  | "claims_review_pending"
  | "evidence_enriched"
  | "profile_ready";

const navGroups: NavGroup[] = [
  {
    label: "Workspace",
    items: [
      {
        id: "dashboard",
        label: "Dashboard",
        hint: "Command center",
        status: "partial",
      },
      {
        id: "profile",
        label: "Profile",
        hint: "Career facts",
        status: "partial",
      },
      {
        id: "resumeReview",
        label: "Resume Review",
        hint: "General score",
        status: "live",
      },
      {
        id: "evidence",
        label: "Evidence Library",
        hint: "Reusable material",
        status: "live",
      },
    ],
  },
  {
    label: "Job Search",
    items: [
      {
        id: "jobs",
        label: "Jobs",
        hint: "JD workspace",
        status: "live",
      },
      {
        id: "applications",
        label: "Applications",
        hint: "Manual tracker",
        status: "live",
      },
      {
        id: "recommendations",
        label: "Recommendations",
        hint: "Future scout",
        status: "planned",
      },
    ],
  },
  {
    label: "Interview",
    items: [
      {
        id: "interview",
        label: "Interview Prep",
        hint: "Grounded practice",
        status: "live",
      },
      {
        id: "growth",
        label: "Growth Profile",
        hint: "Future feedback loop",
        status: "planned",
      },
    ],
  },
];

const statusLabel = {
  live: "Live",
  partial: "MVP",
  planned: "Planned",
} satisfies Record<NavGroup["items"][number]["status"], string>;

const pageCopy = {
  dashboard: {
    eyebrow: "Overview",
    title: "Dashboard",
    subtitle:
      "Your job-search command center: prepare material, create job workspaces, tailor resumes, prep interviews, and track outcomes.",
  },
  profile: {
    eyebrow: "Career Identity",
    title: "Profile",
    subtitle:
      "Your factual career skeleton: identity, experience frame, skills, source coverage, and resume versions.",
  },
  resumeReview: {
    eyebrow: "General Resume",
    title: "Resume Review",
    subtitle:
      "Upload, score, and version a general resume before extracting reusable evidence into the material library.",
  },
  evidence: {
    eyebrow: "Material Library",
    title: "Evidence Library",
    subtitle:
      "Choose resume-first, material-first, or JD-first intake; turn thin source signals into project stories and source-backed evidence claims.",
  },
  jobs: {
    eyebrow: "Job Workspace",
    title: "Jobs",
    subtitle:
      "Analyze a target JD, generate a grounded tailored resume, review claim support, and keep the role-specific workflow together.",
  },
  applications: {
    eyebrow: "Application CRM",
    title: "Applications",
    subtitle:
      "Move analyzed jobs through the canonical manual application pipeline without pretending email or auto-apply integrations exist yet.",
  },
  interview: {
    eyebrow: "Interview Intelligence",
    title: "Interview Prep",
    subtitle:
      "Generate role-specific prep packs from the selected JD, approved evidence, STAR stories, and retrieval context.",
  },
  recommendations: {
    eyebrow: "Job Scout",
    title: "Recommendations",
    subtitle:
      "A future job-scout surface for relevant roles, fit explanations, and create-workspace actions.",
  },
  growth: {
    eyebrow: "Feedback Loop",
    title: "Growth Profile",
    subtitle:
      "A future feedback loop for interview reviews, recurring gaps, and practice priorities.",
  },
  settings: {
    eyebrow: "System",
    title: "Settings",
    subtitle:
      "Personal workspace settings for access, AI configuration, storage, and future integrations.",
  },
} satisfies Record<View, { eyebrow: string; title: string; subtitle: string }>;

export default function HomePage() {
  const [activeView, setActiveView] = useState<View>("dashboard");
  const [materialEntryIntent, setMaterialEntryIntent] =
    useState<MaterialEntryIntent>("resume");
  const [materialInitialSection, setMaterialInitialSection] =
    useState<"review" | "intake">("review");
  const [selectedResumeSourceVersionId, setSelectedResumeSourceVersionId] =
    useState<string | null>(null);
  const activeCopy = pageCopy[activeView];
  const activeStatus = useMemo(() => findStatus(activeView), [activeView]);
  function navigateToMaterial(intent: MaterialEntryIntent) {
    if (intent === "resume") {
      setActiveView("resumeReview");
      return;
    }
    if (intent === "jd") {
      setActiveView("jobs");
      return;
    }
    setMaterialEntryIntent(intent);
    setMaterialInitialSection("intake");
    setActiveView("evidence");
  }
  function extractResumeToEvidence(resumeSourceVersionId: string) {
    setSelectedResumeSourceVersionId(resumeSourceVersionId);
    setMaterialEntryIntent("resume");
    setMaterialInitialSection("intake");
    setActiveView("evidence");
  }
  function navigateToView(view: View) {
    if (view === "evidence") {
      setMaterialInitialSection("review");
    }
    setActiveView(view);
  }

  return (
    <main className="jobdesk-shell">
      <aside className="app-sidebar" aria-label="JobDesk navigation">
        <div className="app-sidebar__brand">
          <div className="app-sidebar__mark">J</div>
          <div>
            <p className="app-sidebar__name">JobDesk</p>
            <p className="app-sidebar__caption">Career copilot</p>
          </div>
        </div>

        <nav className="app-sidebar__nav">
          {navGroups.map((group) => (
            <section className="app-sidebar__group" key={group.label}>
              <p className="app-sidebar__group-label">{group.label}</p>
              {group.items.map((item) => (
                <button
                  aria-current={item.id === activeView ? "page" : undefined}
                  aria-label={item.label}
                  className="app-sidebar__item"
                  data-active={item.id === activeView}
                  data-status={item.status}
                  key={item.id}
                  onClick={() => navigateToView(item.id)}
                  type="button"
                >
                  <i aria-hidden="true">{item.label.slice(0, 1)}</i>
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.hint}</small>
                  </span>
                  <em aria-hidden="true" data-status={item.status}>{statusLabel[item.status]}</em>
                </button>
              ))}
            </section>
          ))}
        </nav>

        <button
          aria-current={activeView === "settings" ? "page" : undefined}
          aria-label="Settings"
          className="app-sidebar__settings"
          data-active={activeView === "settings"}
          onClick={() => navigateToView("settings")}
          type="button"
        >
          <i aria-hidden="true">S</i>
          Settings
          <span aria-hidden="true">{statusLabel[findStatus("settings")]}</span>
        </button>
      </aside>

      <section className="app-content">
        <header className="app-content__header">
          <div>
            <p className="app-content__eyebrow">{activeCopy.eyebrow}</p>
            <h1>{activeCopy.title}</h1>
            <p>{activeCopy.subtitle}</p>
          </div>
          <div className="reference-card">
            <span>Page Status</span>
            <strong>{statusLabel[activeStatus]}</strong>
            <small>
              {activeStatus === "live"
                ? "Backed by current JobDesk data"
                : activeStatus === "partial"
                  ? "Useful now, still evolving"
                  : "Planned surface"}
            </small>
            <em aria-hidden="true" data-status={activeStatus}>{statusLabel[activeStatus]}</em>
          </div>
        </header>

        <div className="app-content__body">
          {activeView === "dashboard" ? (
            <DashboardView
              onNavigate={setActiveView}
              onStartMaterialPath={navigateToMaterial}
            />
          ) : null}
          {activeView === "profile" ? (
            <ProfileReferenceView onNavigate={setActiveView} />
          ) : null}
          {activeView === "resumeReview" ? (
            <ResumeReviewWorkspace onExtractToEvidence={extractResumeToEvidence} />
          ) : null}
          {activeView === "evidence" ? (
            <ProfileEvidenceWorkspace
              entryIntent={materialEntryIntent}
              initialSection={materialInitialSection}
              initialResumeSourceVersionId={selectedResumeSourceVersionId}
            />
          ) : null}
          {activeView === "jobs" ? <JobsWorkspaceView /> : null}
          {activeView === "applications" ? <ApplicationTrackerWorkspace /> : null}
          {activeView === "interview" ? <InterviewPrepWorkspace /> : null}
          {activeView === "recommendations" ? (
            <PlannedReferenceView
              title="Recommendations"
              description="This final reference surface will rank and explain relevant jobs from configured sources. It should use profile goals, evidence coverage, job freshness, legitimacy checks, and user dismiss/save behavior once implemented."
              nextSteps={[
                "Define job source connectors and freshness policy.",
                "Add recommendation ranking service and persisted decisions.",
                "Render fit reasons, risk notes, and create-workspace actions from real data.",
              ]}
            />
          ) : null}
          {activeView === "growth" ? (
            <PlannedReferenceView
              title="Growth Profile"
              description="This final reference surface will summarize interview reviews and recurring gaps from explicit interview notes and review sessions."
              nextSteps={[
                "Add interview review schema and saved feedback entries.",
                "Aggregate recurring strengths, weaknesses, and knowledge gaps.",
                "Connect recommended practice tasks back to Interview Prep.",
              ]}
            />
          ) : null}
          {activeView === "settings" ? <SettingsReferenceView /> : null}
        </div>
      </section>
    </main>
  );
}

function findStatus(view: View): "live" | "partial" | "planned" {
  if (view === "settings") return "partial";
  for (const group of navGroups) {
    const item = group.items.find((candidate) => candidate.id === view);
    if (item) return item.status;
  }
  return "planned";
}

function DashboardView({
  onNavigate,
  onStartMaterialPath,
}: {
  onNavigate: (view: View) => void;
  onStartMaterialPath: (intent: MaterialEntryIntent) => void;
}) {
  const { fetchJson } = useAccess();
  const [library, setLibrary] = useState<EvidenceLibrarySummary | null>(null);
  const [resumes, setResumes] = useState<ResumeReviewSummary[]>([]);
  const [jobs, setJobs] = useState<RecentJobSummary[]>([]);
  const [prepPacks, setPrepPacks] = useState<InterviewPrepSummary[]>([]);
  const [dashboardLoadState, setDashboardLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [showLaterWorkflows, setShowLaterWorkflows] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadDashboardData() {
      setDashboardLoadState((current) => (current === "ready" ? current : "loading"));
      const [libraryResponse, resumeResponse, jobsResponse, prepResponse] = await Promise.allSettled([
        fetchJson("/api/profile-evidence/recent"),
        fetchJson("/api/resume-review"),
        fetchJson("/api/jobs/recent"),
        fetchJson("/api/interview-prep/recent"),
      ]);
      if (cancelled) return;
      if (libraryResponse.status === "fulfilled" && libraryResponse.value.ok) {
        const payload = (await libraryResponse.value.json()) as { data?: EvidenceLibrarySummary | null };
        setLibrary(payload.data ?? null);
      }
      if (resumeResponse.status === "fulfilled" && resumeResponse.value.ok) {
        const payload = (await resumeResponse.value.json()) as {
          data?: { resumes?: ResumeReviewSummary[] };
        };
        setResumes(payload.data?.resumes ?? []);
      }
      if (jobsResponse.status === "fulfilled" && jobsResponse.value.ok) {
        const payload = (await jobsResponse.value.json()) as { data?: RecentJobSummary[] };
        setJobs(payload.data ?? []);
      }
      if (prepResponse.status === "fulfilled" && prepResponse.value.ok) {
        const payload = (await prepResponse.value.json()) as { data?: InterviewPrepSummary[] };
        setPrepPacks(payload.data ?? []);
      }
      const loadedAny =
        (libraryResponse.status === "fulfilled" && libraryResponse.value.ok) ||
        (resumeResponse.status === "fulfilled" && resumeResponse.value.ok) ||
        (jobsResponse.status === "fulfilled" && jobsResponse.value.ok) ||
        (prepResponse.status === "fulfilled" && prepResponse.value.ok);
      setDashboardLoadState(loadedAny ? "ready" : "error");
    }
    function refreshDashboardData() {
      void loadDashboardData();
    }
    void loadDashboardData();
    window.addEventListener("jobdesk:evidence-library-updated", refreshDashboardData);
    window.addEventListener("jobdesk:jobs-updated", refreshDashboardData);
    return () => {
      cancelled = true;
      window.removeEventListener("jobdesk:evidence-library-updated", refreshDashboardData);
      window.removeEventListener("jobdesk:jobs-updated", refreshDashboardData);
    };
  }, [fetchJson]);

  const latestResume = resumes[0] ?? null;
  const approvedClaims =
    library?.evidenceItems.filter((item) => item.status === "approved").length ?? 0;
  const resumeReadyClaims = countResumeReadyClaims(library?.evidenceItems ?? []);
  const claimsNeedingReview =
    library?.evidenceItems.filter((item) => !isResumeReadyClaim(item)).length ?? 0;
  const storyTargets =
    (library?.initiatives.length ?? 0) + (library?.portfolioProjects.length ?? 0);
  const thinStories =
    (library?.initiatives.filter((item) => item.status !== "approved").length ?? 0) +
    (library?.portfolioProjects.filter((item) => item.status !== "approved").length ?? 0);
  const hasExtractedMaterial = hasResumePrepMaterial({
    claimsNeedingReview,
    library,
    resumeReadyClaims,
    storyTargets,
  });
  const activeApplications = jobs.filter((job) =>
    ["applied", "responded", "interview", "offer"].includes(job.application_status ?? ""),
  ).length;
  const interviewJobs = jobs.filter((job) => job.application_status === "interview").length;
  const resumePrepState = getResumePrepWorkflowState({
    approvedClaims: resumeReadyClaims,
    claimsNeedingReview,
    latestResume,
    library,
    storyTargets,
    thinStories,
  });
  const workflowRows = [
    {
      label: "1. Review resume",
      value: latestResume
        ? latestResume.latestReview
          ? `Score ${latestResume.latestReview.overallScore}`
          : "Needs review"
        : hasExtractedMaterial
          ? "Source extracted"
          : "Not uploaded",
      note: latestResume
        ? formatResumeTitle(latestResume.title)
        : hasExtractedMaterial
          ? `${library?.profile?.displayName ?? "Evidence Library"} has extracted material.`
          : "Upload a general resume first.",
      action: latestResume ? "Review findings" : "Upload resume",
      view: "resumeReview" as View,
      state: latestResume?.latestReview || hasExtractedMaterial ? "ready" : "blocked",
      phase: "primary",
    },
    {
      label: "2. Build evidence library",
      value:
        resumeReadyClaims > 0
          ? `${resumeReadyClaims} resume-ready claims`
          : claimsNeedingReview > 0
            ? `${claimsNeedingReview} claims await approval`
            : hasExtractedMaterial
              ? "Evidence extracted"
              : "No extracted evidence yet",
      note:
        claimsNeedingReview > 0
          ? `${claimsNeedingReview} claims awaiting review · ${storyTargets} story targets`
          : storyTargets > 0
            ? `${storyTargets} story targets need enrichment`
            : "Extract resume evidence before JD-specific work.",
      action: "Open library",
      view: "evidence" as View,
      state: resumeReadyClaims > 0 ? "ready" : hasExtractedMaterial ? "needs-review" : "blocked",
      phase: "primary",
    },
    {
      label: "3. Analyze JD",
      value: `${jobs.length} analyzed`,
      note: jobs[0]?.title ?? "Create a job workspace from a target JD.",
      action: "Open JD workspace",
      view: "jobs" as View,
      state: jobs.length > 0 ? "ready" : "blocked",
      phase: resumeReadyClaims > 0 ? "primary" : "secondary",
    },
    {
      label: "4. Tailor resume",
      value: resumeReadyClaims > 0 && jobs.length > 0 ? "Ready" : "Blocked",
      note:
        resumeReadyClaims > 0 && jobs.length > 0
          ? "Use resume-ready evidence against a JD."
          : "Needs analyzed JD and resume-ready evidence.",
      action: "Open resume",
      view: "jobs" as View,
      state: resumeReadyClaims > 0 && jobs.length > 0 ? "ready" : "blocked",
      phase: resumeReadyClaims > 0 && jobs.length > 0 ? "primary" : "secondary",
    },
    {
      label: "5. Prepare interview",
      value: prepPacks.length > 0 ? "Ready" : jobs.length > 0 ? "Available" : "Blocked",
      note: prepPacks.length > 0 ? `${prepPacks.length} prep packs saved` : "Requires an analyzed JD.",
      action: "Open prep",
      view: "interview" as View,
      state: jobs.length > 0 ? "ready" : "blocked",
      phase: resumeReadyClaims > 0 && jobs.length > 0 ? "primary" : "secondary",
    },
    {
      label: "6. Track application",
      value: `${activeApplications} active`,
      note: `${interviewJobs} interview-stage jobs`,
      action: "Open tracker",
      view: "applications" as View,
      state: jobs.length > 0 ? "ready" : "blocked",
      phase: jobs.length > 0 ? "primary" : "secondary",
    },
  ];
  const nextAction = determineDashboardNextAction({
    latestResume,
    state: resumePrepState,
  });
  const displayNextAction =
    dashboardLoadState === "loading"
      ? {
          detail: "Checking Resume Review and Evidence Library before recommending the next action.",
          label: "Loading workspace",
          title: "Loading workspace state.",
          view: "dashboard" as View,
        }
      : nextAction;
  const resumePrepRows =
    dashboardLoadState === "loading"
      ? [
          {
            action: "Checking",
            label: "1. Review resume",
            note: "Checking the latest Resume Review state.",
            phase: "primary",
            state: "needs-review",
            value: "Loading",
            view: "dashboard" as View,
          },
          {
            action: "Checking",
            label: "2. Build evidence library",
            note: "Checking extracted evidence and story targets.",
            phase: "primary",
            state: "needs-review",
            value: "Loading",
            view: "dashboard" as View,
          },
        ]
      : workflowRows.slice(0, 2);
  const laterWorkflowRows = workflowRows.slice(2);
  const summaryCards =
    dashboardLoadState === "loading"
      ? [
          {
            label: "Material readiness",
            note: "Checking resume and evidence state.",
            value: "Loading",
          },
          {
            label: "Project context",
            note: "Checking story targets.",
            value: "Loading",
          },
          {
            label: "Active jobs",
            note: "Checking job workspaces.",
            value: "Loading",
          },
          {
            label: "Application pipeline",
            note: "Checking application states.",
            value: "Loading",
          },
        ]
      : [
          {
            label: "Material readiness",
            value:
              resumeReadyClaims > 0
                ? `${resumeReadyClaims} resume-ready claims`
                : claimsNeedingReview > 0
                  ? `${claimsNeedingReview} claims await approval`
                  : hasExtractedMaterial
                    ? "Evidence extracted"
                    : "No extracted evidence yet",
            note:
              resumeReadyClaims > 0
                ? "Reusable resume material is available"
                : hasExtractedMaterial
                  ? "Review claims before using this material"
                  : "Resume evidence is not ready yet",
          },
          {
            label: "Project context",
            value:
              storyTargets > 0
                ? thinStories > 0
                  ? `${thinStories} thin signals`
                  : "Stories enriched"
                : "No story targets yet",
            note: storyTargets > 0 ? "Project/source docs can improve this" : "Extract evidence first",
          },
          {
            label: "Active jobs",
            value: String(jobs.length),
            note: resumeReadyClaims > 0 ? "analyzed workspaces" : "Later workflow until evidence is ready",
          },
          {
            label: "Application pipeline",
            value: String(activeApplications),
            note: jobs.length > 0 ? "active applications" : "Starts after JD analysis",
          },
        ];
  const entryPaths = [
    {
      action: "Start with resume",
      body:
        "Upload a current resume, review its weak spots, then extract thin project/evidence signals for enrichment.",
      intent: "resume" as const,
      title: "I have a resume",
    },
    {
      action: "Add source docs",
      body:
        "Add design docs, project summaries, performance notes, or guided answers to create or enrich story material.",
      intent: "scratch" as const,
      title: "Project/source docs",
    },
    {
      action: "Analyze JD",
      body:
        "Create a quick job workspace now; missing evidence becomes follow-up work for the library.",
      intent: "jd" as const,
      title: "I have a JD now",
    },
  ];

  return (
    <div className="dashboard-grid">
      <section className="command-center">
        <article className="next-action-card">
          <p className="panel-kicker">Next best action</p>
          <h2>{displayNextAction.title}</h2>
          <p>{displayNextAction.detail}</p>
          <button
            disabled={dashboardLoadState === "loading"}
            type="button"
            onClick={() => onNavigate(displayNextAction.view)}
          >
            {displayNextAction.label}
          </button>
        </article>

        <div className="workflow-rail" aria-label="Current workflow readiness">
          {resumePrepRows.map((row) => (
            <article
              className="workflow-row"
              data-phase={row.phase}
              data-state={row.state}
              key={row.label}
            >
              <div>
                <span>{row.label}</span>
                <p>{row.note}</p>
              </div>
              <strong>{row.value}</strong>
              <button
                disabled={dashboardLoadState === "loading"}
                type="button"
                onClick={() => onNavigate(row.view)}
              >
                {row.action}
              </button>
            </article>
          ))}
          <section className="workflow-later" data-open={showLaterWorkflows}>
            <button
              aria-controls="dashboard-later-workflows"
              aria-expanded={showLaterWorkflows}
              className="workflow-later__toggle"
              type="button"
              onClick={() => setShowLaterWorkflows((current) => !current)}
            >
              Later workflows
            </button>
            {showLaterWorkflows ? (
              <div id="dashboard-later-workflows">
              {laterWorkflowRows.map((row) => (
                <article
                  className="workflow-row"
                  data-phase="secondary"
                  data-state={row.state}
                  key={row.label}
                >
                  <div>
                    <span>{row.label}</span>
                    <p>{row.note}</p>
                  </div>
                  <strong>{row.value}</strong>
                  <button
                    aria-label={`${row.action}: ${row.label}`}
                    type="button"
                    onClick={() => onNavigate(row.view)}
                  >
                    {row.action}
                  </button>
                </article>
              ))}
              </div>
            ) : null}
          </section>
        </div>
      </section>

      <section className="status-board dashboard-summary" aria-label="Workspace readiness summary">
        {summaryCards.map((card) => (
          <article className="status-card" key={card.label}>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            <p>{card.note}</p>
          </article>
        ))}
      </section>

      <section className="entry-path-board" aria-label="Start JobDesk workflow">
        {entryPaths.map((path) => (
          <article data-phase={path.intent === "resume" || hasExtractedMaterial || resumeReadyClaims > 0 ? "primary" : "secondary"} key={path.intent}>
            <span>{path.title}</span>
            <p>{path.body}</p>
            <button type="button" onClick={() => onStartMaterialPath(path.intent)}>
              {path.action}
            </button>
          </article>
        ))}
      </section>
    </div>
  );
}

function determineDashboardNextAction({
  latestResume,
  state,
}: {
  latestResume: ResumeReviewSummary | null;
  state: ResumePrepWorkflowState;
}) {
  if (state === "no_resume") {
    return {
      detail: "Upload a general resume before building reusable evidence.",
      label: "Upload Resume",
      title: "Upload or review a resume.",
      view: "resumeReview" as View,
    };
  }
  if (state === "resume_uploaded") {
    return {
      detail: `${latestResume ? formatResumeTitle(latestResume.title) : "The resume"} is saved but still needs review findings.`,
      label: "Review Findings",
      title: "Review the saved resume.",
      view: "resumeReview" as View,
    };
  }
  if (state === "resume_reviewed") {
    return {
      detail: "The resume is reviewed; extract it into source-backed claims and story targets.",
      label: "Extract evidence now",
      title: "Extract reviewed resume evidence.",
      view: "resumeReview" as View,
    };
  }
  if (state === "claims_review_pending" || state === "evidence_extracted") {
    return {
      detail: "Claims and story targets need review before resume generation is trustworthy.",
      label: "Enrich Evidence",
      title: "Review and enrich the Evidence Library.",
      view: "evidence" as View,
    };
  }
  return {
    detail: "Reusable evidence is available. You can now move into JD-specific work.",
    label: "Open Evidence Library",
    title: "Material is ready for the next workflow.",
    view: "evidence" as View,
  };
}

function getResumePrepWorkflowState({
  approvedClaims,
  claimsNeedingReview,
  latestResume,
  library,
  storyTargets,
  thinStories,
}: {
  approvedClaims: number;
  claimsNeedingReview: number;
  latestResume: ResumeReviewSummary | null;
  library: EvidenceLibrarySummary | null;
  storyTargets: number;
  thinStories: number;
}): ResumePrepWorkflowState {
  const hasExtractedMaterial = hasResumePrepMaterial({
    claimsNeedingReview,
    library,
    resumeReadyClaims: approvedClaims,
    storyTargets,
  });
  if (hasExtractedMaterial) {
    if (claimsNeedingReview > 0) return "claims_review_pending";
    if (thinStories > 0) return "evidence_extracted";
    if (approvedClaims > 0 && storyTargets > 0) {
      return library?.profile ? "profile_ready" : "evidence_enriched";
    }
    return "evidence_extracted";
  }
  if (!latestResume) return "no_resume";
  const hasReview = Boolean(latestResume.latestReview);
  if (!hasReview) return "resume_uploaded";
  return "resume_reviewed";
}

function hasResumePrepMaterial({
  claimsNeedingReview,
  library,
  resumeReadyClaims,
  storyTargets,
}: {
  claimsNeedingReview: number;
  library: EvidenceLibrarySummary | null;
  resumeReadyClaims: number;
  storyTargets: number;
}) {
  return Boolean(library?.profile) || storyTargets > 0 || resumeReadyClaims > 0 || claimsNeedingReview > 0;
}

function countResumeReadyClaims(
  evidenceItems: EvidenceLibrarySummary["evidenceItems"],
) {
  return evidenceItems.filter(isResumeReadyClaim).length;
}

function isResumeReadyClaim(item: EvidenceLibrarySummary["evidenceItems"][number]) {
  return (
    item.status === "approved" &&
    item.allowed_usage.includes("resume") &&
    !item.needs_user_confirmation
  );
}

function formatResumePrepState(state: ResumePrepWorkflowState) {
  const copy = {
    claims_review_pending: "Claims review pending",
    evidence_enriched: "Evidence enriched",
    evidence_extracted: "Evidence extracted",
    no_resume: "No resume uploaded",
    profile_ready: "Profile ready",
    resume_reviewed: "Resume reviewed",
    resume_uploaded: "Resume uploaded",
  } satisfies Record<ResumePrepWorkflowState, string>;
  return copy[state];
}

function ProfileReferenceView({ onNavigate }: { onNavigate: (view: View) => void }) {
  const { fetchJson } = useAccess();
  const [library, setLibrary] = useState<EvidenceLibrarySummary | null>(null);
  const [resumes, setResumes] = useState<ResumeReviewSummary[]>([]);
  const [mainResumes, setMainResumes] = useState<MainResumeSummary[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [mainResumeStatus, setMainResumeStatus] = useState<string | null>(null);
  const [isGeneratingMainResume, setIsGeneratingMainResume] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadProfileSurface() {
      setLoadState("loading");
      try {
        const [libraryResult, resumesResult, mainResumesResult] = await Promise.allSettled([
          fetchJson("/api/profile-evidence/recent"),
          fetchJson("/api/resume-review"),
          fetchJson("/api/main-resume"),
        ]);
        if (cancelled) return;
        const hasLibrary = libraryResult.status === "fulfilled" && libraryResult.value.ok;
        const hasResumes = resumesResult.status === "fulfilled" && resumesResult.value.ok;
        const hasMainResumes =
          mainResumesResult.status === "fulfilled" && mainResumesResult.value.ok;
        if (!hasLibrary && !hasResumes && !hasMainResumes) {
          setLoadState("error");
          return;
        }
        const libraryPayload = hasLibrary
          ? ((await libraryResult.value.json()) as { data?: EvidenceLibrarySummary })
          : null;
        const resumePayload = hasResumes
          ? ((await resumesResult.value.json()) as { data?: { resumes?: ResumeReviewSummary[] } })
          : null;
        const mainResumePayload = hasMainResumes
          ? ((await mainResumesResult.value.json()) as {
              data?: { resumes?: MainResumeSummary[] };
            })
          : null;
        if (cancelled) return;
        if (libraryPayload) setLibrary(libraryPayload.data ?? null);
        if (resumePayload) setResumes(resumePayload.data?.resumes ?? []);
        if (mainResumePayload) setMainResumes(mainResumePayload.data?.resumes ?? []);
        setLoadState("ready");
      } catch {
        if (!cancelled) setLoadState("error");
      }
    }

    void loadProfileSurface();
    return () => {
      cancelled = true;
    };
  }, [fetchJson]);

  const resumeEligibleEvidence =
    countResumeReadyClaims(library?.evidenceItems ?? []);
  const latestResume = resumes[0] ?? null;
  const storyTargets =
    (library?.initiatives.length ?? 0) + (library?.portfolioProjects.length ?? 0);
  const thinStories =
    (library?.initiatives.filter((item) => item.status !== "approved").length ?? 0) +
    (library?.portfolioProjects.filter((item) => item.status !== "approved").length ?? 0);
  const claimsNeedingReview =
    library?.evidenceItems.filter((item) => !isResumeReadyClaim(item)).length ?? 0;
  const resumePrepState = getResumePrepWorkflowState({
    approvedClaims: resumeEligibleEvidence,
    claimsNeedingReview,
    latestResume,
    library,
    storyTargets,
    thinStories,
  });
  const profileFacts = extractProfileFacts(library?.profile?.profile);
  const hasExtractedMaterial = hasResumePrepMaterial({
    claimsNeedingReview,
    library,
    resumeReadyClaims: resumeEligibleEvidence,
    storyTargets,
  });
  const displayedRoleCount = Math.max(
    profileFacts.experience.length,
    library?.workExperiences.length ?? 0,
  );
  const displayedEvidenceCount = library?.evidenceItems.length ?? 0;
  const displayedStoryCount = storyTargets;
  const profileDisplayName =
    library?.profile?.displayName ??
    (hasExtractedMaterial ? "Profile facts not promoted yet" : "Profile extraction pending");
  const extractionStatus = formatResumePrepState(resumePrepState);
  const latestMainResume = mainResumes[0] ?? null;
  const mainResumeReady = resumeEligibleEvidence > 0;

  async function generateMainResume() {
    setIsGeneratingMainResume(true);
    setMainResumeStatus("Generating main resume from resume-safe evidence...");
    try {
      const response = await fetchJson("/api/main-resume", {
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            data?: unknown;
            meta?: { persistence?: { status: string }; factGuard?: { status?: string } | null };
            error?: string;
            kind?: string;
          }
        | null;
      if (!response.ok) {
        setMainResumeStatus(
          payload?.error
            ? `${payload.error}${payload.kind ? ` (${payload.kind})` : ""}`
            : "Main resume generation failed.",
        );
        return;
      }
      const mainResumeResponse = await fetchJson("/api/main-resume");
      if (mainResumeResponse.ok) {
        const mainResumePayload = (await mainResumeResponse.json()) as {
          data?: { resumes?: MainResumeSummary[] };
        };
        setMainResumes(mainResumePayload.data?.resumes ?? []);
      }
      setMainResumeStatus(
        payload?.meta?.factGuard?.status === "validated"
          ? "Main resume generated and Fact Guard completed."
          : "Main resume generated. Review claim support before export.",
      );
    } catch (error) {
      setMainResumeStatus(
        error instanceof Error ? error.message : "Main resume generation failed.",
      );
    } finally {
      setIsGeneratingMainResume(false);
    }
  }

  if (loadState === "loading") {
    return (
      <div className="profile-reference">
        <section className="profile-card profile-card--loading" aria-busy="true">
          <p className="panel-kicker">Factual snapshot</p>
          <h2>Loading profile facts...</h2>
          <p>Checking Resume Review and Evidence Library before showing profile state.</p>
          <div className="profile-card__facts">
            <span>Contact loading</span>
            <span>Roles loading</span>
            <span>Skills loading</span>
            <span>Evidence loading</span>
          </div>
        </section>
        <section className="profile-live-summary" data-state="loading" aria-busy="true">
          <div className="profile-live-summary__header">
            <div>
              <p className="panel-kicker">Profile completeness</p>
              <h3>Loading workspace state</h3>
            </div>
            <span>loading</span>
          </div>
          <div className="profile-live-summary__grid">
            {["Contact", "Roles", "Education", "Skills"].map((label) => (
              <article key={label}>
                <span>{label}</span>
                <strong>Loading</strong>
                <p>Checking extracted profile facts.</p>
              </article>
            ))}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="profile-reference">
      <section className="profile-card">
        <p className="panel-kicker">Factual snapshot</p>
        <h2>{profileDisplayName}</h2>
        <p>{profileSnapshotCopy(resumePrepState)}</p>
        <div className="profile-card__facts">
          <span>{profileFacts.email ?? "Email pending"}</span>
          <span>{profileFacts.phone ?? "Phone pending"}</span>
          <span>{profileFacts.skills.length ? `${profileFacts.skills.length} skills` : "Skills pending"}</span>
          <span>{displayedRoleCount ? `${displayedRoleCount} roles` : "Roles pending"}</span>
        </div>
      </section>

      <section className="profile-live-summary" data-state={loadState}>
        <div className="profile-live-summary__header">
          <div>
            <p className="panel-kicker">Profile completeness</p>
            <h3>
              {extractionStatus}
            </h3>
          </div>
          <span>{loadState}</span>
        </div>
        <div className="profile-live-summary__grid">
          <article>
            <span>Contact</span>
            <strong>{profileFacts.name || profileFacts.email ? "Present" : "Pending"}</strong>
            <p>{[profileFacts.email, profileFacts.phone].filter(Boolean).join(" · ") || "Name, email, and phone are not fully extracted."}</p>
          </article>
          <article>
            <span>Roles</span>
            <strong>{displayedRoleCount}</strong>
            <p>{displayedRoleCount ? "Work history facts exist in the library." : "Work history pending extraction."}</p>
          </article>
          <article>
            <span>Education</span>
            <strong>{profileFacts.education.length}</strong>
            <p>{profileFacts.education.length ? "Education facts extracted." : "Education pending extraction."}</p>
          </article>
          <article>
            <span>Skills</span>
            <strong>{profileFacts.skills.length}</strong>
            <p>{profileFacts.skills.length ? "Skill signals extracted." : "Skills pending extraction."}</p>
          </article>
        </div>
      </section>

      <section className="profile-fact-grid">
        <article>
          <span>Contact facts</span>
          <strong>{profileFacts.name ?? library?.profile?.displayName ?? (hasExtractedMaterial ? "Pending promotion" : "Pending")}</strong>
          <p>{[profileFacts.email, profileFacts.phone].filter(Boolean).join(" · ") || "Run resume extraction to populate contact facts."}</p>
        </article>
        <article>
          <span>Roles</span>
          <strong>{displayedRoleCount ? `${displayedRoleCount} extracted` : "Pending"}</strong>
          <p>{profileFacts.experience.slice(0, 2).join(" · ") || (displayedRoleCount ? "Work experience records are present in Evidence Library." : "Extract a resume or source document to populate work history.")}</p>
        </article>
        <article>
          <span>Education</span>
          <strong>{profileFacts.education.length ? `${profileFacts.education.length} entries` : "Pending"}</strong>
          <p>{profileFacts.education.slice(0, 2).join(" · ") || "Education facts are not extracted yet."}</p>
        </article>
        <article>
          <span>Skills</span>
          <strong>{profileFacts.skills.length ? `${profileFacts.skills.length} signals` : "Pending"}</strong>
          <p>{profileFacts.skills.slice(0, 8).join(", ") || "Skills will appear after profile extraction."}</p>
        </article>
      </section>

      <section className="handoff-panel">
        <div>
          <p className="panel-kicker">Missing profile areas</p>
          <h3>{hasExtractedMaterial ? "Improve coverage from Evidence Library." : "Extract source material to populate Profile."}</h3>
          <p>
            {hasExtractedMaterial
              ? `${displayedEvidenceCount} evidence item${displayedEvidenceCount === 1 ? "" : "s"} and ${displayedStoryCount} story target${displayedStoryCount === 1 ? "" : "s"} exist. If facts look thin here, promote or enrich them from Evidence Library.`
              : "Profile stays read-only until Resume Review or Source Intake creates extracted facts."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onNavigate(resumePrepState === "no_resume" || resumePrepState === "resume_uploaded" ? "resumeReview" : "evidence")}
        >
          {resumePrepState === "no_resume" || resumePrepState === "resume_uploaded"
            ? "Open Resume Review"
            : "Open Evidence Library"}
        </button>
      </section>

      <section className="main-resume-builder">
        <div className="main-resume-builder__header">
          <div>
            <p className="panel-kicker">Main Resume Builder</p>
            <h3>Generate a reusable general resume from canonical evidence.</h3>
            <p>
              Uses profile facts plus resume-safe evidence. This is independent of
              any JD-tailored resume and includes a generated claim ledger for Fact Guard.
            </p>
          </div>
          <button
            className="primary-button"
            disabled={!mainResumeReady || isGeneratingMainResume}
            type="button"
            onClick={() => void generateMainResume()}
          >
            {isGeneratingMainResume ? "Generating..." : "Generate main resume"}
          </button>
        </div>
        <div className="main-resume-builder__metrics">
          <article>
            <span>Resume-safe evidence</span>
            <strong>{resumeEligibleEvidence}</strong>
            <p>{mainResumeReady ? "Ready for main resume generation." : "Approve resume-safe evidence first."}</p>
          </article>
          <article>
            <span>Latest main resume</span>
            <strong>{latestMainResume ? latestMainResume.status : "None"}</strong>
            <p>{latestMainResume ? formatDateTime(latestMainResume.updatedAt) : "No generated main resume yet."}</p>
          </article>
          <article>
            <span>Claim ledger</span>
            <strong>{latestMainResume?.claims.length ?? 0}</strong>
            <p>{latestMainResume ? "Claims map bullets to evidence." : "Generated with the first main resume."}</p>
          </article>
        </div>
        {mainResumeStatus ? <p className="status">{mainResumeStatus}</p> : null}
        {latestMainResume ? (
          <details className="main-resume-builder__preview">
            <summary>{latestMainResume.title}</summary>
            <pre>{latestMainResume.resume_markdown}</pre>
            {latestMainResume.missing_evidence_questions.length > 0 ? (
              <div>
                <strong>Missing evidence questions</strong>
                <ul>
                  {latestMainResume.missing_evidence_questions.map((question) => (
                    <li key={question}>{question}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </details>
        ) : null}
      </section>
    </div>
  );
}

function extractProfileFacts(profile: unknown) {
  const record = isRecord(profile) ? profile : {};
  return {
    education: extractFactList(record.education),
    email: extractFactValue(record.email),
    experience: extractFactList(record.experience),
    name: extractFactValue(record.name),
    phone: extractFactValue(record.phone),
    skills: extractFactList(record.skills),
  };
}

function extractFactValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (isRecord(value)) {
    const nested = value.value ?? value.text ?? value.name ?? value.title;
    if (typeof nested === "string" && nested.trim()) return nested.trim();
  }
  return null;
}

function extractFactList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    const single = extractFactValue(value);
    return single ? [single] : [];
  }
  return value
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (!isRecord(item)) return "";
      const parts = [item.role_title, item.role, item.title, item.employer, item.school, item.degree, item.name, item.value]
        .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
        .map((part) => part.trim());
      return parts.slice(0, 2).join(" · ");
    })
    .filter(Boolean);
}

function profileSnapshotCopy(state: ResumePrepWorkflowState) {
  if (state === "profile_ready" || state === "evidence_enriched") {
    return "Read-only profile facts from the latest extracted source. Use Evidence Library to improve coverage.";
  }
  if (state === "resume_uploaded" || state === "resume_reviewed") {
    return "A resume exists, but profile facts have not been extracted into the library yet.";
  }
  if (state === "claims_review_pending" || state === "evidence_extracted") {
    return "Profile facts are partially available. Review claims and enrich thin story targets before treating this as ready.";
  }
  return "Upload and review a resume before profile facts can be shown.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatResumeTitle(title: string) {
  return title.replace(/(\.[A-Za-z0-9]+)(?:\1)+$/i, "$1");
}

function JobsWorkspaceView() {
  type JobTab = "analysis" | "resume" | "interview" | "status";
  const [activeTab, setActiveTab] = useState<JobTab>("analysis");
  const tabLabel = {
    analysis: "JD Analysis",
    resume: "Tailored Resume Review",
    interview: "Interview Prep",
    status: "Application Status",
  } satisfies Record<JobTab, string>;
  const tabDescription = {
    analysis: "Create or reload a role workspace from a pasted JD.",
    resume:
      "Generate a role-specific resume from approved evidence and review claim support before use.",
    interview: "Create a focused prep pack from the selected job and approved material.",
    status: "Move role workspaces through the manual application pipeline.",
  } satisfies Record<JobTab, string>;

  return (
    <div className="job-workspace-stack">
      <section className="workspace-band workspace-band--tabbed">
        <div>
          <p className="panel-kicker">Job Workspace</p>
          <h2>{tabLabel[activeTab]}</h2>
          <p>{tabDescription[activeTab]}</p>
        </div>
        <div className="workspace-tabs" role="tablist" aria-label="Job workspace sections">
          {(
            [
              ["analysis", "JD Analysis"],
              ["resume", "Resume"],
              ["interview", "Interview"],
              ["status", "Status"],
            ] as const
          ).map(([id, label]) => (
            <button
              aria-selected={activeTab === id}
              data-active={activeTab === id}
              key={id}
              onClick={() => setActiveTab(id)}
              role="tab"
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      </section>
      {activeTab === "analysis" ? <JdAnalysisWorkspace /> : null}
      {activeTab === "resume" ? <TailoredResumeWorkspace /> : null}
      {activeTab === "interview" ? <InterviewPrepWorkspace /> : null}
      {activeTab === "status" ? <ApplicationTrackerWorkspace /> : null}
    </div>
  );
}

function PlannedReferenceView({
  title,
  description,
  nextSteps,
}: {
  title: string;
  description: string;
  nextSteps: string[];
}) {
  return (
    <section className="planned-panel">
      <span>Planned</span>
      <h2>{title}</h2>
      <p>{description}</p>
      <div>
        {nextSteps.map((step) => (
          <article key={step}>{step}</article>
        ))}
      </div>
    </section>
  );
}

function SettingsReferenceView() {
  const [diagnostics, setDiagnostics] = useState<SystemDiagnostics | null>(null);
  const [diagnosticsError, setDiagnosticsError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/system/diagnostics")
      .then(async (response) => {
        if (!response.ok) throw new Error("Diagnostics request failed.");
        return response.json() as Promise<{ data: SystemDiagnostics }>;
      })
      .then((payload) => {
        if (!active) return;
        setDiagnostics(payload.data);
        setDiagnosticsError(null);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setDiagnosticsError(
          error instanceof Error ? error.message : "Diagnostics unavailable.",
        );
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="settings-panel settings-panel--quiet">
      <p className="panel-kicker">Settings</p>
      <h2>Current workspace configuration</h2>
      <p>
        These are mostly reference checks for the personal MVP. Editable controls
        only appear where the app has behavior wired today.
      </p>
      <div className="settings-panel__grid">
        <article>
          <span>Access</span>
          <strong>Token gate</strong>
          <p>Use the access bar only when deployment protection is enabled.</p>
        </article>
        <article>
          <span>AI</span>
          <strong>Server configured</strong>
          <p>Provider credentials are environment-only, not user-editable here.</p>
        </article>
        <article>
          <span>Data</span>
          <strong>JobDesk DB</strong>
          <p>Career data uses this app's separate project database.</p>
        </article>
      </div>
      <section className="diagnostics-panel" aria-label="System diagnostics">
        <div className="diagnostics-panel__header">
          <div>
            <span>Diagnostics</span>
            <h3>Workflow baseline checks</h3>
          </div>
          <p>
            Read-only runtime status for DB, provider, skills registry, and recent
            workflow audit rows.
          </p>
        </div>
        {diagnosticsError ? (
          <p className="diagnostics-panel__error">{diagnosticsError}</p>
        ) : null}
        {!diagnostics && !diagnosticsError ? (
          <p className="diagnostics-panel__loading">Loading diagnostics...</p>
        ) : null}
        {diagnostics ? (
          <>
            <div className="diagnostics-grid">
              <DiagnosticMetric
                label="DB connected"
                value={diagnostics.db.connected ? "yes" : "no"}
                tone={diagnostics.db.connected ? "ready" : "blocked"}
              />
              <DiagnosticMetric
                label="AI provider"
                value={diagnostics.ai.providerEnabled ? "enabled" : "disabled"}
                tone={diagnostics.ai.providerEnabled ? "ready" : "muted"}
              />
              <DiagnosticMetric label="Current model" value={diagnostics.ai.model} />
              <DiagnosticMetric
                label="Registry entries"
                value={String(diagnostics.skills.registryEntries)}
              />
              <DiagnosticMetric
                label="Failed workflows"
                value={String(diagnostics.workflows.failedCount)}
                tone={diagnostics.workflows.failedCount > 0 ? "warning" : "ready"}
              />
              <DiagnosticMetric
                label="Last workflow"
                value={formatDateTime(diagnostics.workflows.lastFinishedAt)}
              />
            </div>
            <div className="diagnostics-detail">
              <div>
                <h4>Provider config</h4>
                <p>
                  API key {diagnostics.ai.apiKeyConfigured ? "configured" : "missing"} ·{" "}
                  {diagnostics.ai.transport} · {diagnostics.ai.endpointHost}
                </p>
              </div>
              <div>
                <h4>Latest workflow runs</h4>
                {diagnostics.workflows.latest.length > 0 ? (
                  <ul>
                    {diagnostics.workflows.latest.map((run) => (
                      <li key={run.id}>
                        <strong>{run.workflowType}</strong>
                        <span>{run.status}</span>
                        <small>{run.skillId ?? "no skill"} · {run.promptVersion ?? "no prompt"}</small>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No workflow runs recorded yet.</p>
                )}
              </div>
            </div>
          </>
        ) : null}
      </section>
    </section>
  );
}

function DiagnosticMetric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "ready" | "warning" | "blocked" | "muted";
}) {
  return (
    <article className="diagnostic-metric" data-tone={tone}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function formatDateTime(value: string | null) {
  if (!value) return "none";
  try {
    return new Intl.DateTimeFormat("en", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}
