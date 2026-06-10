# JobDesk Schemas — Local Setup

This sets up the canonical Zod schemas (source of truth) for the grounding-spine
components (1-6), with type-checking, contract tests, and JSON Schema generation.

Decisions baked in (per design review):
1. **Zod (`.ts`) is the source of truth.** JSON Schema is *generated*, never
   hand-edited.
2. **Shared primitives first** (`src/schemas/shared.ts`) — every schema imports the
   enums/primitives from there so vocabularies cannot drift.
3. **Grounding-spine scope only** — profile, evidence, project, jd-analysis,
   tailored-resume, generated-claim. Downstream schemas come in their phases.
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

## What you should see

- `src/schemas/` — the authored Zod schemas (edit these; this is the truth).
- `schemas-json/` — generated JSON Schema (do NOT edit; regenerate instead).
- `tests/schemas.test.ts` — contract tests you can extend as you learn.

## Layout

```
JobDesk/
  package.json            # deps + scripts
  tsconfig.json           # strict TS config
  src/schemas/
    shared.ts             # primitives + enums (imported by all)
    profile.ts            # C1
    evidence.ts           # C2 (evidence, project, STAR story, redaction)
    jd-analysis.ts        # C3
    tailored-resume.ts    # C5/C6 (resume + generated claim ledger)
    index.ts              # barrel export
  scripts/
    generate-json-schema.ts
  tests/
    schemas.test.ts
  schemas-json/           # generated (gitignored)
```

## Notes

- If `npm install` is blocked by registry/proxy settings on your machine, configure
  npm to your private or custom registry first, then re-run. The pinned versions in
  `package.json` are exact (no `^`) for reproducibility.
- This is intentionally **schemas-only** — no app, no server, no DB yet. It's the
  contract foundation. The app scaffold is a later step.
- To extend: add a new `src/schemas/<name>.ts`, import shared primitives, export it
  from `index.ts`, and add it to `scripts/generate-json-schema.ts` if you want a
  generated JSON artifact.
```
