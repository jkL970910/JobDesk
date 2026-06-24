# JobDesk Schemas — Local Setup

This sets up the canonical Zod schemas and local MVP workbench for the Material Library
and Job Workspace flows, with type-checking, contract tests, JSON Schema generation,
OpenRouter-backed structured AI calls, persistence, resume source parsing, source chunk
retrieval support, explainable retrieval, local embedding retrieval, interview prep packs,
manual application tracking, account login/register, optional personal access protection,
and Fact Guard verification.

Decisions baked in (per design review):
1. **Zod (`.ts`) is the source of truth.** JSON Schema is *generated*, never
   hand-edited.
2. **Shared primitives first** (`src/schemas/shared.ts`) — every schema imports the
   enums/primitives from there so vocabularies cannot drift.
3. **Two workflow lanes** — Material Library owns profile, evidence, project,
   and STAR material without requiring a JD; Job Workspace owns jd-analysis,
   tailored-resume, generated-claim, interview prep, and application status.
4. **Runnable repo** (this folder) so the contracts validate and tests pass.

## Prerequisites

- **Node.js 20+** (22 recommended). Check: `node --version`
  - If you don't have it (Windows), install from https://nodejs.org (LTS), or use
    nvm-windows: https://github.com/coreybutler/nvm-windows
- npm comes with Node.

## Steps

Run these from the JobDesk folder (where `package.json` is).

1. Install dependencies:
   ```
   npm install
   ```

2. Type-check the schemas (proves they compile under strict TypeScript):
   ```
   npm run typecheck
   ```
   Expected: no output / exit 0.

3. Run the contract tests (proves the schemas behave as designed):
   ```
   npm test
   ```
   Expected: all tests in `tests/schemas.test.ts` pass (defaults applied,
   missing source_quote rejected, unknown enum rejected, claim starts
   `unvalidated`, etc.).

4. Generate JSON Schema artifacts from the Zod source:
   ```
   npm run gen:jsonschema
   ```
   Expected: writes `schemas-json/*.schema.json` (gitignored — they are generated).
   These are the `*.schema.json` files the skills and docs refer to.

5. Configure real OpenRouter access for AI smoke tests:
   ```
   cp .env.example .env
   ```
   Fill `JOBDESK_OPENROUTER_API_KEY` in `.env`.
   The default `.env.example` uses the OpenRouter-compatible
   `chat-completions` transport because the current `openrouter.icu` route
   exposes `/v1/chat/completions`.
   Set `JOBDESK_SESSION_SECRET` when running a deployed account-login environment.
   Production account auth fails closed when this secret is missing.
   `JOBDESK_ACCESS_TOKEN` is still supported as a legacy bearer-token bypass for
   personal deployments.

6. Run the JD analysis smoke test:
   ```
   npm run ai:smoke:jd
   ```
   Expected: prints a `JDAnalysis` JSON object parsed through the Zod contract.
   The script loads `.env` automatically. If no key is configured, it fails before
   making a network call.

7. Run the full local workflow smoke test after the dev server is running:
   ```
   npm run dev -- -p 3030
   npm run smoke:full -- --resume-file /path/to/resume.pdf --base-url http://127.0.0.1:3030
   ```
   Expected: PDF/DOCX/TXT/Markdown source parsing, profile/evidence extraction,
   evidence approval, JD analysis, tailored resume generation, and Fact Guard all
   return passing status without printing resume source text.

8. Configure Postgres persistence when a separate JobDesk Neon database is ready:
   ```
   DATABASE_URL=postgresql://...
   npm run db:migrate
   ```
   `DATABASE_URL` must point to the JobDesk database, not the portfolio-manager
   or alignerlog database.

   When `DATABASE_URL` is configured, the app shows login/register and stores
   user sessions in Postgres. Each account gets its own default personal
   workspace for new data. Existing legacy rows with no workspace owner remain
   available only through the no-session/local fallback path.

   Migration policy:
   - `npm run db:generate` creates versioned SQL files under `drizzle/` after a schema change.
   - `npm run db:migrate` applies committed migrations and is the safe path once the database may contain user data.
   - `npm run db:push` is for disposable local development only; do not use it against a user-data database.

9. Run DB-backed integration tests when you want to verify the workbench paths:
   ```
   npm run test:integration
   ```
   This loads `.env`, writes temporary rows to the configured JobDesk database,
   and soft-archives the test jobs before finishing. The script runs integration test files serially because they share the configured single-user workspace.

   Focused DB checks that are useful after the latest Evidence Library / RAG routing work:
   ```
   JOBDESK_RUN_DB_INTEGRATION=true npx vitest run tests/source-document-repository.integration.test.ts
   JOBDESK_RUN_DB_INTEGRATION=true npx vitest run tests/profile-evidence-repository.integration.test.ts --testNamePattern "source chunk|profile context|imported note|role field|suggested target|target eligibility"
   ```

## What you should see

- `src/schemas/` — the authored Zod schemas (edit these; this is the truth).
- `src/ai/` — OpenRouter-compatible adapter and structured call helpers.
- `src/db/` — Drizzle schema and Postgres client.
- `src/server/` — repository functions for persisted workflows.
- `schemas-json/` — generated JSON Schema (do NOT edit; regenerate instead).
- `tests/schemas.test.ts` — contract tests you can extend as you learn.

## Layout

```
JobDesk/
  package.json            # deps + scripts
  tsconfig.json           # strict TS config
  src/schemas/
    shared.ts             # primitives + enums: evidence, claims, application statuses, legitimacy tiers
    profile.ts            # C1
    evidence.ts           # C2 (evidence, project, STAR story, redaction)
    jd-analysis.ts        # C3
    tailored-resume.ts    # C5/C6 (resume + generated claim ledger)
    index.ts              # barrel export
  src/ai/
    config.ts             # server-side env parsing
    env.ts                # local .env loader for scripts
    openrouter-adapter.ts # OpenRouter-compatible transport
    output-parser.ts      # output text, JSON, usage parsing
    jd-analysis.ts        # first real structured AI workflow
  src/db/
    schema.ts             # Drizzle Postgres tables, including job legitimacy and application status columns
    client.ts             # server-side Postgres client
  src/server/
    job-repository.ts     # JD analysis persistence
  scripts/
    generate-json-schema.ts
    smoke-jd-analysis.ts
  tests/
    schemas.test.ts
    ai-openrouter.test.ts
  schemas-json/           # generated (gitignored)
```

## Notes

- If `npm install` is blocked by registry/proxy settings on your machine, configure
  npm to your private or custom registry first, then re-run. The pinned versions in
  `package.json` are exact (no `^`) for reproducibility.
- This is intentionally still a **thin MVP shell**, not the full JobDesk product.
  The current baseline includes JD analysis, resume source parsing for PDF/DOCX/TXT/Markdown,
  Profile/Evidence extraction, basic evidence approval/editing, source chunk indexing,
  explainable retrieval, typed imported-note resolution, profile context persistence,
  profile fact provenance, route-aware enrichment target gating, tailored resume generation,
  generated claim ledgers, deterministic Fact Guard revalidation, local embedding indexing,
  interview prep packs, manual application status tracking, account login/register with session cookies,
  legacy bearer-token API compatibility, Drizzle/Postgres persistence, recent job reload,
  same-job re-analysis, soft archive, Skills Registry audit metadata, and DB-backed integration tests.
  Use `npm run verify:local` for the standard local baseline. See `docs/development-status.md`
  for the current workflow count, verification status, and next tasks.
  PDF/DOCX export, daily job recommendations, and email-assisted tracking are still later phases.
- To extend: add a new `src/schemas/<name>.ts`, import shared primitives, export it
  from `index.ts`, and add it to `scripts/generate-json-schema.ts` if you want a
  generated JSON artifact.
```
