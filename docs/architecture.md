# Job Search Copilot — Overall Architecture (diagram-first companion)

Status: Target architecture (diagram-first view)
Date: 2026-06-09
Role in doc set: the consolidated, diagram-first view of the system. For the
authoritative system-level spec see `design-doc.md`; for per-component
build/learning detail see `build-and-learn.md`; for product requirements see
`prd.md`.
Resolved assumptions (now decisions, see design-doc §21.4 / §23.8 / §24):
local-first single-user MVP, TypeScript end-to-end, primary persona = experienced
professional.

This document is a consolidated, diagram-first view of the recommended architecture.
It reflects the agreed design: ~5-6 true agents (not 11-12), a two-layer Fact
Guard (deterministic + model), a living claim-evidence ledger, and a thin
local-first footprint that can grow into SaaS without a data-model rewrite.

Note: earlier review feedback has been folded into `design-doc.md` and
`build-and-learn.md`; this architecture file should stand on its own.

---

## 1. Layered View

```mermaid
flowchart TD
  subgraph CLIENT["Client"]
    UI["Web App (Next.js)
    Profile / Evidence / Jobs / Interviews / Tracker / Dashboard"]
  end

  subgraph APP["Application Layer"]
    API["API Routes (TypeScript)
    auth/session, CRUD, file upload, workflow triggers"]
    ORCH["Workflow Orchestrator
    owns state, ordering, approvals, retries"]
  end

  subgraph AIL["AI Execution Layer"]
    AGENTS["Agents (multi-step + tools)"]
    FUNCS["Typed LLM Functions (one-shot)"]
    GUARD["Guardrails
    Fact Guard A (code) + B (model), schema validation, fairness"]
    PROVIDER["LLM Provider Abstraction
    model routing: cheap / strong / none"]
  end

  subgraph DATAL["Data & Retrieval"]
    RET["Retrieval Service
    structured filter + keyword + vector"]
    DB[("Postgres + pgvector
    or SQLite for local MVP")]
    OBJ[("Object / File Storage")]
  end

  subgraph EXT["External Boundary (Phase 5)"]
    MCP["MCP Tool Gateway
    permissioned, logged"]
    SEARCH["External Search"]
    EMAIL["Email (read-only)"]
    JOBSRC["Job Sources / Clipper"]
  end

  UI --> API
  API --> ORCH
  API --> DB
  API --> OBJ
  ORCH --> AGENTS
  ORCH --> FUNCS
  ORCH --> GUARD
  AGENTS --> PROVIDER
  FUNCS --> PROVIDER
  AGENTS --> RET
  RET --> DB
  GUARD --> DB
  AGENTS --> MCP
  MCP --> SEARCH
  MCP --> EMAIL
  MCP --> JOBSRC
```

Key principle (unchanged from design 4.1): the **application owns orchestration**.
Agents and functions are constrained workers. They never decide the whole workflow.

---

## 2. Component Responsibilities

| Layer | Component | Responsibility | MVP? |
|-------|-----------|----------------|------|
| Client | Web App | Workspace UI, explicit AI actions, approval modals | Yes |
| App | API Routes | Auth/session, CRUD, upload, workflow triggers, access control | Yes |
| App | Orchestrator | Workflow state, step ordering, approval pauses, retries, persistence | Yes |
| AI | Agents | Multi-step reasoning + tool use (see Section 4) | Partial |
| AI | Typed LLM Functions | One-shot structured extraction/parse | Yes |
| AI | Guardrails | Fact Guard A/B, schema validation, fairness, sensitive-term block | Yes |
| AI | Provider Abstraction | Model routing, vendor independence, local-mode | Yes |
| Data | Retrieval | Evidence selection (structured + keyword + vector) | Yes |
| Data | Postgres/SQLite | Source of truth for profile, evidence, claims, jobs | Yes |
| Data | Object Storage | Uploaded docs, rendered exports | Yes |
| External | MCP Gateway + tools | Email, job sources, search, clipper, calendar | Phase 5 |

---

## 3. Workflow Orchestration Model

```mermaid
stateDiagram-v2
  [*] --> pending
  pending --> running
  running --> waiting_for_user: approval / confirmation needed
  waiting_for_user --> running: user responds
  running --> succeeded
  running --> partially_succeeded: schema/cost/guardrail soft-fail with saved draft
  running --> failed
  running --> canceled
  succeeded --> [*]
  partially_succeeded --> [*]
  failed --> [*]
  canceled --> [*]
```

Every workflow run is a persisted record (id, user_id, workspace_id, type, status,
current_step, input/output payload, error). The UI subscribes to step events for
progress. Approvals are explicit pause points, not background magic.

---

## 4. AI Execution: Agents vs Functions vs Code

Something is an *agent* only if it needs multi-step reasoning with tool use;
otherwise it is a typed LLM function or plain code.

```mermaid
flowchart LR
  subgraph TRUE["True Agents (5-6)"]
    EC["Evidence Curator"]
    RT["Resume Tailor"]
    HR["HR Reviewer"]
    CR["Company Research"]
    IC["Interview Coach"]
    JS["Job Scout"]
  end
  subgraph FN["Typed LLM Functions"]
    PI["Profile Intake"]
    JD["JD Analyst"]
    IR["Interview Review"]
    FGB["Fact Guard Layer B"]
    PT["Pipeline Classifier"]
  end
  subgraph CODE["Deterministic Code"]
    FGA["Fact Guard Layer A
    entity extract + diff + blocked-terms"]
    SV["Schema Validation"]
    RENDER["Resume Renderer (JSON to PDF)"]
    DEDUP["Job Dedup"]
  end
```

| Name | Type | Model tier | Blocking authority |
|------|------|-----------|--------------------|
| Profile Intake | LLM function | Cheap | No |
| Evidence Curator | Agent | Strong | No |
| De-identification | Skill/step in Evidence Curator | Cheap/Strong | Feeds Layer A |
| JD Analyst | LLM function | Cheap | No |
| Resume Tailor | Agent | Strong | No |
| HR Reviewer | Agent | Strong | No (advisory) |
| Fact Guard Layer A | Code | None | Yes (hard block) |
| Fact Guard Layer B | LLM function | Cheap/Strong | Warning only |
| Company Research | Agent | Strong | No |
| Interview Coach | Agent | Strong | No |
| Interview Review | LLM function | Strong | No |
| Job Scout | Agent | Strong | No |
| Pipeline Tracker | Classifier + rules | Cheap | No (read-only) |

---

## 5. The Grounding Spine (critical path)

This is the loop that proves the product thesis. Build this first.

```mermaid
sequenceDiagram
  participant U as User
  participant OR as Orchestrator
  participant JD as JD Analyst (fn)
  participant R as Retrieval
  participant RT as Resume Tailor (agent)
  participant FA as Fact Guard A (code)
  participant FB as Fact Guard B (fn)
  participant HR as HR Reviewer (agent)
  participant DB as Database

  U->>OR: Generate tailored resume
  OR->>JD: Analyze JD
  JD-->>OR: Requirement matrix
  OR->>R: Retrieve approved evidence only
  R-->>OR: Ranked evidence
  OR->>RT: Generate draft + claim-to-evidence map
  RT-->>OR: Resume draft + claims
  OR->>FA: Deterministic checks (employers, dates, degrees, metrics, blocked terms)
  alt Hard block
    FA-->>OR: Blocked claims
    OR-->>U: Require fix / confirmation
  else Pass
    FA-->>OR: OK
    OR->>FB: Semantic support check
    FB-->>OR: Warnings + confidence
    OR->>HR: Advisory review (with fairness rubric)
    HR-->>OR: Score + scope note
    OR->>DB: Save resume version + claim ledger
    OR-->>U: Show resume + warnings
  end
```

---

## 6. Claim-Evidence Ledger (living provenance)

```mermaid
flowchart LR
  EV["evidence row"] -->|edit / merge / delete / sensitivity change| TRG["claim_revalidation workflow"]
  TRG --> MARK["mark dependent claims stale"]
  MARK --> RECHK["recompute support (Fact Guard A/B)"]
  RECHK --> UI["UI: 'N resume versions need recheck'"]
  GC["generated_claims (authoritative ledger)
  status: supported / partial / unsupported / user_confirmed / stale"]
  TRG --> GC
  RECHK --> GC
```

This converts Fact Guard from a one-shot gate into a continuous integrity system.
It is the difference between "looked grounded once" and "stays grounded."

---

## 7. Data Model (MVP core)

Only the tables the grounding spine needs. The full set is in design-doc Section 7.

```mermaid
erDiagram
  WORKSPACE ||--o{ SOURCE_DOCUMENT : imports
  WORKSPACE ||--o{ PROFILE : has
  WORKSPACE ||--o{ EVIDENCE : contains
  WORKSPACE ||--o{ PROJECT : contains
  WORKSPACE ||--o{ JOB : contains
  WORKSPACE ||--o{ RESUME_VERSION : contains
  JOB ||--o{ JOB_REQUIREMENT : has
  JOB ||--o{ GENERATED_DOCUMENT : contains
  EVIDENCE ||--o{ GENERATED_CLAIM : supports
  RESUME_VERSION ||--o{ GENERATED_CLAIM : contains
  PROJECT ||--o{ EVIDENCE : groups
```

Tables for MVP: `workspaces`, `source_documents`, `profiles`, `projects`,
`evidence`, `jobs`, `job_requirements`, `resume_versions`, `generated_documents`,
`generated_claims`. Defer: interviews, reviews, applications, external_sources,
tool_call_logs (add as their phases arrive).

---

## 8. Trust & Safety Architecture

```mermaid
flowchart TD
  IN["Input guardrails
  file type, fabrication request, sensitive upload"] --> GEN["Generation"]
  GEN --> OUTA["Output: Fact Guard A (code, hard block)
  new employer/degree/date/metric, blocked terms"]
  OUTA --> OUTB["Output: Fact Guard B (model, warn)
  semantic support, coverage"]
  OUTB --> FAIR["Fairness rubric
  do-not-penalize: gaps, age, non-traditional edu"]
  FAIR --> APPR["Human approval gate
  required for sensitive-origin external output"]
  APPR --> SAVE["Persist + audit log"]
```

Approval is non-skippable for any content marked `sensitivity_level = sensitive`
before it reaches an external-facing document.

---

## 9. Deployment Footprint Evolution

```mermaid
flowchart LR
  subgraph M1["MVP (local-first)"]
    A1["Next.js app"]
    A2["SQLite or local Postgres"]
    A3["Local files"]
    A4["User-provided model key"]
  end
  subgraph M2["SaaS (later)"]
    B1["Next.js + API services"]
    B2["Postgres + pgvector"]
    B3["Object storage (S3/R2)"]
    B4["Queue + scheduler"]
    B5["Secret manager + OAuth"]
    B6["Observability stack"]
  end
  M1 -->|same schema, scoped by user_id/workspace_id| M2
```

The data model is multi-tenant-ready from day one (every row scoped by
`user_id`/`workspace_id`), so the local-first MVP promotes to SaaS without a
rewrite. Queues, OAuth, schedulers, and the MCP external tools arrive with SaaS
and Phase 5 automation, not before.

---

## 10. Build Order (maps to this architecture)

1. Stage 0: decisions (D4-D6), app shell, provider abstraction, core schema.
2. Stage 1: grounding spine (Sections 5-6) — import, evidence, tailor, Fact Guard A, export.
3. Stage 2: golden eval set as CI gate.
4. Stage 3: Fact Guard B, HR Reviewer + fairness, cover letters, de-identification.
5. Stage 4: interview loop, then application tracker/dashboard.
6. Stage 5: MCP external boundary — job scout, email, browser clipper.

---

## 11. Decisions Taken & Remaining Open Items

Resolved (now decisions in design-doc.md, not open):
- D4 — Deployment: **local-first single-user MVP**, cloud-ready boundaries
  (design-doc §21.4).
- D5 — Primary persona: **experienced professional**.
- D6 — Runtime: **TypeScript end-to-end** for MVP (design-doc §23.8).
- Retrieval: **single embeddings table + `index_type`** for MVP; pgvector locally
  or an in-process cosine fallback acceptable; no separate stores/reranking yet
  (design-doc §8.2, build-and-learn §4.11).

Genuinely still open:
- High-quality PDF/DOCX renderer choice (design-doc open Q1; build-and-learn §8.10).
- Whether Company Research / Job Scout (external boundary) are in scope for the
  first releasable version, given ToS/legal review needs.
- Exact entity-extraction approach for Fact Guard Layer A (pure code vs a
  constrained-model front-end) — to be decided empirically (build-and-learn §6.10).
