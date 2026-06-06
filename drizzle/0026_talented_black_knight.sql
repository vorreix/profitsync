ALTER TABLE "transactions" ADD COLUMN "group_id" uuid;--> statement-breakpoint
CREATE INDEX "transactions_group_idx" ON "transactions" USING btree ("group_id");