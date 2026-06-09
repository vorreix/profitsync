import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Close a modal on the browser/OS **Back** gesture (button or edge-swipe) WITHOUT
 * navigating away from the current page.
 *
 * Mechanism: while `open`, push **one** dummy history entry that keeps the SAME URL
 * (we spread the existing `history.state` so react-router's `{usr,key,idx}` are
 * preserved → react-router computes delta 0 on the pop and does not navigate). The
 * Back gesture pops that dummy entry — staying on the page — and our `popstate`
 * listener fires `onClose()`. On a *programmatic* close (Esc / overlay / X / Save)
 * the dummy entry is still on top, so we consume it with `history.back()` to keep
 * the stack clean. The `__modalBackClose` marker distinguishes the two close paths.
 *
 * Why push at all: without a pushed entry, Back pops the page's own entry and the
 * browser leaves the page before anything can intercept it. (This is the same trick
 * `useUrlModal` uses via `navigate()`, generalized to any modal and without a URL
 * param.)
 *
 * `onClose` is read through a ref so the effect depends only on `[open]` — it won't
 * re-push a new entry on every render.
 */
export function useBackClose(open: boolean, onClose: () => void): void {
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open || typeof window === "undefined") return

    // Push a dummy entry (same URL) so Back has something to pop instead of leaving.
    // Spread the current state to preserve react-router's bookkeeping (idx/key/usr).
    window.history.pushState({ ...window.history.state, __modalBackClose: true }, "")

    const onPop = () => onCloseRef.current()
    window.addEventListener("popstate", onPop)

    return () => {
      window.removeEventListener("popstate", onPop)
      // Closed programmatically (not via Back): our dummy entry is still on top, so
      // pop it. After a real Back press the browser already popped it, so the marker
      // is gone and we skip — preventing a double pop.
      if (typeof window !== "undefined" && (window.history.state as { __modalBackClose?: boolean } | null)?.__modalBackClose) {
        window.history.back()
      }
    }
  }, [open])
}

/**
 * Neutralize the CURRENT modal's pushed back-entry so closing it will NOT fire a
 * `history.back()` (and therefore no stray `popstate`). Call this right before
 * chaining straight from one plain-state modal into another (e.g. an overview's
 * "Edit" button that closes the overview and opens an edit dialog in the same tick):
 * without it, the first modal's cleanup pops history, and that pop is caught by the
 * second modal's freshly-mounted `useBackClose` listener — slamming it shut. We only
 * strip our own `__modalBackClose` marker, preserving react-router's `{usr,key,idx}`
 * bookkeeping; the (now markerless) dummy entry is a harmless same-URL no-op.
 *
 * This is the plain-modal analogue of `useUrlModal.close({ replace: true })`.
 */
export function dropModalBackEntry(): void {
  if (typeof window === "undefined") return
  const st = window.history.state as ({ __modalBackClose?: boolean } & Record<string, unknown>) | null
  if (st?.__modalBackClose) {
    const next = { ...st }
    delete next.__modalBackClose
    window.history.replaceState(next, "")
  }
}

/**
 * Make a modal's open state effectively **controlled** (works whether the caller
 * passes `open`/`onOpenChange` or uses it uncontrolled via a Trigger) and wire in
 * {@link useBackClose}. Returns the `{ open, onOpenChange }` to spread onto the
 * underlying Radix/vaul Root. Pass `disableBackClose` for modals that already drive
 * their own history (e.g. `useUrlModal`-backed `?view=` modals) to avoid a second
 * entry.
 */
export function useModalBackClose(opts: {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  disableBackClose?: boolean
}): { open: boolean; onOpenChange: (open: boolean) => void } {
  const { open, defaultOpen, onOpenChange, disableBackClose } = opts
  const [internalOpen, setInternalOpen] = useState(defaultOpen ?? false)
  const isControlled = open !== undefined
  const actualOpen = isControlled ? open : internalOpen

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!isControlled) setInternalOpen(next)
      onOpenChange?.(next)
    },
    [isControlled, onOpenChange],
  )

  useBackClose(!disableBackClose && actualOpen, () => handleOpenChange(false))

  return { open: actualOpen, onOpenChange: handleOpenChange }
}
