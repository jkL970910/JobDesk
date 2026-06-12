# JobDesk

JobDesk is an early local-first job-search copilot. The current implementation focuses on the resume grounding spine: parse a resume source, extract profile/evidence, analyze a target JD, generate a tailored resume, run a conservative Fact Guard over the generated claim ledger, and prepare interview material from grounded STAR stories.

## Current Status

The source of truth for implementation progress is `docs/development-status.md`.

Current local baseline:

- 7 product workflows implemented at MVP depth.
- PDF, DOCX, TXT, and Markdown resume source parsing.
- Profile/evidence extraction from resumes and project notes with persistence.
- Basic evidence/project-card review, external-safe de-identification, duplicate evidence merge, and STAR story promotion.
- JD analysis with persistence, reload, reanalysis, and archive.
- Tailored resume generation using approved evidence retrieval, including best-effort local embedding retrieval when an index exists.
- Generated claim ledger and deterministic Fact Guard revalidation.
- Interview prep packs from analyzed jobs, STAR stories, and indexed evidence.
- Local deterministic embedding index with a reindex API and Drizzle persistence.
- Drizzle/Postgres migrations and DB-backed integration tests.
- Next.js workbench UI for local testing.

Not implemented yet:

- Auth and production workspace isolation.
- Resume export to PDF/DOCX.
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
you are ready to persist jobs, evidence, resumes, claims, embeddings, interview prep packs, and workflow runs.

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
