# Motion Design Principles & Performance

A comprehensive, production-ready reference for motion design across web platforms—covering easing, duration, spring physics, choreography, performance optimization, and accessibility. Library-agnostic: CSS, Web Animations API, Framer Motion, React Spring.

---

## Why Motion Matters

Motion in UI serves four core jobs:

1. **Feedback** — Confirm user actions (button press, toggle switch, form submission)
2. **Continuity** — Show spatial relationships (nav transition, modal entrance, element reveal)
3. **Spatial Hierarchy** — Draw attention to what's important (entrance of critical alerts, focus movement)
4. **Attention** — Guide the eye to essential information (progress indicators, success states)

Bad motion costs:
- **Cognitive load** — Jerky, unexpected motion confuses users about what changed
- **Vestibular distress** — Parallax, large translations, rapid scaling trigger motion sickness
- **Slowness perception** — Sluggish animations make your app feel unresponsive, even if code is fast
- **Battery drain** — Constant motion burns GPU and CPU on mobile, draining battery 15–30% faster
- **Trust erosion** — Sloppy motion (janky 45 FPS, overshooting easing) signals unpolished work

---

## Easing: The Feel of Motion

Easing determines how motion accelerates and decelerates. It's the #1 lever for making motion feel natural or robotic.

### Cubic Bezier Fundamentals

All easing curves are cubic Bezier functions: `cubic-bezier(x1, y1, x2, y2)`. The convention is:
- **X-axis:** normalized time from 0 (start) to 1 (end)
- **Y-axis:** normalized progress from 0 to 1; values **outside [0, 1] create overshoot/bounce**
- **Control points** (x1, y1) and (x2, y2) shape the curve between start and end

```
cubic-bezier(x1, y1, x2, y2)
      ↑ progress (0 to 1)
      |     *------- y2 (end control point)
      |    /
      |   / (curve defined by control points)
      |  /
      | *-------- y1 (start control point)
      |/
      +------→ time (0 to 1)
```

### CSS Easing Keywords

| Keyword | Cubic Bezier | Behavior | Use Case |
|---------|--------------|----------|----------|
| `linear` | `(0, 0, 1, 1)` | Constant speed | Progress bars, loaders, continuous animations |
| `ease-in` | `(0.42, 0, 1, 1)` | Slow start → fast end | Exit animations (button collapse, drawer close) |
| `ease-out` | `(0, 0, 0.58, 1)` | Fast start → slow end | Entry animations (button expand, modal open) |
| `ease-in-out` | `(0.42, 0, 0.58, 1)` | Slow start → fast middle → slow end | Reversible animations (toggle, expand/collapse) |

### Practical Rules

**Rule 1: Easing-out for entries, easing-in for exits.**

- When something **enters** the stage, ease-out: start fast, slow at the end. This feels like an object with momentum arriving.
- When something **exits**, ease-in: start slow, accelerate away. This feels like an object leaving under its own power.

**Rule 2: Use ease-in-out for element interactions that reverse.**

- Toggle switches, expand/collapse panels, show/hide dropdowns — the animation can play forward and backward, so ease-in-out (symmetric) works best.

**Rule 3: Avoid pure linear unless it's truly continuous.**

- Linear motion (constant speed) feels robotic for discrete UI changes. Exception: indeterminate progress bars, rotating loaders, marquee text.

**Rule 4: Overshoot and bounce are playful, not serious.**

- Overshoot (Y > 1) is fun for confirmations, easter eggs, celebrations. 10–20% overshoot feels delightful; 50%+ feels broken.
- Bounce (Y dips below 0) is energetic. Use sparingly in professional apps; common in games and playful products.

### Material Design 3 Easing Approach

Material Design 3 defines motion through **intent**, not specific token values (which are version-specific and may change). Consult the [official Material Design 3 motion documentation](https://m3.material.io/styles/motion) for current token values.

The conceptual approach:
- **Standard easing** (entry/exit reversible): symmetric curve for most UI transitions
- **Decelerate easing** (exit emphasis): starts faster, slows at the end; for closing/dismissing
- **Accelerate easing** (entry emphasis): starts slow, speeds up; for opening/revealing
- **Emphasized easing** (complex transitions): a branded curve with slight overshoot for high-importance moments

### Custom Bezier Curves

Y-values outside [0, 1] create overshoot/bounce. Test custom curves empirically:

```css
/* Slight bounce (10% overshoot) */
cubic-bezier(0.34, 1.56, 0.64, 1)

/* Snappy elastic (20% overshoot) */
cubic-bezier(0.175, 0.885, 0.32, 1.275)

/* Bouncy decelerate (30% overshoot into elastic) */
cubic-bezier(0.68, -0.55, 0.265, 1.55)
```

**Caveat:** Not all browsers equally support curves with Y outside [0, 1]. Test on your target browsers. Experiment interactively at [cubic-bezier.com](https://cubic-bezier.com).

---

## Duration: The Rhythm of Motion

Humans perceive motion in bands. Get the duration wrong and your animation feels either instant-and-jarring or sluggish-and-unresponsive.

### Perception Bands

| Duration | Perception | Example |
|----------|-----------|---------|
| 0–100 ms | Instant (no motion felt) | Opacity flash, instant feedback |
| 100–200 ms | Micro-interaction (very snappy) | Button press ripple, hover state change |
| 200–300 ms | Standard transition | Modal/drawer entrance, tab switch, element slide |
| 300–500 ms | Complex choreography | Multi-element reveal, wizard step transition |
| 500–1000 ms | Intentional slowness | Loading state animation, hero reveal, celebration |
| 1000+ ms | Long-form storytelling | Onboarding tutorials, explainer animations |

### The Distance Rule

Animation duration should scale with **distance traveled** and **visual impact**:
- Small, local changes (toggle, dropdown appear): 150–200 ms
- Medium shifts (sidebar slide, modal from corner): 250–350 ms
- Large, full-screen transitions (page navigation): 400–600 ms
- Very subtle/peripheral motion (background change, shadow shift): 100–150 ms

### Mobile vs. Desktop

- **Desktop:** Users expect 250–400 ms for standard transitions (more screen space to traverse)
- **Mobile:** Stick to 150–300 ms; the smaller screen makes longer animations feel sluggish
- **Complex choreography:** Add 50–100 ms per staggered element

---

## Spring Physics: The Superior Alternative to Tweens

Springs are **asymmetric, interruptible, and physically realistic**. They outperform traditional tweens (linear interpolation) in feel and user experience.

### Why Springs Beat Tweens

1. **Reversibility** — If the user cancels mid-animation (e.g., touches a drawer while it's opening), a spring reverses naturally without jarring stops. A tween must be interrupted and reversed manually.
2. **No "duration" parameter** — Springs respond to **stiffness** and **damping**, not milliseconds. This makes them intuitive: stiff springs feel snappy, soft springs feel floaty.
3. **Natural momentum** — Springs settle into their final position with a bit of overshoot, then damp out. Tweens hit the exact end value with no character.

### Spring Parameters

All spring libraries (Framer Motion, React Spring, react-use-gesture) use three core parameters:

```javascript
{
  stiffness,   // Spring constant: how hard it pulls (1–1000). Higher = faster.
  damping,     // Damping ratio: resistance to oscillation (0–1). Higher = less bounce.
  mass,        // Mass: inertia (default 1). Higher = more overshoot.
}
```

**Relationship:**
- **Stiffness ↑** → Springs accelerate faster
- **Damping ↑** → Less overshoot, settles quicker (critical damping ≈ 0.8–0.9)
- **Mass ↑** → More overshoot, takes longer to settle

### Spring Presets

Different libraries use different parameter names and scales. Below are common conventions:

| Preset | Stiffness | Damping | Mass | Feel | Use Case |
|--------|-----------|---------|------|------|----------|
| **Gentle** | 80 | 12 | 1 | Very slow, floaty | Subtle panel transitions, background fades |
| **Bouncy** (Framer Motion default) | 170 | 26 | 1 | Quick with playful overshoot | Modal entrance, button press, list add |
| **Snappy** | 300 | 25 | 1 | Fast, responsive, minimal bounce | Gestures, drawer drag, quick confirms |
| **Stiff** | 500 | 30 | 1 | Very fast, nearly instant | Micro-interactions, ripples, immediate feedback |

**Library-specific note:** Framer Motion and React Spring use slightly different parameter names and scales. Consult your library's documentation for exact equivalents. The conceptual approach (higher stiffness = faster, higher damping = less bounce) is universal.

### When to Use Springs

- ✅ Touch/gesture animations (drawer, swipe-to-dismiss)
- ✅ Draggable elements (drag-to-reorder lists)
- ✅ Interactions that can be interrupted (modal entrance if user clicks elsewhere)
- ✅ Playful, character-driven motion (celebrations, easter eggs)
- ❌ Do NOT use springs for critical workflows where exact timing is essential (e.g., timed confirmations, regulatory delays)

---

## Choreography & Orchestration

Great motion isn't just smooth easing and duration. It's the **sequence and timing of multiple elements together**.

### Stagger Sequencing

When multiple elements animate together, stagger them—each starts slightly after the previous:

```javascript
// Framer Motion stagger example
const containerVariants = {
  animate: {
    transition: {
      staggerChildren: 0.05,  // Each child starts 50ms after the previous
      delayChildren: 0.1,      // First child waits 100ms
    },
  },
};

const itemVariants = {
  animate: { opacity: 1, y: 0 },
  initial: { opacity: 0, y: 20 },
};
```

Stagger makes lists feel alive instead of robotic. Typical stagger: 50–100 ms between items.

### Lead Elements

In a choreographed sequence, designate one **lead element** that draws attention first:

1. **Modal backdrop fades in** (0 ms, 150 ms, ease-out)
2. **Modal panel slides up** (100 ms, 300 ms, ease-out) — starts while backdrop is still fading
3. **Form fields fade in** (200 ms, 150 ms, ease-out) — start after modal lands

The stagger creates a visual "flow" through the interface. The lead (backdrop) orients the viewer, then secondary elements follow.

### Spatial Consistency

All elements moving in the same direction should use the **same easing curve**:
- If backdrop `ease-out`, modal should `ease-out`.
- If modal uses `cubic-bezier(0, 0, 0.58, 1)`, buttons inside should too.

Inconsistent easing within a choreographed sequence breaks the illusion of unified motion.

### Follow-Through and Overlapping Action

- **Follow-through:** After the primary action completes, allow secondary elements to settle. Example: button press → ripple expands, then fades out. The ripple doesn't stop instantly when the user releases.
- **Overlapping action:** Start related animations slightly before the primary animation finishes. This creates a sense of momentum and energy.

---

## The 12 Disney Animation Principles Applied to UI

Disney's 12 principles of animation (1981) were designed for character animation but apply directly to interactive UI. Here's how:

### 1. Squash and Stretch

In character animation: bones deform when moving (arm swings, squash down, stretch up).

**In UI:** When a button or element animates, briefly compress/expand it to show impact:

```css
@keyframes pressButton {
  0% { transform: scale(1); }
  50% { transform: scaleY(0.95) scaleX(1.05); }
  100% { transform: scale(1); }
}
```

A button press that squashes down slightly then pops back feels satisfying; it shows weight and impact. Tiny amounts (5–10% scale change) are more professional; 20%+ is cartoonish.

### 2. Anticipation

In character animation: before jumping, a character bends their knees.

**In UI:** Before a dramatic change, hint at what's coming. Example: before a modal slides up from the bottom, the button that triggered it might briefly scale up or brighten, signaling "something's about to happen."

```javascript
// Modal entrance with anticipation
const modalVariants = {
  hidden: { y: 20, opacity: 0 },
  visible: { y: 0, opacity: 1 },
};

const triggerVariants = {
  tap: { scale: 0.95 },  // Anticipation: compress on press
};
```

Anticipation should be 100–200 ms, very subtle.

### 3. Staging

In character animation: position and light the important action so the audience sees it.

**In UI:** Ensure the moving element is the visual focus. Don't bury a critical entrance animation in a corner or behind another element. Use contrast, z-index, and size to make the motion readable.

### 4. Straight-Ahead vs. Pose-to-Pose

In character animation: straight-ahead = frame-by-frame realism; pose-to-pose = keyframe shortcuts.

**In UI:** Use keyframe-based animations (pose-to-pose) for UI—define start and end states, let the browser interpolate. This is more efficient and easier to reason about than frame-by-frame JS.

```css
/* Pose-to-pose: browser interpolates between the two poses */
@keyframes expand {
  from { height: 0; opacity: 0; }
  to { height: auto; opacity: 1; }
}
```

### 5. Follow-Through and Overlapping Action

Already covered above in Choreography. Elements don't all start/stop at the same time; they cascade.

### 6. Slow-In and Slow-Out

This is easing. Covered extensively in the Easing section. Use ease-in-out for entries and exits.

### 7. Arc

In character animation: objects move in curves, not straight lines (feel more natural).

**In UI:** When possible, translate elements along curved paths instead of straight lines:

```javascript
// Framer Motion with curve interpolation
<motion.div
  initial={{ x: 0, y: 0 }}
  animate={{ x: 200, y: 100 }}
  transition={{ type: 'tween', duration: 0.5 }}
/>
```

For truly curved paths (Bézier curves), use SVG animations or Canvas. Example: a notification that swings in from the side:

```javascript
// Swing arc via rotation + translation
<motion.div
  initial={{ rotate: -45, x: -100, opacity: 0 }}
  animate={{ rotate: 0, x: 0, opacity: 1 }}
  transition={{ duration: 0.4, ease: 'easeOut' }}
/>
```

### 8. Secondary Action

In character animation: while the main action happens (walking), secondary action happens too (arms swing, hair bounces).

**In UI:** While a primary element animates, add complementary secondary motion. Example: list item slides in (primary), and a checkmark icon appears with a bounce (secondary).

```javascript
const itemVariants = {
  animate: { x: 0, opacity: 1 },  // Primary: slide in
};

const checkmarkVariants = {
  animate: { 
    scale: 1.2,                     // Secondary: bounce
    transition: { delay: 0.2 }
  },
};
```

### 9. Timing

Timing is duration + pacing. See the Duration and Easing sections above. The rule: **right timing makes motion feel intentional; wrong timing makes it feel accidental.**

### 10. Exaggeration

In character animation: amplify a gesture for clarity (huge eyes, wide mouth).

**In UI:** Exaggeration makes motion readable. A subtle 2px scale change might be invisible on a mobile screen; a 5% scale change is unmistakable. But 50% exaggeration looks broken. Find the sweet spot: 10–20% for importance, 3–5% for micro-interactions.

### 11. Solid Drawing

In character animation: anatomically sound, weighty structures.

**In UI:** Ensure animated elements feel **weighty and real**. Use shadows, layering, and consistent easing to convey that elements have substance:

```css
.modal {
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  /* Shadow grows as modal enters, adding weight perception */
}
```

### 12. Appeal

In character animation: personality, charm, uniqueness.

**In UI:** Motion that appeals is motion that serves the user and feels intentional. Avoid gratuitous animation. Every motion should answer: "Why is this moving? What does it communicate?"

Examples of appealing motion:
- A success animation that celebrates with a bounce
- A loading spinner that's smooth and rhythmic, not jittery
- A form error that shakes left/right, signaling "nope, try again"

---

## Performance: The 60 FPS Budget

Smooth motion requires **60 frames per second (FPS)** on desktop and **120 FPS on high-end mobile** (iPhone 120Hz, Galaxy 120Hz tablets). Miss these targets and motion appears janky.

### The 16.6 ms Frame Waterfall

At 60 FPS, the browser has **16.6 milliseconds per frame** to:

1. **Execute JavaScript** (2–4 ms budget): Event handlers, state updates, DOM changes
2. **Style & Layout** (2–4 ms): CSS recalculation, box model, reflow
3. **Paint** (2–4 ms): Rasterize visible regions
4. **Composite** (2–4 ms): Merge layers, apply transforms, copy to screen

If **any step exceeds its budget**, the frame drops. Dropping even 1 frame in a 60 FPS animation (16.6 ms gap) becomes visible as a visible stutter.

### Property Costs: Transform & Opacity Are Cheap

| Property | Cost | Pipeline Stage | Why |
|----------|------|---|---|
| `transform` (translate, rotate, scale) | ✅ Cheap | Composite only | Skips layout/paint; GPU-accelerated |
| `opacity` | ✅ Cheap | Composite only | Opacity change requires no layout recalculation |
| `filter` | ⚠️ Medium | Paint + Composite | Rasterizes the element; slower on large elements |
| `box-shadow` | ⚠️ Medium | Paint | Complex blur/spread requires expensive rasterization |
| `width`, `height` | ❌ Expensive | Layout + Paint | Triggers reflow of the entire document |
| `left`, `top`, `right`, `bottom` (positioning) | ❌ Expensive | Layout + Paint | Repositions elements; document reflow |
| `margin`, `padding` | ❌ Expensive | Layout + Paint | Changes box model; reflow |
| `border-width` | ❌ Expensive | Layout + Paint | Alters element dimensions |

**Golden Rule:** Animate **only `transform` and `opacity`**. Everything else is expensive.

### Avoiding Layout Thrashing

**Layout thrashing** = repeatedly reading and writing DOM properties in a loop, forcing layout recalculation on every read.

```javascript
// ❌ BAD: Forces layout 5 times (reads/writes alternating)
for (let i = 0; i < items.length; i++) {
  items[i].style.left = positions[i].x;       // Write triggers layout
  let height = items[i].offsetHeight;         // Read triggers layout
  items[i].style.top = positions[i].y;        // Write again
}

// ✅ GOOD: Batch reads, then batch writes
const heights = items.map(item => item.offsetHeight);  // Read all at once
items.forEach((item, i) => {
  item.style.left = positions[i].x;
  item.style.top = positions[i].y;
});
```

### FLIP Technique: Animate Without Knowing End Position

**FLIP** (First, Last, Invert, Play) is a layout-safe animation technique. Use it when you don't know the final dimensions/position ahead of time.

```javascript
// FLIP using Web Animations API
const element = document.querySelector('.box');

// First: record current position/size
const first = element.getBoundingClientRect();

// Make the DOM change (resize, reposition, etc.)
element.classList.add('expanded');

// Last: record new position/size
const last = element.getBoundingClientRect();

// Invert: translate/scale back to the original position
const invert = {
  x: first.left - last.left,
  y: first.top - last.top,
  sx: first.width / last.width,
  sy: first.height / last.height,
};

// Play: animate from inverted to identity
element.animate([
  {
    transform: `translate(${invert.x}px, ${invert.y}px) scale(${invert.sx}, ${invert.sy})`,
  },
  {
    transform: 'translate(0, 0) scale(1, 1)',
  },
], {
  duration: 300,
  easing: 'cubic-bezier(0, 0, 0.58, 1)',
});
```

This technique animates using only `transform`, avoiding layout thrashing.

### DevTools Performance Debugging

**Chrome DevTools → Performance tab:**

1. Press **Ctrl+Shift+I** (or **Cmd+Option+I** on Mac), go to **Performance** tab
2. Click the **Record** circle, interact with your animation, stop recording
3. Look at the **Frame Rate** chart (bottom). Ideally, 60 FPS appears as a flat line at the top
4. If you see dips below 60 FPS, check the **Rendering** section:
   - **Purple = Rendering (Layout + Paint)**
   - **Green = Composite**
   - **Yellow = JavaScript**

If purple is long (Layout/Paint taking >4 ms), you're animating an expensive property (width, left, etc.). Switch to `transform`.

**Lighthouse Performance Audit:** Run Lighthouse (DevTools → Lighthouse tab) to measure Cumulative Layout Shift (CLS) and other Web Vitals. Unnecessary animations can increase CLS, harming SEO.

---

## Accessibility: Motion That Respects Users

### The `prefers-reduced-motion` Media Query

Users can enable reduced motion in OS settings (Accessibility → Display → Reduce Motion on macOS, Settings → Accessibility → Display → Remove Animations on Windows, etc.). Browsers expose this preference via CSS:

```css
@media (prefers-reduced-motion: reduce) {
  /* Reduce or eliminate non-essential motion */
}
```

**Key principle:** The goal is to **eliminate non-essential motion**, not to preserve a minimum duration. Per web.dev:

- Animations **can be reduced to imperceptible durations** (1ms is acceptable because it's imperceptible)
- Decorative animations (parallax, background transitions) should be **removed entirely** (0ms / `animation: none`)
- **Essential animations** (form feedback, success confirmations) can be preserved but at reduced speed or in a gentler form (e.g., opacity change instead of scaling)

```css
/* Default: playful entrance */
@keyframes enterModal {
  from { opacity: 0; transform: scale(0.9); }
  to { opacity: 1; transform: scale(1); }
}

.modal {
  animation: enterModal 0.3s ease-out;
}

/* Reduced motion: instant entrance, preserves the state change */
@media (prefers-reduced-motion: reduce) {
  .modal {
    animation: none;
    opacity: 1;
    transform: scale(1);
  }
}
```

Or, for animations that must preserve functionality (e.g., CSS-driven transients), reduce to imperceptible duration:

```css
@media (prefers-reduced-motion: reduce) {
  /* Imperceptible animation: function fires, motion is invisible */
  * {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
  }
}
```

### JavaScript Detection

Detect the preference in JavaScript:

```javascript
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

if (prefersReducedMotion) {
  // Disable animations, reduce duration, or skip motion-driven behavior
} else {
  // Full motion experience
}
```

Listen for changes (user toggles accessibility settings):

```javascript
window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => {
  if (e.matches) {
    // Reduced motion now enabled
  } else {
    // Reduced motion disabled
  }
});
```

### Vestibular Safety

Beyond `prefers-reduced-motion`, avoid triggering vestibular disorders:

- ❌ **Large, rapid translations** (viewport-sized pans or swipes)
- ❌ **Parallax** (background moving at a different speed than foreground; 10%+ difference)
- ❌ **Auto-playing video backgrounds** (especially with parallax)
- ❌ **Rapid scale changes** (zoom in/out >30% in <500 ms)

**Safe alternatives:**
- For parallax: use subtle ratios (2–3% difference, not 10%+)
- For depth: use opacity changes and shadow shifts instead of scaling
- For large transitions: fade between states instead of panning

### Keyboard & Focus Navigation

Animations should not **interfere with keyboard navigation**:

```css
/* Ensure focus outlines are visible and animate if desired */
:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
  animation: focusPulse 0.3s ease-out;
}

@media (prefers-reduced-motion: reduce) {
  :focus-visible {
    animation: none;
  }
}
```

Never hide focus indicators with motion. If focus moves via JS, ensure the target element is scrolled into view instantly (no animation delay).

### Never Convey Critical Info by Motion Alone

If an animation conveys meaning (e.g., a checkmark appears to indicate success), **also convey that meaning with text or color**:

```jsx
// ❌ Bad: Success is only the checkmark animation
<motion.div animate={{ scale: 1 }} initial={{ scale: 0 }}>
  <CheckIcon />
</motion.div>

// ✅ Good: Text + color + animation together
<motion.div animate={{ scale: 1 }} initial={{ scale: 0 }}>
  <CheckIcon color="green" />
  <span>Success</span>
</motion.div>
```

---

## Interruptibility & Continuity

### Spring Reversibility

Springs are **inherently reversible**. If a user interrupts a spring animation mid-way (e.g., clicking a button while a drawer is opening), the spring naturally reverses without jarring stops:

```javascript
// Framer Motion: Spring reverses smoothly on state change
<motion.div
  animate={isOpen ? { x: 300 } : { x: 0 }}
  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
/>
```

If the user toggles `isOpen` twice rapidly, the spring handles the reversals naturally. Tweens (fixed-duration animations) must be manually interrupted and reversed, which is clunky.

### Layout Stability

Animations should **not shift the layout unexpectedly**. Example: avoid animating elements that push other content:

```css
/* ❌ Bad: Animation causes layout shift */
.loader {
  animation: spin 1s linear infinite;
  margin-right: 10px;
  /* If this margin changes during animation, it causes CLS */
}

/* ✅ Good: Use position: absolute or transform to avoid layout impact */
.loader {
  animation: spin 1s linear infinite;
  position: absolute;
  left: 10px;
  /* OR use transform instead of margin */
}
```

Cumulative Layout Shift (CLS) is a Web Vital metric. Animations that cause CLS harm SEO and user experience.

### Animation as State

Treat animations as **state, not side effects**. In Framer Motion and React Spring, animations are driven by props:

```javascript
// Animation is state
<motion.button
  animate={isPressed ? { scale: 0.95 } : { scale: 1 }}
  transition={{ type: 'spring', stiffness: 500 }}
/>
```

When state changes, the animation updates. This makes animations **predictable and testable**.

---

## Practical Cheat Sheet: 15+ Common Patterns

### 1. Button Press (Ripple + Scale)

```javascript
// Framer Motion
<motion.button
  whileTap={{ scale: 0.95 }}
  transition={{ type: 'spring', stiffness: 400, damping: 17 }}
>
  Click me
</motion.button>
```

**Duration:** 150 ms (spring auto-calculates)  
**Easing:** Spring (snappy, reversible)  
**Properties:** `scale` (transform)

### 2. Hover State Lift

```css
button {
  transition: box-shadow 0.2s ease-out, transform 0.2s ease-out;
}

button:hover {
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
  transform: translateY(-2px);
}
```

**Duration:** 200 ms  
**Easing:** ease-out  
**Properties:** `box-shadow`, `transform`

### 3. Toast Entrance & Exit

```javascript
// Toast slides in from bottom, fades out on dismiss
const toastVariants = {
  initial: { y: 100, opacity: 0 },
  animate: { y: 0, opacity: 1 },
  exit: { y: 100, opacity: 0 },
};

<AnimatePresence>
  {showToast && (
    <motion.div
      variants={toastVariants}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
    >
      {message}
    </motion.div>
  )}
</AnimatePresence>
```

**Duration:** 300 ms (spring)  
**Properties:** `transform` (translateY), `opacity`  
**Gotcha:** Use `AnimatePresence` to animate exit, not just enter.

### 4. Modal Entrance

```javascript
const modalVariants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: { opacity: 1, scale: 1 },
};

<motion.div
  variants={modalVariants}
  initial="hidden"
  animate="visible"
  transition={{ duration: 0.3, ease: 'easeOut' }}
>
  {children}
</motion.div>
```

**Duration:** 300 ms  
**Easing:** ease-out  
**Properties:** `scale`, `opacity`

### 5. Drawer Slide (Bottom Sheet)

```javascript
const drawerVariants = {
  hidden: { y: '100%', opacity: 0 },
  visible: { y: 0, opacity: 1 },
};

<motion.div
  variants={drawerVariants}
  initial="hidden"
  animate="visible"
  exit="hidden"
  transition={{ type: 'spring', stiffness: 250, damping: 25 }}
>
  {content}
</motion.div>
```

**Duration:** 350 ms (spring)  
**Properties:** `transform` (translateY), `opacity`

### 6. Accordion Expand/Collapse

```javascript
const contentVariants = {
  collapsed: { height: 0, opacity: 0 },
  expanded: { height: 'auto', opacity: 1 },
};

<motion.div
  variants={contentVariants}
  initial="collapsed"
  animate={isOpen ? 'expanded' : 'collapsed'}
  transition={{ duration: 0.25, ease: 'easeInOut' }}
>
  {children}
</motion.div>
```

**Duration:** 250 ms  
**Easing:** ease-in-out (reversible)  
**Gotcha:** Animating `height: auto` is unreliable in CSS. Use Framer Motion's `layoutId` or measure the content height in JS.

### 7. Tab Switch (Fade)

```javascript
const tabContentVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 },
};

<AnimatePresence mode="wait">
  <motion.div
    key={activeTab}
    variants={tabContentVariants}
    initial="hidden"
    animate="visible"
    exit="hidden"
    transition={{ duration: 0.2 }}
  >
    {tabs[activeTab]}
  </motion.div>
</AnimatePresence>
```

**Duration:** 200 ms  
**Easing:** linear (fade doesn't benefit from easing)  
**Properties:** `opacity`

### 8. List Item Add (Fade + Slide)

```javascript
const itemVariants = {
  hidden: { opacity: 0, y: -10 },
  visible: { opacity: 1, y: 0 },
};

const containerVariants = {
  animate: {
    transition: {
      staggerChildren: 0.05,
    },
  },
};

<motion.ul variants={containerVariants} initial="hidden" animate="visible">
  {items.map(item => (
    <motion.li key={item.id} variants={itemVariants}>
      {item.name}
    </motion.li>
  ))}
</motion.ul>
```

**Duration:** 200 ms per item (staggered)  
**Easing:** ease-out  
**Properties:** `opacity`, `transform` (translateY)

### 9. List Item Remove (Slide & Fade)

```javascript
const exitVariants = {
  exit: { opacity: 0, x: -100, height: 0 },
};

<AnimatePresence>
  {items.map(item => (
    <motion.li key={item.id} variants={exitVariants} exit="exit">
      {item.name}
    </motion.li>
  ))}
</AnimatePresence>
```

**Duration:** 200 ms  
**Easing:** ease-in  
**Properties:** `transform`, `opacity`, `height`

### 10. Skeleton Loader (Pulse Shimmer)

```css
@keyframes shimmer {
  0% { background-position: -1000px 0; }
  100% { background-position: 1000px 0; }
}

.skeleton {
  background: linear-gradient(
    to right,
    #f0f0f0 8%,
    #f9f9f9 18%,
    #f0f0f0 33%
  );
  background-size: 1000px 100%;
  animation: shimmer 2s infinite;
}
```

**Duration:** 2 seconds (continuous)  
**Easing:** linear  
**Gotcha:** Disable animations under `prefers-reduced-motion`.

### 11. Tooltip Fade-In

```javascript
<motion.div
  initial={{ opacity: 0, y: -5 }}
  animate={{ opacity: 1, y: 0 }}
  exit={{ opacity: 0, y: -5 }}
  transition={{ duration: 0.15 }}
>
  {tooltip}
</motion.div>
```

**Duration:** 150 ms  
**Easing:** linear (very fast, easing imperceptible)  
**Properties:** `opacity`, `transform`

### 12. Form Error Shake

```css
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-5px); }
  75% { transform: translateX(5px); }
}

.input.error {
  animation: shake 0.4s ease-in-out;
}
```

**Duration:** 400 ms  
**Easing:** ease-in-out  
**Properties:** `transform` (translateX)  
**Gotcha:** Limit shake to 2–3 cycles; overdoing it is annoying.

### 13. Progress Bar (Indeterminate)

```css
@keyframes progress {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(400%); }
}

.progress {
  animation: progress 1.5s ease-in-out infinite;
  height: 4px;
  background: #3b82f6;
}
```

**Duration:** 1.5 seconds (continuous)  
**Easing:** ease-in-out (start slow, fast middle, slow end)  
**Properties:** `transform` (translateX)

### 14. Toggle Switch

```javascript
const switchVariants = {
  off: { left: '2px', backgroundColor: '#ccc' },
  on: { left: 'calc(100% - 18px)', backgroundColor: '#22c55e' },
};

<motion.div
  variants={switchVariants}
  animate={isOn ? 'on' : 'off'}
  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
>
  {/* toggle knob */}
</motion.div>
```

**Duration:** 200 ms (spring)  
**Properties:** `left` (or use `transform` for better performance), `backgroundColor`

### 15. Fade Between Page Routes

```javascript
// With react-router v6
<AnimatePresence mode="wait">
  <motion.div
    key={location.pathname}
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    transition={{ duration: 0.2 }}
  >
    <Outlet />
  </motion.div>
</AnimatePresence>
```

**Duration:** 200 ms  
**Easing:** linear (fade is usually linear)  
**Properties:** `opacity`

---

## Quick Reference Table

| Interaction | Duration | Easing | Trigger | Properties | Notes |
|---|---|---|---|---|---|
| Button press | 150 ms | Spring (snappy) | `whileTap` / `mousedown` | `scale` | Use spring for reversibility |
| Hover lift | 200 ms | ease-out | `:hover` / `onMouseEnter` | `transform`, `box-shadow` | Box-shadow is medium cost; be sparing |
| Tooltip show | 150 ms | linear | `onMouseEnter` | `opacity`, `transform` | Very fast, easing imperceptible |
| Modal enter | 300 ms | ease-out | Dialog open | `scale`, `opacity` | Consider anticipation on trigger |
| Drawer slide | 350 ms | Spring | Gesture / toggle | `translateY`, `opacity` | Spring handles interruption naturally |
| Accordion expand | 250 ms | ease-in-out | Click | `height`, `opacity` | Use JS to measure or Framer Motion `layoutId` |
| Tab switch | 200 ms | linear | Click | `opacity` | Use `AnimatePresence` for exit |
| List add | 200 ms | ease-out | Create | `opacity`, `translateY` | Stagger at 50–100 ms |
| List remove | 200 ms | ease-in | Delete | `opacity`, `translateX`, `height` | Use `AnimatePresence` for exit |
| Skeleton load | 2 s | linear | Data fetch | `background-position` (shimmer) | Disable under `prefers-reduced-motion` |
| Form error | 400 ms | ease-in-out | Validation fail | `translateX` (shake) | 2–3 cycles; don't overuse |
| Progress (indeterminate) | 1.5 s | ease-in-out | Loading | `translateX` | Continuous, looped |
| Toggle switch | 200 ms | Spring | Click | `left` (prefer `transform`), `backgroundColor` | Spring feels more responsive |
| Page fade | 200 ms | linear | Route change | `opacity` | Shorter for perceived speed |
| Success celebration | 400–600 ms | Spring with bounce | Action complete | `scale`, `opacity`, `rotate` | Overshoot is acceptable here |

---

## System References & Further Reading

### Design Systems

- **Material Design 3 Motion**: [https://m3.material.io/styles/motion](https://m3.material.io/styles/motion)
  - Official tokens, transition patterns, and choreography guidelines.
  - Consult for authoritative easing and duration values.

- **Apple Human Interface Guidelines (Motion)**: [https://developer.apple.com/design/human-interface-guidelines/motion](https://developer.apple.com/design/human-interface-guidelines/motion)
  - iOS, macOS, watchOS motion principles and expected durations.

### Performance & Web Standards

- **web.dev Animation Performance Guide**: [https://web.dev/articles/animations-guide](https://web.dev/articles/animations-guide)
  - Frame budget, property costs, DevTools debugging.

- **web.dev prefers-reduced-motion**: [https://web.dev/articles/prefers-reduced-motion](https://web.dev/articles/prefers-reduced-motion)
  - Accessibility best practices and implementation patterns.

- **MDN Web Docs - Animation Performance**: [https://developer.mozilla.org/en-US/docs/Web/Performance/Animation_performance_and_frame_rate](https://developer.mozilla.org/en-US/docs/Web/Performance/Animation_performance_and_frame_rate)
  - Technical details on frame rates, jank diagnosis, and optimization.

- **MDN - prefers-reduced-motion**: [https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion)
  - CSS media query syntax and browser support.

### Interactive Tools

- **Cubic Bezier Visualizer**: [https://cubic-bezier.com](https://cubic-bezier.com)
  - Test custom easing curves interactively. Adjust Y-values to create bounce/overshoot.

- **Spring Physics Playground**: [https://www.framer.com/motion/examples/](https://www.framer.com/motion/examples/)
  - Framer Motion examples with live spring parameter tuning.

### Libraries & Frameworks

- **Framer Motion**: [https://www.framer.com/motion](https://www.framer.com/motion)
  - React animation library with springs, keyframes, and gesture support.

- **React Spring**: [https://www.react-spring.dev](https://www.react-spring.dev)
  - Alternative React spring physics library; powerful for complex choreography.

- **Web Animations API**: [https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API)
  - Native browser animation API (JavaScript) for low-level control.

### Disney's 12 Principles of Animation

- **Original reference**: Disney Animation: The Illusion of Life (Frank Thomas & Ollie Johnston, 1981)
- **Modern web adaptation**: [https://www.uxmovement.com/ux-design/the-12-principles-of-motion-design/](https://www.uxmovement.com/ux-design/the-12-principles-of-motion-design/)

---

## Gotchas & Common Mistakes

> **Gotcha: Animating `height: auto` in CSS**
>
> CSS transitions do not interpolate `auto` values. `height: 0 → height: auto` appears instant. Solutions:
> 1. Use Framer Motion's `layoutId` and `AnimatePresence`.
> 2. Measure the content height in JS and animate to that pixel value.
> 3. Use `max-height` instead of `height` (less precise but works).

> **Gotcha: Spring interruption in Framer Motion**
>
> If you change the target `animate` value while a spring animation is in progress, Framer Motion will smoothly reverse and re-target. This is intentional and usually desirable (see "Interruptibility" section). If you want animations to "snap" without reversing, use `transition={{ type: 'tween', duration: 0 }}` to skip animation entirely.

> **Gotcha: `will-change` performance burden**
>
> Adding `will-change: transform` on every animated element doesn't help—it actually harms performance by creating unnecessary GPU layers. Use `will-change` sparingly, **only after DevTools reveals actual performance problems**. Browsers are smart about promoting animated elements to layers automatically.

> **Gotcha: Animation fires before DOM is ready**
>
> If a Framer Motion animation's initial state references a DOM measurement (e.g., `initial={{ y: element.offsetHeight }}`), and the element hasn't laid out yet, the measurement is wrong. Use `layoutDependency` or a `useEffect` to trigger animations after layout.

> **Gotcha: `prefers-reduced-motion` in Framer Motion**
>
> Framer Motion respects `prefers-reduced-motion` **only if you explicitly opt in**. Wrap your animations in a `useReducedMotion()` check:
>
> ```javascript
> const prefersReducedMotion = useReducedMotion();
> <motion.div
>   animate={{ opacity: 1 }}
>   transition={prefersReducedMotion ? { duration: 0 } : { duration: 0.3 }}
> />
> ```

> **Gotcha: Parallax and vestibular safety**
>
> Parallax (background moving at a different speed) can trigger motion sickness if the offset ratio exceeds 5–10%. Keep parallax subtle: offset the background by no more than 2–3% of viewport height. For example, if the user scrolls 100px, move the background only 2–3px.

> **Gotcha: Animating element exits without `AnimatePresence`**
>
> In Framer Motion, if you remove an element from the DOM immediately after setting `animate={{ opacity: 0 }}`, the element disappears before the animation plays. Wrap the conditional in `AnimatePresence` to let the exit animation complete before unmounting:
>
> ```javascript
> <AnimatePresence>
>   {showElement && <motion.div exit={{ opacity: 0 }} />}
> </AnimatePresence>
> ```

> **Gotcha: Animation library bundle size**
>
> Framer Motion is ~40 KB (gzipped), React Spring is ~30 KB. For performance-critical apps, consider CSS animations or Web Animations API instead. Measure the impact on your Lighthouse score before choosing a library.

> **Gotcha: Hot reload with extracted spring configs**
>
> If you extract spring parameters into a separate config file and import it, some dev servers (Vite, Next.js) may not hot-reload the animation when you edit the config. Use inline springs or a dev-specific workaround (e.g., environment variable to toggle animations).

---

## Summary: Motion Design in 30 Seconds

1. **Easing:** Use ease-out for entries, ease-in for exits, ease-in-out for reversibles. Avoid pure linear unless it's continuous.
2. **Duration:** 100–200 ms for micro-interactions, 200–300 ms for standard transitions, 300–500 ms for complex choreography.
3. **Spring Physics:** Prefer springs over tweens. Stiffness 300–400 is snappy; 100–150 is floaty.
4. **Choreography:** Stagger multiple elements at 50–100 ms intervals. Lead with a primary motion; let secondaries follow.
5. **Performance:** Animate only `transform` and `opacity`. Never animate `width`, `height`, `left`, `top`, or `margin`.
6. **Accessibility:** Respect `prefers-reduced-motion`. Remove decorative animations; preserve essential feedback.
7. **Disney Principles:** Apply squash/stretch, anticipation, follow-through, and solid drawing to UI. Motion should feel weighty and intentional.
8. **Testing:** Use Chrome DevTools Performance tab to verify 60 FPS. Check mobile at 1x CPU throttle.

---

**Document Version:** 1.0 (2026-06-14)  
**Last Updated:** 2026-06-14  
**License:** Internal Reference (ProfitSync)
