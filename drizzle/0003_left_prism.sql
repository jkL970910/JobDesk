CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."evidence_type" AS ENUM('original', 'extracted', 'user_confirmed', 'inferred');--> statement-breakpoint
CREATE TYPE "public"."sensitivity_level" AS ENUM('public_safe', 'private', 'sensitive');--> statement-breakpoint
CREATE TABLE "evidence_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_document_id" uuid,
	"text" text NOT NULL,
	"source_quote" text NOT NULL,
	"evidence_type" "evidence_type" NOT NULL,
	"metrics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sensitivity_level" "sensitivity_level" DEFAULT 'private' NOT NULL,
	"allowed_usage" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"public_safe_summary" text,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"related_project_id" uuid,
	"needs_user_confirmation" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_document_id" uuid,
	"display_name" varchar(240),
	"profile_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"title" varchar(240) NOT NULL,
	"context" text,
	"problem" text,
	"role" text,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"results" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metrics" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"technologies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stakeholders" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"public_safe_summary" text,
	"sensitivity_level" "sensitivity_level" DEFAULT 'private' NOT NULL,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_items" ADD CONSTRAINT "evidence_items_source_document_id_source_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_source_document_id_source_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_cards" ADD CONSTRAINT "project_cards_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evidence_items_workspace_updated_idx" ON "evidence_items" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "profiles_workspace_updated_idx" ON "profiles" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "project_cards_workspace_updated_idx" ON "project_cards" USING btree ("workspace_id","updated_at");