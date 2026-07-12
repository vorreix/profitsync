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
    // Opt OUT under the e2e dev server. The `playwright smoke` project boots the
    // real dev server (`npm run dev`, so import.meta.env.DEV === true), where this
    // toolbar's fixed bottom-right overlay sits over the Add-Client FAB and
    // intercepts pointer events — Playwright then times out clicking through it.
    // playwright.config.ts sets VITE_DISABLE_DEV_TOOLS=1 on that web server (an
    // explicit, deterministic signal — navigator.webdriver is NOT reliably true
    // across Playwright launch modes). Normal `npm run dev` keeps the toolbar.
    if (import.meta.env.VITE_DISABLE_DEV_TOOLS) return
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
