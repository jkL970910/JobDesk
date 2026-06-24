DO $$ BEGIN
  CREATE TYPE "public"."enrichment_task_note_kind" AS ENUM(
    'observation',
    'missing_profile_fact',
    'missing_role_field',
    'extraction_limit',
    'import_review',
    'evidence_gap',
    'story_gap'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
  CREATE TYPE "public"."enrichment_task_expected_action" AS ENUM(
    'acknowledge',
    'dismiss',
    'add_profile_fact',
    'edit_profile_fact',
    'edit_role_field',
    'review_import',
    'rerun_extraction',
    'answer_enrichment_question'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
ALTER TABLE "enrichment_tasks" ADD COLUMN IF NOT EXISTS "note_kind" "enrichment_task_note_kind";--> statement-breakpoint
ALTER TABLE "enrichment_tasks" ADD COLUMN IF NOT EXISTS "expected_action" "enrichment_task_expected_action";--> statement-breakpoint
ALTER TABLE "enrichment_tasks" ADD COLUMN IF NOT EXISTS "target_field" varchar(120);--> statement-breakpoint
UPDATE "enrichment_tasks"
SET
  "task_type" = 'source_section_review'::"enrichment_task_type",
  "target_scope" = 'source_material'::"enrichment_task_target_scope",
  "target_confidence" = 'high'::"enrichment_task_target_confidence",
  "target_reason" = 'This is an imported-source review note, not a missing-information question.',
  "expected_outcome" = 'review_imported_material'::"enrichment_task_expected_outcome",
  "note_kind" = CASE
    WHEN "prompt" ~* '(returned at most|omitted additional|beyond the first|not included due to|capped at)' THEN 'extraction_limit'::"enrichment_task_note_kind"
    WHEN "prompt" ~* '(location was not|no personal location|does not state a location)' THEN
      CASE
        WHEN "prompt" ~* '(work experience|role|nvidia|shopify|amazon|employer)' THEN 'missing_role_field'::"enrichment_task_note_kind"
        ELSE 'missing_profile_fact'::"enrichment_task_note_kind"
      END
    WHEN "prompt" ~* '(no certifications|certifications were not|certifications were found|education|contact|skills)' THEN 'missing_profile_fact'::"enrichment_task_note_kind"
    WHEN "prompt" ~* '(entries were extracted|was extracted|were extracted|classified as|present.*preserved|preserved exactly)' THEN 'observation'::"enrichment_task_note_kind"
    ELSE 'import_review'::"enrichment_task_note_kind"
  END,
  "expected_action" = CASE
    WHEN "prompt" ~* '(returned at most|omitted additional|beyond the first|not included due to|capped at)' THEN 'review_import'::"enrichment_task_expected_action"
    WHEN "prompt" ~* '(location was not|does not state a location)' AND "prompt" ~* '(work experience|role|nvidia|shopify|amazon|employer)' THEN 'edit_role_field'::"enrichment_task_expected_action"
    WHEN "prompt" ~* '(no certifications|certifications were not|certifications were found)' THEN 'add_profile_fact'::"enrichment_task_expected_action"
    WHEN "prompt" ~* '(no personal location|education|contact|skills)' THEN 'edit_profile_fact'::"enrichment_task_expected_action"
    WHEN "prompt" ~* '(entries were extracted|was extracted|were extracted|classified as|present.*preserved|preserved exactly)' THEN 'acknowledge'::"enrichment_task_expected_action"
    ELSE 'review_import'::"enrichment_task_expected_action"
  END,
  "target_field" = CASE
    WHEN "prompt" ~* 'certification' THEN 'certifications'
    WHEN "prompt" ~* 'personal location|does not state a location|location was not' THEN 'location'
    WHEN "prompt" ~* 'education' THEN 'education'
    WHEN "prompt" ~* 'contact' THEN 'contact'
    WHEN "prompt" ~* 'skills' THEN 'skills'
    WHEN "prompt" ~* 'present|end date' THEN 'end_date'
    ELSE NULL
  END,
  "updated_at" = now()
WHERE
  "source_type" = 'extraction_note'
  AND (
    "prompt" ~* '(entries were extracted|was extracted|were extracted|classified as|returned at most|omitted additional|beyond the first|not included due to|capped at|no certifications|certifications were not|no personal location|does not state a location|location was not|present.*preserved|preserved exactly)'
    OR (
      "target_scope" = 'source_material'
      AND "expected_outcome" = 'review_imported_material'
    )
  );
