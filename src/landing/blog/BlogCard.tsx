import { useTranslation } from "react-i18next"
import { Newspaper } from "lucide-react"
import { SmartLink } from "../components/SmartLink"
import { formatBlogDate, type BlogSummary } from "./useBlog"

// A single blog post card linking to /blog/:slug. Used on the blog index and the
// landing teaser. Rendered inside the landing i18n provider.
export function BlogCard({ post }: { post: BlogSummary }) {
  const { t } = useTranslation()
  const date = formatBlogDate(post.published_at)
  return (
    <SmartLink
      href={`/blog/${post.slug}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
    >
      <div className="aspect-[16/9] overflow-hidden bg-muted">
        {post.cover_image_url ? (
          <img
            src={post.cover_image_url}
            alt=""
            loading="lazy"
            className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="grid size-full place-items-center text-muted-foreground/50">
            <Newspaper className="size-10" />
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col p-5">
        {post.tags.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {post.tags.slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
        <h3 className="ps-display line-clamp-2 text-lg font-semibold leading-snug text-foreground transition-colors group-hover:text-primary">
          {post.title}
        </h3>
        {post.excerpt && (
          <p className="mt-2 line-clamp-2 flex-1 text-sm leading-relaxed text-muted-foreground">{post.excerpt}</p>
        )}
        <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          {date && <span>{date}</span>}
          {date && <span aria-hidden>·</span>}
          <span>{t("blog.readTime", { minutes: post.reading_time_minutes })}</span>
        </div>
      </div>
    </SmartLink>
  )
}
