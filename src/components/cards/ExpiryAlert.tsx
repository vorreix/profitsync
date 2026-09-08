import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { AlertTriangle, ShieldAlert } from "lucide-react"
import type { ExpiryAlertInfo } from "@/components/cards/card-dates"
import { cn } from "@/lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

/** How long the panel survives the pointer leaving, so it can be moved onto. */
const CLOSE_DELAY_MS = 120

const TONE = {
  expired: {
    Icon: ShieldAlert,
    chip: "border-red-500/40 bg-red-500/10 text-red-700 dark:border-red-500/40 dark:bg-red-500/15 dark:text-red-300",
    icon: "text-red-600 dark:text-red-400",
  },
  soon: {
    Icon: AlertTriangle,
    chip: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-300",
    icon: "text-amber-600 dark:text-amber-400",
  },
} as const

/**
 * The expiry chip on a card tile: a coloured symbol + word that opens a short
 * explanation on HOVER (mouse) and on TAP (touch), from one control.
 *
 * Why a Popover and not a Tooltip: Radix's tooltip closes on pointerdown, so it
 * is unreachable by tap, and it needs a TooltipProvider that only the desktop
 * sidebar mounts. A Popover works identically for mouse, touch and keyboard.
 *
 * Three details that are easy to lose on a later edit, so they are spelled out:
 *  - the hover handlers are gated on `pointerType === "mouse"`; without the
 *    gate a tap opens on pointerenter and the trigger's own click closes it
 *    again, and the chip can never be opened by finger.
 *  - `onOpenAutoFocus` is prevented ONLY when hover opened the panel. A mouse
 *    peek must not steal focus; a real click or Enter/Space still should.
 *  - the panel keeps its own pointer handlers and a close delay, so a magnified
 *    or low-vision reader can move the pointer onto the text (WCAG 1.4.13).
 *
 * Colour is never the only signal: each tier carries a distinct icon shape and
 * a word, and the trigger's aria-label states the whole message so a screen
 * reader never has to open the panel at all.
 */
export function ExpiryAlert({ alert, className }: { alert: ExpiryAlertInfo; className?: string }) {
  const { t } = useTranslation("wealth")
  const [open, setOpen] = useState(false)
  const hoverOpened = useRef(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current) }, [])

  const cancelClose = () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null } }
  const openByHover = () => { cancelClose(); hoverOpened.current = true; setOpen(true) }
  const closeSoon = () => { cancelClose(); closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS) }

  const { Icon, chip, icon } = TONE[alert.tier]
  const expired = alert.tier === "expired"
  const left = Math.max(0, alert.days)
  const word = expired ? t("cards.statusExpired") : t("cards.expirySoonChip")
  const title = expired ? t("cards.expiryExpiredTitle") : t("cards.expirySoonTitle")
  const body = expired ? t("cards.expiryExpiredBody", { expiry: alert.expiry }) : t("cards.expirySoonBody", { expiry: alert.expiry, count: left })
  const label = expired ? t("cards.expiryExpiredA11y", { expiry: alert.expiry }) : t("cards.expirySoonA11y", { expiry: alert.expiry, count: left })

  return (
    <Popover
      open={open}
      onOpenChange={(next) => { if (!next) cancelClose(); if (next) hoverOpened.current = false; setOpen(next) }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          onPointerEnter={(e) => { if (e.pointerType === "mouse") openByHover() }}
          onPointerLeave={(e) => { if (e.pointerType === "mouse") closeSoon() }}
          className={cn(
            // The chip is 24px tall; the TAP TARGET is 44px via a transparent
            // ::after that grows only VERTICALLY. Growing it sideways too would
            // scale the tile's dead zone with the translated word — "Läuft bald
            // ab" would swallow taps meant for the card itself.
            "ios-tap relative inline-flex h-6 shrink-0 items-center gap-1 rounded-full border px-2 text-[11px] font-medium",
            "after:absolute after:inset-x-0 after:-inset-y-2.5 after:content-[''] sm:after:hidden",
            "outline-none focus-visible:ring-2 focus-visible:ring-ring",
            chip,
            className,
          )}
        >
          <Icon className="size-3.5 shrink-0" aria-hidden />
          <span>{word}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        // align="center": no DirectionProvider is mounted anywhere in the app,
        // so Radix resolves start/end the LTR way even under <html dir="rtl">.
        side="top"
        align="center"
        sideOffset={8}
        collisionPadding={12}
        onOpenAutoFocus={(e) => { if (hoverOpened.current) e.preventDefault() }}
        onPointerEnter={cancelClose}
        onPointerLeave={closeSoon}
        className="w-[min(18rem,calc(100vw-2rem))] p-3 text-xs leading-relaxed"
      >
        <div className="flex items-start gap-2">
          <Icon className={cn("mt-px size-4 shrink-0", icon)} aria-hidden />
          <div className="min-w-0 space-y-1">
            <p className="text-[13px] font-semibold">{title}</p>
            <p className="text-muted-foreground">{body}</p>
            {/* Plain text, never a button: a second control inside a panel that
                opened on hover is a pointer trap. The kebab is 40px away and
                already offers exactly this action. */}
            <p className="text-muted-foreground/80">{t("cards.expiryAction")}</p>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
