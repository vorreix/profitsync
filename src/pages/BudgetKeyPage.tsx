import { useEffect } from "react"
import { useNavigate, useParams } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { useBudget } from "@/lib/budget-context"
import { useOrg } from "@/lib/org-context"
import type { BudgetEnvelopeView } from "@/lib/types"
import { BudgetDetailPage } from "@/pages/BudgetDetailPage"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * `/budgets/:key` — legacy URL resolution (spec §13.6).
 *
 * This path predates Budget v2 and is in people's bookmarks and browser
 * history, where `:key` is either the literal `default` or a client id. The rule
 * is simple and non-negotiable: **an existing bookmark must never 404.**
 *
 * Which surface answers depends on whether this workspace has a v2 plan:
 *
 *  - **No plan** (a business workspace, or one not yet migrated) → the v1 detail
 *    page, completely unchanged. Business client caps live on indefinitely under
 *    §23, so this is not a transitional state for them.
 *  - **A plan exists** → resolve the key onto a v2 envelope and deep-link to it
 *    on `/budgets`. `default` means the catch-all, which is the direct
 *    descendant of v1's org-level budget.
 *  - **Unresolvable** → `/budgets` with an explanation, never an error page. A
 *    per-client bookmark on a personal workspace lands here: v2 tracks a
 *    personal budget by CATEGORY rather than by client, so there is no
 *    equivalent page to send them to, and saying so is better than pretending.
 */
export function BudgetKeyPage() {
  const { key = "" } = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { data, loaded } = useBudget()
  const { activeOrg, loading: orgLoading } = useOrg()

  // A BUSINESS workspace always gets the v1 page, whatever the API says.
  //
  // Its `budgets` rows are per-client spend caps (§23), and /budgets itself is
  // now personal-only — so resolving a business bookmark onto a v2 envelope
  // would redirect to a route that immediately bounces to the dashboard. The v1
  // page is both the correct surface and the one that honours "a bookmark never
  // 404s".
  const isBusiness = Boolean(activeOrg) && activeOrg?.account_type !== "personal"

  const plan = isBusiness ? null : (data?.plan ?? null)

  useEffect(() => {
    // Wait for the plan to be known: redirecting before it loads would send a
    // migrated user to the v1 page, or bounce a v1 user off their own bookmark.
    if (orgLoading || !loaded || !plan) return

    const envelopes: BudgetEnvelopeView[] = Object.values(data?.sections ?? {}).flatMap(
      (s) => (s as { envelopes?: BudgetEnvelopeView[] }).envelopes ?? [],
    )
    const catchAll = envelopes.find((e) => e.is_catch_all)

    // `default` was v1's name for the org-level budget; the catch-all envelope
    // is exactly what the migration turned it into.
    const target = key === "default" ? catchAll : envelopes.find((e) => e.id === key)

    if (target) {
      navigate(`/budgets?envelope=${encodeURIComponent(target.id)}`, { replace: true })
      return
    }

    toast.info(t("budgetV2.legacyLinkMoved"))
    navigate("/budgets", { replace: true })
  }, [orgLoading, loaded, plan, data, key, navigate, t])

  // No v2 plan — or a business workspace, which never has one: serve v1 as-is.
  if (!orgLoading && (isBusiness || (loaded && !plan))) return <BudgetDetailPage />

  // Resolving. A skeleton rather than a spinner, so the redirect does not flash
  // a loading state that looks like a failure.
  return (
    <div className="space-y-4 p-3 sm:p-6">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-32 w-full rounded-2xl" />
    </div>
  )
}
