import { Banknote, BriefcaseBusiness, Building2, CreditCard, Landmark, Star, Wallet } from "lucide-react"
import type { WealthAccount } from "@/lib/types"

const bankIconClass = "size-4"

export function WealthAccountIcon({ account, className = "size-10" }: { account: Pick<WealthAccount, "type" | "icon">; className?: string }) {
  const Icon =
    account.type === "cash"
      ? Wallet
      : account.icon === "building"
        ? Building2
        : account.icon === "card"
          ? CreditCard
        : account.icon === "cash"
          ? Banknote
        : account.icon === "wallet"
          ? Wallet
        : account.icon === "business"
          ? BriefcaseBusiness
        : account.icon === "custom"
          ? Star
          : Landmark

  return (
    <div className={`flex shrink-0 items-center justify-center rounded-full border bg-muted/50 text-foreground ${className}`}>
      <Icon className={bankIconClass} />
    </div>
  )
}
