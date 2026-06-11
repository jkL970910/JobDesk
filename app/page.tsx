import { JdAnalysisWorkspace } from "../src/components/jd-analysis-workspace";
import { ProfileEvidenceWorkspace } from "../src/components/profile-evidence-workspace";
import { TailoredResumeWorkspace } from "../src/components/tailored-resume-workspace";

export default function HomePage() {
  return (
    <main className="workspace">
      <header className="workspace__header">
        <div className="workspace__eyebrow">JobDesk Phase 1.1</div>
        <h1 className="workspace__title">Evidence-grounded job workbench.</h1>
        <p className="workspace__subtitle">
          Paste a job description, generate a verified requirement matrix, reload
          recent analyses, and re-run or archive work without exposing provider
          keys to the browser.
        </p>
      </header>
      <JdAnalysisWorkspace />
      <section className="workspace__header workspace__header--section">
        <div className="workspace__eyebrow">Profile Evidence</div>
        <h2 className="workspace__section-title">Reusable career facts.</h2>
        <p className="workspace__subtitle">
          Paste resume text or project notes to create a grounded profile and
          reusable evidence drafts for future resume tailoring.
        </p>
      </section>
      <ProfileEvidenceWorkspace />
      <section className="workspace__header workspace__header--section">
        <div className="workspace__eyebrow">Resume Tailoring</div>
        <h2 className="workspace__section-title">Draft with claim provenance.</h2>
        <p className="workspace__subtitle">
          Generate a role-specific resume only from approved evidence that has
          been explicitly allowed for resume use.
        </p>
      </section>
      <TailoredResumeWorkspace />
    </main>
  );
}
