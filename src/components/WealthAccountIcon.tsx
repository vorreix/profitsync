import { useState } from "react"
import { Banknote, BriefcaseBusiness, Building2, CreditCard, Landmark, Star, Wallet } from "lucide-react"
import type { WealthAccount } from "@/lib/types"

const bankIconClass = "size-4"

export function WealthAccountIcon({
  account,
  className = "size-10",
}: {
  account: Pick<WealthAccount, "type" | "icon"> & { logo_url?: string | null; logo_src?: string | null }
  className?: string
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)

  // Prefer the durable DB-served copy (data URL) — hotlinked logo_url's expire
  // after a while in production. Fall back to the remote URL, then the glyph.
  const src = account.logo_src || account.logo_url || ""

  if (src && failedSrc !== src) {
    return (
      <div className={`flex shrink-0 items-center justify-center overflow-hidden rounded-full border bg-card ${className}`}>
        {/* Fill the circle (object-cover) so the brand logo reads large instead of
            a tiny contained glyph; a touch of scale crops any built-in padding. */}
        <img
          src={src}
          alt=""
          className="size-full scale-110 object-cover"
          onError={() => setFailedSrc(src)}
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
