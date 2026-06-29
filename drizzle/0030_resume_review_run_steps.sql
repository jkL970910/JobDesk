DO $$ BEGIN
 CREATE TYPE "public"."resume_review_run_step_status" AS ENUM(
  'pending',
  'processing',
  'completed',
  'failed'
 );
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "resume_review_run_steps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "workflow_run_id" uuid NOT NULL,
  "resume_source_version_id" uuid NOT NULL,
  "step_key" varchar(120) NOT NULL,
  "step_kind" varchar(80) NOT NULL,
  "sequence" integer NOT NULL,
  "title" varchar(240) NOT NULL,
  "input_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "result_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" "resume_review_run_step_status" DEFAULT 'pending' NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "locked_at" timestamp with time zone,
  "locked_by" varchar(120),
  "lock_expires_at" timestamp with time zone,
  "failure_kind" varchar(80),
  "failure_message" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resume_review_run_steps" ADD CONSTRAINT "resume_review_run_steps_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resume_review_run_steps" ADD CONSTRAINT "resume_review_run_steps_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "resume_review_run_steps" ADD CONSTRAINT "resume_review_run_steps_resume_source_version_id_resume_source_versions_id_fk" FOREIGN KEY ("resume_source_version_id") REFERENCES "public"."resume_source_versions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resume_review_run_steps_run_sequence_idx" ON "resume_review_run_steps" USING btree ("workflow_run_id","sequence");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "resume_review_run_steps_status_updated_idx" ON "resume_review_run_steps" USING btree ("status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "resume_review_run_steps_workspace_run_step_key_idx" ON "resume_review_run_steps" USING btree ("workspace_id","workflow_run_id","step_key");
