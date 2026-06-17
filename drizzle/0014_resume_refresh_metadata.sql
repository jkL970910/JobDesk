ALTER TABLE "main_resume_versions" ADD COLUMN "generation_mode" varchar(40) DEFAULT 'main_resume' NOT NULL;--> statement-breakpoint
ALTER TABLE "main_resume_versions" ADD COLUMN "refresh_source_resume_id" uuid;--> statement-breakpoint
ALTER TABLE "main_resume_versions" ADD COLUMN "refresh_mode" varchar(40);--> statement-breakpoint
ALTER TABLE "main_resume_versions" ADD COLUMN "refresh_style_constraints" jsonb DEFAULT NULL;--> statement-breakpoint
ALTER TABLE "main_resume_versions" ADD CONSTRAINT "main_resume_versions_refresh_source_resume_id_resume_source_versions_id_fk" FOREIGN KEY ("refresh_source_resume_id") REFERENCES "public"."resume_source_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "main_resume_versions_refresh_source_idx" ON "main_resume_versions" USING btree ("refresh_source_resume_id");
