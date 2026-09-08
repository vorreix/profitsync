import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { useTranslation } from "react-i18next"
import { ArrowLeftRight, ChevronLeft, ChevronRight, ExternalLink, GripHorizontal, Wallet } from "lucide-react"
import { cardDisplayName, maskedTail } from "@/lib/cards"
import { creditUsage } from "@/lib/credit-card"
import { haptic } from "@/lib/native-shell"
import type { Card } from "@/lib/types"
import { formatMoney } from "@/lib/wealth"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer"
import { CardVisual } from "@/components/cards/CardVisual"
import { visualPropsFromCard } from "@/components/cards/types"
import { FAN, displayIndexWhileHeld, dragOffset, fanPose, moveIntent, pxPerStep, reorderIds, reorderTarget, snapOffset } from "@/components/cards/card-fan"

/** Width of the card in hand, px. Neighbours scale down from this. */
const CARD_W = 188
/** How far a held card lifts, px. */
const LIFT = 14

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)"

type Gesture =
  | { mode: "idle" }
  | { mode: "swipe"; startX: number; startOffset: number }
  | { mode: "hold"; startX: number; from: number; target: number; dx: number }

/**
 * The mobile card fan: every open card in one hand, pivoting from a point
 * below the screen. Swipe to rotate, the centre card is the one in hand. Hold
 * it to pick it up and drag along the fan to reorder — the others slide over to
 * make room, and the order is saved on release. Paying it or moving money from
 * it are one-tap actions under the fan, on purpose: a money movement must never
 * be something a wobble of the thumb can do.
 *
 * Everything that moves is transform/opacity, so the fan stays on the
 * compositor. Under prefers-reduced-motion the fan still works, it just snaps.
 */
export function CardFanSheet({
  open,
  onOpenChange,
  cards,
  currency,
  balancesVisible,
  canWrite,
  onOpenCard,
  onPay,
  onMove,
  onReorder,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Open cards, in the user's order. */
  cards: Card[]
  currency: string
  balancesVisible: boolean
  canWrite: boolean
  onOpenCard: (card: Card) => void
  onPay: (card: Card) => void
  onMove: (card: Card) => void
  /** Persist a new order (ids). Only called when the order actually changed. */
  onReorder: (ids: string[]) => void
}) {
  const { t } = useTranslation("wealth")
  const money = (n: number) => formatMoney(n, currency, balancesVisible)

  // NO local copy of the order. The parent owns it: a reorder is reported on
  // release, the parent applies it at once and hands it straight back down, and
  // if the write fails the parent rolls back and the fan follows. A mirror here
  // would keep the failed order for the rest of the session while the grid
  // behind it showed the real one. While a card is HELD the others are only
  // renumbered for painting (displayIndexWhileHeld) — the array never moves.
  const deck = cards
  const count = deck.length

  const [offset, setOffset] = useState(0)
  const [gesture, setGesture] = useState<Gesture>({ mode: "idle" })
  const gestureRef = useRef<Gesture>({ mode: "idle" })
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pointerStart = useRef({ x: 0, y: 0 })
  // The pointer currently pressed on the stage. Without this a bare hover — or
  // any move that arrives before a press — is measured from {0,0}, reads as a
  // huge vertical drag, and locks the fan out of every later swipe.
  const activePointer = useRef<number | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const reduced = useReducedMotion()

  const selected = snapOffset(offset, count)
  const inHand = deck[selected]
  const setGestureBoth = (g: Gesture) => { gestureRef.current = g; setGesture(g) }

  // Reset to the first card each time the sheet opens.
  useEffect(() => { if (open) { setOffset(0); setGestureBoth({ mode: "idle" }) } }, [open])
  useEffect(() => () => { if (holdTimer.current) clearTimeout(holdTimer.current) }, [])
  // Every card closed or deleted while the sheet was open: there is nothing to
  // hold, so close rather than leave an empty stage behind a title.
  useEffect(() => { if (open && count === 0) onOpenChange(false) }, [open, count, onOpenChange])

  const px = pxPerStep()


  function clearHold() {
    if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null }
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0 && e.pointerType === "mouse") return
    // One pointer at a time. A second finger landing mid-swipe would otherwise
    // reset the origin and make the fan jump under the first one.
    if (activePointer.current !== null) return
    activePointer.current = e.pointerId
    pointerStart.current = { x: e.clientX, y: e.clientY }
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch { /* not capturable */ }
    clearHold()
    if (canWrite && count > 1) {
      // Only the card in hand can be picked up: holding a neighbour would be
      // ambiguous with rotating to it, so a hold there just selects it.
      holdTimer.current = setTimeout(() => {
        const hit = hitIndex(e.target as HTMLElement)
        if (hit === null) return
        if (hit !== selected) { setOffset(hit); return }
        void haptic("medium")
        setGestureBoth({ mode: "hold", startX: pointerStart.current.x, from: selected, target: selected, dx: 0 })
      }, FAN.holdMs)
    }
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (activePointer.current !== e.pointerId) return
    const g = gestureRef.current
    const dx = e.clientX - pointerStart.current.x
    const dy = e.clientY - pointerStart.current.y
    if (g.mode === "idle") {
      const intent = moveIntent(dx, dy)
      if (intent === "none") return
      clearHold()
      if (intent === "vertical") {
        // The fan owns its surface (data-vaul-no-drag below), so a vertical
        // move here does nothing rather than half-rotating the fan on the way
        // to a dismissal. The drawer is still dismissed from its handle or by
        // tapping the overlay — this only stops a wobble while browsing cards.
        //
        // This pointer is retired here, and the gesture goes straight back to
        // idle. Parking it in a "vertical" state was a state we could never
        // leave: releasing capture means the matching pointerup lands
        // elsewhere, so nothing was left to reset it and the fan stopped
        // responding to every later touch. Idle + no active pointer is inert
        // on its own — the guard above drops this pointer's remaining moves.
        try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId) } catch { /* already released */ }
        activePointer.current = null
        setGestureBoth({ mode: "idle" })
        return
      }
      setGestureBoth({ mode: "swipe", startX: pointerStart.current.x, startOffset: offset })
      return
    }
    if (g.mode === "swipe") {
      e.preventDefault()
      setOffset(dragOffset(g.startOffset, dx, count, px))
      return
    }
    if (g.mode === "hold") {
      e.preventDefault()
      const target = reorderTarget(g.from, dx, count, px)
      if (target !== g.target) void haptic("selection")
      setGestureBoth({ ...g, target, dx })
    }
  }

  function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
    if (activePointer.current !== e.pointerId) return
    activePointer.current = null
    const g = gestureRef.current
    clearHold()
    if (g.mode === "swipe") {
      setOffset(snapOffset(offset, count))
      setGestureBoth({ mode: "idle" })
      return
    }
    if (g.mode === "hold") {
      const ids = deck.map((c) => c.id)
      const next = reorderIds(ids, g.from, g.target)
      setOffset(g.target)
      setGestureBoth({ mode: "idle" })
      if (next !== ids) { void haptic("light"); onReorder(next) }
      return
    }
    // A tap: on the card in hand it opens; on a neighbour it rotates to it.
    const hit = hitIndex(e.target as HTMLElement)
    if (hit === null) return
    if (hit === selected) onOpenCard(deck[hit])
    else setOffset(hit)
  }

  function onPointerCancel() {
    activePointer.current = null
    clearHold()
    if (gestureRef.current.mode === "swipe") setOffset(snapOffset(offset, count))
    setGestureBoth({ mode: "idle" })
  }

  const step = (delta: number) => setOffset(snapOffset(selected + delta, count))

  // Actions for the card in hand.
  const usage = inHand?.kind === "credit" ? creditUsage(inHand.account_credit_limit, inHand.account_current_balance) : null
  const canPay = !!inHand && inHand.kind === "credit" && canWrite && (usage?.debt ?? 0) > 0
  const usableSource = !!inHand && inHand.status === "active" && !inHand.account_archived_at
  // No `count > 1`: the destination is any account, not necessarily another card.
  const canMove = usableSource && canWrite

  const live = gesture.mode === "swipe" || gesture.mode === "hold"

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[92dvh]" onContextMenu={(e) => e.preventDefault()}>
        <DrawerHeader className="pb-1">
          <DrawerTitle>{t("cards.fanTitle")}</DrawerTitle>
          <DrawerDescription>{t("cards.fanHint")}</DrawerDescription>
        </DrawerHeader>

        {/* THE FAN. touch-none so the browser never claims the swipe for
            scrolling; data-vaul-no-drag so the drawer never claims it for
            drag-to-dismiss while a card is being browsed or reordered. */}
        <div
          ref={stageRef}
          data-vaul-no-drag
          role="group"
          aria-roledescription="carousel"
          aria-label={t("cards.fanTitle")}
          className="relative mx-auto h-[236px] w-full max-w-md select-none overflow-hidden touch-none [-webkit-touch-callout:none]"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
        >
          {deck.map((card, i) => {
            const held = gesture.mode === "hold" && i === gesture.from
            // While a card is held, the others make room; the held one rides the pointer.
            const displayIndex = gesture.mode === "hold" ? displayIndexWhileHeld(i, gesture.from, gesture.target) : i
            const pose = held
              ? { ...fanPose(gesture.from, gesture.from), rotate: (gesture.dx / px) * FAN.stepDeg, scale: 1.06, z: 200, opacity: 1, hidden: false }
              : fanPose(displayIndex, gesture.mode === "hold" ? gesture.from : offset)
            if (pose.hidden) return null
            const animate = !reduced && !(live && (gesture.mode === "swipe" || held))
            return (
              <div
                key={card.id}
                data-fan-index={i}
                aria-hidden={i !== selected}
                className={cn("absolute left-1/2 top-4 will-change-transform", held && "drop-shadow-2xl")}
                style={{
                  width: CARD_W,
                  marginLeft: -CARD_W / 2,
                  transformOrigin: `50% ${FAN.radius}px`,
                  transform: `translateY(${held ? -LIFT : 0}px) rotate(${pose.rotate}deg) scale(${pose.scale})`,
                  opacity: pose.opacity,
                  zIndex: pose.z,
                  transition: animate ? `transform 280ms ${EASE}, opacity 200ms ease-out` : "none",
                }}
              >
                <CardVisual {...visualPropsFromCard(card)} size="sm" still className="w-full" />
              </div>
            )
          })}
        </div>

        {/* THE CARD IN HAND — its facts, and the only places money can move. */}
        <div className="px-4 pb-4" aria-live="polite">
          {inHand && (
            <div className="rounded-xl border bg-muted/30 p-3">
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon" className="size-11 shrink-0" onClick={() => step(-1)} disabled={selected === 0} aria-label={t("cards.fanPrev")}>
                  <ChevronLeft className="size-5" aria-hidden />
                </Button>
                <div className="min-w-0 flex-1 text-center">
                  <p className="truncate text-sm font-semibold">{cardDisplayName(inHand)}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {inHand.kind === "credit" ? t("cards.kindCredit") : t("cards.kindDebit")}
                    {inHand.last4 && <> · <span dir="ltr">{maskedTail(inHand.last4)}</span></>}
                    {" · "}
                    {t("cards.fanPosition", { index: selected + 1, count })}
                  </p>
                  <p className="mt-1 text-sm tabular-nums">
                    {usage
                      ? usage.debt > 0
                        ? <span className="text-red-700 dark:text-red-400">{t("owed", { amount: money(usage.debt) })}</span>
                        : <span className="text-emerald-700 dark:text-emerald-300">{t("nothingOwed")}</span>
                      : <span>{t("cards.availableAt", { balance: money(Number(inHand.account_current_balance ?? 0)), bank: (inHand.account_nickname || inHand.account_bank_name || t("bank")).trim() })}</span>}
                  </p>
                </div>
                <Button variant="ghost" size="icon" className="size-11 shrink-0" onClick={() => step(1)} disabled={selected >= count - 1} aria-label={t("cards.fanNext")}>
                  <ChevronRight className="size-5" aria-hidden />
                </Button>
              </div>

              <div className="mt-3 grid grid-cols-3 gap-2">
                <Button variant="outline" className="pressable min-h-11" onClick={() => onOpenCard(inHand)}>
                  <ExternalLink className="size-4" aria-hidden /> {t("cards.fanOpenCard")}
                </Button>
                <Button variant="outline" className="pressable min-h-11" onClick={() => onPay(inHand)} disabled={!canPay}>
                  <Wallet className="size-4" aria-hidden /> {t("payCard")}
                </Button>
                <Button variant="outline" className="pressable min-h-11" onClick={() => onMove(inHand)} disabled={!canMove}>
                  <ArrowLeftRight className="size-4" aria-hidden /> {t("cards.moveMoney")}
                </Button>
              </div>

              {canWrite && count > 1 && (
                <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-[11px] text-muted-foreground">
                  <GripHorizontal className="size-3 shrink-0" aria-hidden /> {t("cards.fanReorderHint")}
                </p>
              )}
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}

/** The card index under a pointer target, from the card wrapper's data attribute. */
function hitIndex(target: HTMLElement | null): number | null {
  const el = target?.closest<HTMLElement>("[data-fan-index]")
  if (!el) return null
  const n = Number(el.dataset.fanIndex)
  return Number.isFinite(n) ? n : null
}

function useReducedMotion(): boolean {
  const get = useCallback(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches, [])
  const [reduced, setReduced] = useState(get)
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [])
  return reduced
}
