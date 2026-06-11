# Job Search Copilot PRD

Version: 0.1  
Status: Draft for review  
Date: 2026-06-09  
Primary audience: Product, design, engineering, AI/ML, and career-domain reviewers  

## 1. Executive Summary

Job Search Copilot is an AI-powered job search workspace designed to help professionals prepare for, apply to, and track job opportunities with higher conversion and better interview readiness.

The product is not only a resume generator. It is a structured career operating system that maintains a private evidence-backed profile, analyzes job descriptions, creates tailored application materials, prepares interview plans, recommends relevant jobs, and tracks application outcomes.

The core product thesis is:

> Job search outcomes improve when every generated resume bullet, cover letter claim, and interview answer is grounded in verified personal evidence and continuously improved through application and interview feedback.

The initial product should prioritize a complete high-quality loop:

1. Import and structure the user's resume and work history.
2. Build a reusable evidence library of projects, achievements, metrics, and STAR stories.
3. Analyze each target job description.
4. Generate tailored resumes and application documents using only verified evidence.
5. Prepare interview materials based on the tailored resume, target job, and company research.
6. Track application status and outcomes.
7. Feed interview/application feedback back into the user's profile and strategy.

## 2. Problem Statement

Job seekers face five recurring problems:

1. Their resume is often generic and not adapted to each role.
2. Their strongest work examples are scattered across memory, documents, internal project notes, performance reviews, and past resumes.
3. They struggle to convert private company-specific project details into safe external-facing language.
4. They prepare for interviews too broadly instead of focusing on likely questions tied to the job, company, and their resume.
5. They lack a reliable system for tracking applications, responses, interviews, follow-ups, and conversion metrics.

Existing AI resume tools typically solve only one fragment of this workflow. They often generate polished text but fail to guarantee factual grounding, privacy safety, role-specific strategy, and long-term learning from outcomes.

## 3. Product Vision

Build a private AI career workspace that acts like:

- A professional HR reviewer.
- A resume strategist.
- A personal evidence librarian.
- A job-specific interview coach.
- A lightweight application CRM.
- A job discovery assistant.

The product should make the user feel more prepared, more organized, and more strategic, while reducing repetitive manual work.

## 4. Target Users

### 4.1 Primary Persona: Active Professional Job Seeker

Profile:
- 2-10 years of experience.
- Has multiple projects and achievements but lacks a structured personal portfolio.
- Applies to roles across several companies and wants tailored materials.
- Needs to convert internal work into safe external language.

Needs:
- Evidence-backed resume rewriting.
- Project de-identification.
- Job-specific customization.
- Interview story preparation.
- Application tracking.

### 4.2 Secondary Persona: Student or Early-Career Candidate

Profile:
- 0-3 years of experience.
- Has internships, academic projects, campus leadership, research, or side projects.
- Needs help translating experience into professional hiring language.

Needs:
- Resume quality review.
- JD-to-experience matching.
- Behavioral interview preparation.
- Basic pipeline tracking.

### 4.3 Future Persona: Career Coach / Advisor

Profile:
- Helps multiple candidates prepare applications.
- Needs review workflows, comments, and candidate progress visibility.

Needs:
- Multi-user management.
- Review comments.
- Template management.
- Outcome analytics.

This persona is out of scope for MVP.

## 5. Goals and Non-Goals

### 5.1 Goals

G1. Help users produce stronger role-specific resumes and application materials.

G2. Create a reusable personal evidence library from resumes, project notes, work summaries, and interview feedback.

G3. Prevent hallucinated or unsupported claims in generated materials.

G4. Help users prepare for interviews using job-specific and resume-specific question prediction.

G5. Track application progress and outcomes in a structured dashboard.

G6. Recommend relevant open jobs based on user goals, experience, and application strategy.

G7. Provide a privacy-aware system suitable for sensitive career and work data.

### 5.2 Non-Goals for MVP

NG1. Fully automatic job application submission.

NG2. Fully automatic email sending without user approval.

NG3. Replacing professional legal, immigration, or compensation advice.

NG4. Multi-user career coaching platform.

NG5. Enterprise ATS integration.

NG6. Building a public social network or public portfolio site.

## 6. Success Metrics

### 6.1 Activation Metrics

- Percentage of users who import a resume and complete profile extraction.
- Percentage of users who create at least one job workspace.
- Percentage of users who generate a tailored resume for a job.
- Percentage of users who create at least three evidence cards.

### 6.2 Engagement Metrics

- Number of job workspaces created per active user.
- Number of tailored resumes generated per active user.
- Number of interview prep packs generated.
- Weekly active usage during an active job search period.
- Percentage of users who update application statuses.

### 6.3 Outcome Metrics

- Application response rate.
- Interview conversion rate from applied jobs.
- Interview-to-offer conversion rate.
- Time from job discovery to application-ready materials.
- User-reported quality score for tailored resumes and interview prep.

### 6.4 Quality Metrics

- Percentage of generated resume bullets linked to evidence.
- Number of unsupported claim violations detected by fact guard.
- Number of user edits required before using generated documents.
- Percentage of generated documents passing schema and template validation.

## 7. Product Principles

1. Evidence first: no important claim should appear without source evidence or user confirmation.
2. Human in control: the user approves sensitive actions and final documents.
3. Role-specific, not generic: every output should be grounded in the target job.
4. Privacy by design: sensitive company and personal information must be protected.
5. Workflow over chat: important outputs are saved as versioned workspace assets, not lost in chat history.
6. Continuous learning: application outcomes and interview reviews improve future recommendations.
7. Clear next action: the product should always suggest the next useful step.
8. Selective application strategy: the product should help users avoid stale, low-fit, or suspicious postings rather than maximize application volume.

## 8. Product Scope

### 8.1 MVP Scope

MVP should include:

- Resume import and extraction.
- Structured main resume.
- Evidence library for projects, achievements, metrics, and STAR stories.
- Job workspace creation from pasted JD.
- JD analysis, including role archetype detection and posting-legitimacy assessment.
- Resume-to-JD matching.
- Tailored resume generation.
- Cover letter and application answer generation.
- HR-style review and fact checking.
- Interview preparation pack.
- Manual application tracker with canonical application statuses.
- Basic dashboard.

### 8.2 Phase 2 Scope

Phase 2 should include:

- Company and interview research using external search.
- Browser extension or clipping flow for job descriptions.
- Job-source scanner with liveness checks for stale, closed, or suspicious postings.
- Daily job recommendations.
- Gmail/Outlook integration for application status detection.
- Follow-up reminders.
- Interview review and growth profile.
- Reusable interview story bank using STAR+Reflection patterns.
- Resume version performance analytics.

### 8.3 Phase 3 Scope

Phase 3 should include:

- Semi-automated application workflows with explicit approval.
- Calendar integration for interview preparation reminders.
- Multi-resume strategy planning.
- Advanced ranking and experimentation across resume versions.
- Career coach collaboration.
- Deeper job market analytics.

## 9. Core Concepts

### 9.1 Personal Profile

The canonical representation of the user:

- Contact information.
- Education.
- Work experience.
- Skills.
- Certifications.
- Target roles.
- Preferences.
- Constraints.

### 9.2 Evidence

An evidence item is a verified or user-confirmed fact that can support a resume bullet, cover letter claim, or interview answer.

Examples:
- "Led migration of reporting workflow from manual spreadsheets to automated dashboard."
- "Reduced weekly reporting time by 6 hours."
- "Supported 3 regional business teams."

Each evidence item should include:

- Source document.
- Confidence level.
- Sensitivity level.
- Allowed usage.
- Related projects and skills.

### 9.3 Project Card

A structured representation of an important past project.

Fields:
- Project name.
- Business context.
- Problem.
- User role.
- Actions.
- Results.
- Metrics.
- Tools/technologies.
- Stakeholders.
- STAR stories.
- Public-safe version.
- Related evidence IDs.

### 9.4 Job Workspace

A per-role workspace containing:

- Job metadata.
- JD.
- JD analysis.
- Match score.
- Tailored resume.
- Cover letter.
- Application answers.
- Interview prep pack.
- Company research.
- Application status.
- Notes and follow-ups.

### 9.5 Interview Growth Profile

A running summary of the user's interview strengths, repeated weaknesses, knowledge gaps, and answer strategy.

## 10. User Journeys

### 10.1 Onboarding and Resume Import

1. User creates a workspace.
2. User uploads a resume or past materials.
3. System extracts structured profile data.
4. System highlights missing or low-confidence fields.
5. User confirms or edits extracted data.
6. System creates the main resume and initial evidence library.

Success criteria:
- User can complete onboarding in under 15 minutes.
- Extracted facts are traceable to source text.
- User can see what still needs confirmation.

### 10.2 Evidence Library Creation

1. User uploads project notes, performance reviews, or past summaries.
2. Evidence Curator Agent extracts projects, metrics, and STAR stories.
3. System marks sensitive company-specific content.
4. User approves public-safe versions.
5. Approved items become reusable application and interview context.

Success criteria:
- Each project card has at least one action and one result.
- Sensitive terms are flagged.
- Public-safe language is available before external document generation.

### 10.3 Job Workspace Creation

1. User pastes a JD or imports a job link.
2. System extracts company, title, level, location, requirements, and responsibilities.
3. System creates a job workspace.
4. System produces a JD analysis and match overview.

Success criteria:
- User can create a job workspace in under 2 minutes from pasted JD.
- System identifies hard requirements and top role signals.

### 10.4 Tailored Resume Generation

1. User selects a job workspace.
2. System retrieves relevant evidence and resume sections.
3. Resume Tailor Agent creates a role-specific resume draft.
4. Fact Guard validates all claims against evidence.
5. HR Reviewer Agent scores the resume and suggests improvements.
6. User reviews and exports the result.

Success criteria:
- Every major generated claim is evidence-linked or marked for user confirmation.
- The tailored resume can be exported as PDF, DOCX, Markdown, and ATS-friendly text.

### 10.5 Cover Letter and Application Answers

1. User chooses output type.
2. System uses JD analysis, company information, and evidence library.
3. System drafts the response.
4. Fact Guard checks unsupported claims and company-specific statements.
5. User edits and saves.

Success criteria:
- Generated answers are concise, role-specific, and directly reusable.
- Unsupported claims are blocked or clearly marked.

### 10.6 Interview Preparation

1. User selects a job workspace and tailored resume.
2. Interview Coach Agent generates question predictions.
3. Company Research Agent optionally adds public interview/company insights.
4. System creates an interview prep pack.
5. User practices answers and records notes.

Success criteria:
- Prep pack includes high-probability questions, project deep dives, behavioral stories, knowledge gaps, and action checklist.
- For each project, system predicts likely follow-up questions.

### 10.7 Interview Review

1. User enters interview transcript or notes.
2. System categorizes questions and answers.
3. Interview Review Agent identifies knowledge gaps and communication issues.
4. System creates action items.
5. Key lessons update the Interview Growth Profile.

Success criteria:
- Review separates content gaps from communication gaps.
- Follow-up preparation recommendations are concrete and time-bound.

### 10.8 Job Recommendations

1. User defines target role, level, location, industry, and constraints.
2. Job Scout Agent searches configured sources daily.
3. System ranks jobs based on profile fit and strategy.
4. User saves or dismisses recommended jobs.

Success criteria:
- Recommendations include explanation, risk, source link, and match rationale.
- Duplicate jobs are consolidated.

### 10.9 Application Tracking

1. User marks jobs as saved, prepared, applied, interviewing, offered, rejected, or withdrawn.
2. System displays pipeline dashboard.
3. Email integration optionally detects recruiting messages.
4. System suggests status updates for approval.

Success criteria:
- User can understand pipeline health at a glance.
- Email-detected updates are not applied without user approval in MVP/Phase 2.

## 11. Functional Requirements

### 11.1 Resume and Profile Intake

FR-001: The system shall allow users to upload PDF, DOCX, Markdown, and plain text resumes.

FR-002: The system shall extract resume content into a structured profile schema.

FR-003: The system shall preserve the original imported document.

FR-004: The system shall show extraction confidence and fields requiring review.

FR-005: The system shall support manual editing of the main resume/profile.

### 11.2 Evidence Library

FR-010: The system shall extract projects, achievements, metrics, skills, and responsibilities from user-uploaded materials.

FR-011: The system shall create reusable evidence cards with source references.

FR-012: The system shall allow users to mark evidence as private, public-safe, or sensitive.

FR-013: The system shall generate public-safe versions of company-specific project descriptions.

FR-014: The system shall support STAR story generation for approved evidence.

FR-015: The system shall allow users to approve, reject, edit, and merge evidence cards.

### 11.3 Job Workspace

FR-020: The system shall allow users to create a job workspace from pasted JD text.

FR-021: The system shall extract company, role, location, level, responsibilities, requirements, and preferred qualifications.

FR-022: The system shall store original JD text.

FR-023: The system shall create a job requirement matrix.

FR-024: The system shall calculate a resume-to-JD match score.

### 11.4 Tailored Resume

FR-030: The system shall generate a tailored resume for a selected job.

FR-031: The system shall retrieve relevant evidence based on JD requirements.

FR-032: The system shall link generated resume claims to evidence IDs where possible.

FR-033: The system shall flag unsupported claims for user confirmation.

FR-034: The system shall provide an HR-style review of the generated resume.

FR-035: The system shall support resume versioning.

FR-036: The system shall export resumes in Markdown, PDF, DOCX, and plain text formats.

### 11.5 Application Documents

FR-040: The system shall generate cover letters for selected jobs.

FR-041: The system shall generate answers to custom application questions.

FR-042: The system shall generate short recruiter outreach messages.

FR-043: The system shall check generated documents for unsupported claims.

FR-044: The system shall save generated documents inside the job workspace.

### 11.6 Interview Preparation

FR-050: The system shall generate an interview preparation pack for a job workspace.

FR-051: The preparation pack shall include likely questions, answer frameworks, project deep dives, behavioral stories, and knowledge gaps.

FR-052: The system shall generate project-specific follow-up question chains.

FR-053: The system shall generate 60-90 second sample answers grounded in evidence.

FR-054: The system shall create an interview action checklist.

### 11.7 Company and Interview Research

FR-060: The system shall optionally search public sources for company and interview information.

FR-061: The system shall cite sources for external research findings.

FR-062: The system shall distinguish high-confidence official information from lower-confidence public interview reports.

FR-063: The system shall not present unverified public interview reports as facts.

### 11.8 Application Tracking

FR-070: The system shall provide application statuses: saved, preparing, applied, recruiter response, assessment, interview, offer, rejected, withdrawn.

FR-071: The system shall allow manual status updates.

FR-072: The system shall display pipeline counts and conversion rates.

FR-073: The system shall store application dates, follow-up dates, interview dates, and notes.

FR-074: The system shall support reminders.

### 11.9 Email Integration

FR-080: The system shall allow users to connect Gmail or Outlook with OAuth.

FR-081: The system shall classify recruiting-related emails.

FR-082: The system shall suggest application status updates based on emails.

FR-083: The system shall require user approval before updating important statuses.

FR-084: The system shall never send email without explicit user action.

### 11.10 Job Recommendations

FR-090: The system shall allow users to define target roles and preferences.

FR-091: The system shall search configured job sources on a schedule.

FR-092: The system shall rank jobs based on fit, seniority, location, constraints, and strategy.

FR-093: The system shall explain each recommendation.

FR-094: The system shall allow users to save, dismiss, or create a job workspace from recommendations.

### 11.11 Dashboard

FR-100: The system shall show application pipeline status.

FR-101: The system shall show response rate and interview conversion rate.

FR-102: The system shall show pending actions.

FR-103: The system shall show upcoming interviews and follow-ups.

FR-104: The system shall show resume/document versions associated with each application.

## 12. AI Agent Requirements

The system shall support specialized agents. Each agent must have:

- Clear instructions.
- Explicit input and output schema.
- Allowed tools.
- Prohibited actions.
- Guardrails.
- Trace logs.
- Evaluation criteria.

Required agents:

1. Profile Intake Agent.
2. Evidence Curator Agent.
3. JD Analyst Agent.
4. Resume Tailor Agent.
5. HR Reviewer Agent.
6. Fact Guard Agent.
7. Company Research Agent.
8. Interview Coach Agent.
9. Interview Review Agent.
10. Job Scout Agent.
11. Pipeline Tracker Agent.

## 13. UX Requirements

UX-001: The product shall use a workspace-oriented layout, with persistent navigation for Profile, Evidence Library, Jobs, Interviews, Applications, and Dashboard.

UX-002: Each job shall have a dedicated workspace.

UX-003: Generated artifacts shall be saved as files or structured records, not only chat messages.

UX-004: Users shall be able to inspect evidence behind generated claims.

UX-005: Users shall be able to approve, reject, or edit AI suggestions.

UX-006: The dashboard shall prioritize the next best action.

UX-007: The product shall avoid marketing-style landing pages inside the main app and focus on operational workflows.

## 14. Privacy, Security, and Compliance Requirements

SEC-001: User data shall be private by default.

SEC-002: The system shall support deletion/export of user data.

SEC-003: Sensitive company information shall be classified and blocked from public-facing outputs unless explicitly approved.

SEC-004: OAuth tokens shall be encrypted at rest.

SEC-005: API keys and credentials shall not be exposed to the browser unless intentionally configured for local-only mode.

SEC-006: Tool calls that read external accounts shall be logged.

SEC-007: Tool calls that write, send, submit, or modify external data shall require explicit approval.

SEC-008: Generated outputs shall include no fabricated employment history, dates, degrees, companies, project metrics, or skills.

SEC-009: The system shall maintain audit logs for generated documents and status changes.

## 15. Quality and Guardrail Requirements

QG-001: Structured outputs shall be validated with schemas.

QG-002: Resume bullets shall be checked against evidence.

QG-003: External research shall include source links.

QG-004: Generated documents shall be checked for unsupported claims.

QG-005: Sensitive information detection shall run before public-facing output generation.

QG-006: The system shall allow partial drafts to be saved when AI generation fails.

QG-007: Users shall see warnings when generated output has low evidence coverage.

## 16. MVP Acceptance Criteria

The MVP is acceptable when:

1. A user can import a resume and review a structured profile.
2. A user can create at least five evidence cards from resume/project materials.
3. A user can create a job workspace from a pasted JD.
4. The system can produce a JD analysis and match matrix.
5. The system can generate a tailored resume linked to evidence.
6. The system can flag unsupported claims.
7. The system can generate a cover letter and short application answer.
8. The system can generate an interview prep pack.
9. The user can manually track application status.
10. The dashboard shows pipeline counts and next actions.

## 17. Risks and Mitigations

### 17.1 Hallucinated Claims

Risk: AI may create unsupported achievements, skills, or metrics.  
Mitigation: Evidence-linked generation, Fact Guard Agent, schema validation, and user confirmation.

### 17.2 Sensitive Data Leakage

Risk: Internal company details may appear in public-facing materials.  
Mitigation: Sensitivity classification, de-identification, blocked terms, and approval workflow.

### 17.3 Low-Quality Job Recommendations

Risk: Recommendations may be noisy or outdated.  
Mitigation: Source freshness checks, user feedback, deduplication, and recommendation explanation.

### 17.4 External Search Reliability

Risk: Public interview information may be inaccurate or anecdotal.  
Mitigation: Source scoring and explicit confidence labels.

### 17.5 Tool Permission Risk

Risk: Connected tools such as email may expose private data or perform unwanted actions.  
Mitigation: Least-privilege OAuth scopes, read-only defaults, approval for writes, audit logs.

### 17.6 Workflow Complexity

Risk: Too many agents can create unpredictable behavior.  
Mitigation: Deterministic workflow orchestration, strict tool permissions, structured outputs, and trace logs.

## 18. Open Questions

1. Should the first version be local-first, cloud-first, or hybrid?
2. Which user segment should be prioritized: students, early-career, or experienced professionals?
3. Which job markets and sources should be supported first?
4. Which export formats are mandatory for MVP?
5. Should user-owned model API keys be supported in MVP?
6. How much external company research should be included before creating interview prep?
7. What level of privacy guarantee is required for internal project materials?
8. Should the product eventually support one-click application flows?

## 19. Competitive and Reference Notes

The referenced project, curator-ai, demonstrates a useful local-first job search workspace pattern:

- Resume management.
- Job workspaces.
- Tailored resumes.
- Interview prep packs.
- Interview reviews.
- Local browser storage.

This PRD expands the concept into a more complete product with:

- Evidence-backed personal knowledge base.
- Project de-identification.
- Agent-based quality checks.
- External company/interview research.
- Daily job recommendations.
- Email-based pipeline tracking.
- Application analytics.

## 20. Suggested Roadmap

### Milestone 1: Foundation

- App shell.
- Auth or local workspace.
- Profile import.
- Structured resume editor.
- Evidence library.
- Basic LLM provider integration.

### Milestone 2: Job Workspace

- JD intake.
- JD analysis.
- Match matrix.
- Tailored resume generation.
- Cover letter/application answers.
- HR review and fact guard.

### Milestone 3: Interview Loop

- Interview prep pack.
- Project follow-up chains.
- Behavioral answer library.
- Interview review.
- Growth profile.

### Milestone 4: Tracking

- Application CRM.
- Dashboard.
- Reminders.
- Resume version tracking.

### Milestone 5: Automation

- Job recommendations.
- Browser clipping.
- Company/interview search.
- Email integration.
- Follow-up suggestions.
