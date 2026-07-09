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
| Phase 6 | In progress, third slice | Create missing Story Target from enrichment question exists; Evidence Cards expose Remove story link; Portfolio Projects can now be moved to Work Initiatives under a selected Work Experience with linked evidence preserved. Reverse scope changes and broader keep-separate UI remain staged. |
| Phase 7 | In progress, first slice | Work Queue source-review pane now gives scope guardrail notes a dedicated scope-review action model; deeper validators remain staged. |
| Phase 8 | In progress, second slice | Workflow metadata now records privacy-safe scope guardrail/consolidation counts for Work Experience, Initiative, Portfolio Project, and Evidence Claim candidates; broader diagnostics dashboard remains staged. |
| Phase 9 | Not started | AI enhancements intentionally deferred. |
