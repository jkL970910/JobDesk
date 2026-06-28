# Domain Docs

How the engineering skills should consume this repo's domain documentation when
exploring the codebase.

## Layout

This is a single-context repo.

Expected domain documentation locations:

- `CONTEXT.md` at the repo root for project vocabulary and domain model notes.
- `docs/adr/` for architectural decision records.

These files and directories are created lazily. If they do not exist, proceed
silently and use the existing project docs listed below.

## Existing Project Docs

Use the current docs according to their authority:

- `docs/prd.md`: product requirements, scope, personas, success metrics.
- `docs/design-doc.md`: system-level architecture, data model, security/privacy, APIs, deployment, evaluation strategy, and cross-cutting design.
- `docs/architecture.md`: diagram-first architecture companion that mirrors `docs/design-doc.md`.
- `docs/build-and-learn.md`: component-by-component build plan, pipelines, guardrails, benchmarks, and sequencing.
- `docs/development-status.md`: active implementation progress, verification state, known caveats, and next task queue.
- `docs/local-model-setup.md`: local model provider setup notes.
- `docs/SETUP.md`: schema setup and generated JSON Schema workflow.
- `skills/<name>/SKILL.md`: JobDesk-local methodology packs for workflow components.
- `src/schemas/*.ts`: canonical Zod data contracts.

When docs appear to overlap, defer to the authority table in
`docs/design-doc.md`.

## Before Exploring

Before changing behavior, read:

- Relevant sections of `AGENTS.md`.
- Relevant existing docs from the list above.
- `CONTEXT.md`, if it exists.
- Relevant ADRs under `docs/adr/`, if they exist.
- Relevant local skill files under `skills/` when changing prompts, schemas,
  agent behavior, or workflow logic for a matching component.

## Use the Glossary's Vocabulary

When output names a domain concept in an issue title, refactor proposal,
hypothesis, or test name, use the term defined in `CONTEXT.md` when present.

If a concept is missing from the glossary, either use the language already
established in `AGENTS.md` and the docs, or note the gap for `domain-modeling`.

## Flag ADR Conflicts

If output contradicts an existing ADR, surface it explicitly rather than
silently overriding it.
