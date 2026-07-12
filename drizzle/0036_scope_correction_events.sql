CREATE TABLE "scope_correction_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"actor_type" varchar(40) DEFAULT 'user' NOT NULL,
	"action" varchar(80) NOT NULL,
	"entity_type" varchar(80) NOT NULL,
	"entity_id" uuid,
	"source_candidate_id" varchar(96),
	"source_task_id" uuid,
	"before_json" jsonb,
	"after_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scope_correction_events" ADD CONSTRAINT "scope_correction_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "scope_correction_events" ADD CONSTRAINT "scope_correction_events_source_candidate_id_scope_review_candidates_id_fk" FOREIGN KEY ("source_candidate_id") REFERENCES "public"."scope_review_candidates"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "scope_correction_events" ADD CONSTRAINT "scope_correction_events_source_task_id_enrichment_tasks_id_fk" FOREIGN KEY ("source_task_id") REFERENCES "public"."enrichment_tasks"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "scope_correction_events_workspace_created_idx" ON "scope_correction_events" USING btree ("workspace_id","created_at");
--> statement-breakpoint
CREATE INDEX "scope_correction_events_entity_idx" ON "scope_correction_events" USING btree ("entity_type","entity_id");
--> statement-breakpoint
CREATE INDEX "scope_correction_events_candidate_idx" ON "scope_correction_events" USING btree ("source_candidate_id");
