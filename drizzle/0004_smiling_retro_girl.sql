CREATE TYPE "public"."claim_risk_level" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."claim_status" AS ENUM('unvalidated', 'supported', 'partially_supported', 'unsupported', 'user_confirmed', 'stale');--> statement-breakpoint
CREATE TYPE "public"."claim_support_status" AS ENUM('unvalidated', 'supported', 'partially_supported', 'unsupported', 'user_confirmed');--> statement-breakpoint
CREATE TYPE "public"."resume_status" AS ENUM('draft', 'unvalidated', 'validated', 'exported');--> statement-breakpoint
CREATE TABLE "generated_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"job_id" uuid,
	"generated_document_id" uuid,
	"resume_version_id" uuid,
	"claim_text" text NOT NULL,
	"section" varchar(120) NOT NULL,
	"evidence_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_quotes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"support_status" "claim_support_status" DEFAULT 'unvalidated' NOT NULL,
	"claim_status" "claim_status" DEFAULT 'unvalidated' NOT NULL,
	"risk_level" "claim_risk_level" DEFAULT 'low' NOT NULL,
	"stale_reason" text,
	"last_validated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resume_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
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
ALTER TABLE "generated_claims" ADD CONSTRAINT "generated_claims_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_claims" ADD CONSTRAINT "generated_claims_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_claims" ADD CONSTRAINT "generated_claims_generated_document_id_resume_versions_id_fk" FOREIGN KEY ("generated_document_id") REFERENCES "public"."resume_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_claims" ADD CONSTRAINT "generated_claims_resume_version_id_resume_versions_id_fk" FOREIGN KEY ("resume_version_id") REFERENCES "public"."resume_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_versions" ADD CONSTRAINT "resume_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resume_versions" ADD CONSTRAINT "resume_versions_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "generated_claims_resume_idx" ON "generated_claims" USING btree ("resume_version_id");--> statement-breakpoint
CREATE INDEX "generated_claims_workspace_created_idx" ON "generated_claims" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "resume_versions_workspace_updated_idx" ON "resume_versions" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "resume_versions_job_updated_idx" ON "resume_versions" USING btree ("job_id","updated_at");