import type { VercelRequest, VercelResponse } from "@vercel/node"
import { desc } from "drizzle-orm"
import { db, serialize } from "../../../src/lib/db/index.js"
import { blogPosts } from "../../../src/lib/db/schema.js"
import { requireAdminCap } from "../../_lib/admin.js"
import { uniqueSlug, clampStr, cleanTags, safeImageUrl } from "../../_lib/blog.js"
import {
  readingTimeMinutes,
  BLOG_TITLE_MAX,
  BLOG_EXCERPT_MAX,
  BLOG_SEO_TITLE_MAX,
  BLOG_SEO_DESCRIPTION_MAX,
} from "../../../src/lib/blog.js"

// Admin blog collection: list every post (drafts + published) and create new
// ones. Admin-only via requireAdmin. Single-post mutations live in ./blog/[id].ts.
const COVER_URL_MAX = 600
const AUTHOR_MAX = 120
const CONTENT_MAX = 200_000 // generous Markdown body cap (~200 KB)

type BlogBody = {
  title?: unknown
  slug?: unknown
  excerpt?: unknown
  content?: unknown
  cover_image_url?: unknown
  tags?: unknown
  author_name?: unknown
  status?: unknown
  seo_title?: unknown
  seo_description?: unknown
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const ctx = await requireAdminCap(req, res, "blog")
  if (!ctx) return
  const adminId = ctx.userId

  if (req.method === "GET") {
    const rows = await db.select().from(blogPosts).orderBy(desc(blogPosts.updatedAt))
    return res.json(rows.map(serialize))
  }

  if (req.method === "POST") {
    const body = (req.body ?? {}) as BlogBody

    const title = clampStr(body.title, BLOG_TITLE_MAX)
    if (!title) return res.status(400).json({ error: "Title is required" })

    if (body.status !== undefined && body.status !== "draft" && body.status !== "published") {
      return res.status(400).json({ error: "status must be 'draft' or 'published'" })
    }
    const status = body.status === "published" ? "published" : "draft"

    // Prefer an explicit slug, else derive from the title. Always uniquified.
    const slug = await uniqueSlug(clampStr(body.slug, BLOG_TITLE_MAX) || title)
    const content = clampStr(body.content, CONTENT_MAX)

    const [created] = await db
      .insert(blogPosts)
      .values({
        slug,
        title,
        excerpt: clampStr(body.excerpt, BLOG_EXCERPT_MAX),
        content,
        coverImageUrl: safeImageUrl(body.cover_image_url, COVER_URL_MAX),
        tags: cleanTags(body.tags),
        authorName: clampStr(body.author_name, AUTHOR_MAX),
        authorUserId: adminId,
        status,
        seoTitle: clampStr(body.seo_title, BLOG_SEO_TITLE_MAX),
        seoDescription: clampStr(body.seo_description, BLOG_SEO_DESCRIPTION_MAX),
        readingTimeMinutes: readingTimeMinutes(content),
        publishedAt: status === "published" ? new Date() : null,
      })
      .returning()

    return res.status(201).json(serialize(created))
  }

  return res.status(405).json({ error: "Method not allowed" })
}
