---
name: transition-creator
description: Create smooth, flicker-free UI transitions and micro-interactions (expand/collapse "View More", enter/exit, lists, modals/drawers, hover, page changes) in React/Tailwind apps, then verify them in a real browser until they feel seamless. Use this skill whenever the user says "use transition creator", or asks to add/improve/polish an animation or transition, make an interaction feel smooth/buttery/premium, fix janky/flickering/abrupt/laggy UI, animate a "View More"/accordion/list/modal/drawer, stagger a reveal, or improve the feel of any UI motion — even if they never say the word "animation".
---

# Transition Creator

Make UI motion feel **effortless and alive** — the kind of smoothness a user *feels* but can't quite name. When they click "View More" the section should grow into place like it was always there; when a card leaves a list the others should glide to fill the gap; when a modal opens it should arrive, not blink. The opposite — flicker, snapping, jank, a hard cut where motion was expected — reads as "cheap" even when nothing is functionally broken. Your job is to close that gap.

This skill is the difference between *"it works"* and *"it feels good"*. Treat the second as the real requirement.

## The golden rule that prevents 90% of bad motion

**Animate only `transform` and `opacity`.** These are composited by the GPU — the browser can move and fade things without recalculating layout or repainting. Animating `width`, `height`, `top`, `left`, `margin`, or `padding` forces the browser to re-flow the whole page every frame, which is the root cause of the "janky/flickering/boring" feeling the user is complaining about.

When you genuinely need to animate height (expand/collapse to `auto`), you do **not** animate `height` — you use the grid `0fr → 1fr` trick (see below). Internalize this: *if you find yourself putting `height`, `width`, or `top`/`left` in a transition, stop and find the transform-or-grid equivalent.*

## Workflow

Follow these steps in order. Don't skip the inventory or the verification — they are what make the result actually good rather than plausible-looking.

### 1. Pin down the exact interaction

Identify the precise element and trigger the user means ("the View More button on the client detail page expands the transactions list"). Read the component. Note: what changes (mount/unmount? height? reorder? a class toggle?), what wraps it, and what state drives it. Motion is only as good as your understanding of *what is actually moving*.

### 2. Inventory the toolkit (prefer what exists)

Read `package.json` and grep the codebase for how animation is *already* done here, then reuse that vocabulary. A new dependency is a last resort, not a first move — consistency is part of polish, and an unfamiliar library that fights the existing patterns makes things worse.

- **In this project (profitsync):** read `references/this-project.md`. It has the installed toolkit (`tw-animate-css`, `@formkit/auto-animate`, the grid trick, `.pressable`/`.page-enter` utilities) and copy-ready reference implementations already shipping in the app. Match them.
- **In any other project:** inventory that project the same way — check `package.json` for `motion`/`framer-motion`, `tailwindcss-animate`/`tw-animate-css`, `@formkit/auto-animate`, GSAP, etc., and grep a few components for existing `transition-`/`animate-`/`data-[state]` usage. Adopt the house style.

Only escalate to a **new library** (almost always `motion`, the successor to framer-motion) when the effect genuinely needs something CSS can't do cleanly — shared-layout transitions where an element flies from one place to another (`layoutId`), spring physics, gesture/drag, or orchestrated exit animations of unmounting trees. When you do add one, say *why* CSS wasn't enough, lazy-load it so it doesn't bloat the initial bundle, and confirm with the user if it's a meaningful dependency. See `references/techniques.md` → "Escalating to a library".

### 3. Choose the technique

Match the interaction to a recipe. Full recipes (copy-paste, with the reasoning) are in `references/techniques.md` — read it before implementing anything non-trivial.

| Interaction | Default technique |
|---|---|
| Expand/collapse to auto height ("View More", accordion, details) | Grid `0fr → 1fr` + inner `overflow-hidden`, transition `grid-template-rows` + `opacity` |
| Item enter/exit, list add/remove/**reorder** | `@formkit/auto-animate` (`useAutoAnimate`) — zero-config, handles reflow |
| Element appears on mount (toast, dropdown, revealed panel) | `tw-animate-css`: `animate-in fade-in slide-in-from-* duration-150` |
| Modal / dialog / sheet / drawer | Animate the primitive's `data-[state=open]`/`[state=closed]`; `tw-animate-css` keyframes; `vaul` for drawers |
| Hover / press / focus micro-interactions | `transition-transform`/`transition-colors` + `group-hover:` **and** an `:active` press (`.pressable`) — see note below |
| Page / route change | The `.page-enter` utility (or equivalent fade+rise) |
| Staggered reveal of many items | Incremental `animationDelay` / `style={{ '--i': index }}` — see techniques |

Two traps that look done but aren't — check both before moving on:

- **"Tactile/press/premium" needs a press state, not just hover.** A hover lift answers "this is clickable"; it does *not* make something feel tactile. If the user said tactile, press, tap, satisfying, or premium-feeling, you must add an `:active` depress (`.pressable` or `active:scale-[0.97]`) *in addition to* the hover effect — leaving it out is the most common way this skill half-delivers. See `techniques.md` §5.
- **Apply the effect to every variant of the component.** The same entity is often rendered in 2–3 places (a grid card *and* a list row *and* a "closed/archived" variant). Animating one and missing the others reads as a bug. Grep for the sibling variants and treat them identically.

Whatever you pick, apply the **non-negotiables** every time:

- **Easing matters more than duration.** Never ship a bare `linear` or default `ease` for anything the user watches move. Use ease-out for things entering/expanding (fast then settle — feels responsive), ease-in for things leaving. Good defaults: `cubic-bezier(0.22, 1, 0.36, 1)` (this project's `page-enter` curve) or Tailwind's `ease-out`. Durations: 120–200ms for small/hover, 200–300ms for panels/expands, 300–400ms for large moves. Faster than it feels like it should be.
- **Respect `prefers-reduced-motion`.** Some users get motion-sick or have it disabled. Gate movement behind `motion-safe:` (this project's convention) or a reduced-motion fallback that swaps the move for an instant/short fade. Never remove the state change — only the motion.
- **Scope your transitions.** Prefer `transition-[transform,opacity]` or `transition-colors` over `transition-all` — `all` quietly animates properties you didn't mean to (and re-triggers on unrelated changes), a common flicker source.

### 4. Kill flicker before it ships

Flicker/jank almost always traces to one of these. Run this checklist against your change — it's the heart of "without any flickering":

- **Animating from `display:none`** → the element pops in with no transition. Keep it mounted; animate `opacity`/`grid-rows` instead, or use an exit-animation primitive.
- **Animating layout properties** (`height`/`width`/`top`/`margin`) → reflow jank. Switch to `transform`/`opacity` or the grid trick.
- **Height change with no `overflow-hidden` wrapper** → content spills/reflows mid-animation. The grid trick *requires* an inner `overflow-hidden` child.
- **Element re-mounts on the state change** (its React `key` or position changes) → it flashes/restarts. Keep keys stable.
- **`transition-all`** catching an unintended property (e.g. a color or shadow snapping) → scope the transition.
- **No initial state** → first frame jumps from final to start. Ensure the "from" state is actually rendered first (mount in collapsed/hidden state, then flip).
- **Layout shift around the animated element** → siblings jump. Verify in step 5 that surrounding content doesn't shift unexpectedly.

### 5. Verify in a real browser — until it's actually smooth

This is not optional and it is what the user means by "make sure it's seamless." Plausible code is not proof. Open the app, perform the interaction, and *watch it*, with objective signals to back up your eyes. Full instructions (starting the dev server, signing in past Clerk, capturing a performance trace, reading the numbers) are in `references/verification.md`.

The bar:
- The interaction visibly animates — smooth start and settle, no snap, no flash.
- **No layout shift caused by the animation** (this is the objective proxy for "no jank" — if you animated transform/opacity correctly, CLS during the interaction stays ~0; if it spikes, you animated layout and must fix it).
- **No dropped frames / long tasks** during the animation window (stays ~60fps).
- The `prefers-reduced-motion` variant still works (state changes, motion is reduced).

If it's not smooth, go back to step 3/4 and iterate. Loop until it genuinely feels good — that's the whole point of the skill.

### 6. Report what you changed and why

Briefly: which files, which technique, and the *why* (e.g. "used the grid-rows trick instead of animating height so it stays on the compositor — no reflow"). If you added a dependency or a reusable utility, call it out so it can become a project convention.

## Reference files

- `references/techniques.md` — the full motion catalog: copy-paste recipes per interaction type, the easing reference, stagger, the View Transitions API, and when/how to escalate to `motion`. **Read before implementing anything beyond a trivial hover.**
- `references/this-project.md` — profitsync's exact installed toolkit and the reference implementations already in the app (FAQ accordion, AccountSelector auto-animate, `.pressable`/`.page-enter`). Match these.
- `references/verification.md` — how to run the app, reach the screen, and capture objective smoothness signals in a real browser.
