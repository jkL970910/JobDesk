ALTER TABLE "resume_review_reports" ADD COLUMN "workflow_run_id" uuid;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "skill_id" varchar(120);--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "skill_version" varchar(40);--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "prompt_version" varchar(120);--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "schema_name" varchar(120);--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "schema_version" varchar(40);--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "model_tier" varchar(40);--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD COLUMN "skill_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "resume_review_reports" ADD CONSTRAINT "resume_review_reports_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "resume_review_reports_workflow_run_idx" ON "resume_review_reports" USING btree ("workflow_run_id");