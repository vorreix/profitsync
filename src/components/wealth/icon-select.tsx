import {
  Banknote,
  BriefcaseBusiness,
  CreditCard,
  Landmark,
  Star,
  Wallet,
  type LucideIcon,
} from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const WEALTH_ICONS: Array<{ value: string; label: string; Icon: LucideIcon }> = [
  { value: "bank", label: "Bank", Icon: Landmark },
  { value: "card", label: "Card", Icon: CreditCard },
  { value: "cash", label: "Cash", Icon: Banknote },
  { value: "wallet", label: "Wallet", Icon: Wallet },
  { value: "business", label: "Business", Icon: BriefcaseBusiness },
  { value: "custom", label: "Custom", Icon: Star },
]

function IconOption({ icon }: { icon: string }) {
  const option = WEALTH_ICONS.find((item) => item.value === icon) ?? WEALTH_ICONS[0]
  const Icon = option.Icon
  return (
    <span className="flex min-w-0 items-center gap-2">
      <Icon className="size-4 shrink-0" />
      <span className="truncate">{option.label}</span>
    </span>
  )
}

/** Dropdown to pick the lucide fallback icon used when an account has no logo. */
export function IconSelect({ value, onChange }: { value: string; onChange: (icon: string) => void }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-full justify-between">
        <SelectValue placeholder={<IconOption icon={value} />} />
      </SelectTrigger>
      <SelectContent position="popper" className="z-[100]">
        {WEALTH_ICONS.map(({ value: v, label, Icon }) => (
          <SelectItem key={v} value={v} textValue={label}>
            <span className="flex items-center gap-2"><Icon className="size-4" />{label}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
