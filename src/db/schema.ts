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
export const portfolioProjectTypeEnum = pgEnum("portfolio_project_type", [
  "personal_project",
  "academic_project",
  "open_source",
  "freelance",
  "hackathon",
  "general_project",
]);

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").defaultRandom().primaryKey(),
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
    contentText: text("content_text").notNull(),
    contentHash: varchar("content_hash", { length: 128 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    workspaceCreatedIdx: index("source_documents_workspace_created_idx").on(
      table.workspaceId,
      table.createdAt,
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
    workspaceCreatedIdx: index("generated_claims_workspace_created_idx").on(
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

export const workspaceRelations = relations(workspaces, ({ many }) => ({
  sourceDocuments: many(sourceDocuments),
  jobs: many(jobs),
  profiles: many(profiles),
  evidenceItems: many(evidenceItems),
  projectCards: many(projectCards),
  overlapReviewDecisions: many(overlapReviewDecisions),
  resumeSourceVersions: many(resumeSourceVersions),
  resumeReviewReports: many(resumeReviewReports),
  resumeVersions: many(resumeVersions),
  generatedClaims: many(generatedClaims),
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
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [resumeReviewReports.workspaceId],
      references: [workspaces.id],
    }),
    resumeSourceVersion: one(resumeSourceVersions, {
      fields: [resumeReviewReports.resumeSourceVersionId],
      references: [resumeSourceVersions.id],
    }),
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

export const generatedClaimRelations = relations(generatedClaims, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [generatedClaims.workspaceId],
    references: [workspaces.id],
  }),
  resumeVersion: one(resumeVersions, {
    fields: [generatedClaims.resumeVersionId],
    references: [resumeVersions.id],
  }),
}));

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
