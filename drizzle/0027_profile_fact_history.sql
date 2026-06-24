DO $$ BEGIN
  CREATE TYPE "public"."profile_fact_source_type" AS ENUM(
    'manual_edit',
    'resume_import',
    'profile_fact_task',
    'system'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "profile_fact_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "profile_id" uuid,
  "field" varchar(80) NOT NULL,
  "value_json" jsonb NOT NULL,
  "previous_value_json" jsonb,
  "source_type" "profile_fact_source_type" NOT NULL,
  "source_task_id" uuid,
  "source_document_id" uuid,
  "updated_by" varchar(80) DEFAULT 'user' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "profile_fact_history"
  ADD CONSTRAINT "profile_fact_history_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_fact_history"
  ADD CONSTRAINT "profile_fact_history_profile_id_profiles_id_fk"
  FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_fact_history"
  ADD CONSTRAINT "profile_fact_history_source_task_id_enrichment_tasks_id_fk"
  FOREIGN KEY ("source_task_id") REFERENCES "public"."enrichment_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_fact_history"
  ADD CONSTRAINT "profile_fact_history_source_document_id_source_documents_id_fk"
  FOREIGN KEY ("source_document_id") REFERENCES "public"."source_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "profile_fact_history_profile_field_idx"
  ON "profile_fact_history" USING btree ("profile_id","field","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "profile_fact_history_workspace_field_idx"
  ON "profile_fact_history" USING btree ("workspace_id","field","created_at");--> statement-breakpoint
INSERT INTO "profile_fact_history" (
  "workspace_id",
  "profile_id",
  "field",
  "value_json",
  "source_type",
  "source_document_id",
  "updated_by",
  "created_at"
)
SELECT
  "workspace_id",
  "id",
  "field",
  "value",
  CASE WHEN "source_document_id" IS NULL THEN 'system'::"profile_fact_source_type" ELSE 'resume_import'::"profile_fact_source_type" END,
  "source_document_id",
  'system',
  "created_at"
FROM "profiles"
CROSS JOIN LATERAL (
  VALUES
    ('contact', COALESCE("profile_json"->'contact', 'null'::jsonb)),
    ('education', COALESCE("profile_json"->'education', '[]'::jsonb)),
    ('skills', COALESCE("profile_json"->'skills', '[]'::jsonb)),
    ('certifications', COALESCE("profile_json"->'certifications', '[]'::jsonb))
) AS profile_fields("field", "value")
WHERE
  "value" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM "profile_fact_history"
    WHERE
      "profile_fact_history"."profile_id" = "profiles"."id"
      AND "profile_fact_history"."field" = profile_fields."field"
      AND "profile_fact_history"."created_at" = "profiles"."created_at"
  );
