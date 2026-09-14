-- Per-account colour identity for wealth accounts (bank / cash / space).
--
-- Credit cards have worn brand colours since 0063 (`cards.design` + the
-- Brandfetch palette), which left the bank and Space tiles on /wealth and
-- /spaces looking flat next to them and — worse — indistinguishable from each
-- other at a glance. These two columns let a user paint each account.
--
--   color        '' = AUTO. Resolution then falls back exactly like a card's:
--                the bank's curated brand colour (src/lib/cards.ts
--                CURATED_BANK_COLORS, matched on brand_domain), else a stable
--                swatch derived from the row id, so a workspace is colour-coded
--                without anyone touching a picker. A '#RRGGBB' value is the
--                user's explicit override.
--   color_style  how loudly that colour is worn: 'subtle' (default — a rail,
--                a tinted logo halo and a soft wash on the normal card
--                surface) or 'bold' (the whole tile becomes the gradient).
--
-- Presentation only: nothing here is ever read by money maths. The check
-- constraints keep the columns honest so the UI can trust them without
-- re-validating (src/lib/account-color.ts is the single resolver).
ALTER TABLE "wealth_accounts" ADD COLUMN IF NOT EXISTS "color" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "wealth_accounts" ADD COLUMN IF NOT EXISTS "color_style" text DEFAULT 'subtle' NOT NULL;--> statement-breakpoint
ALTER TABLE "wealth_accounts" DROP CONSTRAINT IF EXISTS "wealth_accounts_color_check";--> statement-breakpoint
ALTER TABLE "wealth_accounts" ADD CONSTRAINT "wealth_accounts_color_check" CHECK (color = '' OR color ~ '^#[0-9A-Fa-f]{6}$');--> statement-breakpoint
ALTER TABLE "wealth_accounts" DROP CONSTRAINT IF EXISTS "wealth_accounts_color_style_check";--> statement-breakpoint
ALTER TABLE "wealth_accounts" ADD CONSTRAINT "wealth_accounts_color_style_check" CHECK (color_style in ('subtle','bold'));
