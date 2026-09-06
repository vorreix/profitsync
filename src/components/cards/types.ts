// Shared prop contracts for the card UI (src/components/cards/*). Kept in one
// file so the visual, the chip, the wizard and the pages can be built against
// the same shapes.
import type { Card, CardDesign, CardKind, CardNetwork, CardTier, BrandColor } from "@/lib/types"

/**
 * Everything the realistic card visual needs. It renders from PLAIN values so
 * the add-card wizard can preview a card that does not exist yet.
 */
export type CardVisualProps = {
  kind: CardKind
  network: CardNetwork | string
  tier: CardTier | string
  design?: CardDesign | Partial<CardDesign> | null
  brand_colors?: BrandColor[] | null
  /** The linked bank's domain — curated palette fallback (src/lib/cards.ts). */
  brand_domain?: string | null
  /** Brandfetch wordmark for a dark surface (may be empty / may 404 → falls back to the icon + bank name). */
  brand_logo_url?: string | null
  /** The bank's stored logo (data URL) — the reliable fallback for the wordmark slot. */
  bank_logo_src?: string | null
  bank_name?: string | null
  /** Nickname shown on the card (falls back to bank + network). */
  name?: string | null
  holder_name?: string | null
  last4?: string | null
  expiry_month?: number | null
  expiry_year?: number | null
  status?: "active" | "frozen" | "closed" | string
  /** sm = list/chip-sized (~160px wide), md = grid tile, lg = detail hero. Width is fluid; this sets typography + detail density. */
  size?: "sm" | "md" | "lg"
  /** Extra classes on the outer element (width/aspect are intrinsic: aspect-ratio 1.586). */
  className?: string
  /** Disable the hover lift (e.g. inside a button that already animates). */
  still?: boolean
  /** Fires when the wordmark image fails so a parent can react (optional). */
  onLogoError?: () => void
}

/** Build the visual props from an API card row. */
export function visualPropsFromCard(card: Card): CardVisualProps {
  return {
    kind: card.kind,
    network: card.network,
    tier: card.tier,
    design: card.design,
    brand_colors: card.brand_colors,
    brand_domain: card.account_brand_domain ?? null,
    brand_logo_url: card.brand_logo_url,
    bank_logo_src: card.account_logo_src ?? card.account_logo_url ?? null,
    bank_name: card.account_bank_name ?? null,
    name: card.name,
    holder_name: card.holder_name,
    last4: card.last4,
    expiry_month: card.expiry_month,
    expiry_year: card.expiry_year,
    status: card.status,
  }
}

/**
 * The compact "which card paid" identification shown next to a transaction:
 * a palette swatch + network mark + "•••• 1234", with the localized kind word
 * ("Credit" / "Debit") on wide screens and always in the accessible name.
 */
export type CardChipProps = {
  card: Pick<Card, "id" | "kind" | "network" | "tier" | "design" | "brand_colors" | "last4" | "name"> & {
    account_bank_name?: string | null
    account_brand_domain?: string | null
  }
  /** "full" = kind word + tail; "compact" = swatch + tail only (narrow rows). Default: full on sm+, compact below (via CSS). */
  variant?: "full" | "compact"
  /** Navigate to the card on click (renders as a Link) — default true. */
  linked?: boolean
  className?: string
}
