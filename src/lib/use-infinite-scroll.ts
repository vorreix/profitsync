import { useEffect, useRef, useState } from "react"

interface InfiniteScrollOptions {
  /** More pages remain to fetch. When false the observer stays idle. */
  hasMore: boolean
  /** A page fetch is in flight. Prevents overlapping loads. */
  loading: boolean
  /** Fetch the next page. Called at most once per load cycle while the sentinel is visible. */
  onLoadMore: () => void
  /** How far before the sentinel enters the viewport to prefetch. Default 400px. */
  rootMargin?: string
  /** Master switch (e.g. disable while searching or on an empty list). Default true. */
  enabled?: boolean
}

/**
 * The pure trigger predicate: fetch the next page only when the sentinel is on
 * screen, more pages remain, nothing is already loading, and the feature is on.
 * Extracted so it can be unit-tested without a DOM (the observer wiring itself is
 * browser-verified).
 */
export function shouldLoadMore(s: {
  isIntersecting: boolean
  hasMore: boolean
  loading: boolean
  enabled: boolean
}): boolean {
  return s.isIntersecting && s.hasMore && !s.loading && s.enabled
}

/**
 * Auto infinite scroll built on `IntersectionObserver`. Attach the returned
 * `sentinelRef` to a small element rendered just below the list; when it nears
 * the viewport (`rootMargin`) `onLoadMore` fires — once per load cycle.
 *
 * The "keep loading while still visible" behaviour is intentional: `loading` is a
 * dependency of the trigger effect, so when a fetch finishes and the sentinel is
 * *still* on screen (short list / tall viewport) the next page loads automatically,
 * until the sentinel is pushed off-screen or `hasMore` goes false.
 *
 * Degrades safely: no `IntersectionObserver` (very old WebView) or SSR → the hook
 * simply never fires, and callers keep their visible "Load More" button as the
 * manual fallback.
 *
 *   const { sentinelRef } = useInfiniteScroll({ hasMore, loading, onLoadMore: loadNext })
 *   ...
 *   {hasMore && <div ref={sentinelRef} aria-hidden className="h-px" />}
 *
 * Contract: `onLoadMore` MUST flip `loading` to true synchronously (a `setState`
 * before any `await`), so the trigger effect sees the in-flight state and does not
 * double-fire the same page.
 */
export function useInfiniteScroll({
  hasMore,
  loading,
  onLoadMore,
  rootMargin = "400px",
  enabled = true,
}: InfiniteScrollOptions) {
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const [isIntersecting, setIsIntersecting] = useState(false)

  // Keep the latest callback without re-subscribing the observer every render.
  const onLoadMoreRef = useRef(onLoadMore)
  useEffect(() => {
    onLoadMoreRef.current = onLoadMore
  })

  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !enabled || typeof IntersectionObserver === "undefined") {
      setIsIntersecting(false)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => setIsIntersecting(entries[0]?.isIntersecting ?? false),
      { rootMargin },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [enabled, rootMargin])

  useEffect(() => {
    if (shouldLoadMore({ isIntersecting, hasMore, loading, enabled })) {
      onLoadMoreRef.current()
    }
  }, [isIntersecting, hasMore, loading, enabled])

  return { sentinelRef }
}
