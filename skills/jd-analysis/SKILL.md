---
name: jd-analysis
description: >
  Convert a job description into a structured requirement matrix: hard
  requirements, soft/preferred qualifications, keywords, role signals, and
  interview implications. Stays faithful to the JD — every requirement quotes the
  source text, and nothing is inferred as a fact. Use when creating or refreshing
  a job workspace from a pasted JD.
version: 0.1
inclusion: manual
applies_to_component: C3 JD Analyst
related_docs: build-and-learn.md §3
---

# JD Analysis

## Purpose & trigger

Use this skill to parse a pasted job description into structured requirements that
downstream components consume (retrieval, resume tailoring, match scoring,
interview prep). It is a single-pass extraction, not an agent loop, and it does
not call external search in MVP.

## Hard rules

1. **Quote the source.** Every extracted requirement carries the verbatim
   `source_quote` from the JD. A requirement with no quote is dropped.
2. **No invented requirements.** Do not add "industry standard" expectations the
   JD never states (e.g., a years-of-experience number that isn't written).
3. **Conservative classification.** When unsure whether a requirement is hard or
   soft, classify it as soft. Never inflate what the role demands of the candidate.
4. **Preserve the original.** Keep the full JD text as the source of record.

## What to extract

Extract the dimensions the downstream workflow needs for matching, tailoring,
and interview preparation.

- **Hard requirements:** must-haves explicitly stated (skills, years, credentials,
  location/work-authorization if stated).
- **Soft/preferred qualifications:** nice-to-haves, "bonus," "preferred."
- **Keywords:** normalized skill/tool/domain terms (apply the alias map so
  "React.js"/"ReactJS" → "react") for consistent matching and ATS coverage.
- **Role signals:** seniority cues, scope hints, domain, team context.
- **Interview implications:** topics this JD predicts will be probed (feeds the
  Interview Coach).

## Output contract

Produce output matching `jd-analysis.schema.json`:
- `original_jd_text` (verbatim).
- `requirements[]`: { text, source_quote, requirement_type (hard|soft),
  importance, keywords[], verified }.
- `role_signals[]`, `keywords[]`, `interview_implications[]`.

## Examples

### Good extraction
JD line: "Requires 5+ years building distributed systems." → hard requirement,
source_quote = that line, keywords = ["distributed systems"], importance high.

### Avoid
JD says "experience with cloud platforms." Do NOT extract "5 years AWS" — neither
the number nor the specific platform is stated. Extract "experience with cloud
platforms" as written, classify by what's actually there.

## Common failure modes (avoid)

- Adding requirements the JD does not state.
- Promoting "preferred" qualifications to hard requirements.
- Inconsistent keyword forms that break later matching.
- Dropping the source quote.

## Evaluation rubric

- Invented requirements (no source_quote in JD): target 0.
- Hard/soft classification accuracy vs golden labels.
- Keyword normalization consistency: 100% of known aliases mapped.
