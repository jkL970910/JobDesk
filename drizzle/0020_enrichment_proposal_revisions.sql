CREATE TYPE "public"."enrichment_proposal_revision_actor" AS ENUM('user', 'ai');
CREATE TYPE "public"."enrichment_proposal_revision_mode" AS ENUM('manual_edit', 'ai_revision');

CREATE TABLE "enrichment_proposal_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "task_id" uuid NOT NULL,
  "proposal_id" uuid,
  "next_proposal_id" uuid,
  "actor" "enrichment_proposal_revision_actor" NOT NULL,
  "mode" "enrichment_proposal_revision_mode" NOT NULL,
  "instruction" text,
  "previous_text" text NOT NULL,
  "revised_text" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE "enrichment_proposal_revisions"
  ADD CONSTRAINT "enrichment_proposal_revisions_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
  ON DELETE cascade ON UPDATE no action;
ALTER TABLE "enrichment_proposal_revisions"
  ADD CONSTRAINT "enrichment_proposal_revisions_task_id_enrichment_tasks_id_fk"
  FOREIGN KEY ("task_id") REFERENCES "public"."enrichment_tasks"("id")
  ON DELETE cascade ON UPDATE no action;
ALTER TABLE "enrichment_proposal_revisions"
  ADD CONSTRAINT "enrichment_proposal_revisions_proposal_id_enrichment_proposals_id_fk"
  FOREIGN KEY ("proposal_id") REFERENCES "public"."enrichment_proposals"("id")
  ON DELETE set null ON UPDATE no action;
ALTER TABLE "enrichment_proposal_revisions"
  ADD CONSTRAINT "enrichment_proposal_revisions_next_proposal_id_enrichment_proposals_id_fk"
  FOREIGN KEY ("next_proposal_id") REFERENCES "public"."enrichment_proposals"("id")
  ON DELETE set null ON UPDATE no action;

CREATE INDEX "enrichment_proposal_revisions_task_created_idx"
  ON "enrichment_proposal_revisions" USING btree ("task_id","created_at");
CREATE INDEX "enrichment_proposal_revisions_proposal_created_idx"
  ON "enrichment_proposal_revisions" USING btree ("proposal_id","created_at");
CREATE INDEX "enrichment_proposal_revisions_workspace_created_idx"
  ON "enrichment_proposal_revisions" USING btree ("workspace_id","created_at");
