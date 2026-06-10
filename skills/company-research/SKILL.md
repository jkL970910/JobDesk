---
name: company-research
description: >
  Gather public company and interview context from external sources and synthesize
  it with mandatory citations, credibility scoring, and freshness metadata. Always
  separates official facts from anecdotal reports, and never presents unverified
  claims as facts. Use when researching a company or role to support interview prep.
version: 0.1
inclusion: manual
applies_to_component: C11 Company Research
related_docs: build-and-learn.md §11; design-doc.md §9.3.9 and §15
---

# Company Research

## Purpose & trigger

Use this skill to produce a research brief for a target company/role: business
summary, product notes, and likely interview themes — every claim sourced. This is
an external-boundary skill: it works over fetched public pages and must treat all
external content as untrusted and citable.

## Hard rules

1. **Citations are mandatory.** Every claim references at least one source URL from
   the fetched set. A claim with no resolvable source is dropped or marked
   `unverified` — never stated as fact. (Deterministic citation check enforces
   this, mirroring the source-quote rule for internal facts.)
2. **Official vs anecdotal.** Label each interview-theme/insight as `official`
   (company site, press, docs) or `anecdotal` (forums, community reports). Frame
   anecdotal items as "some candidates report," never as the company's process.
3. **No fabricated specifics.** Do not invent named interviewers, exact round
   counts, or processes not present in sources.
4. **Freshness.** Record published/retrieved dates; flag stale sources.
5. **Respect source terms.** Only use allowed, fetched pages; honor robots/ToS.

## Source credibility scoring

Rank each source:
- High: official company site, press releases, official docs, reputable news.
- Medium: established industry publications, well-known professional sources.
- Low: anonymous forums, single anecdotal posts, undated community content.
Store the score and use it to weight synthesis (high-credibility claims lead;
low-credibility claims are clearly hedged).

## What to produce

- **Company summary:** what they do, business model, scale — from official sources.
- **Product/business notes:** relevant products, recent public developments.
- **Interview themes:** likely focus areas, labeled official vs anecdotal, each
  cited and confidence-labeled.

## Output contract

Produce output matching `company-research.schema.json`:
- `company_summary`, `product_notes[]`.
- `interview_themes[]`: each { theme, classification (official|anecdotal),
  confidence, source_ids[] }.
- `sources[]`: { url, title, domain, published_date, retrieved_date,
  source_type, credibility_score, snippet }.
- `unverified_claims[]`: anything that could not be sourced (surfaced, not used).

## Examples

### Good
"The company operates a subscription analytics platform [source: official product
page, high credibility, retrieved 2026-06-09]. Some candidates report a take-home
assignment in the loop [anecdotal, low credibility, 2 forum posts] — verify with
your recruiter."

### Reject
"Their interview always includes 3 system-design rounds." — stated as fact from a
single forum post. Either label it anecdotal-and-hedged or drop it.

## Common failure modes (avoid)

- Presenting a single anecdote as the company's standard process.
- Uncited claims.
- Stale data presented as current.
- Inventing interviewer names or exact round structures.

## Evaluation rubric

- Uncited claims in output: target 0.
- Anecdotal content mislabeled as official: target 0.
- Every source has freshness metadata: 100%.
