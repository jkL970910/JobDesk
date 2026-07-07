CREATE TABLE "source_cleanup_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "resume_source_version_id" uuid,
  "source_document_id" uuid,
  "cleanup_mode" varchar(80) NOT NULL,
  "initiator" varchar(80) NOT NULL DEFAULT 'user',
  "dry_run" integer NOT NULL DEFAULT 0,
  "impact_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "result_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "source_cleanup_events" ADD CONSTRAINT "source_cleanup_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "source_cleanup_events" ADD CONSTRAINT "source_cleanup_events_resume_source_version_id_resume_source_versions_id_fk" FOREIGN KEY ("resume_source_version_id") REFERENCES "public"."resume_source_versions"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "source_cleanup_events" ADD CONSTRAINT "source_cleanup_events_source_document_id_source_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_documents"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "source_cleanup_events_workspace_created_idx" ON "source_cleanup_events" USING btree ("workspace_id","created_at");
--> statement-breakpoint
CREATE INDEX "source_cleanup_events_resume_source_idx" ON "source_cleanup_events" USING btree ("resume_source_version_id","created_at");
--> statement-breakpoint
CREATE INDEX "source_cleanup_events_source_document_idx" ON "source_cleanup_events" USING btree ("source_document_id","created_at");
