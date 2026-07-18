CREATE TABLE "account_deletion_codes" (
	"user_id" text PRIMARY KEY NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_sent_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now()
);
