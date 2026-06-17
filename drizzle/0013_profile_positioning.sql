CREATE TABLE "profile_positioning_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"profile_id" uuid,
	"workflow_run_id" uuid,
	"status" "workflow_status" DEFAULT 'succeeded' NOT NULL,
	"report_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"evidence_snapshot_hash" varchar(128),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "main_resume_versions" ADD COLUMN "positioning_report_id" uuid;--> statement-breakpoint
ALTER TABLE "main_resume_versions" ADD COLUMN "positioning_direction_id" varchar(120);--> statement-breakpoint
ALTER TABLE "main_resume_versions" ADD COLUMN "positioning_title" varchar(240);--> statement-breakpoint
ALTER TABLE "profile_positioning_reports" ADD CONSTRAINT "profile_positioning_reports_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_positioning_reports" ADD CONSTRAINT "profile_positioning_reports_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_positioning_reports" ADD CONSTRAINT "profile_positioning_reports_workflow_run_id_workflow_runs_id_fk" FOREIGN KEY ("workflow_run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "main_resume_versions" ADD CONSTRAINT "main_resume_versions_positioning_report_id_profile_positioning_reports_id_fk" FOREIGN KEY ("positioning_report_id") REFERENCES "public"."profile_positioning_reports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "profile_positioning_reports_workspace_updated_idx" ON "profile_positioning_reports" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "profile_positioning_reports_workflow_run_idx" ON "profile_positioning_reports" USING btree ("workflow_run_id");--> statement-breakpoint
CREATE INDEX "main_resume_versions_positioning_idx" ON "main_resume_versions" USING btree ("positioning_report_id","positioning_direction_id");
