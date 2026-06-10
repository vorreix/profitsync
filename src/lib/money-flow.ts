// Pure builder: turns the /api/flow payload + a collapse state into positioned
// nodes and edges for a left→right "mind map". Framework-agnostic (no React,
// no React Flow imports) so it's fully unit-testable; the page maps these onto
// React Flow node/edge objects and renders custom components by `type`.

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

export type FlowNodeType = "root" | "group" | "leaf" | "more" | "tlperiod" | "tlfinal"

export type FlowNode = {
  id: string
  type: FlowNodeType
  position: { x: number; y: number }
  data: Record<string, unknown>
}
export type FlowEdge = { id: string; source: string; target: string }

export type CollapseState = {
  /** When true, the root hides all group branches. */
  rootCollapsed: boolean
  /** Group keys (by `groupKeyId`) whose leaves are shown. */
  expanded: Set<string>
}

// Layout constants — left→right columns + vertical rhythm.
const COL_GROUP_X = 360
const COL_LEAF_X = 720
const GROUP_V = 150 // vertical space a collapsed group occupies
const LEAF_V = 80
const ROOT_H = 200

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
    // Center the lone root against a nominal height.
    root.position.y = 0
    return { nodes, edges }
  }

  let y = 0
  for (const g of data.groups) {
    const gid = `g:${groupKeyId(g)}`
    const groupY = y
    nodes.push({ id: gid, type: "group", position: { x: COL_GROUP_X, y: groupY }, data: { ...g, expanded: state.expanded.has(groupKeyId(g)) } })
    edges.push({ id: `e:root-${gid}`, source: "root", target: gid })

    if (state.expanded.has(groupKeyId(g))) {
      let ly = groupY
      for (const leaf of g.leaves) {
        const lid = `l:${leaf.id}`
        nodes.push({ id: lid, type: "leaf", position: { x: COL_LEAF_X, y: ly }, data: { ...leaf } })
        edges.push({ id: `e:${gid}-${lid}`, source: gid, target: lid })
        ly += LEAF_V
      }
      if (g.more_count > 0) {
        const mid = `m:${groupKeyId(g)}`
        nodes.push({ id: mid, type: "more", position: { x: COL_LEAF_X, y: ly }, data: { count: g.more_count, group: g } })
        edges.push({ id: `e:${gid}-${mid}`, source: gid, target: mid })
        ly += LEAF_V
      }
      const leafCount = g.leaves.length + (g.more_count > 0 ? 1 : 0)
      // Advance past whichever is taller: the group block or its leaf stack.
      y = groupY + Math.max(GROUP_V, leafCount * LEAF_V + 24)
    } else {
      y = groupY + GROUP_V
    }
  }

  // Vertically center the root against the full branch column.
  root.position.y = Math.max(0, (y - LEAF_V - ROOT_H) / 2)

  return { nodes, edges }
}

// Timeline layout: a horizontal chain P1 → P2 → … → final entity. Each period
// sits in its own column; expanding a period stacks its leaves directly below
// it (they don't push the chain — the row stays readable). The final entity is
// one column past the last period.
const TL_COL_W = 300
const TL_PERIOD_H = 168

export function buildTimelineGraph(data: TimelineData, expandedPeriods: Set<string>): { nodes: FlowNode[]; edges: FlowEdge[] } {
  const nodes: FlowNode[] = []
  const edges: FlowEdge[] = []

  data.periods.forEach((p, i) => {
    const pid = `p:${p.key}`
    nodes.push({ id: pid, type: "tlperiod", position: { x: i * TL_COL_W, y: 0 }, data: { ...p, expanded: expandedPeriods.has(p.key) } })
    if (i > 0) edges.push({ id: `e:${data.periods[i - 1].key}-${p.key}`, source: `p:${data.periods[i - 1].key}`, target: pid })

    if (expandedPeriods.has(p.key)) {
      let ly = TL_PERIOD_H
      for (const leaf of p.leaves) {
        const lid = `l:${leaf.id}`
        nodes.push({ id: lid, type: "leaf", position: { x: i * TL_COL_W, y: ly }, data: { ...leaf } })
        edges.push({ id: `e:${pid}-${lid}`, source: pid, target: lid })
        ly += LEAF_V
      }
      if (p.more_count > 0) {
        const mid = `m:${p.key}`
        nodes.push({ id: mid, type: "more", position: { x: i * TL_COL_W, y: ly }, data: { count: p.more_count, period: p } })
        edges.push({ id: `e:${pid}-${mid}`, source: pid, target: mid })
      }
    }
  })

  // Final entity node at the end of the chain.
  const finalX = data.periods.length * TL_COL_W
  nodes.push({ id: "final", type: "tlfinal", position: { x: finalX, y: 0 }, data: { ...data.final, period_count: data.periods.length } })
  if (data.periods.length > 0) {
    const last = data.periods[data.periods.length - 1]
    edges.push({ id: `e:${last.key}-final`, source: `p:${last.key}`, target: "final" })
  }

  return { nodes, edges }
}
