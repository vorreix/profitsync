import {
  Baby,
  Banknote,
  Bus,
  Car,
  CreditCard,
  Dumbbell,
  Gift,
  GraduationCap,
  HeartPulse,
  Home,
  Landmark,
  Laptop,
  PawPrint,
  PiggyBank,
  Plane,
  Receipt,
  Shirt,
  ShoppingBasket,
  Smartphone,
  Sparkles,
  Utensils,
  Wallet,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react"
import { MoneyBag } from "@/components/icons/MoneyBag"
import type { BudgetSectionName } from "@/lib/types"

/**
 * Icons for budget envelopes.
 *
 * Chosen to cover what household budgets are actually made of rather than to be
 * exhaustive — a long grid is harder to pick from than a short one, and a
 * category the set does not cover still reads fine on its section default.
 *
 * The stored value is the `key`, never the component: an icon set can be
 * re-ordered or re-drawn without touching a single row.
 */
export const ENVELOPE_ICONS: { key: string; Icon: LucideIcon; labelKey: string }[] = [
  { key: "groceries", Icon: ShoppingBasket, labelKey: "budgetV2.iconGroceries" },
  { key: "dining", Icon: Utensils, labelKey: "budgetV2.iconDining" },
  { key: "transport", Icon: Bus, labelKey: "budgetV2.iconTransport" },
  { key: "car", Icon: Car, labelKey: "budgetV2.iconCar" },
  { key: "home", Icon: Home, labelKey: "budgetV2.iconHome" },
  { key: "utilities", Icon: Zap, labelKey: "budgetV2.iconUtilities" },
  { key: "phone", Icon: Smartphone, labelKey: "budgetV2.iconPhone" },
  { key: "health", Icon: HeartPulse, labelKey: "budgetV2.iconHealth" },
  { key: "fitness", Icon: Dumbbell, labelKey: "budgetV2.iconFitness" },
  { key: "clothes", Icon: Shirt, labelKey: "budgetV2.iconClothes" },
  { key: "fun", Icon: Sparkles, labelKey: "budgetV2.iconFun" },
  { key: "travel", Icon: Plane, labelKey: "budgetV2.iconTravel" },
  { key: "gifts", Icon: Gift, labelKey: "budgetV2.iconGifts" },
  { key: "education", Icon: GraduationCap, labelKey: "budgetV2.iconEducation" },
  { key: "children", Icon: Baby, labelKey: "budgetV2.iconChildren" },
  { key: "pets", Icon: PawPrint, labelKey: "budgetV2.iconPets" },
  { key: "tech", Icon: Laptop, labelKey: "budgetV2.iconTech" },
  { key: "repairs", Icon: Wrench, labelKey: "budgetV2.iconRepairs" },
  { key: "bills", Icon: Receipt, labelKey: "budgetV2.iconBills" },
  { key: "debt", Icon: CreditCard, labelKey: "budgetV2.iconDebt" },
  { key: "savings", Icon: PiggyBank, labelKey: "budgetV2.iconSavings" },
  { key: "income", Icon: Banknote, labelKey: "budgetV2.iconIncome" },
  { key: "cash", Icon: Wallet, labelKey: "budgetV2.iconCash" },
  { key: "other", Icon: Landmark, labelKey: "budgetV2.iconOther" },
]

const BY_KEY = new Map(ENVELOPE_ICONS.map((i) => [i.key, i.Icon]))

/**
 * Fall back per SECTION rather than to one generic glyph, so an envelope that
 * predates this column — or whose category the icon set does not cover — still
 * looks like the kind of thing it is.
 *
 * `MoneyBag` is the budget icon throughout the app; a piggy bank means Spaces,
 * which is why it appears here only for the savings section.
 */
const SECTION_FALLBACK: Record<BudgetSectionName, LucideIcon> = {
  income: Banknote,
  commitment: Receipt,
  flexible: MoneyBag,
  savings: PiggyBank,
  debt: CreditCard,
}

/** The component for a stored icon key, falling back to the section's default. */
export function envelopeIcon(icon: string | null | undefined, section: BudgetSectionName): LucideIcon {
  return (icon && BY_KEY.get(icon)) || SECTION_FALLBACK[section] || MoneyBag
}

/**
 * Suggest an icon from the envelope's name or its categories, so the common case
 * needs no picking at all. Matched on substrings of the LOWERCASED text, longest
 * key first, so "car insurance" prefers `car` over a stray match.
 */
const NAME_HINTS: [string, string][] = [
  ["grocer", "groceries"], ["supermarket", "groceries"], ["food shop", "groceries"],
  ["dining", "dining"], ["restaurant", "dining"], ["eating out", "dining"], ["takeaway", "dining"], ["coffee", "dining"],
  ["transport", "transport"], ["bus", "transport"], ["train", "transport"], ["commut", "transport"],
  ["car", "car"], ["fuel", "car"], ["petrol", "car"], ["parking", "car"],
  ["rent", "home"], ["mortgage", "home"], ["home", "home"], ["household", "home"],
  ["electric", "utilities"], ["gas", "utilities"], ["water", "utilities"], ["utilit", "utilities"], ["energy", "utilities"],
  ["phone", "phone"], ["mobile", "phone"], ["internet", "phone"], ["broadband", "phone"],
  ["health", "health"], ["medical", "health"], ["pharmac", "health"], ["doctor", "health"], ["dentist", "health"],
  ["gym", "fitness"], ["fitness", "fitness"], ["sport", "fitness"],
  ["cloth", "clothes"], ["shoe", "clothes"],
  ["fun", "fun"], ["entertain", "fun"], ["hobby", "fun"], ["subscription", "fun"], ["streaming", "fun"],
  ["travel", "travel"], ["holiday", "travel"], ["flight", "travel"], ["vacation", "travel"],
  ["gift", "gifts"], ["present", "gifts"], ["charity", "gifts"],
  ["school", "education"], ["educat", "education"], ["course", "education"], ["tuition", "education"], ["book", "education"],
  ["child", "children"], ["kid", "children"], ["baby", "children"], ["nursery", "children"],
  ["pet", "pets"], ["vet", "pets"], ["dog", "pets"], ["cat", "pets"],
  ["tech", "tech"], ["software", "tech"], ["laptop", "tech"], ["computer", "tech"],
  ["repair", "repairs"], ["maintenance", "repairs"], ["diy", "repairs"],
  ["bill", "bills"], ["insurance", "bills"], ["tax", "bills"],
  ["debt", "debt"], ["loan", "debt"], ["credit", "debt"], ["repay", "debt"],
  ["saving", "savings"], ["fund", "savings"], ["emergency", "savings"],
  ["salary", "income"], ["income", "income"], ["wage", "income"],
  ["cash", "cash"], ["misc", "other"], ["everyday", "cash"], ["leftover", "cash"],
]

export function suggestEnvelopeIcon(name: string, categories: string[] = []): string {
  const haystack = [name, ...categories].join(" ").toLowerCase()
  if (!haystack.trim()) return ""
  // Longest hint first: "credit card" should not be beaten by "car".
  const sorted = [...NAME_HINTS].sort((a, b) => b[0].length - a[0].length)
  for (const [needle, key] of sorted) {
    if (haystack.includes(needle)) return key
  }
  return ""
}
