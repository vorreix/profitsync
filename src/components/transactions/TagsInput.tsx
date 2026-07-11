import { useCallback } from "react"
import { useTranslation } from "react-i18next"
import { Crown, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { mergeTags } from "@/lib/transaction-tags"

/**
 * Hashtag pill input for transaction tags. Committed tags render as removable
 * badges; the draft input commits on Enter / comma / blur, Backspace on an
 * empty draft pops the last tag. `suggestions` (tags already used elsewhere)
 * filter live against the draft.
 *
 * Plan gate: `maxTags` caps how many tags this plan allows on one transaction
 * (free = 1, paid = 3). At the cap the text input is swapped for a premium
 * "upgrade for more tags" chip that calls `onUpgrade` (existing tags stay
 * removable, so a user over the limit can always reduce). The server enforces
 * the same ceiling — this is the up-front UX.
 */
export function TagsInput({ value, draft, onDraftChange, suggestions, onChange, maxTags, onUpgrade }: {
  value: string[]
  draft: string
  onDraftChange: (draft: string) => void
  suggestions: string[]
  onChange: (tags: string[]) => void
  maxTags?: number
  onUpgrade?: () => void
}) {
  const { t } = useTranslation("transactions")
  const capped = typeof maxTags === "number" && Number.isFinite(maxTags)
  const atLimit = capped && value.length >= (maxTags as number)

  const addTags = useCallback(
    (raw: string) => {
      const next = mergeTags(value, raw)
      // Adding would push past the plan's ceiling → nudge to upgrade, don't add.
      if (capped && next.length > (maxTags as number)) {
        onDraftChange("")
        onUpgrade?.()
        return
      }
      if (next.length !== value.length) onChange(next)
      onDraftChange("")
    },
    [capped, maxTags, onChange, onDraftChange, onUpgrade, value],
  )

  const removeTag = (tag: string) => onChange(value.filter((existing) => existing !== tag))
  const visibleSuggestions = atLimit
    ? []
    : suggestions
        .filter((tag) => !value.some((existing) => existing.toLowerCase() === tag.toLowerCase()))
        .filter((tag) => !draft.trim() || tag.toLowerCase().includes(draft.trim().replace(/^#+/, "").toLowerCase()))
        .slice(0, 5)

  return (
    <div className="space-y-2">
      <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-md border bg-background px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring">
        {value.map((tag) => (
          <Badge key={tag} variant="secondary" className="gap-1 py-1">
            {tag}
            <button
              type="button"
              onClick={() => removeTag(tag)}
              className="rounded-full transition-colors hover:text-destructive"
              aria-label={t("removeTag", { tag })}
            >
              <X className="size-3" />
            </button>
          </Badge>
        ))}
        {atLimit ? (
          <button
            type="button"
            onClick={onUpgrade}
            className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-100 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/20"
          >
            <Crown className="size-3" />
            {t("tagsUpgrade")}
          </button>
        ) : (
          <input
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onBlur={() => addTags(draft)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault()
                addTags(draft)
              } else if (e.key === "Backspace" && !draft && value.length > 0) {
                onChange(value.slice(0, -1))
              }
            }}
            placeholder={value.length === 0 ? t("tagsPlaceholder") : ""}
            className="min-w-0 flex-1 bg-transparent px-1 py-1 text-sm outline-none placeholder:text-muted-foreground"
          />
        )}
      </div>
      {atLimit && <p className="text-xs text-muted-foreground">{t("tagsLimitReached")}</p>}
      {visibleSuggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {visibleSuggestions.map((tag) => (
            <button
              key={tag}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => addTags(tag)}
              className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
            >
              {tag}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
