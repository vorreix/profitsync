# Motion techniques — recipes & reasoning

Copy-paste recipes per interaction type. Every one obeys the golden rule (animate `transform`/`opacity`, never raw layout props) and is reduced-motion aware. Adapt class names to the host project's toolkit; the examples use Tailwind v4 + `tw-animate-css` (this project's stack).

## Table of contents
1. Expand/collapse to auto height (the grid trick)
2. Enter/exit and list reorder (auto-animate)
3. Mount reveals (tw-animate-css)
4. Modals, drawers, overlays
5. Hover / press / focus micro-interactions
6. Staggered reveals
7. Page / route transitions
8. View Transitions API (cross-DOM morphs)
9. Easing & duration reference
10. Reduced motion
11. Escalating to a library (motion / framer-motion)

---

## 1. Expand/collapse to auto height — the grid trick

The canonical "View More" / accordion. You can't transition `height: 0 → auto` (CSS won't animate to an intrinsic value), and animating a fixed `max-height` is laggy and guesses wrong. The grid `0fr → 1fr` trick animates the *track size* of a single-row grid, which CSS **can** interpolate, while an inner `overflow-hidden` wrapper clips the content cleanly.

```tsx
<div
  className={cn(
    "grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none",
    open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
  )}
>
  <div className="overflow-hidden">
    {/* the content that grows/shrinks */}
  </div>
</div>
```

Why it's flicker-free: the outer grid never reflows the page abruptly, the inner `overflow-hidden` prevents content spilling during the squeeze, and opacity hides the half-rendered state at the extremes. **The `overflow-hidden` child is mandatory** — omit it and the content jumps.

For a rotating chevron/plus on the trigger, animate the icon with `transition-transform` + `rotate-*` (see §5), not the container.

## 2. Enter/exit and list reorder — auto-animate

When items are added, removed, or reordered in a list/grid, `@formkit/auto-animate` handles all of it (including the *other* items sliding to their new positions) by diffing the DOM. Zero per-item wiring.

```tsx
import { useAutoAnimate } from "@formkit/auto-animate/react"

const ANIM = { duration: 250, easing: "ease-out" as const }

function List({ items }) {
  const [parent] = useAutoAnimate<HTMLUListElement>(ANIM)
  return (
    <ul ref={parent}>
      {items.map((it) => <li key={it.id}>{it.label}</li>)}
    </ul>
  )
}
```

Notes: keys must be stable and correct (it diffs by DOM position + key). It respects `prefers-reduced-motion` automatically. Great for filtered lists, add/remove rows, and the side-by-side ↔ stacked reflow pattern (see `this-project.md` → AccountSelector). Not for: a single element toggling height — use the grid trick (§1).

## 3. Mount reveals — tw-animate-css

For an element that should animate *in* when it first renders (dropdown, popover content, a freshly revealed panel, a toast):

```tsx
<div className="animate-in fade-in slide-in-from-bottom-2 duration-150 motion-safe:animate-in">
  …
</div>
```

Building blocks: `animate-in`/`animate-out`, `fade-in`/`fade-out`, `slide-in-from-{top,bottom,left,right}-N`, `zoom-in-95`/`zoom-out-95`, `spin-in`, combined with `duration-*` and `delay-*`. Gate with `motion-safe:` if the move is significant. For exit animations of *unmounting* components, `animate-out` only plays if the element stays in the DOM long enough — for true unmount choreography use a primitive that delays removal (Radix, vaul) or escalate to `motion`'s `AnimatePresence` (§11).

## 4. Modals, drawers, overlays

Radix-based shadcn primitives expose `data-[state=open]` / `data-[state=closed]` on both the overlay and the content, and keep the element mounted through the close transition — so you animate via those state attributes and exits Just Work:

```tsx
// content
className="data-[state=open]:animate-in data-[state=closed]:animate-out
           data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0
           data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95
           data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom
           duration-200"
// overlay
className="data-[state=open]:animate-in data-[state=closed]:animate-out
           data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
```

Backdrop: fade only (`fade-in-0`/`fade-out-0`) — never slide a backdrop. For bottom-sheet/drawer UX with drag-to-dismiss, use `vaul` (already installed) rather than hand-rolling. Keep modal content motion subtle (150–200ms, small slide + fade); big bouncy modal entrances feel toy-like in a finance app.

## 5. Hover / press / focus micro-interactions

Small, fast, transform-based. These are what make a UI feel "tactile."

**"Tactile" / "press" / "feels good to tap" means two states, not one.** A hover lift alone is *hover feedback*, not tactility — the word the user is reaching for is the **`:active` press response**: the element visibly depresses under the finger/cursor and springs back on release. If the request says tactile, press, tap, satisfying, or premium-feeling, you must add an `:active` state (the `.pressable` utility or `active:scale-[0.97]`) — a hover lift without it only does half the job. Hover answers "this is interactive"; press answers "I felt that."

The full premium recipe is **hover lift + press depress + motion-safe**, applied to *every* variant of the component:

```tsx
// the complete tactile control — lift on hover, depress on press, accessible
className="pressable motion-safe:transition-[transform,box-shadow] motion-safe:duration-200
           motion-safe:hover:-translate-y-0.5 motion-safe:hover:shadow-lg"
//   .pressable           → scale(0.97)+fade on :active (the press)   ← the part that's easy to forget
//   hover:-translate-y   → subtle lift (the hover)
//   motion-safe:         → both gated for reduced-motion
```

Other building blocks:

```tsx
// icon nudge on group hover (RTL-aware)
className="transition-transform duration-200 group-hover:translate-x-0.5 rtl:rotate-180"
// color-only changes (keep alongside the transform recipe above)
className="transition-colors hover:bg-muted/70 hover:text-foreground"
// no .pressable available? inline the press:
className="transition-transform duration-150 active:scale-[0.97]"
```

Rules:
- **Pair hover with press** whenever the ask is about feel/tactility — see above. This is the single most common miss.
- **Apply to every rendering of the component.** Cards, lists, and grids often render the same entity in 2–3 places (e.g. a grid card *and* a list-row variant *and* a "closed" variant). Animating one and leaving the others flat looks broken. Grep for the other variants and treat them identically.
- Scope to `transition-transform`/`transition-colors`/`transition-[transform,box-shadow]` (not `all`); keep ≤200ms.
- Press depth: `scale(0.96–0.98)` — smaller is invisible, larger feels mushy.
- Always preserve a visible `:focus-visible` ring for keyboard users — don't let an `active:`/`hover:` rewrite drop it.

## 6. Staggered reveals

When many items appear at once (a grid of cards on page load), a tiny per-item delay turns a blunt pop into a graceful cascade.

```tsx
{items.map((it, i) => (
  <div
    key={it.id}
    className="animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-backwards"
    style={{ animationDelay: `${i * 40}ms` }}
  >
    …
  </div>
))}
```

Keep the increment small (30–60ms) and cap total stagger (~6–10 items' worth) so late items don't feel slow. `fill-mode-backwards` holds the "from" state during the delay so nothing flashes before its turn.

## 7. Page / route transitions

Subtle fade + rise on the page container. This project ships a `.page-enter` utility:

```css
.page-enter { animation: page-enter 220ms cubic-bezier(0.22, 1, 0.36, 1); }
@keyframes page-enter { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
```

Apply to the top-level element of a routed page. Keep it short (≤250ms) and translate-only — routed content shifting horizontally feels disorienting.

## 8. View Transitions API (cross-DOM morphs)

For morphing one element into another across a DOM/route change (e.g. a list thumbnail expanding into a detail hero), the native View Transitions API is now broadly supported:

```ts
if (document.startViewTransition) {
  document.startViewTransition(() => { /* apply the DOM/state change */ })
} else {
  /* apply the change without a transition — graceful fallback */
}
```

Pair matching elements with `style={{ viewTransitionName: 'hero-' + id }}`. Three things people forget:

- **Feature-detect** (`if (document.startViewTransition)`) and fall back to an instant change — the modal/navigation must still work where the API is unsupported.
- **Set `viewTransitionName` only on the *participating* element(s), and only while the transition is happening** — names must be unique per snapshot. Naming *every* row in a list permanently is heavier and can warn; prefer setting it conditionally on the one row that's actually morphing (`viewTransitionName: active ? 'row-'+id : undefined`).
- **Gate it for reduced motion** — the API does not fully respect the user's preference on its own. Skip the wrapper (or shorten the animation via CSS) when reduced motion is set:
  ```ts
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (document.startViewTransition && !reduce) {
    document.startViewTransition(() => applyChange())
  } else {
    applyChange()   // instant
  }
  ```

Reserve this for genuinely shared-element morphs — for plain fades the simpler techniques above are lighter.

## 9. Easing & duration reference

Easing is what sells the motion; duration is secondary. Bare `linear` looks robotic; default `ease` is mushy.

| Use | Curve | Feel |
|---|---|---|
| Enter / expand / reveal | ease-**out** — `cubic-bezier(0.22, 1, 0.36, 1)` or Tailwind `ease-out` | fast then settles — responsive |
| Exit / collapse / leave | ease-**in** — `cubic-bezier(0.4, 0, 1, 1)` | accelerates away |
| Move between two on-screen points | ease-in-out — `cubic-bezier(0.4, 0, 0.2, 1)` | smooth both ends |
| Playful emphasis (use sparingly) | spring/overshoot (needs `motion`) | bounce |

Durations: hover/press 120–200ms · panels/expands 200–300ms · large moves / drawers 300–400ms · page 200–250ms. When unsure, go *shorter* — snappy beats slow. Match enter/exit durations so toggling feels symmetric.

## 10. Reduced motion

Non-negotiable for accessibility. Two equivalent conventions:

- **Tailwind variants:** put the movement behind `motion-safe:` (only animates when motion is OK) and/or kill it with `motion-reduce:transition-none` / `motion-reduce:animate-none`. This project uses `motion-safe:`.
- **CSS media query** for custom keyframes:
  ```css
  @media (prefers-reduced-motion: reduce) {
    .page-enter { animation: none; }
  }
  ```

The state still changes instantly — you remove *motion*, not *function*. `auto-animate` and Radix handle this internally; your hand-rolled transitions must do it explicitly.

## 11. Escalating to a library (motion / framer-motion)

CSS + the tools above cover ~95% of product UI. Reach for `motion` (the renamed framer-motion; import from `motion/react`) only when the effect needs:

- **Shared-layout transitions** — an element flies from position A to B as the DOM restructures (`layout`, `layoutId`). CSS can't do this without manual FLIP bookkeeping.
- **Orchestrated exit animations** of unmounting subtrees — `<AnimatePresence>` delays unmount so exits actually play.
- **Spring physics / gesture-driven** motion — drag, momentum, velocity-aware springs.

```tsx
import { motion, AnimatePresence } from "motion/react"

<AnimatePresence>
  {open && (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ type: "spring", stiffness: 400, damping: 32 }}
    />
  )}
</AnimatePresence>
```

When adding it: (a) justify *why* CSS wasn't enough in your report, (b) lazy-load it (`const motion = await import("motion/react")` or a `React.lazy` boundary) so it doesn't enter the initial bundle — this project lazy-loads every route for exactly this reason, (c) for a meaningful new dependency, confirm with the user first. `motion` respects `prefers-reduced-motion` via the `useReducedMotion()` hook or the `MotionConfig reducedMotion="user"` wrapper — use it.
