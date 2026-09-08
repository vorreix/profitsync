import { useEffect, useRef, useState, type ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { DndContext, MouseSensor, TouchSensor, useDraggable, useSensor, useSensors, type DragEndEvent, type DragMoveEvent, type DragStartEvent } from "@dnd-kit/core"
import { Eye, EyeOff, Plus } from "lucide-react"
import type { SpendingBudget, SpendingViewWindow } from "@/lib/types"
import { useCurrency } from "@/lib/currency-context"
import { formatMoney } from "@/lib/wealth"
import { categoryKey } from "@/lib/budget"
import { BudgetRow, type BudgetRowActions } from "@/components/budget/BudgetRow"
import { asHandle, type HandleProps } from "@/components/budget/drag-handle"
import { budgetName, inView, nestBudgets } from "@/components/budget/budget-format"
import { Button } from "@/components/ui/button"

/** A row is dragged from its grip; 6px of movement starts it, so a scroll still scrolls. */
const EDGE = 0.5

type Drop = { id: string; edge: "before" | "after" } | null

/**
 * One flat, vertical drag scope. Reordering never crosses scopes: the top-level
 * budgets are one scope and each expanded parent's sub-budgets are another, so
 * a drag can only ever change the ORDER of siblings — moving a budget into or
 * out of another is a deliberate menu action, not something a slip of the
 * finger can do. Uses the repo's own drag pattern (grip + rect snapshot +
 * midpoint edge), not a new dependency.
 */
function DragScope({
  scope,
  ids,
  disabled,
  onReorder,
  children,
}: {
  scope: string
  ids: string[]
  disabled: boolean
  onReorder: (ids: string[]) => void
  children: (s: { draggingId: string | null; drop: Drop }) => ReactNode
}) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { distance: 6 } }),
  )
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [drop, setDrop] = useState<Drop>(null)
  const dropRef = useRef<Drop>(null)
  const rectsRef = useRef<{ id: string; rect: DOMRect }[]>([])
  const startRef = useRef({ x: 0, y: 0 })

  const setBoth = (next: Drop) => {
    if (dropRef.current?.id === next?.id && dropRef.current?.edge === next?.edge) return
    dropRef.current = next
    setDrop(next)
  }

  function onDragStart(e: DragStartEvent) {
    setDraggingId(String(e.active.id))
    setBoth(null)
    const ev = e.activatorEvent as { clientX?: number; clientY?: number; touches?: { clientX: number; clientY: number }[] }
    const touch = ev?.touches?.[0]
    startRef.current = { x: touch?.clientX ?? ev?.clientX ?? 0, y: touch?.clientY ?? ev?.clientY ?? 0 }
    rectsRef.current = Array.from(document.querySelectorAll<HTMLElement>(`[data-drag-scope="${scope}"] > [data-budget]`)).map((el) => ({
      id: el.dataset.budget!,
      rect: el.getBoundingClientRect(),
    }))
  }

  function onDragMove(e: DragMoveEvent) {
    const activeId = String(e.active.id)
    const y = startRef.current.y + e.delta.y
    const rows = rectsRef.current.filter((r) => r.id !== activeId)
    if (!rows.length) return setBoth(null)
    let over = rows.find((r) => y >= r.rect.top && y <= r.rect.bottom)
    if (!over) {
      let best = rows[0]
      let bestD = Infinity
      for (const r of rows) {
        const d = Math.abs(r.rect.top + r.rect.height / 2 - y)
        if (d < bestD) { bestD = d; best = r }
      }
      over = best
    }
    const f = (y - over.rect.top) / Math.max(1, over.rect.height)
    setBoth({ id: over.id, edge: f < EDGE ? "before" : "after" })
  }

  function onDragEnd(e: DragEndEvent) {
    const activeId = String(e.active.id)
    const d = dropRef.current
    setDraggingId(null)
    setBoth(null)
    if (!d || d.id === activeId) return
    const next = ids.filter((id) => id !== activeId)
    const at = next.indexOf(d.id)
    if (at === -1) return
    next.splice(d.edge === "before" ? at : at + 1, 0, activeId)
    if (next.join() !== ids.join()) onReorder(next)
  }

  if (disabled) return <>{children({ draggingId: null, drop: null })}</>
  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragMove={onDragMove} onDragEnd={onDragEnd} onDragCancel={() => { setDraggingId(null); setBoth(null) }}>
      {children({ draggingId, drop })}
    </DndContext>
  )
}

/** A row's grip, registered with whichever DragScope encloses it. */
function Draggable({ id, disabled, children }: { id: string; disabled: boolean; children: (h: HandleProps | null) => ReactNode }) {
  const drag = useDraggable({ id, disabled })
  return (
    <div ref={drag.setNodeRef}>
      {children(disabled ? null : asHandle({ ref: drag.setActivatorNodeRef, listeners: drag.listeners, attributes: drag.attributes }))}
    </div>
  )
}

/**
 * The budgets list: main budgets, each folding open to its sub-budgets, the
 * spend none of them claims, and a way to add one — always, including for a
 * budget that has none yet, which is where "add a sub-budget" used to be
 * unreachable.
 *
 * Closed budgets fold away behind one line at the bottom; a closed SUB-budget
 * stays inside its parent, where it belongs.
 */
export function BudgetList({
  budgets,
  view,
  today,
  canWrite,
  canDelete,
  reordering,
  categoryNames,
  actions,
  onReorder,
}: {
  budgets: SpendingBudget[]
  view: SpendingViewWindow
  today: string
  canWrite: boolean
  canDelete: boolean
  reordering: boolean
  /** Every expense category in the workspace — for "is there anything left to split?" */
  categoryNames: string[]
  actions: BudgetRowActions & { onWidenScope: (parent: SpendingBudget) => void }
  onReorder: (ids: string[]) => void
}) {
  const { t } = useTranslation()
  const { currency } = useCurrency()
  const money = (n: number) => formatMoney(n, currency)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [showClosed, setShowClosed] = useState(false)

  const groups = nestBudgets(budgets).filter((g) => !g.budget.is_overall)
  const open = groups.filter((g) => g.budget.status === "active")
  const closed = groups.filter((g) => g.budget.status === "closed")

  // A row with sub-budgets starts open, so the split is visible without a tap.
  useEffect(() => {
    setExpanded((prev) => {
      const next = { ...prev }
      for (const g of groups) if (next[g.budget.id] === undefined && g.children.length > 0) next[g.budget.id] = true
      return next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [budgets.length])

  const toggle = (id: string) => setExpanded((p) => ({ ...p, [id]: !p[id] }))

  /** What a sub-budget of this parent could still claim: its scope minus what live siblings hold. */
  const freeFor = (parent: SpendingBudget, children: SpendingBudget[]) => {
    const pool = parent.categories.length ? parent.categories : categoryNames
    const taken = new Set(children.filter((c) => c.status === "active").flatMap((c) => c.categories).map(categoryKey))
    return pool.filter((c) => !taken.has(categoryKey(c)))
  }

  const renderGroup = (g: { budget: SpendingBudget; children: SpendingBudget[] }, i: number, list: typeof groups, dragging: string | null, drop: Drop) => {
    const b = g.budget
    const isOpen = expanded[b.id] ?? false
    const free = freeFor(b, g.children)
    const rest = inView(b, view, today).other_spent
    // A closed SUB-budget stays inside its parent, where it belongs — the
    // "Closed" fold at the bottom is for whole budgets only.
    const kids = g.children
    return (
      <Draggable key={b.id} id={b.id} disabled={!reordering || !canWrite}>
        {(handle) => (
          <>
            <BudgetRow
              budget={b}
              view={view}
              today={today}
              depth={0}
              childCount={g.children.length}
              expanded={isOpen}
              onToggleExpand={() => toggle(b.id)}
              reordering={reordering}
              handle={handle}
              dragging={dragging === b.id}
              dropEdge={drop?.id === b.id ? drop.edge : null}
              isFirst={i === 0}
              isLast={i === list.length - 1}
              canWrite={canWrite}
              canDelete={canDelete}
              actions={actions}
            />
            {isOpen && (
              <div className="mt-1" data-drag-scope={`sub-${b.id}`}>
                <DragScope
                  scope={`sub-${b.id}`}
                  ids={kids.map((c) => c.id)}
                  disabled={!reordering || !canWrite || kids.length < 2}
                  onReorder={onReorder}
                >
                  {({ draggingId: dId, drop: dDrop }) => (
                    <ul className="space-y-1">
                      {kids.map((c, ci) => (
                        <Draggable key={c.id} id={c.id} disabled={!reordering || !canWrite}>
                          {(h) => (
                            <BudgetRow
                              budget={c}
                              view={view}
                              today={today}
                              depth={1}
                              expanded={false}
                              reordering={reordering}
                              handle={h}
                              dragging={dId === c.id}
                              dropEdge={dDrop?.id === c.id ? dDrop.edge : null}
                              isFirst={ci === 0}
                              isLast={ci === kids.length - 1}
                              canWrite={canWrite}
                              canDelete={canDelete}
                              actions={actions}
                            />
                          )}
                        </Draggable>
                      ))}
                    </ul>
                  )}
                </DragScope>
                {kids.length > 0 && rest !== null && rest > 0.004 && (
                  <p className="ms-14 mt-1 text-[11px] text-muted-foreground sm:ms-12">{t("budgets.notInSubBudgets", { amount: money(rest) })}</p>
                )}
                {canWrite && !reordering && !b.is_overall && (
                  <div className="ms-4 mt-1 sm:ms-6">
                    {free.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => actions.onAddSub(b)}
                        data-testid="add-sub-inline"
                        className="pressable inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-dashed px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:min-h-9"
                      >
                        <Plus className="size-3.5" aria-hidden /> {t("budgets.addSub")}
                      </button>
                    ) : (
                      // Splitting a budget by category needs a category left to
                      // split off. Say so, and offer the one thing that unblocks
                      // it — as a real target, not a word in a sentence.
                      <div className="space-y-1">
                        <p className="text-[11px] text-muted-foreground">{t("budgets.subFull", { name: budgetName(t, b) })}</p>
                        <button
                          type="button"
                          onClick={() => actions.onWidenScope(b)}
                          data-testid="widen-scope"
                          className="pressable inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-dashed px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:min-h-9"
                        >
                          <Plus className="size-3.5" aria-hidden /> {t("budgets.subFullAction")}
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {kids.length === 0 && (
                  <p className="ms-4 mt-1 text-[11px] text-muted-foreground sm:ms-6">{t("budgets.noSubsHint")}</p>
                )}
              </div>
            )}
          </>
        )}
      </Draggable>
    )
  }

  return (
    <div className="space-y-1">
      <div data-drag-scope="top">
        <DragScope scope="top" ids={open.map((g) => g.budget.id)} disabled={!reordering || !canWrite || open.length < 2} onReorder={onReorder}>
          {({ draggingId, drop }) => (
            <ul className="space-y-1" data-testid="budget-list">
              {open.map((g, i) => renderGroup(g, i, open, draggingId, drop))}
            </ul>
          )}
        </DragScope>
      </div>

      {closed.length > 0 && (
        <div className="border-t pt-2">
          <button
            type="button"
            onClick={() => setShowClosed((v) => !v)}
            data-testid="closed-toggle"
            className="pressable inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:min-h-9"
          >
            {showClosed ? <EyeOff className="size-3.5" aria-hidden /> : <Eye className="size-3.5" aria-hidden />}
            {t("budgets.closedCount", { count: closed.length })}
          </button>
          {showClosed && (
            <ul className="mt-1 space-y-1" data-testid="closed-list">
              {closed.map((g, i) => (
                <BudgetRow
                  key={g.budget.id}
                  budget={g.budget}
                  view={view}
                  today={today}
                  depth={0}
                  childCount={g.children.length}
                  expanded={false}
                  onToggleExpand={() => toggle(g.budget.id)}
                  isFirst={i === 0}
                  isLast={i === closed.length - 1}
                  canWrite={canWrite}
                  canDelete={canDelete}
                  actions={actions}
                />
              ))}
            </ul>
          )}
        </div>
      )}

      {canWrite && open.length === 0 && closed.length === 0 && (
        <p className="px-2 py-6 text-center text-xs text-muted-foreground">{t("budgets.noneYet")}</p>
      )}
    </div>
  )
}

export function AddBudgetButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button size="sm" className="h-11 sm:h-9" onClick={onClick} data-testid="budget-add">
      <Plus className="size-4" /> {label}
    </Button>
  )
}
