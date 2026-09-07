import { CreditCard } from "lucide-react"
import { NETWORK_LABEL, isCardNetwork } from "@/lib/cards"
import type { CardNetwork } from "@/lib/types"
import { cn } from "@/lib/utils"

/** Human label for a network ("Visa", "Mastercard", … "Card" for unknown). */
// eslint-disable-next-line react-refresh/only-export-components -- tiny helper that belongs with the mark
export function networkLabel(network: CardNetwork | string | null | undefined): string {
  return isCardNetwork(network) ? NETWORK_LABEL[network] : NETWORK_LABEL.other
}

export type NetworkMarkProps = {
  network: CardNetwork | string
  /** The surface the mark sits on: "light" = white wordmarks (dark card), "dark" = navy/ink wordmarks (light card). */
  tone?: "light" | "dark"
  /** Sets the height (e.g. `h-6`); the width follows the mark's own ratio. */
  className?: string
  /** Expose the mark with this name; without it the mark is decorative (aria-hidden). */
  label?: string
}

const WORDMARK_FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif"
// SVG <text> inherits the document direction: in an RTL UI a start-anchored
// wordmark would be laid out leftwards and vanish off-canvas. Marks are Latin
// artwork, so pin them to LTR wherever they render (chips in an Arabic list).
const LTR = { direction: "ltr", unicodeBidi: "isolate" } as const

/**
 * Stylised network marks that read instantly (a Visa wordmark, the two
 * Mastercard circles, the JCB bars…) without reproducing any trademark
 * artwork. Every mark is an inline SVG with a 24-unit-tall viewBox so a
 * single height class sizes them all consistently.
 */
export function NetworkMark({ network, tone = "light", className, label }: NetworkMarkProps) {
  const a11y = label ? ({ role: "img", "aria-label": label } as const) : ({ "aria-hidden": true } as const)
  const cls = cn("block w-auto shrink-0", className)
  const ink = tone === "light" ? "#FFFFFF" : "#1A1F71"

  switch (network) {
    case "visa":
      return (
        <svg viewBox="0 0 62 24" className={cls} style={LTR} {...a11y}>
          <text
            x="1"
            y="21"
            fontFamily={WORDMARK_FONT}
            fontSize="26"
            fontWeight="800"
            fontStyle="italic"
            fill={ink}
            textLength="60"
            lengthAdjust="spacingAndGlyphs"
          >
            VISA
          </text>
        </svg>
      )
    case "mastercard":
      return <TwinCircles className={cls} a11y={a11y} left="#EB001B" right="#F79E1B" blend="#FF5F00" />
    case "maestro":
      return <TwinCircles className={cls} a11y={a11y} left="#ED0006" right="#0099DF" blend="#6C6BBD" />
    case "amex":
      return (
        <svg viewBox="0 0 40 24" className={cls} style={LTR} {...a11y}>
          <rect width="40" height="24" rx="3.5" fill="#2E77BC" />
          <text
            x="20"
            y="16.5"
            textAnchor="middle"
            fontFamily={WORDMARK_FONT}
            fontSize="12"
            fontWeight="800"
            fill="#FFFFFF"
            textLength="30"
            lengthAdjust="spacingAndGlyphs"
          >
            AMEX
          </text>
        </svg>
      )
    case "rupay":
      return (
        <svg viewBox="0 0 68 24" className={cls} style={LTR} {...a11y}>
          <text
            x="0"
            y="19"
            fontFamily={WORDMARK_FONT}
            fontSize="20"
            fontWeight="800"
            fontStyle="italic"
            fill={tone === "light" ? "#FFFFFF" : "#1F2A5F"}
            textLength="46"
            lengthAdjust="spacingAndGlyphs"
          >
            RuPay
          </text>
          <path d="M50 4h6l-4.2 16h-6z" fill="#F47920" />
          <path d="M58 4h6l-4.2 16h-6z" fill="#097A49" />
        </svg>
      )
    case "discover":
      return (
        <svg viewBox="0 0 74 24" className={cls} style={LTR} {...a11y}>
          <text
            x="0"
            y="17.5"
            fontFamily={WORDMARK_FONT}
            fontSize="14"
            fontWeight="800"
            fill={tone === "light" ? "#FFFFFF" : "#231F20"}
            textLength="58"
            lengthAdjust="spacingAndGlyphs"
          >
            DISCOVER
          </text>
          <circle cx="67.5" cy="12" r="5.5" fill="#FF6000" />
        </svg>
      )
    case "jcb":
      return (
        <svg viewBox="0 0 36 24" className={cls} {...a11y}>
          <rect x="0" y="0" width="10" height="24" rx="3" fill="#0E4C96" />
          <rect x="13" y="0" width="10" height="24" rx="3" fill="#D0021B" />
          <rect x="26" y="0" width="10" height="24" rx="3" fill="#0D9A4A" />
        </svg>
      )
    case "unionpay":
      return (
        <svg viewBox="0 0 42 24" className={cls} {...a11y}>
          <path d="M6 0h12a2 2 0 0 1 1.9 2.6l-5 19A3.2 3.2 0 0 1 11.8 24H0a2 2 0 0 1-1.9-2.6l5-19A3.2 3.2 0 0 1 6 0Z" fill="#E21836" transform="translate(2 0)" />
          <path d="M6 0h12a2 2 0 0 1 1.9 2.6l-5 19A3.2 3.2 0 0 1 11.8 24H0a2 2 0 0 1-1.9-2.6l5-19A3.2 3.2 0 0 1 6 0Z" fill="#00447C" transform="translate(13 0)" />
          <path d="M6 0h12a2 2 0 0 1 1.9 2.6l-5 19A3.2 3.2 0 0 1 11.8 24H0a2 2 0 0 1-1.9-2.6l5-19A3.2 3.2 0 0 1 6 0Z" fill="#007B84" transform="translate(24 0)" />
        </svg>
      )
    case "diners":
      return (
        <svg viewBox="0 0 24 24" className={cls} {...a11y}>
          <circle cx="12" cy="12" r="10.5" fill={tone === "light" ? "rgba(255,255,255,0.92)" : "#FFFFFF"} stroke="#0079BE" strokeWidth="2" />
          <rect x="9" y="5" width="6" height="14" rx="3" fill="#0079BE" />
        </svg>
      )
    default:
      return <CreditCard className={cn("block shrink-0", className)} {...a11y} />
  }
}

/** Mastercard / Maestro: two overlapping circles with a blended lens. */
function TwinCircles({
  className,
  a11y,
  left,
  right,
  blend,
}: {
  className: string
  a11y: Record<string, unknown>
  left: string
  right: string
  blend: string
}) {
  return (
    <svg viewBox="0 0 38 24" className={className} {...a11y}>
      <circle cx="12" cy="12" r="11" fill={left} />
      <circle cx="26" cy="12" r="11" fill={right} />
      <path d="M19 3.515A11 11 0 0 1 19 20.485A11 11 0 0 1 19 3.515Z" fill={blend} />
    </svg>
  )
}
