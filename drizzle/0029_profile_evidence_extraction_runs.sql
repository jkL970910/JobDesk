DO $$ BEGIN
 CREATE TYPE "public"."profile_evidence_extraction_run_status" AS ENUM(
  'queued',
  'parsing',
  'segmenting',
  'extracting_profile',
  'extracting_evidence',
  'validating',
  'saving',
  'completed',
  'failed'
 );
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "profile_evidence_extraction_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "source_document_id" uuid,
  "resume_source_version_id" uuid,
  "workflow_run_id" uuid,
  "source_type" varchar(40) NOT NULL,
  "source_title" varchar(240) NOT NULL,
  "source_text_snapshot" text,
  "source_snapshot_hash" varchar(128) NOT NULL,
  "status" "profile_evidence_extraction_run_status" DEFAULT 'queued' NOT NULL,
  "result_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "failure_kind" varchar(80),
  "failure_message" text,
  "can_retry" integer DEFAULT 0 NOT NULL,
  "retry_after_seconds" integer,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "locked_at" timestamp with time zone,
  "locked_by" varchar(120),
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "failed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "profile_evidence_extraction_runs" ADD CONSTRAINT "profile_evidence_extraction_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "profile_evidence_extraction_runs" ADD CONSTRAINT "profile_evidence_extraction_runs_source_document_id_source_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_documents"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "profile_evidence_extraction_runs" ADD CONSTRAINT "profile_evidence_extraction_runs_resume_source_version_id_resume_source_versions_id_fk" FOREIGN KEY ("resume_source_version_id") REFERENCES "public"."resume_source_versions"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "profile_evidence_extraction_runs" ADD CONSTRAINT "profile_evidence_extraction_runs_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "profile_evidence_extraction_runs_status_updated_idx" ON "profile_evidence_extraction_runs" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "profile_evidence_extraction_runs_workspace_created_idx" ON "profile_evidence_extraction_runs" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "profile_evidence_extraction_runs_source_hash_idx" ON "profile_evidence_extraction_runs" USING btree ("workspace_id","source_snapshot_hash");
