---
name: profile-positioning
description: >
  Analyze a candidate's canonical profile and approved evidence library to
  recommend evidence-backed target role directions and resume positioning angles
  without requiring a concrete JD. Use when the user needs to decide which job
  directions their actual material supports.
version: 0.1
inclusion: manual
applies_to_component: Profile Positioning Engine
related_docs: docs/development-status.md
---

# Profile Positioning

## Purpose & trigger

Use this skill to generate a positioning report from the candidate's canonical
profile and resume-safe evidence library. The report should help the user
understand which role directions are supported by their real material, which
directions are stretch goals, and what evidence is missing.

This is not job search and not career destiny prediction. It is a grounded
positioning analysis over the user's own evidence.

## Hard rules

1. **Use only supplied profile and evidence.** Do not use outside market data, job
   postings, or assumptions about the user's background.
2. **No career determinism.** Never say "you should become X" or "this is the best
   role for you." Frame every direction as a fit hypothesis with uncertainty.
3. **Evidence IDs required.** Every recommended direction must cite supporting
   evidence IDs. If support is weak, say so and ask for missing evidence.
4. **Fit score reflects evidence strength, not popularity.** A trendy role is not
   a strong fit unless the provided evidence supports it.
5. **Gaps become questions.** Missing proof becomes specific evidence questions,
   not invented achievements or generic coaching.
6. **Resume positioning only.** Suggest emphasis, keywords, and ordering guidance;
   do not generate a resume draft in this workflow.

## Fit scoring guidance

Score each direction from 0 to 100:

- 80–100: multiple strong, resume-safe evidence items directly support the role
  direction and scope.
- 60–79: credible direction with some strong support and some missing proof.
- 40–59: plausible but thin; evidence supports adjacent skills but misses core
  role proof.
- 0–39: weak support; include only if useful as a stretch and explain the gap.

Use confidence separately from score:

- `high`: several direct evidence items, clear role scope, few critical gaps.
- `medium`: some direct support but missing one or two important proof areas.
- `low`: mostly adjacent or inferred support.

## What to produce

Produce 3–5 directions. For each direction include:

- target role title and role family.
- fit score and confidence.
- positioning angle for the resume.
- supporting evidence IDs with reasons and signal tags.
- evidence strength explanation.
- missing evidence questions.
- resume emphasis: summary angle, skills to emphasize, project ordering,
  keywords, and what to deprioritize.
- risks or caveats.

## Output contract

Return JSON matching `ProfilePositioningReport`:

- `summary`
- `generated_at`
- `directions[]`
- `global_strengths[]`
- `global_gaps[]`

## Examples

Good:

"AI Product Manager fit: Medium. Supported by analytics automation and product
execution evidence. Missing stronger AI/ML productization, model evaluation, or
LLM workflow evidence."

Reject:

"You should become an AI PM because AI is hot." This uses market popularity, not
the supplied evidence.
