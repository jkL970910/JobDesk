ALTER TABLE "source_documents" ADD COLUMN "original_filename" varchar(260);--> statement-breakpoint
ALTER TABLE "source_documents" ADD COLUMN "mime_type" varchar(160);--> statement-breakpoint
ALTER TABLE "source_documents" ADD COLUMN "file_size_bytes" integer;--> statement-breakpoint
ALTER TABLE "source_documents" ADD COLUMN "parser_name" varchar(80);--> statement-breakpoint
ALTER TABLE "source_documents" ADD COLUMN "parser_version" varchar(80);--> statement-breakpoint
ALTER TABLE "source_documents" ADD COLUMN "parse_status" varchar(40);--> statement-breakpoint
ALTER TABLE "source_documents" ADD COLUMN "parse_warnings" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "source_documents" ADD COLUMN "page_count" integer;--> statement-breakpoint
ALTER TABLE "source_documents" ADD COLUMN "char_count" integer;--> statement-breakpoint
ALTER TABLE "source_documents" ADD COLUMN "word_count" integer;--> statement-breakpoint
ALTER TABLE "source_documents" ADD COLUMN "lifecycle_status" varchar(40) DEFAULT 'parsed' NOT NULL;--> statement-breakpoint
ALTER TABLE "source_documents" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "source_documents_workspace_hash_idx" ON "source_documents" USING btree ("workspace_id","content_hash");--> statement-breakpoint
CREATE INDEX "source_documents_lifecycle_idx" ON "source_documents" USING btree ("workspace_id","lifecycle_status");
