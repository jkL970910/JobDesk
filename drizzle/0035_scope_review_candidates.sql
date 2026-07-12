CREATE TABLE "scope_review_candidates" (
  "id" varchar(96) PRIMARY KEY NOT NULL,
  "workspace_id" uuid NOT NULL,
  "task_id" uuid,
  "source_document_id" uuid,
  "source_type" varchar(40) NOT NULL,
  "source_section" text,
  "source_quote" text,
  "raw_candidate_text" text NOT NULL,
  "proposed_scope" varchar(60) NOT NULL,
  "classifier_scope" varchar(60) NOT NULL,
  "guardrail_decision" varchar(80) NOT NULL,
  "guardrail_reason" text NOT NULL,
  "confidence" "enrichment_task_target_confidence" DEFAULT 'low' NOT NULL,
  "suggested_action" varchar(80) NOT NULL,
  "status" varchar(40) DEFAULT 'open' NOT NULL,
  "resolved_as_target_id" uuid,
  "resolved_as_target_type" varchar(80),
  "resolution_payload_json" jsonb,
  "resolved_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scope_review_candidates" ADD CONSTRAINT "scope_review_candidates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "scope_review_candidates" ADD CONSTRAINT "scope_review_candidates_task_id_enrichment_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."enrichment_tasks"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "scope_review_candidates" ADD CONSTRAINT "scope_review_candidates_source_document_id_source_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_documents"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "scope_review_candidates_workspace_status_idx" ON "scope_review_candidates" USING btree ("workspace_id","status","updated_at");
--> statement-breakpoint
CREATE INDEX "scope_review_candidates_task_idx" ON "scope_review_candidates" USING btree ("task_id");
--> statement-breakpoint
CREATE INDEX "scope_review_candidates_source_document_idx" ON "scope_review_candidates" USING btree ("source_document_id");
