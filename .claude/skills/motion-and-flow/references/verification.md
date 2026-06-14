# Verifying motion & flow in a real browser

Motion that "looks right in the code" routinely janks, flickers, or ignores reduced-motion in the browser. **Animation and flow work is not done until you've watched it run.** This file is the verification loop — what to check and how to measure it.

## Tooling in this environment

- **chrome-devtools MCP** (preferred for perf): `navigate_page`, `take_screenshot`, `take_snapshot`, `click`/`hover`/`drag`, `performance_start_trace` / `performance_stop_trace`, `performance_analyze_insight`, `emulate` (CPU/network throttle, reduced-motion), `evaluate_script`, `list_console_messages`, `list_network_requests`. There's a `chrome-devtools` skill for the full workflow.
- **playwright MCP** (preferred for interaction/visual): `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_take_screenshot`, `browser_evaluate`, `browser_wait_for`.
- **Repo e2e** (`e2e/`, Playwright) — the `prod-build` project boots the real bundle in a browser and is the structural guard for the chunking white-screen class of bug.

Run the app first: `vercel dev` (full Vite+API, port ~3001). `npm run dev` is frontend-only.

## The motion checklist

Verify every animation against these. Treat any miss as a bug, not a nitpick.

1. **60fps / no jank.** No dropped frames during the animation. Record a trace while triggering it (below). Animate **transform/opacity only** — if you see long "Recalculate Style" / "Layout" / "Paint" bars, you're animating a layout-triggering property (width/height/top/left/margin) — fix it (see `motion-design-principles.md`).
2. **No flicker / no FOUC.** Element doesn't pop to its final state for one frame before animating, and doesn't flash on mount. (Classic `AnimatePresence` exit bug: missing `key` or missing `initial={false}` — see `motion.md`.)
3. **Enter AND exit both run.** For modals/lists/toasts, confirm the *exit* actually plays (the component must stay mounted until exit completes — `AnimatePresence`, not a raw conditional).
4. **Reduced-motion honored.** With `prefers-reduced-motion: reduce`, decorative motion is removed/replaced — not just slower. Test it (below).
5. **Interruptible.** Trigger the animation, then immediately trigger the reverse (hover on/off fast, open/close fast). It should redirect from the current position, not jump or queue. Springs/motion values pass; fixed tweens often don't.
6. **Accessible.** Focus lands correctly after the transition; keyboard still works; nothing essential is conveyed by motion alone; looping/auto motion can be stopped.
7. **No console errors/warnings** during the interaction (`list_console_messages`).

### React Flow extra checks

8. **Nodes actually render** — a blank canvas usually means a **zero-size parent** (give the wrapper an explicit height) or the **missing CSS import** (`@xyflow/react/dist/style.css`).
9. **No remount thrash** — pan/zoom and node interactions stay smooth; if nodes flicker/reset on every render, `nodeTypes`/`edgeTypes` is being recreated inline (must be module-scope or `useMemo` — see `react-flow.md`).
10. **`fitView` frames the graph**; handles connect where expected (if connectable); `nodrag`/`nopan` elements inside nodes are clickable without starting a drag.
11. **Build-safe** — for ProfitSync, after any flow change run the `dist/assets/vendor-*.js` grep checks in `this-project.md` (the chunking white-screen guard).

## How to measure 60fps / jank

```text
1. navigate_page → the route
2. performance_start_trace (reload: false, autoStop: false)
3. trigger the animation (click/hover/drag the element)
4. performance_stop_trace
5. performance_analyze_insight → look for long tasks, layout shifts,
   and "Layout"/"Recalculate Style"/"Paint" work DURING the animation window
```

Quick visual alternative: in DevTools Rendering, enable **paint flashing** (green = repaint) and **layer borders** — a transform/opacity animation should show *no* green repaint on the moving element. Via MCP, screenshot before/mid/after and compare, or script a check:

```js
// evaluate_script / browser_evaluate — confirm element is on its own compositor layer
// and that you're animating transform, not layout props.
const el = document.querySelector('[data-animating]')
getComputedStyle(el).willChange      // 'transform'/'opacity' is fine; avoid pinning 'auto' forever
getComputedStyle(el).transform       // animation should drive this, not top/left/width/height
```

## How to test reduced-motion

```text
chrome-devtools: emulate prefers-reduced-motion: reduce  → reload → trigger animation
playwright:      browser_navigate after launching context with reducedMotion
```

Or assert in-page:

```js
window.matchMedia('(prefers-reduced-motion: reduce)').matches  // true under emulation
```

With it on: Motion's `useReducedMotion()`/`<MotionConfig reducedMotion="user">` should drop transforms; `tw-animate-css` `motion-safe:` utilities should no-op; AutoAnimate already self-disables (unless `disrespectUserMotionPreference: true` — which is a bug here). Essential transitions may remain but must be minimal (prefer opacity/instant over movement).

## The loop

Build → run app → **navigate + trigger + trace + analyze** → if any checklist item fails, fix and re-verify. Don't claim the motion is done from reading the diff — confirm it from the trace and the screenshots. (See `superpowers:verification-before-completion`.)
