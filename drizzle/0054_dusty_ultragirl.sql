CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "categories_name_trgm_idx" ON "categories" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "clients_name_trgm_idx" ON "clients" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "clients_company_trgm_idx" ON "clients" USING gin ("company" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "clients_email_trgm_idx" ON "clients" USING gin ("email" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "quotations_title_trgm_idx" ON "quotations" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "quotations_prospect_trgm_idx" ON "quotations" USING gin ("prospect_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "quotations_company_trgm_idx" ON "quotations" USING gin ("company" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "quotations_email_trgm_idx" ON "quotations" USING gin ("email" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "transactions_description_trgm_idx" ON "transactions" USING gin ("description" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "transactions_category_trgm_idx" ON "transactions" USING gin ("category" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "transactions_tags_text_trgm_idx" ON "transactions" USING gin (("tags"::text) gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "wealth_accounts_bank_name_trgm_idx" ON "wealth_accounts" USING gin ("bank_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "wealth_accounts_nickname_trgm_idx" ON "wealth_accounts" USING gin ("nickname" gin_trgm_ops);