import type { MouseEvent } from "react"
import { useNavigate } from "react-router-dom"

// Turns an internal ("/...") anchor click into an instant client-side route
// change instead of a full-page reload — so "Get started" → /signup feels
// instant. Native behavior is preserved for hash links, external URLs, and
// modifier/middle clicks (open-in-new-tab still works). The landing is mounted
// inside the app's <BrowserRouter>, so useNavigate is always available here.
export function useSpaNav() {
  const navigate = useNavigate()
  return (href: string) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (!href.startsWith("/")) return // hash (#...) and external (http...) → native
    if (e.defaultPrevented) return
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    e.preventDefault()
    navigate(href)
  }
}
