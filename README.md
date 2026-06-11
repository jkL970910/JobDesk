# JobDesk

JobDesk is an early local-first job-search copilot. The current implementation focuses on the resume grounding spine: parse a resume source, extract profile/evidence, analyze a target JD, generate a tailored resume, and run a conservative Fact Guard over the generated claim ledger.

## Current Status

The source of truth for implementation progress is `docs/development-status.md`.

Current local baseline:

- 6 product workflows implemented at MVP depth.
- PDF, DOCX, TXT, and Markdown resume source parsing.
- Profile/evidence extraction with persistence.
- Basic evidence review actions for resume eligibility.
- JD analysis with persistence, reload, reanalysis, and archive.
- Tailored resume generation using approved evidence retrieval.
- Generated claim ledger and deterministic Fact Guard revalidation.
- Drizzle/Postgres migrations and DB-backed integration tests.
- Next.js workbench UI for local testing.

Not implemented yet:

- Auth and production workspace isolation.
- Resume export to PDF/DOCX.
- Evidence merge/dedupe and full de-identification UX.
- Interview preparation workflow.
- Daily job recommendation workflow.
- Email/application tracking workflow.

## Setup

```bash
npm install
cp .env.example .env
```

Fill `JOBDESK_OPENROUTER_API_KEY` in `.env` before running real AI calls.
For the current OpenRouter-compatible route, use
`JOBDESK_OPENROUTER_TRANSPORT=chat-completions`.
Fill `DATABASE_URL` with the separate JobDesk Postgres connection string when
you are ready to persist jobs, evidence, resumes, claims, and workflow runs.

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
