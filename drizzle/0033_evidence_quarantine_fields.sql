ALTER TABLE "evidence_items" ADD COLUMN "quarantined_at" timestamp with time zone;
ALTER TABLE "evidence_items" ADD COLUMN "quarantine_reason" text;

CREATE INDEX "evidence_items_workspace_quarantined_idx"
  ON "evidence_items" USING btree ("workspace_id","quarantined_at");
