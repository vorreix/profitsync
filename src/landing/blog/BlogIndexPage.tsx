import { useCallback, useEffect, useState } from "react"
import { I18nextProvider, useTranslation } from "react-i18next"
import { Loader as Loader2, Newspaper, RefreshCw } from "lucide-react"
import landingI18n from "../i18n"
import "../styles/landing.css"
import { Container } from "../components/Container"
import { Button } from "../components/Button"
import { BlogShell } from "./BlogShell"
import { BlogCard } from "./BlogCard"
import { fetchBlogPosts, type BlogSummary } from "./useBlog"
import { useSeo } from "./useSeo"

const PAGE_SIZE = 9

function BlogIndex() {
  const { t } = useTranslation()
  useSeo({
    title: t("blog.metaTitle"),
    description: t("blog.metaDescription"),
    canonicalPath: "/blog",
  })

  const [posts, setPosts] = useState<BlogSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)

  const loadInitial = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const data = await fetchBlogPosts({ limit: PAGE_SIZE })
      setPosts(data.posts)
      setHasMore(data.has_more)
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadInitial()
  }, [loadInitial])

  const loadMore = async () => {
    setLoadingMore(true)
    try {
      const data = await fetchBlogPosts({ limit: PAGE_SIZE, offset: posts.length })
      setPosts((prev) => [...prev, ...data.posts])
      setHasMore(data.has_more)
    } catch {
      // keep what we have; surface a gentle hint via the button staying available
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <>
      {/* Header */}
      <section className="border-b border-border bg-muted/20">
        <Container className="py-16 sm:py-20">
          <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            {t("blog.eyebrow")}
          </span>
          <h1 className="ps-display mt-4 max-w-2xl text-balance text-4xl font-bold leading-[1.1] sm:text-5xl">
            {t("blog.title")}
          </h1>
          <p className="mt-4 max-w-xl text-pretty text-base text-muted-foreground sm:text-lg">
            {t("blog.subtitle")}
          </p>
        </Container>
      </section>

      {/* Posts */}
      <Container className="py-12 sm:py-16">
        {loading ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="overflow-hidden rounded-2xl border border-border bg-card">
                <div className="aspect-[16/9] animate-pulse bg-muted" />
                <div className="space-y-3 p-5">
                  <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
                  <div className="h-3 w-full animate-pulse rounded bg-muted" />
                  <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-border bg-card p-12 text-center">
            <p className="text-sm text-muted-foreground">{t("blog.loadError")}</p>
            <button
              onClick={loadInitial}
              className="mt-4 inline-flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-muted cursor-pointer"
            >
              <RefreshCw className="size-4" />
              {t("blog.retry")}
            </button>
          </div>
        ) : posts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-16 text-center">
            <Newspaper className="mx-auto size-10 text-muted-foreground/60" />
            <p className="mt-4 text-base font-medium">{t("blog.emptyTitle")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t("blog.emptyBody")}</p>
          </div>
        ) : (
          <>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {posts.map((post) => (
                <BlogCard key={post.id} post={post} />
              ))}
            </div>
            {hasMore && (
              <div className="mt-10 flex justify-center">
                <Button variant="outline" size="md" onClick={loadMore} disabled={loadingMore}>
                  {loadingMore && <Loader2 className="size-4 animate-spin" />}
                  {t("blog.loadMore")}
                </Button>
              </div>
            )}
          </>
        )}
      </Container>
    </>
  )
}

export default function BlogIndexPage() {
  return (
    <I18nextProvider i18n={landingI18n}>
      <BlogShell>
        <BlogIndex />
      </BlogShell>
    </I18nextProvider>
  )
}
