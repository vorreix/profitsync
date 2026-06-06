import { useEffect, useRef, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { Loader2 } from "lucide-react"
import { apiGet } from "@/lib/api"
import { Input } from "@/components/ui/input"

export type BrandPick = { name: string; domain: string; logoUrl: string }
type Brand = { name: string; domain: string; icon: string }

/**
 * Bank-name field with logo autocomplete. The field is always free text; as the
 * user types we debounce a server search (Brandfetch, proxied) and show matching
 * banks with their logos. Picking one fills the name + brand domain + logo. The
 * results list is rendered inline (not portalled) so it scrolls correctly inside
 * a dialog/bottom-sheet.
 */
export function BankNameCombobox({
  value,
  onChange,
  onSelectBrand,
  placeholder,
  disabled,
  autoFocus,
}: {
  value: string
  onChange: (name: string) => void
  onSelectBrand: (brand: BrandPick) => void
  placeholder?: string
  disabled?: boolean
  autoFocus?: boolean
}) {
  const { getToken } = useAuth()
  const [results, setResults] = useState<Brand[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  // Skip the search that the controlled value change triggers right after a pick.
  const skipNextSearch = useRef(false)

  useEffect(() => {
    if (skipNextSearch.current) { skipNextSearch.current = false; return }
    const q = value.trim()
    clearTimeout(debounceRef.current)
    if (q.length < 2) { setResults([]); setOpen(false); return }
    debounceRef.current = setTimeout(async () => {
      try {
        setLoading(true)
        const token = await getToken()
        if (!token) return
        const data = await apiGet<Brand[]>(`/api/wealth/bank-search?q=${encodeURIComponent(q)}`, token)
        setResults(data)
        setOpen(data.length > 0)
      } catch {
        /* search is best-effort — the field still works as free text */
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => clearTimeout(debounceRef.current)
  }, [value, getToken])

  const pick = (b: Brand) => {
    skipNextSearch.current = true
    onChange(b.name)
    onSelectBrand({ name: b.name, domain: b.domain, logoUrl: b.icon })
    setOpen(false)
    setResults([])
  }

  return (
    <div className="relative">
      <Input
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => { if (results.length) setOpen(true) }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {loading && <Loader2 className="absolute right-2.5 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
      {open && results.length > 0 && (
        <div className="absolute left-0 right-0 z-50 mt-1 max-h-64 overflow-y-auto scrollbar-thin rounded-md border bg-popover shadow-md">
          {results.map((b) => (
            <button
              key={b.domain}
              type="button"
              onMouseDown={(e) => e.preventDefault()} /* keep input focus so onClick fires before blur */
              onClick={() => pick(b)}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-muted"
            >
              {b.icon
                ? <img src={b.icon} alt="" className="size-6 shrink-0 rounded-sm object-contain" onError={(e) => { e.currentTarget.style.visibility = "hidden" }} />
                : <span className="size-6 shrink-0 rounded-sm bg-muted" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{b.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{b.domain}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
