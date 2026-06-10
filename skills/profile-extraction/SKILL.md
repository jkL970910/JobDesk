---
name: profile-extraction
description: >
  Extract a structured, canonical profile (contact, education, experience, skills,
  dates) from resume text. Every field carries a verbatim source quote so a
  fabricated value can be caught deterministically. Fields are tiered by priority,
  and dates/identity facts are preserved exactly. Use during resume import.
version: 0.1
inclusion: manual
applies_to_component: C1 Profile Intake
related_docs: build-and-learn.md §1
---

# Profile Extraction

## Purpose & trigger

Use this skill to convert extracted resume text into a structured profile that
becomes the downstream source of truth. The single most important property is
faithfulness: the profile contains only what the document says, with each field
traceable to its source text.

## Hard rules

1. **Source quote per field.** For every extracted value, return the verbatim
   `source_quote` from the resume text. A field with no quote is flagged
   `invented`, never silently kept. (This is what lets deterministic code catch
   hallucination — see build-and-learn §1.11.4.)
2. **Preserve identity facts exactly.** Employers, titles, and dates are copied as
   written. Normalization (e.g., date formatting) is a separate display concern;
   the raw quote is always retained.
3. **Never guess a missing field.** If a field is absent, mark it missing — do not
   infer a plausible value (a city, a graduation year, a title).
4. **Mark low confidence.** When the text is ambiguous, extract conservatively and
   flag for user review.

## Field-priority tiers

Use tiered fields so the workflow gates on critical identity and timeline facts
while allowing lower-priority fields to remain lower confidence.
- **Critical:** name, employers, job titles, employment dates, degrees.
- **Important:** skills, certifications, education institutions.
- **Nice-to-have:** location, summary/objective, links.
Gate the profile on the critical tier; allow lower tiers to be lower confidence.

## What to extract

- Contact (name, email, phone, location, links).
- Education (institution, degree, field, dates).
- Experience (employer, title, start/end dates, bullets).
- Skills, certifications.
Each as a field with value + source_quote + tier.

## Output contract

Produce output matching `profile.schema.json`:
- Structured profile with each field as { value, source_quote, tier, confidence }.
- `missing_fields[]`, `low_confidence_fields[]`, `invented_field_flags[]`.
Set `verified=false` initially; the deterministic span verifier sets it.

## Examples

### Good
Resume: "Senior Analyst, Acme Corp, Jun 2019 – Present"
→ title="Senior Analyst" (quote: same line), employer="Acme Corp" (quote: same),
start_date raw="Jun 2019" (quote: same). All critical-tier, verified against text.

### Reject
Resume omits a city. Do NOT extract location="New York" because the company is
there. Mark location missing.

## Common failure modes (avoid)

- Filling absent fields with plausible guesses (the core risk).
- Normalizing a date and losing the original quote.
- Returning a value with no source_quote.
- Reordering or merging experience entries incorrectly on multi-column resumes.

## Evaluation rubric

- Invented fields per resume: target < 1 (≈0 on critical tier).
- Every retained field has a source_quote: 100%.
- Critical-field extraction precision: ~92%+ on the golden set.
- Dates either parse or are flagged: 100%.
