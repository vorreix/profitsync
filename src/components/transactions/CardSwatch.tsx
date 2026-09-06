import type { Card } from "@/lib/types"
import { resolveCardPalette } from "@/lib/cards"
import { cn } from "@/lib/utils"

export type CardSwatchSource = Pick<Card, "tier" | "design" | "brand_colors"> & { account_brand_domain?: string | null }

/**
 * The 18×12 gradient swatch every picker/list uses to identify a card at a
 * glance — painted in the same palette as the card visual (src/lib/cards.ts
 * resolveCardPalette), so a gold card is gold here too. Decorative only: the
 * text next to it carries the meaning.
 */
export function CardSwatch({ card, className }: { card: CardSwatchSource; className?: string }) {
  const p = resolveCardPalette({ tier: card.tier, design: card.design, brand_colors: card.brand_colors, brand_domain: card.account_brand_domain })
  return (
    <span
      aria-hidden
      className={cn("inline-block h-3 w-[18px] shrink-0 rounded-[3px] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.14)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)]", className)}
      style={{ backgroundImage: `linear-gradient(135deg, ${p.from} 0%, ${p.to} 100%)` }}
    />
  )
}
