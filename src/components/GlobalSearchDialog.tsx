import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate } from "react-router-dom"
import {
  ArrowLeftRight,
  Clock,
  FileText,
  Landmark,
  Loader2,
  PiggyBank,
  Tag,
  Users,
} from "lucide-react"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useAuth } from "@clerk/clerk-react"
import { useAdmin } from "@/lib/admin-context"
import { useCurrency } from "@/lib/currency-context"
import { useOrg } from "@/lib/org-context"
import { loadRecents, recentSearchScope, recordRecent } from "@/lib/recent-searches"
import { filterLocal, quickActions, searchablePages } from "@/lib/search-index"
import { accountDisplayName, formatMoney } from "@/lib/wealth"
import {
  SEARCH_MIN_CHARS,
  searchHrefs,
  useGlobalSearch,
} from "@/hooks/use-global-search"

/**
 * Desktop ⌘K command palette: local pages/actions + org-scoped server results
 * (clients, transactions, quotations, accounts, categories) in one cmdk list.
 */
export function GlobalSearchDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { userId } = useAuth()
  const { activeOrg } = useOrg()
  const { isAdmin } = useAdmin()
  const { currency } = useCurrency()
  const [query, setQuery] = useState("")

  const recentsScope = activeOrg ? recentSearchScope(userId, activeOrg.id) : null
  const accountType = activeOrg?.account_type ?? null
  const membersHref = activeOrg ? `/organizations/${activeOrg.id}/members` : "/organizations"
  const { results, loading } = useGlobalSearch(query)

  const pages = useMemo(
    () => filterLocal(searchablePages(accountType, isAdmin, membersHref), query, t),
    [accountType, isAdmin, membersHref, query, t],
  )
  const actions = useMemo(
    () => filterLocal(quickActions(accountType), query, t),
    [accountType, query, t],
  )
  const recents = useMemo(
    () => (recentsScope && open && !query.trim() ? loadRecents(localStorage, recentsScope) : []),
    [recentsScope, open, query],
  )

  useEffect(() => {
    if (!open) setQuery("")
  }, [open])

  // Switching orgs while the palette is open would otherwise keep showing the
  // previous org's results (the hook only re-fetches when the query changes).
  useEffect(() => {
    setQuery("")
  }, [activeOrg?.id])

  const go = (href: string) => {
    if (recentsScope && query.trim()) recordRecent(localStorage, recentsScope, query)
    onOpenChange(false)
    navigate(href)
  }

  const serverEmpty =
    !results ||
    (results.clients.length === 0 &&
      results.transactions.length === 0 &&
      results.quotations.length === 0 &&
      results.accounts.length === 0 &&
      results.categories.length === 0)
  const nothingMatches =
    query.trim().length >= SEARCH_MIN_CHARS &&
    !loading &&
    serverEmpty &&
    pages.length === 0 &&
    actions.length === 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="top-[18%] translate-y-0 overflow-hidden p-0 sm:max-w-xl"
        showCloseButton={false}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>{t("search.title")}</DialogTitle>
          <DialogDescription>{t("search.description")}</DialogDescription>
        </DialogHeader>
        <Command
          shouldFilter={false}
          className="**:data-[slot=command-input-wrapper]:h-12 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground [&_[cmdk-group]]:px-2 [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-2.5 [&_[cmdk-item]_svg]:h-4 [&_[cmdk-item]_svg]:w-4"
        >
          <CommandInput
            placeholder={t("search.placeholder")}
            value={query}
            onValueChange={setQuery}
          />
          <CommandList className="max-h-[60vh] sm:max-h-[420px]">
            {loading && serverEmpty && (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="size-4 animate-spin text-muted-foreground" />
              </div>
            )}
            {nothingMatches && <CommandEmpty>{t("search.noResults")}</CommandEmpty>}

            {recents.length > 0 && (
              <CommandGroup heading={t("search.recent")}>
                {recents.map((term) => (
                  <CommandItem key={`recent-${term}`} value={`recent-${term}`} onSelect={() => setQuery(term)}>
                    <Clock className="text-muted-foreground" />
                    <span className="truncate">{term}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {actions.length > 0 && (
              <CommandGroup heading={t("search.actions")}>
                {actions.map((action) => (
                  <CommandItem key={action.href} value={`action-${action.href}`} onSelect={() => go(action.href)}>
                    <action.icon className="text-muted-foreground" />
                    <span className="truncate">{t(action.labelKey)}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {pages.length > 0 && (
              <CommandGroup heading={t("search.pages")}>
                {pages.map((page) => (
                  <CommandItem key={page.href} value={`page-${page.href}`} onSelect={() => go(page.href)}>
                    <page.icon className="text-muted-foreground" />
                    <span className="truncate">{t(page.labelKey)}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {results && results.clients.length > 0 && (
              <CommandGroup heading={t("search.clients")}>
                {results.clients.map((client) => (
                  <CommandItem
                    key={client.id}
                    value={`client-${client.id}`}
                    onSelect={() => go(searchHrefs.client(client))}
                  >
                    <Users className="text-muted-foreground" />
                    <span className="truncate">{client.name}</span>
                    {client.company && (
                      <span className="ml-auto truncate text-xs text-muted-foreground">{client.company}</span>
                    )}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {results && results.transactions.length > 0 && (
              <CommandGroup heading={t("search.transactions")}>
                {results.transactions.map((tx) => (
                  <CommandItem
                    key={tx.id}
                    value={`tx-${tx.id}`}
                    onSelect={() => go(searchHrefs.transaction(tx))}
                  >
                    <ArrowLeftRight className="text-muted-foreground" />
                    <span className="truncate">{tx.description || tx.category || tx.client_name}</span>
                    <span
                      className={`ml-auto shrink-0 text-xs tabular-nums ${
                        tx.type === "incoming" ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
                      }`}
                    >
                      {formatMoney(Number(tx.amount), currency)}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {results && results.quotations.length > 0 && (
              <CommandGroup heading={t("search.quotations")}>
                {results.quotations.map((quotation) => (
                  <CommandItem
                    key={quotation.id}
                    value={`quote-${quotation.id}`}
                    onSelect={() => go(searchHrefs.quotation(quotation))}
                  >
                    <FileText className="text-muted-foreground" />
                    <span className="truncate">{quotation.title}</span>
                    <span className="ml-auto truncate text-xs text-muted-foreground">
                      {quotation.prospect_name}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {results && results.accounts.length > 0 && (
              <CommandGroup heading={t("search.accounts")}>
                {results.accounts.map((account) => (
                  <CommandItem
                    key={account.id}
                    value={`account-${account.id}`}
                    onSelect={() => go(searchHrefs.account(account))}
                  >
                    {account.type === "space" ? (
                      <PiggyBank className="text-muted-foreground" />
                    ) : (
                      <Landmark className="text-muted-foreground" />
                    )}
                    <span className="truncate">{accountDisplayName(account) || t("nav.wealth")}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {results && results.categories.length > 0 && (
              <CommandGroup heading={t("search.categories")}>
                {results.categories.map((category) => (
                  <CommandItem
                    key={category.id}
                    value={`category-${category.id}`}
                    onSelect={() => go(searchHrefs.category())}
                  >
                    <Tag className="text-muted-foreground" />
                    <span className="truncate">{category.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
          <div className="flex items-center gap-4 border-t px-3 py-2 text-[11px] text-muted-foreground">
            <span>↑↓ {t("search.hintNavigate")}</span>
            <span>↵ {t("search.hintOpen")}</span>
            <span className="ml-auto">esc {t("search.hintClose")}</span>
          </div>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
