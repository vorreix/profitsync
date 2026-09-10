# Motion Definitive Production Reference

The definitive guide to **Motion** (the successor to Framer Motion, now `motion` package v11+) for React 19, TypeScript, and production systems.

> **Package Info:** The package is now called `motion` (not `framer-motion`). Install via `npm install motion`. Main React import: `motion/react`. Vanilla JS imports: `motion/mini` or `motion/dom`.

---

## Table of Contents

1. [Package & Setup](#package--setup)
2. [Motion Components](#motion-components)
3. [Transitions](#transitions)
4. [Variants & Orchestration](#variants--orchestration)
5. [AnimatePresence & Exit Animations](#animatepresence--exit-animations)
6. [Gestures](#gestures)
7. [Layout Animations](#layout-animations)
8. [Motion Values](#motion-values)
9. [Hooks](#hooks)
10. [Scroll Animations](#scroll-animations)
11. [Vanilla Motion](#vanilla-motion)
12. [MotionConfig & Global Settings](#motionconfig--global-settings)
13. [Bundle Optimization](#bundle-optimization)
14. [Performance](#performance)
15. [Accessibility](#accessibility)
16. [TypeScript Reference](#typescript-reference)
17. [Production Gotchas](#production-gotchas)
18. [Quick Start Recipe](#quick-start-recipe)

---

## Package & Setup

### Installation & Imports

```bash
npm install motion
```

**React imports:**

```typescript
import { motion } from "motion/react"
import { AnimatePresence } from "motion/react"
import * as m from "motion/react-m"  // Slimmer component for LazyMotion
import { LazyMotion, domAnimation, domMax } from "motion/react"
```

**Vanilla JS imports:**

```typescript
import { animate, spring, stagger, inView } from "motion"  // motion/mini or motion/dom
import { scroll } from "motion"
```

**React 19 Server Components:** Motion components must be client-rendered. Wrap root in `'use client'` or use `useTransition()` + `startTransition()` for imperative animations triggered by async data.

**TypeScript:** Full type definitions are included. Import types for variant/transition definitions:

```typescript
import type { TargetAndTransition, VariantLabels } from "motion/react"
```

---

## Motion Components

### Basic Animated Elements

Motion wraps every HTML element:

```typescript
<motion.div
  initial={{ opacity: 0 }}
  animate={{ opacity: 1 }}
  exit={{ opacity: 0 }}
  transition={{ duration: 0.5 }}
>
  Animated content
</motion.div>
```

**All standard HTML elements are available:** `motion.div`, `motion.button`, `motion.p`, `motion.h1`, `motion.input`, etc.

**SVG elements:**

```typescript
<motion.svg width={200} height={200}>
  <motion.path
    d="M10 10 L100 100"
    stroke="black"
    initial={{ pathLength: 0 }}
    animate={{ pathLength: 1 }}
  />
  <motion.circle
    cx={50}
    cy={50}
    r={40}
    initial={{ scale: 0 }}
    animate={{ scale: 1 }}
  />
</motion.svg>
```

### Animatable Properties

**Transform properties:** `x`, `y`, `z`, `rotateX`, `rotateY`, `rotateZ`, `skewX`, `skewY`, `scale`, `scaleX`, `scaleY`, `scaleZ` (GPU-accelerated)

**Visual properties:** `opacity`, `filter`, `backdropFilter`, `WebkitBackdropFilter`

**Colors & fills:** `color`, `backgroundColor`, `borderColor`, `fill`, `stroke`, `textShadow`, `boxShadow`

**Dimensions:** `width`, `height`, `minWidth`, `maxWidth`, `minHeight`, `maxHeight`, `padding`, `margin`

**SVG-specific:** `cx`, `cy`, `r`, `rx`, `ry`, `pathLength`, `offset`, `strokeDasharray`, `strokeDashoffset`, `strokeLinecap`, `strokeLinejoin`

**CSS Variables:** Use in template strings:

```typescript
<motion.div
  animate={{ "--my-var": "100px" } as any}
  style={{ transform: "translateX(var(--my-var))" }}
/>
```

**Box shadow:** Animate multi-layer shadows:

```typescript
animate={{
  boxShadow: "0 10px 30px rgba(0,0,0,0.5), 0 0 10px rgba(255,0,0,0.5)"
}}
```

**Gradients:** Animate gradient stops (requires color interpolation):

```typescript
animate={{
  background: "linear-gradient(to right, #ff0000, #0000ff)"
}}
```

### Custom Components

**Method 1: Motion component wrapper**

```typescript
const CustomButton = motion(React.forwardRef((props, ref) => (
  <button ref={ref} {...props} />
)))

<CustomButton animate={{ scale: 1.2 }} />
```

**Method 2: `motion.create()` for type-safe custom components**

```typescript
const StyledDiv = motion.create("div", {
  // Optional: define display/layout defaults
})

<StyledDiv animate={{ rotate: 360 }} />
```

---

## Transitions

### Transition Types

**1. Tween (default) — linear or eased time-based**

```typescript
transition={{
  type: "tween",
  duration: 0.8,
  ease: "easeInOut",  // Also: "linear", "easeIn", "easeOut", "circInOut", etc.
  delay: 0.2,
  repeat: 2,          // Number of additional repetitions
  repeatDelay: 0.5,   // Delay between repeats
  repeatType: "reverse" // "loop" or "mirror" (reverse)
}}
```

**2. Spring — physics-based with bounce**

```typescript
transition={{
  type: "spring",
  stiffness: 100,      // 1-1000 (higher = faster, stiffer)
  damping: 10,         // 0-1000 (higher = less bouncy)
  mass: 1,             // 0.1-1000
  velocity: 0,         // Initial velocity in px/ms
  duration: 1,         // Overrides spring physics, creates timed spring
  bounce: 0.3,         // 0-1 (higher = more bounce)
}}
```

**Spring presets:**

```typescript
// Light spring
transition={{ type: "spring", bounce: 0.3 }}

// Stiff spring
transition={{ type: "spring", stiffness: 400, damping: 40 }}

// Slow spring
transition={{ type: "spring", stiffness: 50, damping: 20 }}
```

**3. Inertia — momentum-based deceleration (primarily for drag)**

```typescript
transition={{
  type: "inertia",
  velocity: 10,        // Initial velocity
  power: 0.8,          // 0-1 (higher = travels further)
  timeConstant: 300,   // Milliseconds
  restDelta: 2,        // Pixel delta below which motion stops
  modifyTarget: (v) => Math.round(v / 50) * 50  // Snap to grid
}}
```

**4. Keyframes — animation over multiple waypoints**

```typescript
animate={{
  x: [0, 100, -100, 0],  // Array = keyframes
  rotate: [0, 180, 360]
}}
transition={{
  duration: 2,
  times: [0, 0.3, 0.7, 1],  // Keyframe positions (0-1)
  ease: "easeInOut"         // Applied to all segments
}}
```

Or with per-keyframe easing:

```typescript
animate={{ x: [0, 100, 50] }}
transition={{
  x: {
    times: [0, 0.5, 1],
    ease: ["easeIn", "easeOut"]  // One less than keyframes
  }
}}
```

### Easing Functions

**Built-in easings:**

```typescript
"linear" | "easeIn" | "easeOut" | "easeInOut" |
"circIn" | "circOut" | "circInOut" |
"backIn" | "backOut" | "backInOut" |
"anticipate" |
"elasticIn" | "elasticOut" | "elasticInOut"
```

**Cubic-Bezier:**

```typescript
ease: [0.17, 0.67, 0.83, 0.67]  // [x1, y1, x2, y2]
```

**CSS `linear()` function (custom curve):**

```typescript
ease: "linear(0, 0.25 25%, 1 100%)"  // Piecewise-linear curve
```

### Per-Value Transitions

```typescript
transition={{
  default: { duration: 1 },
  x: { duration: 0.5, ease: "easeOut" },
  opacity: { delay: 0.3, duration: 0.2 }
}}
```

---

## Variants & Orchestration

### Variant Definitions

**Basic variants:**

```typescript
const variants = {
  hidden: { opacity: 0, y: -20 },
  visible: { opacity: 1, y: 0 },
  hovered: { scale: 1.1 }
}

<motion.div
  initial="hidden"
  animate="visible"
  whileHover="hovered"
  variants={variants}
/>
```

**With transitions:**

```typescript
const variants = {
  hidden: {
    opacity: 0,
    y: -20,
    transition: { duration: 0.2 }
  },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: "easeOut" }
  }
}
```

### Parent-Child Propagation

Child elements automatically inherit parent's variant name:

```typescript
const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 }
}

const itemVariants = {
  hidden: { opacity: 0, x: -20 },
  visible: { opacity: 1, x: 0 }
}

<motion.div
  variants={containerVariants}
  initial="hidden"
  animate="visible"
>
  {items.map((item) => (
    <motion.div key={item.id} variants={itemVariants}>
      {item.name}
    </motion.div>
  ))}
</motion.div>
```

### Sequencing with `delayChildren` & `staggerChildren`

```typescript
const containerVariants = {
  visible: {
    transition: {
      delayChildren: 0.1,        // Delay before first child
      staggerChildren: 0.2,      // Delay between children
      staggerDirection: -1       // 1 = forward, -1 = backward
    }
  }
}

<motion.div
  variants={containerVariants}
  initial="hidden"
  animate="visible"
>
  {/* Children stagger in sequence */}
</motion.div>
```

### Dynamic Variants

```typescript
const variants = {
  visible: (direction) => ({
    opacity: 1,
    x: direction === "left" ? 100 : -100,
    transition: { delay: 0.2 }
  }),
  hidden: { opacity: 0, x: 0 }
}

<motion.div
  variants={variants}
  initial="hidden"
  animate="visible"
  custom="left"  // Passed to variant function
/>
```

---

## AnimatePresence & Exit Animations

### Exit Animations

```typescript
import { AnimatePresence } from "motion/react"

<AnimatePresence>
  {isVisible && (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      key="modal"
    >
      Modal content
    </motion.div>
  )}
</AnimatePresence>
```

**Critical: Elements exiting must have a `key` prop.** Without it, React removes the component before Motion can animate the exit.

### `AnimatePresence` Props

```typescript
<AnimatePresence
  mode="wait"              // "wait" | "sync" | "popLayout"
  initial={false}         // Skip initial animations (for mounts)
  onExitComplete={() => {}}  // Callback when all exits finish
>
  {/* Children */}
</AnimatePresence>
```

**`mode` options:**

- **`"wait"`** (default) — Exit animation completes before entering animation begins. Use for sequential transitions (modals, pages).
- **`"sync"`** — Entry and exit happen simultaneously. Use for parallel animations.
- **`"popLayout"`** — Exiting elements pop out of layout (siblings don't shift). Use for overlays, toasts.

### Route Transitions

```typescript
function App() {
  const location = useLocation()

  return (
    <AnimatePresence mode="wait">
      <Routes location={location} key={location.pathname}>
        <Route path="/" element={<HomePage />} />
        <Route path="/about" element={<AboutPage />} />
      </Routes>
    </AnimatePresence>
  )
}
```

Wrap your route component with motion and add `exit` animations.

### List Item Removal with Animation

```typescript
const [items, setItems] = useState([...])

const removeItem = (id) => {
  setItems((prev) => prev.filter((item) => item.id !== id))
}

<AnimatePresence>
  {items.map((item) => (
    <motion.div
      key={item.id}
      initial={{ opacity: 0, x: -100 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 100, height: 0 }}
      transition={{ layout: { duration: 0.3 } }}
    >
      {item.name}
      <button onClick={() => removeItem(item.id)}>Delete</button>
    </motion.div>
  ))}
</AnimatePresence>
```

---

## Gestures

### Basic Gestures

**Hover:**

```typescript
<motion.button whileHover={{ scale: 1.1 }}>
  Hover me
</motion.button>
```

**Tap/Click:**

```typescript
<motion.div whileTap={{ scale: 0.95 }}>
  Click me
</motion.div>
```

**Focus:**

```typescript
<motion.input whileFocus={{ scale: 1.05, borderColor: "#0066ff" }} />
```

**In-view (scroll trigger):**

```typescript
<motion.div
  initial={{ opacity: 0, y: 50 }}
  whileInView={{ opacity: 1, y: 0 }}
  viewport={{ once: true, amount: 0.5 }}  // Trigger when 50% in view
>
  Revealed on scroll
</motion.div>
```

### In-View Options

```typescript
viewport={{
  once: true,              // Animate only once (don't re-trigger on scroll back)
  amount: 0.5,            // Portion of element in view: 0-1 or "some" | "all"
  margin: "100px"         // Expand viewport by margin (positive = trigger earlier)
}}
```

### Drag System

**Basic drag:**

```typescript
<motion.div drag>
  Drag me
</motion.div>
```

**Constrained drag:**

```typescript
<motion.div
  drag
  dragConstraints={{ top: 0, bottom: 100, left: 0, right: 100 }}
  dragElastic={0.2}      // Elasticity: 0-1 (0 = rigid, 1 = bouncy)
  dragMomentum={true}    // Inertia after release
  dragTransition={{
    type: "spring",
    stiffness: 300,
    damping: 30,
    mass: 1
  }}
>
  Constrained drag
</motion.div>
```

**Drag with ref constraint:**

```typescript
const constraintRef = useRef(null)

<motion.div ref={constraintRef}>
  <motion.div drag dragConstraints={constraintRef}>
    Drag within parent
  </motion.div>
</motion.div>
```

**Drag on single axis:**

```typescript
<motion.div drag="x" />  // Only horizontal
<motion.div drag="y" />  // Only vertical
```

### Drag Callbacks

```typescript
<motion.div
  drag
  onDragStart={(event, info) => console.log("drag started")}
  onDrag={(event, info) => console.log(info.offset.x)}
  onDragEnd={(event, info) => console.log("drag ended")}
/>
```

**`info` object:** `{ offset: { x, y }, velocity: { x, y }, point: { x, y }, delta: { x, y } }`

### `useDragControls()` for Imperative Drag

```typescript
const controls = useDragControls()

<motion.div drag dragControls={controls}>
  Drag me
</motion.div>

<button onClick={() => controls.start(event)}>
  Trigger drag
</button>
```

---

## Layout Animations

### The `layout` Prop

```typescript
<motion.div layout>
  {/* Size/position changes animate automatically */}
</motion.div>
```

**With transition control:**

```typescript
<motion.div
  layout
  transition={{ type: "spring", bounce: 0.3 }}
>
  Responsive content
</motion.div>
```

### `layoutId` for Shared Element Transitions

```typescript
{isExpanded ? (
  <motion.div
    layoutId="shape"
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
  >
    Expanded
  </motion.div>
) : (
  <motion.div layoutId="shape">
    Collapsed
  </motion.div>
)}
```

### `LayoutGroup` for Coordinated Layout Animations

```typescript
<LayoutGroup id="drawer">
  {isOpen && (
    <motion.div layout>
      Drawer content shifts siblings
    </motion.div>
  )}
  <motion.div layout>
    Other content
  </motion.div>
</LayoutGroup>
```

### Preventing Child Distortion with Layout Animations

When a parent's size changes, children are stretched. Use `layout` on children to prevent distortion:

```typescript
<motion.div layout>
  <motion.div layout>
    {/* Child animates its own layout instead of being stretched */}
  </motion.div>
</motion.div>
```

### Scroll-Corrected Layout Animations

For layout changes that occur during scroll, pass a ref:

```typescript
const ref = useRef(null)

<motion.div
  layout
  layoutScroll
  ref={ref}
>
  Content
</motion.div>
```

---

## Motion Values

### `useMotionValue()`

Create a motion value without triggering re-renders:

```typescript
const x = useMotionValue(0)

<motion.div style={{ x }}>
  {/* Animate x */}
</motion.div>

// Update imperatively
x.set(100)

// Read the value
console.log(x.get())
```

### Motion Value Listeners

```typescript
const x = useMotionValue(0)

useEffect(() => {
  return x.on("change", (latest) => {
    console.log("x changed to:", latest)
  })
}, [x])
```

**Other events:**

```typescript
x.on("animationStart", () => {})
x.on("animationComplete", () => {})
```

### `useTransform()` for Range Mapping

```typescript
const x = useMotionValue(0)
const opacity = useTransform(x, [0, 100], [0, 1])

// Map x (0-100) to opacity (0-1)
// Outside range: clamp by default
```

**With custom interpolation:**

```typescript
const color = useTransform(x, [0, 50, 100], ["blue", "purple", "red"])
```

**Without clamping (cycle behavior):**

```typescript
const rotate = useTransform(x, [0, 100], [0, 360], { clamp: false })
// x=150 → rotate=540° (continues beyond end)
```

### `useSpring()` for Smoothed Motion Values

```typescript
const scrollY = useMotionValue(0)
const smoothScrollY = useSpring(scrollY, {
  damping: 20,
  stiffness: 300,
  skipInitialAnimation: true  // Jump to initial value (useful for scroll tracking)
})

<motion.div style={{ y: smoothScrollY }} />
```

### `useScroll()` for Scroll-Linked Animations

**Basic usage (returns normalized 0-1 values):**

```typescript
const { scrollY, scrollYProgress, scrollX, scrollXProgress } = useScroll()

// scrollYProgress: 0 = top of page, 1 = bottom
<motion.div style={{ scaleX: scrollYProgress }} />
```

**With container/target refs (pixel-based values):**

```typescript
const containerRef = useRef(null)
const targetRef = useRef(null)

const { scrollY } = useScroll({
  container: containerRef,  // Track scroll in this container (default: window)
  target: targetRef         // Or track progress of this element within container
})

// scrollY is in pixels relative to the container's scroll

const rotate = useTransform(scrollY, [0, 1000], [0, 360])

<div ref={containerRef} style={{ overflow: "auto", height: "100vh" }}>
  <motion.div ref={targetRef} style={{ rotate }} />
</div>
```

> **Gotcha:** `useScroll()` without `container` and `target` returns **normalized progress** (0-1). With `container`/`target`, it returns **pixel values**. Adjust your `useTransform()` ranges accordingly.

### `useMotionTemplate()` for Dynamic CSS Values

```typescript
const x = useMotionValue(0)
const y = useMotionValue(0)

const transform = useMotionTemplate`translate(${x}px, ${y}px)`

<motion.div style={{ transform }} />
```

---

## Hooks

### `useAnimate()` for Imperative Animation Sequences

```typescript
const [scope, animate] = useAnimate()

const runSequence = async () => {
  await animate(scope.current, { opacity: 1 })
  await animate("button", { scale: 1.1 }, { delay: 0.2 })
  await animate(".item", { y: 100 }, { stagger: 0.1 })
}

<div ref={scope}>
  <button>Click</button>
  <div className="item">Item 1</div>
  <div className="item">Item 2</div>
</div>
```

**Sequence syntax:**

```typescript
await animate([
  [scope.current, { opacity: 1 }, { duration: 0.5 }],
  ["button", { scale: 1.1 }],
  [".item", { y: 100 }, { stagger: 0.1 }]
])
```

### `useInView()` for Visibility Tracking

```typescript
const ref = useRef(null)
const isInView = useInView(ref, { once: true })

<motion.div
  ref={ref}
  animate={isInView ? { opacity: 1 } : { opacity: 0 }}
>
  Content
</motion.div>
```

### `useReducedMotion()` for Accessibility

```typescript
const prefersReducedMotion = useReducedMotion()

<motion.div
  animate={{ x: prefersReducedMotion ? 0 : 100 }}
  transition={prefersReducedMotion ? { duration: 0 } : {}}
>
  Conditional animation
</motion.div>
```

### `useMotionValueEvent()` for Reactive Updates

```typescript
const x = useMotionValue(0)

useMotionValueEvent(x, "change", (latest) => {
  console.log("x is now:", latest)
})
```

### `useVelocity()` for Speed Tracking

```typescript
const x = useMotionValue(0)
const velocity = useVelocity(x)

useEffect(() => {
  return velocity.on("change", (v) => {
    console.log("x is moving at", v, "px/ms")
  })
}, [velocity])
```

### `useTime()` for Animation Progress

```typescript
const time = useTime()
const progress = useTransform(time, [0, 3000], [0, 1])  // 3 second animation

<motion.div style={{ opacity: progress }} />
```

---

## Scroll Animations

### Scroll-Triggered Animations (Not Scroll-Linked)

Use `whileInView` to animate when element enters viewport:

```typescript
<motion.div
  initial={{ opacity: 0, y: 50 }}
  whileInView={{ opacity: 1, y: 0 }}
  viewport={{ once: true, amount: 0.5 }}
>
  Reveals on scroll
</motion.div>
```

### Scroll-Linked Animations (Driven by Scroll Position)

Use `useScroll()` + `useTransform()`:

```typescript
const { scrollYProgress } = useScroll()

// Scale based on scroll progress
<motion.div style={{ scale: scrollYProgress }} />

// Rotate based on pixel scroll
const { scrollY } = useScroll()
const rotate = useTransform(scrollY, [0, 500], [0, 360], { clamp: false })

<motion.div style={{ rotate }} />
```

### Parallax Effect

```typescript
const { scrollY } = useScroll()

// Different elements move at different rates
const y1 = useTransform(scrollY, [0, 1000], [0, 100])
const y2 = useTransform(scrollY, [0, 1000], [0, -100])

<motion.div style={{ y: y1 }}>Layer 1</motion.div>
<motion.div style={{ y: y2 }}>Layer 2</motion.div>
```

### Progress Bar Linked to Scroll

```typescript
const { scrollYProgress } = useScroll()

<motion.div
  style={{
    scaleX: scrollYProgress,
    transformOrigin: "0%",
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    height: 4,
    backgroundColor: "#0066ff"
  }}
/>
```

### Container-Scoped Scroll Tracking

```typescript
const containerRef = useRef(null)
const { scrollYProgress } = useScroll({
  container: containerRef
})

<div ref={containerRef} style={{ overflow: "auto", height: "100vh" }}>
  <motion.div style={{ scaleX: scrollYProgress }} />
</div>
```

---

## Vanilla Motion

Use Motion without React via `motion/mini` or `motion/dom`:

### `animate()` Function

```typescript
import { animate } from "motion"

// Animate a single element
animate(element, { opacity: 1, y: -100 }, { duration: 0.5 })

// Animate with spring
animate(element, { x: 100 }, {
  type: "spring",
  stiffness: 300,
  damping: 30
})

// Animate with custom easing
animate(
  element,
  { rotate: 360 },
  { duration: 1, ease: "easeInOut" }
)
```

### Sequences (Vanilla)

```typescript
import { animate, stagger } from "motion"

const sequence = [
  [".item", { opacity: 1 }, { duration: 0.5 }],
  [".item", { y: 100 }, { duration: 0.3 }],
  [".title", { scale: 1.2 }, { at: 0.2 }]  // Relative timing
]

animate(sequence)
```

### `stagger()` for Sequential Animation

```typescript
animate(
  ".item",
  { opacity: 1, y: 0 },
  {
    delay: stagger(0.1),  // 0.1s between each element
    duration: 0.5
  }
)
```

### `spring()` Function

```typescript
import { spring } from "motion"

animate(
  element,
  { x: 100 },
  {
    type: spring,
    bounce: 0.3
  }
)
```

### `scroll()` for Scroll-Linked Animations (Vanilla)

```typescript
import { scroll } from "motion"

scroll(({ y }) => {
  // y is normalized 0-1
  element.style.opacity = y
}, {
  target: document.querySelector("#container"),
  offset: ["start", "end"]  // When to measure
})
```

### `inView()` for Scroll Triggers (Vanilla)

```typescript
import { inView } from "motion"

inView(".item", ({ target }) => {
  animate(target, { opacity: 1, y: 0 })
})
```

---

## MotionConfig & Global Settings

### Global Animation Defaults

```typescript
import { MotionConfig } from "motion/react"

<MotionConfig transition={{ duration: 0.3, ease: "easeInOut" }}>
  {/* All motion components use these defaults */}
  <motion.div animate={{ x: 100 }} />
</MotionConfig>
```

### Accessibility via `MotionConfig`

```typescript
<MotionConfig reducedMotion="user">
  {/* All animations respect prefers-reduced-motion */}
</MotionConfig>
```

**Options** (`reducedMotion` defaults to **`"never"`** — you must opt in):

- `"user"` — respect the OS `prefers-reduced-motion` setting
- `"always"` — force reduced motion (useful for debugging)
- `"never"` — ignore the setting (**default**)

**Effect** (when reduced motion is active): Motion disables **transform and layout** animations, while **preserving** `opacity`, `backgroundColor`, and `color` (the non-vestibular values).

```tsx
// Under <MotionConfig reducedMotion="user"> with the user preferring reduced motion:
<motion.div animate={{ x: 100 }} />     // ← transform: SKIPPED (jumps to final)
<motion.div animate={{ opacity: 1 }} /> // ← opacity: still animates (safe)
```

> **Gotcha:** `reducedMotion` is **opt-in** — set `"user"` at the app root or nothing reduces. And it only auto-handles transform/layout; if a movement is encoded another way, gate it yourself with `useReducedMotion()` and swap to an opacity/instant alternative (see the `useReducedMotion` recipe above).

---

## Bundle Optimization

### LazyMotion for Code Splitting

Import features on-demand to reduce initial bundle:

```typescript
import { LazyMotion, domAnimation, m } from "motion/react"

export function App() {
  return (
    <LazyMotion features={domAnimation}>
      <m.div animate={{ opacity: 1 }} />
    </LazyMotion>
  )
}
```

**Feature sets:**

- **`domAnimation`** — +15kb (gzip) / ~18kb raw
  - Animations, transitions, variants, exit animations
  - Tap, hover, focus gestures
  - No drag or layout animations

- **`domMax`** — +25kb (gzip) / ~40kb raw
  - Everything in `domAnimation` +
  - Pan/drag gestures
  - Layout animations (`layout` prop, `layoutId`)
  - Shared element transitions

### Without LazyMotion (Full Features)

```typescript
import { motion } from "motion/react"

// Bundled with all features (~34kb)
// Use when you need all features in the initial bundle
```

### Asynchronous Feature Loading

```typescript
import { LazyMotion, domAnimation, m } from "motion/react"

<LazyMotion
  features={domAnimation}
  strict  // Throw if you use unsupported features
>
  <m.div animate={{ opacity: 1 }} />
</LazyMotion>
```

### Slimmer Component with `motion/react-m`

```typescript
import * as m from "motion/react-m"
import { LazyMotion, domAnimation } from "motion/react"

<LazyMotion features={domAnimation}>
  <m.div animate={{ x: 100 }} />  // Slimmer component
</LazyMotion>
```

The `m` component is smaller than `motion` because it requires features to be loaded via LazyMotion.

> **Key Savings:** Using `LazyMotion` + `domAnimation` reduces initial bundle from ~34kb to ~4.6kb for motion functionality. Load `domMax` only if you need drag or layout animations.

---

## Performance

### GPU-Accelerated Properties (Use These)

Always animate these properties — they don't trigger reflows:

- `x`, `y`, `z`, `scale`, `scaleX`, `scaleY`, `scaleZ`
- `rotate`, `rotateX`, `rotateY`, `rotateZ`
- `skewX`, `skewY`
- `opacity`

```typescript
// Fast — GPU accelerated
<motion.div animate={{ x: 100, opacity: 0.5 }} />
```

### Avoid Animating (Layout Thrashing)

These trigger reflows and should rarely be animated:

- `width`, `height`, `padding`, `margin`, `top`, `left`, `right`, `bottom`
- Use `layout` prop instead for automatic smart layout animations
- Or transform-based positioning with `x`/`y`

```typescript
// Slow — triggers layout recalculation
<motion.div animate={{ width: 200, height: 200 }} />

// Better — use layout animations or transform
<motion.div layout animate={{ scale: 1.2 }} />
```

### Motion Values Don't Cause Re-renders

Use `useMotionValue()` to animate without triggering React re-renders:

```typescript
const x = useMotionValue(0)

// Updating x doesn't re-render parent
useEffect(() => {
  x.set(100)
}, [])

// Component only re-renders on prop changes
<motion.div style={{ x }} />
```

### Debounce Expensive Operations

```typescript
const x = useMotionValue(0)

useEffect(() => {
  let timeout
  return x.on("change", (latest) => {
    clearTimeout(timeout)
    timeout = setTimeout(() => {
      console.log("Expensive operation:", latest)
    }, 100)
  })
}, [x])
```

### Precompute Calculations

```typescript
// Bad — calculated on every animation frame
<motion.div animate={{ x: window.innerWidth * 0.5 }} />

// Good — precompute
const maxX = useMemo(() => window.innerWidth * 0.5, [])
<motion.div animate={{ x: maxX }} />
```

---

## Accessibility

### Respecting Reduced Motion Preferences

```typescript
const prefersReducedMotion = useReducedMotion()

<motion.div
  animate={{ x: prefersReducedMotion ? 0 : 100 }}
  transition={prefersReducedMotion ? { duration: 0 } : {}}
>
  Content
</motion.div>
```

**Or use `MotionConfig`:**

```typescript
<MotionConfig reducedMotion="user">
  {/* All child animations respect OS preference */}
</MotionConfig>
```

### Vestibular & Photosensitivity Considerations

- Avoid fast, flickering animations (< 300ms cycles)
- Avoid strobing effects (flashing > 3 times per second)
- Use `useReducedMotion()` to disable motion for sensitive users
- Keep animations smooth and predictable (spring > strobing)

### Keyboard Navigation with Animations

```typescript
<motion.div
  whileFocus={{ scale: 1.05 }}
  tabIndex={0}
>
  Keyboard-accessible animated button
</motion.div>
```

### Aria Labels for Animated Content

```typescript
<motion.div
  animate={{ opacity: 1 }}
  role="status"
  aria-live="polite"
  aria-label="Loading..."
>
  {isLoading && <Spinner />}
</motion.div>
```

---

## TypeScript Reference

### Type Definitions

```typescript
import type {
  TargetAndTransition,
  Variant,
  VariantLabels,
  Transition,
  MotionValue,
  SpringOptions,
  TweenOptions,
  InertiaOptions,
  LayoutProps
} from "motion/react"
```

### Variant Types

```typescript
type Variants = {
  [variantName: string]: TargetAndTransition | ((custom?: any) => TargetAndTransition)
}

const variants: Variants = {
  hidden: { opacity: 0 },
  visible: (direction) => ({
    opacity: 1,
    transition: { delay: direction * 0.1 }
  })
}
```

### Transition Types

```typescript
type Transition =
  | { type: "tween"; duration?: number; ease?: string; delay?: number }
  | { type: "spring"; stiffness?: number; damping?: number; mass?: number; velocity?: number }
  | { type: "inertia"; power?: number; timeConstant?: number }
```

### Motion Component Props

```typescript
interface MotionProps<T extends HTMLElement = HTMLElement> {
  initial?: TargetAndTransition | VariantLabels
  animate?: TargetAndTransition | VariantLabels
  exit?: TargetAndTransition | VariantLabels
  whileHover?: TargetAndTransition | VariantLabels
  whileTap?: TargetAndTransition | VariantLabels
  whileFocus?: TargetAndTransition | VariantLabels
  whileInView?: TargetAndTransition | VariantLabels
  transition?: Transition
  variants?: Variants
  custom?: any
  key?: string | number
  layout?: boolean | "position" | "size"
  layoutId?: string
  drag?: boolean | "x" | "y"
  dragConstraints?: { top?: number; bottom?: number; left?: number; right?: number } | RefObject<HTMLElement>
  dragElastic?: number
  dragMomentum?: boolean
  dragTransition?: Transition
  onAnimationStart?: () => void
  onAnimationComplete?: () => void
  onDragStart?: (event: MouseEvent, info: DragInfo) => void
  onDrag?: (event: MouseEvent, info: DragInfo) => void
  onDragEnd?: (event: MouseEvent, info: DragInfo) => void
}
```

---

## Production Gotchas

> **1. AnimatePresence requires `key` props**
>
> Elements exiting must have a unique `key`. Without it, React removes the DOM node before Motion can animate the exit.
>
> ```typescript
> // ❌ Wrong — no exit animation
> {isVisible && <motion.div exit={{ opacity: 0 }} />}
>
> // ✅ Correct
> <AnimatePresence>
>   {isVisible && <motion.div key="modal" exit={{ opacity: 0 }} />}
> </AnimatePresence>
> ```

> **2. Layout animations require explicit triggers**
>
> The `layout` prop doesn't automatically animate on every change. Children must be in the same DOM tree and have consistent keys.
>
> ```typescript
> // ❌ Wrong — won't animate
> {showExtra && <motion.div>Extra</motion.div>}
>
> // ✅ Correct
> <motion.div layout>
>   {showExtra && <motion.div key="extra">Extra</motion.div>}
> </motion.div>
> ```

> **3. Tailwind classes conflict with Motion inline styles**
>
> Tailwind's `transform` class adds `transform: translateX(0)`, which conflicts with Motion's `x` value. Remove the class when animating.
>
> ```typescript
> // ❌ Wrong — class overrides x
> <motion.div className="transform" animate={{ x: 100 }} />
>
> // ✅ Correct
> <motion.div animate={{ x: 100 }} />
> ```

> **4. `useScroll()` normalized vs. pixel values**
>
> By default, `useScroll()` returns normalized progress (0-1). With `container` and `target` refs, it returns pixel values. Adjust your `useTransform()` ranges accordingly.
>
> ```typescript
> // Normalized (0-1)
> const { scrollYProgress } = useScroll()
> const scale = useTransform(scrollYProgress, [0, 1], [1, 2])
>
> // Pixel values
> const { scrollY } = useScroll({ container: ref })
> const rotate = useTransform(scrollY, [0, 500], [0, 360])
> ```

> **5. Stagger limitations in nested arrays**
>
> `staggerChildren` doesn't work across multiple levels of nesting. Each parent manages its own children's stagger.
>
> ```typescript
> // ❌ Won't stagger nested items
> <motion.div variants={{ visible: { transition: { staggerChildren: 0.1 } } }}>
>   <motion.div variants={itemVariants}>
>     <motion.div>Nested — won't stagger</motion.div>
>   </motion.div>
> </motion.div>
> ```

> **6. Drag constraints with refs must be the direct parent**
>
> `dragConstraints={ref}` measures the ref's bounding box. If the ref is a distant ancestor, measurements are wrong.
>
> ```typescript
> // ✅ Correct
> <motion.div ref={constraintRef}>
>   <motion.div drag dragConstraints={constraintRef} />
> </motion.div>
>
> // ❌ Wrong — ancestor measurements fail
> <div ref={constraintRef}>
>   <div>
>     <motion.div drag dragConstraints={constraintRef} />
>   </div>
> </div>
> ```

> **7. React 19 Server Components must be `'use client'`**
>
> Motion components render on the client. Wrap in `'use client'` or they'll throw.
>
> ```typescript
> 'use client'
>
> import { motion } from "motion/react"
>
> export function AnimatedButton() {
>   return <motion.button animate={{ scale: 1.1 }} />
> }
> ```

> **8. Imperative `animate()` doesn't wait for `initial` to complete**
>
> When you call `animate()` via `useAnimate()`, it ignores the `initial` prop and animates from the current state.
>
> ```typescript
> const [scope, animate] = useAnimate()
>
> // `initial={{ opacity: 0 }}` is skipped; animate starts from current opacity
> animate(scope.current, { opacity: 1 })
> ```

> **9. Layout animations don't handle children with position: absolute**
>
> Absolutely-positioned children don't participate in FLIP layout measurements. Use relative or static positioning.
>
> ```typescript
> // ❌ Won't animate
> <motion.div layout>
>   <motion.div style={{ position: "absolute" }}>Absolute</motion.div>
> </motion.div>
>
> // ✅ Works
> <motion.div layout>
>   <motion.div>Relative position</motion.div>
> </motion.div>
> ```

> **10. SVG `cx`, `cy` animate as units, not pixels**
>
> `cx` and `cy` on SVG circles/ellipses are SVG coordinate units, not pixels. Scale accordingly.
>
> ```typescript
> <motion.circle
>   cx={50}
>   cy={50}
>   r={20}
>   animate={{ cx: 100, cy: 100 }}  // SVG units
> />
> ```

> **11. `whileInView` requires unique keys for resets**
>
> Without a unique `key`, re-renders may not re-trigger `whileInView` animations.
>
> ```typescript
> // ✅ Correct
> {items.map((item) => (
>   <motion.div
>     key={item.id}
>     whileInView={{ opacity: 1 }}
>   >
>     {item.name}
>   </motion.div>
> ))}
> ```

> **12. Exit animations ignore `layout` prop changes**
>
> During exit, layout changes on the exiting element don't animate. Plan layout shifts on siblings instead.
>
> ```typescript
> // ❌ Wrong — layout change during exit is instant
> <motion.div exit={{ opacity: 0 }} layout>Exit me</motion.div>
>
> // ✅ Better — layout siblings, animate the exiting element's opacity
> <motion.div layout>
>   {items.map((item) => (
>     <motion.div key={item.id} exit={{ opacity: 0 }}>
>       {item.name}
>     </motion.div>
>   ))}
> </motion.div>
> ```

> **13. `useTransform()` with color strings requires matching output array length**
>
> Color interpolation requires matching input and output array lengths.
>
> ```typescript
> // ✅ Correct — 3 inputs, 3 outputs
> const color = useTransform(progress, [0, 0.5, 1], ["blue", "purple", "red"])
>
> // ❌ Wrong — mismatched arrays
> const color = useTransform(progress, [0, 1], ["blue", "purple", "red"])
> ```

> **14. Spring velocity is in units per millisecond, not per second**
>
> The `velocity` parameter in spring transitions is in pixels per millisecond (px/ms), not px/s. A `velocity: 1` means 1 pixel per millisecond.
>
> ```typescript
> transition={{
>   type: "spring",
>   velocity: 2  // 2 px/ms = 2000 px/s
> }}
> ```

> **15. LazyMotion `domAnimation` doesn't include drag**
>
> If you use `drag`, you need `domMax`, not `domAnimation`.
>
> ```typescript
> // ❌ Drag won't work
> <LazyMotion features={domAnimation}>
>   <m.div drag />  // Throws in strict mode
> </LazyMotion>
>
> // ✅ Correct
> <LazyMotion features={domMax}>
>   <m.div drag />
> </LazyMotion>
> ```

> **16. AnimatePresence with `mode="popLayout"` keeps exiting elements in DOM**
>
> `mode="popLayout"` removes the exiting element from layout but keeps it in the DOM. If you need true cleanup, track the exit animation completion.
>
> ```typescript
> <AnimatePresence
>   mode="popLayout"
>   onExitComplete={() => {
>     // Called when all exits finish
>   }}
> >
>   {items.map((item) => (
>     <motion.div key={item.id} exit={{ opacity: 0 }}>
>       {item.name}
>     </motion.div>
>   ))}
> </AnimatePresence>
> ```

> **17. Gesture props don't stack — last one wins**
>
> If you define both `whileHover` and `animate` on the same element, hover overrides animate. Use variants or explicit conditions to combine gestures.
>
> ```typescript
> // ❌ Hover overwrites animate
> <motion.div animate={{ scale: 1 }} whileHover={{ scale: 1.2 }} />
>
> // ✅ Use variants for clarity
> const variants = {
>   default: { scale: 1 },
>   hovered: { scale: 1.2 }
> }
> <motion.div animate="default" whileHover="hovered" variants={variants} />
> ```

> **18. `layoutId` requires a matching counterpart to transition**
>
> If you use `layoutId="shape"` but only one element has that ID, no animation occurs. Both versions (before/after) must share the same `layoutId`.
>
> ```typescript
> // ✅ Correct — both have same layoutId
> {expanded ? (
>   <motion.div layoutId="shape">Large</motion.div>
> ) : (
>   <motion.div layoutId="shape">Small</motion.div>
> )}
> ```

> **19. Reorder animations require both `layout` and `key`**
>
> When list items reorder, they must have stable `key` props and the parent must have `layout`.
>
> ```typescript
> <motion.div layout>
>   {items.map((item) => (
>     <motion.div key={item.id} layout>
>       {item.name}
>     </motion.div>
>   ))}
> </motion.div>
> ```

> **20. `onDragEnd` is called even if drag distance is zero**
>
> Clicking without dragging still fires `onDragEnd`. Check the info object for velocity/distance.
>
> ```typescript
> <motion.div
>   drag
>   onDragEnd={(event, info) => {
>     if (info.velocity.x === 0 && info.offset.x === 0) {
>       console.log("Clicked without dragging")
>     }
>   }}
> />
> ```

---

## Quick Start Recipe

**Production-grade animated modal with all gotchas handled:**

```typescript
'use client'

import { motion, AnimatePresence } from "motion/react"
import { ReactNode } from "react"

interface AnimatedModalProps {
  isOpen: boolean
  onClose: () => void
  children: ReactNode
}

export function AnimatedModal({ isOpen, onClose, children }: AnimatedModalProps) {
  return (
    <AnimatePresence mode="wait" onExitComplete={onClose}>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            style={{
              position: "fixed",
              inset: 0,
              backgroundColor: "rgba(0, 0, 0, 0.5)",
              zIndex: 40
            }}
          />

          {/* Modal */}
          <motion.div
            key="modal"
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: "spring", bounce: 0.2, duration: 0.3 }}
            style={{
              position: "fixed",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              zIndex: 50,
              backgroundColor: "white",
              borderRadius: 12,
              padding: 24,
              maxWidth: 500,
              width: "90%",
              maxHeight: "90vh",
              overflow: "auto",
              boxShadow: "0 20px 60px rgba(0, 0, 0, 0.3)"
            }}
          >
            {children}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
```

**Usage:**

```typescript
function App() {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      <button onClick={() => setIsOpen(true)}>Open Modal</button>

      <AnimatedModal isOpen={isOpen} onClose={() => setIsOpen(false)}>
        <h2>Animated Modal</h2>
        <p>This modal has smooth entrance and exit animations.</p>
        <button onClick={() => setIsOpen(false)}>Close</button>
      </AnimatedModal>
    </>
  )
}
```

---

## Summary

Motion (successor to Framer Motion) is a powerful, production-ready animation library for React and vanilla JS. Key takeaways:

1. **Package name is `motion`** (not `framer-motion`) — install via `npm install motion`, import from `motion/react`
2. **Use the `layout` prop** for smart position/size animations; always include `key` props for list items
3. **Respect reduced motion** via `useReducedMotion()` or `MotionConfig`; vestibular accessibility matters
4. **Optimize bundle size** with `LazyMotion` + `domAnimation` (~+15kb) or `domMax` (~+25kb)
5. **GPU accelerate** with `x`, `y`, `scale`, `opacity` — avoid animating layout properties
6. **AnimatePresence requires keys** — elements exiting must have unique `key` props
7. **Spring physics are powerful** — tune `stiffness`, `damping`, `bounce` for the feel you want
8. **Use motion values** (`useMotionValue()`) for render-free imperative updates
9. **Scroll tracking** returns normalized 0-1 by default; use `container`/`target` refs for pixel values
10. **Test with real users** — performance, accessibility, and motion sickness are non-negotiable in production

Consult the official Motion docs at **https://motion.dev/docs/react** for the latest updates and advanced features.
