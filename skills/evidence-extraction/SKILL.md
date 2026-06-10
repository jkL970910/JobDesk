---
name: evidence-extraction
description: >
  Extract reusable evidence items and project cards from source material (project
  notes, performance reviews, past resumes). Tags each item as confirmed vs
  inferred (a hard type, not a score), grounds every metric in a source number,
  and carries source provenance. Inferred items never auto-promote to confirmed.
  Use when curating an evidence library from uploaded documents.
version: 0.1
inclusion: manual
applies_to_component: C2 Evidence Curator (core extraction)
related_docs: build-and-learn.md §2; design-doc.md §9.3.2
---

# Evidence Extraction

## Purpose & trigger

Use this skill to turn raw source documents into small, reusable evidence items
and project cards. The evidence library is the bridge between "raw history" and
"claims we are allowed to make," so the central discipline is honesty about what
is actually supported.

## Hard rules

1. **Evidence type is a hard category, not a confidence number.** Tag each item
   `original`, `extracted`, `user_confirmed`, or `inferred`. An `inferred` item
   (anything the source implies but does not state) NEVER becomes confirmed
   automatically — it requires explicit user action. This is the most important
   rule of the component.
2. **Metric grounding.** Any numeric metric must appear in the item's
   `source_quote`. A metric with no source number is rejected or converted into a
   question for the user ("Do you have a number for this?") — never stored as fact.
3. **Provenance always.** Every item keeps `source_document_id` and `source_span`.
   No item without provenance is auto-confirmed.
4. **First-person scope.** Capture what the candidate did, not what the team did,
   unless the source explicitly states individual ownership.

## What to extract

- **Evidence items:** atomic, reusable facts (an achievement, a responsibility, a
  metric, a skill demonstrated).
- **Project cards:** structured project records (context, problem, role, actions,
  results, metrics, technologies, stakeholders).
- Link evidence to its `related_project_id` where applicable.

## Sensitivity is set at creation

Mark each item's `sensitivity_level` (public_safe | private | sensitive) as it is
created, so the tag travels with the item everywhere downstream. Sensitive items
are quarantined from external use until the de-identification step + user approval
clears them (see `project-deidentification`).

## Dedupe awareness

Before proposing a new item, check whether it duplicates an existing one; propose
a merge rather than creating a near-duplicate. A merged item retains provenance
from all sources.

## Output contract

Produce items matching `evidence.schema.json` / `project.schema.json`:
- Evidence: { text, source_quote, source_document_id, evidence_type, metrics[],
  sensitivity_level, allowed_usage[], related_project_id, status: pending }.
- Project cards with the structured fields above.
- `needs_user_confirmation` true for any inferred item.

## Examples

### Good
Source: "I led the rollout of the new onboarding flow; it cut setup time."
→ evidence_type=extracted (stated), text="Led rollout of new onboarding flow,
reducing setup time", metric: none stored (no number in source), provenance kept.

### Reject
Same source, but storing "reduced setup time by 25%" — no 25% in the text. Either
omit the number or ask the user. And do not tag a "probably led" as confirmed.

## Common failure modes (avoid)

- Promoting inferred facts to confirmed (the dangerous one).
- Inventing metrics.
- Dropping provenance.
- Inflating individual scope beyond the source.

## Evaluation rubric

- Inferred items mislabeled as confirmed: target 0.
- Stored metrics with no source number: target 0.
- Every item has provenance: 100%.
