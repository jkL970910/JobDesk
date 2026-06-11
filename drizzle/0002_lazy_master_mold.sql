ALTER TABLE "jobs" ADD COLUMN "company" varchar(240);--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "role_title" varchar(240);--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "level" varchar(120);--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "location" varchar(240);--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "responsibilities" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "preferred_qualifications" jsonb DEFAULT '[]'::jsonb NOT NULL;