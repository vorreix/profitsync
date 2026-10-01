// Pure builder: turns the /api/flow payload + a collapse state into positioned
// nodes and edges for a left→right money-flow graph. Framework-agnostic (no
// React, no React Flow imports) so it's fully unit-testable; the page maps these
// onto React Flow node/edge objects and renders custom components by `type`.
//
// Edges carry `data` (tone + normalized weight) so the canvas can draw smooth,
// gradient-coloured bezier "pipes" whose THICKNESS encodes how much money moves
// through each branch (Sankey-style) and whose COLOUR encodes direction
// (money in vs money out). The layout centres every parent against its children
// so the result reads like a balanced flow map rather than a stack of boxes.

export type FlowLeaf = {
  id: string
  type: "incoming" | "outgoing"
  /** NATIVE, in `currency_code` — except a split across currencies (see collapseLegs). */
  amount: number
  /** The leg's own currency; null on a split whose legs differ (its amount is then in the reporting currency). */
  currency_code?: string | null
  /** `amount` converted at the row's date into the reporting currency; null = no rate. */
  reporting_amount?: number | null
  /** A split across currencies with a leg that has no rate: its native total per currency, never added across. */
  amount_parts?: { currency: string; amount: number }[]
  description: string
  category: string
  date: string
  client_name?: string | null
  account_name?: string | null
  recurring?: boolean
  /** Split transactions share a group_id across their per-account legs. */
  group_id?: string | null
  /** >1 ⇒ this leaf is a SPLIT (a single transaction across N accounts). */
  leg_count?: number
  /** The per-account legs of a split (set only when leg_count > 1). */
  legs?: { account_name: string | null; amount: number; currency_code?: string | null }[]
}

export type FlowGroup = {
  key: string | null
  kind: "account" | "client" | "category"
  label: string
  icon?: string | null
  /** Bank/account logo as a data: URL or remote URL (account dimension only). */
  logo_src?: string | null
  account_type?: string | null
  income: number
  expense: number
  net: number
  tx_count: number
  opening_balance: number | null
  current_balance: number | null
  leaves: FlowLeaf[]
  more_count: number
}

export type FlowData = {
  mode: "grouped"
  group_by: "account" | "client" | "category"
  personal: boolean
  range: { from: string; to: string }
  root: { label: string; income: number; expense: number; net: number; tx_count: number; balance: number }
  groups: FlowGroup[]
}

// ── Timeline mode ────────────────────────────────────────────────────────────
export type TimelinePeriod = {
  key: string
  label: string
  bucket: string
  income: number
  expense: number
  net: number
  before: number // running cumulative net BEFORE this period
  after: number // running cumulative net AFTER this period
  tx_count: number
  /** Rows in this period left out of its figures (no rate for their day). */
  excluded_count?: number
  leaves: FlowLeaf[]
  more_count: number
}

export type TimelineData = {
  mode: "timeline"
  bucket: string
  personal: boolean
  range: { from: string; to: string }
  periods: TimelinePeriod[]
  final: { label: string; total_in: number; total_out: number; total_net: number; balance: number }
  /** Periods in the whole range — `periods` holds only the newest window of it. */
  period_total?: number
  period_limit?: number
  /** There are older periods the chain is not drawing yet. */
  has_more_periods?: boolean
}

// NB: "group" is a RESERVED React Flow built-in node type (it ships default
// background/border/width styling for `.react-flow__node-group`). We call ours
// "branch" so RF doesn't paint a ghost box behind our card or clamp its width.
export type FlowNodeType = "root" | "branch" | "leaf" | "more" | "tlperiod" | "tlfinal" | "tlolder"

export type FlowNode = {
  id: string
  type: FlowNodeType
  position: { x: number; y: number }
  data: Record<string, unknown>
}

// ── Edge encoding ────────────────────────────────────────────────────────────
// An edge can carry money in BOTH directions (a client both pays us and gets
// paid). So each edge records the income (green, flows toward the workspace) and
// expense (red, flows outward) it carries, plus a pre-computed px stroke width
// per direction (0 when that direction is empty). The edge component renders the
// two as independent animated layers — green dots one way, red dots the other.
export type EdgeTone = "income" | "expense" | "neutral"
export type FlowEdgeKind = "branch" | "leaf" | "chain" | "final" | "more"
export type FlowEdgeData = {
  income: number
  expense: number
  /** px stroke width for the green (incoming) layer; 0 = no inflow. */
  inWidth: number
  /** px stroke width for the red (outgoing) layer; 0 = no outflow. */
  outWidth: number
  kind: FlowEdgeKind
  /** Whether the flowing-dash animation should run. */
  animated: boolean
}
export type FlowEdge = { id: string; source: string; target: string; data: FlowEdgeData }

export type CollapseState = {
  /** When true, the root hides all group branches. */
  rootCollapsed: boolean
  /** Group keys (by `groupKeyId`) whose leaves are shown. */
  expanded: Set<string>
  /** The single split-leaf id whose per-account legs are revealed (one at a time). */
  expandedSplit?: string | null
}

// Layout constants — left→right columns + vertical rhythm. Heights are tuned to
// the rendered node DOM so nothing overlaps and edges meet handles cleanly.
const COL_GROUP_X = 380
const COL_LEAF_X = 760
const LEAF_W = 236 // rendered leaf width
const LEAF_COL_STEP = LEAF_W + 30 // horizontal pitch between leaf grid columns
const GROUP_H = 172 // a collapsed group's vertical footprint (account variant is tallest)
const GROUP_GAP = 40 // breathing room between group blocks
const LEAF_V = 80 // vertical pitch of a stacked leaf
const SPLIT_LEG_H = 22 // extra height an expanded split reserves per leg row
const ROOT_H = 232
const TL_COL_W = 320 // horizontal pitch of the timeline chain
const TL_PERIOD_H = 200 // a period card's vertical footprint

/**
 * How much canvas each node type actually occupies, for measuring the graph.
 * These mirror the rendered cards (the same numbers the layout above spaces
 * things by), so the bounds are known the moment the graph is built — before
 * React Flow has measured a single DOM node.
 */
const NODE_SIZE: Record<FlowNodeType, { w: number; h: number }> = {
  root: { w: 300, h: ROOT_H },
  branch: { w: 300, h: GROUP_H },
  leaf: { w: LEAF_W, h: 64 },
  more: { w: LEAF_W, h: 56 },
  tlperiod: { w: 280, h: TL_PERIOD_H },
  tlfinal: { w: 280, h: ROOT_H },
  tlolder: { w: 236, h: 96 },
}

/**
 * The bounding box of a built graph, in canvas units.
 *
 * The page turns this into the LOWEST zoom worth allowing: a timeline bucketed
 * by day over a long range is tens of thousands of pixels wide, and a fixed
 * minimum zoom (0.2) simply cannot show both ends of it — you pan forever and
 * never see the shape. Empty graph → a zero box, which the caller reads as "no
 * constraint".
 */
export function graphBounds(nodes: { type?: string; position: { x: number; y: number } }[]): { width: number; height: number } {
  if (nodes.length === 0) return { width: 0, height: 0 }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const n of nodes) {
    const size = NODE_SIZE[n.type as FlowNodeType] ?? { w: 280, h: 160 }
    minX = Math.min(minX, n.position.x)
    minY = Math.min(minY, n.position.y)
    maxX = Math.max(maxX, n.position.x + size.w)
    maxY = Math.max(maxY, n.position.y + size.h)
  }
  return { width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) }
}

/** Extra vertical space an expanded split leaf needs for its inline legs. */
const splitExtra = (leaf: FlowLeaf | undefined, expandedSplit?: string | null): number =>
  leaf && (leaf.leg_count ?? 1) > 1 && leaf.id === expandedSplit ? (leaf.leg_count ?? 0) * SPLIT_LEG_H + 6 : 0

const norm = (v: number, max: number): number => (max > 0 ? Math.min(1, v / max) : 0)
// Map a money amount to a stroke width (px); 0 stays 0 so an empty direction
// draws nothing. Kept deliberately THIN with a hard cap — the connection should
// read as a slim line whose weight only subtly reflects the money, never a slab.
const MIN_W = 1.1
const MAX_W = 3
const widthFor = (amount: number, max: number): number => (amount > 0 ? MIN_W + norm(amount, max) * (MAX_W - MIN_W) : 0)

// Lay leaves out in a tidy grid (columns fill top→bottom) so a big expansion
// stays compact instead of becoming one very tall column.
function gridCols(n: number): number {
  if (n <= 6) return 1
  if (n <= 14) return 2
  if (n <= 27) return 3
  return 4
}

/** Stable id for a group whose API key may be null (e.g. "Unassigned"). */
export function groupKeyId(g: Pick<FlowGroup, "key" | "label">): string {
  return g.key ?? `__none__:${g.label}`
}

/** Distinct LOGICAL transactions in a leaf list (a split's legs count once). */
export function logicalCount(leaves: FlowLeaf[]): number {
  const seen = new Set<string>()
  for (const l of leaves) seen.add(l.group_id ?? l.id)
  return seen.size
}

/**
 * Collapse split legs into one node. Legs sharing a `group_id` (the same logical
 * transaction paid across N accounts) merge into a single "split" leaf carrying
 * the summed amount + the per-account breakdown (`legs`, `leg_count`). Plain
 * transactions and lone legs (e.g. the one leg that lands in a given account)
 * pass through unchanged. First-appearance order is preserved (date-desc).
 *
 * Legs in ONE currency add natively. Legs in several (only the API or an old
 * client can post such a split) never do: the total is the sum of their
 * reporting amounts with `currency_code: null` (so it is labelled with the
 * reporting currency), or — when a leg has no rate — `amount_parts`, one
 * native total per currency. Each leg keeps its own currency either way.
 */
export function collapseLegs(leaves: FlowLeaf[]): FlowLeaf[] {
  const groups = new Map<string, FlowLeaf[]>()
  const order: (FlowLeaf | string)[] = []
  for (const l of leaves) {
    if (!l.group_id) { order.push(l); continue }
    if (!groups.has(l.group_id)) { groups.set(l.group_id, []); order.push(l.group_id) }
    groups.get(l.group_id)!.push(l)
  }
  return order.map((item) => {
    if (typeof item !== "string") return item
    const legs = groups.get(item)!
    if (legs.length === 1) return { ...legs[0] } // lone leg → a normal single tx
    const split = {
      ...legs[0],
      id: item,
      account_name: null,
      leg_count: legs.length,
      legs: legs.map((l) => ({ account_name: l.account_name ?? null, amount: l.amount, currency_code: l.currency_code })),
    }
    const mixed = new Set(legs.map((l) => l.currency_code ?? null)).size > 1
    if (!mixed) {
      // `split` spreads legs[0], so its reporting_amount is one leg's — re-sum it (null if any leg has no rate).
      const rep = legs.every((l) => l.reporting_amount != null) ? legs.reduce((s, l) => s + (l.reporting_amount as number), 0) : null
      return { ...split, amount: legs.reduce((s, l) => s + l.amount, 0), reporting_amount: rep }
    }
    const converted = legs.every((l) => l.reporting_amount != null)
    // ponytail: a rate-less mixed split draws its edge from the legs that DO convert; only the label matters.
    const amount = legs.reduce((s, l) => s + (l.reporting_amount ?? 0), 0)
    const parts = new Map<string, number>()
    for (const l of legs) parts.set(l.currency_code ?? "", (parts.get(l.currency_code ?? "") ?? 0) + l.amount)
    return {
      ...split,
      amount,
      currency_code: null,
      reporting_amount: converted ? amount : null,
      amount_parts: converted ? undefined : [...parts].map(([currency, amount]) => ({ currency, amount })),
    }
  })
}

export function buildFlowGraph(data: FlowData, state: CollapseState): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodes: FlowNode[] = []
  const edges: FlowEdge[] = []

  const root: FlowNode = {
    id: "root",
    type: "root",
    position: { x: 0, y: 0 },
    data: { ...data.root, group_by: data.group_by, group_count: data.groups.length, collapsed: state.rootCollapsed },
  }
  nodes.push(root)

  if (state.rootCollapsed) {
    root.position.y = 0
    return { nodes, edges }
  }

  // Normalize branch-layer thickness against the busiest single direction so the
  // green/red widths are comparable across all branches.
  const maxDir = data.groups.reduce((m, g) => Math.max(m, g.income, g.expense), 0)

  let y = 0
  for (const g of data.groups) {
    const key = groupKeyId(g)
    const gid = `g:${key}`
    const isOpen = state.expanded.has(key)

    // Collapse split legs into single nodes before laying anything out.
    const leaves = isOpen ? collapseLegs(g.leaves) : []
    const hasMore = isOpen && g.more_count > 0
    const slotCount = leaves.length + (hasMore ? 1 : 0)
    const cols = gridCols(slotCount)
    const rows = slotCount > 0 ? Math.ceil(slotCount / cols) : 0

    // Variable-height column-major grid: an expanded split reserves room for its
    // inline legs, so we accumulate heights per column instead of a fixed pitch.
    const colTop = new Array(Math.max(1, cols)).fill(0)
    const placed: { x: number; y: number }[] = []
    for (let idx = 0; idx < slotCount; idx++) {
      const col = Math.floor(idx / rows)
      placed[idx] = { x: COL_LEAF_X + col * LEAF_COL_STEP, y: colTop[col] }
      colTop[col] += LEAF_V + splitExtra(leaves[idx], state.expandedSplit)
    }
    const gridH = Math.max(0, ...colTop)
    const blockH = Math.max(GROUP_H, gridH)
    const groupY = y + (blockH - GROUP_H) / 2
    const startY = y + (blockH - gridH) / 2
    const at = (idx: number) => ({ x: placed[idx].x, y: startY + placed[idx].y })

    nodes.push({ id: gid, type: "branch", position: { x: COL_GROUP_X, y: groupY }, data: { ...g, expanded: isOpen } })
    edges.push({
      id: `e:root-${gid}`,
      source: "root",
      target: gid,
      data: { income: g.income, expense: g.expense, inWidth: widthFor(g.income, maxDir), outWidth: widthFor(g.expense, maxDir), kind: "branch", animated: true },
    })

    if (isOpen) {
      const maxLeafAmt = leaves.reduce((m, l) => Math.max(m, l.amount), 0)
      leaves.forEach((leaf, li) => {
        const lid = `l:${leaf.id}`
        const splitExpanded = (leaf.leg_count ?? 1) > 1 && leaf.id === state.expandedSplit
        nodes.push({ id: lid, type: "leaf", position: at(li), data: { ...leaf, enterIndex: li, splitExpanded } })
        const inc = leaf.type === "incoming"
        edges.push({
          id: `e:${gid}-${lid}`,
          source: gid,
          target: lid,
          data: { income: inc ? leaf.amount : 0, expense: inc ? 0 : leaf.amount, inWidth: inc ? widthFor(leaf.amount, maxLeafAmt) : 0, outWidth: inc ? 0 : widthFor(leaf.amount, maxLeafAmt), kind: "leaf", animated: true },
        })
      })
      if (hasMore) {
        const mid = `m:${key}`
        nodes.push({ id: mid, type: "more", position: at(leaves.length), data: { count: g.more_count, group: g, mkey: key, enterIndex: leaves.length } })
        edges.push({ id: `e:${gid}-${mid}`, source: gid, target: mid, data: { income: 0, expense: 0, inWidth: 0, outWidth: 0, kind: "more", animated: false } })
      }
    }

    y += blockH + GROUP_GAP
  }

  // Vertically centre the root against the full branch column.
  const totalH = Math.max(0, y - GROUP_GAP)
  root.position.y = Math.max(0, (totalH - ROOT_H) / 2)

  return { nodes, edges }
}

// Timeline layout: a horizontal chain P1 → P2 → … → final entity. Each period
// sits in its own column; expanding a period stacks its leaves directly below
// it (they don't push the chain — the row stays readable). The final entity is
// one column past the last period.

export function buildTimelineGraph(data: TimelineData, expandedPeriods: Set<string>, expandedSplit?: string | null): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodes: FlowNode[] = []
  const edges: FlowEdge[] = []

  const maxDir = data.periods.reduce((m, p) => Math.max(m, p.income, p.expense), 0)

  data.periods.forEach((p, i) => {
    const pid = `p:${p.key}`
    nodes.push({ id: pid, type: "tlperiod", position: { x: i * TL_COL_W, y: 0 }, data: { ...p, expanded: expandedPeriods.has(p.key) } })
    if (i > 0) {
      const prev = data.periods[i - 1]
      edges.push({
        id: `e:${prev.key}-${p.key}`,
        source: `p:${prev.key}`,
        target: pid,
        data: { income: p.income, expense: p.expense, inWidth: widthFor(p.income, maxDir), outWidth: widthFor(p.expense, maxDir), kind: "chain", animated: true },
      })
    }

    if (expandedPeriods.has(p.key)) {
      const leaves = collapseLegs(p.leaves)
      const maxLeafAmt = leaves.reduce((m, l) => Math.max(m, l.amount), 0)
      let ly = TL_PERIOD_H
      leaves.forEach((leaf, li) => {
        const lid = `l:${leaf.id}`
        const splitExpanded = (leaf.leg_count ?? 1) > 1 && leaf.id === expandedSplit
        nodes.push({ id: lid, type: "leaf", position: { x: i * TL_COL_W, y: ly }, data: { ...leaf, enterIndex: li, splitExpanded } })
        const inc = leaf.type === "incoming"
        edges.push({
          id: `e:${pid}-${lid}`,
          source: pid,
          target: lid,
          data: { income: inc ? leaf.amount : 0, expense: inc ? 0 : leaf.amount, inWidth: inc ? widthFor(leaf.amount, maxLeafAmt) : 0, outWidth: inc ? 0 : widthFor(leaf.amount, maxLeafAmt), kind: "leaf", animated: true },
        })
        ly += LEAF_V + splitExtra(leaf, expandedSplit)
      })
      if (p.more_count > 0) {
        const mid = `m:${p.key}`
        nodes.push({ id: mid, type: "more", position: { x: i * TL_COL_W, y: ly }, data: { count: p.more_count, period: p, mkey: p.key, enterIndex: leaves.length } })
        edges.push({ id: `e:${pid}-${mid}`, source: pid, target: mid, data: { income: 0, expense: 0, inWidth: 0, outWidth: 0, kind: "more", animated: false } })
      }
    }
  })

  // The chain draws the NEWEST window of the range. When older periods exist,
  // it opens with a card saying so — at the far left, where the timeline
  // already reads "earlier", rather than as a control somewhere in the chrome.
  if (data.has_more_periods && data.periods.length > 0) {
    const first = data.periods[0]
    const remaining = Math.max(0, (data.period_total ?? 0) - data.periods.length)
    nodes.push({ id: "older", type: "tlolder", position: { x: -TL_COL_W, y: (TL_PERIOD_H - 96) / 2 }, data: { remaining, bucket: data.bucket } })
    edges.push({
      id: "e:older-first",
      source: "older",
      target: `p:${first.key}`,
      data: { income: 0, expense: 0, inWidth: 0, outWidth: 0, kind: "more", animated: false },
    })
  }

  // Final entity node at the end of the chain.
  const finalX = data.periods.length * TL_COL_W
  nodes.push({ id: "final", type: "tlfinal", position: { x: finalX, y: 0 }, data: { ...data.final, period_count: data.periods.length } })
  if (data.periods.length > 0) {
    const last = data.periods[data.periods.length - 1]
    const fmax = Math.max(data.final.total_in, data.final.total_out, 1)
    edges.push({
      id: `e:${last.key}-final`,
      source: `p:${last.key}`,
      target: "final",
      data: { income: data.final.total_in, expense: data.final.total_out, inWidth: widthFor(data.final.total_in, fmax), outWidth: widthFor(data.final.total_out, fmax), kind: "final", animated: true },
    })
  }

  return { nodes, edges }
}

// ── Inline "load more" ───────────────────────────────────────────────────────
// When the user expands a group's "+N more" into the canvas, the page fetches
// the next batch of leaves and stashes them under the group's key. This merges
// those extra leaves into the data (deduped by id) and recomputes `more_count`
// so the builder renders the larger leaf stack and shrinks/drops the more-node.
// Pure + immutable so it stays unit-testable and never mutates server data.
function dedupeLeaves(leaves: FlowLeaf[]): FlowLeaf[] {
  const seen = new Set<string>()
  const out: FlowLeaf[] = []
  for (const l of leaves) {
    if (seen.has(l.id)) continue
    seen.add(l.id)
    out.push(l)
  }
  return out
}

export function applyExtraLeaves<T extends FlowData | TimelineData>(data: T, extra: Record<string, FlowLeaf[]>): T {
  if (!extra || Object.keys(extra).length === 0) return data
  if (data.mode === "timeline") {
    return {
      ...data,
      periods: data.periods.map((p) => {
        const ex = extra[p.key]
        if (!ex || ex.length === 0) return p
        const leaves = dedupeLeaves([...p.leaves, ...ex])
        // tx_count is logical; compare against logical leaves shown (splits as 1).
        return { ...p, leaves, more_count: Math.max(0, p.tx_count - logicalCount(leaves)) }
      }),
    }
  }
  return {
    ...data,
    groups: data.groups.map((g) => {
      const ex = extra[groupKeyId(g)]
      if (!ex || ex.length === 0) return g
      const leaves = dedupeLeaves([...g.leaves, ...ex])
      return { ...g, leaves, more_count: Math.max(0, g.tx_count - logicalCount(leaves)) }
    }),
  }
}
