---
name: job-recommendation-ranking
description: >
  Rank candidate job postings against the user's profile, level, location, and
  stated constraints, producing a fit score, match reasons, and risk notes for
  each. Applies the same fairness rubric as HR review — never down-ranks on
  protected or proxy signals — and only ranks postings with a verifiable source.
  Use when scoring discovered jobs for recommendation.
version: 0.1
inclusion: manual
applies_to_component: C12 Job Scout
related_docs: build-and-learn.md §12; design-doc.md §9.3.11 and §12.3
---

# Job Recommendation Ranking

## Purpose & trigger

Use this skill to score and explain job postings for the user. Each recommendation
must be fit-justified, risk-aware, and traceable to a real posting. Ranking a
person's opportunities can encode bias, so the fairness rubric is a hard part of
this skill, not an add-on.

## Hard rules

1. **Verifiable postings only.** Every recommendation maps to a fetched posting
   with a resolvable URL. No invented or unverifiable listings.
2. **Explain every recommendation.** Provide concrete match reasons (which profile
   evidence meets which requirement) and risk notes (gaps, stretch areas).
3. **Fairness rubric applies to ranking.** Do not raise or lower fit on protected
   or proxy signals (see below).
4. **Respect the user's stated constraints**, not assumed ones (location, comp,
   industry, remote preference as the user actually specified).

## Fit scoring dimensions

- Requirement match: how many hard requirements the profile/evidence satisfies.
- Seniority alignment: is the role's level consistent with the candidate's scope?
- Constraint match: location, work mode, industry per the user's stated prefs.
- Stretch assessment: which requirements are gaps and how large (honest, not
  discouraging).

## Fairness rubric (do-not-penalize)

(Shared with `hr-screening-review` — keep these consistent.)
Do NOT adjust fit score, recommend against a role, or label as "not a fit" on the
basis of these alone:
- Employment gaps; career changes; non-linear paths.
- Parental/family/medical/caregiving leave.
- Non-traditional education; absence of elite-school signal.
- Age-correlated signals (graduation year, total years).
- Immigration/location unless the user stated it as a constraint.

Allowed framing: surface a genuine requirement gap neutrally ("this role asks for
X; your evidence doesn't show it yet") without discouraging the candidate from
roles based on proxy signals.

## What to produce

- A ranked list, each with fit_score, match_reasons, risk_notes, source URL.
- Deduplicated entries (the same job from multiple sources consolidated).

## Output contract

Produce output matching `job-recommendation.schema.json`:
- `recommendations[]`: { title, company, url, fit_score, match_reasons[],
  risk_notes[], source }.
- Deduplicated; each entry has a verifiable `url`.

## Examples

### Good
"Strong fit (0.82): matches 5/6 hard requirements (distributed systems, Go, on-call
experience — all evidence-backed). Risk: role prefers Kubernetes; your evidence
shows Docker only. [source URL]"

### Reject
- Recommending against a role because of a 1-year employment gap (fairness
  violation).
- Listing a job with no resolvable URL.

## Common failure modes (avoid)

- Penalizing proxy signals (fairness violation).
- Fabricated or stale postings.
- Vague match reasons ("seems like a good fit") with no evidence link.
- Duplicate listings.

## Evaluation rubric

- Postings without a resolvable URL: target 0.
- Fairness controlled-variant test: ranking stable when only protected/proxy
  signals differ.
- Every recommendation has evidence-linked match reasons.
