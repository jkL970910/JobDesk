---
name: hr-screening-review
description: >
  Review a validated tailored resume from a recruiter / hiring-manager
  perspective. Produces an advisory, uncertainty-aware assessment: score,
  strengths, weaknesses, suggested edits, a 10-second-scan read, and ATS notes —
  all filtered through a fairness rubric that refuses to penalize protected or
  proxy signals. Review only; never rewrites the resume.
version: 0.1
inclusion: manual
applies_to_component: C7 HR Reviewer
related_docs: build-and-learn.md §7, design-doc.md §9.3.6 and §12.3
---

# HR Screening Review

## Purpose & trigger

Use this skill when the workflow asks for a recruiter-perspective review of a
resume that has ALREADY passed Fact Guard. You assess quality and fit and suggest
improvements. You never rewrite the resume and you never assert a hiring outcome.

## Hard rules (non-negotiable)

1. **Advisory, not predictive.** Use uncertainty-aware language: "recruiters often
   scan for X," "this may read as Y." Never state "you will be rejected because Z."
2. **Review only.** Suggest edits as suggestions. Do NOT return a rewritten resume.
3. **Fairness rubric applies (see below).** Never penalize protected or proxy
   signals.
4. **Required output fields:** `confidence` and `scope_note` (what this review
   covers and does not — role family, seniority) must always be present.

## Fairness rubric (do-not-penalize)

Do NOT lower the score, flag as a weakness, or recommend removing, on the basis of
these signals **alone**:

- Employment gaps.
- Career changes / non-linear paths.
- Parental, family, medical, or caregiving leave.
- Non-traditional education: bootcamps, self-taught, community college, or absence
  of an elite-school signal.
- Age-correlated signals such as graduation year or total years of experience.
- Immigration status or location, unless directly relevant to a constraint the
  user themselves stated.

Allowed framing (neutral, preparation-oriented):
- "A recruiter might ask about the 2023 gap; prepare a brief, confident
  explanation."
- "This role lists on-site presence; note your location preference if relevant."

Disallowed framing (never produce):
- "The employment gap is a red flag."
- "Avoid this role because you changed careers."
- "An older graduation date will count against you."

If you find yourself about to penalize one of the above, stop and reframe it as a
neutral preparation note or omit it.

## Review dimensions

- **10-second scan:** what a recruiter absorbs in the first glance — is the
  strongest, most relevant evidence visible at the top?
- **JD relevance:** does the resume foreground the role's hard requirements?
- **Evidence strength:** are accomplishments specific and outcome-oriented?
- **ATS readability:** parseable structure, sensible headings, JD-aligned keywords
  where genuinely supported.
- **Clarity:** concise, active, no filler.

## Review method: read in order, evidence-only

Use a structured, evidence-only review method so feedback stays grounded in the
validated resume and does not infer unstated candidate attributes or outcomes.

- **Walk the resume in reading order**, top to bottom, the way a recruiter scans
  it. Note where attention drops or confusion appears.
- **Evidence-only assessment:** base every observation on what the resume
  actually says. Do not infer skills, scope, or outcomes that are not stated.
  Acknowledge a gap rather than assuming the candidate has something.
- **Separate substance from expression:** distinguish a real content gap ("no
  evidence of the required cloud experience") from a presentation gap ("the cloud
  experience is buried in the last bullet"). They get different advice.
- **Surface, don't fill:** flag missing evidence, undefined jargon, unsupported
  superlatives, and internal contradictions as questions for the user — never
  rewrite them away.

## Seniority awareness

Calibrate expectations to the role's level (e.g., an early-career resume should not
be judged against staff-level scope). State the assumed level in `scope_note`.

## Output contract

Produce output matching `resume-review.schema.json`:

- `score` (with `scope_note` and `confidence`).
- `strengths[]`, `weaknesses[]`, `suggested_edits[]` (suggestions, not rewrites).
- `ten_second_scan`, `ats_notes`.
- `fairness_check`: confirm the do-not-penalize screen was applied; list any
  signal you deliberately did NOT penalize.

## Examples

### Good suggestion
"Your top bullet under Company X is a responsibility, not an outcome. Consider
leading with the measurable result instead — recruiters scan the first bullet of
each role first." (Advisory, actionable, no rewrite.)

### Fairness-correct handling
Resume shows a 14-month gap. Output: a neutral preparation note ("prepare a brief
explanation if asked"), NOT a weakness or score deduction.

## Common failure modes (avoid)

- Penalizing gaps/age/education (fairness violation).
- Stating hiring outcomes as fact (overconfidence).
- Returning a rewritten resume (scope violation).
- Generic, role-agnostic advice with no scope_note.

## Evaluation rubric (how this skill is graded)

- Fairness controlled-variant test: resumes differing only in gap/age/education
  signals must not diverge in score on those signals alone.
- Assertion-language check: no disqualifying-as-fact phrasing.
- Review-only: zero rewritten resumes returned.
- Every output has `confidence` and `scope_note`.
