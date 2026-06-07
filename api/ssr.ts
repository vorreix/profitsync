import type { VercelRequest, VercelResponse } from "@vercel/node"
import fs from "node:fs"
import path from "node:path"
import { and, desc, eq, sql } from "drizzle-orm"
import { db } from "../src/lib/db/index.js"
import { blogPosts } from "../src/lib/db/schema.js"
import { isSafeImageUrl } from "../src/lib/blog.js"
import landingEn from "../src/landing/i18n/locales/en.json"
import {
  ORIGIN,
  SITE_NAME,
  DEFAULT_DESCRIPTION,
  buildHead,
  escapeHtml as esc,
  absoluteUrl,
  organizationLd,
  websiteLd,
  softwareApplicationLd,
  faqPageLd,
  breadcrumbLd,
  blogPostingLd,
  blogCollectionLd,
  webPageLd,
} from "../src/lib/seo/site.js"
import { renderMarkdown } from "./_ssr/markdown.js"

// ---------------------------------------------------------------------------
// Server-side render of the PUBLIC pages, plus sitemap.xml / robots.txt /
// llms.txt. This is its own Vercel function (vercel.json rewrites the public
// paths to /api/ssr) so crawlers and AI engines — which don't run JavaScript —
// receive real titles, content, meta tags and JSON-LD in the initial HTML.
//
// Mechanism: read the BUILT index.html template (bundled into this function via
// vercel.json `functions.includeFiles`), inject a per-page <head> and a content
// snapshot into the two HTML comment sentinels, and return it. The app boots
// with createRoot().render() (NOT hydrateRoot), which discards the injected
// snapshot and re-renders — so there is zero hydration-mismatch risk and the
// interactive SPA is unchanged for real users.
// ---------------------------------------------------------------------------

const HEAD_START = "<!--SSR_HEAD_START-->"
const HEAD_END = "<!--SSR_HEAD_END-->"
const ROOT_SENTINEL = "<!--SSR_ROOT-->"

const HTML_CACHE = "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400"
const TEXT_CACHE = "public, max-age=3600"

let cachedTemplate: string | null = null

function loadTemplate(): string {
  if (cachedTemplate !== null) return cachedTemplate
  try {
    const file = path.join(process.cwd(), "api", "_ssr", "index-template.html")
    cachedTemplate = fs.readFileSync(file, "utf8")
  } catch {
    // Degraded fallback (e.g. template not bundled): crawlers still get head +
    // content; in dev the SPA is served by Vite directly so this never runs.
    cachedTemplate = `<!doctype html><html lang="en"><head>${HEAD_START}${HEAD_END}</head><body><div id="root">${ROOT_SENTINEL}</div></body></html>`
  }
  return cachedTemplate
}

function renderDocument(headHtml: string, rootHtml: string): string {
  const template = loadTemplate()
  const start = template.indexOf(HEAD_START)
  const end = template.indexOf(HEAD_END)
  let html = template
  if (start !== -1 && end !== -1) {
    html = template.slice(0, start) + headHtml + template.slice(end + HEAD_END.length)
  }
  return html.replace(ROOT_SENTINEL, rootHtml)
}

function sendHtml(res: VercelResponse, html: string, status = 200): void {
  res.setHeader("Content-Type", "text/html; charset=utf-8")
  res.setHeader("Cache-Control", HTML_CACHE)
  res.status(status).end(html)
}

function formatDate(value: Date | string | null): string {
  if (!value) return ""
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
}

function isoDate(value: Date | string | null): string | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

// --- Data access (published posts only) ------------------------------------

type PostRow = typeof blogPosts.$inferSelect

async function getPublishedPosts(limit: number): Promise<PostRow[]> {
  return db
    .select()
    .from(blogPosts)
    .where(eq(blogPosts.status, "published"))
    .orderBy(sql`${blogPosts.publishedAt} desc nulls last`, desc(blogPosts.createdAt))
    .limit(limit)
}

async function getPostBySlug(slug: string): Promise<PostRow | undefined> {
  const [post] = await db
    .select()
    .from(blogPosts)
    .where(and(eq(blogPosts.slug, slug), eq(blogPosts.status, "published")))
  return post
}

// --- Page renderers ---------------------------------------------------------

function renderLanding(): string {
  const m = landingEn
  const head = buildHead({
    title: m.meta.title,
    description: m.meta.description,
    canonicalPath: "/",
    ogType: "website",
    jsonLd: [
      organizationLd(),
      websiteLd(),
      softwareApplicationLd(),
      faqPageLd(m.faq.items),
    ],
  })

  const features = m.features.items
    .map((f) => `<li><h3>${esc(f.title)}</h3><p>${esc(f.desc)}</p></li>`)
    .join("")
  const steps = m.how.steps
    .map((s, i) => `<li><h3>${i + 1}. ${esc(s.title)}</h3><p>${esc(s.desc)}</p></li>`)
    .join("")
  const faqs = m.faq.items
    .map((item) => `<div><h3>${esc(item.q)}</h3><p>${esc(item.a)}</p></div>`)
    .join("")

  const root = `<div>
  <header><a href="/">${esc(SITE_NAME)}</a>
    <nav><a href="/blog">Blog</a><a href="/login">Log in</a><a href="/signup">Get started</a></nav>
  </header>
  <main>
    <section>
      <h1>${esc(m.hero.titleLine1)} ${esc(m.hero.titleLine2)}</h1>
      <p>${esc(m.hero.subtitle)}</p>
      <p><a href="/signup">${esc(m.hero.ctaPrimary)}</a> <a href="#features">${esc(m.hero.ctaSecondary)}</a></p>
    </section>
    <section id="features">
      <h2>${esc(m.features.title)}</h2>
      <p>${esc(m.features.subtitle)}</p>
      <ul>${features}</ul>
    </section>
    <section>
      <h2>${esc(m.how.title)}</h2>
      <p>${esc(m.how.subtitle)}</p>
      <ol>${steps}</ol>
    </section>
    <section>
      <h2>${esc(m.pricing.title)}</h2>
      <p>${esc(m.pricing.subtitle)}</p>
    </section>
    <section>
      <h2>${esc(m.faq.title)}</h2>
      ${faqs}
    </section>
    <section>
      <h2>${esc(m.cta.title)}</h2>
      <p>${esc(m.cta.subtitle)}</p>
      <p><a href="/signup">${esc(m.cta.primary)}</a></p>
    </section>
  </main>
  <footer>
    <nav><a href="/blog">Blog</a><a href="/privacy-policy">Privacy Policy</a><a href="/terms-of-service">Terms of Service</a></nav>
    <p>${esc(m.footer.tagline)}</p>
  </footer>
</div>`

  return renderDocument(head, root)
}

async function renderBlogIndex(): Promise<string> {
  const posts = await getPublishedPosts(100)
  const head = buildHead({
    title: landingEn.blog.metaTitle,
    description: landingEn.blog.metaDescription,
    canonicalPath: "/blog",
    ogType: "website",
    jsonLd: [
      blogCollectionLd(
        posts.map((p) => ({ slug: p.slug, title: p.title, publishedTime: isoDate(p.publishedAt) })),
      ),
      breadcrumbLd([
        { name: "Home", path: "/" },
        { name: "Blog", path: "/blog" },
      ]),
    ],
  })

  const cards = posts
    .map((p) => {
      const date = formatDate(p.publishedAt)
      const meta = [p.authorName, date].filter(Boolean).join(" · ")
      return `<article>
      <h2><a href="/blog/${esc(p.slug)}">${esc(p.title)}</a></h2>
      ${p.excerpt ? `<p>${esc(p.excerpt)}</p>` : ""}
      ${meta ? `<p>${esc(meta)}</p>` : ""}
    </article>`
    })
    .join("")

  const empty = `<p>${esc(landingEn.blog.emptyBody)}</p>`
  const root = `<div>
  <header><a href="/">${esc(SITE_NAME)}</a><nav><a href="/blog">Blog</a></nav></header>
  <main>
    <h1>${esc(landingEn.blog.title)}</h1>
    <p>${esc(landingEn.blog.subtitle)}</p>
    ${posts.length > 0 ? cards : empty}
  </main>
</div>`

  return renderDocument(head, root)
}

async function renderBlogPost(slug: string): Promise<{ html: string; status: number }> {
  const post = await getPostBySlug(slug)
  if (!post) {
    const head = buildHead({
      title: `${landingEn.blog.notFoundTitle} — ${SITE_NAME}`,
      description: landingEn.blog.notFoundBody,
      canonicalPath: `/blog/${slug}`,
      robots: "noindex, follow",
    })
    const root = `<main><h1>${esc(landingEn.blog.notFoundTitle)}</h1><p>${esc(
      landingEn.blog.notFoundBody,
    )}</p><p><a href="/blog">${esc(landingEn.blog.backToBlog)}</a></p></main>`
    return { html: renderDocument(head, root), status: 404 }
  }

  const tags = (post.tags as string[]) ?? []
  const description = post.seoDescription || post.excerpt || DEFAULT_DESCRIPTION
  const head = buildHead({
    title: `${post.seoTitle || post.title} — ${SITE_NAME} Blog`,
    description,
    canonicalPath: `/blog/${post.slug}`,
    ogType: "article",
    image: post.coverImageUrl || undefined,
    article: {
      publishedTime: isoDate(post.publishedAt),
      modifiedTime: isoDate(post.updatedAt),
      author: post.authorName || null,
      tags,
    },
    jsonLd: [
      blogPostingLd({
        slug: post.slug,
        title: post.title,
        description,
        image: post.coverImageUrl || null,
        author: post.authorName || null,
        publishedTime: isoDate(post.publishedAt),
        modifiedTime: isoDate(post.updatedAt),
      }),
      breadcrumbLd([
        { name: "Home", path: "/" },
        { name: "Blog", path: "/blog" },
        { name: post.title, path: `/blog/${post.slug}` },
      ]),
    ],
  })

  const date = formatDate(post.publishedAt)
  const byline = [post.authorName, date].filter(Boolean).map((s) => esc(String(s))).join(" · ")
  const cover =
    post.coverImageUrl && isSafeImageUrl(post.coverImageUrl)
      ? `<img src="${esc(post.coverImageUrl)}" alt="${esc(post.title)}" />`
      : ""
  const tagsHtml = tags.length ? `<p>${tags.map((t) => esc(t)).join(", ")}</p>` : ""

  const root = `<div>
  <header><a href="/">${esc(SITE_NAME)}</a><nav><a href="/blog">Blog</a></nav></header>
  <main>
    <article>
      <p><a href="/blog">${esc(landingEn.blog.backToBlog)}</a></p>
      ${tagsHtml}
      <h1>${esc(post.title)}</h1>
      ${byline ? `<p>${byline}</p>` : ""}
      ${cover}
      ${renderMarkdown(post.content)}
    </article>
  </main>
</div>`

  return { html: renderDocument(head, root), status: 200 }
}

function renderLegal(kind: "privacy-policy" | "terms-of-service"): string {
  const isPrivacy = kind === "privacy-policy"
  const title = isPrivacy ? "Privacy Policy" : "Terms of Service"
  const description = isPrivacy
    ? `How ${SITE_NAME} collects, uses and protects your personal data, and the rights you have over it.`
    : `The terms that govern your use of ${SITE_NAME}, including accounts, subscriptions, acceptable use and liability.`
  const head = buildHead({
    title: `${title} — ${SITE_NAME}`,
    description,
    canonicalPath: `/${kind}`,
    ogType: "website",
    jsonLd: [
      webPageLd(title, `/${kind}`, description),
      breadcrumbLd([
        { name: "Home", path: "/" },
        { name: title, path: `/${kind}` },
      ]),
    ],
  })
  const root = `<main>
  <h1>${esc(title)}</h1>
  <p>${esc(description)}</p>
  <p><a href="/">${esc(SITE_NAME)}</a></p>
</main>`
  return renderDocument(head, root)
}

// --- sitemap.xml / robots.txt / llms.txt ------------------------------------

async function renderSitemap(res: VercelResponse): Promise<void> {
  const posts = await getPublishedPosts(5000)
  const staticPaths = ["/", "/blog", "/privacy-policy", "/terms-of-service"]
  const urls: string[] = staticPaths.map(
    (p) =>
      `<url><loc>${esc(absoluteUrl(p))}</loc><changefreq>${
        p === "/" || p === "/blog" ? "weekly" : "yearly"
      }</changefreq></url>`,
  )
  for (const post of posts) {
    const lastmod = isoDate(post.updatedAt) || isoDate(post.publishedAt)
    urls.push(
      `<url><loc>${esc(absoluteUrl(`/blog/${post.slug}`))}</loc>${
        lastmod ? `<lastmod>${lastmod}</lastmod>` : ""
      }<changefreq>monthly</changefreq></url>`,
    )
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>`
  res.setHeader("Content-Type", "application/xml; charset=utf-8")
  res.setHeader("Cache-Control", TEXT_CACHE)
  res.status(200).end(xml)
}

function renderRobots(res: VercelResponse): void {
  const body = `# ${SITE_NAME} — robots.txt
User-agent: *
Allow: /
Disallow: /dashboard
Disallow: /admin
Disallow: /api
Disallow: /onboarding
Disallow: /login
Disallow: /signup
Disallow: /forgot-password
Disallow: /reset-password
Disallow: /invitations

# AI / generative-engine crawlers — explicitly welcomed
User-agent: GPTBot
Allow: /
User-agent: ChatGPT-User
Allow: /
User-agent: OAI-SearchBot
Allow: /
User-agent: ClaudeBot
Allow: /
User-agent: Claude-Web
Allow: /
User-agent: anthropic-ai
Allow: /
User-agent: PerplexityBot
Allow: /
User-agent: Google-Extended
Allow: /
User-agent: Applebot-Extended
Allow: /

Sitemap: ${ORIGIN}/sitemap.xml
`
  res.setHeader("Content-Type", "text/plain; charset=utf-8")
  res.setHeader("Cache-Control", TEXT_CACHE)
  res.status(200).end(body)
}

async function renderLlms(res: VercelResponse): Promise<void> {
  const posts = await getPublishedPosts(200)
  const postLines = posts
    .map((p) => {
      const summary = (p.excerpt || "").replace(/\s+/g, " ").trim()
      return `- [${p.title}](${absoluteUrl(`/blog/${p.slug}`)})${summary ? `: ${summary}` : ""}`
    })
    .join("\n")

  const body = `# ${SITE_NAME}

> ${DEFAULT_DESCRIPTION}

${SITE_NAME} is a business finance app for freelancers, agencies and small teams. It brings clients, income and expense transactions, quotations, multi-currency workspaces and a live profit dashboard into one place, with a free plan and an optional Premium subscription.

## Key pages
- [Home](${ORIGIN}/): product overview, features and pricing
- [Blog](${ORIGIN}/blog): guides on cash flow, clients, quotations and running a leaner business
- [Privacy Policy](${ORIGIN}/privacy-policy)
- [Terms of Service](${ORIGIN}/terms-of-service)

## Blog posts
${postLines || "- (no published posts yet)"}
`
  res.setHeader("Content-Type", "text/plain; charset=utf-8")
  res.setHeader("Cache-Control", TEXT_CACHE)
  res.status(200).end(body)
}

// --- Dispatch ---------------------------------------------------------------

function resolveSsrPath(req: VercelRequest): string {
  const fromQuery = req.query.__ssrpath
  if (typeof fromQuery === "string") return fromQuery.replace(/^\/+/, "")
  if (Array.isArray(fromQuery)) return fromQuery.join("/").replace(/^\/+/, "")
  // Fallback: derive from the URL (covers direct hits / local testing).
  const pathname = (req.url ?? "/").split("?")[0]
  return pathname.replace(/^\/+/, "")
}

function serveShell(res: VercelResponse): void {
  // Unknown route: serve the unmodified shell so the SPA can route client-side.
  sendHtml(res, loadTemplate().replace(HEAD_START, "").replace(HEAD_END, "").replace(ROOT_SENTINEL, ""))
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method && req.method !== "GET" && req.method !== "HEAD") {
    res.status(405).end("Method Not Allowed")
    return
  }

  const ssrPath = resolveSsrPath(req)
  const segments = ssrPath.split("/").filter(Boolean)

  try {
    if (ssrPath === "sitemap.xml") return await renderSitemap(res)
    if (ssrPath === "robots.txt") return renderRobots(res)
    if (ssrPath === "llms.txt") return await renderLlms(res)

    if (segments.length === 0) return sendHtml(res, renderLanding())

    if (segments[0] === "blog") {
      if (segments.length === 1) return sendHtml(res, await renderBlogIndex())
      if (segments.length === 2) {
        const { html, status } = await renderBlogPost(decodeURIComponent(segments[1]))
        return sendHtml(res, html, status)
      }
    }

    if (ssrPath === "privacy-policy") return sendHtml(res, renderLegal("privacy-policy"))
    if (ssrPath === "terms-of-service") return sendHtml(res, renderLegal("terms-of-service"))

    return serveShell(res)
  } catch (err) {
    console.error("[ssr] render failed for", ssrPath, err)
    // Never 500 a page route — fall back to the SPA shell so the client renders.
    return serveShell(res)
  }
}
