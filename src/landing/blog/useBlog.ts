import { useCallback, useEffect, useState } from "react"

// Client for the public blog endpoints (api/_routes/public/blog*). Unauthenticated
// raw fetch — same approach as usePricing. Types mirror the JSON the endpoints
// return (snake_case), kept local so the landing stays self-contained.

export type BlogSummary = {
  id: string
  slug: string
  title: string
  excerpt: string
  cover_image_url: string
  tags: string[]
  author_name: string
  published_at: string | null
  created_at: string
  updated_at: string
  reading_time_minutes: number
}

export type BlogArticle = BlogSummary & {
  content: string
  seo_title: string
  seo_description: string
  // Author E-E-A-T + social fields (returned only by the single-post endpoint).
  author_job_title: string
  author_bio: string
  author_url: string
  author_image_url: string
  og_image_url: string
  article_section: string
}

export type BlogListResponse = {
  posts: BlogSummary[]
  has_more: boolean
  limit: number
  offset: number
}

export async function fetchBlogPosts(opts: { limit?: number; offset?: number } = {}): Promise<BlogListResponse> {
  const params = new URLSearchParams()
  if (opts.limit != null) params.set("limit", String(opts.limit))
  if (opts.offset != null) params.set("offset", String(opts.offset))
  const qs = params.toString()
  const res = await fetch(`/api/public/blog${qs ? `?${qs}` : ""}`, { headers: { Accept: "application/json" } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as BlogListResponse
}

type ListState = {
  posts: BlogSummary[]
  loading: boolean
  error: boolean
  hasMore: boolean
}

/** Fetch a single page of published posts (used by the landing teaser). */
export function useBlogList(limit = 12) {
  const [state, setState] = useState<ListState>({ posts: [], loading: true, error: false, hasMore: false })

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: false }))
    try {
      const data = await fetchBlogPosts({ limit })
      setState({ posts: data.posts, loading: false, error: false, hasMore: data.has_more })
    } catch {
      setState({ posts: [], loading: false, error: true, hasMore: false })
    }
  }, [limit])

  useEffect(() => {
    load()
  }, [load])

  return { ...state, reload: load }
}

type PostState = {
  post: BlogArticle | null
  loading: boolean
  error: boolean
  notFound: boolean
}

/** Fetch a single published post by slug (used by the article page). */
export function useBlogPost(slug: string | undefined) {
  const [state, setState] = useState<PostState>({ post: null, loading: true, error: false, notFound: false })

  const load = useCallback(async () => {
    if (!slug) {
      setState({ post: null, loading: false, error: false, notFound: true })
      return
    }
    setState({ post: null, loading: true, error: false, notFound: false })
    try {
      const res = await fetch(`/api/public/blog/${encodeURIComponent(slug)}`, {
        headers: { Accept: "application/json" },
      })
      if (res.status === 404) {
        setState({ post: null, loading: false, error: false, notFound: true })
        return
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const post = (await res.json()) as BlogArticle
      setState({ post, loading: false, error: false, notFound: false })
    } catch {
      setState({ post: null, loading: false, error: true, notFound: false })
    }
  }, [slug])

  useEffect(() => {
    load()
  }, [load])

  return { ...state, reload: load }
}

/** Format a published date for display (e.g. "Jun 3, 2026"). */
export function formatBlogDate(value: string | null | undefined): string {
  if (!value) return ""
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
}
