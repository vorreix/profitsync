ALTER TABLE "invoices" ALTER COLUMN "amount" SET DATA TYPE numeric(20, 2);--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "amount" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "quotations" ALTER COLUMN "amount" SET DATA TYPE numeric(20, 2);--> statement-breakpoint
ALTER TABLE "quotations" ALTER COLUMN "amount" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "amount" SET DATA TYPE numeric(20, 2);--> statement-breakpoint
ALTER TABLE "transactions" ALTER COLUMN "amount" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "wealth_accounts" ALTER COLUMN "opening_balance" SET DATA TYPE numeric(20, 2);--> statement-breakpoint
ALTER TABLE "wealth_accounts" ALTER COLUMN "opening_balance" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "wealth_accounts" ALTER COLUMN "current_balance" SET DATA TYPE numeric(20, 2);--> statement-breakpoint
ALTER TABLE "wealth_accounts" ALTER COLUMN "current_balance" SET DEFAULT '0';