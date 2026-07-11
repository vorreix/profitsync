CREATE TABLE "notification_scheduler_state" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"last_tick_at" timestamp DEFAULT now() NOT NULL,
	"last_reminders" integer DEFAULT 0 NOT NULL,
	"last_broadcasts" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
