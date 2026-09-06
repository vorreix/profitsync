import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import { Archive, CalendarClock, CreditCard, MoreVertical, Pencil, RotateCcw, Snowflake, Sun, Trash2 } from "lucide-react"
import { apiDelete, apiErrorMessage, apiErrorUpgradeHint, apiPatch } from "@/lib/api"
import { isCardExpired } from "@/lib/cards"
import type { Card } from "@/lib/types"
import { formatMoney } from "@/lib/wealth"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const todayIso = () => new Date().toISOString().slice(0, 10)

/** The 409 a credit card returns when it still owes money on close/delete. */
function debtFromError(err: unknown): number | null {
  try {
    const parsed = JSON.parse((err as Error).message) as { code?: string; debt?: number | string }
    if (parsed.code === "card_has_debt") return Number(parsed.debt ?? 0)
  } catch {
    /* not a JSON error */
  }
  return null
}

/**
 * The kebab every card surface shares: Edit · Freeze/Unfreeze · Close/Reopen ·
 * Delete (only while nothing refers to the card). Freeze needs canWrite; close
 * and delete need canDelete (they are as destructive as archiving an account).
 * Every irreversible step confirms first; a credit card that still owes money
 * cannot be closed — the dialog says how much and offers to pay it.
 *
 * `onChanged(card)` fires with the fresh row (null after a hard delete). The
 * API client also emits WEALTH_CHANGED_EVENT on every card mutation, so lists
 * built on useCards() refresh on their own.
 */
export function CardActionsMenu({
  card,
  canWrite,
  canDelete,
  currency,
  onEdit,
  onChanged,
  onPayCard,
  align = "end",
  className,
  size = "icon-sm",
  variant = "ghost",
}: {
  card: Card
  canWrite: boolean
  canDelete: boolean
  currency: string
  onEdit?: () => void
  onChanged?: (card: Card | null) => void
  /** Opens the Pay-card sheet (card page). Without it, "Pay card" deep-links to the card page. */
  onPayCard?: () => void
  align?: "start" | "end"
  className?: string
  size?: "icon" | "icon-sm"
  variant?: "ghost" | "outline"
}) {
  const { t } = useTranslation("wealth")
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const [busy, setBusy] = useState(false)
  const [closeOpen, setCloseOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [debtBlock, setDebtBlock] = useState<number | null>(null)

  const closed = card.status === "closed"
  const frozen = card.status === "frozen"
  const expired = isCardExpired(card.expiry_month, card.expiry_year, todayIso())
  const canHardDelete = canDelete && (card.transaction_count ?? 0) === 0
  if (!canWrite) return null

  async function patchStatus(status: "active" | "frozen" | "closed", successKey: string) {
    setBusy(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      const updated = await apiPatch<Card>(`/api/cards/${card.id}`, token, { status })
      toast.success(t(successKey))
      onChanged?.(updated)
    } catch (err) {
      const debt = debtFromError(err)
      if (debt !== null) setDebtBlock(debt)
      else if (apiErrorUpgradeHint(err)) {
        toast.error(t("cards.reopenUpgrade"), { action: { label: t("upgradeBanksCta"), onClick: () => navigate("/subscription") } })
      } else toast.error(apiErrorMessage(err, t("cards.updateFailed")))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiDelete(`/api/cards/${card.id}`, token)
      toast.success(t("cards.deleteToast"))
      onChanged?.(null)
    } catch (err) {
      const debt = debtFromError(err)
      if (debt !== null) setDebtBlock(debt)
      else toast.error(apiErrorMessage(err, t("cards.updateFailed")))
    } finally {
      setBusy(false)
    }
  }

  function payCard() {
    setDebtBlock(null)
    if (onPayCard) onPayCard()
    else navigate(`/wealth/cards/${card.id}?pay=1`)
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant={variant}
            size={size}
            // The icon stays small; the TAP TARGET is a full 44px on touch
            // screens (the repo's floor) via a transparent ::after overlay, so
            // the kebab never becomes the one control a thumb can't hit.
            className={cn(
              "after:absolute after:left-1/2 after:top-1/2 after:size-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-[''] sm:after:hidden relative",
              variant === "ghost" && "text-muted-foreground",
              className,
            )}
            aria-label={t("cards.cardActions")}
            disabled={busy}
          >
            <MoreVertical className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align={align} className="min-w-44">
          {onEdit && (
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil className="size-4" /> {t("cards.edit")}
            </DropdownMenuItem>
          )}
          {onEdit && expired && !closed && (
            <DropdownMenuItem onSelect={onEdit}>
              <CalendarClock className="size-4" /> {t("cards.updateExpiry")}
            </DropdownMenuItem>
          )}
          {!closed && (
            <DropdownMenuItem onSelect={() => void patchStatus(frozen ? "active" : "frozen", frozen ? "cards.unfreezeToast" : "cards.freezeToast")} disabled={busy}>
              {frozen ? <Sun className="size-4" /> : <Snowflake className="size-4" />}
              {frozen ? t("cards.unfreeze") : t("cards.freeze")}
            </DropdownMenuItem>
          )}
          {closed ? (
            <DropdownMenuItem onSelect={() => void patchStatus("active", "cards.reopenToast")} disabled={busy}>
              <RotateCcw className="size-4" /> {t("cards.reopen")}
            </DropdownMenuItem>
          ) : canDelete ? (
            <DropdownMenuItem onSelect={() => setCloseOpen(true)} disabled={busy} className="text-muted-foreground">
              <Archive className="size-4" /> {t("cards.close")}
            </DropdownMenuItem>
          ) : null}
          {canHardDelete && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setDeleteOpen(true)} disabled={busy} className="text-destructive focus:text-destructive">
                <Trash2 className="size-4" /> {t("cards.delete")}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Close: archive-like, reversible */}
      <AlertDialog open={closeOpen} onOpenChange={setCloseOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("cards.closeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{card.kind === "credit" ? t("cards.closeDescCredit") : t("cards.closeDescDebit")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void patchStatus("closed", "cards.closeToast")} className="bg-destructive text-white hover:bg-destructive/90">
              {t("cards.close")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete: only while the card has no history */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("cards.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("cards.deleteDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void remove()} className="bg-destructive text-white hover:bg-destructive/90">
              {t("cards.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* A credit card that still owes money cannot be closed */}
      <AlertDialog open={debtBlock !== null} onOpenChange={(o) => { if (!o) setDebtBlock(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("cards.payOffTitle", { amount: formatMoney(debtBlock ?? 0, currency) })}</AlertDialogTitle>
            <AlertDialogDescription>{t("cards.payOffDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={payCard}>
              <CreditCard className="size-4" /> {t("payCard")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
