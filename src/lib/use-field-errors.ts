import { useCallback, useState } from "react"
import type { ZodType } from "zod"

/**
 * Lightweight field-error tracking for the app's existing *controlled* forms,
 * without a full react-hook-form rewrite. Validate the current form state against
 * a zod schema on submit; the returned `errors` map (field path → message) drives
 * `aria-invalid` on inputs (which already carry `aria-invalid:border-destructive`
 * styling) so invalid/empty required fields turn red. Clear a field's error as the
 * user edits it.
 *
 *   const { errors, validate, clearField } = useFieldErrors(schema)
 *   if (!validate(form)) return            // shows red borders, blocks submit
 *   <Input aria-invalid={!!errors.name}
 *          onChange={(e) => { clearField("name"); setForm(...) }} />
 *   {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
 */
export function useFieldErrors<T>(schema: ZodType<T>) {
  const [errors, setErrors] = useState<Record<string, string>>({})

  const validate = useCallback(
    (data: unknown): data is T => {
      const res = schema.safeParse(data)
      if (res.success) {
        setErrors({})
        return true
      }
      const map: Record<string, string> = {}
      for (const issue of res.error.issues) {
        const key = issue.path.join(".")
        if (key && !map[key]) map[key] = issue.message
      }
      setErrors(map)
      return false
    },
    [schema],
  )

  const clearField = useCallback((field: string) => {
    setErrors((prev) => {
      if (!prev[field]) return prev
      const next = { ...prev }
      delete next[field]
      return next
    })
  }, [])

  const clearAll = useCallback(() => setErrors({}), [])

  return { errors, validate, clearField, clearAll }
}
