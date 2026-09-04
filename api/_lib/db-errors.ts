/**
 * Recognise a Postgres constraint violation anywhere in an error chain.
 *
 * Drizzle wraps the driver error in a DrizzleQueryError whose `message` is the
 * SQL text, so the constraint name lives on `.cause` (the NeonDbError). Walk
 * the chain rather than inspecting only the outer error, which is what made
 * every unique violation surface as a 500 instead of a helpful 409.
 *
 * One definition, shared by every route and by sync — four routes used to carry
 * an identical copy each.
 */
export function violates(err: unknown, constraint: string): boolean {
  let node: unknown = err
  for (let depth = 0; node && typeof node === "object" && depth < 5; depth++) {
    const e = node as { constraint?: unknown; detail?: unknown; message?: unknown; cause?: unknown }
    if (typeof e.constraint === "string" && e.constraint === constraint) return true
    if ([e.message, e.detail].some((v) => typeof v === "string" && v.includes(constraint))) return true
    node = e.cause
  }
  return false
}

/** SQLSTATE 23505 anywhere in the chain — a unique violation of ANY constraint. */
export function isUniqueViolation(err: unknown): boolean {
  let node: unknown = err
  for (let depth = 0; node && typeof node === "object" && depth < 5; depth++) {
    const e = node as { code?: unknown; cause?: unknown }
    if (e.code === "23505") return true
    node = e.cause
  }
  return false
}
