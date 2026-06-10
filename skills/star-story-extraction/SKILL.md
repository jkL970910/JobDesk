---
name: star-story-extraction
description: >
  Turn approved evidence and project cards into structured behavioral stories
  using the STAR-C framework (Situation, Task, Action, Result, Constraints). Each
  story stays grounded in evidence — no invented outcomes or metrics — and maps to
  the competencies a behavioral interview is likely to probe. Use when building an
  evidence library's story candidates or preparing behavioral interview answers.
version: 0.1
inclusion: manual
applies_to_component: C2 Evidence Curator, C9 Interview Coach
related_docs: build-and-learn.md §2 and §9
---

# STAR Story Extraction

## Purpose & trigger

Use this skill to convert approved evidence/project cards into reusable behavioral
stories. A story is a structured retelling of a real experience that a candidate
can adapt during an interview. Stories must be grounded: every claim traces to an
evidence item, and no result or metric is invented.

## Framework: STAR-C

Use STAR extended with an explicit Constraints field. STAR is common interview
methodology; the added Constraints field helps preserve context and judgment.

For each story capture:
- **Situation** — the context, drawn from a project card's context/problem.
- **Task** — what the candidate was specifically responsible for.
- **Action** — what the candidate actually did (their role, not the team's).
- **Result** — the outcome, with metrics ONLY if a source number exists.
- **Constraints** — the limits they worked under (time, resources, ambiguity,
  org/regulatory). Constraints turn a flat story into one that shows judgment.

## Hard rules

1. **Grounded only.** Every Situation/Task/Action/Result element must trace to an
   evidence item (carry `evidence_ids`). If a result has no source number, state
   it qualitatively — do not invent a metric.
2. **First-person scope.** Actions describe what the candidate did, not what "the
   team" did. If the evidence only supports team-level work, say so.
3. **No embellishment of outcome.** A modest, true result beats an impressive,
   unsupported one.
4. **Mark inference.** If any element is inferred rather than stated, label it and
   route it to the user for confirmation (do not store as confirmed).

## Competency mapping

Tag each story with the competencies it can answer (e.g., ownership,
problem-solving, dealing with ambiguity, influence without authority, delivering
results). One strong story usually serves multiple competencies — record all that
genuinely apply, based on the story content, not aspiration.

## Output contract

Produce story candidates matching `star-story.schema.json` (sketch):
- `title`, `situation`, `task`, `action`, `result`, `constraints`.
- `evidence_ids[]` backing each element.
- `competencies[]` the story can address.
- `confidence` and `needs_user_confirmation` (true if any element is inferred).
- `status`: `pending` until the user approves (matches Evidence Curator lifecycle).

## Examples

### Grounded story (good)
Evidence: "Owned migration of weekly reporting to an automated dashboard; cut
reporting time ~6 hrs/week; coordinated 3 regional teams under a 1-month deadline."
→ Situation: manual reporting was slow. Task: automate it. Action: candidate
designed and built the dashboard, coordinated 3 teams. Result: ~6 hrs/week saved
(source number). Constraints: 1-month deadline, 3 stakeholder teams.
Competencies: ownership, delivering results, influence.

### Ungrounded (reject)
Turning "helped with reporting" into "single-handedly rebuilt the entire
analytics platform, improving accuracy 40%." No source for scope or the 40%.
Route as a confirmation question instead.

## Common failure modes (avoid)

- Inventing a Result metric to make the story land.
- Inflating individual scope beyond what evidence supports.
- Over-tagging competencies the story doesn't actually demonstrate.
- Storing an inferred story as confirmed.

## Evaluation rubric

- Ungrounded result/metric in any stored story: target 0.
- Every story element carries backing evidence_ids: 100%.
- Inferred elements flagged for confirmation, never auto-confirmed.
