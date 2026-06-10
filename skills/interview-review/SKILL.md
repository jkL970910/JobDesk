---
name: interview-review
description: >
  Turn an interview transcript or notes into structured improvement: separate
  knowledge/content gaps from communication/delivery gaps, produce concrete
  time-bound action items, and update the growth profile. Grounded in what the
  notes actually contain — never invents interviewer feedback or sentiment. Use
  after an interview to convert notes into a review.
version: 0.1
inclusion: manual
applies_to_component: C10 Interview Review
related_docs: build-and-learn.md §10
---

# Interview Review

## Purpose & trigger

Use this skill to analyze a candidate's own interview transcript/notes and produce
actionable improvement. The discipline is honesty: reference only what the notes
contain, and separate what the candidate didn't know from how they communicated.

## Hard rules

1. **No invented feedback.** Do not assert interviewer sentiment or judgment the
   notes don't contain ("the interviewer thought you were weak"). If the notes
   don't say it, it isn't a finding.
2. **Label inference.** If something is inferred from the notes rather than stated,
   mark it as inference, not fact.
3. **Two-axis separation.** Keep knowledge/content gaps distinct from
   communication/delivery gaps — they get different remediation.
4. **Concrete, time-bound actions.** "Rehearse 3 system-design trade-off answers by
   Friday," not "practice more."

## The two axes

- **Knowledge / content gaps:** the candidate lacked the substance (didn't know a
  concept, couldn't produce an example). Remediation: learn/prepare the content.
- **Communication / delivery gaps:** the candidate had the substance but conveyed
  it poorly (rambled, buried the result, no structure). Remediation: practice
  framing (e.g., STAR-C), concision, signposting.
A single moment can have both; record them separately.

## Growth profile update

Produce append-only deltas to the candidate's growth profile: recurring strengths,
repeated weaknesses, and resolved gaps over time. This feeds future prep
(`behavioral-interview-coach`). Do not overwrite history; append.

## Output contract

Produce output matching `interview-review.schema.json`:
- `knowledge_gaps[]`, `communication_gaps[]` (kept separate, each tied to a
  referenced moment in the notes).
- `action_items[]`: concrete and time-bound.
- `growth_profile_update`: deltas (strengths/weaknesses), append-only.
- `inferred_notes[]`: anything inferred rather than stated, labeled as such.

## Examples

### Good
Notes: "Couldn't explain how the cache invalidation worked; answer was long and
jumped around."
→ knowledge_gap: cache invalidation mechanics (action: study + prepare an example
by next week). communication_gap: unstructured answer (action: rehearse with STAR-C,
lead with the result).

### Reject
Adding "the interviewer seemed unimpressed" when the notes never say that.

## Common failure modes (avoid)

- Inventing interviewer sentiment.
- Conflating knowledge and communication gaps into vague advice.
- Vague, non-time-bound actions.
- Overwriting the growth profile instead of appending.

## Evaluation rubric

- Invented-feedback rate: target 0 (neutral transcripts yield no asserted
  sentiment).
- Gap-type separation accuracy vs golden labels.
- Action items concrete + time-bound: target 100%.
