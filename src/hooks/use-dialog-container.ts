import { useCallback, useState } from "react"

/**
 * When a Popover/Combobox lives inside a (modal) Dialog, Radix's
 * `react-remove-scroll` isolates wheel/touch scrolling to the dialog's subtree
 * — so a popover portalled to <body> (outside that subtree) can't be scrolled
 * with the wheel/touch even though it overflows. The fix is to portal the
 * popover INTO the dialog content (its `position: fixed` wrapper means it's not
 * clipped by the dialog's `overflow-hidden`).
 *
 * Returns a callback ref to attach to the trigger and the nearest dialog content
 * element (or null when not inside a dialog → popover portals to <body> as usual).
 */
export function useDialogContainer() {
  const [container, setContainer] = useState<HTMLElement | null>(null)
  const triggerRef = useCallback((node: HTMLElement | null) => {
    setContainer((node?.closest('[data-slot="dialog-content"]') as HTMLElement | null) ?? null)
  }, [])
  return { triggerRef, container }
}
