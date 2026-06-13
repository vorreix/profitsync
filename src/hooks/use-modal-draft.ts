import { useEffect, useRef } from "react"

/**
 * Draft-keeper for modals whose component stays MOUNTED between opens (every
 * Dialog/Drawer in this app): decides whether the open-path should re-seed the
 * form or keep what the user already typed.
 *
 * Policy (qa5): a dismissal — outside-click, Esc, or the Back gesture — keeps
 * the draft, so accidentally closing a half-filled form loses nothing. An
 * explicit **Cancel** or a **successful save** clears it, so the next open
 * starts fresh (sticky defaults + today's date).
 *
 * Usage:
 *   const dirty = form.description !== "" || ...        // "worth keeping?"
 *   const draft = useModalDraft({ open, dirty, contextKey: editTarget?.id ?? "create" })
 *   // open path / open-effect:
 *   if (draft.shouldSeed()) setForm(freshDefaults())
 *   // Save success + explicit Cancel:
 *   draft.clearDraft()
 *
 * `contextKey` scopes the draft to what the modal is editing — reopening the
 * SAME entity restores the draft; opening a different one re-seeds. The keeper
 * holds a single slot: opening under a new key drops the previous draft.
 * A pristine dismissal (dirty=false) also re-seeds next open, which keeps date
 * defaults fresh across days.
 *
 * Both `dirty` and `contextKey` are sampled from the **last render where the
 * modal was open** — many modals derive these from the same prop that toggles
 * `open` (e.g. `entity`/`editTarget` going null on close), which would otherwise
 * collapse them to defaults exactly when the close-effect reads them.
 */
export function useModalDraft({
  open,
  dirty,
  contextKey = "",
}: {
  open: boolean
  dirty: boolean
  contextKey?: string
}) {
  const hasDraft = useRef(false)
  const draftKey = useRef("")
  const cleared = useRef(false)
  const wasOpen = useRef(false)
  // The dirty flag + key as they were while the modal was OPEN. Captured during
  // render (not in the effect) so a close that also resets the source prop can't
  // erase them before we record the draft.
  const openDirty = useRef(dirty)
  const openKey = useRef(contextKey)
  if (open) {
    openDirty.current = dirty
    openKey.current = contextKey
  }

  useEffect(() => {
    if (wasOpen.current && !open) {
      // Closing: keep the draft only when it has content and the close wasn't
      // an explicit Cancel / successful save (those call clearDraft first).
      hasDraft.current = !cleared.current && openDirty.current
      draftKey.current = openKey.current
      cleared.current = false
    }
    wasOpen.current = open
  }, [open])

  const shouldSeed = (key?: string) => !(hasDraft.current && draftKey.current === (key ?? openKey.current))
  const clearDraft = () => {
    cleared.current = true
    hasDraft.current = false
  }
  return { shouldSeed, clearDraft }
}
