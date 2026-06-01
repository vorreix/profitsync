import type { AnchorHTMLAttributes, ReactNode } from "react"
import { useSpaNav } from "../lib/useSpaNav"

// An <a> that navigates internal ("/...") routes client-side (no reload) while
// staying a real anchor for hash links, external URLs, SEO, and right-click.
export function SmartLink({
  href,
  children,
  onClick,
  ...rest
}: { href: string; children: ReactNode } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  const spaNav = useSpaNav()
  const handleInternal = spaNav(href)
  return (
    <a
      href={href}
      onClick={(e) => {
        onClick?.(e)
        handleInternal(e)
      }}
      {...rest}
    >
      {children}
    </a>
  )
}
