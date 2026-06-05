# profitsync — installed toolkit & reference implementations

This project already has a coherent, CSS-first motion system. **Match it.** Do not introduce a competing approach (e.g. don't reach for `motion` when the grid trick or `auto-animate` already covers the case) — consistency is part of the polish. When this skill runs in a *different* repo, ignore this file and inventory that repo instead.

## Installed animation toolkit

| Package / utility | What it gives you | Reach for it when |
|---|---|---|
| `tw-animate-css` (imported in `src/index.css`) | `animate-in`/`animate-out`, `fade-in`, `slide-in-from-*`, `zoom-in-95`, `data-[state]` keyframes, `motion-safe:`/`motion-reduce:` | mount reveals, dropdowns, toasts, dialog/sheet state animations |
| `@formkit/auto-animate` | `useAutoAnimate(ref-config)` — diff-based enter/exit/reorder | lists, grids, add/remove rows, side-by-side ↔ stacked reflows |
| `vaul` | drag-to-dismiss bottom drawers | mobile sheets / drawers |
| `radix-ui` (shadcn primitives) | `data-[state=open|closed]` attributes, mounted-through-close | modals, popovers, accordions, tooltips |
| `embla-carousel-react` | carousel/slider motion | horizontal carousels |
| `next-themes` | theme switching | dark/light transitions |
| Custom utilities in `src/index.css` | `.pressable`, `.page-enter`, `.ios-tap`, `.safe-p*`, `.scrollbar-thin` | see below |

No `motion`/`framer-motion`, GSAP, or react-spring is installed — and you rarely need them here. The grid trick + `auto-animate` + `tw-animate-css` cover almost everything. (See `techniques.md` §11 for the narrow cases that justify adding `motion`.)

## House conventions (observed in the codebase)

- **Reduced motion via `motion-safe:`** — significant movement is gated, e.g. `AccountSelector.tsx`: `motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-200`.
- **Scoped transitions** — `transition-transform`, `transition-colors`, `transition-[max-height,opacity]`; `transition-all` is used only where many properties genuinely change together.
- **Signature easing** — `cubic-bezier(0.22, 1, 0.36, 1)` (the `.page-enter` curve) for entrances; otherwise Tailwind `ease-out`.
- **Durations** — 120ms press, 150ms small reveals, 200ms overlays, 300ms expands/reflows.
- **RTL awareness** — Arabic is RTL; icon nudges use `rtl:rotate-180` / `rtl:-translate-x-*`. Preserve this in hover micro-interactions.

## Reference implementations to copy

### Expand/collapse — grid trick (`src/landing/sections/FAQ.tsx`)
The accordion is the reference for any "View More"/expand. Outer single-row grid toggles `grid-rows-[1fr] opacity-100` ↔ `grid-rows-[0fr] opacity-0` with `transition-all duration-300 ease-out`; inner child is `overflow-hidden`. The trigger's `+` icon rotates via `transition-transform duration-300` + `rotate-45`. Mirror this structure exactly for new expand/collapse work.

### List/grid reflow — auto-animate (`src/components/AccountSelector.tsx`)
```ts
const ANIM = { duration: 300, easing: "ease-in-out" as const }
const [bodyRef] = useAutoAnimate<HTMLDivElement>(ANIM)
const [cardsRef] = useAutoAnimate<HTMLDivElement>(ANIM)
```
`bodyRef` animates a field/footer in and out; `cardsRef` animates account cards reflowing between a side-by-side grid and a vertical stack. Reuse the `ANIM` config shape (or tighten to 250ms `ease-out` for snappier lists).

### Mount reveal + reduced motion (`src/components/AppLayout.tsx`, `MobileAppLayout.tsx`, `BulkActionBar.tsx`)
FAB actions and the bulk-action bar use `animate-in fade-in slide-in-from-bottom-2 duration-150` (and `motion-safe:` variants). The reference for anything that pops into view.

### Micro-interactions — custom utilities (`src/index.css`)
```css
.pressable { transition: transform 120ms ease-out, opacity 120ms ease-out; }
.pressable:active { transform: scale(0.97); opacity: 0.85; }
.page-enter { animation: page-enter 220ms cubic-bezier(0.22, 1, 0.36, 1); }
@keyframes page-enter { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
.ios-tap { -webkit-tap-highlight-color: transparent; }
```
Add `.pressable` to tappable controls (it's already the house press-feedback). For touch targets also add `.ios-tap`. If you create a *new* reusable motion utility, add it to the `@layer utilities` block in `src/index.css` so it becomes a shared convention — and mention it in your report.

### Hover lift / icon nudge (`src/landing/sections/Features.tsx`, `Hero.tsx`)
Cards: `transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lg`. Arrow icons: `transition-transform duration-200 group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5`. Reuse these for new interactive cards/links.

## Where things live
- Global CSS, `@theme`, custom utilities, keyframes: `src/index.css`
- App components: `src/components/`, pages: `src/pages/`, marketing: `src/landing/`
- shadcn primitives: `src/components/ui/` — **vendored, don't hand-edit** (re-add via `npx shadcn@latest add` if needed). You can wrap them or pass animation classes, but don't modify the files.
- `cn()` (clsx + tailwind-merge) for conditional classes: `src/lib/utils.ts`
