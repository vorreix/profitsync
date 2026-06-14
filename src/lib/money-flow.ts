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
  amount: number
  description: string
  category: string
  date: string
  client_name?: string | null
  account_name?: string | null
  recurring?: boolean
}

export type FlowGroup = {
  key: string | null
  kind: "account" | "client" | "category"
  label: string
  icon?: string | null
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
}

// NB: "group" is a RESERVED React Flow built-in node type (it ships default
// background/border/width styling for `.react-flow__node-group`). We call ours
// "branch" so RF doesn't paint a ghost box behind our card or clamp its width.
export type FlowNodeType = "root" | "branch" | "leaf" | "more" | "tlperiod" | "tlfinal"

export type FlowNode = {
  id: string
  type: FlowNodeType
  position: { x: number; y: number }
  data: Record<string, unknown>
}

// ── Edge encoding ────────────────────────────────────────────────────────────
// `tone` drives the gradient colour, `weight` (0–1) drives the stroke thickness
// so fat pipes = big money. `kind` lets the edge component pick a base style.
export type EdgeTone = "income" | "expense" | "neutral"
export type FlowEdgeKind = "branch" | "leaf" | "chain" | "final"
export type FlowEdgeData = {
  tone: EdgeTone
  /** 0–1, normalized money volume through this edge → stroke width. */
  weight: number
  kind: FlowEdgeKind
  /** Whether the flowing-dash animation should run on this edge. */
  animated: boolean
}
export type FlowEdge = { id: string; source: string; target: string; data: FlowEdgeData }

export type CollapseState = {
  /** When true, the root hides all group branches. */
  rootCollapsed: boolean
  /** Group keys (by `groupKeyId`) whose leaves are shown. */
  expanded: Set<string>
}

// Layout constants — left→right columns + vertical rhythm. Heights are tuned to
// the rendered node DOM so nothing overlaps and edges meet handles cleanly.
const COL_GROUP_X = 380
const COL_LEAF_X = 760
const GROUP_H = 172 // a collapsed group's vertical footprint (account variant is tallest)
const GROUP_GAP = 36 // breathing room between group blocks
const LEAF_V = 78 // vertical pitch of a stacked leaf
const ROOT_H = 232

const tone = (net: number): EdgeTone => (net >= 0 ? "income" : "expense")
const leafTone = (l: FlowLeaf): EdgeTone => (l.type === "incoming" ? "income" : "expense")
const norm = (v: number, max: number): number => (max > 0 ? Math.min(1, v / max) : 0)

/** Stable id for a group whose API key may be null (e.g. "Unassigned"). */
export function groupKeyId(g: Pick<FlowGroup, "key" | "label">): string {
  return g.key ?? `__none__:${g.label}`
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

  // Normalize branch thickness against the busiest group (income + expense).
  const maxGroupVol = data.groups.reduce((m, g) => Math.max(m, g.income + g.expense), 0)

  let y = 0
  for (const g of data.groups) {
    const key = groupKeyId(g)
    const gid = `g:${key}`
    const isOpen = state.expanded.has(key)

    const leafCount = isOpen ? g.leaves.length + (g.more_count > 0 ? 1 : 0) : 0
    const stackH = leafCount * LEAF_V
    // The block this group occupies: tall enough for its leaf stack when open.
    const blockH = Math.max(GROUP_H, stackH)
    // Centre the group node and its leaf stack vertically within the block, so
    // the parent sits level with the middle of its children (balanced tree).
    const groupY = y + (blockH - GROUP_H) / 2

    nodes.push({ id: gid, type: "branch", position: { x: COL_GROUP_X, y: groupY }, data: { ...g, expanded: isOpen } })
    edges.push({
      id: `e:root-${gid}`,
      source: "root",
      target: gid,
      data: { tone: tone(g.net), weight: norm(g.income + g.expense, maxGroupVol), kind: "branch", animated: true },
    })

    if (isOpen) {
      const maxLeafAmt = g.leaves.reduce((m, l) => Math.max(m, l.amount), 0)
      let ly = y + (blockH - stackH) / 2
      g.leaves.forEach((leaf, li) => {
        const lid = `l:${leaf.id}`
        nodes.push({ id: lid, type: "leaf", position: { x: COL_LEAF_X, y: ly }, data: { ...leaf, enterIndex: li } })
        edges.push({
          id: `e:${gid}-${lid}`,
          source: gid,
          target: lid,
          data: { tone: leafTone(leaf), weight: 0.15 + norm(leaf.amount, maxLeafAmt) * 0.35, kind: "leaf", animated: true },
        })
        ly += LEAF_V
      })
      if (g.more_count > 0) {
        const mid = `m:${key}`
        nodes.push({ id: mid, type: "more", position: { x: COL_LEAF_X, y: ly }, data: { count: g.more_count, group: g, enterIndex: g.leaves.length } })
        edges.push({ id: `e:${gid}-${mid}`, source: gid, target: mid, data: { tone: "neutral", weight: 0.15, kind: "leaf", animated: false } })
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
const TL_COL_W = 320
const TL_PERIOD_H = 200

export function buildTimelineGraph(data: TimelineData, expandedPeriods: Set<string>): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodes: FlowNode[] = []
  const edges: FlowEdge[] = []

  const maxPeriodVol = data.periods.reduce((m, p) => Math.max(m, p.income + p.expense), 0)

  data.periods.forEach((p, i) => {
    const pid = `p:${p.key}`
    nodes.push({ id: pid, type: "tlperiod", position: { x: i * TL_COL_W, y: 0 }, data: { ...p, expanded: expandedPeriods.has(p.key) } })
    if (i > 0) {
      const prev = data.periods[i - 1]
      edges.push({
        id: `e:${prev.key}-${p.key}`,
        source: `p:${prev.key}`,
        target: pid,
        data: { tone: tone(p.net), weight: norm(p.income + p.expense, maxPeriodVol), kind: "chain", animated: true },
      })
    }

    if (expandedPeriods.has(p.key)) {
      const maxLeafAmt = p.leaves.reduce((m, l) => Math.max(m, l.amount), 0)
      let ly = TL_PERIOD_H
      p.leaves.forEach((leaf, li) => {
        const lid = `l:${leaf.id}`
        nodes.push({ id: lid, type: "leaf", position: { x: i * TL_COL_W, y: ly }, data: { ...leaf, enterIndex: li } })
        edges.push({
          id: `e:${pid}-${lid}`,
          source: pid,
          target: lid,
          data: { tone: leafTone(leaf), weight: 0.15 + norm(leaf.amount, maxLeafAmt) * 0.35, kind: "leaf", animated: true },
        })
        ly += LEAF_V
      })
      if (p.more_count > 0) {
        const mid = `m:${p.key}`
        nodes.push({ id: mid, type: "more", position: { x: i * TL_COL_W, y: ly }, data: { count: p.more_count, period: p, enterIndex: p.leaves.length } })
        edges.push({ id: `e:${pid}-${mid}`, source: pid, target: mid, data: { tone: "neutral", weight: 0.15, kind: "leaf", animated: false } })
      }
    }
  })

  // Final entity node at the end of the chain.
  const finalX = data.periods.length * TL_COL_W
  nodes.push({ id: "final", type: "tlfinal", position: { x: finalX, y: 0 }, data: { ...data.final, period_count: data.periods.length } })
  if (data.periods.length > 0) {
    const last = data.periods[data.periods.length - 1]
    edges.push({
      id: `e:${last.key}-final`,
      source: `p:${last.key}`,
      target: "final",
      data: { tone: tone(data.final.total_net), weight: 1, kind: "final", animated: true },
    })
  }

  return { nodes, edges }
}
