CREATE TYPE "public"."enrichment_answer_status" AS ENUM('submitted', 'applied', 'rejected');
CREATE TYPE "public"."enrichment_proposal_type" AS ENUM(
  'create_evidence',
  'update_evidence',
  'create_initiative',
  'update_initiative',
  'update_work_experience',
  'link_evidence_to_story',
  'link_story_to_role'
);
CREATE TYPE "public"."enrichment_proposal_status" AS ENUM('pending_review', 'accepted', 'rejected');

CREATE TABLE "enrichment_answers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "task_id" uuid NOT NULL,
  "answer_text" text NOT NULL,
  "answer_status" "enrichment_answer_status" DEFAULT 'submitted' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "enrichment_proposals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "task_id" uuid NOT NULL,
  "answer_id" uuid,
  "proposal_type" "enrichment_proposal_type" NOT NULL,
  "target_kind" "enrichment_task_target_kind",
  "target_id" uuid,
  "proposed_patch_json" jsonb NOT NULL,
  "evidence_delta_json" jsonb,
  "schema_version" varchar(80) DEFAULT 'enrichment-proposal-v1' NOT NULL,
  "status" "enrichment_proposal_status" DEFAULT 'pending_review' NOT NULL,
  "committed_evidence_item_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "reviewed_at" timestamp with time zone
);

ALTER TABLE "enrichment_answers"
  ADD CONSTRAINT "enrichment_answers_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
  ON DELETE cascade ON UPDATE no action;
ALTER TABLE "enrichment_answers"
  ADD CONSTRAINT "enrichment_answers_task_id_enrichment_tasks_id_fk"
  FOREIGN KEY ("task_id") REFERENCES "public"."enrichment_tasks"("id")
  ON DELETE cascade ON UPDATE no action;

ALTER TABLE "enrichment_proposals"
  ADD CONSTRAINT "enrichment_proposals_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
  ON DELETE cascade ON UPDATE no action;
ALTER TABLE "enrichment_proposals"
  ADD CONSTRAINT "enrichment_proposals_task_id_enrichment_tasks_id_fk"
  FOREIGN KEY ("task_id") REFERENCES "public"."enrichment_tasks"("id")
  ON DELETE cascade ON UPDATE no action;
ALTER TABLE "enrichment_proposals"
  ADD CONSTRAINT "enrichment_proposals_answer_id_enrichment_answers_id_fk"
  FOREIGN KEY ("answer_id") REFERENCES "public"."enrichment_answers"("id")
  ON DELETE set null ON UPDATE no action;
ALTER TABLE "enrichment_proposals"
  ADD CONSTRAINT "enrichment_proposals_committed_evidence_item_id_evidence_items_id_fk"
  FOREIGN KEY ("committed_evidence_item_id") REFERENCES "public"."evidence_items"("id")
  ON DELETE set null ON UPDATE no action;

CREATE INDEX "enrichment_answers_task_status_idx"
  ON "enrichment_answers" USING btree ("task_id","answer_status","created_at");
CREATE INDEX "enrichment_answers_workspace_updated_idx"
  ON "enrichment_answers" USING btree ("workspace_id","updated_at");
CREATE INDEX "enrichment_proposals_task_status_idx"
  ON "enrichment_proposals" USING btree ("task_id","status","updated_at");
CREATE INDEX "enrichment_proposals_workspace_status_idx"
  ON "enrichment_proposals" USING btree ("workspace_id","status","updated_at");
