CREATE TYPE "public"."portfolio_project_type" AS ENUM('personal_project', 'academic_project', 'open_source', 'freelance', 'hackathon', 'general_project');--> statement-breakpoint
ALTER TYPE "public"."overlap_entity_type" ADD VALUE IF NOT EXISTS 'initiative';--> statement-breakpoint
ALTER TYPE "public"."overlap_entity_type" ADD VALUE IF NOT EXISTS 'portfolio_project';--> statement-breakpoint
CREATE TABLE "initiatives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"work_experience_id" uuid,
	"source_document_id" uuid,
	"internal_title" varchar(240) NOT NULL,
	"external_safe_title" varchar(240),
	"context" text,
	"problem" text,
	"role" text,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metrics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"technologies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stakeholders" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"external_safe_summary" text,
	"sensitivity_level" "sensitivity_level" DEFAULT 'private' NOT NULL,
	"needs_redaction_review" integer DEFAULT 1 NOT NULL,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portfolio_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_document_id" uuid,
	"project_type" "portfolio_project_type" DEFAULT 'general_project' NOT NULL,
	"title" varchar(240) NOT NULL,
	"external_safe_title" varchar(240),
	"context" text,
	"problem" text,
	"role" text,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metrics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"technologies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stakeholders" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"external_safe_summary" text,
	"sensitivity_level" "sensitivity_level" DEFAULT 'private' NOT NULL,
	"needs_redaction_review" integer DEFAULT 0 NOT NULL,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_experiences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_document_id" uuid,
	"employer" varchar(240) NOT NULL,
	"role_title" varchar(240) NOT NULL,
	"team" varchar(240),
	"location" varchar(240),
	"start_date" varchar(80),
	"end_date" varchar(80),
	"summary" text,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "evidence_items" ADD COLUMN "related_work_experience_id" uuid;--> statement-breakpoint
ALTER TABLE "evidence_items" ADD COLUMN "related_initiative_id" uuid;--> statement-breakpoint
ALTER TABLE "evidence_items" ADD COLUMN "related_portfolio_project_id" uuid;--> statement-breakpoint
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_single_story_target_check" CHECK (num_nonnulls("related_work_experience_id", "related_initiative_id", "related_portfolio_project_id") <= 1);--> statement-breakpoint
ALTER TABLE "initiatives" ADD CONSTRAINT "initiatives_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiatives" ADD CONSTRAINT "initiatives_work_experience_id_work_experiences_id_fk" FOREIGN KEY ("work_experience_id") REFERENCES "public"."work_experiences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "initiatives" ADD CONSTRAINT "initiatives_source_document_id_source_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_projects" ADD CONSTRAINT "portfolio_projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_projects" ADD CONSTRAINT "portfolio_projects_source_document_id_source_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_experiences" ADD CONSTRAINT "work_experiences_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_experiences" ADD CONSTRAINT "work_experiences_source_document_id_source_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "initiatives_workspace_updated_idx" ON "initiatives" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "initiatives_work_experience_updated_idx" ON "initiatives" USING btree ("work_experience_id","updated_at");--> statement-breakpoint
CREATE INDEX "portfolio_projects_workspace_updated_idx" ON "portfolio_projects" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "work_experiences_workspace_updated_idx" ON "work_experiences" USING btree ("workspace_id","updated_at");--> statement-breakpoint
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_related_work_experience_id_work_experiences_id_fk" FOREIGN KEY ("related_work_experience_id") REFERENCES "public"."work_experiences"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_related_initiative_id_initiatives_id_fk" FOREIGN KEY ("related_initiative_id") REFERENCES "public"."initiatives"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_related_portfolio_project_id_portfolio_projects_id_fk" FOREIGN KEY ("related_portfolio_project_id") REFERENCES "public"."portfolio_projects"("id") ON DELETE set null ON UPDATE no action;
