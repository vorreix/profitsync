import type { Category, CategoryType, CombinedCategory } from "@/lib/types"

export const CATEGORY_TYPES: CategoryType[] = ["incoming", "outgoing", "client", "quotation"]

const TYPE_ORDER: Record<CategoryType, number> = { incoming: 0, outgoing: 1, client: 2, quotation: 3 }

export const categoryTypeLabelKey = (t: CategoryType) =>
  t === "incoming" ? "categories.incoming"
  : t === "outgoing" ? "categories.outgoing"
  : t === "client" ? "categories.client"
  : "categories.quotation"

/**
 * Fold the raw per-(name, type) category rows into "logical" categories — one
 * entry per name whose `types` is the set across its rows. Grouping is
 * case-insensitive (a category owns its name across casings); the display name
 * and color come from the earliest-created row, keeping the label stable.
 */
export function combineCategories(rows: Category[]): CombinedCategory[] {
  const map = new Map<string, { name: string; color: string; types: Set<CategoryType>; created: number }>()
  for (const r of rows) {
    const key = r.name.trim().toLowerCase()
    if (!key) continue
    const created = new Date(r.created_at).getTime()
    const existing = map.get(key)
    if (!existing) {
      map.set(key, { name: r.name, color: r.color || "", types: new Set([r.type]), created })
      continue
    }
    existing.types.add(r.type)
    // Prefer the earliest row's name + color so the label doesn't jitter.
    if (created < existing.created) {
      existing.created = created
      existing.name = r.name
      if (r.color) existing.color = r.color
    }
    if (!existing.color && r.color) existing.color = r.color // fallback when earliest had none
  }
  return [...map.values()]
    .map((e) => ({
      name: e.name,
      color: e.color,
      types: [...e.types].sort((a, b) => TYPE_ORDER[a] - TYPE_ORDER[b]),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}
