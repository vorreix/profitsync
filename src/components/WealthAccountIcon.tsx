import { useState } from "react"
import { Banknote, BriefcaseBusiness, Building2, CreditCard, Landmark, Star, Wallet } from "lucide-react"
import type { WealthAccount } from "@/lib/types"

const bankIconClass = "size-4"

export function WealthAccountIcon({ account, className = "size-10" }: { account: Pick<WealthAccount, "type" | "icon"> & { logo_url?: string | null }; className?: string }) {
  const [logoFailed, setLogoFailed] = useState(false)

  // Render the bank's real logo when we have one (and it loads); otherwise fall
  // back to the chosen lucide glyph.
  if (account.logo_url && !logoFailed) {
    return (
      <div className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full border bg-card ${className}`}>
        <img
          src={account.logo_url}
          alt=""
          className="size-full object-contain p-1"
          onError={() => setLogoFailed(true)}
        />
      </div>
    )
  }

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
