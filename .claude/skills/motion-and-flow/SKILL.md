---
name: motion-and-flow
description: Use when building node/flow/diagram/graph editors or draggable canvases (React Flow / @xyflow/react), or implementing rich web animation — gestures, drag, spring physics, shared-element & layout transitions, enter/exit (mount/unmount) animations, scroll-linked or staggered motion, auto-animating lists/grids — with Motion (motion.dev, motion/react, formerly framer-motion) or AutoAnimate (@formkit/auto-animate); also when choosing which animation approach fits, or when motion janks, flickers, pops, or ignores reduced-motion.
---

# Motion & Flow

Expert guidance for **node/flow UIs** (React Flow) and **motion** (Motion + AutoAnimate), plus the design craft and browser-verification that make them feel right.

**Core principle:** reach for the *lightest* tool that does the job, animate **transform/opacity only**, always respect **reduced-motion**, and **verify it in a real browser** — reading the diff is not enough.

## When to use

- Building or editing a **React Flow** graph: nodes/edges/handles, custom nodes, draggable canvas, connections, layouting, minimap (`@xyflow/react`).
- **Motion** work: gestures (hover/tap/drag), spring physics, **exit animations** (`AnimatePresence`), **shared-element / layout** transitions (`layout`, `layoutId`), variants/orchestration/stagger, scroll-linked motion, imperative sequences (`useAnimate`), motion values.
- **AutoAnimate**: zero-config animation when list/grid children are added, removed, or reordered.
- **Choosing** between CSS, AutoAnimate, Motion, and React Flow — or debugging motion that **janks, flickers, pops, queues, or ignores reduced-motion**.

**Not for:** pure visual design — color/type/layout/spacing (→ `frontend-design`, `ui-ux-pro-max`); generic Tailwind/CSS transition polish with no library, e.g. a "View More"/accordion (→ `transition-creator`); charts (recharts/d3).

## Choose the right tool

| You need… | Use | Why |
|---|---|---|
| List/grid items **add/remove/reorder** with no effort | **AutoAnimate** | One ref on the parent; ~3kb; respects reduced-motion. |
| Hover/press feedback, simple one-shot enter | **CSS / `tw-animate-css`** | Cheapest; already the repo default. (Polish → `transition-creator`.) |
| **Exit** animation on unmount; variants; orchestrated **stagger**/sequence | **Motion** (`AnimatePresence`, variants) | Only Motion keeps a node mounted long enough to animate *out*. |
| **Drag**, gestures, **spring** physics, interruptible/gesture-driven motion | **Motion** | Springs track velocity and redirect mid-flight; CSS can't. |
| **Shared-element / "magic move"**, layout/position/size transitions | **Motion** (`layout`, `layoutId`) | Automatic FLIP between states/components. |
| **Scroll-linked** (parallax, progress bars) | **Motion** (`useScroll` + `useTransform`) | Maps scroll → motion values without re-renders. |
| A **canvas of connected nodes** (diagram, graph, pipeline, flow editor) | **React Flow** | Pan/zoom, handles, edges, custom nodes, layouting. |
| Drag-to-reorder with sensors/handles | **`@dnd-kit`** (in repo) + AutoAnimate for the settle | dnd-kit owns the drag; AutoAnimate eases the reflow. |

**Escalation ladder:** CSS → AutoAnimate → Motion. Start at the cheapest that satisfies the requirement. *If it's a canvas of connected nodes, it's React Flow* (not Motion).

## Core motion laws (apply to every animation)

1. **Animate `transform` & `opacity` only.** They're compositor-only (60fps). Animating `width/height/top/left/margin/padding` triggers reflow → jank. For layout changes use FLIP / Motion's `layout`.
2. **Respect `prefers-reduced-motion`.** Gate decorative motion: `motion-safe:` (Tailwind), `useReducedMotion()` / `<MotionConfig reducedMotion="user">` (Motion — it's **opt-in**, default `"never"`), AutoAnimate honors it automatically. Provide a reduced (opacity/instant) alternative, never just slower.
3. **Direction of easing:** **ease-out** for things entering / responding to the user, **ease-in** for things leaving, ease-in-out for on-screen moves. Typical durations **150–300ms** (micro 100–200, larger 300–500).
4. **Make it interruptible.** Anything gesture- or state-driven should redirect from its current position (springs / motion values), not jump or queue.
5. **Verify in a browser.** Trace FPS, check for flicker/pop, confirm exit runs, test reduced-motion. See `references/verification.md`.

## Top gotchas (the footguns that bite first)

- **React Flow:** `nodeTypes`/`edgeTypes` **must be a stable reference** (module scope or `useMemo`) or every node remounts each render; import `@xyflow/react/dist/style.css`; the canvas parent needs an explicit height. `colorMode="dark"` is a real v12 prop. **In this repo:** keep `@xyflow` behind the lazy `/flow` route and in its own `flow → charts → vendor` chunk — breaking that is a total white-screen (`references/this-project.md`).
- **Motion:** `npm i motion`, import from **`motion/react`** (not `framer-motion`); `AnimatePresence` needs a **`key`**, a **direct child**, and an **`exit`** prop; let Motion own `transform` (don't also apply Tailwind transform/`animate-*` to a `motion.*` element); `motion.create(Component)` (not the old `motion(Component)`).
- **AutoAnimate:** the ref must go on the **direct parent** of the animating children — extra wrapper layers break it.

## References (read the one you need — they're deep)

| File | Read when |
|---|---|
| `references/react-flow.md` | Any React Flow work — nodes/edges/handles, custom nodes & edges, hooks, `useReactFlow`, layouting (dagre/elk), sub-flows, performance, theming/`colorMode`, SSR, TS, v11→v12, drag-and-drop. |
| `references/motion.md` | Any Motion work — components, variants, `AnimatePresence`, layout/`layoutId`, gestures/drag, motion values, `useAnimate`, scroll, vanilla `animate()`, bundle optimization, a11y, TS, gotchas. |
| `references/auto-animate.md` | AutoAnimate — `useAutoAnimate`/`autoAnimate()`, options, custom plugins, every framework, constraints, when-vs-Motion. |
| `references/motion-design-principles.md` | The craft — easing/duration/springs, choreography, the 12 principles, the 60fps budget, reduced-motion patterns, and a per-pattern cheat-sheet (modal, toast, accordion, list, page transition…). |
| `references/this-project.md` | Working in **ProfitSync** — how `/flow`, AutoAnimate, `tw-animate-css`, vaul/embla/dnd-kit are wired; the chunking white-screen invariant; adding Motion to this repo. |
| `references/verification.md` | Before claiming any motion/flow is done — the browser-verify loop (60fps trace, flicker, reduced-motion, React Flow render). |

**See also:** `transition-creator` (generic Tailwind/CSS transitions), `frontend-design` / `ui-ux-pro-max` (visual design), `chrome-devtools` (perf tracing).
