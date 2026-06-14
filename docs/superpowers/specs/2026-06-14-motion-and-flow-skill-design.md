# Skill: `motion-and-flow` — design

- **Date:** 2026-06-14
- **Status:** Approved (brainstorming) → in build
- **Author:** Claude (Opus 4.8) with Matteo

## Goal

A single, deep project skill that makes the agent an expert at building **animated, node/flow-based, motion-rich frontends** with three libraries, plus the motion-design craft that ties them together:

- **React Flow** (`@xyflow/react` ^12.11.0) — node/flow/diagram/graph UIs. Already powers `/flow` (`src/pages/MoneyFlowPage.tsx`).
- **Motion** (`motion` / `motion/react`, the successor to Framer Motion) — advanced animation, gestures, springs, layout/shared-element transitions. **Not yet installed** (`npm i motion` on first use).
- **AutoAnimate** (`@formkit/auto-animate` ^0.9.0) — zero-config add/remove/move animation for list/grid children. Used in `Dashboard.tsx`, `WealthPage.tsx`.

## Decisions (from brainstorming)

1. **Structure:** one combined skill — lean `SKILL.md` router + deep per-library reference files (progressive disclosure). Matches `transition-creator`.
2. **Breadth:** the three libraries + motion-design principles (easing, choreography, springs, performance, reduced-motion, "which tool when"). Pure visual design (color/type/layout) is **deferred** to `frontend-design` and `ui-ux-pro-max` — the skill links to them rather than duplicating.
3. **Nature:** actionable — reference depth + copy-paste recipes + a browser-verification workflow (chrome-devtools / Playwright), matching the repo's "verify in a real browser" culture.

## Coexistence with existing skills

- `transition-creator` keeps generic **Tailwind/CSS** transition polish (View More / accordion / flicker fixes). `motion-and-flow` owns the **library-specific** (Motion / AutoAnimate) and **node-graph** (React Flow) territory and points to `transition-creator` for plain-CSS work.
- `frontend-design` / `ui-ux-pro-max` own visual design; `motion-and-flow` links out for color/type/layout.

## File layout

```
.claude/skills/motion-and-flow/
  SKILL.md                                  # router: when-to-use, decision matrix, core motion laws, links
  references/
    react-flow.md                           # nodes/edges/handles, custom nodes+edges, hooks, layouting, perf, theming, SSR, v11→v12, repo chunking invariant
    motion.md                               # motion/react: components, variants, AnimatePresence, layout/layoutId, gestures, motion values, useAnimate, vanilla motion, perf, a11y
    auto-animate.md                         # useAutoAnimate + autoAnimate(), options, custom plugins, constraints, when-vs-Motion
    motion-design-principles.md             # easing/duration/springs/choreography, 12 principles→UI, 60fps/compositor props, prefers-reduced-motion, cheat-sheet
    verification.md                         # browser-verify workflow: 60fps, no layout thrash, reduced-motion honored, no enter/exit flicker, RF renders
    this-project.md                         # repo grounding: MoneyFlowPage patterns, chunking gotcha, AutoAnimate usage, vaul/embla/@dnd-kit/tw-animate coexistence, lazy-load
  evals/
    evals.json                              # triggering evals (fires on the right prompts, quiet on unrelated)
```

## Build approach (ultracode)

Deep, *accurate* API knowledge is the hard part — especially net-new `motion`. A research **Workflow** fans out one agent per library to mine **current official docs** (reactflow.dev, motion.dev, auto-animate.formkit.com) + the context7 MCP, each draft then **adversarially fact-checked** (import paths, hook/prop names, signatures, version specifics) before the final reference file is written. `SKILL.md`, `verification.md`, `this-project.md`, and `evals.json` are authored by the orchestrator after synthesis for cross-file coherence.

## Out of scope

Color systems, typography, layout/spacing (→ `frontend-design`, `ui-ux-pro-max`); generic Tailwind/CSS transitions (→ `transition-creator`); recharts/d3 charting; drag-reorder via `@dnd-kit` (covered only where it intersects motion).

## Success criteria

- Accurate to installed versions; every snippet has correct imports and would compile.
- SKILL.md fires on flow/motion/auto-animate tasks and stays quiet on unrelated ones (evals pass).
- An agent can build a custom React Flow node, an `AnimatePresence` exit, a shared-element `layoutId` transition, and an AutoAnimate list — and verify them in a browser — using only this skill.
