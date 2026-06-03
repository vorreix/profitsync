import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Trash2, X, CheckSquare } from "lucide-react"
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

/**
 * Sticky bottom bar shown while a list is in multi-select mode. Shows the
 * selected count, a select-all toggle, a Cancel, and a Delete that asks for
 * confirmation before running. Works the same on mobile and desktop; it overlays
 * the bottom nav while active (the user is focused on the bulk action).
 */
export function BulkActionBar({
  count,
  allSelected,
  onToggleSelectAll,
  onDelete,
  onCancel,
  deleting = false,
}: {
  count: number
  allSelected: boolean
  onToggleSelectAll: () => void
  onDelete: () => void | Promise<void>
  onCancel: () => void
  deleting?: boolean
}) {
  const { t } = useTranslation()
  const [confirmOpen, setConfirmOpen] = useState(false)

  return (
    <>
      <div className="safe-pb fixed inset-x-0 bottom-0 z-50 border-t bg-background/95 backdrop-blur animate-in slide-in-from-bottom-2 duration-150">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-3 py-2.5 sm:px-6">
          <Button variant="ghost" size="sm" onClick={onCancel} className="shrink-0">
            <X className="size-4" />
            <span className="hidden sm:inline">{t("common.cancel")}</span>
          </Button>
          <span className="text-sm font-medium tabular-nums">
            {t("multiSelect.selected", { count })}
          </span>
          <Button variant="ghost" size="sm" onClick={onToggleSelectAll} className="ml-1 shrink-0">
            <CheckSquare className="size-4" />
            <span className="hidden sm:inline">
              {allSelected ? t("multiSelect.deselectAll") : t("multiSelect.selectAll")}
            </span>
          </Button>
          <div className="ml-auto shrink-0">
            <Button
              variant="destructive"
              size="sm"
              disabled={count === 0 || deleting}
              onClick={() => setConfirmOpen(true)}
            >
              <Trash2 className="size-4" />
              {t("multiSelect.deleteCount", { count })}
            </Button>
          </div>
        </div>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("multiSelect.confirmTitle", { count })}</AlertDialogTitle>
            <AlertDialogDescription>{t("multiSelect.confirmBody")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async (e) => {
                e.preventDefault()
                await onDelete()
                setConfirmOpen(false)
              }}
            >
              {t("multiSelect.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
