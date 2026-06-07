import { toast } from "sonner"

/**
 * The "instant save" illusion with safe rollback. Apply the change to local state
 * immediately (so the UI updates with no spinner), fire the server mutation, and
 * if it fails, roll the local state back and show an error toast.
 *
 *   await runOptimistic({
 *     apply: () => setItems((xs) => [optimistic, ...xs]),
 *     rollback: () => setItems((xs) => xs.filter((x) => x.id !== optimistic.id)),
 *     mutate: () => apiPost("/api/clients", token, body, ["/api/clients"]),
 *     errorMessage: t("failedToCreate"),
 *   })
 *
 * Returns the mutation result on success, or `undefined` on failure (already
 * rolled back + toasted). Use `onError` to additionally restore UI affordances
 * (e.g. reopen the modal so the user can retry without retyping).
 */
export async function runOptimistic<T>(opts: {
  apply: () => void
  rollback: () => void
  mutate: () => Promise<T>
  errorMessage: string
  onSuccess?: (result: T) => void
  onError?: (error: unknown) => void
}): Promise<T | undefined> {
  opts.apply()
  try {
    const result = await opts.mutate()
    opts.onSuccess?.(result)
    return result
  } catch (error) {
    opts.rollback()
    toast.error(opts.errorMessage)
    opts.onError?.(error)
    return undefined
  }
}
