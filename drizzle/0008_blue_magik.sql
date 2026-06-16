CREATE TYPE "public"."resume_review_status" AS ENUM('ready', 'stale');--> statement-breakpoint
CREATE TYPE "public"."resume_source_status" AS ENUM('uploaded', 'reviewed', 'extracted', 'archived');--> statement-breakpoint
CREATE TABLE "resume_review_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"resume_source_version_id" uuid NOT NULL,
	"overall_score" integer NOT NULL,
	"rubric_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"strengths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"weaknesses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recommended_actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"missing_evidence_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"risk_flags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "resume_review_status" DEFAULT 'ready' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resume_source_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_document_id" uuid NOT NULL,
	"title" varchar(240) NOT NULL,
	"content_hash" varchar(128) NOT NULL,
	"source_kind" varchar(40) NOT NULL,
	"source_text" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" "resume_source_status" DEFAULT 'uploaded' NOT NULL,
	"last_reviewed_at" timestamp with time zone,
	"extracted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "resume_review_reports" ADD CONSTRAINT "resume_review_reports_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_review_reports" ADD CONSTRAINT "resume_review_reports_resume_source_version_id_resume_source_versions_id_fk" FOREIGN KEY ("resume_source_version_id") REFERENCES "public"."resume_source_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_source_versions" ADD CONSTRAINT "resume_source_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_source_versions" ADD CONSTRAINT "resume_source_versions_source_document_id_source_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "resume_review_reports_resume_updated_idx" ON "resume_review_reports" USING btree ("resume_source_version_id","updated_at");--> statement-breakpoint
CREATE INDEX "resume_review_reports_workspace_updated_idx" ON "resume_review_reports" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "resume_source_versions_workspace_updated_idx" ON "resume_source_versions" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "resume_source_versions_workspace_hash_idx" ON "resume_source_versions" USING btree ("workspace_id","content_hash");