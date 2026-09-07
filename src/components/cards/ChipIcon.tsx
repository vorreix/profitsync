import { useId } from "react"
import { cn } from "@/lib/utils"

type IconProps = {
  className?: string
  /** Expose the icon to assistive tech with this name; without it the icon is decorative (aria-hidden). */
  label?: string
}

function a11yProps(label?: string) {
  return label ? ({ role: "img", "aria-label": label } as const) : ({ "aria-hidden": true } as const)
}

/**
 * The EMV contact chip: a gold pad with the classic contact lines. Pure SVG,
 * scales with whatever width the parent gives it (viewBox 40×30).
 */
export function EmvChip({ className, label }: IconProps) {
  const id = useId()
  const gold = `${id}-gold`
  const shine = `${id}-shine`
  return (
    <svg viewBox="0 0 40 30" className={cn("block", className)} {...a11yProps(label)}>
      <defs>
        <linearGradient id={gold} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F6E3A1" />
          <stop offset="0.45" stopColor="#DDBB60" />
          <stop offset="1" stopColor="#A8842C" />
        </linearGradient>
        <linearGradient id={shine} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.45" />
          <stop offset="0.5" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x="0.75" y="0.75" width="38.5" height="28.5" rx="5.5" fill={`url(#${gold})`} stroke="rgba(70,45,0,0.45)" strokeWidth="1" />
      <rect x="0.75" y="0.75" width="38.5" height="28.5" rx="5.5" fill={`url(#${shine})`} />
      <path
        d="M0.75 10.5H13M0.75 19.5H13M27 10.5H39.25M27 19.5H39.25M13 0.75V29.25M27 0.75V29.25"
        fill="none"
        stroke="rgba(70,45,0,0.5)"
        strokeWidth="1"
      />
      <rect x="13" y="9.5" width="14" height="11" rx="3" fill="none" stroke="rgba(70,45,0,0.5)" strokeWidth="1" />
    </svg>
  )
}

/** The contactless-payment waves (four arcs), drawn in currentColor. */
export function ContactlessIcon({ className, label }: IconProps) {
  return (
    <svg
      viewBox="0 0 16 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      className={cn("block", className)}
      {...a11yProps(label)}
    >
      <path d="M3.75 9.32A3.5 3.5 0 0 1 3.75 14.68" />
      <path d="M5.68 7.02A6.5 6.5 0 0 1 5.68 16.98" />
      <path d="M7.61 4.72A9.5 9.5 0 0 1 7.61 19.28" />
      <path d="M9.53 2.42A12.5 12.5 0 0 1 9.53 21.58" />
    </svg>
  )
}
