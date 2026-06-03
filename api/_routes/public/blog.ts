import type { VercelRequest, VercelResponse } from "@vercel/node"
import { desc, eq, sql } from "drizzle-orm"
import { db } from "../../../src/lib/db/index.js"
import { blogPosts } from "../../../src/lib/db/schema.js"

// Public, unauthenticated list of PUBLISHED blog posts for the marketing site.
// Lightweight payload — no Markdown `content` (that's only returned by the
// single-post endpoint) and reading time is read from the stored column rather
// than re-derived, so the large body never leaves the database. Cursor-less
// offset pagination with a has_more flag.
const DEFAULT_LIMIT = 12
const MAX_LIMIT = 50

function clampInt(value: unknown, fallback: number, max: number): number {
  const n = Number(Array.isArray(value) ? value[0] : value)
  if (!Number.isFinite(n) || n < 0) return fallback
  return Math.min(Math.floor(n), max)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" })

  const limit = clampInt(req.query.limit, DEFAULT_LIMIT, MAX_LIMIT)
  const offset = clampInt(req.query.offset, 0, Number.MAX_SAFE_INTEGER)

  // Fetch one extra row to determine has_more without a separate count query.
  // Order newest-first by publish date; NULLS LAST + a created_at tiebreaker keep
  // ordering deterministic and robust even for unexpected rows.
  const rows = await db
    .select({
      id: blogPosts.id,
      slug: blogPosts.slug,
      title: blogPosts.title,
      excerpt: blogPosts.excerpt,
      coverImageUrl: blogPosts.coverImageUrl,
      tags: blogPosts.tags,
      authorName: blogPosts.authorName,
      status: blogPosts.status,
      publishedAt: blogPosts.publishedAt,
      readingTimeMinutes: blogPosts.readingTimeMinutes,
      createdAt: blogPosts.createdAt,
      updatedAt: blogPosts.updatedAt,
    })
    .from(blogPosts)
    .where(eq(blogPosts.status, "published"))
    .orderBy(sql`${blogPosts.publishedAt} desc nulls last`, desc(blogPosts.createdAt))
    .limit(limit + 1)
    .offset(offset)

  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows

  const posts = page.map((p) => ({
    id: p.id,
    slug: p.slug,
    title: p.title,
    excerpt: p.excerpt,
    cover_image_url: p.coverImageUrl,
    tags: (p.tags as string[]) ?? [],
    author_name: p.authorName,
    status: p.status,
    published_at: p.publishedAt,
    created_at: p.createdAt,
    updated_at: p.updatedAt,
    reading_time_minutes: p.readingTimeMinutes,
  }))

  res.setHeader("Cache-Control", "public, max-age=60")
  return res.json({ posts, has_more: hasMore, limit, offset })
}
