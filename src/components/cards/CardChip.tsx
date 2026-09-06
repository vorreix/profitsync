import { Link } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { cardDisplayName, maskedTail, resolveCardPalette } from "@/lib/cards"
import type { CardChipProps } from "@/components/cards/types"
import { NetworkMark } from "@/components/cards/NetworkMark"
import { cn } from "@/lib/utils"

const LAST4_RE = /^\d{4}$/

/**
 * The "which card paid" identification on a transaction row: a swatch in the
 * card's colours (with the network glyph) + "•••• 1234", preceded by the
 * localized kind word ("Credit" / "Debit") on sm+ screens. The kind is always
 * in the accessible name, so colour never carries the meaning alone.
 *
 * Renders as a Link to the card page by default; rows are usually buttons, so
 * the click stops propagating. The pill is 20px tall to sit inside a meta line,
 * but its hit area is widened with a pseudo-element (~40px tall) for touch.
 */
export function CardChip({ card, variant = "full", linked = true, className }: CardChipProps) {
  const { t } = useTranslation("transactions")
  const palette = resolveCardPalette({
    tier: card.tier,
    design: card.design,
    brand_colors: card.brand_colors,
    brand_domain: card.account_brand_domain,
  })
  const tail = (card.last4 ?? "").trim()
  const hasTail = LAST4_RE.test(tail)
  const displayName = cardDisplayName({ name: card.name, network: card.network, kind: card.kind, account_bank_name: card.account_bank_name })
  const bank = (card.account_bank_name ?? "").trim()
  const kindWord = t(card.kind === "credit" ? "cardChip.credit" : "cardChip.debit")
  const ariaLabel = hasTail
    ? t("cardChip.a11y", { kind: kindWord, bank: bank || displayName, last4: tail })
    : t("cardChip.a11yNoNumber", { kind: kindWord, name: displayName })
  const title = bank && bank !== displayName ? `${displayName} · ${bank}` : displayName

  const body = (
    <>
      <span
        className="relative block h-3 w-[18px] shrink-0 overflow-hidden rounded-sm shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)]"
        style={{ backgroundImage: `linear-gradient(135deg, ${palette.from}, ${palette.to})` }}
        aria-hidden="true"
      >
        <NetworkMark network={card.network} tone={palette.text} className="absolute bottom-px right-px h-[6px]" />
      </span>
      {hasTail ? (
        <>
          <span className={cn("font-medium", variant === "compact" ? "hidden" : "hidden sm:inline")}>{kindWord}</span>
          <span className="tabular-nums">{maskedTail(tail)}</span>
        </>
      ) : (
        <span className="truncate font-medium">{variant === "compact" ? t("cardChip.noNumber", { name: displayName }) : displayName}</span>
      )}
    </>
  )

  const classes = cn(
    "relative inline-flex h-5 max-w-full items-center gap-1.5 whitespace-nowrap rounded-md border bg-muted/40 ps-1 pe-1.5 align-middle text-xs leading-none text-foreground",
    // Widen the touch/hit area without changing the layout (rows stay compact).
    "before:absolute before:-inset-x-1 before:-inset-y-2.5 before:content-['']",
    linked && "ios-tap transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    className,
  )

  if (linked) {
    return (
      <Link to={`/wealth/cards/${card.id}`} onClick={(e) => e.stopPropagation()} aria-label={ariaLabel} title={title} className={classes}>
        {body}
      </Link>
    )
  }
  return (
    <span title={title} className={classes}>
      <span className="contents" aria-hidden="true">
        {body}
      </span>
      <span className="sr-only">{ariaLabel}</span>
    </span>
  )
}
