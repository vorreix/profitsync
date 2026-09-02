import { useEffect, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core"
import { ChevronDown, ChevronUp, GripVertical } from "lucide-react"
import { apiPost } from "@/lib/api"
import type { BudgetEnvelopeView } from "@/lib/types"

/**
 * A reorderable envelope list.
 *
 * Two ways to reorder, both first-class:
 *
 *  - DRAG, via @dnd-kit/core. The repo only has `@dnd-kit/core` and
 *    `@dnd-kit/utilities` installed, not `/sortable`, so this follows the same
 *    draggable+droppable pattern WealthPage uses rather than adding a
 *    dependency (which would also land in the production audit).
 *  - MOVE UP / MOVE DOWN buttons. Drag-only reordering is unusable with a
 *    keyboard and hostile to screen readers, so the buttons are not a fallback
 *    — they are the accessible path, and they are what makes this list
 *    operable on a phone inside a scrolling page too.
 *
 * The order is persisted as the full id array, so the stored positions always
 * match what the user sees. The list is reordered locally first and reverted if
 * the request fails: a drag that visually snaps back after a round trip feels
 * broken, but silently keeping an order the server rejected would be worse.
 */
export function EnvelopeList({
  envelopes,
  canWrite,
  onChanged,
  children,
}: {
  envelopes: BudgetEnvelopeView[]
  canWrite: boolean
  onChanged: () => void
  /** Renders one envelope; the list owns only ordering. */
  children: (env: BudgetEnvelopeView, handle: HandleProps | null) => React.ReactNode
}) {
  const { t } = useTranslation()
  const { getToken } = useAuth()
  const [order, setOrder] = useState<BudgetEnvelopeView[]>(envelopes)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // Keep in step with the server, except while a save is in flight — otherwise
  // a refresh mid-request would flicker the row back to its old position.
  useEffect(() => {
    if (!saving) setOrder(envelopes)
  }, [envelopes, saving])

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // A distance constraint (not a delay) so a plain tap still opens the
    // envelope instead of being swallowed by a long-press.
    useSensor(TouchSensor, { activationConstraint: { distance: 8 } }),
  )

  // Only a multi-envelope list is worth reordering.
  const reorderable = canWrite && order.length > 1

  const persist = async (next: BudgetEnvelopeView[], previous: BudgetEnvelopeView[]) => {
    setOrder(next)
    setSaving(true)
    try {
      const token = await getToken()
      if (!token) return
      await apiPost("/api/budgets/v2/envelopes/reorder", token, { ids: next.map((e) => e.id) }, ["/api/budgets"])
      onChanged()
    } catch (err) {
      setOrder(previous) // the server refused; show the truth
      toast.error(err instanceof Error ? err.message : t("budgetV2.reorderFailed"))
    } finally {
      setSaving(false)
    }
  }

  const move = (id: string, delta: number) => {
    const from = order.findIndex((e) => e.id === id)
    const to = from + delta
    if (from < 0 || to < 0 || to >= order.length) return
    const next = order.slice()
    const [row] = next.splice(from, 1)
    next.splice(to, 0, row)
    void persist(next, order)
  }

  const onDragStart = (e: DragStartEvent) => setDraggingId(String(e.active.id))
  const onDragEnd = (e: DragEndEvent) => {
    setDraggingId(null)
    const activeId = String(e.active.id)
    const overId = e.over ? String(e.over.id) : null
    if (!overId || overId === activeId) return
    const from = order.findIndex((x) => x.id === activeId)
    const to = order.findIndex((x) => x.id === overId)
    if (from < 0 || to < 0) return
    const next = order.slice()
    const [row] = next.splice(from, 1)
    next.splice(to, 0, row)
    void persist(next, order)
  }

  if (!reorderable) {
    return <ul className="mt-3 space-y-2 border-t pt-3">{order.map((e) => children(e, null))}</ul>
  }

  const dragged = order.find((e) => e.id === draggingId)

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDraggingId(null)}
    >
      <ul className="mt-3 space-y-2 border-t pt-3">
        {order.map((env, index) => (
          <DraggableRow key={env.id} id={env.id} dragging={draggingId === env.id}>
            {(handle) => (
              <div className="flex items-stretch gap-1">
                <div className="min-w-0 flex-1">{children(env, handle)}</div>
                {/* The accessible path. Labelled per row so a screen reader
                    announces WHICH envelope is being moved. */}
                {/* Stacked, so the PAIR is a 36x36 control block. Each half is
                    18px tall — the smallest sensible split of a 36px target —
                    and both are full width, which is what makes them hittable
                    with a thumb. */}
                <div className="flex w-9 shrink-0 flex-col justify-center">
                  <button
                    type="button"
                    disabled={index === 0 || saving}
                    onClick={() => move(env.id, -1)}
                    aria-label={t("budgetV2.moveUp", { name: env.name })}
                    className="pressable flex h-[18px] w-9 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:text-foreground disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ChevronUp className="size-3.5" aria-hidden />
                  </button>
                  <button
                    type="button"
                    disabled={index === order.length - 1 || saving}
                    onClick={() => move(env.id, 1)}
                    aria-label={t("budgetV2.moveDown", { name: env.name })}
                    className="pressable flex h-[18px] w-9 items-center justify-center rounded text-muted-foreground/60 transition-colors hover:text-foreground disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ChevronDown className="size-3.5" aria-hidden />
                  </button>
                </div>
              </div>
            )}
          </DraggableRow>
        ))}
      </ul>

      <DragOverlay dropAnimation={null}>
        {dragged ? (
          <div className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 opacity-95 shadow-xl ring-2 ring-primary">
            <GripVertical className="size-3.5 text-muted-foreground" aria-hidden />
            <span className="truncate text-xs font-medium">{dragged.name}</span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}

export type HandleProps = {
  ref: (el: HTMLElement | null) => void
  listeners: ReturnType<typeof useDraggable>["listeners"]
  attributes: ReturnType<typeof useDraggable>["attributes"]
}

/** One row that is both a drag source and a drop target. */
function DraggableRow({
  id,
  dragging,
  children,
}: {
  id: string
  dragging: boolean
  children: (handle: HandleProps) => React.ReactNode
}) {
  const drag = useDraggable({ id })
  const drop = useDroppable({ id })

  const handle: HandleProps = {
    ref: drag.setActivatorNodeRef,
    listeners: drag.listeners,
    attributes: drag.attributes,
  }

  return (
    <li
      ref={(el) => {
        drag.setNodeRef(el)
        drop.setNodeRef(el)
      }}
      // Only opacity and a ring change, so reordering never shifts the layout
      // of the rows around it mid-drag.
      className={`rounded-lg transition-[opacity,box-shadow] duration-150 ${dragging ? "opacity-40" : ""} ${
        drop.isOver && !dragging ? "ring-2 ring-primary/40" : ""
      }`}
    >
      {children(handle)}
    </li>
  )
}
