import type { VercelRequest, VercelResponse } from "@vercel/node"
import { eq } from "drizzle-orm"
import { db, serialize } from "../../../../src/lib/db/index.js"
import { blogPosts } from "../../../../src/lib/db/schema.js"
import { requireAdminCap } from "../../../_lib/admin.js"
import { uniqueSlug, clampStr, cleanTags, safeImageUrl } from "../../../_lib/blog.js"
import {
  readingTimeMinutes,
  BLOG_TITLE_MAX,
  BLOG_EXCERPT_MAX,
  BLOG_SEO_TITLE_MAX,
  BLOG_SEO_DESCRIPTION_MAX,
} from "../../../../src/lib/blog.js"

// Admin single-post handler: view (incl. drafts), update (incl. publish /
// unpublish via `status`), and delete. Admin-only via requireAdmin.
const COVER_URL_MAX = 600
const AUTHOR_MAX = 120
const CONTENT_MAX = 200_000

type BlogPatch = {
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

  const id = req.query.id as string
  if (!id) return res.status(400).json({ error: "Missing id" })

  const [existing] = await db.select().from(blogPosts).where(eq(blogPosts.id, id))
  if (!existing) return res.status(404).json({ error: "Not found" })

  if (req.method === "GET") {
    return res.json(serialize(existing))
  }

  if (req.method === "PATCH") {
    const body = (req.body ?? {}) as BlogPatch

    // Validate + pre-compute the fields that need work before assembling the
    // typed update object (Drizzle's .set() wants a typed literal).
    let title: string | undefined
    if (body.title !== undefined) {
      title = clampStr(body.title, BLOG_TITLE_MAX)
      if (!title) return res.status(400).json({ error: "Title cannot be empty" })
    }

    let slug: string | undefined
    if (body.slug !== undefined) {
      const desired = clampStr(body.slug, BLOG_TITLE_MAX) || clampStr(body.title, BLOG_TITLE_MAX) || existing.title
      slug = await uniqueSlug(desired, id)
    }

    // Recompute reading time whenever the body changes.
    let content: string | undefined
    if (body.content !== undefined) content = clampStr(body.content, CONTENT_MAX)

    let status: "draft" | "published" | undefined
    let publishedAt: Date | undefined
    if (body.status !== undefined) {
      if (body.status !== "draft" && body.status !== "published") {
        return res.status(400).json({ error: "status must be 'draft' or 'published'" })
      }
      status = body.status
      // Stamp publishedAt the first time it goes live; preserve it across an
      // unpublish/republish so the public ordering stays stable.
      if (body.status === "published" && !existing.publishedAt) publishedAt = new Date()
    }

    const [updated] = await db
      .update(blogPosts)
      .set({
        ...(title !== undefined ? { title } : {}),
        ...(slug !== undefined ? { slug } : {}),
        ...(body.excerpt !== undefined ? { excerpt: clampStr(body.excerpt, BLOG_EXCERPT_MAX) } : {}),
        ...(content !== undefined ? { content, readingTimeMinutes: readingTimeMinutes(content) } : {}),
        ...(body.cover_image_url !== undefined ? { coverImageUrl: safeImageUrl(body.cover_image_url, COVER_URL_MAX) } : {}),
        ...(body.tags !== undefined ? { tags: cleanTags(body.tags) } : {}),
        ...(body.author_name !== undefined ? { authorName: clampStr(body.author_name, AUTHOR_MAX) } : {}),
        ...(body.seo_title !== undefined ? { seoTitle: clampStr(body.seo_title, BLOG_SEO_TITLE_MAX) } : {}),
        ...(body.seo_description !== undefined
          ? { seoDescription: clampStr(body.seo_description, BLOG_SEO_DESCRIPTION_MAX) }
          : {}),
        ...(status !== undefined ? { status } : {}),
        ...(publishedAt !== undefined ? { publishedAt } : {}),
        updatedAt: new Date(),
      })
      .where(eq(blogPosts.id, id))
      .returning()

    return res.json(serialize(updated))
  }

  if (req.method === "DELETE") {
    await db.delete(blogPosts).where(eq(blogPosts.id, id))
    return res.json({ deleted: true, id })
  }

  return res.status(405).json({ error: "Method not allowed" })
}
