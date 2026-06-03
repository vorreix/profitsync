import { useTranslation } from "react-i18next"
import { Container } from "../components/Container"
import { Button } from "../components/Button"
import { Reveal } from "../components/Reveal"
import { SectionHeading } from "../components/SectionHeading"
import { BlogCard } from "../blog/BlogCard"
import { useBlogList } from "../blog/useBlog"

// Landing teaser showing the latest published posts. The section is hidden
// entirely while loading, on error, or when there are no posts yet — so the
// marketing page never shows an empty "Blog" block before any content exists.
export function Blog() {
  const { t } = useTranslation()
  const { posts, loading, error } = useBlogList(3)

  if (loading || error || posts.length === 0) return null

  return (
    <section id="blog" className="py-16 sm:py-24">
      <Container>
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <SectionHeading
            align="start"
            eyebrow={t("blog.eyebrow")}
            title={t("blog.landingTitle")}
            subtitle={t("blog.landingSubtitle")}
          />
          <div className="hidden shrink-0 sm:block">
            <Button href="/blog" variant="outline" size="md">
              {t("blog.viewAll")}
            </Button>
          </div>
        </div>

        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {posts.map((post, i) => (
            <Reveal key={post.id} delay={i * 90}>
              <BlogCard post={post} />
            </Reveal>
          ))}
        </div>

        <div className="mt-8 sm:hidden">
          <Button href="/blog" variant="outline" size="md" className="w-full justify-center">
            {t("blog.viewAll")}
          </Button>
        </div>
      </Container>
    </section>
  )
}
