CREATE TYPE "public"."enrichment_task_target_scope" AS ENUM('evidence_detail', 'story_context', 'role_context', 'source_material', 'assign_later');--> statement-breakpoint
CREATE TYPE "public"."enrichment_task_target_confidence" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."enrichment_task_expected_outcome" AS ENUM('create_evidence', 'update_evidence', 'update_story', 'update_role', 'clarify_assignment');--> statement-breakpoint
CREATE TYPE "public"."enrichment_task_target_kind" AS ENUM('evidence', 'initiative', 'portfolio_project', 'work_experience');--> statement-breakpoint
CREATE TYPE "public"."enrichment_task_target_role" AS ENUM('primary', 'parent', 'suggested', 'previous');--> statement-breakpoint
ALTER TABLE "enrichment_tasks" ADD COLUMN "target_scope" "enrichment_task_target_scope" DEFAULT 'assign_later' NOT NULL;--> statement-breakpoint
ALTER TABLE "enrichment_tasks" ADD COLUMN "target_confidence" "enrichment_task_target_confidence" DEFAULT 'low' NOT NULL;--> statement-breakpoint
ALTER TABLE "enrichment_tasks" ADD COLUMN "target_reason" text;--> statement-breakpoint
ALTER TABLE "enrichment_tasks" ADD COLUMN "expected_outcome" "enrichment_task_expected_outcome" DEFAULT 'clarify_assignment' NOT NULL;--> statement-breakpoint
CREATE TABLE "enrichment_task_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"target_kind" "enrichment_task_target_kind" NOT NULL,
	"target_id" uuid NOT NULL,
	"target_role" "enrichment_task_target_role" DEFAULT 'primary' NOT NULL,
	"confidence" "enrichment_task_target_confidence" DEFAULT 'medium' NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "enrichment_task_targets" ADD CONSTRAINT "enrichment_task_targets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "enrichment_task_targets" ADD CONSTRAINT "enrichment_task_targets_task_id_enrichment_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."enrichment_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "enrichment_task_targets_task_role_idx" ON "enrichment_task_targets" USING btree ("task_id","target_role");--> statement-breakpoint
CREATE INDEX "enrichment_task_targets_workspace_kind_idx" ON "enrichment_task_targets" USING btree ("workspace_id","target_kind","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "enrichment_task_targets_unique_idx" ON "enrichment_task_targets" USING btree ("task_id","target_kind","target_id","target_role");--> statement-breakpoint
UPDATE "enrichment_tasks"
SET
	"target_scope" = CASE
		WHEN "evidence_item_id" IS NOT NULL THEN 'evidence_detail'::"enrichment_task_target_scope"
		WHEN "initiative_id" IS NOT NULL OR "portfolio_project_id" IS NOT NULL THEN 'story_context'::"enrichment_task_target_scope"
		WHEN "work_experience_id" IS NOT NULL THEN 'role_context'::"enrichment_task_target_scope"
		ELSE 'assign_later'::"enrichment_task_target_scope"
	END,
	"target_confidence" = CASE
		WHEN "evidence_item_id" IS NOT NULL OR "initiative_id" IS NOT NULL OR "portfolio_project_id" IS NOT NULL OR "work_experience_id" IS NOT NULL THEN 'medium'::"enrichment_task_target_confidence"
		ELSE 'low'::"enrichment_task_target_confidence"
	END,
	"target_reason" = CASE
		WHEN "evidence_item_id" IS NOT NULL THEN 'Backfilled from existing evidence destination.'
		WHEN "initiative_id" IS NOT NULL THEN 'Backfilled from existing story destination.'
		WHEN "portfolio_project_id" IS NOT NULL THEN 'Backfilled from existing portfolio story destination.'
		WHEN "work_experience_id" IS NOT NULL THEN 'Backfilled from existing role destination.'
		ELSE 'No reusable library target is attached yet.'
	END,
	"expected_outcome" = CASE
		WHEN "evidence_item_id" IS NOT NULL THEN 'update_evidence'::"enrichment_task_expected_outcome"
		WHEN "initiative_id" IS NOT NULL OR "portfolio_project_id" IS NOT NULL THEN 'update_story'::"enrichment_task_expected_outcome"
		WHEN "work_experience_id" IS NOT NULL THEN 'update_role'::"enrichment_task_expected_outcome"
		ELSE 'clarify_assignment'::"enrichment_task_expected_outcome"
	END;
--> statement-breakpoint
INSERT INTO "enrichment_task_targets" ("workspace_id", "task_id", "target_kind", "target_id", "target_role", "confidence", "reason")
SELECT "workspace_id", "id", 'evidence'::"enrichment_task_target_kind", "evidence_item_id", 'primary'::"enrichment_task_target_role", 'medium'::"enrichment_task_target_confidence", 'Backfilled from existing evidence destination.'
FROM "enrichment_tasks"
WHERE "evidence_item_id" IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "enrichment_task_targets" ("workspace_id", "task_id", "target_kind", "target_id", "target_role", "confidence", "reason")
SELECT "workspace_id", "id", 'initiative'::"enrichment_task_target_kind", "initiative_id", 'primary'::"enrichment_task_target_role", 'medium'::"enrichment_task_target_confidence", 'Backfilled from existing story destination.'
FROM "enrichment_tasks"
WHERE "initiative_id" IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "enrichment_task_targets" ("workspace_id", "task_id", "target_kind", "target_id", "target_role", "confidence", "reason")
SELECT "workspace_id", "id", 'portfolio_project'::"enrichment_task_target_kind", "portfolio_project_id", 'primary'::"enrichment_task_target_role", 'medium'::"enrichment_task_target_confidence", 'Backfilled from existing portfolio story destination.'
FROM "enrichment_tasks"
WHERE "portfolio_project_id" IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "enrichment_task_targets" ("workspace_id", "task_id", "target_kind", "target_id", "target_role", "confidence", "reason")
SELECT "workspace_id", "id", 'work_experience'::"enrichment_task_target_kind", "work_experience_id", 'primary'::"enrichment_task_target_role", 'medium'::"enrichment_task_target_confidence", 'Backfilled from existing role destination.'
FROM "enrichment_tasks"
WHERE "work_experience_id" IS NOT NULL
ON CONFLICT DO NOTHING;
