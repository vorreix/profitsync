// Tiny external store connecting the service-worker update lifecycle
// (register-sw.ts, which owns the virtual:pwa-register import) to the
// <UpdatePrompt /> banner. Deliberately DOM/PWA-import-free so components and
// tests can use it without pulling in service-worker registration.

export interface UpdatePromptState {
  updateAvailable: boolean
  updating: boolean
}

let state: UpdatePromptState = { updateAvailable: false, updating: false }
let applyFn: (() => void) | null = null
const listeners = new Set<() => void>()

function setState(next: UpdatePromptState): void {
  state = next
  listeners.forEach((listener) => listener())
}

/** A new version is waiting; `apply` activates it (and reloads). Re-offering
 *  (e.g. another deploy while a dismissed prompt is pending) re-shows the banner.
 *  While an accepted update is in flight, new offers are IGNORED: re-enabling the
 *  button would let a second SKIP_WAITING race the first activation, and the
 *  imminent reload (controllerchange, or the 10s fail-safe in register-sw.ts)
 *  re-evaluates the registration anyway — a newer waiting worker simply prompts
 *  again after boot. */
export function offerUpdate(apply: () => void): void {
  if (state.updating) return
  applyFn = apply
  setState({ updateAvailable: true, updating: false })
}

/** User accepted: flip to the in-progress state and activate the new worker. */
export function acceptUpdate(): void {
  if (!applyFn || state.updating) return
  setState({ ...state, updating: true })
  applyFn()
}

/** User chose "Later": hide until the next offerUpdate call. */
export function dismissUpdate(): void {
  if (state.updating) return
  if (state.updateAvailable) setState({ updateAvailable: false, updating: false })
}

export function subscribeUpdatePrompt(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getUpdatePromptState(): UpdatePromptState {
  return state
}

/** Test-only: the store is intentionally one-way once `updating` (a reload always
 *  follows in the app), so tests need an explicit way back to the initial state. */
export function resetUpdatePromptStoreForTests(): void {
  applyFn = null
  setState({ updateAvailable: false, updating: false })
}
