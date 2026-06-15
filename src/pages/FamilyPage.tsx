import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { ArrowDownToLine, ArrowUpFromLine, Crown, PiggyBank, Users2 } from "lucide-react"
import { apiErrorMessage, apiGet, apiPost } from "@/lib/api"
import { useOrg } from "@/lib/org-context"
import { useCurrency } from "@/lib/currency-context"
import { canWriteRole } from "@/lib/roles"
import type { FamilyHub, FamilyContributions } from "@/lib/types"
import { formatMoney } from "@/lib/wealth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

type PickAccount = {
  id: string
  type: string
  nickname: string
  bank_name: string
  current_balance: string
  is_default: boolean
}
type TransferAccounts = {
  personal_currency: string
  family_currency: string
  personal: PickAccount[]
  family: PickAccount[]
}

const acctLabel = (a: PickAccount) => a.nickname?.trim() || a.bank_name || (a.type === "cash" ? "Cash" : a.type === "space" ? "Space" : "Account")

export function FamilyPage() {
  const { t } = useTranslation("family")
  const { getToken } = useAuth()
  const { activeOrg } = useOrg()
  const { currency } = useCurrency()
  const navigate = useNavigate()
  const canWrite = canWriteRole(activeOrg?.role)

  const [hub, setHub] = useState<FamilyHub | null>(null)
  const [contrib, setContrib] = useState<FamilyContributions | null>(null)
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState<null | "contribute" | "disburse">(null)

  const load = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!opts.silent) setLoading(true)
    try {
      const token = await getToken()
      if (!token) return
      const [h, c] = await Promise.all([
        apiGet<FamilyHub>("/api/family", token),
        apiGet<FamilyContributions>("/api/family/contributions", token).catch(() => null),
      ])
      setHub(h)
      setContrib(c)
    } catch (e) {
      toast.error(apiErrorMessage(e, t("loadFailed")))
    } finally {
      setLoading(false)
    }
  }, [getToken, t])

  useEffect(() => {
    void load()
  }, [load])

  const contributedByUser = useMemo(() => {
    const m = new Map<string, { contributed: number; net: number }>()
    for (const row of contrib?.members ?? []) m.set(row.user_id, { contributed: row.contributed, net: row.net })
    return m
  }, [contrib])

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4 p-4">
        <Skeleton className="h-28 w-full rounded-2xl" />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    )
  }

  if (!hub) return null
  const isHead = hub.is_head

  return (
    <div className="mx-auto w-full max-w-3xl space-y-5 p-4 pb-24">
      {/* Header + net worth */}
      <header className="rounded-2xl border bg-gradient-to-br from-rose-500/10 to-transparent p-5">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-xl bg-rose-500/15 text-rose-600 dark:text-rose-300">
            <Users2 className="size-6" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold">{hub.family.name}</h1>
            <p className="text-sm text-muted-foreground">
              {t("memberCount", { n: hub.summary.member_count })}
            </p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3">
          <Stat label={t("available")} value={formatMoney(hub.summary.available, currency)} />
          <Stat label={t("saved")} value={formatMoney(hub.summary.saved, currency)} icon={<PiggyBank className="size-3.5" />} />
          <Stat label={t("netWorth")} value={formatMoney(hub.summary.net_worth, currency)} strong />
        </div>
      </header>

      {/* Actions */}
      <div className="grid grid-cols-2 gap-3">
        <Button className="h-12 rounded-xl" onClick={() => setMode("contribute")} disabled={!canWrite}>
          <ArrowDownToLine className="mr-2 size-4" /> {t("contribute")}
        </Button>
        {isHead ? (
          <Button variant="secondary" className="h-12 rounded-xl" onClick={() => setMode("disburse")}>
            <ArrowUpFromLine className="mr-2 size-4" /> {t("sendToMember")}
          </Button>
        ) : (
          <Button variant="secondary" className="h-12 rounded-xl" onClick={() => navigate("/spaces")}>
            <PiggyBank className="mr-2 size-4" /> {t("familySpaces")}
          </Button>
        )}
      </div>

      {/* Members + contributions */}
      <section className="rounded-2xl border">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="font-medium">{t("members")}</h2>
          {isHead && activeOrg?.id && (
            <button
              className="text-sm text-primary hover:underline"
              onClick={() => navigate(`/organizations/${activeOrg.id}/members`)}
            >
              {t("manageMembers")}
            </button>
          )}
        </div>
        <ul className="divide-y">
          {hub.members.map((m) => {
            const stat = contributedByUser.get(m.user_id)
            return (
              <li key={m.id} className="flex items-center gap-3 px-4 py-3">
                <Avatar src={m.avatar_src} name={m.full_name || m.email || "?"} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-medium">{m.full_name || m.email || t("memberFallback")}</span>
                    {m.family_role === "head" && (
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                        <Crown className="size-3" /> {t("head")}
                      </span>
                    )}
                  </div>
                  {stat && stat.contributed > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {t("contributedAmount", { amount: formatMoney(stat.contributed, currency) })}
                    </p>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </section>

      {mode && (
        <TransferDialog
          mode={mode}
          members={mode === "disburse" ? hub.members : []}
          onClose={() => setMode(null)}
          onDone={() => {
            setMode(null)
            void load({ silent: true })
          }}
        />
      )}
    </div>
  )
}

function Stat({ label, value, strong, icon }: { label: string; value: string; strong?: boolean; icon?: ReactNode }) {
  return (
    <div className="rounded-xl bg-background/60 p-3">
      <div className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-muted-foreground">
        {icon} {label}
      </div>
      <div className={`mt-1 truncate text-sm ${strong ? "font-semibold" : "font-medium"}`}>{value}</div>
    </div>
  )
}

function Avatar({ src, name }: { src?: string | null; name: string }) {
  if (src) return <img src={src} alt={name} className="size-9 rounded-full object-cover" />
  return (
    <div className="flex size-9 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground">
      {name.charAt(0).toUpperCase()}
    </div>
  )
}

/** Contribute (personal → family) or Disburse (family → member). */
function TransferDialog({
  mode,
  members,
  onClose,
  onDone,
}: {
  mode: "contribute" | "disburse"
  members: FamilyHub["members"]
  onClose: () => void
  onDone: () => void
}) {
  const { t } = useTranslation("family")
  const { getToken } = useAuth()
  const [accts, setAccts] = useState<TransferAccounts | null>(null)
  const [fromId, setFromId] = useState("")
  const [toId, setToId] = useState("")
  const [memberId, setMemberId] = useState(members[0]?.user_id ?? "")
  const [amount, setAmount] = useState("")
  const [destAmount, setDestAmount] = useState("")
  const [note, setNote] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void (async () => {
      const token = await getToken()
      if (!token) return
      const a = await apiGet<TransferAccounts>("/api/family/accounts", token).catch(() => null)
      if (!a) return
      setAccts(a)
      if (mode === "contribute") {
        setFromId(a.personal[0]?.id ?? "")
        setToId(a.family[0]?.id ?? "")
      } else {
        setFromId(a.family.find((x) => x.type !== "space")?.id ?? a.family[0]?.id ?? "")
      }
    })()
  }, [getToken, mode])

  const crossCurrency = !!accts && accts.personal_currency !== accts.family_currency
  const sourceOptions = mode === "contribute" ? accts?.personal ?? [] : accts?.family ?? []
  const destOptions = mode === "contribute" ? accts?.family ?? [] : []

  const submit = async () => {
    const amt = Number(amount)
    if (!amt || amt <= 0) return toast.error(t("enterAmount"))
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) return
      const body: Record<string, unknown> = { direction: mode, amount: amt, note: note.trim() || undefined }
      if (mode === "contribute") {
        body.from_account_id = fromId
        body.to_account_id = toId
        if (crossCurrency) body.dest_amount = Number(destAmount)
      } else {
        body.from_account_id = fromId
        body.to_member_id = memberId
      }
      await apiPost("/api/family/transfer", token, body)
      toast.success(mode === "contribute" ? t("contributedToast") : t("sentToast"))
      onDone()
    } catch (e) {
      toast.error(apiErrorMessage(e, t("actionFailed")))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "contribute" ? t("contributeTitle") : t("disburseTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Field label={mode === "contribute" ? t("fromAccount") : t("fromFamilyAccount")}>
            <Select value={fromId} onChange={setFromId} options={sourceOptions.map((a) => ({ value: a.id, label: acctLabel(a) }))} />
          </Field>

          {mode === "contribute" ? (
            <Field label={t("toFamilyAccount")}>
              <Select value={toId} onChange={setToId} options={destOptions.map((a) => ({ value: a.id, label: acctLabel(a) }))} />
            </Field>
          ) : (
            <Field label={t("toMember")}>
              <Select
                value={memberId}
                onChange={setMemberId}
                options={members.map((m) => ({ value: m.user_id, label: m.full_name || m.email || m.user_id }))}
              />
            </Field>
          )}

          <Field label={t("amount")}>
            <Input type="number" inputMode="decimal" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
          </Field>

          {crossCurrency && mode === "contribute" && (
            <Field label={t("destAmount", { currency: accts?.family_currency ?? "" })}>
              <Input type="number" inputMode="decimal" min="0" step="0.01" value={destAmount} onChange={(e) => setDestAmount(e.target.value)} placeholder="0.00" />
            </Field>
          )}

          <Field label={t("note")}>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("notePlaceholder")} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            {t("cancel")}
          </Button>
          <Button onClick={submit} disabled={saving || !fromId || (mode === "contribute" && !toId)}>
            {saving ? t("sending") : mode === "contribute" ? t("contribute") : t("send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  )
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {options.length === 0 && <option value="">—</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}
