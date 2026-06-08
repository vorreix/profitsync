import { ORIGIN } from "../../src/lib/seo/site.js"

// IndexNow (https://www.indexnow.org) — instant indexing protocol supported by
// Bing, Yandex, Naver and Seznam (a submission to any one fans out to all). It is
// how NEW and UPDATED blog posts get crawled within minutes instead of waiting for
// the next organic crawl. Google does not consume IndexNow, but it still discovers
// posts fast via the freshness-stamped sitemap.xml.
//
// Auth is a shared key hosted as a plain-text file at the site root. The default
// key below is committed as public/<key>.txt; override with the INDEXNOW_KEY env
// var only if you ALSO host a matching <key>.txt file at the root.

const DEFAULT_KEY = "b4bdcbcf0c067fd3b056f80dc6e7606d"
export const INDEXNOW_KEY = process.env.INDEXNOW_KEY || DEFAULT_KEY

const HOST = ORIGIN.replace(/^https?:\/\//, "")
const ENDPOINT = "https://api.indexnow.org/indexnow"

function toAbsolute(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl
  return `${ORIGIN}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`
}

/**
 * Notify IndexNow that the given paths (or absolute URLs) changed. Fire-and-forget
 * from the caller's perspective: it never throws, swallows network errors, and is
 * time-boxed so a slow endpoint can't stall the admin response. No-op outside
 * Vercel production so dev/preview never announce profitsync.net URLs.
 */
export async function submitIndexNow(paths: string[]): Promise<void> {
  if (process.env.VERCEL_ENV !== "production") return
  const urlList = Array.from(new Set(paths.map(toAbsolute))).filter(Boolean)
  if (urlList.length === 0) return

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 2500)
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host: HOST,
        key: INDEXNOW_KEY,
        keyLocation: `${ORIGIN}/${INDEXNOW_KEY}.txt`,
        urlList,
      }),
      signal: controller.signal,
    })
    if (!res.ok) console.warn(`[indexnow] ${res.status} submitting ${urlList.length} url(s)`)
  } catch (err) {
    console.warn("[indexnow] submission failed", err)
  } finally {
    clearTimeout(timeout)
  }
}
