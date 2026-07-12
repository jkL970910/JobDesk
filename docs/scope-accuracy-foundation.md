# Scope Accuracy Foundation + Correction Workflow

Status: Active milestone execution plan
Last updated: 2026-07-08

This milestone defines the long-term fix for trustworthy material modeling in JobDesk. It is not a prompt-tuning task. The goal is to make extracted material explainable, testable, correctable, and safe before it can influence generated resumes.

## End-To-End Model

```text
Raw source
  -> Extracted candidates
  -> Scope classification
  -> Consolidation / dedupe
  -> User review and correction
  -> Canonical Evidence Library
  -> Resume generation
```

## Core Principles

- Extractors propose candidate material. They do not decide canonical truth.
- Every candidate receives a scope decision before it can persist as a canonical asset.
- Scope classification must be explainable, testable, and correctable.
- Wrong or low-confidence scope cannot silently enter a ready library state.
- Duplicate initiative fragments must consolidate or route to overlap review.
- Users must be able to create missing Story Targets, change scope, reassign role, merge, keep separate, or unassign.
- Story Targets and Evidence Claims default to pending, private, and not resume-ready.
- Resume generation retrieval only consumes approved, public-safe, source-backed canonical evidence.
- AI can suggest scope, merge, title, and ambiguity explanations; deterministic gates decide persistence policy.

## Canonical Terms

### Work Experience

Employer / title / dates / team container.

Must not be a project, technical action, metric, bullet, or result statement.

### Work Initiative

A project, achievement, responsibility, or story under a Work Experience.

It should have a role context plus at least one project/story signal such as problem, action, outcome, business goal, ownership, service/domain, or responsibility.

### Portfolio Project

A non-employer story, such as personal, academic, open-source, freelance, or hackathon work.

Employer-internal material should default to Work Initiative or unassigned review, not Portfolio Project.

### Evidence Claim

The smallest factual proof unit. It should be atomic: one fact, one metric, or one tight action-result pair.

Evidence Claims require source quote/provenance before resume eligibility.

### Enrichment Question

A prompt asking the user to fill missing context. It is not evidence and not a story.

### Profile Context

Preferences, positioning guidance, target roles, emphasis, or de-emphasis. It is not factual proof and cannot enter resume claims.

### Extraction Candidate

Proposed material from a source before canonical acceptance.

### Scope Decision

The system/user decision describing what the candidate is, why, confidence, alternatives, and whether it can persist.

## Full Signoff Definition

This milestone is complete only when all of the following are true:

- Extractor output is treated as candidate material.
- Every candidate receives a Scope Decision.
- Wrong or low-confidence scope cannot silently enter the canonical library as ready material.
- Duplicate initiative fragments are consolidated or routed to overlap review.
- User can create a missing Story Target while answering enrichment questions.
- User can change scope, reassign, merge, keep separate, or unassign.
- Generated evidence and proposals inherit confirmed story targets.
- Resume generation retrieval still only uses approved, public-safe, source-backed canonical evidence.
- Regression fixtures cover the real failure cases.
- Manual QA confirms the end-to-end loop: resume/source -> candidates -> review/correction -> approved evidence -> generated resume -> Fact Guard/export.

## Execution Phases

### Phase 0: Product Contract And Terminology

Goal: harden product language and boundaries before adding more logic.

Update:

- `docs/evidence-library-product-language.md`
- `docs/development-status.md`
- `docs/design-doc.md` or `docs/architecture.md` when implementation seams are introduced

Acceptance:

- Documentation states that extractors do not own canonical truth.
- Documentation clearly separates Work Initiative from Evidence Claim.
- Documentation states that Profile Context cannot enter resume claims.

### Phase 1: Candidate And Scope Contract

Goal: put all extracted material behind one candidate/scope decision contract.

Planned modules:

- `src/server/extracted-asset-candidate.ts`
- `src/server/scope-decision.ts`

Planned contract:

```ts
type ExtractedAssetCandidate = {
  id?: string;
  proposedScope:
    | "work_experience"
    | "work_initiative"
    | "portfolio_project"
    | "evidence_claim"
    | "profile_context"
    | "imported_note"
    | "enrichment_question";
  content: string;
  sourceDocumentId?: string | null;
  resumeSourceVersionId?: string | null;
  sourceSection?: string | null;
  sourceQuote?: string | null;
  nearbyHeadings?: string[];
  linkedWorkExperienceHint?: string | null;
  linkedInitiativeHint?: string | null;
  aiConfidence?: "low" | "medium" | "high";
};

type ScopeDecision = {
  acceptedScope:
    | "work_experience"
    | "work_initiative"
    | "portfolio_project"
    | "evidence_claim"
    | "profile_context"
    | "imported_note"
    | "unassigned";
  confidence: "low" | "medium" | "high";
  reason: string;
  needsUserReview: boolean;
  possibleAlternatives: string[];
  canonicalLinkPolicy:
    | "can_persist_to_canonical_pending"
    | "persist_unassigned_pending"
    | "review_queue_only"
    | "reject_as_invalid_scope";
};
```

Persistence note: an `extraction_candidates` table is desirable long-term, but Phase 1 can start with pure contracts and metadata on existing pending entities.

Acceptance:

- Every extraction output has a Scope Decision.
- No extraction path bypasses scope classification.
- Tests can run classifier logic without a database.

### Phase 2: Deterministic Scope Classifier

Goal: block obvious scope errors with deterministic rules before adding smarter AI help.

Planned module:

- `src/server/scope-classifier.ts`

Initial rules:

- Work Experience must contain employer/title/date/team-like container signals.
- Work Experience rejects bullet-shaped action/result lines, pure technology phrases, and metric-only phrases.
- Work Initiative must be a project/story/responsibility under a role; it can be thin but cannot be only a tool name.
- Portfolio Project is non-employer material or explicitly personal/academic/open-source/freelance.
- Evidence Claim is atomic factual proof.
- Profile Context is preference/positioning guidance and never becomes evidence.
- Imported observations such as "No certifications found" route to ACK/edit/review-source, not evidence/story.

Acceptance fixtures:

- Bullet cannot become Work Experience.
- Technical Skills question cannot bind to project.
- AWS CDK/cache/latency fragments classify as the same initiative cluster.
- Project-only material without employer becomes portfolio or unassigned.
- Same-company multiple roles do not cross-bind by employer token alone.

### Phase 3: Pre-Save Persistence Guardrail

Goal: canonical tables only receive candidates that pass the scope gate.

Modify:

- `persistProfileEvidenceExtraction`
- async extraction worker persistence path
- enrichment answer proposal commit path where relevant

Behavior:

- High-confidence valid scope -> persist as pending canonical asset.
- Medium-confidence scope -> persist as pending + needs scope review.
- Low-confidence / ambiguous -> unassigned review queue.
- Invalid scope -> imported note / review queue only.

Entity rules:

- Work Experience cannot be created from bullet-shaped content.
- Initiative must link to Work Experience or be explicitly unassigned.
- Portfolio Project must not be employer-internal.
- Evidence Claim must keep source quote/provenance.
- Profile Context cannot be used as resume evidence.

Minimal metadata:

- `scope_confidence`
- `scope_reason`
- `needs_scope_review`
- `source_section`
- `source_quote`
- `created_from_candidate_id` if a candidate table exists

Acceptance:

- Invalid Work Experience candidates do not create work experience rows.
- Wrong-scope Initiative, Portfolio Project, and Evidence Claim candidates do not create canonical rows.
- Ambiguous story candidates enter review queue.
- Resume generation retrieval ignores needs-scope-review / unapproved evidence.
- Existing extraction tests still pass.

### Phase 4: Initiative Consolidation

Goal: avoid splitting one story into many Work Initiatives.

Planned module:

- `src/server/initiative-consolidation.ts`

Consolidation signals:

- Same workspace
- Same Work Experience
- Same source document/section
- Nearby source span or heading overlap
- Shared technologies
- Shared outcome/domain/service
- Similar title tokens
- Shared metrics or action-result chain

Example fragments:

- Session latency optimization with distributed caching
- AWS infrastructure provisioning with CDK
- Distributed cloud caching for high-scale delivery service

Expected merged initiative:

> Distributed caching infrastructure for session latency optimization

With actions/technologies/results preserved underneath.

Guardrails:

- Never merge across different Work Experience unless user confirms.
- Never merge different business domains just because technology overlaps.
- Medium-confidence merge creates review note.
- Low-confidence merge creates overlap cleanup suggestion.

Acceptance:

- Same Amazon role cache fragments merge.
- Amazon 2022 internship cache does not attach to Amazon 2023 role.
- Similar technologies across different roles do not merge.
- Merged initiative keeps evidence references intact.

### Phase 5: Regression Fixture Suite

Goal: lock real failure cases before expanding correction UI.

Fixture families:

1. Same company, multiple roles: Amazon full-time and Amazon internship must not match by employer token only.
2. One project split into fragments: AWS CDK / distributed cache / latency must consolidate into one initiative.
3. Bullet-shaped Work Experience: "Migrated service to region X" must not become role container.
4. Technical Skills profile question: profile context or assign-later, not random project/evidence.
5. Project-only material: no employer/date becomes portfolio project or unassigned, not fake Work Experience.
6. Evidence vs story: atomic metric remains evidence; broader project with multiple actions becomes initiative.
7. Imported notes: "No certifications found" routes to ACK/edit profile fact, not enrichment proposal.

Required tests:

- Pure classifier unit tests.
- Persistence guardrail tests.
- Consolidation tests.
- Enrichment task target tests.
- UI route/DTO tests where possible.
- Integration tests for extraction -> review queue -> correction -> canonical asset.

### Phase 6: User Correction Workflow

Goal: users can repair scope instead of accepting the first system classification.

UI surfaces:

- Strengthen Evidence / Task Focus Pane
- Build Story Targets
- Evidence Cards

Actions:

- Use existing target
- Create new Story Target under Work Experience
- Create Portfolio Project
- Attach to Work Experience only
- Save as unassigned
- Save as profile context where appropriate
- Change scope
- Move Portfolio Project to Work Initiative under a selected Work Experience
- Attach to another Work Experience
- Mark as Portfolio Project
- Merge stories
- Keep separate
- Remove story link

New API actions:

- `create_story_target_from_task`
- `change_story_target_scope`
- `reassign_story_target`
- `merge_story_targets`
- `keep_story_targets_separate`
- `mark_candidate_unassigned`

Acceptance:

- If no suitable Story Target exists, user can create one under Work Experience.
- Current task binds to the new Story Target.
- Answer proposal links to the new Story Target.
- Build Story Targets shows the draft story with source "created from enrichment question".
- Existing target-selection/profile-context flows do not regress.
- Nothing becomes resume-ready automatically.

### Phase 7: Post-Save Validators And Work Queue Routing

Goal: if pre-save misses something, validators still block ready state.

Validators:

- Work Experience validator
- Initiative validator
- Portfolio Project validator
- Evidence atomicity validator
- Link validator
- Public-safe validator
- Resume eligibility validator

Routing:

- Scope issue -> Scope Review queue
- Duplicate story -> Overlap Cleanup
- Missing project context -> Build Story Targets
- Missing source quote -> Evidence Review
- Private/internal wording -> Public-safe Review
- Profile preference -> Profile Context

Acceptance:

- A malformed initiative does not appear as ready story.
- A rejected role/story/evidence is excluded from pickers.
- Work Queue explains why each item needs review.
- Resume readiness worklist points to the correct fix surface.

### Phase 8: Observability And Admin Diagnostics

Goal: debug scope accuracy with facts instead of guesses.

Track:

- Candidate count
- Accepted scope distribution
- Low-confidence count
- Unassigned count
- Consolidation count
- User correction count
- Merge/keep-separate decisions
- Rejected scope reasons
- Extractor timeout/fallback sections

Constraints:

- Do not store raw private text in logs.

UI diagnostics:

- Why this was classified as Story
- Source section
- Confidence
- Possible alternatives
- User changed from X to Y

Acceptance:

- Can explain why a card became Work Initiative / Evidence / Profile Context.
- Can find extractor areas producing noisy scope.
- Can measure whether AI enhancements improve or degrade accuracy.

### Phase 9: Intelligence Layer

Goal: increase automatic hit rate after guardrails are stable.

Enhancements:

- Semantic chunking by role/project heading
- AI-assisted ambiguous scope explanation
- AI proposed merge suggestions
- AI generated story title suggestions
- User correction feedback loop
- Better source-span detection
- Better resume extraction story seeding

Rules:

- AI can suggest.
- Deterministic gate decides persistence policy.
- User confirms low/medium confidence correction.
- Resume-ready still requires approved/public-safe/source-backed evidence.

Acceptance:

- More complete story coverage.
- Lower duplicate story rate.
- Fewer unassigned candidates.
- No increase in wrong canonical links.

## Progress Tracker

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 0 | Complete | Milestone plan created and product terminology synchronized in Evidence Library docs. |
| Phase 1 | Complete | Candidate and Scope Decision contracts added as pure server modules with unit tests. |
| Phase 2 | Complete, first slice | Deterministic classifier and early failure fixtures added as pure modules/tests. |
| Phase 3 | Complete, first generalized slice | Work Experience, Work Initiative, Portfolio Project, and Evidence Claim extraction drafts now pass through pre-save scope guardrails; wrong-scope candidates route to imported material review notes instead of canonical tables. |
| Phase 4 | Complete, second slice | Initiative consolidation is isolated in `initiative-consolidation.ts` with fixtures for AWS CDK/cache/latency merging, ambiguous/unassigned fragment merging, and cross-role non-merge. |
| Phase 5 | Complete, first slice | `scope-accuracy-regression-fixtures.test.ts` locks the seven signed-off failure families across classifier, guardrail, consolidation, and imported-note routing. |
| Phase 6 | Complete, P1 local slice | Users can create missing Story Targets from enrichment questions, save structured Scope Review Candidates as pending material, move Portfolio Projects to Work Initiatives, move Work Initiatives to Portfolio Projects, split selected Evidence Claims into new or existing Work Initiatives / Portfolio Projects, merge duplicate stories, keep overlap suggestions separate, and stale affected generated claims when relations move. |
| Phase 7 | Complete, P1 local slice | Work Queue source-review pane gives scope guardrail output a structured candidate review model with user-facing actions. Candidate save/dismiss actions resolve durable `scope_review_candidates`; wrong-scope candidates do not enter canonical tables until user action. |
| Phase 8 | Complete, P1 local slice | Workflow metadata records scope guardrail/consolidation counts, and `scope_correction_events` records privacy-safe candidate/story correction events without raw source text or full quotes. |
| Phase 9 | Complete, deterministic P1 slice | Story seeding improves coverage from parsed profile bullets only after consolidation and scope guardrails. Broader AI-assisted story expansion remains deferred. |

## P1 Implementation Plan After Reviewer Feedback

Status: implemented locally for first review. The implementation starts with a structured candidate lifecycle before increasing story extraction recall.

### Revised Execution Order

1. Candidate Review Queue data model and actions
2. Guided Story Target Creation
3. Work Queue routing and correction entry
4. Merge / keep separate / split UX
5. Source provenance drilldown
6. Correction audit trail
7. Better Story Seeding
8. Manual QA SOP

Reason: JobDesk must first be able to digest, resolve, or dismiss candidates safely. Better Story Seeding intentionally comes after the review/correction pipeline because higher extractor recall will create more candidates.

### P1.1 Candidate Review Queue Data Model And Actions

Goal: convert guardrail-blocked material from note-like review text into a structured candidate lifecycle.

Model requirement:

```ts
type ScopeReviewCandidate = {
  id: string;
  workspaceId: string;
  sourceDocumentId: string | null;
  sourceType: "profile-evidence" | "project-note" | "jd-gap-note" | "resume-review" | "user_input";
  sourceSection: string | null;
  sourceQuote: string | null;
  rawCandidateText: string;
  proposedScope:
    | "work_experience"
    | "work_initiative"
    | "portfolio_project"
    | "evidence_claim"
    | "profile_context"
    | "imported_note"
    | "enrichment_question";
  classifierScope:
    | "work_experience"
    | "work_initiative"
    | "portfolio_project"
    | "evidence_claim"
    | "profile_context"
    | "imported_note"
    | "unassigned";
  guardrailDecision:
    | "can_persist_to_canonical_pending"
    | "persist_unassigned_pending"
    | "review_queue_only"
    | "reject_as_invalid_scope";
  guardrailReason: string;
  confidence: "low" | "medium" | "high";
  suggestedAction:
    | "save_as_evidence"
    | "save_as_work_initiative"
    | "save_as_portfolio_project"
    | "save_as_profile_context"
    | "save_as_unassigned"
    | "review_scope"
    | "dismiss";
  status: "open" | "resolved" | "dismissed";
  resolvedAsTargetId?: string | null;
  resolvedAsTargetType?: "evidence" | "work_initiative" | "portfolio_project" | "profile_context" | "unassigned" | null;
};
```

Persistence decision:

- Preferred: add a first-class `scope_review_candidates` table and let enrichment tasks reference it.
- Acceptable transitional slice: keep typed metadata on `enrichment_tasks.review_payload_json`, but the payload must be built from classifier/guardrail decisions, not parsed from `prompt`.
- Transitional `review_payload_json` must still behave like a durable candidate record. It must include stable `candidateId`, `status`, provenance, proposed/classifier scope, guardrail decision/reason, suggested action, and the resolved target id/type once resolved. It is not acceptable for this field to be only UI metadata or display copy.
- Prompt text is display copy only. It must not be the source of truth for candidate identity, scope, or provenance.

Deep module:

```ts
applyCandidateReviewAction({
  candidateId,
  action,
  payload,
  actor,
})
```

Actions:

- `save_as_evidence`
- `save_as_work_initiative`
- `save_as_portfolio_project`
- `save_as_profile_context`
- `save_as_unassigned`
- `dismiss`

Hard rules:

- Every save action creates pending/review material only.
- `save_as_evidence` requires an atomic factual claim and source quote or explicit source review.
- Broad story text cannot be directly saved as Evidence.
- Profile Context cannot be saved as Evidence.
- Dismissed candidates cannot be consumed by resume generation.
- Resolution must update candidate status and link the created target id when applicable.

Acceptance:

- Candidate ids do not come from prompt parsing.
- Candidate Review Queue can render and act on structured candidate records.
- Wrong-scope candidates do not create canonical assets until a user action resolves them.
- Repository integration tests cover each save/dismiss action.

Local implementation:

- `scope_review_candidates` stores the durable candidate lifecycle.
- Guardrail-created enrichment tasks upsert source provenance, proposed/classifier scope, guardrail decision/reason, confidence, suggested action, and resolution status.
- `applyCandidateReviewAction` resolves candidates by dismissing, saving as pending Profile Context, saving as pending canonical material, or keeping the candidate in review as unassigned.
- Candidate actions support user correction beyond the suggested action. The chosen destination is rechecked with deterministic destination-specific guardrails before persistence.
- `save_as_evidence` only succeeds for atomic Evidence Claims with a real source document and source quote.
- Story-target candidate save actions only succeed when the selected destination passes the matching Story Target guardrail and create pending material.

### P1.2 Guided Story Target Creation

Goal: replace title-only story creation with a structured, source-grounded creation flow.

Flow:

1. User opens a Work Queue task that needs a Story Target.
2. User selects an existing target or chooses `Create new Story Target`.
3. UI shows deterministic similar story suggestions before creation.
4. User chooses target type:
   - under a Work Experience -> Work Initiative
   - non-employer project -> Portfolio Project
5. User edits a structured draft:
   - title
   - context / business goal
   - problem
   - role
   - actions
   - results / metrics
   - technologies
   - source quote/snippet
6. User saves the draft.
7. Backend creates pending story target, preserves provenance, binds the current task, and updates normalized task targets plus legacy anchor fields.

Deep modules:

```ts
buildStoryTargetDraftFromTask({
  taskId,
  targetType,
  workExperienceId,
  sourceSnippet,
  userAnswer,
})
```

Returns draft only. It must not write canonical tables.

```ts
createStoryTargetFromDraft({
  taskId,
  draft,
  actor,
})
```

Writes only after user confirmation.

Result contract:

```ts
type CreateStoryTargetFromDraftResult = {
  status: "created" | "needs_review" | "invalid";
  storyTargetId?: string;
  storyTargetType?: "work_initiative" | "portfolio_project";
  blockers: string[];
  linkedTaskId: string;
};
```

AI draft boundary:

- AI can draft a skeleton from task prompt, user answer, source snippet, selected Work Experience, and similar stories.
- AI cannot invent facts or metrics.
- Fields without source support must be marked user-provided / needs source.
- AI cannot mark the story public-safe, approved, or resume-ready.
- Saved story remains pending and needs review.

Acceptance:

- User is never forced to create a Story Target from a blank title field.
- New story appears in Build Story Targets with source provenance.
- Current task and future proposal/evidence accept paths inherit the confirmed story target.

Local implementation:

- The create flow captures title, context, problem, role, actions, results, technologies, and source quote.
- Saved Story Targets remain pending and provenance-linked.

### P1.3 Work Queue Routing And Correction Entry

Goal: make review states actionable and navigable.

UI behavior:

- Library `Needs review` affordances deep-link to the relevant Work Queue item.
- Work Queue groups actions by user task type:
  - Scope Review
  - Build Story Targets
  - Evidence Review
  - Profile Fact Review
  - Source Import Review
- Each item shows why it needs review, source, recommended next action, and linked role/story/evidence.

Routing contract:

- `focusTaskId`
- `sourceDocumentId`
- `targetId`
- `candidateId`

Acceptance:

- User can click from Library to the exact Work Queue card.
- Imported observations do not appear as answer prompts.
- Rejected targets and resolved candidates are not active blockers.

Local implementation:

- Scope Review candidates appear through the source review pane with structured actions.
- Library status affordances continue to route to the corresponding Work Queue surface.

### P1.4 Merge / Keep Separate / Split UX

Goal: let users correct duplicate or over-broad Story Targets.

MVP actions:

- merge story targets
- keep separate
- split story target
- move selected evidence claims to another story

Split MVP:

1. Select source story.
2. Create or choose destination Story Target.
3. Select evidence claims to move.
4. Save.
5. Source and destination stories remain pending/review.
6. Affected generated claims become stale.

Correction module:

Extend `applyStoryTargetCorrection({ action, targetId, payload })` with:

- `merge_story_targets`
- `keep_separate`
- `split_story_target`
- `move_evidence_to_story`

Guardrails:

- Never auto-merge across Work Experiences.
- Same technology alone is not enough to merge.
- Every relation move stales generated claims.
- Keep-separate decisions suppress future duplicate suggestions.

Acceptance:

- AWS CDK/cache/latency fragments can be merged into one story.
- Wrong merge suggestions can be marked keep separate.
- Split moves selected evidence to a new or existing Story Target and preserves provenance.

Local implementation:

- Story overlap cleanup supports merge and keep-separate.
- Build Story Targets detail supports split into a new or existing Work Initiative / Portfolio Project and moves selected linked Evidence Claims.
- Split destination validation rejects rejected targets, cross-workspace targets, and evidence not linked to the source Work Initiative.
- Split and merge mark impacted generated claims stale and record privacy-safe correction events.

### P1.5 Source Provenance Drilldown

Goal: every candidate/story/evidence can answer where it came from.

UI:

- Source document title
- source type
- source section / nearby heading where available
- quote/snippet
- import date
- source context drawer with bounded nearby text

Rules:

- Raw source remains discovery only.
- Missing provenance is visible and blocks resume eligibility.
- Cleanup/quarantine shows affected candidates, stories, and evidence.

Acceptance:

- Scope Review Candidate, Story Target, Evidence Claim, enrichment task, and generated claim support all expose provenance where available.
- A user can inspect source context before saving candidate material.

Local implementation:

- Library DTOs expose source document titles, source type, import date, and bounded source context previews for Evidence, Work Experience, Work Initiative, and Portfolio Project rows.
- Story Target details include a Source Trail with story source label, import date, bounded nearby source context, and linked Evidence Claim source quotes.

### P1.6 Correction Audit Trail

Goal: make scope/relation changes traceable without storing raw private text.

Suggested table:

```ts
type ScopeCorrectionEvent = {
  id: string;
  workspaceId: string;
  actor: "user" | "system" | "ai";
  action: string;
  subjectType: "candidate" | "story_target" | "evidence" | "work_experience";
  subjectId: string;
  beforeJson: ScopeCorrectionEventSnapshot | null;
  afterJson: ScopeCorrectionEventSnapshot | null;
  sourceDocumentId?: string | null;
  createdAt: Date;
};

type ScopeCorrectionEventSnapshot = {
  scope?: string | null;
  status?: string | null;
  relationIds?: Record<string, string | null>;
  counts?: Record<string, number>;
  shortLabel?: string | null;
};
```

Events:

- candidate saved as scope
- story target created from task
- initiative -> portfolio
- portfolio -> initiative
- reassigned role
- merged
- split
- keep separate
- dismissed

Constraints:

- Do not store large raw source text.
- Store only scope, relation ids, status, counts, short labels, and action metadata.
- Do not store full asset snapshots, raw candidate text, full source quotes, full user answers, or full source chunks in `beforeJson` / `afterJson`.
- Audit write should be transactional with canonical relation changes where needed.

Acceptance:

- Each candidate/story correction writes an event.
- Diagnostics can explain who changed scope/relation and when.

Local implementation:

- `scope_correction_events` records candidate review, story review, assignment, conversion, split, merge, and keep-separate events with privacy-safe before/after snapshots.
- Snapshots store short labels, status/scope, source state, and counts only.

### P1.7 Better Story Seeding

Goal: improve automatic Story Target coverage only after the candidate/correction pipeline is stable.

Extraction behavior:

- Segment extraction by Work Experience.
- Cluster bullets by domain/service, technology, action chain, outcome/metric, and nearby heading.
- Emit `StorySeedCandidate`, not trusted canonical truth.

Rules:

- High-confidence story seeds must still pass `scope-classifier` and `extraction-scope-guardrail`.
- High-confidence seeds may become pending Story Targets only with source quote/section and needs review.
- Medium/low confidence seeds enter Candidate Review Queue.
- Extractor confidence never replaces deterministic guardrails.
- No story seed becomes approved, public-safe, or resume-ready automatically.

Acceptance fixtures:

- Same company multiple roles do not cross-bind.
- AWS CDK/cache/latency fragments become one candidate cluster.
- Technical Skills does not become a Story Target.
- Project-only material becomes Portfolio Project candidate or unassigned.
- Each role with project/accomplishment bullets has either a story candidate or an explicit uncovered-source review item.

Local implementation:

- Parsed profile experience bullets seed thin pending Work Initiatives when no extractor initiative exists for the same role.
- Same-role seed bullets with overlapping technology, domain, and outcome signals are clustered into one pending Work Initiative so CDK/cache/latency fragments do not create separate stories.
- Ambiguous single-bullet seeds route to structured Scope Review Candidates instead of silently creating canonical Story Targets.
- Story seeds pass through initiative consolidation and scope guardrails before persistence.
- Skills/profile-context bullets are filtered out of story seeding.

### P1.8 Manual QA SOP

Goal: make the full correction loop reviewable by a human.

Update:

- `docs/resume-core-loop-qa.md`
- `docs/scope-accuracy-foundation.md`
- `docs/development-status.md`

QA coverage:

1. Add Material story coverage
2. Candidate Review Queue actions
3. Guided Story Target Creation
4. Strengthen Evidence -> create story -> answer -> accept proposal
5. Initiative <-> Portfolio correction
6. Merge / split / keep separate
7. Source provenance drilldown
8. Resume generation safety
9. Fact Guard / export gates
10. rejected/moved-away target picker exclusion

Acceptance:

- Every P1 feature has manual steps and expected results.
- Automated tests map to manual QA cases.
- Reviewers can validate the end-to-end loop without reading implementation code.
