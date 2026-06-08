import type { VercelRequest, VercelResponse } from "@vercel/node"
import { and, eq } from "drizzle-orm"
import { db } from "../../../../src/lib/db/index.js"
import { blogPosts } from "../../../../src/lib/db/schema.js"

// Public, unauthenticated single blog post by slug. Only PUBLISHED posts are
// returned — a draft (or unknown slug) is a 404 so unpublished content is never
// exposed. Returns the full Markdown `content` plus SEO fields for the page head.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })

  const slug = req.query.slug as string
  if (!slug) return res.status(400).json({ error: "Missing slug" })

  const [post] = await db
    .select()
    .from(blogPosts)
    .where(and(eq(blogPosts.slug, slug), eq(blogPosts.status, "published")))

  if (!post) return res.status(404).json({ error: "Not found" })

  res.setHeader("Cache-Control", "public, max-age=60")
  return res.json({
    id: post.id,
    slug: post.slug,
    title: post.title,
    excerpt: post.excerpt,
    content: post.content,
    cover_image_url: post.coverImageUrl,
    tags: (post.tags as string[]) ?? [],
    author_name: post.authorName,
    author_job_title: post.authorJobTitle,
    author_bio: post.authorBio,
    author_url: post.authorUrl,
    author_image_url: post.authorImageUrl,
    og_image_url: post.ogImageUrl,
    article_section: post.articleSection,
    status: post.status,
    seo_title: post.seoTitle,
    seo_description: post.seoDescription,
    published_at: post.publishedAt,
    created_at: post.createdAt,
    updated_at: post.updatedAt,
    reading_time_minutes: post.readingTimeMinutes,
  })
}
