import { useTranslation } from "react-i18next"
import { Hash } from "lucide-react"

/**
 * Placeholder for the Tags manager. The full manager (list / search / create /
 * edit / delete-with-choice + entity drilldown) is wired in a later branch of
 * the Category & Tags chain; this keeps the shell shippable in the meantime.
 */
export function TagsPanel() {
  const { t } = useTranslation()
  return (
    <div className="rounded-xl border border-dashed py-16 text-center">
      <Hash className="size-8 text-muted-foreground/50 mx-auto mb-3" />
      <p className="text-sm text-muted-foreground">{t("tags.panelStub")}</p>
    </div>
  )
}
