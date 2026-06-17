# JobDesk

JobDesk is an early local-first job-search copilot. The current implementation is split into two workflows: first prepare a reusable material library from resumes and project notes, then apply that library to a target job workspace for JD analysis, tailored resumes, Fact Guard, interview prep, and manual application tracking.

## Current Status

The source of truth for implementation progress is `docs/development-status.md`.

Current local baseline:

- 10 product workflows implemented at MVP depth.
- Resume Review workflow: PDF, DOCX, TXT, and Markdown resume version upload, duplicate detection, and LLM-first general resume scoring with local fallback.
- Material Library workflow: reviewed resume version extraction plus project-note/source parsing.
- Material Library workflow: profile/evidence extraction from resumes and project notes with persistence.
- Basic evidence/project-card review, external-safe de-identification, duplicate evidence merge, and STAR story promotion.
- Job Workspace workflow: JD analysis with persistence, reload, reanalysis, and archive.
- Job Workspace workflow: tailored resume generation using approved evidence retrieval, including best-effort local embedding retrieval when an index exists.
- Generated claim ledger and deterministic Fact Guard revalidation.
- Interview prep packs from analyzed jobs, STAR stories, and indexed evidence.
- Manual application tracker for analyzed job workspaces.
- Account login/register with httpOnly session cookies plus legacy bearer-token access gate compatibility.
- Local deterministic embedding index with a reindex API and Drizzle persistence.
- Drizzle/Postgres migrations and DB-backed integration tests.
- Skills Registry audit metadata for AI/deterministic workflow provenance.
- Next.js workbench UI for local testing.

Not implemented yet:

- Fine-grained multi-workspace/team sharing beyond one personal workspace per account.
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
you are ready to persist jobs, evidence, resumes, claims, embeddings, interview prep packs, workflow runs, users, and sessions.
Set `JOBDESK_SESSION_SECRET` for deployed account sessions; production account
auth fails closed when this secret is missing. `JOBDESK_ACCESS_TOKEN` is still
supported as a legacy bearer-token bypass for personal deployments.

## Commands

```bash
npm run dev
npm run typecheck
npm test
npm run test:integration
npm run verify:local
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
