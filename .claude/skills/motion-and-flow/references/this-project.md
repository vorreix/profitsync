# This project (ProfitSync) — how motion & flow are already wired

Repo-specific grounding. Read this before adding flow/motion to ProfitSync — it shows the in-repo patterns to copy and the project-specific traps to avoid. For library depth see `react-flow.md`, `motion.md`, `auto-animate.md`, `motion-design-principles.md`.

## What's installed

| Library | Version | Status |
|---|---|---|
| `@xyflow/react` (React Flow) | `^12.11.0` | Installed. Used at `/flow` only. |
| `@formkit/auto-animate` | `^0.9.0` | Installed. Used on Dashboard + Wealth grids. |
| `tw-animate-css` | `^1.4.0` | Installed, imported globally in `src/index.css`. The default enter/exit motion vocabulary. |
| `vaul` | `^1.1.2` | Bottom-sheet drawers — wrapped in `src/components/ui/drawer.tsx`. |
| `embla-carousel-react` | `^8.6.0` | Carousels — wrapped in `src/components/ui/carousel.tsx`. |
| `@dnd-kit/*` | `^6 / ^3` | Drag-to-reorder (Dashboard cards, Wealth). |
| **`motion` (motion.dev)** | — | **NOT installed.** Run `npm i motion` before importing `motion/react`. See "Adding Motion" below. |

> Gotcha: There is no `framer-motion` here. If you add advanced animation, install `motion` and import from `motion/react` (see `motion.md`), not the old `framer-motion` package.

## React Flow lives at `/flow` only — and that is load-bearing

`src/pages/MoneyFlowPage.tsx` is the **only** consumer of `@xyflow/react`, and it is **lazy-loaded** (`src/App.tsx:26`). Keep it that way.

### The chunking invariant (white-screen risk) — do not break

`vite.config.ts` (`manualChunks`, ~line 141) forces `@xyflow` into its own one-way leaf chunk:

```js
if (id.includes("@xyflow")) return "flow"          // flow -> charts -> vendor (acyclic)
if (id.includes("recharts") || id.includes("d3-") || id.includes("victory-vendor")) return "charts"
```

React Flow depends on `d3-zoom`/`d3-drag`, which route into `charts`. If `@xyflow` falls into `vendor` instead, `vendor ↔ charts` becomes circular and `charts` initializes before vendor's React is ready → **`TypeError: Cannot read properties of undefined (reading 'forwardRef')` at boot on every page** (a total white screen). The graph must stay `flow → charts → vendor`.

After touching chunking, verify the leaf stays isolated:
```bash
npm run build
grep -o 'charts-[^"]*\.js' dist/assets/vendor-*.js   # must be EMPTY
grep -o 'flow-[^"]*\.js'   dist/assets/vendor-*.js    # must be EMPTY
```

> Gotcha: Don't import anything from `@xyflow/react` (or its CSS) into a module that loads eagerly (anything in the `vendor` graph). Keep React Flow behind a lazy route.

## React Flow conventions used here (copy these)

`MoneyFlowPage.tsx` is the reference implementation. The patterns it already gets right:

- **`nodeTypes` is module-scope and stable** — `const NODE_TYPES = { root: RootNode, group: GroupNode, leaf: LeafNode, ... }` at `MoneyFlowPage.tsx:262`, passed as `nodeTypes={NODE_TYPES}`. Never inline this object (see `react-flow.md` — inline recreation remounts every node).
- **Typed custom nodes** — `function GroupNode({ data }: NodeProps<Node<GroupData>>)`. Data is fully typed; currency + callbacks (`onToggle`, `onOpen`) are passed *through `data`*, not closed over.
- **Controlled state** — `const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])` + `useEdgesState`, wired to `onNodesChange`/`onEdgesChange`.
- **Instance via `onInit`** — `onInit={(inst) => { flowRef.current = inst }}` with `flowRef = useRef<ReactFlowInstance<Node, Edge> | null>(null)`; `fitView` is called inside `requestAnimationFrame` (and uses `{ padding: 0.2, maxZoom: 1 }`).
- **Camera persistence** — viewport + UI state (`viewMode`, filters, `rootCollapsed`, dragged positions) is snapshotted to `sessionStorage` under `ps_flow_${activeOrg.id}` (restored via `defaultViewport`, else `fitView`). Expand/collapse deliberately does **not** move the camera.
- **`nodrag` escape hatch** — interactive elements inside a node (buttons, the whole-card open button) carry `className="nodrag ..."` so React Flow doesn't start a drag/swallow the click. (`nopan`/`nowheel` exist too — see `react-flow.md`.)
- **Read-only graph** — `nodesConnectable={false}`, `elementsSelectable`, `nodesDraggable`, `proOptions={{ hideAttribution: true }}`, `defaultEdgeOptions={{ type: "smoothstep", style: { strokeWidth: 1.5 }, animated: false }}`, `<Background gap={20} />`, `<Controls showInteractive={false} />`.
- **Graph building is pure** — node/edge construction lives in `src/lib/money-flow.ts` (`buildFlowGraph`, `buildTimelineGraph`), kept out of the component and unit-testable.

> Gotcha: Node enter animation here is CSS, not a library — leaves use `style={{ animationDelay: ... }}` + `motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-left-3 motion-safe:duration-300 motion-safe:fill-mode-both` (tw-animate-css). React Flow positions nodes with transforms; layer your own enter motion *inside* the node DOM, and keep it `motion-safe:`.

## AutoAnimate conventions used here

- `src/pages/WealthPage.tsx:136` — `const [cardsRef] = useAutoAnimate<HTMLDivElement>({ duration: 220, easing: "ease-out" })`, ref on the **direct parent** of the cards.
- `src/pages/Dashboard.tsx:533` — `const [gridRef] = useAutoAnimate<HTMLDivElement>()` (defaults).

Reach for it for add/remove/reorder of list/grid children. The parent ref must be the *immediate* parent of the animating items (see `auto-animate.md`).

## Default motion vocabulary (no library)

`tw-animate-css` is imported in `src/index.css` and is the house default for simple enter/exit (`animate-in`, `fade-in-0`, `slide-in-from-*`, `zoom-in-95`, `duration-*`, `fill-mode-*`). Radix-based shadcn components (dialog, sheet, popover, drawer) already animate via `data-[state=open/closed]` + these utilities. **Always gate decorative motion behind `motion-safe:`** — the repo respects reduced-motion this way. For generic Tailwind/CSS transition polish (View More, accordions, flicker fixes), the **`transition-creator`** skill is the home; this skill owns the library-specific (Motion/AutoAnimate) and node-graph (React Flow) work.

Other in-repo motion: `vaul` (drawers, `drawer.tsx`), `embla` (carousels, `carousel.tsx`), `@dnd-kit` (drag-reorder), and `useBackClose` (`src/hooks/use-back-close.ts`) which pushes a history entry so the device back button closes modals — coordinate any modal/exit animation with it.

## Adding Motion (motion.dev) to this repo

1. `npm i motion` (runtime dep — it animates the live app, so **not** a devDependency).
2. Import from `motion/react`: `import { motion, AnimatePresence } from "motion/react"`.
3. This is a Vite SPA (not Next RSC), so no `"use client"` needed — but motion components are client-only regardless.
4. **Bundle/chunking:** `motion` has no `d3`/charts dependency, so it can live in `vendor`. But if you only use it on heavy/lazy routes, consider `LazyMotion` + the `m` component (see `motion.md`) to keep the eager bundle small. Re-run the `dist/assets/vendor-*.js` grep checks after adding it to confirm you didn't create a new cross-chunk cycle.
5. Tailwind's `transition`/`transform`/`animate-*` utilities fight Motion over the same `transform`/`transition` — let Motion own `transform` on elements it animates; don't also apply `tw-animate-css` enters to a `motion.*` element.
6. Honor reduced motion via `useReducedMotion()` / `<MotionConfig reducedMotion="user">`, consistent with the repo's `motion-safe:` convention.

## Verifying in this repo

Run the full app with `vercel dev` (Vite + API, port ~3001 — `npm run dev` is frontend-only). Then verify motion/flow in a real browser per `verification.md`. The repo's e2e suite (`e2e/`, Playwright) and the `prod-build` project are the structural guards; a manualChunks cycle is exactly the class of bug the `prod-build` e2e project exists to catch.
