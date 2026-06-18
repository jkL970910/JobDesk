"use client";

import { useEffect, useState } from "react";

import { ApplicationTrackerWorkspace } from "../src/components/application-tracker-workspace";
import { InterviewPrepWorkspace } from "../src/components/interview-prep-workspace";
import { JdAnalysisWorkspace } from "../src/components/jd-analysis-workspace";
import {
  ProfileEvidenceWorkspace,
  type MaterialEntryIntent,
} from "../src/components/profile-evidence-workspace";
import { ResumeReviewWorkspace } from "../src/components/resume-review-workspace";
import { TailoredResumeWorkspace } from "../src/components/tailored-resume-workspace";
import { AccountMenu, useAccess } from "../src/components/access-provider";

type View =
  | "dashboard"
  | "profile"
  | "evidence"
  | "jobs"
  | "applications"
  | "interview"
  | "recommendations"
  | "growth"
  | "settings";

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
    public_safe_summary?: string | null;
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
  generation_mode?: "main_resume" | "positioning_variant" | "resume_refresh";
  positioning_report_id?: string | null;
  positioning_direction_id?: string | null;
  positioning_title?: string | null;
  refresh_source_resume_id?: string | null;
  refresh_mode?: string | null;
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

type ProfilePositioningReportSummary = {
  id: string;
  status: string;
  evidenceSnapshotHash: string | null;
  createdAt: string;
  updatedAt: string;
  report: {
    summary: string;
    generated_at: string;
    global_strengths: string[];
    global_gaps: string[];
    directions: Array<{
      id: string;
      target_role: string;
      role_family: string;
      fit_score: number;
      confidence: "low" | "medium" | "high";
      support_level: "strong_fit" | "medium_fit" | "aspirational_gap";
      positioning_angle: string;
      evidence_strength_explanation: string;
      supporting_evidence: Array<{
        evidence_id: string;
        reason: string;
        signal_tags: string[];
      }>;
      missing_evidence_questions: string[];
      resume_emphasis: {
        summary_angle: string;
        skills_to_emphasize: string[];
        project_ordering_guidance: string[];
        keywords: string[];
        deprioritize: string[];
      };
      risks: string[];
    }>;
  };
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

type MaterialReviewTab = "enrichment" | "projects" | "unlinked" | "cleanup" | "stories";
type ResumeWorkspaceTab = "intake_review" | "profile_facts" | "build_export";
type DashboardNextAction = {
  detail: string;
  label: string;
  resumeTab?: ResumeWorkspaceTab;
  secondaryLabel?: string | null;
  secondaryTarget?: MaterialEntryIntent | null;
  title: string;
  view: View;
};

const viewHashMap = {
  applications: "applications",
  dashboard: "dashboard",
  evidence: "evidence",
  growth: "growth",
  interview: "interview",
  jobs: "jobs",
  profile: "profile",
  recommendations: "recommendations",
  settings: "settings",
} satisfies Record<View, string>;

const hashViewMap = Object.fromEntries(
  Object.entries(viewHashMap).map(([view, hash]) => [hash, view]),
) as Record<string, View>;

const topNavItems: Array<{ id: View; label: string; description: string }> = [
  { id: "dashboard", label: "Dashboard", description: "Current next step" },
  { id: "profile", label: "Resume", description: "Intake to export" },
  { id: "evidence", label: "Evidence", description: "Reusable proof" },
  { id: "jobs", label: "Jobs", description: "Target applications" },
  { id: "applications", label: "Applications", description: "Pipeline" },
  { id: "interview", label: "Interview", description: "Practice packs" },
];

const pageCopy = {
  dashboard: {
    eyebrow: "Overview",
    title: "Dashboard",
    subtitle:
      "Your job-search command center: prepare material, create job workspaces, tailor resumes, prep interviews, and track outcomes.",
  },
  profile: {
    eyebrow: "Resume Workspace",
    title: "Resume",
    subtitle:
      "Upload and review old resumes, inspect profile facts, generate variants, and export final resume artifacts.",
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
  const [activeView, setActiveView] = useState<View>(() => getViewFromLocationHash());
  const [materialEntryIntent, setMaterialEntryIntent] =
    useState<MaterialEntryIntent>("resume");
  const [materialInitialSection, setMaterialInitialSection] =
    useState<"review" | "intake">("review");
  const [materialReviewTab, setMaterialReviewTab] =
    useState<MaterialReviewTab>("enrichment");
  const [resumeWorkspaceTab, setResumeWorkspaceTab] =
    useState<ResumeWorkspaceTab>(() =>
      typeof window !== "undefined" && window.location.hash.replace(/^#\/?/, "") === "resume-review"
        ? "intake_review"
        : "build_export",
    );
  const [selectedResumeSourceVersionId, setSelectedResumeSourceVersionId] =
    useState<string | null>(null);
  const activeCopy = pageCopy[activeView];

  useEffect(() => {
    syncLocationHash(activeView, "replace");
    function handleHistoryChange() {
      const hash = window.location.hash.replace(/^#\/?/, "");
      if (hash === "resume-review") setResumeWorkspaceTab("intake_review");
      setActiveView(getViewFromLocationHash());
    }
    window.addEventListener("hashchange", handleHistoryChange);
    window.addEventListener("popstate", handleHistoryChange);
    return () => {
      window.removeEventListener("hashchange", handleHistoryChange);
      window.removeEventListener("popstate", handleHistoryChange);
    };
  }, []);

  function setAppView(view: View, historyMode: "push" | "replace" = "push") {
    setActiveView(view);
    syncLocationHash(view, historyMode);
  }

  function navigateToMaterial(intent: MaterialEntryIntent) {
    if (intent === "resume") {
      navigateToResume("intake_review");
      return;
    }
    if (intent === "jd") {
      setAppView("jobs");
      return;
    }
    setMaterialEntryIntent(intent);
    setMaterialInitialSection("intake");
    setMaterialReviewTab("enrichment");
    setAppView("evidence");
  }
  function extractResumeToEvidence(resumeSourceVersionId: string) {
    setSelectedResumeSourceVersionId(resumeSourceVersionId);
    setMaterialEntryIntent("resume");
    setMaterialInitialSection("intake");
    setMaterialReviewTab("enrichment");
    setAppView("evidence");
  }
  function openEvidenceReview(tab: MaterialReviewTab = "enrichment") {
    setMaterialInitialSection("review");
    setMaterialReviewTab(tab);
    setAppView("evidence");
  }
  function navigateToView(view: View) {
    if (view === "evidence") {
      setMaterialInitialSection("review");
      setMaterialReviewTab("enrichment");
    }
    setAppView(view);
  }
  function navigateToResume(tab: ResumeWorkspaceTab = "build_export") {
    setResumeWorkspaceTab(tab);
    setAppView("profile");
  }

  return (
    <>
      <a className="skip-link" href="#jobdesk-main">Skip to workspace</a>
      <main className="jobdesk-shell" id="jobdesk-main">
        <header className="app-topbar" aria-label="JobDesk workspace navigation">
          <button
            className="app-brand"
            onClick={() => navigateToView("dashboard")}
            type="button"
          >
            <span className="app-brand__mark" aria-hidden="true">J</span>
            <span>
              <strong>JobDesk</strong>
              <small>Career operating system</small>
            </span>
          </button>

          <nav className="app-topnav" aria-label="Primary navigation">
            {topNavItems.map((item) => (
              <button
                aria-current={item.id === activeView ? "page" : undefined}
                className="app-topnav__item"
                data-active={item.id === activeView}
                key={item.id}
                onClick={() => navigateToView(item.id)}
                type="button"
              >
                <span>{item.label}</span>
                <small>{item.description}</small>
              </button>
            ))}
          </nav>

          <div className="app-topbar__actions">
            <AccountMenu onNavigateSettings={() => navigateToView("settings")} />
          </div>
        </header>

        <section className="app-content">
          <header className="app-content__header">
            <div>
              <p className="app-content__eyebrow">{activeCopy.eyebrow}</p>
              <h1>{activeCopy.title}</h1>
              <p>{activeCopy.subtitle}</p>
            </div>
          </header>

          <div className="app-content__body">
            {activeView === "dashboard" ? (
              <DashboardView
                onNavigate={setAppView}
                onNavigateResume={navigateToResume}
                onStartMaterialPath={navigateToMaterial}
              />
            ) : null}
            {activeView === "profile" ? (
              <ResumeWorkspaceView
                activeTab={resumeWorkspaceTab}
                onExtractResumeToEvidence={extractResumeToEvidence}
                onNavigate={setAppView}
                onOpenEvidenceReview={openEvidenceReview}
                onTabChange={setResumeWorkspaceTab}
              />
            ) : null}
            {activeView === "evidence" ? (
              <ProfileEvidenceWorkspace
                entryIntent={materialEntryIntent}
                initialSection={materialInitialSection}
                initialResumeSourceVersionId={selectedResumeSourceVersionId}
                initialReviewTab={materialReviewTab}
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
    </>
  );
}

function DashboardView({
  onNavigate,
  onNavigateResume,
  onStartMaterialPath,
}: {
  onNavigate: (view: View) => void;
  onNavigateResume: (tab: ResumeWorkspaceTab) => void;
  onStartMaterialPath: (intent: MaterialEntryIntent) => void;
}) {
  const { fetchJson } = useAccess();
  const [library, setLibrary] = useState<EvidenceLibrarySummary | null>(null);
  const [resumes, setResumes] = useState<ResumeReviewSummary[]>([]);
  const [jobs, setJobs] = useState<RecentJobSummary[]>([]);
  const [prepPacks, setPrepPacks] = useState<InterviewPrepSummary[]>([]);
  const [dashboardLoadState, setDashboardLoadState] = useState<"loading" | "ready" | "error">("loading");

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
  const nextAction = determineDashboardNextAction({
    latestResume,
    state: resumePrepState,
  });
  const displayNextAction: DashboardNextAction =
    dashboardLoadState === "loading"
      ? {
          detail: "Checking Resume Review and Evidence Library before recommending the next action.",
          label: "Loading workspace",
          resumeTab: undefined,
          secondaryLabel: null,
          secondaryTarget: null,
          title: "Loading workspace state.",
          view: "dashboard" as View,
        }
      : nextAction;
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
            note: storyTargets > 0 ? "Work notes can strengthen this" : "Add material first",
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
      action: "Build library",
      body:
        "No resume required. Start from project notes, work summaries, performance excerpts, guided answers, or a reviewed resume.",
      target: () => onStartMaterialPath("scratch"),
      title: "Build My Evidence Library",
    },
    {
      action: "Create or update",
      body:
        "Generate main resumes, positioning variants, refresh an old resume, review versions, and export final artifacts.",
      target: () => onNavigateResume("build_export"),
      title: "Create or Update My Resume",
    },
    {
      action: "Apply to job",
      body:
        "Analyze a specific JD, find evidence gaps, tailor a resume, prepare interview notes, and track the application.",
      target: () => onNavigate("jobs"),
      title: "Apply to a Target Job",
    },
  ];

  const coreJourney = [
    {
      action: latestResume ? "Open review" : "Upload resume",
      detail: latestResume
        ? latestResume.latestReview
          ? `${formatResumeTitle(latestResume.title)} scored ${latestResume.latestReview.overallScore}.`
          : `${formatResumeTitle(latestResume.title)} is saved and ready for review.`
        : hasExtractedMaterial
          ? "You already have material in the library. Resume upload is optional."
          : "Start with a resume upload, or skip directly to source material if you do not have one.",
      id: "resume",
      label: "Resume review",
      metric: latestResume?.latestReview ? `Score ${latestResume.latestReview.overallScore}` : latestResume ? "Saved" : "Optional",
      state: latestResume?.latestReview || hasExtractedMaterial ? "complete" : latestResume ? "active" : "blocked",
      target: () => onNavigateResume("intake_review"),
    },
    {
      action: "Open evidence",
      detail:
        resumeReadyClaims > 0
          ? `${resumeReadyClaims} claim${resumeReadyClaims === 1 ? "" : "s"} are resume-safe. ${claimsNeedingReview} still need review.`
          : hasExtractedMaterial
            ? `${claimsNeedingReview} extracted claim${claimsNeedingReview === 1 ? "" : "s"} need truth review and safe wording.`
            : "Import notes, guided answers, or resume text into reusable proof.",
      id: "evidence",
      label: "Evidence library",
      metric: resumeReadyClaims > 0 ? `${resumeReadyClaims} ready` : hasExtractedMaterial ? `${claimsNeedingReview} to review` : "Empty",
      state: resumeReadyClaims > 0 ? "complete" : hasExtractedMaterial ? "active" : "blocked",
      target: () => onNavigate("evidence"),
    },
    {
      action: "Create resume",
      detail:
        resumeReadyClaims > 0
          ? "Generate a grounded main resume, positioning variant, or refresh an old resume."
          : "Requires resume-safe evidence before generation is trustworthy.",
      id: "main-resume",
      label: "Main resume",
      metric: resumeReadyClaims > 0 ? "Ready" : "Blocked",
      state: resumeReadyClaims > 0 ? "active" : "blocked",
      target: () => onNavigateResume("build_export"),
    },
  ];
  const downstreamWorkflows = [
    {
      action: "Open jobs",
      detail: jobs[0]?.title ?? "Analyze a specific JD once your evidence base is usable.",
      label: "Apply to a target job",
      metric: `${jobs.length} analyzed`,
      target: () => onNavigate("jobs"),
    },
    {
      action: "Open tracker",
      detail: `${activeApplications} active applications · ${interviewJobs} in interview stage.`,
      label: "Track applications",
      metric: `${activeApplications} active`,
      target: () => onNavigate("applications"),
    },
    {
      action: "Prep interview",
      detail: prepPacks.length > 0 ? `${prepPacks.length} prep packs saved.` : "Create prep once a JD is analyzed.",
      label: "Interview prep",
      metric: prepPacks.length > 0 ? `${prepPacks.length} packs` : "Later",
      target: () => onNavigate("interview"),
    },
  ];

  return (
    <div className="dashboard-grid">
      <section className="command-center">
        <article className="next-action-card">
          <p className="panel-kicker">Next best action</p>
          <h2>{displayNextAction.title}</h2>
          <p>{displayNextAction.detail}</p>
          <div className="next-action-card__actions">
            <button
              disabled={dashboardLoadState === "loading"}
              type="button"
              onClick={() =>
                displayNextAction.resumeTab
                  ? onNavigateResume(displayNextAction.resumeTab)
                  : onNavigate(displayNextAction.view)
              }
            >
              {displayNextAction.label}
            </button>
            {(() => {
              const secondaryTarget = displayNextAction.secondaryTarget;
              if (!displayNextAction.secondaryLabel || !secondaryTarget) return null;
              return (
                <button
                  className="next-action-card__secondary"
                  disabled={dashboardLoadState === "loading"}
                  type="button"
                  onClick={() => onStartMaterialPath(secondaryTarget)}
                >
                  {displayNextAction.secondaryLabel}
                </button>
              );
            })()}
          </div>
        </article>

        <div className="journey-panel" aria-label="Resume workflow journey">
          <div className="journey-panel__header">
            <div>
              <p className="panel-kicker">Core journey</p>
              <h2>Turn source material into a verified resume.</h2>
            </div>
            <span>{dashboardLoadState === "loading" ? "Loading" : `${resumeReadyClaims} resume-safe`}</span>
          </div>
          <div className="journey-steps">
            {coreJourney.map((step, index) => (
              <article className="journey-step" data-state={step.state} key={step.id}>
                <div className="journey-step__number">{index + 1}</div>
                <div>
                  <span>{step.label}</span>
                  <strong>{step.metric}</strong>
                  <p>{step.detail}</p>
                </div>
                <button disabled={dashboardLoadState === "loading"} onClick={step.target} type="button">
                  {step.action}
                </button>
              </article>
            ))}
          </div>
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
          <article data-phase={path.title === "Apply to a Target Job" && resumeReadyClaims === 0 ? "secondary" : "primary"} key={path.title}>
            <span>{path.title}</span>
            <p>{path.body}</p>
            <button type="button" onClick={path.target}>
              {path.action}
            </button>
          </article>
        ))}
      </section>

      <section className="downstream-board" aria-label="Later job-search workflows">
        {downstreamWorkflows.map((workflow) => (
          <article key={workflow.label}>
            <span>{workflow.label}</span>
            <strong>{workflow.metric}</strong>
            <p>{workflow.detail}</p>
            <button type="button" onClick={workflow.target}>
              {workflow.action}
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
}): DashboardNextAction {
  if (state === "no_resume") {
    return {
      detail: "Use a resume if you have one. If not, build the Evidence Library directly from guided project answers, work notes, or performance summaries.",
      label: "Review a resume",
      secondaryLabel: "No resume? Build evidence directly",
      secondaryTarget: "scratch" as MaterialEntryIntent,
      title: "Start from your strongest source material.",
      resumeTab: "intake_review" as ResumeWorkspaceTab,
      view: "profile" as View,
    };
  }
  if (state === "resume_uploaded") {
    return {
      detail: `${latestResume ? formatResumeTitle(latestResume.title) : "The resume"} is saved but still needs review findings.`,
      label: "Review Findings",
      title: "Review the saved resume.",
      resumeTab: "intake_review" as ResumeWorkspaceTab,
      view: "profile" as View,
    };
  }
  if (state === "resume_reviewed") {
    return {
      detail: "The resume is reviewed. Continue to Evidence to create reusable claims and story targets.",
      label: "Continue to Evidence",
      title: "Turn this review into reusable evidence.",
      resumeTab: "intake_review" as ResumeWorkspaceTab,
      view: "profile" as View,
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
    !item.needs_user_confirmation &&
    hasExternalSafeDisclosure(item)
  );
}

function hasExternalSafeDisclosure(item: {
  sensitivity_level?: string | null;
  public_safe_summary?: string | null;
}) {
  return item.sensitivity_level === "public_safe" || Boolean(item.public_safe_summary?.trim());
}

function ResumeWorkspaceView({
  activeTab,
  onExtractResumeToEvidence,
  onNavigate,
  onOpenEvidenceReview,
  onTabChange,
}: {
  activeTab: ResumeWorkspaceTab;
  onExtractResumeToEvidence: (resumeSourceVersionId: string) => void;
  onNavigate: (view: View) => void;
  onOpenEvidenceReview: (tab?: MaterialReviewTab) => void;
  onTabChange: (tab: ResumeWorkspaceTab) => void;
}) {
  const tabs = [
    {
      body: "Upload old resumes, parse source text, score quality, and send useful material to Evidence.",
      id: "intake_review",
      label: "Intake & Review",
    },
    {
      body: "Inspect the factual career snapshot built from reviewed resumes and Evidence Library material.",
      id: "profile_facts",
      label: "Profile Facts",
    },
    {
      body: "Generate main resumes, refresh old versions, review claim support, and export final artifacts.",
      id: "build_export",
      label: "Build & Export",
    },
  ] satisfies Array<{ body: string; id: ResumeWorkspaceTab; label: string }>;

  return (
    <div className="resume-workspace">
      <div className="resume-workspace__tabs" role="tablist" aria-label="Resume workspace sections">
        {tabs.map((tab) => (
          <button
            aria-selected={activeTab === tab.id}
            className="resume-workspace__tab"
            data-active={activeTab === tab.id}
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            role="tab"
            type="button"
          >
            <span>{tab.label}</span>
            <small>{tab.body}</small>
          </button>
        ))}
      </div>

      {activeTab === "intake_review" ? (
        <ResumeReviewWorkspace
          onExtractToEvidence={onExtractResumeToEvidence}
          onOpenEvidenceReview={onOpenEvidenceReview}
        />
      ) : null}
      {activeTab === "profile_facts" || activeTab === "build_export" ? (
        <ProfileReferenceView
          onNavigate={onNavigate}
          onNavigateResume={onTabChange}
        />
      ) : null}
    </div>
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

function formatPositioningSupportLevel(
  level: ProfilePositioningReportSummary["report"]["directions"][number]["support_level"],
) {
  if (level === "strong_fit") return "Strong fit";
  if (level === "medium_fit") return "Medium fit";
  return "Aspirational / evidence gap";
}

function ProfileReferenceView({
  onNavigate,
  onNavigateResume,
}: {
  onNavigate: (view: View) => void;
  onNavigateResume: (tab: ResumeWorkspaceTab) => void;
}) {
  const { fetchJson } = useAccess();
  const [library, setLibrary] = useState<EvidenceLibrarySummary | null>(null);
  const [resumes, setResumes] = useState<ResumeReviewSummary[]>([]);
  const [mainResumes, setMainResumes] = useState<MainResumeSummary[]>([]);
  const [positioningReports, setPositioningReports] = useState<ProfilePositioningReportSummary[]>([]);
  const [selectedPositioningDirectionId, setSelectedPositioningDirectionId] = useState<string | null>(
    null,
  );
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [mainResumeStatus, setMainResumeStatus] = useState<string | null>(null);
  const [positioningStatus, setPositioningStatus] = useState<string | null>(null);
  const [isGeneratingMainResume, setIsGeneratingMainResume] = useState(false);
  const [isGeneratingPositioning, setIsGeneratingPositioning] = useState(false);
  const [refreshSourceResumeId, setRefreshSourceResumeId] = useState("");
  const [refreshMode, setRefreshMode] = useState<
    "conservative_update" | "balanced_rewrite" | "strategic_reposition"
  >("balanced_rewrite");
  const [refreshTargetLength, setRefreshTargetLength] = useState<
    "one_page" | "standard" | "detailed"
  >("standard");
  const [refreshTone, setRefreshTone] = useState<
    "concise" | "executive" | "technical" | "product"
  >("concise");
  const [refreshPreserveSectionOrder, setRefreshPreserveSectionOrder] = useState(true);
  const [refreshAtsFriendly, setRefreshAtsFriendly] = useState(true);
  const [exportTemplate, setExportTemplate] = useState<"plain_ats">("plain_ats");
  const [exportPagePolicy, setExportPagePolicy] = useState<
    "one_page" | "two_page" | "unrestricted"
  >("unrestricted");

  useEffect(() => {
    let cancelled = false;

    async function loadProfileSurface() {
      setLoadState("loading");
      try {
        const [
          libraryResult,
          resumesResult,
          mainResumesResult,
          positioningResult,
        ] = await Promise.allSettled([
          fetchJson("/api/profile-evidence/recent"),
          fetchJson("/api/resume-review"),
          fetchJson("/api/main-resume"),
          fetchJson("/api/profile-positioning/recent"),
        ]);
        if (cancelled) return;
        const hasLibrary = libraryResult.status === "fulfilled" && libraryResult.value.ok;
        const hasResumes = resumesResult.status === "fulfilled" && resumesResult.value.ok;
        const hasMainResumes =
          mainResumesResult.status === "fulfilled" && mainResumesResult.value.ok;
        const hasPositioning =
          positioningResult.status === "fulfilled" && positioningResult.value.ok;
        if (!hasLibrary && !hasResumes && !hasMainResumes && !hasPositioning) {
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
        const positioningPayload = hasPositioning
          ? ((await positioningResult.value.json()) as {
              data?: { reports?: ProfilePositioningReportSummary[] };
            })
          : null;
        if (cancelled) return;
        if (libraryPayload) setLibrary(libraryPayload.data ?? null);
        if (resumePayload) setResumes(resumePayload.data?.resumes ?? []);
        if (mainResumePayload) setMainResumes(mainResumePayload.data?.resumes ?? []);
        if (positioningPayload) {
          const reports = positioningPayload.data?.reports ?? [];
          setPositioningReports(reports);
          setSelectedPositioningDirectionId((current) =>
            current ?? reports[0]?.report.directions[0]?.id ?? null,
          );
        }
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
  const latestPositioningReport = positioningReports[0] ?? null;
  const selectedPositioningDirection =
    latestPositioningReport?.report.directions.find(
      (direction) => direction.id === selectedPositioningDirectionId,
    ) ??
    latestPositioningReport?.report.directions[0] ??
    null;
  const mainResumeReady = resumeEligibleEvidence > 0;
  const latestMainResumeClaimStats = latestMainResume
    ? getMainResumeClaimStats(latestMainResume)
    : null;
  const exportUsesLengthConstraint = exportPagePolicy !== "unrestricted";

  async function generatePositioningReport() {
    setIsGeneratingPositioning(true);
    setPositioningStatus("Analyzing canonical evidence for target role directions...");
    try {
      const response = await fetchJson("/api/profile-positioning", {
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            data?: ProfilePositioningReportSummary["report"];
            meta?: { persistence?: { status: string; profilePositioningReportId?: string } };
            error?: string;
            kind?: string;
          }
        | null;
      if (!response.ok) {
        setPositioningStatus(
          payload?.error
            ? `${payload.error}${payload.kind ? ` (${payload.kind})` : ""}`
            : "Profile positioning generation failed.",
        );
        return;
      }
      const reportResponse = await fetchJson("/api/profile-positioning/recent");
      if (reportResponse.ok) {
        const reportPayload = (await reportResponse.json()) as {
          data?: { reports?: ProfilePositioningReportSummary[] };
        };
        const reports = reportPayload.data?.reports ?? [];
        setPositioningReports(reports);
        setSelectedPositioningDirectionId(reports[0]?.report.directions[0]?.id ?? null);
      }
      setPositioningStatus("Positioning report generated. Select a direction to create a variant.");
    } catch (error) {
      setPositioningStatus(
        error instanceof Error ? error.message : "Profile positioning generation failed.",
      );
    } finally {
      setIsGeneratingPositioning(false);
    }
  }

  async function generateMainResume(options?: {
    mode?: "main_resume" | "positioning_variant" | "resume_refresh";
  }) {
    setIsGeneratingMainResume(true);
    const mode = options?.mode ?? "main_resume";
    const useRefresh = mode === "resume_refresh";
    const usePositioning = Boolean(
      (mode === "positioning_variant" || mode === "resume_refresh") &&
        selectedPositioningDirection,
    );
    setMainResumeStatus(
      useRefresh
        ? "Refreshing old resume with current approved evidence..."
        : usePositioning
        ? `Generating ${selectedPositioningDirection?.target_role} resume variant...`
        : "Generating main resume from resume-safe evidence...",
    );
    try {
      if (useRefresh && !refreshSourceResumeId) {
        setMainResumeStatus("Select an old resume version before refreshing.");
        return;
      }
      const response = await fetchJson("/api/main-resume", {
        body: usePositioning || useRefresh
          ? JSON.stringify({
              mode,
              positioningReportId: latestPositioningReport?.id,
              positioningDirectionId: selectedPositioningDirection?.id,
              sourceResumeVersionId: useRefresh ? refreshSourceResumeId : undefined,
              refreshMode: useRefresh ? refreshMode : undefined,
              styleConstraints: useRefresh
                ? {
                    atsFriendly: refreshAtsFriendly,
                    preserveSectionOrder: refreshPreserveSectionOrder,
                    targetLength: refreshTargetLength,
                    tone: refreshTone,
                  }
                : undefined,
            })
          : undefined,
        headers: usePositioning || useRefresh ? { "content-type": "application/json" } : undefined,
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
          ? useRefresh
            ? "Refreshed resume generated and Fact Guard completed."
            : usePositioning
            ? "Positioned main resume variant generated and Fact Guard completed."
            : "Main resume generated and Fact Guard completed."
          : useRefresh
            ? "Refreshed resume generated. Review claim support before export."
            : usePositioning
            ? "Positioned main resume variant generated. Review claim support before export."
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

  async function createPositioningEnrichmentTasks() {
    if (!latestPositioningReport || !selectedPositioningDirection) return;
    setPositioningStatus(`Creating enrichment tasks for ${selectedPositioningDirection.target_role}...`);
    try {
      const response = await fetchJson("/api/profile-positioning/enrichment-tasks", {
        body: JSON.stringify({
          positioningReportId: latestPositioningReport.id,
          positioningDirectionId: selectedPositioningDirection.id,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json()) as {
        data?: { taskCount?: number; directionTitle?: string };
        error?: string;
      };
      if (!response.ok) {
        setPositioningStatus(payload.error ?? "Failed to create enrichment tasks.");
        return;
      }
      setPositioningStatus(
        `Created ${payload.data?.taskCount ?? 0} enrichment task(s) for ${payload.data?.directionTitle ?? selectedPositioningDirection.target_role}.`,
      );
      onNavigate("evidence");
    } catch (error) {
      setPositioningStatus(
        error instanceof Error ? error.message : "Failed to create enrichment tasks.",
      );
    }
  }

  async function exportMainResume(
    resumeId: string,
    format: "markdown" | "json" | "docx",
  ) {
    const exportParams = new URLSearchParams({
      format,
      pagePolicy: exportPagePolicy,
      template: exportTemplate,
    });
    const response = await fetchJson(
      `/api/main-resume/${resumeId}/export?${exportParams.toString()}`,
    );
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setMainResumeStatus(payload?.error ?? "Main resume export failed.");
      return;
    }
    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") ?? "";
    const fileName =
      disposition.match(/filename="([^"]+)"/)?.[1] ??
      `jobdesk-main-resume.${format === "markdown" ? "md" : format}`;
    downloadBlob(fileName, blob);
    setMainResumeStatus(`Exported ${formatLabel(format)} main resume.`);
  }

  async function openPrintableMainResume(resumeId: string) {
    const exportParams = new URLSearchParams({
      format: "html",
      pagePolicy: exportPagePolicy,
      template: exportTemplate,
    });
    const response = await fetchJson(
      `/api/main-resume/${resumeId}/export?${exportParams.toString()}`,
    );
    if (!response.ok) {
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;
      setMainResumeStatus(payload?.error ?? "Printable resume export failed.");
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const opened = window.open(url, "_blank", "noopener,noreferrer");
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    if (!opened) {
      const disposition = response.headers.get("content-disposition") ?? "";
      const fileName =
        disposition.match(/filename="([^"]+)"/)?.[1] ?? "jobdesk-main-resume.html";
      downloadBlob(fileName, blob);
      setMainResumeStatus("Downloaded printable HTML because the browser blocked the preview tab.");
      return;
    }
    setMainResumeStatus("Opened printable resume. Use browser print to save PDF.");
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
              : "Profile stays read-only until Resume Review or Add Material creates extracted facts."}
          </p>
        </div>
        <button
          type="button"
          onClick={() =>
            resumePrepState === "no_resume" || resumePrepState === "resume_uploaded"
              ? onNavigateResume("intake_review")
              : onNavigate("evidence")
          }
        >
          {resumePrepState === "no_resume" || resumePrepState === "resume_uploaded"
            ? "Open Resume Review"
            : "Open Evidence Library"}
        </button>
      </section>

      <section className="positioning-engine">
        <div className="positioning-engine__header">
          <div>
            <p className="panel-kicker">Profile Positioning Engine</p>
            <h3>Find role directions your evidence actually supports.</h3>
            <p>
              Uses canonical profile facts and resume-safe evidence only. It does
              not require a JD and does not make unsupported career claims.
            </p>
          </div>
          <button
            className="primary-button"
            disabled={!mainResumeReady || isGeneratingPositioning}
            type="button"
            onClick={() => void generatePositioningReport()}
          >
            {isGeneratingPositioning ? "Analyzing..." : "Analyze positioning"}
          </button>
        </div>
        <div className="main-resume-builder__metrics">
          <article>
            <span>Directions</span>
            <strong>{latestPositioningReport?.report.directions.length ?? 0}</strong>
            <p>{latestPositioningReport ? "Role hypotheses are evidence-backed." : "Generate a report from approved evidence."}</p>
          </article>
          <article>
            <span>Evidence basis</span>
            <strong>{resumeEligibleEvidence}</strong>
            <p>{mainResumeReady ? "Resume-safe evidence can support positioning." : "Approve resume-safe evidence first."}</p>
          </article>
          <article>
            <span>Latest report</span>
            <strong>{latestPositioningReport ? latestPositioningReport.status : "None"}</strong>
            <p>{latestPositioningReport ? formatDateTime(latestPositioningReport.updatedAt) : "No positioning report generated yet."}</p>
          </article>
        </div>
        {positioningStatus ? <p className="status">{positioningStatus}</p> : null}
        {latestPositioningReport ? (
          <div className="positioning-engine__body">
            <div className="positioning-engine__summary">
              <strong>{latestPositioningReport.report.summary}</strong>
              <p>
                Strengths: {latestPositioningReport.report.global_strengths.slice(0, 3).join(", ") || "None captured yet."}
              </p>
              <p>
                Gaps: {latestPositioningReport.report.global_gaps.slice(0, 3).join(", ") || "No major gaps listed."}
              </p>
            </div>
            <div className="positioning-direction-grid" role="list">
              {latestPositioningReport.report.directions.map((direction) => {
                const selected = direction.id === selectedPositioningDirection?.id;
                return (
                  <button
                    aria-pressed={selected}
                    className="positioning-direction-card"
                    data-selected={selected}
                    key={direction.id}
                    onClick={() => setSelectedPositioningDirectionId(direction.id)}
                    role="listitem"
                    type="button"
                  >
                    <span>{direction.role_family}</span>
                    <strong>{direction.target_role}</strong>
                    <em>
                      {formatPositioningSupportLevel(direction.support_level)} ·{" "}
                      {direction.fit_score}/100 · {direction.confidence}
                    </em>
                    <p>{direction.positioning_angle}</p>
                    <small>
                      {direction.supporting_evidence.length} evidence cited ·{" "}
                      {direction.missing_evidence_questions.length} gaps
                    </small>
                  </button>
                );
              })}
            </div>
            {selectedPositioningDirection ? (
              <div className="positioning-direction-detail">
                <div>
                  <p className="panel-kicker">Selected direction</p>
                  <h4>{selectedPositioningDirection.target_role}</h4>
                  <span className="positioning-support-badge" data-level={selectedPositioningDirection.support_level}>
                    {formatPositioningSupportLevel(selectedPositioningDirection.support_level)}
                  </span>
                  <p>{selectedPositioningDirection.evidence_strength_explanation}</p>
                </div>
                <div className="positioning-detail-grid">
                  <article>
                    <span>Evidence cited</span>
                    <strong>{selectedPositioningDirection.supporting_evidence.length}</strong>
                    <p>
                      {selectedPositioningDirection.supporting_evidence
                        .slice(0, 2)
                        .map((item) => item.reason)
                        .join(" ")}
                    </p>
                  </article>
                  <article>
                    <span>Keywords</span>
                    <strong>{selectedPositioningDirection.resume_emphasis.keywords.length}</strong>
                    <p>{selectedPositioningDirection.resume_emphasis.keywords.slice(0, 8).join(", ")}</p>
                  </article>
                  <article>
                    <span>Missing proof</span>
                    <strong>{selectedPositioningDirection.missing_evidence_questions.length}</strong>
                    {selectedPositioningDirection.missing_evidence_questions.length > 0 ? (
                      <ul className="compact-gap-list">
                        {selectedPositioningDirection.missing_evidence_questions
                          .slice(0, 3)
                          .map((question) => (
                            <li key={question}>{question}</li>
                          ))}
                      </ul>
                    ) : (
                      <p>No missing evidence question listed.</p>
                    )}
                  </article>
                </div>
                <div className="actions actions--compact">
                  <button className="secondary-button" onClick={() => onNavigate("evidence")} type="button">
                    View supporting evidence
                  </button>
                  <button className="secondary-button" onClick={() => void createPositioningEnrichmentTasks()} type="button">
                    Create enrichment tasks
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
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
            onClick={() => void generateMainResume({ mode: "main_resume" })}
          >
            {isGeneratingMainResume ? "Generating..." : "Generate main resume"}
          </button>
        </div>
        {selectedPositioningDirection ? (
          <div className="positioning-variant-callout">
            <div>
              <strong>{selectedPositioningDirection.target_role} variant ready</strong>
              <p>
                Generate a Main Resume variant using this positioning angle. Fact
                Guard will still validate the generated claims.
              </p>
            </div>
            <button
              className="secondary-button"
              disabled={!mainResumeReady || isGeneratingMainResume}
              type="button"
              onClick={() => void generateMainResume({ mode: "positioning_variant" })}
            >
              Generate this variant
            </button>
          </div>
        ) : null}
        <div className="resume-refresh-panel">
          <div>
            <p className="panel-kicker">Resume Refresh</p>
            <h4>Refresh an old resume using current evidence.</h4>
            <p>
              Select a reviewed resume as the structure baseline. JobDesk does not
              re-extract evidence by default; the Evidence Library remains the fact source.
            </p>
          </div>
          <div className="resume-refresh-grid">
            <label>
              <span>Old resume</span>
              <select
                value={refreshSourceResumeId}
                onChange={(event) => setRefreshSourceResumeId(event.target.value)}
              >
                <option value="">Select a resume version</option>
                {resumes.map((resume) => (
                  <option key={resume.id} value={resume.id}>
                    {formatResumeTitle(resume.title)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Update mode</span>
              <select
                value={refreshMode}
                onChange={(event) => setRefreshMode(event.target.value as typeof refreshMode)}
              >
                <option value="conservative_update">Conservative update</option>
                <option value="balanced_rewrite">Balanced rewrite</option>
                <option value="strategic_reposition">Strategic reposition</option>
              </select>
            </label>
            <label>
              <span>Length</span>
              <select
                value={refreshTargetLength}
                onChange={(event) =>
                  setRefreshTargetLength(event.target.value as typeof refreshTargetLength)
                }
              >
                <option value="one_page">One page</option>
                <option value="standard">Standard</option>
                <option value="detailed">Detailed</option>
              </select>
            </label>
            <label>
              <span>Tone</span>
              <select
                value={refreshTone}
                onChange={(event) => setRefreshTone(event.target.value as typeof refreshTone)}
              >
                <option value="concise">Concise</option>
                <option value="executive">Executive</option>
                <option value="technical">Technical</option>
                <option value="product">Product</option>
              </select>
            </label>
          </div>
          <div className="resume-refresh-options">
            <label>
              <input
                checked={refreshPreserveSectionOrder}
                onChange={(event) => setRefreshPreserveSectionOrder(event.target.checked)}
                type="checkbox"
              />
              Preserve section order
            </label>
            <label>
              <input
                checked={refreshAtsFriendly}
                onChange={(event) => setRefreshAtsFriendly(event.target.checked)}
                type="checkbox"
              />
              ATS-friendly wording
            </label>
          </div>
          <button
            className="secondary-button"
            disabled={!mainResumeReady || !refreshSourceResumeId || isGeneratingMainResume}
            onClick={() => void generateMainResume({ mode: "resume_refresh" })}
            type="button"
          >
            Refresh selected resume
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
            <strong>{latestMainResume ? formatMainResumeUserState(latestMainResume) : "None"}</strong>
            <p>
              {latestMainResume
                ? `${formatMainResumeMode(latestMainResume)} · ${formatDateTime(latestMainResume.updatedAt)}`
                : "No generated main resume yet."}
            </p>
          </article>
          <article>
            <span>Fact Guard</span>
            <strong>{latestMainResume ? formatFactGuardSummary(latestMainResume, latestMainResumeClaimStats) : "Not run"}</strong>
            <p>
              {latestMainResumeClaimStats
                ? `${latestMainResumeClaimStats.needsReview} claim${latestMainResumeClaimStats.needsReview === 1 ? "" : "s"} need review before final export.`
                : latestMainResume
                  ? "No claim ledger entries."
                  : "Generated with the first main resume."}
            </p>
          </article>
        </div>
        {mainResumeStatus ? <p className="status">{mainResumeStatus}</p> : null}
        {latestMainResume ? (
          <section className="main-resume-builder__preview final-review-panel" aria-label="Main resume final review">
            <div className="main-resume-builder__preview-header final-review-panel__header">
              <div>
                <span>{latestMainResume.status === "validated" ? "Ready to export" : "Draft under review"}</span>
                <h4>Final review: {latestMainResume.title}</h4>
                <p>
                  {formatMainResumeMode(latestMainResume)} · {formatDateTime(latestMainResume.updatedAt)}
                </p>
              </div>
              <div className="final-export-controls">
                <div className="final-export-controls__selectors" aria-label="Resume export settings">
                  <label>
                    <span>Template</span>
                    <select
                      value={exportTemplate}
                      onChange={(event) =>
                        setExportTemplate(event.target.value as typeof exportTemplate)
                      }
                    >
                      <option value="plain_ats">Plain ATS</option>
                    </select>
                  </label>
                  <label>
                    <span>Length</span>
                    <select
                      value={exportPagePolicy}
                      onChange={(event) =>
                        setExportPagePolicy(event.target.value as typeof exportPagePolicy)
                      }
                    >
                      <option value="one_page">One page</option>
                      <option value="two_page">Two page</option>
                      <option value="unrestricted">Full length</option>
                    </select>
                  </label>
                </div>
                <div className="actions actions--compact">
                  <button
                    className="primary-button"
                    disabled={latestMainResume.status !== "validated"}
                    type="button"
                    onClick={() => void exportMainResume(latestMainResume.id, "docx")}
                    title={
                      latestMainResume.status === "validated"
                        ? "Download ATS-friendly DOCX"
                        : "Blocked until Fact Guard supports every generated claim"
                    }
                  >
                    Export DOCX
                  </button>
                  <button
                    className="secondary-button"
                    disabled={latestMainResume.status !== "validated"}
                    type="button"
                    onClick={() => void openPrintableMainResume(latestMainResume.id)}
                    title={
                      latestMainResume.status === "validated"
                        ? "Open printable resume for browser PDF"
                        : "Blocked until Fact Guard supports every generated claim"
                    }
                  >
                    Print / Save PDF
                  </button>
                  <button
                    className="secondary-button secondary-button--quiet"
                    disabled={latestMainResume.status !== "validated"}
                    type="button"
                    onClick={() => void exportMainResume(latestMainResume.id, "markdown")}
                  >
                    Markdown
                  </button>
                  <button
                    className="secondary-button secondary-button--quiet"
                    type="button"
                    onClick={() => void exportMainResume(latestMainResume.id, "json")}
                  >
                    JSON audit
                  </button>
                </div>
                {exportUsesLengthConstraint ? (
                  <p className="final-export-controls__note">
                    Length-constrained export can omit lower-priority sections or bullets. The draft preview below remains the full generated resume.
                  </p>
                ) : (
                  <p className="final-export-controls__note">
                    Full length export matches the draft content below. Choose one or two pages only when you want a compact ATS version.
                  </p>
                )}
              </div>
            </div>
            <div className="guardrail-banner" data-state={latestMainResume.status}>
              <strong>
                {latestMainResume.status === "validated"
                  ? "Fact Guard passed"
                  : "Draft only · Fact Guard needs review"}
              </strong>
              <p>
                {latestMainResume.status === "validated"
                  ? "Every generated claim is supported by approved evidence. DOCX, Markdown, and printable PDF export are enabled."
                : `${latestMainResumeClaimStats?.supported ?? 0}/${latestMainResumeClaimStats?.total ?? 0} claims supported. Fix unsupported claims or add evidence before using this as a final resume.`}
              </p>
            </div>
            <div className="final-review-panel__grid">
              <article className="final-review-checklist">
                <span>Finalization checklist</span>
                <ul>
                  <li data-state={resumeEligibleEvidence > 0 ? "ready" : "blocked"}>
                    <strong>Resume-safe evidence</strong>
                    <p>
                      {resumeEligibleEvidence > 0
                        ? `${resumeEligibleEvidence} approved evidence item${resumeEligibleEvidence === 1 ? "" : "s"} available.`
                        : "Approve at least one resume-safe evidence item first."}
                    </p>
                  </li>
                  <li
                    data-state={
                      latestMainResumeClaimStats && latestMainResumeClaimStats.total > 0 && latestMainResumeClaimStats.needsReview === 0
                        ? "ready"
                        : "blocked"
                    }
                  >
                    <strong>Claim support</strong>
                    <p>
                      {latestMainResumeClaimStats && latestMainResumeClaimStats.total > 0
                        ? `${latestMainResumeClaimStats.supported}/${latestMainResumeClaimStats.total} generated claims supported.`
                        : "No claim ledger was generated. Fact Guard cannot finalize this resume yet."}
                    </p>
                  </li>
                  <li data-state={latestMainResume.status === "validated" ? "ready" : "blocked"}>
                    <strong>Final export</strong>
                    <p>
                      {latestMainResume.status === "validated"
                        ? "DOCX, Markdown, and printable PDF export are ready."
                        : "Final exports stay locked until Fact Guard passes. JSON audit stays available."}
                    </p>
                  </li>
                </ul>
              </article>
              <article className="claim-review-summary">
                <span>Claim review</span>
                <strong>
                  {latestMainResumeClaimStats
                    ? `${latestMainResumeClaimStats.supported}/${latestMainResumeClaimStats.total}`
                    : "0/0"}
                </strong>
                <p>
                  {latestMainResumeClaimStats && latestMainResumeClaimStats.total === 0
                    ? "No claim ledger was generated. Fact Guard cannot finalize this resume yet."
                    : latestMainResumeClaimStats?.needsReview
                    ? `${latestMainResumeClaimStats.needsReview} claim${latestMainResumeClaimStats.needsReview === 1 ? "" : "s"} still need better evidence or wording.`
                    : "Every generated claim is currently supported."}
                </p>
                {latestMainResume.claims.length > 0 ? (
                  <div className="claim-review-list">
                    {latestMainResume.claims.slice(0, 5).map((claim) => {
                      const isSupported =
                        claim.support_status === "supported" || claim.claim_status === "supported";
                      return (
                        <div data-state={isSupported ? "ready" : "blocked"} key={claim.id}>
                          <i>{isSupported ? "Supported" : "Needs review"}</i>
                          <p>{claim.claim_text}</p>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </article>
            </div>
            <div className="final-resume-preview">
              <div>
                <span>Resume preview</span>
                <p>Read this as a draft artifact until Fact Guard passes.</p>
              </div>
              <pre>{latestMainResume.resume_markdown}</pre>
            </div>
            {latestMainResume.missing_evidence_questions.length > 0 ? (
              <div className="missing-evidence-panel">
                <strong>Missing evidence questions</strong>
                <ul>
                  {latestMainResume.missing_evidence_questions.map((question) => (
                    <li key={question}>{question}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
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

function getMainResumeClaimStats(resume: MainResumeSummary) {
  const total = resume.claims.length;
  const supported = resume.claims.filter(
    (claim) => claim.support_status === "supported" || claim.claim_status === "supported",
  ).length;
  const needsReview = Math.max(total - supported, 0);
  return { needsReview, supported, total };
}

function formatMainResumeUserState(resume: MainResumeSummary) {
  if (resume.status === "validated") return "Ready to export";
  if (resume.claims.length > 0) return "Draft needs review";
  return "Draft saved";
}

function formatMainResumeMode(resume: MainResumeSummary) {
  if (resume.positioning_title) return `${resume.positioning_title} variant`;
  if (resume.generation_mode === "resume_refresh") return "Refreshed resume";
  if (resume.generation_mode === "positioning_variant") return "Positioning variant";
  return "General resume";
}

function formatFactGuardSummary(
  resume: MainResumeSummary,
  stats: ReturnType<typeof getMainResumeClaimStats> | null,
) {
  if (resume.status === "validated") return "Exportable";
  if (!stats || stats.total === 0) return "Needs review";
  return `${stats.needsReview} to review`;
}

function formatLabel(format: "markdown" | "json" | "docx") {
  if (format === "docx") return "DOCX";
  if (format === "json") return "JSON audit";
  return "Markdown";
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
      <span>Coming later</span>
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
      <h2>System health and workspace settings</h2>
      <p>
        Review account protection, AI availability, storage, and recent workflow health without exposing secrets.
      </p>
      <div className="settings-panel__grid">
        <article>
          <span>Access</span>
          <strong>Account session</strong>
          <p>Protected by signed session cookies when account login is enabled.</p>
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

function getViewFromLocationHash(): View {
  if (typeof window === "undefined") return "dashboard";
  const hash = window.location.hash.replace(/^#\/?/, "");
  if (hash === "resume-review") return "profile";
  return hashViewMap[hash] ?? "dashboard";
}

function syncLocationHash(view: View, mode: "push" | "replace") {
  if (typeof window === "undefined") return;
  const hash = `#${viewHashMap[view]}`;
  if (window.location.hash === hash) return;
  const nextUrl = `${window.location.pathname}${window.location.search}${hash}`;
  if (mode === "replace") {
    window.history.replaceState({ view }, "", nextUrl);
    return;
  }
  window.history.pushState({ view }, "", nextUrl);
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
