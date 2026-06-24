import { relations } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  uniqueIndex,
  check,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const workflowStatusEnum = pgEnum("workflow_status", [
  "running",
  "succeeded",
  "failed",
  "skipped",
]);

export const requirementTypeEnum = pgEnum("requirement_type", ["hard", "soft"]);
export const approvalStatusEnum = pgEnum("approval_status", [
  "pending",
  "approved",
  "rejected",
]);
export const evidenceTypeEnum = pgEnum("evidence_type", [
  "original",
  "extracted",
  "user_confirmed",
  "inferred",
]);
export const sensitivityLevelEnum = pgEnum("sensitivity_level", [
  "public_safe",
  "private",
  "sensitive",
]);
export const resumeStatusEnum = pgEnum("resume_status", [
  "draft",
  "unvalidated",
  "validated",
  "exported",
]);
export const claimRiskLevelEnum = pgEnum("claim_risk_level", [
  "low",
  "medium",
  "high",
]);
export const claimSupportStatusEnum = pgEnum("claim_support_status", [
  "unvalidated",
  "supported",
  "partially_supported",
  "unsupported",
  "user_confirmed",
]);
export const claimStatusEnum = pgEnum("claim_status", [
  "unvalidated",
  "supported",
  "partially_supported",
  "unsupported",
  "user_confirmed",
  "stale",
]);

export const applicationStatusEnum = pgEnum("application_status", [
  "evaluated",
  "applied",
  "responded",
  "interview",
  "offer",
  "rejected",
  "discarded",
  "skip",
]);

export const interviewPrepStatusEnum = pgEnum("interview_prep_status", [
  "draft",
  "ready",
  "stale",
]);
export const overlapEntityTypeEnum = pgEnum("overlap_entity_type", [
  "evidence",
  "project",
  "initiative",
  "portfolio_project",
]);
export const overlapDecisionEnum = pgEnum("overlap_decision", [
  "keep_separate",
]);
export const resumeSourceStatusEnum = pgEnum("resume_source_status", [
  "uploaded",
  "reviewed",
  "extracted",
  "archived",
]);
export const resumeReviewStatusEnum = pgEnum("resume_review_status", [
  "ready",
  "stale",
]);
export const enrichmentTaskTypeEnum = pgEnum("enrichment_task_type", [
  "metric",
  "scope",
  "ownership",
  "technical_depth",
  "stakeholder",
  "impact",
  "star",
  "public_safe_wording",
  "source_section_review",
]);
export const enrichmentTaskStatusEnum = pgEnum("enrichment_task_status", [
  "open",
  "answered",
  "converted",
  "dismissed",
]);
export const enrichmentTaskSourceTypeEnum = pgEnum("enrichment_task_source_type", [
  "resume_review",
  "extraction_note",
  "evidence",
  "story_target",
  "jd_gap",
  "user_input",
]);
export const enrichmentTaskTargetScopeEnum = pgEnum("enrichment_task_target_scope", [
  "evidence_detail",
  "story_context",
  "role_context",
  "source_material",
  "assign_later",
  "profile_context",
  "profile_fact",
]);
export const enrichmentTaskTargetConfidenceEnum = pgEnum(
  "enrichment_task_target_confidence",
  ["low", "medium", "high"],
);
export const enrichmentTaskExpectedOutcomeEnum = pgEnum(
  "enrichment_task_expected_outcome",
  [
    "create_evidence",
    "update_evidence",
    "update_story",
    "update_role",
    "clarify_assignment",
    "review_imported_material",
    "save_profile_answer",
    "update_profile_fact",
    "route_answer",
  ],
);
export const enrichmentTaskNoteKindEnum = pgEnum("enrichment_task_note_kind", [
  "observation",
  "missing_profile_fact",
  "missing_role_field",
  "extraction_limit",
  "import_review",
  "evidence_gap",
  "story_gap",
]);
export const enrichmentTaskExpectedActionEnum = pgEnum("enrichment_task_expected_action", [
  "acknowledge",
  "dismiss",
  "add_profile_fact",
  "edit_profile_fact",
  "edit_role_field",
  "review_import",
  "rerun_extraction",
  "answer_enrichment_question",
]);
export const enrichmentTaskResolutionKindEnum = pgEnum("enrichment_task_resolution_kind", [
  "acknowledged",
  "dismissed",
  "profile_answer_saved",
  "profile_fact_updated",
  "role_field_updated",
  "import_reviewed",
  "rerun_requested",
  "converted_to_enrichment_question",
]);
export const enrichmentTaskTargetKindEnum = pgEnum("enrichment_task_target_kind", [
  "evidence",
  "initiative",
  "portfolio_project",
  "work_experience",
]);
export const enrichmentTaskTargetRoleEnum = pgEnum("enrichment_task_target_role", [
  "primary",
  "parent",
  "suggested",
  "previous",
]);
export const enrichmentAnswerStatusEnum = pgEnum("enrichment_answer_status", [
  "submitted",
  "applied",
  "rejected",
]);
export const enrichmentProposalTypeEnum = pgEnum("enrichment_proposal_type", [
  "create_evidence",
  "update_evidence",
  "create_initiative",
  "update_initiative",
  "update_work_experience",
  "clarify_assignment",
  "link_evidence_to_story",
  "link_story_to_role",
]);
export const enrichmentProposalStatusEnum = pgEnum("enrichment_proposal_status", [
  "pending_review",
  "accepted",
  "rejected",
]);
export const enrichmentProposalRevisionActorEnum = pgEnum(
  "enrichment_proposal_revision_actor",
  ["user", "ai"],
);
export const enrichmentProposalRevisionModeEnum = pgEnum(
  "enrichment_proposal_revision_mode",
  ["manual_edit", "ai_revision"],
);
export const portfolioProjectTypeEnum = pgEnum("portfolio_project_type", [
  "personal_project",
  "academic_project",
  "open_source",
  "freelance",
  "hackathon",
  "general_project",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: varchar("email", { length: 320 }).notNull(),
    passwordHash: text("password_hash").notNull(),
    displayName: varchar("display_name", { length: 160 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    emailIdx: uniqueIndex("users_email_idx").on(table.email),
  }),
);

export const userSessions = pgTable(
  "user_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: varchar("token_hash", { length: 128 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  },
  (table) => ({
    tokenHashIdx: uniqueIndex("user_sessions_token_hash_idx").on(table.tokenHash),
    userExpiresIdx: index("user_sessions_user_expires_idx").on(table.userId, table.expiresAt),
  }),
);

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 160 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    createdIdx: index("workspaces_created_idx").on(table.createdAt),
    userIdx: index("workspaces_user_idx").on(table.userId),
  }),
);

export const sourceDocuments = pgTable(
  "source_documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sourceType: varchar("source_type", { length: 40 }).notNull(),
    title: varchar("title", { length: 240 }).notNull(),
    originalFilename: varchar("original_filename", { length: 260 }),
    mimeType: varchar("mime_type", { length: 160 }),
    fileSizeBytes: integer("file_size_bytes"),
    contentText: text("content_text").notNull(),
    contentHash: varchar("content_hash", { length: 128 }),
    parserName: varchar("parser_name", { length: 80 }),
    parserVersion: varchar("parser_version", { length: 80 }),
    parseStatus: varchar("parse_status", { length: 40 }),
    parseWarnings: jsonb("parse_warnings").$type<string[]>().notNull().default([]),
    pageCount: integer("page_count"),
    charCount: integer("char_count"),
    wordCount: integer("word_count"),
    lifecycleStatus: varchar("lifecycle_status", { length: 40 }).notNull().default("parsed"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    workspaceCreatedIdx: index("source_documents_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
    workspaceHashIdx: index("source_documents_workspace_hash_idx").on(
      table.workspaceId,
      table.contentHash,
    ),
    lifecycleIdx: index("source_documents_lifecycle_idx").on(
      table.workspaceId,
      table.lifecycleStatus,
    ),
  }),
);

export const sourceChunks = pgTable(
  "source_chunks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sourceDocumentId: uuid("source_document_id")
      .notNull()
      .references(() => sourceDocuments.id, { onDelete: "cascade" }),
    resumeSourceVersionId: uuid("resume_source_version_id").references(
      () => resumeSourceVersions.id,
      { onDelete: "set null" },
    ),
    sourceType: varchar("source_type", { length: 40 }).notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    chunkText: text("chunk_text").notNull(),
    contentHash: varchar("content_hash", { length: 128 }).notNull(),
    parseQuality: varchar("parse_quality", { length: 40 }),
    lifecycleStatus: varchar("lifecycle_status", { length: 40 }).notNull(),
    metadataJson: jsonb("metadata_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    embeddingModel: varchar("embedding_model", { length: 120 }).notNull(),
    vectorJson: jsonb("vector_json").$type<number[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    workspaceSourceIdx: index("source_chunks_workspace_source_idx").on(
      table.workspaceId,
      table.sourceDocumentId,
    ),
    workspaceLifecycleIdx: index("source_chunks_workspace_lifecycle_idx").on(
      table.workspaceId,
      table.lifecycleStatus,
    ),
    workspaceResumeIdx: index("source_chunks_workspace_resume_idx").on(
      table.workspaceId,
      table.resumeSourceVersionId,
    ),
    workspaceHashIdx: index("source_chunks_workspace_hash_idx").on(
      table.workspaceId,
      table.contentHash,
    ),
    sourceChunkUniqueIdx: uniqueIndex("source_chunks_source_chunk_unique_idx").on(
      table.sourceDocumentId,
      table.chunkIndex,
    ),
  }),
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sourceDocumentId: uuid("source_document_id").references(
      () => sourceDocuments.id,
      { onDelete: "set null" },
    ),
    title: varchar("title", { length: 240 }).notNull(),
    company: varchar("company", { length: 240 }),
    roleTitle: varchar("role_title", { length: 240 }),
    level: varchar("level", { length: 120 }),
    location: varchar("location", { length: 240 }),
    originalJdText: text("original_jd_text").notNull(),
    responsibilities: jsonb("responsibilities")
      .$type<string[]>()
      .notNull()
      .default([]),
    preferredQualifications: jsonb("preferred_qualifications")
      .$type<string[]>()
      .notNull()
      .default([]),
    roleSignals: jsonb("role_signals").$type<string[]>().notNull().default([]),
    roleArchetype: varchar("role_archetype", { length: 80 })
      .notNull()
      .default("unknown"),
    jobLegitimacy: jsonb("job_legitimacy")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({
        tier: "proceed_with_caution",
        signals: [],
        context_notes: [],
      }),
    applicationStatus: applicationStatusEnum("application_status")
      .notNull()
      .default("evaluated"),
    keywords: jsonb("keywords").$type<string[]>().notNull().default([]),
    interviewImplications: jsonb("interview_implications")
      .$type<string[]>()
      .notNull()
      .default([]),
    lastAnalyzedAt: timestamp("last_analyzed_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    workspaceUpdatedIdx: index("jobs_workspace_updated_idx").on(
      table.workspaceId,
      table.updatedAt,
    ),
  }),
);

export const jobRequirements = pgTable(
  "job_requirements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    sourceQuote: text("source_quote").notNull(),
    requirementType: requirementTypeEnum("requirement_type").notNull(),
    importance: integer("importance").notNull(),
    keywords: jsonb("keywords").$type<string[]>().notNull().default([]),
    verified: integer("verified").notNull().default(0),
    sortOrder: integer("sort_order").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    jobSortIdx: index("job_requirements_job_sort_idx").on(
      table.jobId,
      table.sortOrder,
    ),
  }),
);

export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sourceDocumentId: uuid("source_document_id").references(
      () => sourceDocuments.id,
      { onDelete: "set null" },
    ),
    displayName: varchar("display_name", { length: 240 }),
    profileJson: jsonb("profile_json").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    workspaceUpdatedIdx: index("profiles_workspace_updated_idx").on(
      table.workspaceId,
      table.updatedAt,
    ),
  }),
);

export const workExperiences = pgTable(
  "work_experiences",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sourceDocumentId: uuid("source_document_id").references(
      () => sourceDocuments.id,
      { onDelete: "set null" },
    ),
    employer: varchar("employer", { length: 240 }).notNull(),
    roleTitle: varchar("role_title", { length: 240 }).notNull(),
    team: varchar("team", { length: 240 }),
    location: varchar("location", { length: 240 }),
    startDate: varchar("start_date", { length: 80 }),
    endDate: varchar("end_date", { length: 80 }),
    summary: text("summary"),
    status: approvalStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    workspaceUpdatedIdx: index("work_experiences_workspace_updated_idx").on(
      table.workspaceId,
      table.updatedAt,
    ),
  }),
);

export const initiatives = pgTable(
  "initiatives",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    workExperienceId: uuid("work_experience_id").references(
      () => workExperiences.id,
      { onDelete: "cascade" },
    ),
    sourceDocumentId: uuid("source_document_id").references(
      () => sourceDocuments.id,
      { onDelete: "set null" },
    ),
    internalTitle: varchar("internal_title", { length: 240 }).notNull(),
    externalSafeTitle: varchar("external_safe_title", { length: 240 }),
    context: text("context"),
    problem: text("problem"),
    role: text("role"),
    actions: jsonb("actions").$type<string[]>().notNull().default([]),
    results: jsonb("results").$type<string[]>().notNull().default([]),
    metrics: jsonb("metrics").$type<Array<Record<string, unknown>>>().notNull().default([]),
    technologies: jsonb("technologies").$type<string[]>().notNull().default([]),
    stakeholders: jsonb("stakeholders").$type<string[]>().notNull().default([]),
    externalSafeSummary: text("external_safe_summary"),
    sensitivityLevel: sensitivityLevelEnum("sensitivity_level")
      .notNull()
      .default("private"),
    needsRedactionReview: integer("needs_redaction_review").notNull().default(1),
    status: approvalStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    workspaceUpdatedIdx: index("initiatives_workspace_updated_idx").on(
      table.workspaceId,
      table.updatedAt,
    ),
    workExperienceUpdatedIdx: index("initiatives_work_experience_updated_idx").on(
      table.workExperienceId,
      table.updatedAt,
    ),
  }),
);

export const portfolioProjects = pgTable(
  "portfolio_projects",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sourceDocumentId: uuid("source_document_id").references(
      () => sourceDocuments.id,
      { onDelete: "set null" },
    ),
    projectType: portfolioProjectTypeEnum("project_type")
      .notNull()
      .default("general_project"),
    title: varchar("title", { length: 240 }).notNull(),
    externalSafeTitle: varchar("external_safe_title", { length: 240 }),
    context: text("context"),
    problem: text("problem"),
    role: text("role"),
    actions: jsonb("actions").$type<string[]>().notNull().default([]),
    results: jsonb("results").$type<string[]>().notNull().default([]),
    metrics: jsonb("metrics").$type<Array<Record<string, unknown>>>().notNull().default([]),
    technologies: jsonb("technologies").$type<string[]>().notNull().default([]),
    stakeholders: jsonb("stakeholders").$type<string[]>().notNull().default([]),
    externalSafeSummary: text("external_safe_summary"),
    sensitivityLevel: sensitivityLevelEnum("sensitivity_level")
      .notNull()
      .default("private"),
    needsRedactionReview: integer("needs_redaction_review").notNull().default(0),
    status: approvalStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    workspaceUpdatedIdx: index("portfolio_projects_workspace_updated_idx").on(
      table.workspaceId,
      table.updatedAt,
    ),
  }),
);

export const evidenceItems = pgTable(
  "evidence_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sourceDocumentId: uuid("source_document_id").references(
      () => sourceDocuments.id,
      { onDelete: "set null" },
    ),
    text: text("text").notNull(),
    sourceQuote: text("source_quote").notNull(),
    evidenceType: evidenceTypeEnum("evidence_type").notNull(),
    metrics: jsonb("metrics").$type<Array<Record<string, unknown>>>().notNull().default([]),
    sensitivityLevel: sensitivityLevelEnum("sensitivity_level")
      .notNull()
      .default("private"),
    allowedUsage: jsonb("allowed_usage").$type<string[]>().notNull().default([]),
    publicSafeSummary: text("public_safe_summary"),
    status: approvalStatusEnum("status").notNull().default("pending"),
    relatedProjectId: uuid("related_project_id"),
    relatedWorkExperienceId: uuid("related_work_experience_id").references(
      () => workExperiences.id,
      { onDelete: "set null" },
    ),
    relatedInitiativeId: uuid("related_initiative_id").references(
      () => initiatives.id,
      { onDelete: "set null" },
    ),
    relatedPortfolioProjectId: uuid("related_portfolio_project_id").references(
      () => portfolioProjects.id,
      { onDelete: "set null" },
    ),
    needsUserConfirmation: integer("needs_user_confirmation").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    singleStoryTargetCheck: check(
      "evidence_items_single_story_target_check",
      sql`num_nonnulls(${table.relatedWorkExperienceId}, ${table.relatedInitiativeId}, ${table.relatedPortfolioProjectId}) <= 1`,
    ),
    workspaceUpdatedIdx: index("evidence_items_workspace_updated_idx").on(
      table.workspaceId,
      table.updatedAt,
    ),
  }),
);


export const projectCards = pgTable(
  "project_cards",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 240 }).notNull(),
    context: text("context"),
    problem: text("problem"),
    role: text("role"),
    actions: jsonb("actions").$type<string[]>().notNull().default([]),
    results: jsonb("results").$type<string[]>().notNull().default([]),
    metrics: jsonb("metrics").$type<Array<Record<string, unknown>>>().notNull().default([]),
    technologies: jsonb("technologies").$type<string[]>().notNull().default([]),
    stakeholders: jsonb("stakeholders").$type<string[]>().notNull().default([]),
    publicSafeSummary: text("public_safe_summary"),
    sensitivityLevel: sensitivityLevelEnum("sensitivity_level")
      .notNull()
      .default("private"),
    status: approvalStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    workspaceUpdatedIdx: index("project_cards_workspace_updated_idx").on(
      table.workspaceId,
      table.updatedAt,
    ),
  }),
);

export const overlapReviewDecisions = pgTable(
  "overlap_review_decisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    entityType: overlapEntityTypeEnum("entity_type").notNull(),
    leftEntityId: uuid("left_entity_id").notNull(),
    rightEntityId: uuid("right_entity_id").notNull(),
    decision: overlapDecisionEnum("decision").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    workspaceTypeIdx: index("overlap_review_decisions_workspace_type_idx").on(
      table.workspaceId,
      table.entityType,
    ),
    uniquePairIdx: uniqueIndex("overlap_review_decisions_unique_pair_idx").on(
      table.workspaceId,
      table.entityType,
      table.leftEntityId,
      table.rightEntityId,
    ),
  }),
);

export const resumeSourceVersions = pgTable(
  "resume_source_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    sourceDocumentId: uuid("source_document_id")
      .notNull()
      .references(() => sourceDocuments.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 240 }).notNull(),
    contentHash: varchar("content_hash", { length: 128 }).notNull(),
    sourceKind: varchar("source_kind", { length: 40 }).notNull(),
    sourceText: text("source_text").notNull(),
    version: integer("version").notNull().default(1),
    status: resumeSourceStatusEnum("status").notNull().default("uploaded"),
    lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }),
    extractedAt: timestamp("extracted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    workspaceUpdatedIdx: index("resume_source_versions_workspace_updated_idx").on(
      table.workspaceId,
      table.updatedAt,
    ),
    uniqueHashIdx: uniqueIndex("resume_source_versions_workspace_hash_idx").on(
      table.workspaceId,
      table.contentHash,
    ),
  }),
);

export const resumeReviewReports = pgTable(
  "resume_review_reports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    resumeSourceVersionId: uuid("resume_source_version_id")
      .notNull()
      .references(() => resumeSourceVersions.id, { onDelete: "cascade" }),
    workflowRunId: uuid("workflow_run_id").references(() => workflowRuns.id, {
      onDelete: "set null",
    }),
    overallScore: integer("overall_score").notNull(),
    rubricJson: jsonb("rubric_json")
      .$type<Array<Record<string, unknown>>>()
      .notNull()
      .default([]),
    strengths: jsonb("strengths").$type<string[]>().notNull().default([]),
    weaknesses: jsonb("weaknesses").$type<string[]>().notNull().default([]),
    recommendedActions: jsonb("recommended_actions")
      .$type<string[]>()
      .notNull()
      .default([]),
    missingEvidenceQuestions: jsonb("missing_evidence_questions")
      .$type<string[]>()
      .notNull()
      .default([]),
    riskFlags: jsonb("risk_flags").$type<string[]>().notNull().default([]),
    status: resumeReviewStatusEnum("status").notNull().default("ready"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    resumeUpdatedIdx: index("resume_review_reports_resume_updated_idx").on(
      table.resumeSourceVersionId,
      table.updatedAt,
    ),
    workflowRunIdx: index("resume_review_reports_workflow_run_idx").on(
      table.workflowRunId,
    ),
    workspaceUpdatedIdx: index("resume_review_reports_workspace_updated_idx").on(
      table.workspaceId,
      table.updatedAt,
    ),
  }),
);

export const resumeVersions = pgTable(
  "resume_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 240 }).notNull(),
    resumeJson: jsonb("resume_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    resumeMarkdown: text("resume_markdown").notNull(),
    missingEvidenceQuestions: jsonb("missing_evidence_questions")
      .$type<string[]>()
      .notNull()
      .default([]),
    version: integer("version").notNull().default(1),
    status: resumeStatusEnum("status").notNull().default("unvalidated"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    workspaceUpdatedIdx: index("resume_versions_workspace_updated_idx").on(
      table.workspaceId,
      table.updatedAt,
    ),
    jobUpdatedIdx: index("resume_versions_job_updated_idx").on(
      table.jobId,
      table.updatedAt,
    ),
  }),
);

export const mainResumeVersions = pgTable(
  "main_resume_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    workflowRunId: uuid("workflow_run_id").references(() => workflowRuns.id, {
      onDelete: "set null",
    }),
    positioningReportId: uuid("positioning_report_id").references(
      () => profilePositioningReports.id,
      { onDelete: "set null" },
    ),
    positioningDirectionId: varchar("positioning_direction_id", { length: 120 }),
    positioningTitle: varchar("positioning_title", { length: 240 }),
    generationMode: varchar("generation_mode", { length: 40 })
      .$type<"main_resume" | "positioning_variant" | "resume_refresh">()
      .notNull()
      .default("main_resume"),
    refreshSourceResumeId: uuid("refresh_source_resume_id").references(
      () => resumeSourceVersions.id,
      { onDelete: "set null" },
    ),
    refreshMode: varchar("refresh_mode", { length: 40 }).$type<
      "conservative_update" | "balanced_rewrite" | "strategic_reposition"
    >(),
    refreshStyleConstraints: jsonb("refresh_style_constraints")
      .$type<Record<string, unknown> | null>()
      .default(null),
    title: varchar("title", { length: 240 }).notNull(),
    resumeJson: jsonb("resume_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    resumeMarkdown: text("resume_markdown").notNull(),
    missingEvidenceQuestions: jsonb("missing_evidence_questions")
      .$type<string[]>()
      .notNull()
      .default([]),
    version: integer("version").notNull().default(1),
    status: resumeStatusEnum("status").notNull().default("unvalidated"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    workspaceUpdatedIdx: index("main_resume_versions_workspace_updated_idx").on(
      table.workspaceId,
      table.updatedAt,
    ),
    workflowRunIdx: index("main_resume_versions_workflow_run_idx").on(
      table.workflowRunId,
    ),
    positioningIdx: index("main_resume_versions_positioning_idx").on(
      table.positioningReportId,
      table.positioningDirectionId,
    ),
    refreshSourceIdx: index("main_resume_versions_refresh_source_idx").on(
      table.refreshSourceResumeId,
    ),
  }),
);

export const profilePositioningReports = pgTable(
  "profile_positioning_reports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id").references(() => profiles.id, {
      onDelete: "set null",
    }),
    workflowRunId: uuid("workflow_run_id").references(() => workflowRuns.id, {
      onDelete: "set null",
    }),
    status: workflowStatusEnum("status").notNull().default("succeeded"),
    reportJson: jsonb("report_json")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    evidenceSnapshotHash: varchar("evidence_snapshot_hash", { length: 128 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    workspaceUpdatedIdx: index("profile_positioning_reports_workspace_updated_idx").on(
      table.workspaceId,
      table.updatedAt,
    ),
    workflowRunIdx: index("profile_positioning_reports_workflow_run_idx").on(
      table.workflowRunId,
    ),
  }),
);

export const generatedClaims = pgTable(
  "generated_claims",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    generatedDocumentId: uuid("generated_document_id").references(
      () => resumeVersions.id,
      { onDelete: "cascade" },
    ),
    resumeVersionId: uuid("resume_version_id").references(
      () => resumeVersions.id,
      { onDelete: "cascade" },
    ),
    mainResumeVersionId: uuid("main_resume_version_id").references(
      () => mainResumeVersions.id,
      { onDelete: "cascade" },
    ),
    claimText: text("claim_text").notNull(),
    section: varchar("section", { length: 120 }).notNull(),
    evidenceIds: jsonb("evidence_ids").$type<string[]>().notNull().default([]),
    sourceQuotes: jsonb("source_quotes").$type<string[]>().notNull().default([]),
    supportStatus: claimSupportStatusEnum("support_status")
      .notNull()
      .default("unvalidated"),
    claimStatus: claimStatusEnum("claim_status").notNull().default("unvalidated"),
    riskLevel: claimRiskLevelEnum("risk_level").notNull().default("low"),
    staleReason: text("stale_reason"),
    lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    resumeIdx: index("generated_claims_resume_idx").on(table.resumeVersionId),
    mainResumeIdx: index("generated_claims_main_resume_idx").on(
      table.mainResumeVersionId,
    ),
    workspaceCreatedIdx: index("generated_claims_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
  }),
);

export const enrichmentTasks = pgTable(
  "enrichment_tasks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    taskType: enrichmentTaskTypeEnum("task_type").notNull(),
    status: enrichmentTaskStatusEnum("status").notNull().default("open"),
    sourceType: enrichmentTaskSourceTypeEnum("source_type").notNull(),
    sourceLabel: varchar("source_label", { length: 240 }).notNull(),
    prompt: text("prompt").notNull(),
    userAnswer: text("user_answer"),
    dedupeKey: varchar("dedupe_key", { length: 320 }).notNull(),
    targetScope: enrichmentTaskTargetScopeEnum("target_scope")
      .notNull()
      .default("assign_later"),
    targetConfidence: enrichmentTaskTargetConfidenceEnum("target_confidence")
      .notNull()
      .default("low"),
    targetReason: text("target_reason"),
    expectedOutcome: enrichmentTaskExpectedOutcomeEnum("expected_outcome")
      .notNull()
      .default("clarify_assignment"),
    noteKind: enrichmentTaskNoteKindEnum("note_kind"),
    expectedAction: enrichmentTaskExpectedActionEnum("expected_action"),
    targetField: varchar("target_field", { length: 120 }),
    evidenceItemId: uuid("evidence_item_id").references(() => evidenceItems.id, {
      onDelete: "set null",
    }),
    workExperienceId: uuid("work_experience_id").references(() => workExperiences.id, {
      onDelete: "set null",
    }),
    initiativeId: uuid("initiative_id").references(() => initiatives.id, {
      onDelete: "set null",
    }),
    portfolioProjectId: uuid("portfolio_project_id").references(
      () => portfolioProjects.id,
      { onDelete: "set null" },
    ),
    resumeSourceVersionId: uuid("resume_source_version_id").references(
      () => resumeSourceVersions.id,
      { onDelete: "set null" },
    ),
    resumeReviewReportId: uuid("resume_review_report_id").references(
      () => resumeReviewReports.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    convertedAt: timestamp("converted_at", { withTimezone: true }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolutionKind: enrichmentTaskResolutionKindEnum("resolution_kind"),
  },
  (table) => ({
    workspaceStatusIdx: index("enrichment_tasks_workspace_status_idx").on(
      table.workspaceId,
      table.status,
      table.updatedAt,
    ),
    uniqueDedupeIdx: uniqueIndex("enrichment_tasks_workspace_dedupe_idx").on(
      table.workspaceId,
      table.dedupeKey,
    ),
  }),
);

export const enrichmentTaskTargets = pgTable(
  "enrichment_task_targets",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => enrichmentTasks.id, { onDelete: "cascade" }),
    targetKind: enrichmentTaskTargetKindEnum("target_kind").notNull(),
    targetId: uuid("target_id").notNull(),
    targetRole: enrichmentTaskTargetRoleEnum("target_role").notNull().default("primary"),
    confidence: enrichmentTaskTargetConfidenceEnum("confidence").notNull().default("medium"),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    taskRoleIdx: index("enrichment_task_targets_task_role_idx").on(
      table.taskId,
      table.targetRole,
    ),
    workspaceKindIdx: index("enrichment_task_targets_workspace_kind_idx").on(
      table.workspaceId,
      table.targetKind,
      table.targetId,
    ),
    uniqueTaskTargetIdx: uniqueIndex("enrichment_task_targets_unique_idx").on(
      table.taskId,
      table.targetKind,
      table.targetId,
      table.targetRole,
    ),
  }),
);

export const enrichmentAnswers = pgTable(
  "enrichment_answers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => enrichmentTasks.id, { onDelete: "cascade" }),
    answerText: text("answer_text").notNull(),
    answerStatus: enrichmentAnswerStatusEnum("answer_status")
      .notNull()
      .default("submitted"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    taskStatusIdx: index("enrichment_answers_task_status_idx").on(
      table.taskId,
      table.answerStatus,
      table.createdAt,
    ),
    workspaceUpdatedIdx: index("enrichment_answers_workspace_updated_idx").on(
      table.workspaceId,
      table.updatedAt,
    ),
  }),
);

export const enrichmentProposals = pgTable(
  "enrichment_proposals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => enrichmentTasks.id, { onDelete: "cascade" }),
    answerId: uuid("answer_id").references(() => enrichmentAnswers.id, {
      onDelete: "set null",
    }),
    proposalType: enrichmentProposalTypeEnum("proposal_type").notNull(),
    targetKind: enrichmentTaskTargetKindEnum("target_kind"),
    targetId: uuid("target_id"),
    proposedPatchJson: jsonb("proposed_patch_json")
      .$type<Record<string, unknown>>()
      .notNull(),
    evidenceDeltaJson: jsonb("evidence_delta_json").$type<Record<string, unknown>>(),
    schemaVersion: varchar("schema_version", { length: 80 })
      .notNull()
      .default("enrichment-proposal-v1"),
    status: enrichmentProposalStatusEnum("status").notNull().default("pending_review"),
    committedEvidenceItemId: uuid("committed_evidence_item_id").references(
      () => evidenceItems.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (table) => ({
    taskStatusIdx: index("enrichment_proposals_task_status_idx").on(
      table.taskId,
      table.status,
      table.updatedAt,
    ),
    workspaceStatusIdx: index("enrichment_proposals_workspace_status_idx").on(
      table.workspaceId,
      table.status,
      table.updatedAt,
    ),
  }),
);

export const enrichmentProposalRevisions = pgTable(
  "enrichment_proposal_revisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => enrichmentTasks.id, { onDelete: "cascade" }),
    proposalId: uuid("proposal_id").references(() => enrichmentProposals.id, {
      onDelete: "set null",
    }),
    nextProposalId: uuid("next_proposal_id").references(() => enrichmentProposals.id, {
      onDelete: "set null",
    }),
    actor: enrichmentProposalRevisionActorEnum("actor").notNull(),
    mode: enrichmentProposalRevisionModeEnum("mode").notNull(),
    instruction: text("instruction"),
    previousText: text("previous_text").notNull(),
    revisedText: text("revised_text").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    taskCreatedIdx: index("enrichment_proposal_revisions_task_created_idx").on(
      table.taskId,
      table.createdAt,
    ),
    proposalCreatedIdx: index("enrichment_proposal_revisions_proposal_created_idx").on(
      table.proposalId,
      table.createdAt,
    ),
    workspaceCreatedIdx: index("enrichment_proposal_revisions_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt,
    ),
  }),
);

export const embeddings = pgTable(
  "embeddings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    indexType: varchar("index_type", { length: 80 }).notNull(),
    sourceEntityType: varchar("source_entity_type", { length: 80 }).notNull(),
    sourceEntityId: uuid("source_entity_id").notNull(),
    chunkText: text("chunk_text").notNull(),
    embeddingModel: varchar("embedding_model", { length: 120 }).notNull(),
    vectorDimensions: integer("vector_dimensions").notNull(),
    vectorJson: jsonb("vector_json").$type<number[]>().notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    workspaceIndexIdx: index("embeddings_workspace_index_idx").on(
      table.workspaceId,
      table.indexType,
    ),
    sourceIdx: index("embeddings_source_idx").on(
      table.sourceEntityType,
      table.sourceEntityId,
    ),
  }),
);

export const interviewPrepPacks = pgTable(
  "interview_prep_packs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 240 }).notNull(),
    prepJson: jsonb("prep_json").$type<Record<string, unknown>>().notNull().default({}),
    behavioralQuestions: jsonb("behavioral_questions")
      .$type<Array<Record<string, unknown>>>()
      .notNull()
      .default([]),
    technicalReviewTopics: jsonb("technical_review_topics")
      .$type<Array<Record<string, unknown>>>()
      .notNull()
      .default([]),
    companyResearchPrompts: jsonb("company_research_prompts")
      .$type<string[]>()
      .notNull()
      .default([]),
    practicePlan: jsonb("practice_plan").$type<string[]>().notNull().default([]),
    evidenceGaps: jsonb("evidence_gaps").$type<string[]>().notNull().default([]),
    status: interviewPrepStatusEnum("status").notNull().default("ready"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    workspaceUpdatedIdx: index("interview_prep_packs_workspace_updated_idx").on(
      table.workspaceId,
      table.updatedAt,
    ),
    jobUpdatedIdx: index("interview_prep_packs_job_updated_idx").on(
      table.jobId,
      table.updatedAt,
    ),
  }),
);

export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    workflowType: varchar("workflow_type", { length: 80 }).notNull(),
    status: workflowStatusEnum("status").notNull(),
    provider: varchar("provider", { length: 80 }),
    model: varchar("model", { length: 128 }),
    skillId: varchar("skill_id", { length: 120 }),
    skillVersion: varchar("skill_version", { length: 40 }),
    promptVersion: varchar("prompt_version", { length: 120 }),
    schemaName: varchar("schema_name", { length: 120 }),
    schemaVersion: varchar("schema_version", { length: 40 }),
    modelTier: varchar("model_tier", { length: 40 }),
    skillMetadata: jsonb("skill_metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    totalTokens: integer("total_tokens"),
    retryCount: integer("retry_count").notNull().default(0),
    errorKind: varchar("error_kind", { length: 80 }),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => ({
    workspaceStartedIdx: index("workflow_runs_workspace_started_idx").on(
      table.workspaceId,
      table.startedAt,
    ),
  }),
);

export const userRelations = relations(users, ({ many }) => ({
  sessions: many(userSessions),
  workspaces: many(workspaces),
}));

export const userSessionRelations = relations(userSessions, ({ one }) => ({
  user: one(users, {
    fields: [userSessions.userId],
    references: [users.id],
  }),
}));

export const workspaceRelations = relations(workspaces, ({ many, one }) => ({
  user: one(users, {
    fields: [workspaces.userId],
    references: [users.id],
  }),
  sourceDocuments: many(sourceDocuments),
  jobs: many(jobs),
  profiles: many(profiles),
  evidenceItems: many(evidenceItems),
  projectCards: many(projectCards),
  overlapReviewDecisions: many(overlapReviewDecisions),
  resumeSourceVersions: many(resumeSourceVersions),
  resumeReviewReports: many(resumeReviewReports),
  resumeVersions: many(resumeVersions),
  mainResumeVersions: many(mainResumeVersions),
  profilePositioningReports: many(profilePositioningReports),
  generatedClaims: many(generatedClaims),
  enrichmentTasks: many(enrichmentTasks),
  enrichmentTaskTargets: many(enrichmentTaskTargets),
  enrichmentAnswers: many(enrichmentAnswers),
  enrichmentProposals: many(enrichmentProposals),
  embeddings: many(embeddings),
  interviewPrepPacks: many(interviewPrepPacks),
  workflowRuns: many(workflowRuns),
}));

export const sourceDocumentRelations = relations(sourceDocuments, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [sourceDocuments.workspaceId],
    references: [workspaces.id],
  }),
}));

export const resumeSourceVersionRelations = relations(
  resumeSourceVersions,
  ({ many, one }) => ({
    workspace: one(workspaces, {
      fields: [resumeSourceVersions.workspaceId],
      references: [workspaces.id],
    }),
    sourceDocument: one(sourceDocuments, {
      fields: [resumeSourceVersions.sourceDocumentId],
      references: [sourceDocuments.id],
    }),
    reports: many(resumeReviewReports),
  }),
);

export const resumeReviewReportRelations = relations(
  resumeReviewReports,
  ({ many, one }) => ({
    workspace: one(workspaces, {
      fields: [resumeReviewReports.workspaceId],
      references: [workspaces.id],
    }),
    resumeSourceVersion: one(resumeSourceVersions, {
      fields: [resumeReviewReports.resumeSourceVersionId],
      references: [resumeSourceVersions.id],
    }),
    enrichmentTasks: many(enrichmentTasks),
  }),
);

export const jobRelations = relations(jobs, ({ many, one }) => ({
  workspace: one(workspaces, {
    fields: [jobs.workspaceId],
    references: [workspaces.id],
  }),
  requirements: many(jobRequirements),
  resumeVersions: many(resumeVersions),
}));

export const jobRequirementRelations = relations(jobRequirements, ({ one }) => ({
  job: one(jobs, {
    fields: [jobRequirements.jobId],
    references: [jobs.id],
  }),
}));

export const resumeVersionRelations = relations(resumeVersions, ({ many, one }) => ({
  workspace: one(workspaces, {
    fields: [resumeVersions.workspaceId],
    references: [workspaces.id],
  }),
  job: one(jobs, {
    fields: [resumeVersions.jobId],
    references: [jobs.id],
  }),
  claims: many(generatedClaims),
}));

export const mainResumeVersionRelations = relations(
  mainResumeVersions,
  ({ many, one }) => ({
    workspace: one(workspaces, {
      fields: [mainResumeVersions.workspaceId],
      references: [workspaces.id],
    }),
    workflowRun: one(workflowRuns, {
      fields: [mainResumeVersions.workflowRunId],
      references: [workflowRuns.id],
    }),
    positioningReport: one(profilePositioningReports, {
      fields: [mainResumeVersions.positioningReportId],
      references: [profilePositioningReports.id],
    }),
    refreshSourceResume: one(resumeSourceVersions, {
      fields: [mainResumeVersions.refreshSourceResumeId],
      references: [resumeSourceVersions.id],
    }),
    claims: many(generatedClaims),
  }),
);

export const profilePositioningReportRelations = relations(
  profilePositioningReports,
  ({ many, one }) => ({
    workspace: one(workspaces, {
      fields: [profilePositioningReports.workspaceId],
      references: [workspaces.id],
    }),
    profile: one(profiles, {
      fields: [profilePositioningReports.profileId],
      references: [profiles.id],
    }),
    workflowRun: one(workflowRuns, {
      fields: [profilePositioningReports.workflowRunId],
      references: [workflowRuns.id],
    }),
    mainResumeVersions: many(mainResumeVersions),
  }),
);

export const generatedClaimRelations = relations(generatedClaims, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [generatedClaims.workspaceId],
    references: [workspaces.id],
  }),
  resumeVersion: one(resumeVersions, {
    fields: [generatedClaims.resumeVersionId],
    references: [resumeVersions.id],
  }),
  mainResumeVersion: one(mainResumeVersions, {
    fields: [generatedClaims.mainResumeVersionId],
    references: [mainResumeVersions.id],
  }),
}));

export const enrichmentTaskRelations = relations(enrichmentTasks, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [enrichmentTasks.workspaceId],
    references: [workspaces.id],
  }),
  evidenceItem: one(evidenceItems, {
    fields: [enrichmentTasks.evidenceItemId],
    references: [evidenceItems.id],
  }),
  workExperience: one(workExperiences, {
    fields: [enrichmentTasks.workExperienceId],
    references: [workExperiences.id],
  }),
  initiative: one(initiatives, {
    fields: [enrichmentTasks.initiativeId],
    references: [initiatives.id],
  }),
  portfolioProject: one(portfolioProjects, {
    fields: [enrichmentTasks.portfolioProjectId],
    references: [portfolioProjects.id],
  }),
  resumeSourceVersion: one(resumeSourceVersions, {
    fields: [enrichmentTasks.resumeSourceVersionId],
    references: [resumeSourceVersions.id],
  }),
  resumeReviewReport: one(resumeReviewReports, {
    fields: [enrichmentTasks.resumeReviewReportId],
    references: [resumeReviewReports.id],
  }),
  answers: many(enrichmentAnswers),
  proposals: many(enrichmentProposals),
  proposalRevisions: many(enrichmentProposalRevisions),
}));

export const enrichmentTaskTargetRelations = relations(enrichmentTaskTargets, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [enrichmentTaskTargets.workspaceId],
    references: [workspaces.id],
  }),
  task: one(enrichmentTasks, {
    fields: [enrichmentTaskTargets.taskId],
    references: [enrichmentTasks.id],
  }),
}));

export const enrichmentAnswerRelations = relations(enrichmentAnswers, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [enrichmentAnswers.workspaceId],
    references: [workspaces.id],
  }),
  task: one(enrichmentTasks, {
    fields: [enrichmentAnswers.taskId],
    references: [enrichmentTasks.id],
  }),
  proposals: many(enrichmentProposals),
}));

export const enrichmentProposalRelations = relations(enrichmentProposals, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [enrichmentProposals.workspaceId],
    references: [workspaces.id],
  }),
  task: one(enrichmentTasks, {
    fields: [enrichmentProposals.taskId],
    references: [enrichmentTasks.id],
  }),
  answer: one(enrichmentAnswers, {
    fields: [enrichmentProposals.answerId],
    references: [enrichmentAnswers.id],
  }),
  committedEvidenceItem: one(evidenceItems, {
    fields: [enrichmentProposals.committedEvidenceItemId],
    references: [evidenceItems.id],
  }),
  revisions: many(enrichmentProposalRevisions),
  nextRevisions: many(enrichmentProposalRevisions, {
    relationName: "nextProposalRevisions",
  }),
}));

export const enrichmentProposalRevisionRelations = relations(
  enrichmentProposalRevisions,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [enrichmentProposalRevisions.workspaceId],
      references: [workspaces.id],
    }),
    task: one(enrichmentTasks, {
      fields: [enrichmentProposalRevisions.taskId],
      references: [enrichmentTasks.id],
    }),
    proposal: one(enrichmentProposals, {
      fields: [enrichmentProposalRevisions.proposalId],
      references: [enrichmentProposals.id],
    }),
    nextProposal: one(enrichmentProposals, {
      fields: [enrichmentProposalRevisions.nextProposalId],
      references: [enrichmentProposals.id],
      relationName: "nextProposalRevisions",
    }),
  }),
);

export const embeddingRelations = relations(embeddings, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [embeddings.workspaceId],
    references: [workspaces.id],
  }),
}));

export const interviewPrepPackRelations = relations(
  interviewPrepPacks,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [interviewPrepPacks.workspaceId],
      references: [workspaces.id],
    }),
    job: one(jobs, {
      fields: [interviewPrepPacks.jobId],
      references: [jobs.id],
    }),
  }),
);
