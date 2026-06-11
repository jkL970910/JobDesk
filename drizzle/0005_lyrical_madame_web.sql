CREATE TYPE "public"."application_status" AS ENUM('evaluated', 'applied', 'responded', 'interview', 'offer', 'rejected', 'discarded', 'skip');--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "role_archetype" varchar(80) DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "job_legitimacy" jsonb DEFAULT '{"tier":"proceed_with_caution","signals":[],"context_notes":[]}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "application_status" "application_status" DEFAULT 'evaluated' NOT NULL;