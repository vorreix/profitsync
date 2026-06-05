import { useCallback, useEffect, useRef } from "react"
import { useLocation, useNavigate, useSearchParams } from "react-router-dom"

/**
 * Drives a modal whose open/closed state lives in a URL search param (e.g.
 * `?view=<id>`), so the browser/OS back button closes it instead of leaving
 * the page — and the URL stays shareable/deep-linkable.
 *
 * - `open(id)` pushes a history entry, so back pops it and closes the modal.
 * - `close()` pops that entry (back) when we pushed it; for a deep-linked open
 *   (param already in the URL on load) it just strips the param in place so we
 *   never accidentally navigate away from the app.
 */
export function useUrlModal(key: string) {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const location = useLocation()
  const pushedRef = useRef(false)
  const value = searchParams.get(key)

  // A browser/OS back (or forward) pops the entry we pushed, so the flag must
  // reset — otherwise a later close() would wrongly navigate(-1) again.
  useEffect(() => {
    const onPop = () => { pushedRef.current = false }
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
  }, [])

  const searchWith = useCallback(
    (mutate: (p: URLSearchParams) => void) => {
      const next = new URLSearchParams(location.search)
      mutate(next)
      const qs = next.toString()
      return qs ? `?${qs}` : ""
    },
    [location.search],
  )

  const open = useCallback(
    (id: string) => {
      pushedRef.current = true
      navigate({ search: searchWith((p) => p.set(key, id)) }, { replace: false })
    },
    [key, navigate, searchWith],
  )

  const close = useCallback(() => {
    if (pushedRef.current) {
      pushedRef.current = false
      navigate(-1)
    } else {
      navigate({ search: searchWith((p) => p.delete(key)) }, { replace: true })
    }
  }, [key, navigate, searchWith])

  return { value, open, close }
}
