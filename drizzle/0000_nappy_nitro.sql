CREATE TYPE "public"."requirement_type" AS ENUM('hard', 'soft');--> statement-breakpoint
CREATE TYPE "public"."workflow_status" AS ENUM('running', 'succeeded', 'failed', 'skipped');--> statement-breakpoint
CREATE TABLE "job_requirements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"text" text NOT NULL,
	"source_quote" text NOT NULL,
	"requirement_type" "requirement_type" NOT NULL,
	"importance" integer NOT NULL,
	"keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"verified" integer DEFAULT 0 NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_document_id" uuid,
	"title" varchar(240) NOT NULL,
	"original_jd_text" text NOT NULL,
	"role_signals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"keywords" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"interview_implications" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_analyzed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_type" varchar(40) NOT NULL,
	"title" varchar(240) NOT NULL,
	"content_text" text NOT NULL,
	"content_hash" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"job_id" uuid,
	"workflow_type" varchar(80) NOT NULL,
	"status" "workflow_status" NOT NULL,
	"provider" varchar(80),
	"model" varchar(128),
	"input_tokens" integer,
	"output_tokens" integer,
	"total_tokens" integer,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"error_kind" varchar(80),
	"error_message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_requirements" ADD CONSTRAINT "job_requirements_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_source_document_id_source_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_documents" ADD CONSTRAINT "source_documents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_requirements_job_sort_idx" ON "job_requirements" USING btree ("job_id","sort_order");--> statement-breakpoint
CREATE INDEX "jobs_workspace_updated_idx" ON "jobs" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "source_documents_workspace_created_idx" ON "source_documents" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "workflow_runs_workspace_started_idx" ON "workflow_runs" USING btree ("workspace_id","started_at");--> statement-breakpoint
CREATE INDEX "workspaces_created_idx" ON "workspaces" USING btree ("created_at");