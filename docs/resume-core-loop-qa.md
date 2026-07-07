# Resume Core Loop QA

This checklist protects the current JobDesk resume workflow while new workflow/module work is frozen:

1. Source Intake and Resume Review create durable reviewed sources.
2. Evidence Library stores canonical, source-grounded material.
3. Evidence actions are explicit and preserve provenance.
4. Main and Tailored Resume generation only consume eligible evidence.
5. Fact Guard and readiness worklists control final export.

## Automated Verification

Default local verification:

```bash
npm run verify:resume-core
```

This runs the targeted Resume Core Loop tests, `npm run typecheck`, and `npm run build`.

Database-backed verification:

```bash
npm run verify:resume-core -- --integration
```

The integration option runs the configured `npm run test:integration` suite and writes temporary workflow rows to the configured JobDesk database.

To inspect the plan without running it:

```bash
npm run verify:resume-core -- --list
```

## Manual QA Pass

Run this pass after the automated checks when changing source intake, evidence actions, resume generation, Fact Guard, readiness, or exports.

1. Resume Review
   - Upload a resume or reuse a stored resume version.
   - Expected: the source is saved before AI processing, staged review progress is visible, provider failure does not create a ready report, and successful review does not automatically mark evidence resume-ready.

2. Add Material to Evidence Library
   - Use a reviewed resume or source note to create library items.
   - Expected: generated claims remain pending/private/source-quoted by default, visible counts match the current run, and exact claim count is treated as provider variance.

3. Source Cleanup
   - Open source impact preview and run draft cleanup on a source-derived import.
   - Expected: draft-only cleanup is reversible through preserved source records, approved material is not silently removed, and an audit event records the action.

4. Evidence Actions
   - Edit, approve, reject, link/unlink, and approve-for-resume evidence.
   - Expected: stale generated claims are flagged when supporting evidence changes, public-safe disclosure is required before resume use, and approved material quarantine requires strong confirmation.

5. Main Resume Readiness
   - Generate or refresh a main resume and run Fact Guard.
   - Expected: readiness separates Fact Guard hard blockers, evidence eligibility blockers, stale claims, missing evidence, and polish-only findings.

6. Tailored Resume Readiness
   - Analyze a target JD, generate a tailored resume, and run Fact Guard.
   - Expected: tailored readiness uses the same blocker categories as Main Resume, with job-scoped missing evidence where relevant.

7. Export Gates
   - Try JSON audit export and final Markdown, HTML, and DOCX exports before and after validation.
   - Expected: JSON audit remains available for review; final Markdown/HTML/DOCX exports are blocked until Fact Guard validates the resume.

## Pass Criteria

- Automated verification passes.
- Manual QA finds no contradiction between Dashboard, Evidence Library, Resume Review, Main Resume, and Job Workspace readiness state.
- No raw source text, unapproved evidence, private evidence without public-safe wording, or stale generated claim is used as final resume support.
- Any production smoke uses the current deployed commit and records the target URL/date in `docs/development-status.md`.
