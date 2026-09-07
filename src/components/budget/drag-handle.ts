/** What a drag grip needs; supplied by the list's DnD context, null when not reordering. */
export type HandleProps = {
  ref: (el: HTMLElement | null) => void
  listeners?: Record<string, unknown>
  attributes?: Record<string, unknown>
}

/** dnd-kit's own attribute/listener bags, widened so they can be spread onto a button. */
export const asHandle = (h: {
  ref: (el: HTMLElement | null) => void
  listeners?: unknown
  attributes?: unknown
}): HandleProps => ({
  ref: h.ref,
  listeners: (h.listeners ?? {}) as Record<string, unknown>,
  attributes: (h.attributes ?? {}) as Record<string, unknown>,
})

