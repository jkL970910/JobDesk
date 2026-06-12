import { ApplicationTrackerWorkspace } from "../src/components/application-tracker-workspace";
import { InterviewPrepWorkspace } from "../src/components/interview-prep-workspace";
import { JdAnalysisWorkspace } from "../src/components/jd-analysis-workspace";
import { ProfileEvidenceWorkspace } from "../src/components/profile-evidence-workspace";
import { TailoredResumeWorkspace } from "../src/components/tailored-resume-workspace";

export default function HomePage() {
  return (
    <main className="workspace">
      <header className="workspace__header">
        <div className="workspace__hero">
          <div>
            <div className="workspace__eyebrow">JobDesk Phase 1.1</div>
            <h1 className="workspace__title">Job search command center</h1>
            <p className="workspace__subtitle">
              Build a reusable career material library first, then use it inside job-specific workspaces for resumes, interviews, and tracking.
            </p>
          </div>
          <div className="workspace__status-panel" aria-label="Workflow coverage">
            <span>Material library</span>
            <span>Evidence review</span>
            <span>JD workspace</span>
            <span>Resume + Fact Guard</span>
            <span>Interview + tracker</span>
          </div>
        </div>
      </header>

      <section className="workspace__header workspace__header--section">
        <div className="workspace__eyebrow">Workflow 1 · Material Library</div>
        <h2 className="workspace__section-title">Prepare reusable career facts</h2>
        <p className="workspace__subtitle">
          Convert resumes, project notes, and accomplishment drafts into approved evidence, project cards, and STAR-ready story material before picking a role.
        </p>
      </section>
      <ProfileEvidenceWorkspace />

      <section className="workspace__header workspace__header--section">
        <div className="workspace__eyebrow">Workflow 2 · Job Workspace</div>
        <h2 className="workspace__section-title">Apply the material library to one role</h2>
        <p className="workspace__subtitle">
          Analyze a target JD, select approved evidence, generate a traceable resume, prepare interview material, and track the application manually.
        </p>
      </section>
      <JdAnalysisWorkspace />

      <section className="workspace__header workspace__header--section">
        <div className="workspace__eyebrow">Job Workspace · Resume Tailoring</div>
        <h2 className="workspace__section-title">Draft with claim provenance</h2>
        <p className="workspace__subtitle">
          Generate role-specific resume drafts only after a JD and approved material-library evidence are both ready.
        </p>
      </section>
      <TailoredResumeWorkspace />

      <section className="workspace__header workspace__header--section">
        <div className="workspace__eyebrow">Job Workspace · Interview Prep</div>
        <h2 className="workspace__section-title">Practice from grounded stories</h2>
        <p className="workspace__subtitle">
          Build behavioral questions, review topics, research prompts, and gaps from the selected JD plus approved STAR-ready material.
        </p>
      </section>
      <InterviewPrepWorkspace />

      <section className="workspace__header workspace__header--section">
        <div className="workspace__eyebrow">Job Workspace · Application Tracker</div>
        <h2 className="workspace__section-title">Close the job loop</h2>
        <p className="workspace__subtitle">
          Keep each analyzed role in a manual pipeline after review, tailoring, or interview preparation.
        </p>
      </section>
      <ApplicationTrackerWorkspace />
    </main>
  );
}
