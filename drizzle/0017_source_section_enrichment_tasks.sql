ALTER TYPE "public"."enrichment_task_type" ADD VALUE IF NOT EXISTS 'source_section_review';--> statement-breakpoint
ALTER TYPE "public"."enrichment_task_expected_outcome" ADD VALUE IF NOT EXISTS 'review_imported_material';
