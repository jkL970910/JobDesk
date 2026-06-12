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
              Analyze roles, curate grounded career evidence, tailor resumes, and prepare interview stories from one reviewable workspace.
            </p>
          </div>
          <div className="workspace__status-panel" aria-label="Workflow coverage">
            <span>JD analysis</span>
            <span>Evidence library</span>
            <span>Tailored resume</span>
            <span>Interview prep</span>
          </div>
        </div>
      </header>

      <JdAnalysisWorkspace />

      <section className="workspace__header workspace__header--section">
        <div className="workspace__eyebrow">Profile Evidence</div>
        <h2 className="workspace__section-title">Reusable career facts</h2>
        <p className="workspace__subtitle">
          Convert resumes and project notes into approved evidence, project cards, and STAR-ready story material.
        </p>
      </section>
      <ProfileEvidenceWorkspace />

      <section className="workspace__header workspace__header--section">
        <div className="workspace__eyebrow">Resume Tailoring</div>
        <h2 className="workspace__section-title">Draft with claim provenance</h2>
        <p className="workspace__subtitle">
          Generate role-specific resume drafts from approved evidence and keep every claim traceable.
        </p>
      </section>
      <TailoredResumeWorkspace />

      <section className="workspace__header workspace__header--section">
        <div className="workspace__eyebrow">Interview Prep</div>
        <h2 className="workspace__section-title">Practice from grounded stories</h2>
        <p className="workspace__subtitle">
          Build behavioral questions, review topics, research prompts, and gaps from analyzed jobs and indexed evidence.
        </p>
      </section>
      <InterviewPrepWorkspace />
    </main>
  );
}
