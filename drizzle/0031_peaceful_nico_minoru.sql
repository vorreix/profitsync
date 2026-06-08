ALTER TABLE "blog_posts" ADD COLUMN "author_job_title" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "blog_posts" ADD COLUMN "author_bio" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "blog_posts" ADD COLUMN "author_url" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "blog_posts" ADD COLUMN "author_image_url" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "blog_posts" ADD COLUMN "og_image_url" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "blog_posts" ADD COLUMN "article_section" text DEFAULT '' NOT NULL;