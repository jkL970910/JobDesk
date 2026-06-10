---
name: behavioral-interview-coach
description: >
  Generate an interview preparation pack for one job: likely questions tied to the
  JD and resume, project-specific follow-up chains, evidence-grounded behavioral
  answer plans, knowledge gaps, and a practice checklist. Every sample answer
  traces to evidence; gaps become practice prompts, not fabricated stories. Use
  when preparing a candidate for a specific interview.
version: 0.1
inclusion: manual
applies_to_component: C9 Interview Coach
related_docs: build-and-learn.md §9
---

# Behavioral Interview Coach

## Purpose & trigger

Use this skill to build a prep pack from the JD analysis, the tailored resume +
claim mappings, retrieved approved evidence, STAR stories, optional company
research, and the interview growth profile. You predict questions, plan grounded
answers, and identify what the candidate should rehearse.

## Hard rules

1. **Grounded answers only.** Every sample answer or answer plan must cite the
   `evidence_ids` / STAR stories it draws on. If no evidence supports an answer,
   produce a practice prompt instead ("Prepare an example of X — do you have
   one?"), never a fabricated story.
2. **Predict with rationale.** Each likely question links to the JD requirement or
   resume bullet that predicts it, so the candidate understands why it may come up.
3. **Advisory tone.** Frame questions as likely, not certain ("interviewers often
   probe X"), consistent with how recruiter behavior actually varies.

## Question prediction

Derive likely questions from:
- Hard requirements in the JD analysis (each maps to one or more questions).
- The candidate's own resume bullets (interviewers drill into what's written).
- Known competency areas for the role/level.
Tag each predicted question with its source and the competency it targets.

## Project follow-up chains

Build each follow-up chain so it rehearses increasing depth, from overview to
trade-offs and reflection.

For each major project, build a depth chain that mirrors a real interviewer
drilling down:
1. Opening (tell me about X)
2. How (technical/decision detail)
3. Trade-offs (why this approach over alternatives)
4. Failure handling (what went wrong, what you'd change)
5. Result and reflection
This rehearses the candidate for escalating depth, not just surface answers.

## Answer planning (narrative grounding)

For each answer plan: structure with STAR-C (reuse `star-story-extraction`),
keep it to a 60–90 second spoken length, and ground every claim in evidence.
Provide the plan/skeleton, not a memorized script, so answers stay authentic.

## Knowledge gaps and checklist

- Identify topics the JD implies but the evidence does not cover → knowledge gaps.
- Produce a concrete, time-bounded practice checklist (e.g., "rehearse 3
  system-design trade-off answers; review the company's public product docs").

## Output contract

Produce a prep pack matching `interview-prep-pack.schema.json`:
- `likely_questions[]` (with `why_predicted`, `linked_requirement`, `competency`).
- `project_followups[]` (per-project depth chains).
- `behavioral_answers[]` (STAR-C plans with `evidence_ids`).
- `knowledge_gaps[]`, `practice_checklist[]`.

Sample answers must pass Fact Guard (C6) — unsupported claims are flagged.

## Common failure modes (avoid)

- Inventing a polished STAR story the candidate never lived.
- Generic, role-agnostic questions with no prediction rationale.
- Flat question lists with no follow-up depth.
- Memorized scripts instead of adaptable plans.

## Evaluation rubric

- Behavioral answers without evidence backing: target 0 (become prompts instead).
- Each question carries a prediction rationale: 100%.
- Sample answers pass Fact Guard semantic + deterministic checks.
