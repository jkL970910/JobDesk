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
- **Work initiatives:** coherent employer-internal projects/stories under a role
  (context, problem, role, actions, results, metrics, technologies,
  stakeholders).
- **Project cards:** legacy structured project records. Prefer work initiatives
  for employer-internal work and portfolio projects for non-employer work.
- Link evidence to its `related_project_id` where applicable.

## Initiative granularity

An initiative is one coherent project/story under a role. It is not one keyword,
tool, task, system component, or outcome.

Hard rules:

- Do not create separate initiatives for the technology used, the infrastructure
  built, and the performance outcome when they refer to the same work.
- If candidates share the same employer/role, source bullet or adjacent bullets,
  system/domain, and outcome, merge them into one initiative.
- Put tools such as AWS CDK, React, SQL, Kafka, Redis, or Looker into
  `technologies` or `actions`.
- Put latency, revenue, activation, reliability, cost, or efficiency improvements
  into `results` or `metrics`.
- Put service/domain context into `context` or `problem`.
- Create separate initiatives only when the source describes distinct business
  problems, systems, ownership scopes, or outcomes.
- Every initiative should set `work_experience_ref` to the exact draft key of
  the matching work experience: `employer + " · " + role_title`, for example
  `Amazon · Software Dev Engineer Intern`.
- Use `work_experience_ref: null` only when the source does not identify the
  employer/role. A null role reference means the initiative cannot be safely
  auto-consolidated with other initiatives.

### Granularity example

Bad split:

1. "AWS infrastructure provisioning with CDK"
2. "Session latency optimization with distributed caching"
3. "Distributed cloud caching for high-scale delivery service"

Good single initiative:

```json
{
  "internal_title": "Distributed caching infrastructure for session latency optimization",
  "context": "High-scale delivery service had session/dependency latency constraints.",
  "actions": ["Provisioned distributed caching infrastructure using AWS CDK."],
  "results": ["Optimized session latency."],
  "technologies": ["AWS CDK", "distributed cache"]
}
```

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
