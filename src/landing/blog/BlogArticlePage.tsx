import { I18nextProvider, useTranslation } from "react-i18next"
import { useParams } from "react-router-dom"
import { ArrowLeft, Newspaper, RefreshCw } from "lucide-react"
import landingI18n from "../i18n"
import "../styles/landing.css"
import { Container } from "../components/Container"
import { Button } from "../components/Button"
import { SmartLink } from "../components/SmartLink"
import { Markdown } from "@/components/Markdown"
import { isSafeImageUrl } from "@/lib/blog"
import { BlogShell } from "./BlogShell"
import { useBlogPost, formatBlogDate } from "./useBlog"
import { useSeo } from "./useSeo"

/** Narrow an optional string to an absolute http(s) URL (author profile links). */
function isExternalUrl(url: string | undefined): url is string {
  return !!url && /^https?:\/\//i.test(url)
}

function Article() {
  const { slug } = useParams<{ slug: string }>()
  const { t } = useTranslation()
  const { post, loading, error, notFound, reload } = useBlogPost(slug)

  useSeo({
    title: post ? `${post.seo_title || post.title} — ProfitSync Blog` : undefined,
    description: post ? post.seo_description || post.excerpt || undefined : undefined,
    image: post?.og_image_url || post?.cover_image_url || undefined,
    canonicalPath: slug ? `/blog/${slug}` : undefined,
    type: "article",
  })

  if (loading) {
    return (
      <Container className="max-w-3xl py-12 sm:py-16">
        <div className="h-4 w-24 animate-pulse rounded bg-muted" />
        <div className="mt-8 h-10 w-3/4 animate-pulse rounded bg-muted" />
        <div className="mt-3 h-4 w-1/2 animate-pulse rounded bg-muted" />
        <div className="mt-8 aspect-[16/9] w-full animate-pulse rounded-2xl bg-muted" />
        <div className="mt-8 space-y-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-4 w-full animate-pulse rounded bg-muted" />
          ))}
        </div>
      </Container>
    )
  }

  if (notFound) {
    return (
      <Container className="max-w-3xl py-24 text-center">
        <Newspaper className="mx-auto size-10 text-muted-foreground/60" />
        <h1 className="ps-display mt-4 text-2xl font-bold">{t("blog.notFoundTitle")}</h1>
        <p className="mt-2 text-muted-foreground">{t("blog.notFoundBody")}</p>
        <div className="mt-6 flex justify-center">
          <Button href="/blog" size="md" variant="outline">
            <ArrowLeft className="size-4" />
            {t("blog.backToBlog")}
          </Button>
        </div>
      </Container>
    )
  }

  if (error || !post) {
    return (
      <Container className="max-w-3xl py-24 text-center">
        <p className="text-sm text-muted-foreground">{t("blog.loadError")}</p>
        <button
          onClick={reload}
          className="mt-4 inline-flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-muted cursor-pointer"
        >
          <RefreshCw className="size-4" />
          {t("blog.retry")}
        </button>
      </Container>
    )
  }

  const date = formatBlogDate(post.published_at)

  return (
    <article className="pb-16">
      <Container className="max-w-3xl pt-8 sm:pt-12">
        <SmartLink
          href="/blog"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4 rtl:rotate-180" />
          {t("blog.backToBlog")}
        </SmartLink>

        {post.tags.length > 0 && (
          <div className="mt-6 flex flex-wrap gap-1.5">
            {post.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        <h1 className="ps-display mt-4 text-balance text-3xl font-bold leading-[1.1] sm:text-[2.75rem]">
          {post.title}
        </h1>

        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {post.author_name && <span className="font-medium text-foreground/80">{post.author_name}</span>}
          {post.author_name && date && <span aria-hidden>·</span>}
          {date && <span>{date}</span>}
          <span aria-hidden>·</span>
          <span>{t("blog.readTime", { minutes: post.reading_time_minutes })}</span>
        </div>
      </Container>

      {post.cover_image_url && (
        <Container className="max-w-4xl pt-8">
          <img
            src={post.cover_image_url}
            alt=""
            className="aspect-[16/9] w-full rounded-2xl border border-border object-cover"
          />
        </Container>
      )}

      <Container className="max-w-3xl">
        <Markdown content={post.content} className="mt-8" />
      </Container>

      {/* About the author — E-E-A-T signal (matches the server-rendered byline) */}
      {post.author_name && (post.author_bio || post.author_job_title) && (
        <Container className="max-w-3xl">
          <div className="mt-12 flex items-start gap-4 rounded-2xl border border-border bg-muted/30 p-5">
            {post.author_image_url && isSafeImageUrl(post.author_image_url) ? (
              <img
                src={post.author_image_url}
                alt=""
                className="size-12 shrink-0 rounded-full border border-border object-cover"
              />
            ) : (
              <span className="flex size-12 shrink-0 items-center justify-center rounded-full border border-border bg-background text-sm font-semibold text-muted-foreground">
                {post.author_name.charAt(0).toUpperCase()}
              </span>
            )}
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">
                {isExternalUrl(post.author_url) ? (
                  <a
                    href={post.author_url}
                    target="_blank"
                    rel="author noopener noreferrer"
                    className="underline decoration-primary/40 underline-offset-4 hover:decoration-primary"
                  >
                    {post.author_name}
                  </a>
                ) : (
                  post.author_name
                )}
                {post.author_job_title && (
                  <span className="font-normal text-muted-foreground"> · {post.author_job_title}</span>
                )}
              </p>
              {post.author_bio && <p className="mt-1 text-sm text-muted-foreground">{post.author_bio}</p>}
            </div>
          </div>
        </Container>
      )}

      {/* End-of-article CTA */}
      <Container className="max-w-3xl">
        <div className="mt-16 rounded-3xl border border-border bg-card p-8 text-center sm:p-10">
          <h2 className="ps-display text-2xl font-bold">{t("blog.ctaTitle")}</h2>
          <p className="mx-auto mt-2 max-w-md text-muted-foreground">{t("blog.ctaSubtitle")}</p>
          <div className="mt-6 flex justify-center">
            <Button href="/signup" size="lg">
              {t("blog.ctaButton")}
            </Button>
          </div>
        </div>
      </Container>
    </article>
  )
}

export default function BlogArticlePage() {
  return (
    <I18nextProvider i18n={landingI18n}>
      <BlogShell>
        <Article />
      </BlogShell>
    </I18nextProvider>
  )
}
