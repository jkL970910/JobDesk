import { relations } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

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
    needsUserConfirmation: integer("needs_user_confirmation").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
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
  resumeVersions: many(resumeVersions),
  generatedClaims: many(generatedClaims),
  workflowRuns: many(workflowRuns),
}));

export const sourceDocumentRelations = relations(sourceDocuments, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [sourceDocuments.workspaceId],
    references: [workspaces.id],
  }),
}));

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
