import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { cn } from "@/lib/utils"
import { isSafeImageUrl } from "@/lib/blog"

// Safe Markdown renderer for blog content. react-markdown builds a real React
// element tree (it does not inject raw HTML strings), with remark-gfm for tables,
// task lists, strikethrough and autolinks. Raw inline HTML in the source is NOT
// enabled (no rehype-raw), so author-supplied markup cannot inject scripts.
// Elements are mapped to explicit Tailwind classes because the project has no
// `prose` (typography) plugin configured.

function isExternal(href: string): boolean {
  return /^https?:\/\//i.test(href)
}

const components: Components = {
  h1: ({ children }) => (
    <h1 className="ps-display mt-10 mb-4 scroll-mt-24 text-3xl font-bold leading-tight text-foreground first:mt-0 sm:text-4xl">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="ps-display mt-10 mb-4 scroll-mt-24 text-2xl font-bold leading-tight text-foreground first:mt-0 sm:text-3xl">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-8 mb-3 scroll-mt-24 text-xl font-semibold text-foreground first:mt-0">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mt-6 mb-2 scroll-mt-24 text-lg font-semibold text-foreground first:mt-0">{children}</h4>
  ),
  p: ({ children }) => <p className="my-5 text-[1.0625rem] leading-8 text-foreground/90">{children}</p>,
  a: ({ href, children }) => {
    const url = href ?? "#"
    const external = isExternal(url)
    return (
      <a
        href={url}
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        className="font-medium text-primary underline decoration-primary/40 underline-offset-4 transition-colors hover:decoration-primary"
      >
        {children}
      </a>
    )
  },
  ul: ({ children }) => <ul className="my-5 ml-6 list-disc space-y-2 text-foreground/90 marker:text-muted-foreground">{children}</ul>,
  ol: ({ children }) => <ol className="my-5 ml-6 list-decimal space-y-2 text-foreground/90 marker:text-muted-foreground">{children}</ol>,
  li: ({ children }) => <li className="leading-7 [&>ul]:my-2 [&>ol]:my-2">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-6 border-s-4 border-primary/40 bg-muted/40 py-2 ps-5 text-foreground/80 italic [&>p]:my-2">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-10 border-border" />,
  img: ({ src, alt }) =>
    typeof src === "string" && isSafeImageUrl(src) ? (
      <img src={src} alt={alt ?? ""} loading="lazy" className="my-6 w-full rounded-2xl border border-border" />
    ) : null,
  pre: ({ children }) => (
    <pre className="my-6 overflow-x-auto rounded-2xl border border-border bg-muted/60 p-4 text-sm leading-relaxed">
      {children}
    </pre>
  ),
  code: ({ className, children }) => {
    const text = String(children ?? "")
    const isBlock = (className && /language-/.test(className)) || text.includes("\n")
    if (isBlock) {
      return <code className={cn("font-mono text-foreground/90", className)}>{children}</code>
    }
    return (
      <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">{children}</code>
    )
  },
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  table: ({ children }) => (
    <div className="my-6 overflow-x-auto rounded-xl border border-border">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/50">{children}</thead>,
  th: ({ children }) => <th className="border-b border-border px-4 py-2.5 text-start font-semibold text-foreground">{children}</th>,
  td: ({ children }) => <td className="border-b border-border px-4 py-2.5 text-foreground/90">{children}</td>,
}

export function Markdown({ content, className }: { content: string; className?: string }) {
  return (
    <div className={cn("text-foreground", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
