---
name: claim-support-judgment
description: >
  Judge whether a generated claim is semantically supported by its linked evidence,
  returning supported / partially_supported / unsupported with confidence and a
  reason. This is Fact Guard Layer B — a warning-only semantic check that never
  overrides the deterministic Layer A blocks. Use when validating generated resume
  bullets, cover-letter claims, or interview answers against evidence.
version: 0.1
inclusion: manual
applies_to_component: C6 Fact Guard Layer B
related_docs: build-and-learn.md §6; design-doc.md §9.3.8 and §13.4
---

# Claim Support Judgment (Fact Guard Layer B)

## Purpose & trigger

Use this skill to assess the *semantic* support of a generated claim against the
evidence it cites. Deterministic code (Layer A) already handles hard blocking of
net-new entities and blocked terms; this skill handles the fuzzy question Layer A
cannot: "does this evidence actually back what the claim says?"

## Role boundary (important)

- **Warning-only.** This skill produces support ratings and warnings. It does NOT
  block finalization on its own and CANNOT override a Layer A block. (See
  build-and-learn §6.)
- It judges support; it does not rewrite the claim or invent evidence.

## Support rating scale

For each claim + its linked evidence, return one of:
- **supported:** the evidence directly substantiates the claim (scope, action, and
  any quantities all backed).
- **partially_supported:** the evidence backs the gist but the claim overstates
  scope, certainty, or magnitude (e.g., "led" vs evidence's "contributed"; a
  rounded-up metric).
- **unsupported:** the evidence does not substantiate the claim, or the claim adds
  a fact the evidence doesn't contain.

Always include a `confidence` and a short `reason` citing what in the evidence
does or doesn't support the claim.

## Judgment guidelines

- **Scope:** does the evidence support the level of ownership/seniority claimed?
- **Quantity:** if the claim has a number, does the evidence's quote contain it (or
  clearly imply it)? If only Layer A checks the number's presence, here check that
  the number is used in a way the evidence supports.
- **Certainty:** does the claim assert as fact something the evidence only
  suggests?
- **Conservative on ambiguity:** when genuinely unclear, rate
  `partially_supported`, not `supported`.

## Output contract

Produce, per claim, output matching the claim-support shape:
- `claim_id`, `support_status` (supported | partially_supported | unsupported),
  `confidence`, `reason`, `evidence_ids_considered[]`.
- `suggested_evidence_gap`: what additional evidence would make it supported
  (optional, advisory).

These feed the claim ledger (status + last_validated_at) and surface as warnings
to the user; they also drive revalidation when evidence changes.

## Examples

### supported
Claim: "Automated weekly reporting, saving ~6 hours/week."
Evidence quote: "...cut reporting time by about 6 hours per week." → supported.

### partially_supported
Claim: "Led a team of 5 engineers."
Evidence: "Worked with 5 engineers to deliver X." → partially_supported (scope:
"worked with" ≠ "led"); reason notes the overstatement.

### unsupported
Claim: "Increased revenue 20%."
Evidence: mentions a project but no revenue figure → unsupported; reason: no
revenue evidence.

## Common failure modes (avoid)

- Rating `supported` when the claim overstates scope or certainty.
- Trying to block (that's Layer A's job) or rewriting the claim.
- Inventing evidence to justify a claim.
- Ignoring quantity overstatement because Layer A "already checked numbers."

## Evaluation rubric

- Agreement with human judgment on a labeled set (supported/partial/unsupported).
- Overstatement detection: catches scope/certainty inflation in golden cases.
- Never overrides a Layer A block (by construction).
