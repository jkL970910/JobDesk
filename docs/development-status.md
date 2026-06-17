# JobDesk Development Status

Last updated: 2026-06-17
Baseline commit: ce44458 `Build local MVP workflow baseline`
Latest implementation commit: next `feat: add resume refresh workflow mode`
Production URL: https://jobdesk-tau.vercel.app
Final UI reference: Figma Make `Si82hetJamO8bUqHOacgv9` — signed off as **JobDesk Final Project Reference UI v1**

This is the living implementation status file. Every future code change should update this file before the related commit when it changes scope, workflow coverage, verification status, known risks, or next-task priority.

## Workflow Count

Current implementation covers **11 product workflows** and **8 support workflows** across three user goals: **Build My Evidence Library**, **Create or Update My Resume**, and **Apply to a Target Job**. Resume Review stores and scores general resume source versions before extraction. The Material Library lane does not depend on a JD; the Job Workspace lane depends on a target JD plus approved material-library evidence. Profile now owns Create/Update Resume modes: main resume, positioning-based variant, resume refresh, version review, and export. Resume Refresh is intentionally not a fourth top-level entry; it is a Main Resume generation mode that uses an old resume as structure baseline while canonical Evidence Library material remains the fact source.

## UI Reference Contract

The signed-off product UI reference is **JobDesk Final Project Reference UI v1**, generated in Figma Make:

`https://www.figma.com/make/Si82hetJamO8bUqHOacgv9/Provide-project-documents`

This reference is authoritative for the target product information architecture, visual direction, and page-level interaction model. It is not a direct source-code import target. Implementation must adapt it to the existing Next.js app, real API contracts, persistence model, and current feature readiness.

Reference IA to preserve:

| Area | Product role | Implementation status |
|------|--------------|-----------------------|
| Dashboard | Command-center summary and next actions | Shell implemented; richer metrics can evolve with real data |
| Profile | Career identity and factual skeleton, not a static resume | Target IA signed off; implementation can be staged |
| Resume Review | General resume versions, scoring, strengths/weaknesses, extraction handoff | MVP implemented with LLM-first `hr-screening-review` skill binding, local fallback, and duplicate upload detection |
| Evidence Library | Reusable evidence, project cards, source-backed facts, STAR material | Backend and MVP UI implemented; refactor should map this into the signed-off IA |
| Jobs / Job Workspace | JD analysis, tailored resume, Fact Guard, interview prep, application status | Backend and MVP UI implemented; refactor should group these under one workspace |
| Applications | Manual application pipeline | Backend and MVP UI implemented |
| Interview Prep | Job-specific prep pack and story practice | Backend and MVP UI implemented |
| Growth Profile | Interview feedback and recurring improvement themes | Final reference only; future implementation |
| Recommendations | Job discovery and fit explanations | Final reference only; future implementation |
| Settings | Access gate, model/deployment settings, diagnostics | Minimal support exists; product settings can evolve |

Reference constraints:

- `Profile` is the user's factual career skeleton: identity, target preferences, work experience frame, education, skills, and source/evidence coverage.
- `Profile` must not become the canonical resume document and must not store tailored achievement bullets as source-of-truth content.
- `Evidence Library` owns reusable material: work experiences, employer-internal initiatives, portfolio projects, achievements, metrics, responsibilities, source quotes, STAR stories, confidence, sensitivity, allowed usage, and readiness.
- `Evidence Library` is organized around Work Experiences as employer/role containers, Initiatives as internal work stories under those roles, Portfolio Projects as non-employer personal/academic/open-source/freelance/hackathon projects, and Evidence cards as atomic source-backed claims. Legacy Project cards remain only for older data compatibility.
- `Evidence Library` is the canonical reusable asset library. Resume versions, source documents, project notes, and JD gap notes are provenance inputs, not owners of the resulting material. Canonical evidence/story assets should be reusable across future resumes, cover letters, interview prep, and Fact Guard.
- Resume Review evaluates and stores resume source versions. Source Intake converts reviewed resume versions or external sources into evidence/story candidates. Library Review owns user confirmation, enrichment, de-identification, allowed usage, and canonical reuse state.
- Resume-first onboarding, material-first onboarding, and JD-first quick path are all valid user paths. Resume-first now starts in Resume Review, where uploaded files become stored resume source versions with duplicate detection and a general resume score before the user extracts signals into the Material Library. A dedicated guided questionnaire or full main-resume authoring workflow is not implemented yet.
- Evidence Library UI separates `Source Intake` from `Library Review`: intake owns reviewed-resume extraction and paste/project-note enrichment, while review owns Experience & Story targets, Evidence claims, readiness, possible-overlap cleanup, and STAR story review. Successful intake routes back to Review with a handoff notice showing created evidence/story counts and the next review/enrichment action.
- `Main Resume` is a generated general-purpose artifact under Profile, suitable for LinkedIn, cold outreach, and recruiter sharing. It is not the source of truth.
- `Tailored Resume` belongs to a Job Workspace and must remain grounded in a selected JD plus approved evidence.
- `Resume Versions` under Profile is an index/backlink surface. Job-specific resume editing remains in the owning Job Workspace.
- Future-only reference surfaces must not be presented as complete product functionality until backed by real workflows or clearly marked as planned.

Product workflows:

| # | Workflow | Status | Local test status | Notes |
|---|----------|--------|-------------------|-------|
| 1 | Resume Review: general resume versioning and scoring | Done, MVP | Passed | Supports PDF, DOCX, TXT, and Markdown upload through `/api/resume-review`; stores resume source versions, detects exact duplicate uploads by content hash, runs an LLM-first general resume review using the `hr-screening-review` skill adapted for no-JD scope, falls back to a local rubric when the provider is unavailable, and hands off selected versions to Evidence Library extraction or Needs Enrichment review. |
| 2 | Material Library: reviewed resume source ingestion | Done | Passed | Source Intake can reuse stored resume versions from Resume Review as provenance sources for reusable evidence candidates, or route a new resume through review/versioning before extraction; no JD required. |
| 3 | Material Library: profile and evidence extraction | Done | Passed | Extracts profile fields, work experiences, work initiatives, portfolio projects, and evidence items from reviewed resumes or project notes, then persists them when `DATABASE_URL` is configured. Extracted material is intended to become canonical reusable Evidence Library material after user review/enrichment, not remain owned by the source resume version. Legacy `project_cards` is retained only for older data compatibility. |
| 4 | Material Library: story and evidence review for resume use | Done, MVP | Passed | Library Review is split into Needs Enrichment, Experience & Stories, Unlinked Evidence, Overlap Cleanup, and STAR Stories panels instead of one long review list. Needs Enrichment groups open tasks by source: Resume Review, Extraction Notes, Evidence Card, JD Gap, Story Target, or User Input. Enrichment task API supports source/status/resume/review filtering so Resume Review handoff and Evidence Library queues stay aligned. New evidence can link to Work Experiences, Initiatives, Portfolio Projects, or legacy Project cards. Employer-internal work is modeled as initiatives with internal and external-safe wording rather than as portfolio projects. Evidence cards now show Source, Reusable in, Status, Linked to, Missing info, and Last updated metadata so users can see provenance and reusable-asset readiness. Overlap Cleanup still supports legacy project/evidence overlap review; initiative/portfolio overlap cleanup is a follow-up. Supports evidence approve/reject/inline edit, external-safe summary review, allowed-usage editing, story target display, STAR story review, and resume-eligible evidence filtering. Resume-use approval is now backend-gated by public-safe disclosure: evidence must either be marked `public_safe` or carry a clean `public_safe_summary`; internal-only usage remains blocked for external resumes. |
| 5 | Job Workspace: JD analysis | Done | Passed | Extracts role facts, requirements, keywords, legitimacy signals, persistence, reload, reanalysis, and archive. |
| 6 | Job Workspace: tailored resume generation | Done, MVP | Passed | Uses JD analysis plus approved, current-workspace, resume-safe material-library evidence retrieval, writes resume versions and generated claim ledger, then automatically runs deterministic Fact Guard when persistence succeeds. Markdown/JSON export route is available for persisted resumes. |
| 7 | Job Workspace: Fact Guard revalidation | Done, MVP | Passed | Deterministic coverage and evidence support checks with claim-by-claim review UI. Resume may remain `unvalidated` when claims need manual review. |
| 8 | Job Workspace: interview preparation | Done, MVP | Passed | Generates persisted prep packs from an analyzed job, STAR story bank, local embedding retrieval context, behavioral questions, technical review topics, research prompts, practice plan, and evidence gaps. |
| 9 | Job Workspace: manual application tracking | Done, MVP | Passed | Updates analyzed jobs through the canonical application status pipeline without external actions or email automation. |
| 10 | Profile: Main Resume Builder | Done, MVP | Passed | Generates a general-purpose main resume under Profile from canonical profile facts plus resume-safe evidence, writes `main_resume_versions`, stores generated claim ledger entries, runs deterministic Fact Guard, exposes Markdown/JSON export, and keeps JD-tailored resumes separate under Job Workspace. It now supports `generation_mode` values for `main_resume`, `positioning_variant`, and `resume_refresh`; Resume Refresh stores the selected old resume source, update mode, and style constraints while still grounding output in current resume-safe Evidence Library material. |
| 11 | Profile: Positioning Engine and Main Resume variants | Done, MVP | Passed | Analyzes canonical profile facts plus approved or user-confirmed Evidence Library material to recommend 3-5 evidence-backed target role directions without requiring a concrete JD. Direction cards explicitly separate `strong_fit`, `medium_fit`, and `aspirational_gap`, show supporting evidence and missing-evidence counts, and can create enrichment tasks from positioning gaps. The API persists `profile_positioning_reports`, writes workflow metadata through the Skills Registry, exposes `/api/profile-positioning/recent`, post-checks AI output for valid evidence ids and low/medium confidence gaps before saving, links selected directions to `main_resume_versions`, and lets Profile generate direction-specific Main Resume variants that still run deterministic Fact Guard. |

Support workflows:

| # | Workflow | Status | Notes |
|---|----------|--------|-------|
| S1 | Local dashboard/workbench | Done, MVP | Figma-reference app shell now separates Dashboard, Profile, Evidence Library, Jobs, Applications, Interview Prep, planned Recommendations, planned Growth Profile, and Settings while keeping implemented workflows backed by real APIs. |
| S2 | DB persistence and migrations | Done | Drizzle/Postgres migrations are committed. Existing dev DB journal was baselined for 0000-0005, then migration 0006 was applied normally. Use migrations for any DB with user data. |
| S3 | Vercel deployment path | Done | Production deployment path exists at `https://jobdesk-tau.vercel.app`; rerun production smoke after the latest local-only workflow changes before treating production as current. |
| S4 | Local embedding RAG index | Done, MVP | Deterministic local hash-vector embeddings persisted in Postgres JSONB with explicit `/api/retrieval/reindex`. Resume retrieval consumes current-workspace embeddings as a best-effort semantic bonus and falls back to deterministic overlap ranking over current-workspace approved evidence only. |
| S5 | Personal access gate | Done, MVP | Optional `JOBDESK_ACCESS_TOKEN` protects `/api/*` through middleware and lets the workbench send the token from browser-local storage. |
| S6 | Skills Registry audit metadata and runtime prompt composer | Done, MVP | `src/ai/skills-registry.ts` binds live AI/deterministic workflows to runtime skill ids, prompt versions, schema versions, model tiers, and source skill ids. `workflow_runs` persists this metadata, and Resume Review reports now link to workflow runs. Runtime SKILL.md loader / prompt composer now loads source skill frontmatter and hard rules into runtime prompts with version checks. |
| S7 | Workflow/system diagnostics | Done | Settings exposes read-only diagnostics for DB connectivity, AI provider status, current model, registry entry count, latest workflow runs, failed workflow count, and last workflow time without exposing API keys. |
| S8 | Account login/register | Done, MVP | Adds `users`, `user_sessions`, httpOnly signed session cookies, login/register/logout/me APIs, account gate UI, and legacy bearer-token compatibility. New default workspaces are scoped to the signed-in user; the first registered account claims the legacy unowned `Personal JobDesk` workspace so existing local data remains visible. Raw-id repository reads and writes are now guarded by the current workspace for jobs, resume reviews, generated resumes, evidence/library records, enrichment tasks, and interview prep packs. Production account sessions require `JOBDESK_SESSION_SECRET`; legacy token-only mode remains usable without forcing the account gate. |

## Latest Verified Local Workflow

Test input: local Desktop PDF resume, synthetic Senior Product Data Analyst JD.

Result from the latest full local smoke test:

- PDF parse: passed, 4,228 extracted characters.
- Profile evidence extraction: passed, 6 evidence items and 2 project cards.
- Evidence approval: passed, 4 evidence items approved for resume use.
- JD analysis: passed, 9 requirements persisted.
- Tailored resume: passed, 7 generated claims and 5 missing-evidence questions persisted.
- Fact Guard: passed, coverage gate passed, 3 of 7 claims supported, resume kept `unvalidated` for human review.
- Resume export: passed locally and in production, Markdown and JSON export endpoints returned downloadable artifacts.
- Project-note enrichment: passed locally, 8 evidence items and 1 project card persisted from a project note smoke source.

Workflow boundary check:

- Material Library can be prepared from resume/project sources before any JD exists.
- Job Workspace steps require a selected/analyzed JD and consume approved Material Library evidence.

## Verification Commands

Last verified on 2026-06-16:

| Command | Status |
|---------|--------|
| `npm run typecheck` | Passed |
| `npm test` | Passed, 82 passed / 10 skipped |
| `npm run test:integration` | Passed, 5 files / 10 tests passed |
| `npm run verify:local` | Passed; runs typecheck, unit tests, and DB integration tests |
| `npm run build` | Passed |
| Resume Review → Needs Enrichment UI closure | Passed; Resume Review shows evidence-gap task handoff, counts only real matching tasks, and routes directly to Evidence Library Needs Enrichment |
| Account auth migration and middleware gate | Passed; `drizzle/0012_jobdesk_accounts.sql` applied locally, access guard tests cover signed session cookies, auth route bypass, and production missing-secret fail-closed behavior |
| Workspace ownership guard | Passed; integration tests cover cross-user raw job ids, resume source ids returning not-found/update-denied semantics, and first-account claim of the legacy unowned workspace |
| Resume evidence retrieval workspace guard | Passed; integration test verifies one account cannot retrieve another account's approved resume evidence for tailoring context |
| `npm run db:migrate` | Passed on the configured JobDesk development database through `drizzle/0012_jobdesk_accounts.sql` |
| Guided Evidence Enrichment audit checks | Passed; source-aware dedupe and terminal-state protection verified in integration tests |
| Main Resume Builder audit checks | Passed; success and failure workflow metadata verified in integration tests |
| Profile Positioning Engine audit checks | Passed; schema, skill registry, AI builder, deterministic post-checks, recent report API, repository persistence, workflow metadata, cross-workspace isolation, Main Resume variant linkage, and positioned variant Fact Guard verified |
| Resume Refresh mode | Passed; DB migration applied locally, API accepts refresh source/mode/style constraints, AI prompt receives refresh context, persisted Main Resume DTO returns generation metadata, and integration tests cover refresh metadata |
| Runtime SKILL.md loader / prompt composer with frontmatter version checks | Passed; source skill hard rules load into live prompts and version mismatch fails fast |
| Tailored Resume automatic Fact Guard | Passed; generated tailored resumes auto-run claim support review after persistence |
| Resume-safe evidence disclosure gate | Passed; direct approval, bulk project approval, retrieval eligibility, dashboard readiness, and Evidence Library labels require public-safe disclosure before resume use |
| Enrichment answer AI extraction grounding | Passed; AI conversion uses the user's answer as the source document, verifies source quotes and metric grounding before insertion, and marks ungrounded output for user confirmation |
| Enrichment answer AI extraction fallback | Passed; convert action supports AI extraction and deterministic fallback with integration coverage |
| Profile source span verifier | Passed; profile facts get source offsets and verified flags when quotes match source text |
| Main Resume Markdown/JSON export | Passed; route and Profile UI export latest generated main resume |
| Local responsive UI browser audit at `http://localhost:3030` | Passed, app shell desktop, Evidence Library navigation, Overlap Cleanup tab, 390px mobile, no horizontal overflow, no browser console errors |
| Local `/api/retrieval/reindex` smoke | Passed, saved 264 chunks |
| Local `/api/interview-prep/generate` smoke | Passed, saved prep pack with 4 behavioral questions and 1 technical topic |
| `npm run smoke:full -- --resume-file <path> --base-url http://127.0.0.1:3030` | Passed |
| `npm run smoke:full -- --resume-file <path> --base-url https://jobdesk-tau.vercel.app` | Passed |
| Project-note enrichment smoke through `/api/profile-evidence/enrich-project` | Passed locally |
| Evidence dedupe/merge integration test | Passed |
| Project dedupe/merge and evidence-to-project link validation integration test | Passed |
| Evidence dedupe/merge local UI check | Passed |
| Evidence de-identification guardrail tests | Passed |
| Evidence de-identification local UI check | Passed |
| STAR story service tests | Passed |
| STAR story repository integration check | Passed |
| STAR story API smoke at `http://127.0.0.1:3030/api/profile-evidence/star-stories` | Passed |
| STAR story local UI check | Passed |
| Production STAR story API smoke at `https://jobdesk-tau.vercel.app/api/profile-evidence/star-stories` | Passed |
| Latest Evidence Builder, dedupe, de-identification, and STAR story production deploy | Passed |
| Latest production full smoke at `https://jobdesk-tau.vercel.app` | Passed |

Integration tests use the configured JobDesk database and write temporary workflow rows.

## Known Caveats

- Fact Guard is intentionally conservative. A workflow can pass coverage while the resume remains `unvalidated` until unsupported or partially supported claims are reviewed.
- OpenRouter-backed workflows can take more than one minute for longer resumes. Current workflow timeouts were raised to support realistic resume extraction and tailoring.
- Running `next build` while `next dev` is still running can invalidate dev-server chunks in `.next`; restart the dev server after a production build.
- Account login/register is implemented for personal accounts and per-account default workspace isolation. Raw-id repository paths are scoped to the current workspace for the implemented workflows, production account sessions require `JOBDESK_SESSION_SECRET`, and the first registered account claims the legacy unowned workspace. Middleware remains edge-safe and validates signed session cookies before requests reach route handlers; full DB-backed session revocation is enforced by auth APIs and repository workspace ownership, but there is not yet a route-level test suite for every API endpoint. It is not yet a full team/workspace-sharing system, RBAC layer, password reset flow, or OAuth/social-login system. `JOBDESK_ACCESS_TOKEN` remains as a legacy bearer-token bypass for personal deployments.
- Evidence Library Builder MVP is implemented for project-note enrichment, enrichment-answer AI extraction with deterministic fallback, project-card review, inline evidence edit/linking with related-project validation, project-level overlap merge or keep-separate review, evidence-level overlap merge or keep-separate review, deterministic external-safe de-identification guards with blocked-term reports, computed STAR story promotion, and local embedding index reindexing. Resume-use eligibility now requires approved evidence plus public-safe disclosure, so private evidence without a clean public-safe summary cannot enter Main Resume or Tailored Resume retrieval. The embedding layer is a deterministic local JSONB MVP, not pgvector/ANN or provider embeddings yet.
- Profile Positioning Engine MVP is evidence-backed and no-JD. It recommends role directions as fit hypotheses, not career prescriptions, and consumes the current workspace's canonical profile plus approved or user-confirmed Evidence Library material for analysis. Positioning reports cannot persist directions with zero support, unknown evidence ids, or low/medium confidence without missing-evidence questions. Main Resume generation still uses resume-safe evidence as the external-facing output gate. It does not perform job search, market research, open-role recommendation, or company-specific targeting without a JD.
- Resume Refresh is implemented as a Create/Update Resume mode, not a separate product lane. It uses an old resume source version as structure/style baseline, but it does not re-extract evidence by default and does not treat stale resume text as canonical truth. Current limitation: refresh preview/editing still shares the Main Resume preview surface; richer side-by-side diff and DOCX/PDF export are future work.
- Resume extraction can generate thin project/evidence cards because resumes rarely contain full project context. This is expected. The current UI surfaces readiness, shows Resume Review missing-evidence question status from real matching tasks, routes users into Needs Enrichment, and creates persistent enrichment tasks from Resume Review missing-evidence questions and extraction notes. Project-level Source Intake handoff remains available from story cards and STAR stories.
- Project card edits still use browser prompts for some fields. Evidence edits now use inline card editing; project editing should move to the same inline/drawer pattern before production-level UX signoff.
- Resume retrieval does not auto-reindex on every tailored-resume request. Run `/api/retrieval/reindex` or generate an interview prep pack to refresh local embeddings.
- The current UI now uses the signed-off product shell, but shared single-page state is still lightweight; future iterations can move major views to dedicated routes after the IA stabilizes in real use.
- Skills Registry audit metadata MVP is implemented. Runtime workflow calls now carry skill id, skill version, prompt version, schema name/version, model tier, and source skill ids into `workflow_runs`. Runtime prompt composition now loads source `SKILL.md` hard rules with frontmatter version checks. Remaining gap: the composer is still workflow-owned and not a dynamic agent planner or skill marketplace.
- JSON resume export is an audit/export-for-debugging surface and may include claim source quotes. Markdown export is the safer user-facing export path until a separate public JSON contract exists.
- Team authentication/RBAC, PDF/DOCX export, daily job recommendation, and email-assisted tracking are not implemented yet.

## Next Task Queue

| Priority | Task | Status |
|----------|------|--------|
| P0 | Keep this status file updated with every implementation step | Active |
| P0 | Add a reusable local full-workflow smoke script without storing resume content in git | Done |
| P0 | Improve claim review UX so `unvalidated` resumes show exactly which claims need attention | Done, MVP |
| P0 | Add Skills Registry audit metadata and workflow diagnostics | Done, MVP |
| P0 | Implement runtime SKILL.md loader / prompt composer with frontmatter version checks | Done, MVP |
| P1 | Add resume export path, likely Markdown first, then PDF/DOCX | Tailored and Main Resume Markdown/JSON done; PDF/DOCX not started |
| P1 | Build Evidence Library Builder for project notes, project cards, and richer resume retrieval context | Done, MVP with computed STAR story bank and local embedding index |
| P1 | Add evidence/project merge-dedupe and de-identification workflow UI | Done, MVP with deterministic blocked-term guard |
| P1 | Replace prompt-based card edits with inline or drawer editing for project/evidence review | Evidence inline edit done; project inline/drawer edit pending |
| P1 | Add guided evidence enrichment questionnaire for thin resume-derived cards | Done, MVP via persistent enrichment tasks, Resume Review handoff, task source grouping, answer capture, and conversion into pending evidence candidates |
| P1 | Add Profile Main Resume Builder | Done, MVP with main resume versions, claim ledger, and Fact Guard |
| P1 | Add Profile Positioning Engine for direction-specific Main Resume variants | Done, MVP |
| P1 | Add Resume Refresh inside Create/Update Resume | Done, MVP |
| P1 | Redeploy latest baseline to Vercel and re-run production smoke | Pending for latest UI reference refactor |
| P2 | Start interview preparation workflow | Done, MVP |
| P2 | Start manual application tracking workflow | Done, MVP |
| P2 | Start daily job recommendation workflow | Not started |
| P2 | Start email-assisted application tracking workflow | Not started |

## Update Rule

Before future commits, update:

1. This file for workflow/task status.
2. `README.md` only when setup, commands, or high-level product coverage changes.
3. `docs/SETUP.md` only when local setup, environment variables, migrations, or verification commands change.
4. PRD/design docs only when the product contract or architecture changes, not for routine implementation progress.
