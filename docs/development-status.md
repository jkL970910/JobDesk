# JobDesk Development Status

Last updated: 2026-07-07
Baseline commit: ce44458 `Build local MVP workflow baseline`
Latest implementation commit: 79dff3e `feat: expose target eligibility metadata`
Production URL: https://jobdesk-tau.vercel.app
Final UI reference: Figma Make `Si82hetJamO8bUqHOacgv9` — signed off as **JobDesk Final Project Reference UI v1**

This is the living implementation status file. Every future code change should update this file before the related commit when it changes scope, workflow coverage, verification status, known risks, or next-task priority.

## Workflow Count

Current implementation covers **11 product workflows** and **14 support workflows** across three user goals: **Build My Evidence Library**, **Create or Update My Resume**, and **Apply to a Target Job**. Resume Review stores and scores general resume source versions before extraction. The Material Library lane does not depend on a JD; the Job Workspace lane depends on a target JD plus approved material-library evidence. Profile now owns Create/Update Resume modes: main resume, positioning-based variant, resume refresh, version review, and export. Resume Refresh is intentionally not a fourth top-level entry; it is a Main Resume generation mode that uses an old resume as structure baseline while canonical Evidence Library material remains the fact source.

## UI Reference Contract

The signed-off product UI reference is **JobDesk Final Project Reference UI v1**, generated in Figma Make:

`https://www.figma.com/make/Si82hetJamO8bUqHOacgv9/Provide-project-documents`

This reference is authoritative for the target product information architecture, visual direction, and page-level interaction model. It is not a direct source-code import target. Implementation must adapt it to the existing Next.js app, real API contracts, persistence model, and current feature readiness.

Reference IA to preserve:

| Area | Product role | Implementation status |
|------|--------------|-----------------------|
| Dashboard | Command-center summary and next actions | Shell implemented; richer metrics can evolve with real data |
| Profile | Career identity and factual skeleton, not a static resume | Target IA signed off; implementation can be staged |
| Resume Review | General resume versions, scoring, strengths/weaknesses, extraction handoff | MVP implemented with staged LLM-first `hr-screening-review` skill binding, explicit failed-run retry, duplicate upload detection, and extraction handoff |
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
| 1 | Resume Review: general resume versioning and scoring | Done, MVP | Passed | Supports PDF, DOCX, TXT, and Markdown upload through `/api/resume-review`; stores resume source versions before review AI runs, detects exact duplicate uploads by content hash, creates a persisted review run with pollable progress, runs section-level assessments plus staged LLM-first final synthesis using the `hr-screening-review` skill adapted for no-JD scope, keeps provider failures as retryable failed runs instead of publishing a ready fallback report, and hands off selected versions to Evidence Library extraction or Needs Enrichment review after the report is saved. |
| 2 | Material Library: reviewed resume source ingestion | Done | Passed | Source Intake can reuse stored resume versions from Resume Review as provenance sources for reusable evidence candidates, or route a new resume through review/versioning before extraction; no JD required. |
| 3 | Material Library: profile and evidence extraction | Done | Passed | Extracts profile fields, work experiences, work initiatives, portfolio projects, and evidence items from reviewed resumes or project notes, then persists them when `DATABASE_URL` is configured. Extracted material is intended to become canonical reusable Evidence Library material after user review/enrichment, not remain owned by the source resume version. Legacy `project_cards` is retained only for older data compatibility. |
| 4 | Material Library: story and evidence review for resume use | Done, MVP | Passed | Library Review is split into Needs Enrichment, Experience & Stories, Unlinked Evidence, Overlap Cleanup, and STAR Stories panels instead of one long review list. Needs Enrichment groups open tasks by source: Resume Review, Extraction Notes, Evidence Card, JD Gap, Story Target, or User Input. Enrichment task API supports source/status/resume/review filtering so Resume Review handoff and Evidence Library queues stay aligned. New evidence can link to Work Experiences, Initiatives, Portfolio Projects, or legacy Project cards. Employer-internal work is modeled as initiatives with internal and external-safe wording rather than as portfolio projects. Evidence cards now show Source, Reusable in, Status, Linked to, Missing info, and Last updated metadata so users can see provenance and reusable-asset readiness. Overlap Cleanup still supports legacy project/evidence overlap review; initiative/portfolio overlap cleanup is a follow-up. Supports evidence approve/reject/inline edit, external-safe summary review, allowed-usage editing, story target display, STAR story review, and resume-eligible evidence filtering. Resume-use approval is now backend-gated by public-safe disclosure: evidence must either be marked `public_safe` or carry a clean `public_safe_summary`; internal-only usage remains blocked for external resumes. |
| 5 | Job Workspace: JD analysis | Done | Passed | Extracts role facts, requirements, keywords, legitimacy signals, persistence, reload, reanalysis, and archive. |
| 6 | Job Workspace: tailored resume generation | Done, MVP | Passed | Uses JD analysis plus approved, current-workspace, resume-safe material-library evidence retrieval, writes resume versions and generated claim ledger, then automatically runs deterministic Fact Guard when persistence succeeds. Markdown/JSON export route is available for persisted resumes. |
| 7 | Job Workspace: Fact Guard revalidation | Done, MVP | Passed | Deterministic coverage and evidence support checks with claim-by-claim review UI. Resume may remain `unvalidated` when claims need manual review. |
| 8 | Job Workspace: interview preparation | Done, MVP | Passed | Generates persisted prep packs from an analyzed job, STAR story bank, local embedding retrieval context, behavioral questions, technical review topics, research prompts, practice plan, and evidence gaps. |
| 9 | Job Workspace: manual application tracking | Done, MVP | Passed | Updates analyzed jobs through the canonical application status pipeline without external actions or email automation. |
| 10 | Profile: Main Resume Builder | Done, MVP | Passed | Generates a general-purpose main resume under Profile from canonical profile facts plus resume-safe evidence, writes `main_resume_versions`, stores generated claim ledger entries, runs deterministic Fact Guard, exposes Markdown/JSON export, and keeps JD-tailored resumes separate under Job Workspace. It now supports `generation_mode` values for `main_resume`, `positioning_variant`, and `resume_refresh`; Resume Refresh stores the selected old resume source, update mode, and style constraints while still grounding output in current resume-safe Evidence Library material. Generated Resume Readiness Review is now separate from original Resume Review: it evaluates generated main/tailored drafts against claim support, resume polish, and positioning clarity, shows scoped before/after scores when an original source review exists, and routes findings to Evidence gap, Resume polish, or Positioning gap without turning every suggestion into a Work Queue task. Fact Guard/public-safe/export policy remain hard gates; readiness review is a soft gate. |
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
| S9 | Source document parse lifecycle | Done, MVP | Shared parser service handles PDF, DOCX, TXT, and Markdown as source inputs before Resume Review or Evidence Library extraction. `source_documents` stores parser name/version, original filename, MIME type, file size, parse status, warnings, char/word/page counts, content hash, and lifecycle status without raw binary storage. `/api/profile-evidence/parse-source` accepts source intent and returns parse quality plus duplicate metadata for project/work/JD-gap sources; `/api/resume-review` uses the same parser internally for resume sources. Parsed project/work/JD-gap documents are reused during extraction through `sourceDocumentId`, so evidence provenance points to the original parsed source row instead of a second extraction-only source. Source Intake and Resume Review now show parse lifecycle cards so users can distinguish successful parsing, warnings, duplicates, and scanned/low-text files from actual evidence extraction or resume generation. |
| S10 | Source chunk retrieval support layer | Done, MVP | `source_chunks` persists parsed/imported source chunks with source document/version linkage, parse quality, lifecycle status, content hash, local vector JSON, and metadata. Source chunks are rebuilt after parse/import lifecycle changes and searched only for gap discovery, evidence enrichment suggestions, and imported material review. Resume generation retrieval remains canonical-evidence only; raw source chunks carry convert/enrich-first semantics and are not treated as resume facts. |
| S11 | Explainable retrieval UI | Done, MVP | Retrieval now returns explainable evidence and source-material matches: matched requirement/question, keyword matches, semantic score, metric/recency bonuses, eligibility reason, blocked reason, and primary linkage for canonical evidence; source chunks return source title, excerpt, matched phrase, why they may help, and required next step. Evidence Library, JD analysis, Tailored Resume, and Main Resume surfaces separate usable evidence from possible source material. |
| S12 | Enrichment routing, imported notes, and profile fact resolution | Done, MVP | Enrichment tasks now distinguish profile context, profile facts, assign-later routing, targeted evidence/story/role updates, and imported notes. Broad profile questions save durable `profile_context_answers` without creating evidence/proposals. Profile fact edits use typed profile patches with `profile_fact_history`. Imported notes support acknowledge, dismiss, import reviewed, rerun requested, converted-to-question, profile fact updated, and role field updated resolution states. Role field updates cover location, team, start date, end date, and summary with backend target/field validation. |
| S13 | Suggested target rows and route-aware target gating | Done, MVP | `enrichment_task_targets` supports suggested targets with confidence, reason, created-by, accepted-at, and rejected-at metadata. Suggested targets are inert until explicitly accepted; proposal generation requires a confirmed primary target for update-evidence/story/role flows and returns `target_required` or `target_confirmation_required` otherwise. The Work Queue no longer shows claim/story/role dropdowns by default for profile context, profile facts, imported notes, or create-evidence routes. |
| S14 | Target eligibility and provenance metadata | Done, MVP | Recent Evidence Library payloads now expose `provenance` and `target_eligibility` for evidence, work experiences, initiatives, and portfolio projects. Work Queue target pickers filter out ineligible targets while preserving an already-linked unavailable target as a disabled current option, so legacy or rejected links remain visible without being reselectable. |

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

Last verified on 2026-06-24:

| Command | Status |
|---------|--------|
| `npm run typecheck` | Passed |
| `npm test` | Passed, 140 passed / 40 skipped |
| Targeted DB integration: source chunk boundaries | Passed; parsed/imported sources create chunks, gap search returns convert/enrich-first source material, and resume retrieval does not expose raw source chunks |
| Targeted DB integration: enrichment routing/profile context/imported notes/role fields/target gating | Passed for the added focused cases; full `profile-evidence-repository.integration.test.ts` still contains older slow/flaky proposal-flow tests when run as one file |
| Targeted DB integration: target eligibility/provenance | Passed; source-backed evidence, role, initiative, and portfolio project expose source provenance and remain target-eligible; rejected evidence is ineligible |
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
| Source Chunk Index / Explainable Retrieval implementation | Passed; `npm run typecheck`, `npm test`, targeted source chunk/retrieval tests, and focused DB integration checks passed |
| Imported Notes / Profile Facts / Role Field / Profile Context implementation | Passed; `npm run typecheck`, `npm test`, `npm run build`, and targeted DB integration checks passed |
| Suggested Target Rows / Target Gating / Eligibility Metadata implementation | Passed; `npm run typecheck`, `npm test`, `npm run build`, `git diff --check`, and targeted DB integration checks passed |
| Profile evidence extraction timeout UX patch | Passed; provider timeout / 524 failures are normalized as retryable `provider_timeout`, raw provider HTML is not shown to users, source text is preserved, and Retry / Split material / Save source only recovery actions are available |
| Async extraction run plumbing | Passed locally; `profile_evidence_extraction_runs` migration is applied, Create library items creates a run, UI polls status, `worker:profile-extraction:once` processes runs, locking/attempt metadata is present, and the legacy sync `/api/profile-evidence/extract` path remains fallback/dev-only |
| Async chunked Resume Review -> Evidence Library extraction | Passed locally for `Jiekun Liu - Resume.docx`; run `59b52c61-717d-4c45-99a0-ffd451b3dae1` completed with 9 source segments, 5 Work Experiences, 1 Story Target, and 7 Evidence Claims; resume source marked extracted only after persistence succeeded |
| Profile extraction reliability gate | Passed for focused automated tests; worker orchestration tests cover status order, auth-context execution, one final persistence call, retryable timeout failure, and no canonical writes before validation; segmentation tests cover multi-employer resumes, Projects sections, noisy PDF/DOCX-style text, missing headings, long work sections, and skills/certifications-only sources; fallback quality tests assert pending/private/source-quoted drafts |
| Clean refreshed chunked extraction backend QA | Passed for isolated same-source QA run `6ffb3602-c523-41cf-824b-b0a86584bddf`; source `74d7cfd7-9821-4726-9afb-37a217de1a97`, resume source `c4eb0495-3fcb-4614-a776-0282a09abf4f`; run completed with 8 source segments, 4 sensible Work Experiences, 1 Story Target, and 8 Evidence Claims; no false action-bullet Work Experience; resume source changed to `extracted` only after persistence; all extracted claims remain `pending`, `private`, source-quoted, and not resume-ready |
| Browser UI handoff QA for async chunked extraction | Passed with output-count variance; real UI upload/review/Add Material flow created run `2ddc2b50-9a21-42d9-aa8a-d6d9db5a4db6`, `worker:profile-extraction:once` completed it, and the Evidence Library UI showed 4 Work Experiences, 1 Story Target, and 6 Evidence Claims with matching visible counts and no stale QA data. All extracted claims remained `Needs review` / 0 resume-ready. This differs from the isolated backend run's 8 Evidence Claims, so exact claim count is treated as provider/extraction variance, not a stable product invariant. A stale pre-save worker-lock issue was found and fixed by allowing stale locked pre-save statuses to be reclaimed while excluding `saving` to avoid duplicate canonical writes |
| User-triggered profile extraction processing | Implemented locally; Create library items creates a run, the UI explicitly triggers processing for that specific run through `/api/profile-evidence/extract/runs/:runId/process`, and the UI polls that run until completed/failed. Retry explicitly requeues and retriggers the same run. No automatic cron or fallback scheduler is enabled in the MVP |
| Manual/admin profile extraction trigger | Implemented locally; `GET`/`POST /api/profile-evidence/extract/runs/process-once` remains available for manual QA/admin recovery, is protected by `Authorization: Bearer $CRON_SECRET`, fails closed when `CRON_SECRET` is missing, and processes at most one queued run per invocation |
| Section-based staged Resume Review timeout reduction | Implemented locally; Resume Review upload now saves the source first, creates a durable `workflow_runs` review run, atomically claims queued runs before processing, and publishes the report only after processing succeeds. Provider failures fail the run without creating a ready report, enrichment tasks, or reviewed source state. Full Resume Review first assesses bounded resume sections, then runs smaller structured synthesis stages for recruiter scan, rubric scoring, and evidence/fairness review, consolidating into the existing `ResumeReview` contract. This preserves the HR-screening prompt quality while reducing single-request timeout risk. Remote QA on `https://jobdesk-tau.vercel.app` is pending after deployment |
| Generated Resume Readiness Review | Implemented locally for the P1 quality loop; `generated_resume_readiness_reviews` stores generated-draft readiness reviews separately from original source Resume Review. Main Resume UI can manually run "Review generated resume", display scoped before/after readiness, show Fact Guard/export hard-gate state, and route findings to Evidence Library, Resume Builder polish, or Profile Positioning. Main Resume polish findings can build an explicit Resume Builder proposal; applying it creates a new generated main-resume version, reruns Fact Guard, and stores a fresh readiness review. Tailored resume readiness persistence/API support and Job Workspace UI review controls are wired for generated tailored drafts. Review findings do not automatically create Work Queue tasks. Full accept/reject/revise history and richer editable diff review remain future work. |
| Tailored Resume DOCX/HTML export parity | Implemented locally; Tailored Resume export now reuses the shared ATS export renderer, supports DOCX and printable HTML with the same Fact Guard final-export gate as Main Resume, and keeps JSON audit export available before validation. Focused route and renderer tests pass. |
| Production deployment for async extraction worker trigger | Partially complete; `CRON_SECRET` is set in Vercel Production and deployment `dpl_CCEa4cnDXtX3d5qL1iG5mTC3YQts` is aliased to `https://jobdesk-tau.vercel.app`. Remote smoke from the local shell is blocked by outbound connectivity timeouts to Vercel before function logs appear, while deployment inspection reports `READY`. Do not mark production signoff until the user-triggered queued-run flow and manual/admin endpoint are smoked from a working network/client |

Integration tests use the configured JobDesk database and write temporary workflow rows.

## Known Caveats

- Fact Guard is intentionally conservative. A workflow can pass coverage while the resume remains `unvalidated` until unsupported or partially supported claims are reviewed.
- OpenRouter-backed workflows can take more than one minute for longer resumes. Resume Review now saves uploaded source material before review AI runs, assesses bounded resume sections, and uses staged structured synthesis calls for scan, rubric scoring, and evidence/fairness review rather than weakening the prompt or analysis quality. Other long workflows still use their workflow-specific timeout and chunking policies.
- Running `next build` while `next dev` is still running can invalidate dev-server chunks in `.next`; restart the dev server after a production build.
- Account login/register is implemented for personal accounts and per-account default workspace isolation. Raw-id repository paths are scoped to the current workspace for the implemented workflows, production account sessions require `JOBDESK_SESSION_SECRET`, and the first registered account claims the legacy unowned workspace. Middleware remains edge-safe and validates signed session cookies before requests reach route handlers; full DB-backed session revocation is enforced by auth APIs and repository workspace ownership, but there is not yet a route-level test suite for every API endpoint. It is not yet a full team/workspace-sharing system, RBAC layer, password reset flow, or OAuth/social-login system. `JOBDESK_ACCESS_TOKEN` remains as a legacy bearer-token bypass for personal deployments.
- Evidence Library Builder MVP is implemented for project-note enrichment, enrichment-answer AI extraction with deterministic fallback, project-card review, inline evidence edit/linking with related-project validation, project-level overlap merge or keep-separate review, evidence-level overlap merge or keep-separate review, deterministic external-safe de-identification guards with blocked-term reports, computed STAR story promotion, local evidence embeddings, source chunk indexing, explainable retrieval, typed imported-note resolution, profile context persistence, profile fact history, suggested target rows, and route-aware target gating. Resume-use eligibility now requires approved evidence plus public-safe disclosure, so private evidence without a clean public-safe summary cannot enter Main Resume or Tailored Resume retrieval. Raw source chunks remain retrieval support for discovery/enrichment only and cannot enter Main Resume or Tailored Resume generation directly. The embedding layer is still a deterministic local JSONB MVP, not pgvector/ANN or provider embeddings yet.
- Profile Positioning Engine MVP is evidence-backed and no-JD. It recommends role directions as fit hypotheses, not career prescriptions, and consumes the current workspace's canonical profile plus approved or user-confirmed Evidence Library material for analysis. Positioning reports cannot persist directions with zero support, unknown evidence ids, or low/medium confidence without missing-evidence questions. Main Resume generation still uses resume-safe evidence as the external-facing output gate. It does not perform job search, market research, open-role recommendation, or company-specific targeting without a JD.
- Resume Refresh is implemented as a Create/Update Resume mode, not a separate product lane. It uses an old resume source version as structure/style baseline, but it does not re-extract evidence by default and does not treat stale resume text as canonical truth. Current limitation: refresh preview/editing still shares the Main Resume preview surface; richer side-by-side diff and DOCX/PDF export are future work.
- Resume extraction can generate thin project/evidence cards because resumes rarely contain full project context. This is expected. The current UI surfaces readiness, shows Resume Review missing-evidence question status from real matching tasks, routes users into Needs Enrichment, and creates persistent enrichment tasks from Resume Review missing-evidence questions and extraction notes. Project-level Source Intake handoff remains available from story cards and STAR stories.
- Async profile evidence extraction now uses deterministic source segmentation plus chunk-level AI extraction with conservative source-grounded fallback for timeout or invalid chunk output. This makes the main Resume Review -> Evidence Library path complete under the current provider route. Fallback-generated Work Experiences, Story Targets, and Evidence Claims remain pending/private/source-quoted and require user review before resume use. Production MVP intentionally has no automatic scheduler; extraction processing is initiated by the user/session flow or by explicit manual/admin trigger. Production deployment has `CRON_SECRET` set and the latest build deployed, but still needs remote QA from a network/client that can reach Vercel.
- Manual QA note: local run `59b52c61-717d-4c45-99a0-ffd451b3dae1` completed before the latest parser tightening and contains one rough false Work Experience plus comma-heavy internship parsing. Clean refreshed backend QA run `6ffb3602-c523-41cf-824b-b0a86584bddf` used an isolated copy of the same parsed source and produced 4 sensible Work Experiences. Browser-path UI handoff QA run `2ddc2b50-9a21-42d9-aa8a-d6d9db5a4db6` used the real UI path and produced clean visible handoff state with 4 Work Experiences, 1 Story Target, and 6 Evidence Claims. The exact Evidence Claim count varied between backend and browser runs; UI/product QA should verify count consistency within a run and safe pending/review state, not require an exact provider-dependent claim count.
- Project card edits still use browser prompts for some fields. Evidence edits now use inline card editing; project editing should move to the same inline/drawer pattern before production-level UX signoff.
- Resume retrieval does not auto-reindex on every tailored-resume request. Run `/api/retrieval/reindex` or generate an interview prep pack to refresh local embeddings.
- Source chunks are intentionally not facts. They can help users find possible supporting material, but users must convert or enrich canonical evidence before that material can influence resume generation.
- Profile context answers are soft preferences for positioning and future workflow guidance. They are not evidence, do not appear in Evidence Library counts, and must not be used as factual resume claims.
- Target suggestions are not confirmed links. Suggested target rows can explain a likely role/story/evidence match, but proposal generation only uses a user-confirmed primary target.
- The current UI now uses the signed-off product shell, but shared single-page state is still lightweight; future iterations can move major views to dedicated routes after the IA stabilizes in real use.
- Skills Registry audit metadata MVP is implemented. Runtime workflow calls now carry skill id, skill version, prompt version, schema name/version, model tier, and source skill ids into `workflow_runs`. Runtime prompt composition now loads source `SKILL.md` hard rules with frontmatter version checks. Remaining gap: the composer is still workflow-owned and not a dynamic agent planner or skill marketplace.
- JSON resume export is an audit/export-for-debugging surface and may include claim source quotes. Markdown export is the safer user-facing export path until a separate public JSON contract exists.
- Team authentication/RBAC, PDF/DOCX export, daily job recommendation, and email-assisted tracking are not implemented yet.

## Next Task Queue

| Priority | Task | Status |
|----------|------|--------|
| P0 | Keep this status file updated with every implementation step | Active |
| P0 | Freeze new workflow/module work until the Resume Core Loop is hardened | Active |
| P0 | P0.1a Source impact preview, draft-material cleanup, and cleanup audit event | Done, local |
| P0 | P0.2 Unified resume evidence eligibility policy computed by backend and returned through API DTOs | Done, local |
| P0 | P0.3a Evidence-only Asset Action Service for edit/approve/reject/approve-for-resume/link/unlink/stale-claim handling | Done, local |
| P0 | P0.1b Approved source-derived material quarantine, executed through the evidence action seam with strong confirmation | Done, local |
| P0 | P0.4 Unified Main/Tailored Resume readiness worklist for hard blockers, evidence blockers, stale claims, missing evidence, and polish-only findings | Done, local |
| P0 | P0.5 Tailored Resume DOCX/HTML export parity using the existing export renderer and export gate | Done, local |
| P0 | P0.6 Full Resume Core Loop QA suite, with targeted tests added in every slice before the final E2E pass | Planned |
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
| P1 | Add source chunk indexing and explainable retrieval | Done, MVP |
| P1 | Split enrichment routing into profile context, profile facts, imported notes, assign-later routing, and targeted proposals | Done, MVP |
| P1 | Add suggested targets, route-aware target gating, and target eligibility metadata | Done, MVP |
| P1 | Add user-triggered async extraction processing for production | Implemented locally; deployed build has `CRON_SECRET`, but remote smoke of user-triggered processing and manual/admin endpoint is still pending before production signoff |
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
