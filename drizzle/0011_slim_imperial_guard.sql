CREATE TYPE "public"."enrichment_task_source_type" AS ENUM('resume_review', 'extraction_note', 'evidence', 'story_target', 'jd_gap', 'user_input');--> statement-breakpoint
CREATE TYPE "public"."enrichment_task_status" AS ENUM('open', 'answered', 'converted', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."enrichment_task_type" AS ENUM('metric', 'scope', 'ownership', 'technical_depth', 'stakeholder', 'impact', 'star', 'public_safe_wording');--> statement-breakpoint
CREATE TABLE "enrichment_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"task_type" "enrichment_task_type" NOT NULL,
	"status" "enrichment_task_status" DEFAULT 'open' NOT NULL,
	"source_type" "enrichment_task_source_type" NOT NULL,
	"source_label" varchar(240) NOT NULL,
	"prompt" text NOT NULL,
	"user_answer" text,
	"dedupe_key" varchar(320) NOT NULL,
	"evidence_item_id" uuid,
	"work_experience_id" uuid,
	"initiative_id" uuid,
	"portfolio_project_id" uuid,
	"resume_source_version_id" uuid,
	"resume_review_report_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"answered_at" timestamp with time zone,
	"converted_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "main_resume_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"workflow_run_id" uuid,
	"title" varchar(240) NOT NULL,
	"resume_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"resume_markdown" text NOT NULL,
	"missing_evidence_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" "resume_status" DEFAULT 'unvalidated' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generated_claims" ADD COLUMN "main_resume_version_id" uuid;--> statement-breakpoint
ALTER TABLE "enrichment_tasks" ADD CONSTRAINT "enrichment_tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_tasks" ADD CONSTRAINT "enrichment_tasks_evidence_item_id_evidence_items_id_fk" FOREIGN KEY ("evidence_item_id") REFERENCES "public"."evidence_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_tasks" ADD CONSTRAINT "enrichment_tasks_work_experience_id_work_experiences_id_fk" FOREIGN KEY ("work_experience_id") REFERENCES "public"."work_experiences"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_tasks" ADD CONSTRAINT "enrichment_tasks_initiative_id_initiatives_id_fk" FOREIGN KEY ("initiative_id") REFERENCES "public"."initiatives"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_tasks" ADD CONSTRAINT "enrichment_tasks_portfolio_project_id_portfolio_projects_id_fk" FOREIGN KEY ("portfolio_project_id") REFERENCES "public"."portfolio_projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_tasks" ADD CONSTRAINT "enrichment_tasks_resume_source_version_id_resume_source_versions_id_fk" FOREIGN KEY ("resume_source_version_id") REFERENCES "public"."resume_source_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_tasks" ADD CONSTRAINT "enrichment_tasks_resume_review_report_id_resume_review_reports_id_fk" FOREIGN KEY ("resume_review_report_id") REFERENCES "public"."resume_review_reports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "main_resume_versions" ADD CONSTRAINT "main_resume_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "main_resume_versions" ADD CONSTRAINT "main_resume_versions_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "enrichment_tasks_workspace_status_idx" ON "enrichment_tasks" USING btree ("workspace_id","status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "enrichment_tasks_workspace_dedupe_idx" ON "enrichment_tasks" USING btree ("workspace_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "main_resume_versions_workspace_updated_idx" ON "main_resume_versions" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "main_resume_versions_workflow_run_idx" ON "main_resume_versions" USING btree ("workflow_run_id");--> statement-breakpoint
ALTER TABLE "generated_claims" ADD CONSTRAINT "generated_claims_main_resume_version_id_main_resume_versions_id_fk" FOREIGN KEY ("main_resume_version_id") REFERENCES "public"."main_resume_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generated_claims_main_resume_idx" ON "generated_claims" USING btree ("main_resume_version_id");