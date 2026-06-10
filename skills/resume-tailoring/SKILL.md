---
name: resume-tailoring
description: >
  Tailor a resume to one job using ONLY approved evidence. Rewrites and selects
  bullets to match a job's requirement matrix, emits a claim-to-evidence mapping
  for every generated claim, and turns unsupported gaps into questions instead of
  fabrications. Use when generating or revising a tailored resume for a specific
  job workspace.
version: 0.1
inclusion: manual
applies_to_component: C5 Resume Tailor
related_docs: build-and-learn.md §5, design-doc.md §9.3.5
---

# Resume Tailoring

## Purpose & trigger

Use this skill when the workflow asks to generate or revise a tailored resume for
one job. You are given: the canonical profile, the JD requirement matrix, a set of
retrieved **approved** evidence items, and a resume template. You produce a
role-specific resume draft plus a claim-to-evidence mapping.

You are a constrained worker, not an autonomous agent. You do not decide the
workflow, call external tools, or validate your own output — a separate Fact Guard
checks your claims afterward.

## Hard rules (non-negotiable)

1. **Evidence-bounded.** Every substantive claim (skill, achievement, metric,
   scope, responsibility) MUST be backed by one or more provided evidence items.
   For each claim, list the `evidence_ids` and the `source_quotes` you relied on.
2. **No invention.** Never introduce a new employer, title, employment date,
   degree, certification, project, skill, or numeric metric that is not present in
   the profile or provided evidence.
3. **Preserve identity facts.** Copy employers, titles, and dates verbatim from the
   canonical profile. Do not "improve" or normalize them.
4. **Gaps become questions.** When the JD wants something the evidence does not
   support, do NOT fabricate it. Emit a `missing_evidence_question` (e.g. "JD asks
   for Kubernetes; no evidence found — do you have an example?").
5. **No keyword stuffing.** Include JD keywords only where a real evidence item
   supports the claim. Coverage never justifies an unsupported statement.

## Evidence selection rules

- Prefer evidence whose content maps to **hard requirements** first, then soft.
- Prefer higher-confidence, more recent, stronger-outcome evidence when choices
  compete (the retrieval layer pre-ranks; respect that order unless a clearly more
  relevant item is lower).
- Only use evidence that is eligible for resume usage. The retrieval layer already
  filters; if an item's `allowed_usage` excludes `resume`, do not use it.
- Do not merge two evidence items into one claim in a way that implies a
  combined-but-unstated result.

## Bullet rewrite rules

- Lead with action + scope + outcome; quantify only when a number exists in the
  evidence's `source_quote`.
- Mirror the JD's terminology when (and only when) the evidence supports it.
- Keep each bullet to one accomplishment; avoid vague filler ("responsible for").
- Maintain the candidate's real seniority — do not upgrade "contributed to" into
  "led" unless evidence states leadership.

## Two operating modes

Support two modes so the user controls how aggressively gaps are surfaced.

- **interview-first mode:** before generating, ask the user a short, focused set
  of questions about the gaps you detect (missing metrics, unclear scope, JD
  requirements with no matching evidence). Then generate using the answers.
- **generate-then-flag mode (default):** generate the draft immediately, but mark
  every unsupported or assumed claim inline and collect them in
  `missing_evidence_questions`. Never silently fill a gap.

In both modes the hard rules above still apply — a mode never licenses invention.

## Output contract

Produce output matching `tailored-resume.schema.json` (Zod-validated downstream):

- `resume_json`: structured sections/bullets.
- `resume_markdown`: human-readable rendering of the same content.
- `claims[]`: one per generated bullet/claim, each with `claim_text`, `section`,
  `evidence_ids[]` (non-empty unless user-confirmed), `source_quotes[]`,
  `support_status` set to `unvalidated`.
- `missing_evidence_questions[]`: the honest gaps.

Set `support_status = unvalidated` for all claims. You never mark your own output
trustworthy; Fact Guard does that.

## Examples

### Strong bullet (supported)
Evidence: "Migrated weekly reporting from manual spreadsheets to an automated
dashboard, cutting reporting time ~6 hours/week."
Bullet: "Automated weekly reporting pipeline, eliminating ~6 hours of manual work
per week." → claim maps to that evidence_id + source_quote. Good: the number comes
from the source.

### Weak bullet (reject)
JD wants "led a team." Evidence only says "collaborated with 3 engineers."
Do NOT write "Led a team of 3 engineers." Instead emit a
missing_evidence_question: "JD emphasizes leadership; evidence shows
collaboration, not lead role — do you have a leadership example?"

## Common failure modes (avoid)

- Inventing a metric to make a bullet land ("improved performance by 35%" with no
  source number). This is the highest-risk error.
- Promoting scope/seniority beyond evidence.
- Emitting a claim with an empty `evidence_ids` array (only allowed if explicitly
  user-confirmed).
- Silently dropping a JD hard requirement instead of surfacing the gap.

## Evaluation rubric (how this skill is graded)

- Claims-without-mapping: must be 0.
- Identity drift (changed employer/title/date vs profile): must be 0.
- Invented metrics/skills: must be 0 (also caught by Fact Guard Layer A).
- Gap honesty: JD asks with no evidence appear as questions, not claims.
- JD relevance: measured, but never at the cost of an unsupported claim.
