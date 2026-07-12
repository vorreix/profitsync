import { useEffect, useState, type ComponentType } from "react"

/**
 * Dev-only mount of Agentation (https://agentation.com) — a visual-feedback tool
 * that lets you click UI elements and emit structured context (selectors, file
 * paths, component tree) for AI coding agents.
 *
 * It's a **devDependency** and must never ship to real users. The dynamic
 * `import("agentation")` lives INSIDE an `import.meta.env.DEV` guard: in a
 * production/native build Vite replaces `import.meta.env.DEV` with `false`, so
 * Rollup dead-code-eliminates the whole effect — the module is never resolved,
 * never chunked, and never reaches the prod bundle (verify: `dist` contains no
 * "agentation"). In dev, the toolbar appears bottom-right.
 */
export function DevAgentation() {
  const [Tool, setTool] = useState<ComponentType | null>(null)

  useEffect(() => {
    if (!import.meta.env.DEV) return
    let alive = true
    import("agentation")
      .then((m) => {
        if (alive) setTool(() => m.Agentation)
      })
      .catch(() => {
        // agentation is optional dev tooling — swallow load failures silently.
      })
    return () => {
      alive = false
    }
  }, [])

  return Tool ? <Tool /> : null
}
