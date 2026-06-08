# ProfitSync — SEO & GEO Plan

How ProfitSync is made discoverable in **search engines** (Google, Bing) and **AI
answer engines** (ChatGPT/OpenAI search, Perplexity, Google AI Overviews/Gemini,
Claude, Copilot). Grounded in verified 2025–2026 research (see the research run that
produced this plan). This doc is the source of truth for the SEO/GEO machinery and
the blog content playbook.

> **TL;DR** — Public pages are server-rendered with full `<head>` + JSON-LD
> (`api/ssr.ts`). The blog auto-generates rich schema, an image sitemap entry, and an
> IndexNow ping **on every publish**, so current *and future* posts get crawled and
> indexed automatically. Authors just write good posts following the playbook below.

---

## 1. What's implemented

### Already in place (prior commit)
- **Server-side rendering of public pages** (`api/ssr.ts`): `/`, `/blog`, `/blog/:slug`,
  `/privacy-policy`, `/terms-of-service` ship real titles, meta, canonical, hreflang,
  Open Graph/Twitter and JSON-LD in the initial HTML (crawlers/AI don't run JS).
- `/sitemap.xml`, `/robots.txt`, `/llms.txt` generated dynamically.
- JSON-LD: Organization, WebSite, SoftwareApplication, FAQPage, BreadcrumbList,
  BlogPosting, Blog, WebPage.

### Added in this work
- **Dedicated 1200×630 social card** — `public/og-image.png` (source: `scripts/og-image.html`).
  Replaces the square logo as the default OG image; `og:image:width/height/type/alt` +
  `og:locale` now emitted. Posts override it with `og_image_url` (→ cover → default).
- **`/refund-policy`** is now SSR'd, in the sitemap, and rewritten in `vercel.json`
  (it was a public page invisible to crawlers before).
- **Author E-E-A-T** — new `blog_posts` columns (`author_job_title`, `author_bio`,
  `author_url`, `author_image_url`, `og_image_url`, `article_section`), captured in the
  admin editor, rendered as a visible "About the author" byline, and emitted as a rich
  schema.org `Person` (name, url, jobTitle, image, sameAs, affiliation).
- **Richer `BlogPosting` schema** — `wordCount`, `keywords` (from tags), `dateModified`
  (falls back to published), `inLanguage`, `isAccessibleForFree`, `articleSection`,
  image as array, publisher logo.
- **Automatic FAQPage** — an `## FAQ` / `## Frequently asked questions` section in a post
  (H3 questions → answers) is detected and emitted as FAQPage JSON-LD (`extractFaq`).
- **Image sitemap** — blog cover/OG images are included as `<image:image>` entries;
  home + blog index carry a `lastmod` from the newest post (freshness signal).
- **IndexNow instant indexing** (`api/_lib/indexnow.ts`) — publishing or editing a live
  post pings IndexNow (Bing/Yandex/Naver/Seznam) so new posts are crawled in minutes.
  Key file: `public/b4bdcbcf0c067fd3b056f80dc6e7606d.txt` (override via `INDEXNOW_KEY`).
- **Modernized `robots.txt`** — welcomes all major AI crawlers (training **and**
  retrieval — we want maximum visibility) with verified 2025–26 tokens; deprecated
  `Claude-Web`/`anthropic-ai` removed; private app routes disallowed per-group.
- **Enriched SoftwareApplication schema** + aligned static `index.html` fallback head.
- **Seed content** — `scripts/seed-blog.ts` publishes 6 playbook-structured pillar posts
  (`npm run seed-blog`).

---

## 2. How current & future blogs get crawled automatically

Nothing manual is required per post. When an admin publishes (or edits a live post):

1. **Rendered for crawlers** — `/blog/:slug` is SSR'd with full schema, OG tags, FAQ
   (if present) and a visible author byline.
2. **Sitemap updates** — `/sitemap.xml` lists every published post (with `lastmod` and an
   image entry) on the next request; home/blog `lastmod` reflects the newest post.
3. **IndexNow ping** — `submitIndexNow()` notifies Bing/Yandex/Naver/Seznam immediately
   (production only; fire-and-forget, never blocks the save).
4. **Google** discovers it via the freshness-stamped sitemap (Google doesn't use IndexNow).

> One-time: submit `https://profitsync.net/sitemap.xml` in **Google Search Console** and
> **Bing Webmaster Tools**, and register the IndexNow key in Bing. After that it's automatic.

---

## 3. Blog content playbook (write every post like this)

Verified research shows AI engines cite **answer-first, well-structured, sourced** content
far more often. Follow this checklist:

- **Answer-first intro / TL;DR** (40–75 words) that directly answers the title's question.
- **One H1 (the title), then clean H2 → H3 nesting** (no skipped levels). H3s are the
  citation-sized chunks AI extracts.
- **Modular paragraphs** (< ~120 words when stating facts); single-sentence key claims.
- **At least one table or list** (comparisons, steps, feature matrices).
- **A pull quote or two** (40–75 words) for the memorable takeaway.
- **An `## FAQ` section** (H3 question → short answer) — auto-emitted as FAQPage schema.
- **Internal links** to related posts/pillars with **descriptive anchor text**.
- **Author byline with credentials** (set `author_job_title`, `author_bio`, optionally
  `author_url`/`author_image_url`).
- **Honest, sourced claims only.** Do **not** invent statistics or fake citations — verified
  research flags fabricated numbers as a ranking *and* trust risk.
- **Target ~1,500–2,500 words** when the topic supports it; never pad.
- **Don't date-bump.** `updated_at` should change only on substantive edits.

The seeded posts in `scripts/seed-blog.ts` are working examples of this structure.

---

## 4. Keyword & topic clusters (pillars)

Build topical authority by clustering posts around five pillars. Each pillar pairs a
broad guide with supporting how-to/long-tail posts that interlink.

| Pillar | Owns keywords like | Seeded post |
| --- | --- | --- |
| **Profit Tracking** | profit tracking, profit vs revenue, profit dashboard | `how-to-track-profit-small-business`, `profit-vs-cash-flow` |
| **Expenses & Tax** | expense management, business expense tracking, tax deductions | `expense-management-for-freelancers` |
| **Cash Flow** | cash flow management, payment terms, late payments | `cash-flow-management-for-freelancers` |
| **Quotations** | how to write a quotation, quote vs invoice, proposals | `how-to-write-a-quotation` |
| **Multi-Currency** | multi-currency accounting, FX fees, international invoicing | `multi-currency-accounting-for-freelancers` |

---

## 5. AI crawler / robots policy

ProfitSync is a young product that **wants** maximum AI visibility, and the public site has
no proprietary data to withhold — so `robots.txt` welcomes both **training** and
**retrieval** AI crawlers, while disallowing the private app/API surface. Tokens are
verified against vendor docs; see `AI_CRAWLERS` in `api/ssr.ts`.

> **Quarterly review:** new AI crawlers appear often (xAI/Grok, Gemini-specific agents,
> etc.). Each quarter, re-check vendor docs and update `AI_CRAWLERS` / `ROBOTS_DISALLOW`.

---

## 6. Operational notes

- **IndexNow key:** default key is committed at `public/<key>.txt`. To rotate, set
  `INDEXNOW_KEY` env var **and** host a matching `<key>.txt` at the site root.
- **Regenerate the OG image:** edit `scripts/og-image.html`, then render it at a
  1200×630 viewport (e.g. headless Chrome `--screenshot`) into `public/og-image.png`.
- **Seed/refresh blog content:** `npm run seed-blog` (idempotent — updates by slug,
  preserves publish dates). Run against the target DB's `DATABASE_URL`.
- **New blog column?** Update `blog_posts` schema → `npm run db:generate` → ensure the new
  migration's journal `when` exceeds the previous (see the migration-timestamp note in
  project memory) → it auto-applies on deploy.

---

## 7. Roadmap (high-value follow-ups, intentionally out of scope here)

These are content/marketing initiatives rather than SEO *plumbing*; the machinery above
makes them effective when built:

- **Comparison pages** (`/comparison/profitsync-vs-…`) — high-intent, high-converting.
- **`/solutions` use-case hub** — landing pages per audience/use case.
- **Author profile pages** (`/team/:slug`) — strengthen `author.url` E-E-A-T linkage.
- **Expand each pillar to 8–12 interlinked posts** for durable topical authority.
- **Bot-traffic monitoring** in the admin console — verify crawler compliance over time.
- **A dedicated per-pillar OG image** set.
