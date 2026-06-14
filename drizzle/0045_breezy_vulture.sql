CREATE TABLE "broadcasts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_by" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"image_url" text,
	"link" text,
	"link_type" text DEFAULT 'internal' NOT NULL,
	"category" text DEFAULT 'system' NOT NULL,
	"importance" boolean DEFAULT false NOT NULL,
	"audience" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"schedule" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"next_fire_at" timestamp,
	"sent_at" timestamp,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "notification_reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" uuid,
	"enabled" boolean DEFAULT true NOT NULL,
	"label" text NOT NULL,
	"schedule" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_fired_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_group_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "notification_reminders" ADD CONSTRAINT "notification_reminders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_group_members" ADD CONSTRAINT "user_group_members_group_id_user_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."user_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "broadcasts_created_by_idx" ON "broadcasts" USING btree ("created_by","created_at");--> statement-breakpoint
CREATE INDEX "broadcasts_due_idx" ON "broadcasts" USING btree ("status","next_fire_at");--> statement-breakpoint
CREATE INDEX "notification_reminders_user_idx" ON "notification_reminders" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_reminders_user_label_unique" ON "notification_reminders" USING btree ("user_id","label");--> statement-breakpoint
CREATE INDEX "user_group_members_group_idx" ON "user_group_members" USING btree ("group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_group_members_group_user_unique" ON "user_group_members" USING btree ("group_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_groups_owner_name_unique" ON "user_groups" USING btree ("created_by","name");