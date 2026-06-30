CREATE TABLE IF NOT EXISTS "generated_resume_readiness_reviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "workflow_run_id" uuid,
  "main_resume_version_id" uuid,
  "resume_version_id" uuid,
  "document_type" varchar(40) NOT NULL,
  "scope" varchar(40) NOT NULL,
  "review_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "score" integer NOT NULL,
  "verdict" varchar(60) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "generated_resume_readiness_reviews" ADD CONSTRAINT "generated_resume_readiness_reviews_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "generated_resume_readiness_reviews" ADD CONSTRAINT "generated_resume_readiness_reviews_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "generated_resume_readiness_reviews" ADD CONSTRAINT "generated_resume_readiness_reviews_main_resume_version_id_main_resume_versions_id_fk" FOREIGN KEY ("main_resume_version_id") REFERENCES "public"."main_resume_versions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "generated_resume_readiness_reviews" ADD CONSTRAINT "generated_resume_readiness_reviews_resume_version_id_resume_versions_id_fk" FOREIGN KEY ("resume_version_id") REFERENCES "public"."resume_versions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "generated_resume_readiness_workspace_created_idx" ON "generated_resume_readiness_reviews" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "generated_resume_readiness_main_resume_idx" ON "generated_resume_readiness_reviews" USING btree ("main_resume_version_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "generated_resume_readiness_tailored_resume_idx" ON "generated_resume_readiness_reviews" USING btree ("resume_version_id","created_at");
