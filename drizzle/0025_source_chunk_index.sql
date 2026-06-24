CREATE TABLE "source_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_document_id" uuid NOT NULL,
	"resume_source_version_id" uuid,
	"source_type" varchar(40) NOT NULL,
	"chunk_index" integer NOT NULL,
	"chunk_text" text NOT NULL,
	"content_hash" varchar(128) NOT NULL,
	"parse_quality" varchar(40),
	"lifecycle_status" varchar(40) NOT NULL,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"embedding_model" varchar(120) NOT NULL,
	"vector_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "source_chunks" ADD CONSTRAINT "source_chunks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "source_chunks" ADD CONSTRAINT "source_chunks_source_document_id_source_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_documents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "source_chunks" ADD CONSTRAINT "source_chunks_resume_source_version_id_resume_source_versions_id_fk" FOREIGN KEY ("resume_source_version_id") REFERENCES "public"."resume_source_versions"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "source_chunks_workspace_source_idx" ON "source_chunks" USING btree ("workspace_id","source_document_id");
--> statement-breakpoint
CREATE INDEX "source_chunks_workspace_lifecycle_idx" ON "source_chunks" USING btree ("workspace_id","lifecycle_status");
--> statement-breakpoint
CREATE INDEX "source_chunks_workspace_resume_idx" ON "source_chunks" USING btree ("workspace_id","resume_source_version_id");
--> statement-breakpoint
CREATE INDEX "source_chunks_workspace_hash_idx" ON "source_chunks" USING btree ("workspace_id","content_hash");
--> statement-breakpoint
CREATE UNIQUE INDEX "source_chunks_source_chunk_unique_idx" ON "source_chunks" USING btree ("source_document_id","chunk_index");
