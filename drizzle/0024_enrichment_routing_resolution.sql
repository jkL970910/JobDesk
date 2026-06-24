ALTER TYPE "public"."enrichment_task_target_scope" ADD VALUE IF NOT EXISTS 'profile_context';--> statement-breakpoint
ALTER TYPE "public"."enrichment_task_target_scope" ADD VALUE IF NOT EXISTS 'profile_fact';--> statement-breakpoint
ALTER TYPE "public"."enrichment_task_expected_outcome" ADD VALUE IF NOT EXISTS 'save_profile_answer';--> statement-breakpoint
ALTER TYPE "public"."enrichment_task_expected_outcome" ADD VALUE IF NOT EXISTS 'update_profile_fact';--> statement-breakpoint
ALTER TYPE "public"."enrichment_task_expected_outcome" ADD VALUE IF NOT EXISTS 'route_answer';--> statement-breakpoint
CREATE TYPE IF NOT EXISTS "public"."enrichment_task_resolution_kind" AS ENUM(
  'acknowledged',
  'dismissed',
  'profile_answer_saved',
  'profile_fact_updated',
  'role_field_updated',
  'import_reviewed',
  'rerun_requested',
  'converted_to_enrichment_question'
);--> statement-breakpoint
ALTER TABLE "enrichment_tasks" ADD COLUMN IF NOT EXISTS "acknowledged_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "enrichment_tasks" ADD COLUMN IF NOT EXISTS "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "enrichment_tasks" ADD COLUMN IF NOT EXISTS "resolution_kind" "enrichment_task_resolution_kind";--> statement-breakpoint
UPDATE "enrichment_tasks"
SET
  "target_scope" = 'profile_context'::"enrichment_task_target_scope",
  "expected_outcome" = 'save_profile_answer'::"enrichment_task_expected_outcome",
  "target_reason" = COALESCE("target_reason", 'This is a profile-level positioning preference, not a claim-specific evidence gap.')
WHERE
  "expected_outcome" = 'clarify_assignment'::"enrichment_task_expected_outcome"
  AND "target_scope" = 'assign_later'::"enrichment_task_target_scope"
  AND (
    "prompt" ~* '(future roles?|future software engineering roles?|career direction|general profile|profile positioning|technical skills section)'
    OR (
      "prompt" ~* '(future|target|preferred|preference|emphasize|emphasized|highlight|positioning|direction|strongest|most recent|recent|prioritize|focus)'
      AND "prompt" ~* '(skills?|technical skills?|skills section|listed skills?|profile|career|software engineering roles?|engineering roles?|role direction|target roles?)'
      AND "prompt" ~* '(which|what|where|how|would you|do you want|should)'
    )
  );--> statement-breakpoint
UPDATE "enrichment_tasks"
SET "expected_outcome" = 'route_answer'::"enrichment_task_expected_outcome"
WHERE
  "expected_outcome" = 'clarify_assignment'::"enrichment_task_expected_outcome"
  AND "target_scope" = 'assign_later'::"enrichment_task_target_scope";--> statement-breakpoint
UPDATE "enrichment_tasks"
SET
  "target_scope" = 'profile_fact'::"enrichment_task_target_scope",
  "expected_outcome" = 'update_profile_fact'::"enrichment_task_expected_outcome"
WHERE
  "note_kind" = 'missing_profile_fact'::"enrichment_task_note_kind";
--> statement-breakpoint
UPDATE "enrichment_tasks"
SET
  "status" = 'converted'::"enrichment_task_status",
  "converted_at" = COALESCE("converted_at", "answered_at", now()),
  "resolved_at" = COALESCE("resolved_at", "answered_at", now()),
  "resolution_kind" = 'profile_answer_saved'::"enrichment_task_resolution_kind"
WHERE
  "status" = 'answered'::"enrichment_task_status"
  AND "expected_outcome" = 'save_profile_answer'::"enrichment_task_expected_outcome"
  AND "user_answer" IS NOT NULL
  AND length(trim("user_answer")) > 0;
