import { useEffect } from "react"

// Lightweight document <head> management for the public blog pages. The app has
// no react-helmet, so this mirrors the landing's approach (LandingPage sets
// document.title + meta[name=description] directly) and extends it to og/twitter
// tags and a canonical link, creating them if absent. Values are applied on mount
// and whenever they change; other routes set their own title when navigated to.

type SeoInput = {
  title?: string
  description?: string
  image?: string
  canonicalPath?: string // e.g. "/blog/my-post"
  type?: "website" | "article"
}

function setMetaByName(name: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)
  if (!el) {
    el = document.createElement("meta")
    el.setAttribute("name", name)
    document.head.appendChild(el)
  }
  el.setAttribute("content", content)
}

function setMetaByProp(property: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[property="${property}"]`)
  if (!el) {
    el = document.createElement("meta")
    el.setAttribute("property", property)
    document.head.appendChild(el)
  }
  el.setAttribute("content", content)
}

function setCanonical(href: string) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (!el) {
    el = document.createElement("link")
    el.setAttribute("rel", "canonical")
    document.head.appendChild(el)
  }
  el.setAttribute("href", href)
}

export function useSeo({ title, description, image, canonicalPath, type = "website" }: SeoInput) {
  useEffect(() => {
    if (title) {
      document.title = title
      setMetaByProp("og:title", title)
      setMetaByName("twitter:title", title)
    }
    if (description) {
      setMetaByName("description", description)
      setMetaByProp("og:description", description)
      setMetaByName("twitter:description", description)
    }
    if (image) {
      setMetaByProp("og:image", image)
      setMetaByName("twitter:image", image)
    }
    setMetaByProp("og:type", type)
    if (canonicalPath && typeof window !== "undefined") {
      setCanonical(`${window.location.origin}${canonicalPath}`)
    }
  }, [title, description, image, canonicalPath, type])
}
