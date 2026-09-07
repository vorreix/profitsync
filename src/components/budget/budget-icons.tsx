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

/**
 * Icons for spending budgets.
 *
 * Chosen to cover what budgets are actually made of rather than to be
 * exhaustive — a long grid is harder to pick from than a short one, and a
 * budget the set does not cover still reads fine on the money-bag default.
 *
 * The stored value is the `key`, never the component: an icon set can be
 * re-ordered or re-drawn without touching a single row.
 */
export const BUDGET_ICONS: { key: string; Icon: LucideIcon; labelKey: string }[] = [
  { key: "groceries", Icon: ShoppingBasket, labelKey: "budgets.icon.groceries" },
  { key: "dining", Icon: Utensils, labelKey: "budgets.icon.dining" },
  { key: "transport", Icon: Bus, labelKey: "budgets.icon.transport" },
  { key: "car", Icon: Car, labelKey: "budgets.icon.car" },
  { key: "home", Icon: Home, labelKey: "budgets.icon.home" },
  { key: "utilities", Icon: Zap, labelKey: "budgets.icon.utilities" },
  { key: "phone", Icon: Smartphone, labelKey: "budgets.icon.phone" },
  { key: "health", Icon: HeartPulse, labelKey: "budgets.icon.health" },
  { key: "fitness", Icon: Dumbbell, labelKey: "budgets.icon.fitness" },
  { key: "clothes", Icon: Shirt, labelKey: "budgets.icon.clothes" },
  { key: "fun", Icon: Sparkles, labelKey: "budgets.icon.fun" },
  { key: "travel", Icon: Plane, labelKey: "budgets.icon.travel" },
  { key: "gifts", Icon: Gift, labelKey: "budgets.icon.gifts" },
  { key: "education", Icon: GraduationCap, labelKey: "budgets.icon.education" },
  { key: "children", Icon: Baby, labelKey: "budgets.icon.children" },
  { key: "pets", Icon: PawPrint, labelKey: "budgets.icon.pets" },
  { key: "tech", Icon: Laptop, labelKey: "budgets.icon.tech" },
  { key: "repairs", Icon: Wrench, labelKey: "budgets.icon.repairs" },
  { key: "bills", Icon: Receipt, labelKey: "budgets.icon.bills" },
  { key: "debt", Icon: CreditCard, labelKey: "budgets.icon.debt" },
  { key: "savings", Icon: PiggyBank, labelKey: "budgets.icon.savings" },
  { key: "income", Icon: Banknote, labelKey: "budgets.icon.income" },
  { key: "cash", Icon: Wallet, labelKey: "budgets.icon.cash" },
  { key: "other", Icon: Landmark, labelKey: "budgets.icon.other" },
]

const BY_KEY = new Map(BUDGET_ICONS.map((i) => [i.key, i.Icon]))

/** The component for a stored icon key; the money bag — the budget glyph everywhere — when none is set. */
export function budgetIcon(icon: string | null | undefined): LucideIcon {
  return (icon && BY_KEY.get(icon)) || MoneyBag
}

/** Is this a key the picker knows? Anything else is stored as "no icon". */
export const isBudgetIconKey = (key: string): boolean => BY_KEY.has(key)

/**
 * Suggest an icon from the budget's name or its categories, so the common case
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

export function suggestBudgetIcon(name: string, categories: string[] = []): string {
  const haystack = [name, ...categories].join(" ").toLowerCase()
  if (!haystack.trim()) return ""
  // Longest hint first: "credit card" should not be beaten by "car".
  const sorted = [...NAME_HINTS].sort((a, b) => b[0].length - a[0].length)
  for (const [needle, key] of sorted) {
    if (haystack.includes(needle)) return key
  }
  return ""
}
