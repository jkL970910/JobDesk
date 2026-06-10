---
name: project-deidentification
description: >
  Rewrite company-specific or sensitive project content into public-safe language
  for external-facing materials (resume, cover letter). Removes confidential
  identifiers while preserving the achievement's substance, and always produces a
  redaction diff for human review. Pairs a deterministic blocked-terms pass with a
  model rewrite. Use when an evidence item or project card is marked sensitive and
  may be used externally.
version: 0.1
inclusion: manual
applies_to_component: C2 Evidence Curator (de-identification step)
related_docs: build-and-learn.md §2.11.5; design-doc.md §9.3.3
---

# Project De-identification

## Purpose & trigger

Use this skill to produce a `public_safe_summary` for content whose
`sensitivity_level` is `sensitive` (or `private` being promoted to external use).
The goal: keep the real, demonstrable achievement; remove anything confidential.
This skill never decides on its own that content is safe — a human approves the
result, and a deterministic blocked-terms check runs regardless of the model.

## Two-layer approach (do not rely on the model alone)

Use deterministic blocking for known sensitive terms and model rewriting for
fuzzy language. The model never overrides the deterministic block.

1. **Deterministic blocked-terms pass (authoritative for blocking):** match the
   user-maintained blocked-terms list (client names, internal codenames,
   unreleased products, confidential metrics). Any hit must be removed/abstracted
   before the content can be approved — this is not the model's judgment call.
2. **Model rewrite (for fuzzy cases):** rephrase remaining company-specific detail
   into public-safe, generic-but-accurate language.

## What to remove vs preserve

Remove or abstract:
- Confidential client/customer names → "a large enterprise client", "a regional
  partner".
- Internal project/product codenames, unreleased products.
- Confidential internal metrics that reveal business performance.
- Proprietary process details or anything under NDA.

Preserve:
- The candidate's real role, action, and skill demonstrated.
- The shape of the result (e.g., "materially reduced processing time") even when a
  precise confidential number must be removed — keep a defensible qualitative claim.
- Public, non-sensitive technologies and general domain.

## Hard rules

1. **No fabrication during de-identification.** Removing a confidential metric is
   allowed; inventing a replacement number is not.
2. **Redaction diff required.** Always output what changed (original → public-safe)
   so the user can verify nothing important was lost or leaked.
3. **Non-skippable approval.** Sensitive-origin content cannot reach an external
   document without explicit user approval of the public-safe version.
4. **When in doubt, abstract.** If unsure whether a term is sensitive, generalize
   it and flag for the user rather than risk a leak.

## Output contract

Produce output matching the evidence de-identification shape:
- `public_safe_summary` (the rewritten, safe text).
- `redaction_report[]`: each change as { original_span, replacement, reason }.
- `blocked_term_hits[]`: deterministic matches found and how each was handled.
- `requires_user_approval`: always true for sensitive-origin content.

## Examples

### Good
Original: "Cut Project Falcon's fraud loss for ClientCo by 38%."
Public-safe: "Reduced fraud loss for an enterprise client by a significant margin."
Redaction: codename "Project Falcon" removed; client "ClientCo" abstracted; "38%"
removed as confidential (kept qualitatively). Diff shown to user.

### Reject
Replacing the removed "38%" with an invented "around 30%" — that fabricates a
metric. Keep it qualitative instead.

## Common failure modes (avoid)

- Trusting the model to catch every sensitive term (use the deterministic list).
- Over-redacting until the achievement is meaningless (preserve substance).
- Inventing replacement metrics.
- Letting sensitive content through without the approval gate.

## Evaluation rubric

- Blocked-term leak into public_safe_summary: target 0 (100% block recall).
- Fabricated replacement values: target 0.
- Redaction diff present for every sensitive item: 100%.
