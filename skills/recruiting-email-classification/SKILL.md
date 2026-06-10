---
name: recruiting-email-classification
description: >
  Classify a recruiting-related email and map it to a suggested application status
  change, with confidence and the evidence text that justifies it. Read-only and
  suggest-only: it proposes a status, it never changes application state and never
  sends email. Use during email sync to surface candidate status updates for user
  approval.
version: 0.1
inclusion: manual
applies_to_component: C13 Pipeline Tracker
related_docs: build-and-learn.md §13; design-doc.md §9.3.13 and §16.1
---

# Recruiting Email Classification

## Purpose & trigger

Use this skill to read a candidate's recruiting-related email and propose what it
implies about an application's status. It is a narrow classification task, not an
agent: it labels the email, matches it to an existing application, and suggests a
status — for the user to approve.

## Role boundary (important)

- **Read-only, suggest-only.** This skill produces suggestions. It NEVER changes an
  application status and NEVER sends email. Applying a status is a separate,
  user-approved code path (see build-and-learn §13.11.3).
- It classifies and matches; the human decides.

## Classification labels

Map each email to one label (aligned with the status model in design-doc §16.1):
- `recruiter_response` — initial reply / screen scheduling.
- `assessment` — online assessment / take-home request.
- `interview` — interview scheduling or confirmation.
- `offer` — offer extended.
- `rejection` — application declined.
- `withdrawn` — candidate-initiated withdrawal acknowledgment.
- `not_recruiting` — unrelated to a job application (marketing, newsletters).
- `ambiguous` — recruiting-related but status unclear.

## Matching to an application

- Match the email to an existing application using deterministic signals first:
  sender domain, company name, thread/subject references, role title.
- If no confident match, return the suggestion with `application_id: null` and a
  low match confidence — never guess a match.

## Hard rules

1. **Suggest only.** Output is a proposed status; it is not applied.
2. **Cite the evidence.** Include the email text span that justifies the label.
3. **No sending.** This skill has no capability to reply or send.
4. **Conservative on ambiguity.** When unclear, label `ambiguous` with low
   confidence rather than forcing a status.
5. **Privacy.** Reference the email by ID and a short justification span; do not
   echo full email bodies into logs (see design-doc §18.2 trace privacy).

## Output contract

Produce suggestions matching `status-suggestion.schema.json`:
- `suggestions[]`: { application_id (nullable), email_id, label,
  suggested_status, confidence, evidence_span, match_confidence }.
- `follow_up_reminders[]` (optional): e.g., "interview on Friday — prepare".

## Examples

### Good
Email: "We'd like to invite you to a first-round interview next week."
→ label=interview, suggested_status=interview, evidence_span=that sentence,
matched to the application by sender domain, confidence high. Suggestion only.

### Reject
- Auto-setting the application to "interview" without user approval.
- Guessing which application a generic "thanks for applying" belongs to when the
  company isn't identifiable — return application_id null instead.

## Common failure modes (avoid)

- Treating a marketing email as a status change (use not_recruiting).
- Forcing a status on an ambiguous email.
- Guessing an application match with no signal.
- Echoing full email bodies (privacy).

## Evaluation rubric

- Classification accuracy vs a golden labeled inbox.
- Forced-status-on-ambiguous rate: target 0 (ambiguous stays ambiguous).
- Raw email body in any output meant for logs: target 0.
