# JobDesk

JobDesk is the early foundation for a job-search copilot: product docs,
versioned skills, canonical Zod schemas, and the first OpenRouter-backed AI
contract calls.

## Current Status

Implemented:

- Minimal Next.js Phase 1.1 app shell with a JD analysis workbench.
- Grounding-spine Zod schemas under `src/schemas/`.
- JSON Schema generation from Zod.
- Skill instruction packs under `skills/`.
- OpenRouter-compatible structured JSON adapter under `src/ai/`.
- JD analysis smoke path using real OpenRouter.
- Drizzle/Postgres persistence for analyzed job descriptions, requirements, and
  workflow runs.
- Recent job loading, job detail reload, same-job re-analysis, and soft archive.
- Structured job facts: company, role title, level, location, responsibilities,
  and preferred qualifications.
- Optional DB-backed integration test command for repository/API workbench paths.
- Profile/evidence extraction MVP from pasted resume or career-note text.

Not implemented yet:

- File upload/PDF parsing, retrieval, export, and broader workflow orchestration.
- Profile/evidence approval, editing, dedupe, merge, and de-identification UI.
- Authentication, deployment config, and production workspace isolation.

## Setup

```bash
npm install
cp .env.example .env
```

Fill `JOBDESK_OPENROUTER_API_KEY` in `.env` before running real AI calls.
For the current OpenRouter-compatible route, use
`JOBDESK_OPENROUTER_TRANSPORT=chat-completions`.
Fill `DATABASE_URL` with the separate JobDesk Neon Postgres connection string
when you are ready to persist jobs and workflow runs.

## Commands

```bash
npm run dev
npm run typecheck
npm test
npm run test:integration
npm run gen:jsonschema
npm run ai:smoke:jd
npm run db:generate
npm run db:migrate
npm run db:push # disposable local dev only
```

Open the local app at `http://localhost:3000` after `npm run dev`.

The smoke command sends a small sample job description to the configured
OpenRouter-compatible adapter and validates the result with the `JDAnalysis` Zod
schema.

Database changes are persisted as Drizzle SQL migrations under `drizzle/`.
Use `npm run db:migrate` for any database that may contain user data. Reserve
`npm run db:push` for disposable local development databases only.
