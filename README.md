# JobDesk

JobDesk is an early local-first job-search copilot. The current implementation is split into two workflows: first prepare a reusable material library from resumes and project notes, then apply that library to a target job workspace for JD analysis, tailored resumes, Fact Guard, interview prep, and manual application tracking.

## Current Status

The source of truth for implementation progress is `docs/development-status.md`.

Current local baseline:

- 9 product workflows implemented at MVP depth.
- Resume Review workflow: PDF, DOCX, TXT, and Markdown resume version upload, duplicate detection, and LLM-first general resume scoring with local fallback.
- Material Library workflow: reviewed resume version extraction plus project-note/source parsing.
- Material Library workflow: profile/evidence extraction from resumes and project notes with persistence.
- Basic evidence/project-card review, external-safe de-identification, duplicate evidence merge, and STAR story promotion.
- Job Workspace workflow: JD analysis with persistence, reload, reanalysis, and archive.
- Job Workspace workflow: tailored resume generation using approved evidence retrieval, including best-effort local embedding retrieval when an index exists.
- Generated claim ledger and deterministic Fact Guard revalidation.
- Interview prep packs from analyzed jobs, STAR stories, and indexed evidence.
- Manual application tracker for analyzed job workspaces.
- Optional bearer-token access gate for personal deployments.
- Local deterministic embedding index with a reindex API and Drizzle persistence.
- Drizzle/Postgres migrations and DB-backed integration tests.
- Next.js workbench UI for local testing.

Not implemented yet:

- Full auth and production workspace isolation.
- Resume export to PDF/DOCX.
- Daily job recommendation workflow.
- Email-assisted tracking workflow.

## Setup

```bash
npm install
cp .env.example .env
```

Fill `JOBDESK_OPENROUTER_API_KEY` in `.env` before running real AI calls.
For the current OpenRouter-compatible route, use
`JOBDESK_OPENROUTER_TRANSPORT=chat-completions`.
Fill `DATABASE_URL` with the separate JobDesk Postgres connection string when
you are ready to persist jobs, evidence, resumes, claims, embeddings, interview prep packs, and workflow runs.
Set `JOBDESK_ACCESS_TOKEN` for a personal deployment that should block unauthenticated API calls. Leave it empty for local development without an access prompt.

## Commands

```bash
npm run dev
npm run typecheck
npm test
npm run test:integration
npm run gen:jsonschema
npm run ai:smoke:jd
npm run smoke:full -- --resume-file /path/to/resume.pdf --base-url http://127.0.0.1:3030
npm run db:generate
npm run db:migrate
npm run db:push # disposable local dev only
```

Open the local app at `http://localhost:3000` after `npm run dev`, or pass a different port such as `npm run dev -- -p 3030`.

Database changes are persisted as Drizzle SQL migrations under `drizzle/`.
Use `npm run db:migrate` for any database that may contain user data. Reserve
`npm run db:push` for disposable local development databases only.
