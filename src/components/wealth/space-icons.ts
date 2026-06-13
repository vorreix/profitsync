import { Car, Gift, Home, PiggyBank, Plane, Target } from "lucide-react"
import type { LucideIcon } from "lucide-react"

// Curated savings-themed glyphs a Space can pick (piggy-bank is the default).
// Shared by WealthAccountIcon (rendering) and the Space create/edit picker.
export const SPACE_ICONS: { key: string; Icon: LucideIcon }[] = [
  { key: "piggy", Icon: PiggyBank },
  { key: "target", Icon: Target },
  { key: "plane", Icon: Plane },
  { key: "home", Icon: Home },
  { key: "car", Icon: Car },
  { key: "gift", Icon: Gift },
]

export function spaceIconFor(icon: string | null | undefined): LucideIcon {
  return SPACE_ICONS.find((s) => s.key === icon)?.Icon ?? PiggyBank
}
