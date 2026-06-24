ALTER TABLE "enrichment_task_targets" ADD COLUMN IF NOT EXISTS "created_by" varchar(40) DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "enrichment_task_targets" ADD COLUMN IF NOT EXISTS "accepted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "enrichment_task_targets" ADD COLUMN IF NOT EXISTS "rejected_at" timestamp with time zone;--> statement-breakpoint
UPDATE "enrichment_task_targets"
SET
  "created_by" = CASE
    WHEN "target_role" = 'primary' THEN 'user'
    WHEN "target_role" = 'suggested' THEN 'system'
    ELSE COALESCE("created_by", 'system')
  END,
  "accepted_at" = CASE
    WHEN "target_role" = 'primary' THEN COALESCE("accepted_at", "created_at")
    ELSE "accepted_at"
  END
WHERE "created_by" IS NULL OR ("target_role" = 'primary' AND "accepted_at" IS NULL);
