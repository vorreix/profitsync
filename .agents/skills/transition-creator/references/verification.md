# Verifying smoothness in a real browser

Code that *looks* right is not proof. The user's requirement is that the motion actually feels seamless — so you have to run it and watch it, backed by objective signals. Two browser-automation MCPs are available in this environment: **Chrome DevTools MCP** (preferred — it can record performance traces) and **Playwright MCP** (good for driving + screenshots). Use whichever is connected.

## 1. Start the app

| Command | Use when |
|---|---|
| `vercel dev` | Full app (API + auth + data). App serves on **:3001** (sometimes :3000 — check the startup log). Needed for any authed page that loads data. |
| `npm run dev` | Vite frontend only (no `/api`). Fine for **public/marketing pages** (`/`, `/blog`, `/privacy-policy`) and any pure-UI component that doesn't fetch. Lighter and faster to boot. |

Run it in the background and wait for the "ready"/port line before navigating. Prefer the lightest server that still renders the interaction you're verifying — most landing-page and isolated-component motion needs only `npm run dev`.

## 2. Reach the screen

- **Public pages** (no auth): navigate straight to the route.
- **Authed app pages** (`/dashboard`, `/clients`, `/transactions`, …): you must sign in past Clerk. In the Clerk **dev** instance, sign up/in with an email like `yourname+clerk_test@example.com` — the `+clerk_test` suffix auto-verifies with **no email code** (use the test OTP `424242` if prompted). Then navigate to the target route. (This requires `vercel dev` so `/api/profile` etc. resolve.)
- If auth/data setup is too heavy for the interaction you're testing, consider reproducing the component in isolation (a throwaway route or Storybook-style page) so you can verify the *motion* without the whole data path. Note in your report if you did this.

## 3. Drive the interaction and capture objective signals

The goal is to catch the two things eyes miss: layout shift (the jank source) and dropped frames.

**With Chrome DevTools MCP (preferred):**
1. Navigate to the page and let it settle.
2. Start a performance trace.
3. Perform the interaction (click "View More", open the modal, etc.) — and ideally do it 2–3 times so the trace clearly contains the animation window.
4. Stop the trace and analyze it.
5. Read the insights:
   - **Layout Shift (CLS):** must stay ~0 *during the animation*. A spike means you animated a layout property (height/width/top/margin) and the page reflowed — go back and switch to transform/opacity or the grid trick. **This is the single most important signal** and the objective proxy for "no jank/flicker."
   - **Frames / long tasks:** no long main-thread tasks during the animation window; frame rate stays near 60fps. Long tasks = stutter.
6. Take screenshots at rest → mid-animation → settled to confirm it visibly moves and lands cleanly (no half-rendered flash at the extremes).

**With Playwright MCP (alternative):** drive the click and capture before/mid/after screenshots; use `browser_evaluate` to read `performance.getEntriesByType('layout-shift')` around the interaction, or to log frame timings via `requestAnimationFrame`, as a lighter objective check.

## 4. The pass bar

Ship only when all hold:
- The interaction visibly animates — smooth onset and settle, **no snap, no flash, no pop**.
- **No layout shift attributable to the animation** (CLS ~0 across the interaction).
- **No dropped frames / long tasks** in the animation window (~60fps).
- The **`prefers-reduced-motion: reduce`** variant still works: re-run with reduced motion emulated (DevTools "Emulate CSS prefers-reduced-motion" / Playwright `browser_emulate` or context option) and confirm the state still changes but the movement is removed/minimized.

## 5. If it's not smooth

Don't paper over it. Trace the symptom back through the flicker checklist in `SKILL.md` step 4:
- CLS spiked → you animated layout; move to transform/opacity or the grid trick.
- It flashes/pops at start or end → missing `overflow-hidden` wrapper, animating from `display:none`, or the element re-mounts (unstable key).
- A property snaps mid-transition → `transition-all` caught something; scope it.
- Stutter/long tasks → too much animating at once, or a heavy re-render fires on the same state change; reduce scope or memoize.

Fix, re-run the trace, and repeat until the bar in §4 is genuinely met. That loop *is* the deliverable — "make sure it's seamless" means you watched it be seamless.

## 6. Clean up
Stop the background dev server when done. Don't leave a throwaway verification route committed — remove it before finishing.
