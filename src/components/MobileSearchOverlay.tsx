import { useEffect, useMemo, useRef, useState, type ComponentType } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import {
  ArrowLeftRight,
  Clock,
  FileText,
  Landmark,
  Loader2,
  PiggyBank,
  Search,
  Tag,
  Users,
  X,
} from "lucide-react"
import { useAdmin } from "@/lib/admin-context"
import { useCurrency } from "@/lib/currency-context"
import { useOrg } from "@/lib/org-context"
import { loadRecents, recordRecent } from "@/lib/recent-searches"
import { filterLocal, quickActions, searchablePages } from "@/lib/search-index"
import { accountDisplayName, formatMoney } from "@/lib/wealth"
import { useBackClose } from "@/hooks/use-back-close"
import {
  SEARCH_MIN_CHARS,
  searchHrefs,
  useGlobalSearch,
} from "@/hooks/use-global-search"

type Chip = "all" | "clients" | "transactions" | "quotations" | "pages" | "accounts"

const CHIPS: Array<{ key: Chip; labelKey: string }> = [
  { key: "all", labelKey: "search.filterAll" },
  { key: "clients", labelKey: "search.clients" },
  { key: "transactions", labelKey: "search.transactions" },
  { key: "quotations", labelKey: "search.quotations" },
  { key: "pages", labelKey: "search.pages" },
  { key: "accounts", labelKey: "search.accounts" },
]

function GroupHeading({ children }: { children: string }) {
  return <div className="px-3 pb-1 pt-3 text-xs font-medium text-muted-foreground">{children}</div>
}

function ResultRow({
  icon: Icon,
  label,
  secondary,
  onClick,
}: {
  icon: ComponentType<{ className?: string }>
  label: string
  secondary?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="pressable ios-tap flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left active:bg-muted/60"
    >
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{label}</span>
      {secondary && (
        <span className="max-w-[40%] shrink-0 truncate text-xs text-muted-foreground">{secondary}</span>
      )}
    </button>
  )
}

/**
 * Full-screen mobile search, WhatsApp-Liquid-Glass style: frosted overlay,
 * results on top, filter chips above a **bottom-docked** input that rides the
 * keyboard (thumb zone). Always mounted + state-driven; the Back gesture
 * closes it via useBackClose.
 */
export function MobileSearchOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { activeOrg } = useOrg()
  const { isAdmin } = useAdmin()
  const { currency } = useCurrency()
  const [query, setQuery] = useState("")
  const [chip, setChip] = useState<Chip>("all")
  const inputRef = useRef<HTMLInputElement>(null)
  // Visual-viewport height while the keyboard is up (mobile web); the Capacitor
  // WebView resizes itself, where this stays equal to the layout viewport.
  const [vh, setVh] = useState<number | null>(null)

  useBackClose(open, onClose)

  useEffect(() => {
    if (!open) {
      setQuery("")
      setChip("all")
      return
    }
    const timer = setTimeout(() => inputRef.current?.focus(), 80)
    document.body.style.overflow = "hidden"
    return () => {
      clearTimeout(timer)
      document.body.style.overflow = ""
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const vv = window.visualViewport
    if (!vv) return
    const update = () => setVh(Math.round(vv.height))
    update()
    vv.addEventListener("resize", update)
    return () => {
      vv.removeEventListener("resize", update)
      setVh(null)
    }
  }, [open])

  const accountType = activeOrg?.account_type ?? null
  const membersHref = activeOrg ? `/organizations/${activeOrg.id}/members` : "/organizations"
  const { results, loading } = useGlobalSearch(open ? query : "")

  const pages = useMemo(
    () => filterLocal(searchablePages(accountType, isAdmin, membersHref), query, t),
    [accountType, isAdmin, membersHref, query, t],
  )
  const actions = useMemo(
    () => filterLocal(quickActions(accountType), query, t),
    [accountType, query, t],
  )
  const recents = useMemo(
    () => (activeOrg && open && !query.trim() ? loadRecents(localStorage, activeOrg.id) : []),
    [activeOrg, open, query],
  )

  if (!open) return null

  const go = (href: string) => {
    if (activeOrg && query.trim()) recordRecent(localStorage, activeOrg.id, query)
    onClose()
    navigate(href)
  }

  const show = (section: Exclude<Chip, "all">) => chip === "all" || chip === section
  const hasQuery = query.trim().length > 0
  const showClients = show("clients") && results !== null && results.clients.length > 0
  const showTx = show("transactions") && results !== null && results.transactions.length > 0
  const showQuotes = show("quotations") && results !== null && results.quotations.length > 0
  const showAccounts = show("accounts") && results !== null && results.accounts.length > 0
  const showCategories = chip === "all" && results !== null && results.categories.length > 0
  const showPages = show("pages") && hasQuery && pages.length > 0
  const showActions = show("pages") && hasQuery && actions.length > 0
  const nothingMatches =
    query.trim().length >= SEARCH_MIN_CHARS &&
    !loading &&
    !showClients && !showTx && !showQuotes && !showAccounts && !showCategories &&
    !showPages && !showActions

  return (
    <div
      className="fixed inset-x-0 top-0 z-[60] flex flex-col bg-background/90 backdrop-blur-xl"
      style={{ height: vh ? `${vh}px` : "100dvh" }}
    >
      <div className="safe-pt flex items-center justify-between px-4 pb-1 pt-3">
        <span className="text-base font-semibold">{t("search.title")}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common.close")}
          className="pressable ios-tap flex size-11 items-center justify-center rounded-full"
        >
          <X className="size-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain px-3 pb-2">
        {!hasQuery && (
          <>
            {recents.length > 0 && (
              <>
                <GroupHeading>{t("search.recent")}</GroupHeading>
                {recents.map((term) => (
                  <ResultRow key={term} icon={Clock} label={term} onClick={() => setQuery(term)} />
                ))}
              </>
            )}
            <GroupHeading>{t("search.actions")}</GroupHeading>
            {quickActions(accountType).map((action) => (
              <ResultRow
                key={action.href}
                icon={action.icon}
                label={t(action.labelKey)}
                onClick={() => go(action.href)}
              />
            ))}
          </>
        )}

        {loading && results === null && hasQuery && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {nothingMatches && (
          <div className="py-10 text-center text-sm text-muted-foreground">{t("search.noResults")}</div>
        )}

        {showActions && (
          <>
            <GroupHeading>{t("search.actions")}</GroupHeading>
            {actions.map((action) => (
              <ResultRow key={action.href} icon={action.icon} label={t(action.labelKey)} onClick={() => go(action.href)} />
            ))}
          </>
        )}
        {showPages && (
          <>
            <GroupHeading>{t("search.pages")}</GroupHeading>
            {pages.map((page) => (
              <ResultRow key={page.href} icon={page.icon} label={t(page.labelKey)} onClick={() => go(page.href)} />
            ))}
          </>
        )}
        {showClients && results && (
          <>
            <GroupHeading>{t("search.clients")}</GroupHeading>
            {results.clients.map((client) => (
              <ResultRow
                key={client.id}
                icon={Users}
                label={client.name}
                secondary={client.company || undefined}
                onClick={() => go(searchHrefs.client(client))}
              />
            ))}
          </>
        )}
        {showTx && results && (
          <>
            <GroupHeading>{t("search.transactions")}</GroupHeading>
            {results.transactions.map((tx) => (
              <ResultRow
                key={tx.id}
                icon={ArrowLeftRight}
                label={tx.description || tx.category || tx.client_name}
                secondary={formatMoney(Number(tx.amount), currency)}
                onClick={() => go(searchHrefs.transaction(tx))}
              />
            ))}
          </>
        )}
        {showQuotes && results && (
          <>
            <GroupHeading>{t("search.quotations")}</GroupHeading>
            {results.quotations.map((quotation) => (
              <ResultRow
                key={quotation.id}
                icon={FileText}
                label={quotation.title}
                secondary={quotation.prospect_name}
                onClick={() => go(searchHrefs.quotation(quotation))}
              />
            ))}
          </>
        )}
        {showAccounts && results && (
          <>
            <GroupHeading>{t("search.accounts")}</GroupHeading>
            {results.accounts.map((account) => (
              <ResultRow
                key={account.id}
                icon={account.type === "space" ? PiggyBank : Landmark}
                label={accountDisplayName(account) || t("nav.wealth")}
                onClick={() => go(searchHrefs.account(account))}
              />
            ))}
          </>
        )}
        {showCategories && results && (
          <>
            <GroupHeading>{t("search.categories")}</GroupHeading>
            {results.categories.map((category) => (
              <ResultRow
                key={category.id}
                icon={Tag}
                label={category.name}
                onClick={() => go(searchHrefs.category())}
              />
            ))}
          </>
        )}
      </div>

      <div className="scrollbar-none flex gap-2 overflow-x-auto px-4 py-2">
        {CHIPS.map((c) => (
          <button
            key={c.key}
            type="button"
            onClick={() => setChip(c.key)}
            className={`pressable ios-tap min-h-9 shrink-0 rounded-full border px-4 py-1.5 text-xs font-medium transition-colors ${
              chip === c.key
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-background/60 text-muted-foreground"
            }`}
          >
            {t(c.labelKey)}
          </button>
        ))}
      </div>

      <div className="safe-pb border-t bg-background/80 px-4 py-2">
        <div className="flex items-center gap-2 rounded-full border bg-muted/60 px-4 py-2.5">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("search.placeholder")}
            enterKeyHint="search"
            autoCapitalize="none"
            autoCorrect="off"
            className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label={t("search.clear")}
              className="pressable flex size-6 items-center justify-center rounded-full bg-muted"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
