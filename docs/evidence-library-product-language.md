# Evidence Library Product Language And IA

Status: Product boundary and implementation reference
Last updated: 2026-06-25

This document defines the product language, information architecture, and workflow boundaries for JobDesk's Evidence Library and Work Queue. It is intended for Figma redesign, frontend implementation, backend workflow design, prompt/skill updates, and future reviewer signoff.

## Product Principle

Library shows canonical assets. Work Queue shows unresolved work on those assets.

Do not make assets disappear from Library just because they are incomplete. Use status, filters, and queue views to show what still needs action.

The Evidence Library remains the factual source of truth. Generated resumes, cover letters, interview answers, and positioning reports are derived outputs.

## Core Product Model

### Source Material

Raw user input.

Examples:

- Resume
- Work notes
- Project summary
- JD gap note
- Guided answers

User-facing copy:

> Source material is where facts come from. It is not reusable until JobDesk turns it into reviewed library assets.

### Work Experience

A role container.

Contains:

- Employer
- Title
- Team
- Location
- Start/end dates
- High-level scope
- Linked story targets
- Linked evidence claim count

Use this label:

- Work Experience

Avoid in user-facing UI:

- Role
- Career history item
- Experience object

Implementation note: code may continue to use `role` internally where already established, but product surfaces should use `Work Experience`.

### Story Target

A reusable story container that can become resume bullets or interview stories.

Subtypes:

- Work Initiative: a project, achievement, or responsibility story under a Work Experience.
- Portfolio Project: standalone project outside employment, such as academic, personal, open-source, freelance, or hackathon work.

Use this label:

- Story Target

Supporting labels:

- Work Initiative
- Portfolio Project

User-facing copy:

> Story targets organize your projects and achievements. Evidence claims prove the details.

### Evidence Claim

The smallest factual proof unit.

Contains:

- Claim text
- Source quote
- Public-safe summary
- Linked Work Experience or Story Target
- Approval status
- Allowed usage, such as resume, interview, or cover letter

Use this label:

- Evidence Claim

Avoid splitting `claim` and `evidence` too heavily in UI. Use `Evidence Claim` as the main product term.

### Interview Story

A derived interview-ready answer generated from a Story Target and approved evidence.

Use this label:

- Interview Story

Supporting label:

- STAR version

User-facing copy:

> Interview stories are generated from ready story targets. They are not a separate source of truth.

## Relationship Model

Use this relationship consistently:

```text
Source Material
  -> Work Experience
      -> Story Targets
          -> Evidence Claims
              -> Resume bullets / Cover letters / Interview stories
```

Short UI version:

> Work experiences contain stories. Stories are supported by evidence. Resumes use approved evidence.

## Main Evidence Area Navigation

The Evidence area has two primary modes.

### Library

Label:

> Library

Subtitle:

> Reusable career material organized by role, story, and evidence.

Purpose:

Canonical asset browsing and maintenance.

### Work Queue

Label:

> Work Queue

Subtitle:

> Open tasks that make your library stronger and resume-ready.

Purpose:

Action-oriented triage.

## Library Tabs

### Work Experience

Tab label:

> Work Experience

Description:

> Role-level containers for employer, title, team, dates, location, and scope.

Card actions:

- Edit details
- Mark reviewed
- Create story target
- View linked stories
- Reject

Statuses:

- Needs review
- Reviewed
- Needs update
- Rejected

Empty state:

> No work experiences yet. Import a resume or add work material to create role containers.

### Story Targets

Tab label:

> Story Targets

Description:

> Projects, achievements, and portfolio work that can become resume bullets or interview stories.

Subfilters:

- All
- Work Initiatives
- Portfolio Projects
- Needs context
- Ready
- Unassigned

Card actions:

- Add context
- Link to work experience
- Add evidence
- Generate interview story
- Merge duplicate
- Mark ready

Statuses:

- Draft
- Needs context
- Ready
- Needs evidence
- Unassigned
- Rejected

Empty state:

> No story targets yet. Add work notes or extract projects from a reviewed resume.

### Evidence Claims

Tab label:

> Evidence Claims

Description:

> Source-backed facts that can support resumes, cover letters, and interviews.

Subfilters:

- Resume-ready
- Needs review
- Needs public-safe wording
- Needs link
- Needs detail
- Rejected

Card actions:

- Edit claim
- Link evidence
- Add public-safe summary
- Approve for resume
- Approve for interview
- Reject

Statuses:

- Draft
- Needs detail
- Needs public-safe wording
- Ready to approve
- Approved for resume
- Approved for interview
- Rejected

Empty state:

> No evidence claims yet. Create claims from source material or story targets.

### Interview Stories

Tab label:

> Interview Stories

Description:

> STAR-style interview answers generated from ready story targets.

Card actions:

- Generate story
- Edit story
- Refresh from evidence
- Mark ready
- Open source story target

Statuses:

- Not generated
- Draft
- Ready
- Needs refresh

Empty state:

> No interview stories yet. Build a ready story target first, then generate an interview version.

## Work Queue Tabs

Work Queue tabs are action-based, but each tab must make the entity type clear.

### Import Review

Purpose:

Review source extraction notes and parser observations.

Label:

> Import Review

Description:

> Confirm what JobDesk found in imported resumes and source material.

Actions:

- Confirm note
- Dismiss note
- Review extracted roles
- Add profile fact
- Run extraction again

Do not show generic answer textareas for parser observations.

### Review Work Experience

Purpose:

Review pending Work Experience records.

Label:

> Review Work Experience

Description:

> Confirm employer, title, dates, team, location, and scope.

Actions:

- Edit details
- Mark reviewed
- Mark needs update
- Reject

### Build Story Targets

Purpose:

Complete Work Initiatives and Portfolio Projects.

Label:

> Build Story Targets

Description:

> Add context, ownership, actions, results, and metrics to projects and achievements.

Groups:

- Work Initiatives
- Portfolio Projects
- Unassigned story targets

Actions:

- Add context
- Link to work experience
- Add evidence
- Merge duplicate
- Mark ready

This replaces:

- Review Stories

### Link Evidence

Purpose:

Attach evidence claims to the correct story or work experience.

Label:

> Link Evidence

Description:

> Connect unlinked claims to the role, story, or project they support.

Actions:

- Link to story target
- Link to work experience
- Create new story target
- Keep unassigned for now

This replaces:

- Link Claims

### Strengthen Evidence

Purpose:

Answer missing-detail questions for weak claims or thin stories.

Label:

> Strengthen Evidence

Description:

> Add missing metrics, scope, ownership, technical detail, or public-safe wording.

Actions:

- Answer question
- Generate suggested update
- Accept change
- Save as context
- Change target

This replaces:

- Add Detail

### Approve Evidence

Purpose:

Review claims before they can be used in generated resumes.

Label:

> Approve Evidence

Description:

> Confirm claim accuracy, public-safe wording, and allowed resume usage.

Actions:

- Approve for resume
- Approve for interview
- Edit public-safe summary
- Reject

This replaces:

- Approve Claims

### Cleanup

Purpose:

Resolve duplicates and stale or invalid material.

Label:

> Cleanup

Description:

> Merge duplicates, reject stale material, and keep the library clean.

Actions:

- Merge
- Keep separate
- Reject duplicate
- Reassign linked evidence

## Header Copy

### Evidence Library Header

Title:

> Evidence Library

Subtitle:

> Turn resumes, work notes, and project details into reusable proof for resumes and interviews.

Primary CTA:

> Add Material

Secondary CTA:

> Review Work Queue

### Library Mode Header

Title:

> Library

Subtitle:

> Browse and maintain your canonical career assets.

Metric labels:

- Work experiences
- Story targets
- Evidence claims
- Resume-ready claims
- Interview stories

### Work Queue Mode Header

Title:

> Work Queue

Subtitle:

> Resolve the highest-impact tasks before generating or exporting resumes.

Metric labels:

- Open tasks
- Needs role review
- Story targets to build
- Evidence to approve
- Import notes

## Card Language

### Work Experience Card

Title format:

> `{Employer} - {Title}`

Metadata:

> `{Location} - {Start date} to {End date}`

Status examples:

- Needs review
- Reviewed
- Needs update

Helper copy:

> This role contains story targets and evidence. Reviewing it does not approve resume claims.

Primary CTA:

> Mark reviewed

Secondary CTA:

> Edit details

### Story Target Card

Title:

> `{Project or achievement name}`

Subtype badge:

> Work Initiative

or:

> Portfolio Project

Linked role:

> Under `{Employer} - {Title}`

Status examples:

- Needs context
- Needs evidence
- Ready

Helper copy:

> Add project context and link evidence before using this story in resumes.

Primary CTA:

> Strengthen story

Secondary CTA:

> Add evidence

### Evidence Claim Card

Title:

> Short factual claim

Metadata:

> Source: `{Resume v1 / Work notes / Project summary}`

Status examples:

- Needs detail
- Needs public-safe wording
- Ready to approve
- Approved for resume

Helper copy:

> Approved evidence can support generated resume bullets. Unapproved evidence stays in the library but is not used for resumes.

### Review Findings, Evidence Questions, And Tasks

Use these terms separately:

- Review finding: an explanation or recommendation from Resume Review or Generated Resume Readiness Review.
- Evidence question: a question that may become an enrichment task if it asks for missing proof, metrics, ownership, source quotes, or public-safe wording.
- Work Queue task: a concrete user action already created in the Evidence Library workflow.

Do not describe every review finding as a task. Generated resume findings route to one of three destinations:

- Evidence gap -> Evidence Library / Work Queue when proof or safe wording is missing.
- Resume polish -> Resume Builder when wording, section order, scan quality, or bullet clarity needs work.
- Positioning gap -> Profile Positioning when target role, seniority, or narrative angle is unclear.

Fact Guard, public-safe policy, unsupported claims, and export policy remain hard gates. Generated Resume Readiness Review is a soft gate that explains whether the generated draft is ready, recommended for polish, or needs evidence before export.

Current workflow scope:

- User manually runs Review generated resume after a main resume is generated.
- JobDesk shows readiness score, low-score reasons, and routed findings.
- User manually chooses the next surface: Evidence Library, Resume Builder polish, or Profile Positioning.
- JobDesk does not yet auto-generate resume edit proposals, auto-accept changes, auto-rerun Fact Guard, or auto-rescore the generated draft.

Primary CTA:

> Approve evidence

Secondary CTA:

> Edit claim

### Interview Story Card

Title:

> `{Story target name}`

Status:

> Interview-ready

or:

> Needs refresh

Helper copy:

> Generated from a ready story target and approved evidence.

Primary CTA:

> Open interview story

Secondary CTA:

> Refresh from evidence

## Count Semantics

Library counts show assets. Work Queue counts show unresolved actions.

Examples:

- `Story Targets (12)` means 12 canonical story target assets exist.
- `Evidence Claims (36)` means 36 claims exist, regardless of approval state.
- `Build Story Targets (6)` means 6 story targets need context or action.
- `Approve Evidence (8)` means 8 claims are waiting for approval.

Do not let a card disappear from Library just because it has a queue task.

## Status Language

Use:

- Needs review
- Needs context
- Needs evidence
- Needs public-safe wording
- Ready
- Reviewed
- Approved for resume
- Approved for interview
- Rejected
- Unassigned
- Needs revalidation

Avoid in user-facing UI:

- pending
- converted
- source_section_review
- route_answer
- target_scope
- expected_action
- proposal
- canonical object
- stale claim

## Target Picker Language

Do not expose database entities in the picker.

Prompt:

> What should this update strengthen?

Options:

- A specific evidence claim
- A project or story target
- A work experience
- Save as profile context
- Decide later

Helper copy:

> Choose the most specific place this answer belongs. JobDesk will keep parent relationships visible.

## Enrichment Question Language

Each question should show:

- Question
- Scope
- Target
- Why we ask
- What happens after save

Example:

Scope:

> Evidence detail

Target:

> Reduced backend APIs from 20+ to 10

Why we ask:

> This claim has a metric, but the mechanism needs clarification before it can support a strong resume bullet.

After save:

> JobDesk will preview an evidence update. Nothing changes until you accept it.

CTA:

> Generate suggested update

## Derived Output Language

Use clear derived-output language.

Resume:

> Generated from approved evidence claims.

Interview Story:

> Generated from ready story targets and approved evidence.

Cover Letter:

> Generated from approved evidence and profile context.

Never imply that generated text becomes source truth automatically.

## Engineer Mapping

Recommended entity mapping:

```ts
WorkExperience = work_experiences;
StoryTarget = initiatives | portfolio_projects;
EvidenceClaim = evidence_items;
InterviewStory = star_stories;
SourceMaterial = source_documents | resume_source_versions;
WorkQueueTask = enrichment_tasks | imported notes | approval queues;
```

Recommended UI tab mapping:

```ts
Library:
  work_experience
  story_targets
  evidence_claims
  interview_stories

WorkQueue:
  import_review
  review_work_experience
  build_story_targets
  link_evidence
  strengthen_evidence
  approve_evidence
  cleanup
```

## Figma Design Guidance

Design should visually separate:

- Library asset cards: stable, browsable, lower urgency.
- Work Queue task cards: action-oriented, clear CTA, higher urgency.
- Derived output cards: resumes/interview stories generated from assets.

Recommended layout:

- Top segmented control: `Library | Work Queue`
- Summary metrics row
- Left filter rail or compact toolbar
- Main content list/grid
- Right detail drawer for selected asset/task

Avoid:

- Multiple nested cards inside cards
- Repeated CTAs with similar labels
- Showing all metadata expanded by default
- Mixing Work Experience and Story Target cards in the same unlabelled list

## Non-Negotiable Guardrails

- Library assets must not disappear because they are incomplete.
- Work Queue is an action lens, not a second source of truth.
- Resume generation must use approved, resume-safe Evidence Claims only.
- Source Material and source chunks may help discover gaps, but must not directly support resume bullets.
- Profile context may guide emphasis, but it is not factual evidence.
- Interview Stories are derived outputs, not source truth.

## One-Sentence Product Rule

> JobDesk helps users turn messy career material into reviewed roles, strong stories, and approved evidence that can safely power resumes and interviews.
