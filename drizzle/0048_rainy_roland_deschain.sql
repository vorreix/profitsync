DROP INDEX "organization_members_org_idx";--> statement-breakpoint
DROP INDEX "transactions_client_idx";--> statement-breakpoint
CREATE INDEX "organization_members_org_user_idx" ON "organization_members" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "quotation_attachments_quotation_idx" ON "quotation_attachments" USING btree ("quotation_id");--> statement-breakpoint
CREATE INDEX "transaction_attachments_tx_idx" ON "transaction_attachments" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "transactions_client_date_idx" ON "transactions" USING btree ("client_id","date");