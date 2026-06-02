import { useCallback, useMemo, useState } from "react"

/**
 * Selection state for list pages that support multi-select + bulk delete.
 * `selectionMode` gates the UI: on desktop it turns on when the user ticks a
 * checkbox; on mobile it's triggered by a long-press. While active, tapping a
 * row toggles its selection instead of its normal action.
 */
export function useMultiSelect() {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selectionMode, setSelectionMode] = useState(false)

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const isSelected = useCallback((id: string) => selected.has(id), [selected])

  const selectAll = useCallback((ids: string[]) => {
    setSelected(new Set(ids))
  }, [])

  const clear = useCallback(() => setSelected(new Set()), [])

  const enterSelection = useCallback((id?: string) => {
    setSelectionMode(true)
    if (id) setSelected((prev) => new Set(prev).add(id))
  }, [])

  const exitSelection = useCallback(() => {
    setSelectionMode(false)
    setSelected(new Set())
  }, [])

  return useMemo(
    () => ({
      selected,
      selectedIds: [...selected],
      count: selected.size,
      selectionMode,
      isSelected,
      toggle,
      selectAll,
      clear,
      enterSelection,
      exitSelection,
      setSelectionMode,
    }),
    [selected, selectionMode, isSelected, toggle, selectAll, clear, enterSelection, exitSelection],
  )
}

export type MultiSelect = ReturnType<typeof useMultiSelect>
