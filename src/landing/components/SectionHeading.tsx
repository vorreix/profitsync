import { cn } from "../lib/cn"
import { Reveal } from "./Reveal"

export function SectionHeading({
  eyebrow,
  title,
  subtitle,
  align = "center",
  className,
}: {
  eyebrow?: string
  title: string
  subtitle?: string
  align?: "center" | "start"
  className?: string
}) {
  return (
    <Reveal
      className={cn(
        "flex max-w-2xl flex-col gap-4",
        align === "center" ? "mx-auto items-center text-center" : "items-start text-start",
        className,
      )}
    >
      {eyebrow && (
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/50 px-3 py-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <span className="size-1.5 rounded-full bg-emerald-500" />
          {eyebrow}
        </span>
      )}
      <h2 className="ps-display text-balance text-3xl font-bold leading-[1.1] text-foreground sm:text-4xl md:text-[2.75rem]">
        {title}
      </h2>
      {subtitle && (
        <p className="text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">{subtitle}</p>
      )}
    </Reveal>
  )
}
