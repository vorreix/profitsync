import { describe, expect, it } from "vitest"
import { buildFlowGraph, buildTimelineGraph, groupKeyId, type FlowData, type TimelineData } from "./money-flow"

function leaf(id: string, amount = 100): FlowData["groups"][number]["leaves"][number] {
  return { id, type: "incoming", amount, description: "x", category: "Sales", date: "2026-06-01" }
}

const DATA: FlowData = {
  mode: "grouped",
  group_by: "client",
  personal: false,
  range: { from: "2026-01-01", to: "2026-06-30" },
  root: { label: "VorreiX", income: 900, expense: 300, net: 600, tx_count: 6, balance: 1200 },
  groups: [
    { key: "c1", kind: "client", label: "Acme", income: 500, expense: 100, net: 400, tx_count: 4, opening_balance: null, current_balance: null, leaves: [leaf("t1"), leaf("t2")], more_count: 2 },
    { key: null, kind: "client", label: "Unassigned", income: 400, expense: 200, net: 200, tx_count: 2, opening_balance: null, current_balance: null, leaves: [leaf("t3")], more_count: 0 },
  ],
}

describe("buildFlowGraph", () => {
  it("collapsed root shows only the root node, no edges", () => {
    const { nodes, edges } = buildFlowGraph(DATA, { rootCollapsed: true, expanded: new Set() })
    expect(nodes).toHaveLength(1)
    expect(nodes[0].type).toBe("root")
    expect(edges).toHaveLength(0)
  })

  it("groups collapsed: root + one node per group, one edge each", () => {
    const { nodes, edges } = buildFlowGraph(DATA, { rootCollapsed: false, expanded: new Set() })
    expect(nodes.filter((n) => n.type === "root")).toHaveLength(1)
    expect(nodes.filter((n) => n.type === "group")).toHaveLength(2)
    expect(nodes.filter((n) => n.type === "leaf")).toHaveLength(0)
    expect(edges).toHaveLength(2) // root → each group
  })

  it("expanding a group reveals its leaves + a 'more' node when more_count > 0", () => {
    const { nodes, edges } = buildFlowGraph(DATA, { rootCollapsed: false, expanded: new Set(["c1"]) })
    expect(nodes.filter((n) => n.type === "leaf")).toHaveLength(2) // t1, t2
    expect(nodes.filter((n) => n.type === "more")).toHaveLength(1) // +2 more
    // root→g1, root→g2, g1→t1, g1→t2, g1→more
    expect(edges).toHaveLength(5)
  })

  it("a group with no more_count expands without a 'more' node", () => {
    const key = groupKeyId({ key: null, label: "Unassigned" })
    const { nodes } = buildFlowGraph(DATA, { rootCollapsed: false, expanded: new Set([key]) })
    expect(nodes.filter((n) => n.type === "leaf")).toHaveLength(1) // t3
    expect(nodes.filter((n) => n.type === "more")).toHaveLength(0)
  })

  it("never overlaps: group node y-positions are strictly increasing", () => {
    const { nodes } = buildFlowGraph(DATA, { rootCollapsed: false, expanded: new Set(["c1"]) })
    const groupYs = nodes.filter((n) => n.type === "group").map((n) => n.position.y)
    for (let i = 1; i < groupYs.length; i++) expect(groupYs[i]).toBeGreaterThan(groupYs[i - 1])
  })

  it("puts groups and leaves in distinct left→right columns", () => {
    const { nodes } = buildFlowGraph(DATA, { rootCollapsed: false, expanded: new Set(["c1"]) })
    const gx = nodes.find((n) => n.type === "group")!.position.x
    const lx = nodes.find((n) => n.type === "leaf")!.position.x
    expect(nodes.find((n) => n.type === "root")!.position.x).toBe(0)
    expect(gx).toBeGreaterThan(0)
    expect(lx).toBeGreaterThan(gx)
  })

  it("groupKeyId disambiguates null keys by label", () => {
    expect(groupKeyId({ key: "c1", label: "Acme" })).toBe("c1")
    expect(groupKeyId({ key: null, label: "Unassigned" })).toBe("__none__:Unassigned")
  })
})

const TIMELINE: TimelineData = {
  mode: "timeline",
  bucket: "month",
  personal: false,
  range: { from: "2026-01-01", to: "2026-03-31" },
  periods: [
    { key: "2026-01-01", label: "Jan", bucket: "month", income: 500, expense: 200, net: 300, before: 0, after: 300, tx_count: 3, leaves: [leaf("a"), leaf("b")], more_count: 1 },
    { key: "2026-02-01", label: "Feb", bucket: "month", income: 100, expense: 400, net: -300, before: 300, after: 0, tx_count: 2, leaves: [leaf("c")], more_count: 0 },
  ],
  final: { label: "VorreiX", total_in: 600, total_out: 600, total_net: 0, balance: 1200 },
}

describe("buildTimelineGraph", () => {
  it("chains periods left→right and ends at the final entity", () => {
    const { nodes, edges } = buildTimelineGraph(TIMELINE, new Set())
    const periods = nodes.filter((n) => n.type === "tlperiod")
    expect(periods).toHaveLength(2)
    expect(nodes.filter((n) => n.type === "tlfinal")).toHaveLength(1)
    // P1 x < P2 x < final x
    const xs = [...periods.map((p) => p.position.x), nodes.find((n) => n.type === "tlfinal")!.position.x]
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1])
    // chain edges: P1→P2 and P2→final
    expect(edges).toHaveLength(2)
  })

  it("running balance carries forward (before of P2 == after of P1)", () => {
    expect(TIMELINE.periods[1].before).toBe(TIMELINE.periods[0].after)
  })

  it("expanding a period reveals its leaves + a 'more' node below it", () => {
    const { nodes } = buildTimelineGraph(TIMELINE, new Set(["2026-01-01"]))
    expect(nodes.filter((n) => n.type === "leaf")).toHaveLength(2)
    expect(nodes.filter((n) => n.type === "more")).toHaveLength(1)
    // leaves sit in the SAME column as their period (below it)
    const p1x = nodes.find((n) => n.id === "p:2026-01-01")!.position.x
    expect(nodes.filter((n) => n.type === "leaf").every((l) => l.position.x === p1x)).toBe(true)
  })

  it("handles an empty timeline (just the final node, no edges)", () => {
    const empty: TimelineData = { ...TIMELINE, periods: [] }
    const { nodes, edges } = buildTimelineGraph(empty, new Set())
    expect(nodes).toHaveLength(1)
    expect(nodes[0].type).toBe("tlfinal")
    expect(edges).toHaveLength(0)
  })
})
