# JobDesk Development Status

Last updated: 2026-06-11
Baseline commit: ce44458 `Build local MVP workflow baseline`
Latest implementation commit: current HEAD `Add STAR story promotion MVP`
Production URL: https://jobdesk-tau.vercel.app

This is the living implementation status file. Every future code change should update this file before the related commit when it changes scope, workflow coverage, verification status, known risks, or next-task priority.

## Workflow Count

Current implementation covers **6 product workflows** and **3 support workflows**.

Product workflows:

| # | Workflow | Status | Local test status | Notes |
|---|----------|--------|-------------------|-------|
| 1 | Resume source ingestion | Done | Passed | Supports PDF, DOCX, TXT, and Markdown through `/api/profile-evidence/parse-source`. |
| 2 | Profile and evidence extraction | Done | Passed | Extracts profile fields, evidence items, and project cards from resumes or project notes, then persists them when `DATABASE_URL` is configured. |
| 3 | Evidence and project review for resume use | Done, basic | Passed | Supports evidence approve/reject/edit, external-safe summary review, sensitive/internal-only resume-use blocking, project card approve/reject/edit, safe project-linked evidence approval, duplicate evidence review/merge, STAR story promotion, and resume-eligible evidence filtering. |
| 4 | JD analysis | Done | Passed | Extracts role facts, requirements, keywords, legitimacy signals, persistence, reload, reanalysis, and archive. |
| 5 | Tailored resume generation | Done, MVP | Passed | Uses JD analysis plus approved evidence retrieval, writes resume versions and generated claim ledger. Markdown/JSON export route is available for persisted resumes. |
| 6 | Fact Guard revalidation | Done, MVP | Passed | Deterministic coverage and evidence support checks with claim-by-claim review UI. Resume may remain `unvalidated` when claims need manual review. |

Support workflows:

| # | Workflow | Status | Notes |
|---|----------|--------|-------|
| S1 | Local dashboard/workbench | Done, MVP | Single-page app with JD analysis, profile/evidence, and tailored resume panels. |
| S2 | DB persistence and migrations | Done | Drizzle/Postgres migrations are committed. Use migrations for any DB with user data. |
| S3 | Vercel deployment path | Done | Latest production deployment and smoke test passed at `https://jobdesk-tau.vercel.app` after STAR story promotion changes. |

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

## Verification Commands

Last verified on 2026-06-11:

| Command | Status |
|---------|--------|
| `npm run typecheck` | Passed |
| `npm test` | Passed, 47 passed / 4 skipped |
| `npm run test:integration` | Passed, 4 passed |
| `npm run build` | Passed |
| `npm run smoke:full -- --resume-file <path> --base-url http://127.0.0.1:3030` | Passed |
| `npm run smoke:full -- --resume-file <path> --base-url https://jobdesk-tau.vercel.app` | Passed |
| Project-note enrichment smoke through `/api/profile-evidence/enrich-project` | Passed locally |
| Evidence dedupe/merge integration test | Passed |
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
- The current UI is a workbench, not a polished multi-user product surface.
- Evidence Library Builder MVP is implemented for project-note enrichment, project-card review, duplicate evidence merge, basic external-safe de-identification review, and computed STAR story promotion. Embedding RAG is not complete yet.
- Authentication, workspace isolation, PDF/DOCX export, interview prep, job recommendation, and email tracking are not implemented yet.

## Next Task Queue

| Priority | Task | Status |
|----------|------|--------|
| P0 | Keep this status file updated with every implementation step | Active |
| P0 | Add a reusable local full-workflow smoke script without storing resume content in git | Done |
| P0 | Improve claim review UX so `unvalidated` resumes show exactly which claims need attention | Done, MVP |
| P1 | Add resume export path, likely Markdown first, then PDF/DOCX | Markdown/JSON done, PDF/DOCX not started |
| P1 | Build Evidence Library Builder for project notes, project cards, and richer resume retrieval context | Done, MVP with computed STAR story bank |
| P1 | Add evidence merge/dedupe and de-identification workflow UI | Done, MVP |
| P1 | Redeploy latest baseline to Vercel and re-run production smoke | Done after STAR story promotion |
| P2 | Start interview preparation workflow | Not started |
| P2 | Start daily job recommendation workflow | Not started |
| P2 | Start email/application tracking workflow | Not started |

## Update Rule

Before future commits, update:

1. This file for workflow/task status.
2. `README.md` only when setup, commands, or high-level product coverage changes.
3. `docs/SETUP.md` only when local setup, environment variables, migrations, or verification commands change.
4. PRD/design docs only when the product contract or architecture changes, not for routine implementation progress.
