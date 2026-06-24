DO $$ BEGIN
  CREATE TYPE "public"."profile_context_type" AS ENUM(
    'target_role_preference',
    'skills_to_emphasize',
    'skills_to_avoid',
    'positioning_preference',
    'location_preference',
    'work_style_preference',
    'general_preference'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."profile_context_status" AS ENUM(
    'active',
    'archived'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "profile_context_answers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "source_task_id" uuid,
  "source_answer_id" uuid,
  "context_type" "profile_context_type" DEFAULT 'general_preference' NOT NULL,
  "answer_text" text NOT NULL,
  "normalized_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" "profile_context_status" DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "profile_context_answers"
  ADD CONSTRAINT "profile_context_answers_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_context_answers"
  ADD CONSTRAINT "profile_context_answers_source_task_id_enrichment_tasks_id_fk"
  FOREIGN KEY ("source_task_id") REFERENCES "public"."enrichment_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_context_answers"
  ADD CONSTRAINT "profile_context_answers_source_answer_id_enrichment_answers_id_fk"
  FOREIGN KEY ("source_answer_id") REFERENCES "public"."enrichment_answers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "profile_context_answers_task_idx"
  ON "profile_context_answers" USING btree ("source_task_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "profile_context_answers_workspace_type_idx"
  ON "profile_context_answers" USING btree ("workspace_id","context_type","status","updated_at");--> statement-breakpoint
INSERT INTO "profile_context_answers" (
  "workspace_id",
  "source_task_id",
  "source_answer_id",
  "context_type",
  "answer_text",
  "normalized_tags",
  "status",
  "created_at",
  "updated_at"
)
SELECT
  "enrichment_tasks"."workspace_id",
  "enrichment_tasks"."id",
  latest_answer."id",
  CASE
    WHEN "prompt" ~* '(avoid|deprioritize|not emphasize)' AND "prompt" ~* '(skill|technology|technique)' THEN 'skills_to_avoid'::"profile_context_type"
    WHEN "prompt" ~* '(skill|technology|technique|technical)' THEN 'skills_to_emphasize'::"profile_context_type"
    WHEN "prompt" ~* '(location|remote|hybrid|onsite|work style)' THEN 'work_style_preference'::"profile_context_type"
    WHEN "prompt" ~* '(target role|future role|role direction|career direction)' THEN 'target_role_preference'::"profile_context_type"
    WHEN "prompt" ~* '(positioning|emphasize|highlight|focus)' THEN 'positioning_preference'::"profile_context_type"
    ELSE 'general_preference'::"profile_context_type"
  END,
  trim("user_answer"),
  '[]'::jsonb,
  'active'::"profile_context_status",
  COALESCE("answered_at", "created_at", now()),
  COALESCE("updated_at", "answered_at", now())
FROM "enrichment_tasks"
LEFT JOIN LATERAL (
  SELECT "id"
  FROM "enrichment_answers"
  WHERE
    "enrichment_answers"."task_id" = "enrichment_tasks"."id"
    AND trim("enrichment_answers"."answer_text") = trim("enrichment_tasks"."user_answer")
  ORDER BY "enrichment_answers"."updated_at" DESC, "enrichment_answers"."created_at" DESC
  LIMIT 1
) latest_answer ON true
WHERE
  "expected_outcome" = 'save_profile_answer'::"enrichment_task_expected_outcome"
  AND "user_answer" IS NOT NULL
  AND length(trim("user_answer")) > 0
  AND NOT EXISTS (
    SELECT 1
    FROM "profile_context_answers"
    WHERE "profile_context_answers"."source_task_id" = "enrichment_tasks"."id"
  );
