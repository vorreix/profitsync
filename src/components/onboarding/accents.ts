import { Building2, User } from "lucide-react"
import type { AccountType } from "@/lib/types"

/** Per-account-type visual treatment, shared across onboarding surfaces. */
export const ACCENTS: Record<
  AccountType,
  { icon: typeof User; ring: string; chip: string; glow: string; dot: string }
> = {
  personal: {
    icon: User,
    ring: "ring-emerald-500/60 border-emerald-500/50",
    chip: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    glow: "from-emerald-500/20",
    dot: "bg-emerald-500",
  },
  business: {
    icon: Building2,
    ring: "ring-indigo-500/60 border-indigo-500/50",
    chip: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/30",
    glow: "from-indigo-500/20",
    dot: "bg-indigo-500",
  },
}
