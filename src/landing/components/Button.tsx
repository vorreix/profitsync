import type { ReactNode } from "react"
import { cn } from "../lib/cn"
import { useSpaNav } from "../lib/useSpaNav"

type Variant = "primary" | "secondary" | "outline" | "ghost"
type Size = "sm" | "md" | "lg"

const base =
  "inline-flex items-center justify-center gap-2 rounded-full font-medium whitespace-nowrap select-none " +
  "transition-[transform,background-color,border-color,color,box-shadow] duration-200 " +
  "active:scale-[0.97] motion-reduce:active:scale-100 disabled:pointer-events-none disabled:opacity-50 " +
  "[-webkit-tap-highlight-color:transparent] cursor-pointer"

const variants: Record<Variant, string> = {
  primary:
    "bg-primary text-primary-foreground shadow-sm hover:shadow-md hover:bg-primary/90 ring-1 ring-inset ring-white/10",
  secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80 ring-1 ring-inset ring-border",
  outline: "border border-border bg-background/60 text-foreground hover:bg-muted/70 backdrop-blur-sm",
  ghost: "text-foreground/80 hover:text-foreground hover:bg-muted/70",
}

const sizes: Record<Size, string> = {
  sm: "h-9 px-4 text-sm",
  md: "h-11 px-5 text-[15px]",
  lg: "h-12 px-7 text-base",
}

type CommonProps = {
  variant?: Variant
  size?: Size
  className?: string
  children: ReactNode
}

type AnchorProps = CommonProps & {
  href: string
  target?: string
  rel?: string
}

type NativeButtonProps = CommonProps & {
  href?: undefined
  type?: "button" | "submit"
  onClick?: () => void
  disabled?: boolean
  "aria-label"?: string
}

function isAnchor(props: AnchorProps | NativeButtonProps): props is AnchorProps {
  return typeof (props as AnchorProps).href === "string"
}

export function Button(props: AnchorProps | NativeButtonProps) {
  const spaNav = useSpaNav()
  const { variant = "primary", size = "md", className, children } = props
  const classes = cn(base, variants[variant], sizes[size], className)

  if (isAnchor(props)) {
    return (
      <a
        href={props.href}
        target={props.target}
        rel={props.rel}
        onClick={props.target ? undefined : spaNav(props.href)}
        className={classes}
      >
        {children}
      </a>
    )
  }

  return (
    <button
      type={props.type ?? "button"}
      onClick={props.onClick}
      disabled={props.disabled}
      aria-label={props["aria-label"]}
      className={classes}
    >
      {children}
    </button>
  )
}
