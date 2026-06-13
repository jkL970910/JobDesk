"use client";

import { useEffect, useMemo, useState } from "react";

import { ApplicationTrackerWorkspace } from "../src/components/application-tracker-workspace";
import { InterviewPrepWorkspace } from "../src/components/interview-prep-workspace";
import { JdAnalysisWorkspace } from "../src/components/jd-analysis-workspace";
import {
  ProfileEvidenceWorkspace,
  type MaterialEntryIntent,
} from "../src/components/profile-evidence-workspace";
import { TailoredResumeWorkspace } from "../src/components/tailored-resume-workspace";
import { useAccess } from "../src/components/access-provider";

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
  profile: { displayName: string | null; updatedAt: string } | null;
  evidenceItems: Array<{
    id: string;
    status: string;
    evidence_type: string;
    sensitivity_level: string;
    allowed_usage: string[];
  }>;
  projectCards: Array<{ id: string; status: string }>;
};

type ResumeVersionSummary = {
  id: string;
  title: string;
  status: string;
  updatedAt: string;
  claims: Array<{ id: string; support_status: string; risk_level: string }>;
};

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
  const activeCopy = pageCopy[activeView];
  const activeStatus = useMemo(() => findStatus(activeView), [activeView]);
  function navigateToMaterial(intent: MaterialEntryIntent) {
    if (intent === "jd") {
      setActiveView("jobs");
      return;
    }
    setMaterialEntryIntent(intent);
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
                  className="app-sidebar__item"
                  data-active={item.id === activeView}
                  key={item.id}
                  onClick={() => navigateToView(item.id)}
                  type="button"
                >
                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.hint}</small>
                  </span>
                  <em data-status={item.status}>{statusLabel[item.status]}</em>
                </button>
              ))}
            </section>
          ))}
        </nav>

        <button
          className="app-sidebar__settings"
          data-active={activeView === "settings"}
          onClick={() => navigateToView("settings")}
          type="button"
        >
          Settings
          <span>{statusLabel[findStatus("settings")]}</span>
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
            <em data-status={activeStatus}>{statusLabel[activeStatus]}</em>
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
          {activeView === "evidence" ? (
            <ProfileEvidenceWorkspace
              entryIntent={materialEntryIntent}
              initialSection={materialInitialSection}
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
  const cards = [
    {
      label: "Material Library",
      value: "Live",
      note: "Resume/project source ingestion, evidence review, dedupe, STAR stories",
      action: "Open Evidence",
      view: "evidence" as View,
    },
    {
      label: "Job Workspace",
      value: "Live",
      note: "JD analysis, tailored resume review, interview prep, status tracking",
      action: "Open Jobs",
      view: "jobs" as View,
    },
    {
      label: "Main Resume",
      value: "Planned",
      note: "General-purpose resume for LinkedIn, recruiters, and cold outreach",
      action: "Open Profile",
      view: "profile" as View,
    },
    {
      label: "Job Scout",
      value: "Planned",
      note: "Future daily role discovery with fit reasons and risk notes",
      action: "View Plan",
      view: "recommendations" as View,
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
      action: "Build library",
      body:
        "Start from project notes, guided answers, or detailed source docs before generating a main resume.",
      intent: "scratch" as const,
      title: "Build from scratch",
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
      <section className="hero-panel">
        <p className="panel-kicker">Current product loop</p>
        <h2>Prepare reusable career material first. Apply it to each JD second.</h2>
        <p>
          Live sections use your saved job, evidence, resume, and interview-prep
          data. Planned sections stay visible without pretending work exists yet.
        </p>
        <div className="hero-panel__steps">
          <span>1 · Evidence</span>
          <span>2 · JD Analysis</span>
          <span>3 · Resume Guard</span>
          <span>4 · Interview Prep</span>
          <span>5 · Tracker</span>
        </div>
      </section>

      <section className="entry-path-board" aria-label="Start JobDesk workflow">
        {entryPaths.map((path) => (
          <article key={path.intent}>
            <span>{path.title}</span>
            <p>{path.body}</p>
            <button type="button" onClick={() => onStartMaterialPath(path.intent)}>
              {path.action}
            </button>
          </article>
        ))}
      </section>

      <section className="status-board">
        {cards.map((card) => (
          <article className="status-card" key={card.label}>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            <p>{card.note}</p>
            <button type="button" onClick={() => onNavigate(card.view)}>
              {card.action}
            </button>
          </article>
        ))}
      </section>
    </div>
  );
}

function ProfileReferenceView({ onNavigate }: { onNavigate: (view: View) => void }) {
  const { fetchJson } = useAccess();
  const [library, setLibrary] = useState<EvidenceLibrarySummary | null>(null);
  const [resumes, setResumes] = useState<ResumeVersionSummary[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(
    "loading",
  );

  useEffect(() => {
    let cancelled = false;

    async function loadProfileSurface() {
      setLoadState("loading");
      try {
        const [libraryResponse, resumesResponse] = await Promise.all([
          fetchJson("/api/profile-evidence/recent"),
          fetchJson("/api/resumes/recent"),
        ]);
        if (cancelled) return;
        if (!libraryResponse.ok || !resumesResponse.ok) {
          setLoadState("error");
          return;
        }
        const libraryPayload = (await libraryResponse.json()) as {
          data?: EvidenceLibrarySummary;
        };
        const resumePayload = (await resumesResponse.json()) as {
          data?: ResumeVersionSummary[];
        };
        if (cancelled) return;
        setLibrary(libraryPayload.data ?? null);
        setResumes(resumePayload.data ?? []);
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

  const approvedEvidence =
    library?.evidenceItems.filter((item) => item.status === "approved").length ?? 0;
  const resumeEligibleEvidence =
    library?.evidenceItems.filter((item) => item.allowed_usage.includes("resume"))
      .length ?? 0;
  const privateEvidence =
    library?.evidenceItems.filter(
      (item) => item.sensitivity_level !== "public_safe",
    ).length ?? 0;
  const latestResume = resumes[0] ?? null;

  return (
    <div className="profile-reference">
      <section className="profile-card">
        <p className="panel-kicker">Overview</p>
        <h2>Profile is the factual skeleton</h2>
        <p>
          Profile separates identity facts from reusable claims. Work history,
          education, skills, preferences, source documents, and evidence coverage
          belong here. Achievement bullets belong in Evidence Library.
        </p>
        <div className="profile-card__facts">
          <span>Contact + target roles</span>
          <span>Work experience frame</span>
          <span>Education + skills</span>
          <span>Evidence coverage by role</span>
        </div>
      </section>

      <section className="profile-live-summary" data-state={loadState}>
        <div className="profile-live-summary__header">
          <div>
            <p className="panel-kicker">Live MVP data</p>
            <h3>
              {library?.profile?.displayName ?? "Profile data will appear after source extraction"}
            </h3>
          </div>
          <span>{loadState}</span>
        </div>
        <div className="profile-live-summary__grid">
          <article>
            <span>Evidence</span>
            <strong>{library?.evidenceItems.length ?? 0}</strong>
            <p>{approvedEvidence} approved · {resumeEligibleEvidence} resume-eligible</p>
          </article>
          <article>
            <span>Projects</span>
            <strong>{library?.projectCards.length ?? 0}</strong>
            <p>Structured project cards from resume and project-note sources.</p>
          </article>
          <article>
            <span>Privacy review</span>
            <strong>{privateEvidence}</strong>
            <p>Private or sensitive evidence items need usage-aware handling.</p>
          </article>
          <article>
            <span>Resume versions</span>
            <strong>{resumes.length}</strong>
            <p>{latestResume ? `${latestResume.title} · ${latestResume.status}` : "No tailored resumes yet"}</p>
          </article>
        </div>
      </section>

      <section className="profile-tabs-preview">
        <article>
          <span>Overview</span>
          <p>Career identity and work-experience skeleton.</p>
        </article>
        <article>
          <span>Main Resume</span>
          <p>General resume for LinkedIn, recruiter sharing, and cold outreach.</p>
        </article>
        <article>
          <span>Source Documents</span>
          <p>Current ingestion lives in the Material Library builder.</p>
        </article>
        <article>
          <span>Resume Versions</span>
          <p>Index of main and job-specific resume versions; editing stays in the owning workspace.</p>
        </article>
      </section>

      <section className="handoff-panel">
        <div>
          <p className="panel-kicker">Current implementation</p>
          <h3>Use Evidence Library for source ingestion and claim review.</h3>
          <p>
            Profile tabs will become richer as profile and main-resume features
            move out of the current material-library surface.
          </p>
        </div>
        <button type="button" onClick={() => onNavigate("evidence")}>
          Open Evidence Library
        </button>
      </section>
    </div>
  );
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
  return (
    <section className="settings-panel">
      <p className="panel-kicker">Current deployment controls</p>
      <h2>Personal MVP settings</h2>
      <p>
        JobDesk currently uses server-side AI configuration, separate project
        storage, Vercel deployment, and an optional personal access token.
        Full accounts, workspace isolation, and OAuth integrations are future work.
      </p>
      <div className="settings-panel__grid">
        <article>
          <span>Access</span>
          <strong>Optional bearer token</strong>
          <p>Stored locally in the browser only when protection is enabled.</p>
        </article>
        <article>
          <span>AI</span>
          <strong>Server env only</strong>
          <p>Model credentials stay server-side and are not exposed in the UI.</p>
        </article>
        <article>
          <span>Data</span>
          <strong>Separate JobDesk DB</strong>
          <p>Project data stays separate from Portfolio Manager and AlignerLog.</p>
        </article>
      </div>
    </section>
  );
}
