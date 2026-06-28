# JobDesk Agent Instructions

## Scope

These instructions apply to the entire JobDesk repository.

JobDesk is a career operating system focused on resume preparation, evidence library management, role positioning, tailored resume generation, interview preparation, and job/application tracking. Treat the Evidence Library as the canonical source of truth. Generated resumes, cover letters, interview plans, and recommendations are derived artifacts.

## Required Working Style

- Read the relevant code and existing docs before changing behavior.
- Prefer narrow vertical slices with tests over broad rewrites.
- Preserve user data and provenance. Never silently promote raw source text, AI guesses, or user answers into resume-safe evidence.
- Keep source chunks and RAG outputs as discovery material only. Resume generation must use approved canonical evidence.
- Keep UI language user-facing. Avoid provider names, retry counts, schema/debug labels, or internal workflow names unless shown in diagnostics.
- Do not bypass Fact Guard, export gates, evidence approval, public-safe review, or user confirmation flows.

## Matt Pocock Skills

The following global skills are installed in WSL under `~/.agents/skills` and mirrored to `~/.codex/skills`. When a task matches one of these, open and follow the corresponding `SKILL.md` before acting.

- Use `diagnosing-bugs` before fixing unclear failures, regressions, slow flows, or broken UI/API behavior.
- Use `tdd` for bug fixes and feature implementation. Start with the smallest failing test or acceptance check when feasible.
- Use `codebase-design` before changing shared interfaces, state machines, repositories, schemas, or cross-module workflow boundaries.
- Use `domain-modeling` when changing JobDesk domain concepts such as evidence, claim, initiative, work experience, profile context, resume version, Fact Guard, or positioning.
- Use `grill-with-docs` for ambiguous product/design plans that need reviewer-ready docs.
- Use `to-prd` and `to-issues` when turning discussion into a PRD, roadmap, or implementation backlog.
- Use `review` for branch/change reviews. Findings must lead, with severity and file references.
- Use `qa` for user-facing workflow QA and bug-report triage.
- Use `implement` for executing an issue/PRD after scope and acceptance criteria are clear.
- Use `prototype` only for throwaway UI/state/business-logic explorations, not production shortcuts.
- Use `improve-codebase-architecture` or `request-refactor-plan` before large refactors.
- Use `ubiquitous-language` or `decision-mapping` when terminology, sequencing, or investigation structure is unclear.
- Use `ask-matt` when unsure which Matt Pocock skill fits.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for `jkL970910/JobDesk`; external PRs are not a triage surface by default. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default Matt Pocock triage label vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

This is a single-context repo. Existing project docs live under `docs/`; create `CONTEXT.md` and `docs/adr/` lazily when domain-modeling or ADR work needs them. See `docs/agents/domain.md`.

## JobDesk Local Skills

JobDesk also has repo-local AI workflow skills in `skills/`. Use them when changing prompts, schemas, agent behavior, or workflow logic for the matching component.

- `profile-extraction`: profile facts and canonical profile extraction.
- `evidence-extraction`: source material to work experiences, initiatives, portfolio projects, evidence items, and extraction notes.
- `project-deidentification`: public-safe wording and de-company/internal de-identification.
- `claim-support-judgment`: Fact Guard, claim support status, evidence-grounding checks.
- `resume-tailoring`: main resume and tailored resume generation.
- `profile-positioning`: target role inference, role direction scoring, positioning variants.
- `jd-analysis`: job description parsing and requirement matching.
- `star-story-extraction`: STAR story generation and interview story material.
- `behavioral-interview-coach` and `interview-review`: interview preparation and answer review.
- `company-research`: public company/interview research.
- `job-recommendation-ranking`: job search recommendation ranking.
- `recruiting-email-classification`: mailbox/application status classification.
- `hr-screening-review`: recruiter-style resume review and screening feedback.

When a change touches one of these areas:

- Read the skill before editing prompts or workflow code.
- Keep hard rules aligned between skill text, runtime prompts, schemas, and tests.
- Add or update tests that assert the critical guardrails, not just happy-path output.

## Resume Preparation Guardrails

- Resume upload/review, Source Intake, Evidence Library, Main Resume, Tailored Resume, and Fact Guard are separate workflow stages.
- A resume source version is provenance, not the evidence library itself.
- Evidence, initiatives, work experiences, STAR stories, and profile facts must keep source provenance where possible.
- Work Experience is a role container. Initiatives are project/story containers. Evidence items are atomic factual claims.
- User answers to enrichment tasks should become reviewed proposals or typed updates before they affect canonical material.
- Updating an approved evidence item must return it to a review state and remove resume-safe eligibility until re-approved.
- Rejected roles/stories/evidence should be excluded from target pickers and generation inputs.
- Imported notes that are observations should be acknowledged or resolved through typed actions, not treated as evidence questions.
- Profile context can guide emphasis, but it is not factual evidence.

## RAG And Retrieval Guardrails

- Source chunks may be used for evidence discovery, gap analysis, and enrichment suggestions only.
- Resume generation must consume approved, resume-safe canonical evidence, not raw chunks or unapproved answers.
- Retrieval explanations must distinguish usable evidence from source material that still needs conversion.
- Reindexing should be best-effort after canonical mutations and must not block user saves unless explicitly required.

## UI/UX Standards

- Favor clear workflow state and one primary next action per screen.
- Reduce nested cards and repeated action labels.
- Use domain language users understand: role, project/story, claim, source, evidence, resume draft, validation.
- Hide engineering/debug details from normal product surfaces.
- Keep desktop layouts scannable: clear hierarchy, compact sections, readable cards, and predictable filters.
- Long queues should support focus, grouping, filtering, and low-risk batch actions.

## Verification

For code changes, run the smallest relevant checks first, then broaden as risk increases.

Common checks:

```bash
npm run typecheck
npm test -- <targeted test files>
npm run build
```

For database/repository changes, add or run integration tests where available. If DB integration tests are skipped because `JOBDESK_RUN_DB_INTEGRATION` is not enabled, mention that in the final response.

For frontend workflow changes, verify the affected local page manually or with browser automation when a dev server is available.

## Review Expectations

When reviewing:

- Findings first, ordered by severity.
- Include file and line references.
- Focus on user-facing regressions, data-safety issues, workflow breaks, missing tests, and guardrail violations.
- State clearly whether the change can be signed off, conditionally signed off, or should be blocked.
