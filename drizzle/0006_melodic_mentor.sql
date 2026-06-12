CREATE TYPE "public"."interview_prep_status" AS ENUM('draft', 'ready', 'stale');--> statement-breakpoint
CREATE TABLE "embeddings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"index_type" varchar(80) NOT NULL,
	"source_entity_type" varchar(80) NOT NULL,
	"source_entity_id" uuid NOT NULL,
	"chunk_text" text NOT NULL,
	"embedding_model" varchar(120) NOT NULL,
	"vector_dimensions" integer NOT NULL,
	"vector_json" jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interview_prep_packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"title" varchar(240) NOT NULL,
	"prep_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"behavioral_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"technical_review_topics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"company_research_prompts" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"practice_plan" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence_gaps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "interview_prep_status" DEFAULT 'ready' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "embeddings" ADD CONSTRAINT "embeddings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_prep_packs" ADD CONSTRAINT "interview_prep_packs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_prep_packs" ADD CONSTRAINT "interview_prep_packs_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "embeddings_workspace_index_idx" ON "embeddings" USING btree ("workspace_id","index_type");--> statement-breakpoint
CREATE INDEX "embeddings_source_idx" ON "embeddings" USING btree ("source_entity_type","source_entity_id");--> statement-breakpoint
CREATE INDEX "interview_prep_packs_workspace_updated_idx" ON "interview_prep_packs" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "interview_prep_packs_job_updated_idx" ON "interview_prep_packs" USING btree ("job_id","updated_at");