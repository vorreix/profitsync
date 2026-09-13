// Custom-dashboard layout model. The dashboard is a list of known cards; a
// user's layout is just (order, hidden) per CONTEXT — personal and business
// workspaces render different card sets, so each keeps its own arrangement.
// Stored on user_profiles.dashboard_layout (jsonb) with a localStorage
// fast-path; ALWAYS normalized against the registry on read so unknown ids
// (from older/newer app versions) drop out and new cards appear at the end.

// Order here is the default, and it is also where a NEW card lands on a layout
// somebody already arranged: normalizeCtx slots a missing card in beside the
// neighbour it has here, rather than dropping it at the bottom. A card added
// between two hub summaries belongs between them — appended at the end it sits
// under the transaction list, which is not where anyone would look for it, and
// nobody re-arranges a dashboard to find out.
//
// normalizeCtx only ever adds to `order`, never to `hidden`, so a card that
// should not be seen has to say so by rendering null (see Dashboard.tsx
// `cardNodes`), not by shipping hidden.
export const DASHBOARD_CARD_IDS = ["kpis", "budget", "wealth", "debts", "recurring", "spaces", "flow", "chart", "breakdown", "latest"] as const
export type DashboardCardId = (typeof DASHBOARD_CARD_IDS)[number]

export type DashboardContext = "personal" | "business"
export type LayoutCtx = { order: DashboardCardId[]; hidden: DashboardCardId[] }
export type DashboardLayout = { version: 1; contexts: Record<DashboardContext, LayoutCtx> }

export const DEFAULT_ORDER: readonly DashboardCardId[] = DASHBOARD_CARD_IDS

const VALID = new Set<string>(DASHBOARD_CARD_IDS)

export function defaultCtx(): LayoutCtx {
  return { order: [...DEFAULT_ORDER], hidden: [] }
}

/** Drop unknown ids + dupes, append registry cards missing from the order. */
export function normalizeCtx(raw: unknown): LayoutCtx {
  const r = (raw ?? {}) as { order?: unknown; hidden?: unknown }
  const seen = new Set<string>()
  const order: DashboardCardId[] = []
  if (Array.isArray(r.order)) {
    for (const id of r.order) {
      if (typeof id === "string" && VALID.has(id) && !seen.has(id)) {
        seen.add(id)
        order.push(id as DashboardCardId)
      }
    }
  }
  // A registry card the saved order has never seen goes where this file says it
  // belongs: directly after the nearest card that precedes it by default AND is
  // actually present. That keeps the user's arrangement intact while putting a
  // new card among its own kind; only a card with no surviving predecessor
  // (the first one) goes to the front.
  for (const id of DEFAULT_ORDER) {
    if (seen.has(id)) continue
    const precede = DEFAULT_ORDER.slice(0, DEFAULT_ORDER.indexOf(id))
    let at = -1
    for (let i = precede.length - 1; i >= 0 && at === -1; i--) at = order.indexOf(precede[i])
    order.splice(at + 1, 0, id)
    seen.add(id)
  }
  const hidden: DashboardCardId[] = []
  if (Array.isArray(r.hidden)) {
    for (const id of r.hidden) {
      if (typeof id === "string" && VALID.has(id) && !hidden.includes(id as DashboardCardId)) {
        hidden.push(id as DashboardCardId)
      }
    }
  }
  return { order, hidden }
}

export function normalizeLayout(raw: unknown): DashboardLayout {
  const r = (raw ?? {}) as { contexts?: Record<string, unknown> }
  return {
    version: 1,
    contexts: {
      personal: normalizeCtx(r.contexts?.personal),
      business: normalizeCtx(r.contexts?.business),
    },
  }
}

export function sameCtx(a: LayoutCtx, b: LayoutCtx): boolean {
  return a.order.join("|") === b.order.join("|") && [...a.hidden].sort().join("|") === [...b.hidden].sort().join("|")
}

/** Move `id` so it sits before `beforeId` (or to the end when null). */
export function moveCard(order: DashboardCardId[], id: DashboardCardId, beforeId: DashboardCardId | null): DashboardCardId[] {
  const rest = order.filter((x) => x !== id)
  if (beforeId === null) return [...rest, id]
  const at = rest.indexOf(beforeId)
  if (at === -1) return order
  return [...rest.slice(0, at), id, ...rest.slice(at)]
}
