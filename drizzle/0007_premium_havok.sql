CREATE TYPE "public"."overlap_decision" AS ENUM('keep_separate');--> statement-breakpoint
CREATE TYPE "public"."overlap_entity_type" AS ENUM('evidence', 'project');--> statement-breakpoint
CREATE TABLE "overlap_review_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"entity_type" "overlap_entity_type" NOT NULL,
	"left_entity_id" uuid NOT NULL,
	"right_entity_id" uuid NOT NULL,
	"decision" "overlap_decision" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "overlap_review_decisions" ADD CONSTRAINT "overlap_review_decisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "overlap_review_decisions_workspace_type_idx" ON "overlap_review_decisions" USING btree ("workspace_id","entity_type");--> statement-breakpoint
CREATE UNIQUE INDEX "overlap_review_decisions_unique_pair_idx" ON "overlap_review_decisions" USING btree ("workspace_id","entity_type","left_entity_id","right_entity_id");