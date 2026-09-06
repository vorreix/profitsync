import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useAuth } from "@clerk/clerk-react"
import { toast } from "sonner"
import { DndContext, MouseSensor, TouchSensor, useDraggable, useSensor, useSensors, type DragEndEvent, type DragMoveEvent, type DragStartEvent } from "@dnd-kit/core"
import { GripVertical, Plus, RefreshCw } from "lucide-react"
import { apiGet, apiPost } from "@/lib/api"
import type { Card, CardSummary, WealthAccount } from "@/lib/types"
import { useCards, usableCards } from "@/lib/use-cards"
import { Button } from "@/components/ui/button"
import { CardStack } from "@/components/cards/CardStack"
import { AddCardWizard } from "@/components/cards/AddCardWizard"
import { CardTile, CardsGridSkeleton, type CardDropTarget } from "@/components/cards/CardTile"
import { accountFromCard } from "@/components/cards/types"
import { cardDropAction, moveBefore } from "@/components/cards/card-drag"
import { CardsSummaryStrip } from "@/components/cards/CardsSummaryStrip"
import { ClosedCardsSection } from "@/components/cards/ClosedCardsSection"
import { PayCardSheet } from "@/components/wealth/PayCardSheet"
import { TransferWizard } from "@/components/wealth/TransferWizard"

// How many credit summaries load at once (each is a ledger walk server-side).
const SUMMARY_CONCURRENCY = 3

/**
 * How much of a tile's leading/trailing edge means REORDER rather than "do
 * something with this card". A share of the tile like the Banks grid uses would
 * be ~130px on a one-column phone, so it is capped: the middle of a tile must
 * stay comfortably bigger than a thumb.
 */
const edgeBand = (size: number) => Math.min(size * 0.3, 88)

type WizardState = { open: boolean; mode: "create" | "edit"; card?: Card }

/** Live drop state, mirrored in a ref because onDragEnd's closure is stale. */
type Drop = { id: string; target: CardDropTarget }

function sameDrop(a: Drop | null, b: Drop | null): boolean {
  if (a === b) return true
  if (!a || !b || a.id !== b.id) return false
  const x = a.target
  const y = b.target
  if (!x || !y || x.kind !== y.kind) return false
  return x.kind === "reorder" && y.kind === "reorder" ? x.edge === y.edge && x.axis === y.axis : true
}

/** Absolute pointer coords from the gesture's initiating event (mouse or touch). */
function pointerFromActivator(ev: Event | null): { x: number; y: number } {
  if (ev && "touches" in ev) {
    const te = ev as TouchEvent
    const t = te.touches[0] ?? te.changedTouches[0]
    if (t) return { x: t.clientX, y: t.clientY }
  }
  const me = ev as MouseEvent | null
  return { x: me?.clientX ?? 0, y: me?.clientY ?? 0 }
}

/**
 * Wraps a tile as a drag source. The drag activates only from the grip, so the
 * tile's stretched Link, its kebab and its Pay button all keep working — and
 * the grip's `touch-action: none` lets the drag start on a phone instead of the
 * browser claiming the gesture for scrolling.
 *
 * `data-card-drag` (not `data-card-tile`) is what the grid measures: the tile
 * attribute is also stamped on closed rows and on the bank overlay, so a
 * document-wide query would make a collapsed row a drop target.
 */
function DraggableTile({ id, children }: { id: string; children: (handle: { ref: (el: HTMLElement | null) => void; listeners?: Record<string, unknown>; attributes?: Record<string, unknown> }) => React.ReactNode }) {
  const drag = useDraggable({ id })
  return (
    <div ref={drag.setNodeRef} data-card-drag={id}>
      {children({ ref: drag.setActivatorNodeRef, listeners: drag.listeners as Record<string, unknown>, attributes: drag.attributes as unknown as Record<string, unknown> })}
    </div>
  )
}

/**
 * The Cards tab of /wealth: summary strip, the grid of card visuals, closed
 * cards under a disclosure, and the add/edit wizard. Cards come from
 * useCards() (30 s cache, refreshed on every wealth mutation); the credit
 * summaries — needed only for "due Sep 15" and "Next payment due" — load in
 * the background with bounded concurrency, so the grid never waits for them.
 */
export function CardsTab({
  currency,
  balancesVisible,
  canWrite,
  canDelete,
}: {
  currency: string
  balancesVisible: boolean
  canWrite: boolean
  canDelete: boolean
}) {
  const { t } = useTranslation("wealth")
  const { getToken } = useAuth()
  const { cards, loading, error, refresh } = useCards({ includeClosed: true })
  const [summaries, setSummaries] = useState<Record<string, CardSummary | null>>({})
  const [summariesLoading, setSummariesLoading] = useState(false)
  const [wizard, setWizard] = useState<WizardState>({ open: false, mode: "create" })
  // Opened by the tile's Pay button or by dropping one card onto a credit card.
  // WHICH card and WHETHER it is open are separate on purpose: a dialog that
  // mounts already-open pushes its back-close history entry inside React's
  // development double-invoke, and the resulting stray popstate slams it shut
  // (see src/hooks/use-back-close.ts). Mounting closed and opening in an effect
  // gives the entry a single, clean push.
  const [pay, setPay] = useState<{ card: Card; fromId?: string; fromCardId?: string } | null>(null)
  const [payOpen, setPayOpen] = useState(false)
  const [transfer, setTransfer] = useState<{ fromId: string; fromCardId: string; toId: string } | null>(null)
  const [transferOpen, setTransferOpen] = useState(false)
  // PayCardSheet and TransferWizard both need the money accounts, which this tab
  // otherwise never uses — fetched on first need, and cached by apiGet.
  const [accounts, setAccounts] = useState<WealthAccount[]>([])

  // The user's drag order, as IDS only: a card with no history is HARD-deleted
  // rather than closed, so storing rows would leave ghosts. Re-derived against
  // the live list every render, with anything new falling to the tail. Kept for
  // the session, so a refetch that started before the reorder POST still paints
  // in the order the user just chose.
  const [orderIds, setOrderIds] = useState<string[] | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [drop, setDrop] = useState<Drop | null>(null)
  const dropRef = useRef<Drop | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const rectsRef = useRef<{ id: string; rect: DOMRect }[]>([])
  const pointerStartRef = useRef({ x: 0, y: 0 })
  const singleColRef = useRef(false)
  const frozenRef = useRef<Card[] | null>(null)

  const closed = useMemo(() => cards.filter((c) => c.status === "closed"), [cards])
  const ordered = useMemo(() => {
    const list = cards.filter((c) => c.status !== "closed")
    if (!orderIds) return list
    const byId = new Map(list.map((c) => [c.id, c]))
    const seen = new Set(orderIds)
    return [...orderIds.map((id) => byId.get(id)).filter((c): c is Card => !!c), ...list.filter((c) => !seen.has(c.id))]
  }, [cards, orderIds])
  // The rendered list is frozen for the length of a drag: the rects are measured
  // once at drag start, and a card arriving or leaving mid-gesture would move
  // tiles out from under a snapshot the drop still resolves against.
  const open = draggingId && frozenRef.current ? frozenRef.current : ordered

  // Re-fetch a credit card's summary whenever its balance or autopay changes
  // (a payment recorded elsewhere must move "due" here too).
  // SORTED: the key must describe the SET of credit cards, not their order, or
  // a drag-to-reorder would cancel the in-flight batch and re-run every
  // server-side ledger walk for no data change.
  const summaryKey = open
    .filter((c) => c.kind === "credit")
    .map((c) => `${c.id}:${c.account_current_balance}:${c.autopay ? 1 : 0}:${c.funding_account_id ?? ""}`)
    .sort()
    .join("|")

  useEffect(() => {
    if (!summaryKey) { setSummaries({}); setSummariesLoading(false); return }
    const ids = summaryKey.split("|").map((k) => k.split(":")[0])
    let cancelled = false
    ;(async () => {
      const token = await getToken()
      if (!token || cancelled) return
      setSummariesLoading(true)
      const next: Record<string, CardSummary | null> = {}
      for (let i = 0; i < ids.length; i += SUMMARY_CONCURRENCY) {
        const chunk = ids.slice(i, i + SUMMARY_CONCURRENCY)
        const rows = await Promise.all(chunk.map((id) => apiGet<CardSummary>(`/api/cards/${id}/summary`, token).catch(() => null)))
        chunk.forEach((id, j) => { next[id] = rows[j] })
        if (cancelled) { setSummariesLoading(false); return }
        setSummaries((prev) => ({ ...prev, ...next }))
      }
      setSummariesLoading(false)
    })()
    return () => { cancelled = true }
  }, [summaryKey, getToken])

  // ── Drag: reorder, or act on the tile you drop onto ───────────────────────
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { distance: 6 } }),
  )
  const byId = useMemo(() => new Map(open.map((c) => [c.id, c])), [open])
  const usable = useMemo(() => new Set(usableCards(open).map((c) => c.id)), [open])

  const setDropBoth = useCallback((next: Drop | null) => {
    if (sameDrop(dropRef.current, next)) return
    dropRef.current = next
    setDrop(next)
  }, [])

  const actionFor = useCallback(
    (from: Card, to: Card) => cardDropAction(from, to, usable),
    [usable],
  )

  function onDragStart(e: DragStartEvent) {
    const id = String(e.active.id)
    frozenRef.current = ordered
    setDraggingId(id)
    setDropBoth(null)
    pointerStartRef.current = pointerFromActivator(e.activatorEvent)
    // Scoped to the grid: [data-card-tile] is also on closed rows and on the
    // bank overlay, and a collapsed row measures 0x0 at the origin.
    const els = Array.from(gridRef.current?.querySelectorAll<HTMLElement>("[data-card-drag]") ?? [])
    rectsRef.current = els
      .map((el) => ({ id: el.dataset.cardDrag!, rect: el.getBoundingClientRect() }))
      .filter((r) => r.rect.width > 0 && r.rect.height > 0)
    singleColRef.current = new Set(rectsRef.current.map((r) => Math.round(r.rect.left))).size <= 1
  }

  function onDragMove(e: DragMoveEvent) {
    const activeId = String(e.active.id)
    const from = byId.get(activeId)
    const p = { x: pointerStartRef.current.x + e.delta.x, y: pointerStartRef.current.y + e.delta.y }
    const others = rectsRef.current.filter((c) => c.id !== activeId)
    let over = others.find((c) => p.x >= c.rect.left && p.x <= c.rect.right && p.y >= c.rect.top && p.y <= c.rect.bottom)
    if (!over) {
      let best: (typeof others)[number] | undefined
      let bestD = Infinity
      for (const c of others) {
        const dx = c.rect.left + c.rect.width / 2 - p.x
        const dy = c.rect.top + c.rect.height / 2 - p.y
        const d = dx * dx + dy * dy
        if (d < bestD) { bestD = d; best = c }
      }
      over = best
    }
    const to = over ? byId.get(over.id) : undefined
    if (!over || !to || !from) { setDropBoth(null); return }
    const axis = singleColRef.current ? "y" : "x"
    const size = axis === "y" ? over.rect.height : over.rect.width
    const offset = axis === "y" ? p.y - over.rect.top : p.x - over.rect.left
    const band = edgeBand(size)
    const action = actionFor(from, to)
    // With no legal action the whole tile is a reorder target, split at its
    // middle — never a dead zone the user can drop into and see nothing happen.
    if (!action) {
      setDropBoth({ id: over.id, target: { kind: "reorder", edge: offset < size / 2 ? "before" : "after", axis } })
      return
    }
    if (offset < band) setDropBoth({ id: over.id, target: { kind: "reorder", edge: "before", axis } })
    else if (offset > size - band) setDropBoth({ id: over.id, target: { kind: "reorder", edge: "after", axis } })
    else setDropBoth({ id: over.id, target: { kind: "action", label: action.kind === "pay" ? t("payCard") : t("transfer") } })
  }

  function endDrag() {
    setDraggingId(null)
    setDropBoth(null)
    frozenRef.current = null
  }

  function onDragEnd(e: DragEndEvent) {
    const activeId = String(e.active.id)
    const d = dropRef.current
    const list = frozenRef.current ?? ordered
    endDrag()
    if (!d?.target) return
    const from = list.find((c) => c.id === activeId)
    const to = list.find((c) => c.id === d.id)
    if (!from || !to) return

    if (d.target.kind === "action") {
      const action = actionFor(from, to)
      if (!action) return
      if (action.kind === "pay") setPay({ card: to, fromId: from.account_id, fromCardId: from.id })
      else setTransfer({ fromId: from.account_id, fromCardId: from.id, toId: to.account_id })
      return
    }
    const ids = list.map((c) => c.id)
    const fromIdx = ids.indexOf(activeId)
    const overIdx = ids.indexOf(d.id)
    if (fromIdx === -1 || overIdx === -1) return
    const next = moveBefore(ids, fromIdx, d.target.edge === "before" ? overIdx : overIdx + 1)
    if (next.join("|") !== ids.join("|")) void persistOrder(next, ids)
  }

  /** Apply the new order at once, then persist; restore it if the write fails. */
  async function persistOrder(next: string[], previous: string[]) {
    setOrderIds(next)
    try {
      const token = await getToken()
      if (!token) throw new Error("Not authenticated")
      await apiPost("/api/cards/reorder", token, { ids: next })
    } catch {
      setOrderIds(previous)
      toast.error(t("cards.reorderFailed"))
    }
  }

  useEffect(() => { if (pay) setPayOpen(true) }, [pay])
  useEffect(() => { if (transfer) setTransferOpen(true) }, [transfer])

  const needAccounts = !!pay || !!transfer
  useEffect(() => {
    if (!needAccounts || accounts.length > 0) return
    let cancelled = false
    void (async () => {
      const token = await getToken()
      if (!token || cancelled) return
      const rows = await apiGet<WealthAccount[]>("/api/wealth/accounts", token).catch(() => [] as WealthAccount[])
      if (!cancelled) setAccounts(rows)
    })()
    return () => { cancelled = true }
  }, [needAccounts, accounts.length, getToken])

  const openCreate = () => setWizard({ open: true, mode: "create" })
  const openEdit = (card: Card) => setWizard({ open: true, mode: "edit", card })
  const onChanged = () => void refresh({ silent: true })

  if (loading && cards.length === 0) {
    return (
      <div className="space-y-4">
        <div className="h-14 animate-pulse rounded-xl border bg-card sm:h-11" aria-hidden />
        <CardsGridSkeleton />
      </div>
    )
  }

  if (error && cards.length === 0) {
    return (
      <div className="rounded-2xl border py-12 text-center">
        <p className="text-sm font-medium text-muted-foreground">{t("cards.loadFailed")}</p>
        <Button variant="outline" className="mt-3" onClick={() => void refresh()}>
          <RefreshCw className="size-4" /> {t("cards.retry")}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      {cards.length === 0 ? (
        // Deliberately not a full-height hero: on a phone this is the whole
        // screen, so the illustration shrinks and the copy carries it.
        <div className="rounded-2xl border bg-card px-4 py-7 text-center sm:py-12">
          <div className="mx-auto w-40 max-w-full sm:w-56">
            <CardStack />
          </div>
          <h2 className="mt-4 text-base font-semibold sm:mt-6 sm:text-lg">{t("cards.emptyTitle")}</h2>
          <div className="mx-auto mt-1.5 max-w-md space-y-1 text-[13px] text-muted-foreground sm:text-sm">
            <p>{t("cards.emptyDebit")}</p>
            <p>{t("cards.emptyCredit")}</p>
          </div>
          {canWrite && (
            <Button className="pressable mt-4 min-h-11 sm:mt-5 sm:min-h-9" onClick={openCreate}>
              <Plus className="size-4" /> {t("cards.addCard")}
            </Button>
          )}
        </div>
      ) : (
        <>
          <CardsSummaryStrip
            cards={open}
            summaries={summaries}
            summariesLoading={summariesLoading}
            currency={currency}
            balancesVisible={balancesVisible}
            canWrite={canWrite}
            onAddCard={openCreate}
          />

          {open.length > 0 && (
            // Two columns at most, roomy gaps — three-across felt cluttered and
            // a wide tile lays itself out side-by-side (see CardTile).
            <DndContext sensors={sensors} onDragStart={onDragStart} onDragMove={onDragMove} onDragEnd={onDragEnd} onDragCancel={endDrag}>
              <div ref={gridRef} className="grid grid-cols-1 gap-4 sm:gap-5 md:grid-cols-2">
                {open.map((card) => {
                  const tile = (handle?: Parameters<Parameters<typeof DraggableTile>[0]["children"]>[0]) => (
                    <CardTile
                      card={card}
                      summary={summaries[card.id]}
                      currency={currency}
                      balancesVisible={balancesVisible}
                      canWrite={canWrite}
                      canDelete={canDelete}
                      onEdit={() => openEdit(card)}
                      onChanged={onChanged}
                      onPay={canWrite ? () => setPay({ card }) : undefined}
                      handle={handle}
                      dragging={draggingId === card.id}
                      drop={drop?.id === card.id ? drop.target : null}
                    />
                  )
                  // A viewer gets no grip: the reorder would 403 and snap back.
                  // Below two cards there is nothing to reorder or drop onto.
                  return canWrite && open.length > 1 ? (
                    <DraggableTile key={card.id} id={card.id}>{(handle) => tile(handle)}</DraggableTile>
                  ) : (
                    <div key={card.id}>{tile()}</div>
                  )
                })}
              </div>
            </DndContext>
          )}

          {canWrite && open.length > 1 && (
            <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
              <GripVertical className="size-3 shrink-0" aria-hidden /> {t("cards.dragHint")}
            </p>
          )}

          <ClosedCardsSection cards={closed} currency={currency} canWrite={canWrite} canDelete={canDelete} onEdit={openEdit} onChanged={onChanged} />
        </>
      )}

      {pay && (
        <PayCardSheet
          open={payOpen}
          onOpenChange={setPayOpen}
          card={accounts.find((a) => a.id === pay.card.account_id) ?? accountFromCard(pay.card)}
          // The card summary carries everything but the account row itself,
          // which the sheet is given separately.
          summary={
            summaries[pay.card.id]?.credit
              ? { ...summaries[pay.card.id]!.credit!, account: accounts.find((a) => a.id === pay.card.account_id) ?? accountFromCard(pay.card) }
              : null
          }
          accounts={accounts}
          currency={currency}
          balancesVisible={balancesVisible}
          // Until this card's summary lands, what the card ROW says it owes —
          // so the sheet can never read "nothing to pay" on a tile showing debt.
          fallbackDebt={Math.max(0, -Number(pay.card.account_current_balance ?? 0))}
          initialFromId={pay.fromId}
          initialFromCardId={pay.fromCardId}
          onDone={() => { setPayOpen(false); void refresh({ silent: true }) }}
        />
      )}

      {transfer && (
        <TransferWizard
          open={transferOpen}
          onOpenChange={setTransferOpen}
          accounts={accounts}
          initialFromId={transfer.fromId}
          initialFromCardId={transfer.fromCardId}
          initialToId={transfer.toId}
          currency={currency}
          onDone={() => { setTransferOpen(false); void refresh({ silent: true }) }}
        />
      )}

      <AddCardWizard
        open={wizard.open}
        onOpenChange={(o) => setWizard((w) => ({ ...w, open: o }))}
        mode={wizard.mode}
        card={wizard.card}
        onSaved={() => void refresh({ silent: true })}
      />
    </div>
  )
}
