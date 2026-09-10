# AutoAnimate Reference (0.9.0)

AutoAnimate is a zero-config drop-in that automatically animates add/remove/move of immediate children whenever the DOM subtree changes. One line of code, ~3kb, respects `prefers-reduced-motion` by default.

**Install:**
```bash
npm install @formkit/auto-animate
```

---

## What It Is

AutoAnimate observes a parent DOM element and automatically plays smooth transitions whenever:
- **Add:** child elements are inserted into the DOM
- **Remove:** child elements are removed from the DOM
- **Move/remain:** child elements change position or size within the DOM

It uses the **FLIP technique** (First, Last, Invert, Play) via the Web Animations API to achieve this without manual orchestration. The parent element is the **only** reference point—only direct children animate.

---

## React: `useAutoAnimate` Hook

The React integration provides a hook that returns a ref callback and an enable/disable toggle.

```typescript
import { useAutoAnimate } from "@formkit/auto-animate/react";

function MyList() {
  const [parent, enableAnimations] = useAutoAnimate<HTMLUListElement>();
  const [items, setItems] = React.useState([]);

  return (
    <>
      <ul ref={parent}>
        {items.map((item) => (
          <li key={item.id}>{item.name}</li>
        ))}
      </ul>
      <button onClick={() => enableAnimations(false)}>
        Disable animations
      </button>
    </>
  );
}
```

**Hook signature:**
```typescript
function useAutoAnimate<T extends Element>(
  options?: Partial<AutoAnimateOptions> | AutoAnimationPlugin
): [RefCallback<T>, (enabled: boolean) => void]
```

Returns a tuple:
- **`[0]`** — A ref callback. Attach to the parent container whose children change.
- **`[1]`** — A function `(enabled: boolean)` to toggle animations on/off.

**With options:**
```typescript
const [parent, enable] = useAutoAnimate<HTMLUListElement>({
  duration: 300,
  easing: "ease-out",
});

<ul ref={parent}>{items}</ul>
```

> **Gotcha:** The ref callback must be called with an `HTMLElement` instance. If you attach it to a component, nothing happens—use only on DOM elements (`<div>`, `<ul>`, etc.).

### React Keys & Reconciliation

AutoAnimate works **alongside** React's diffing algorithm. React keys determine whether an element is "the same" across renders; AutoAnimate sees the **DOM tree** after React commits.

- If a `<li key="item-1">` moves from index 0 to index 2, AutoAnimate animates the move.
- If you remove `key` and let list items remount, AutoAnimate sees a removal and an add.
- Keying correctly ensures smooth moves; missing keys cause unnecessary add/remove animations.

---

## Preact: `useAutoAnimate` Hook

Preact uses the same hook API as React:

```jsx
import { useAutoAnimate } from "@formkit/auto-animate/preact";

function MyList() {
  const [parentRef] = useAutoAnimate();

  return (
    <ul ref={parentRef}>
      <li>Item 1</li>
      <li>Item 2</li>
      <li>Item 3</li>
    </ul>
  );
}
```

**Hook signature** (same as React):
```typescript
function useAutoAnimate<T extends Element>(
  options?: Partial<AutoAnimateOptions> | AutoAnimationPlugin
): [RefCallback<T>, (enabled: boolean) => void]
```

The Preact integration is fully compatible with the React API—no differences in behavior or signature.

---

## Vue: Directive & Composable

### Vue Directive

The simplest approach: the `v-auto-animate` directive.

```vue
<template>
  <ul v-auto-animate>
    <li v-for="item in items" :key="item.id">{{ item.name }}</li>
  </ul>
</template>

<script setup>
import { ref } from 'vue';
import { vAutoAnimate } from '@formkit/auto-animate/vue';

const items = ref([]);
</script>
```

With options:
```vue
<ul v-auto-animate="{ duration: 500, easing: 'ease-in' }">
  <!-- items -->
</ul>
```

### Vue Composable (`useAutoAnimate`)

For more control, use the composable:

```vue
<template>
  <ul :ref="parent">
    <li v-for="item in items" :key="item.id">{{ item.name }}</li>
  </ul>
  <button @click="toggle">Toggle animations</button>
</template>

<script setup>
import { ref } from 'vue';
import { useAutoAnimate } from '@formkit/auto-animate/vue';

const items = ref([]);
const [parent, toggle] = useAutoAnimate({ duration: 300 });
</script>
```

**Signature:**
```typescript
function useAutoAnimate<T extends Element | Component>(
  options?: Partial<AutoAnimateOptions> | AutoAnimationPlugin
): [Ref<T>, (enabled: boolean) => void]
```

Returns:
- **`[0]`** — A template ref. Use `:ref="parent"` to attach it.
- **`[1]`** — A function to toggle animations.

### Vue Plugin (Global Directive)

Register the directive globally:

```typescript
import { autoAnimatePlugin } from '@formkit/auto-animate/vue';

app.use(autoAnimatePlugin, { duration: 300 }); // optional defaults
```

Then use on any element:
```vue
<ul v-auto-animate>
  <!-- items -->
</ul>
```

---

## Solid: `createAutoAnimate` & Directive

### Solid Primitive

```typescript
import { createAutoAnimate } from '@formkit/auto-animate/solid';

export function MyList() {
  const [setParent, setEnabled] = createAutoAnimate<HTMLUListElement>({
    duration: 250,
  });

  return (
    <>
      <ul ref={setParent}>
        <For each={items()}>
          {(item) => <li>{item.name}</li>}
        </For>
      </ul>
      <button onClick={() => setEnabled(false)}>Disable</button>
    </>
  );
}
```

**Signature:**
```typescript
function createAutoAnimate<T extends HTMLElement>(
  options?: Partial<AutoAnimateOptions> | AutoAnimationPlugin
): [Setter<T | null>, (enabled: boolean) => void]
```

### Solid Directive

AutoAnimate ships as a Solid directive out of the box:

```typescript
import { createAutoAnimateDirective } from '@formkit/auto-animate/solid';

const autoAnimate = createAutoAnimateDirective();

export function MyList() {
  return (
    <ul use:autoAnimate={{ duration: 300 }}>
      <For each={items()}>
        {(item) => <li>{item.name}</li>}
      </For>
    </ul>
  );
}
```

---

## Svelte: `use:autoAnimate` Action

Svelte uses the core `autoAnimate` export as an action via the `use:` directive:

```svelte
<script>
  import autoAnimate from '@formkit/auto-animate';
  let items = [];
</script>

<ul use:autoAnimate={{ duration: 300 }}>
  {#each items as item (item.id)}
    <li>{item.name}</li>
  {/each}
</ul>
```

The action accepts `Partial<AutoAnimateOptions>` as its parameter and automatically cleans up when the component unmounts. Svelte has access to the **only framework where `AnimationController.destroy()` is called automatically** — the action's destroy lifecycle hook handles cleanup.

---

## Angular: Directive & Module

### Angular Directive (Standalone & Module)

Apply the `auto-animate` directive to any element:

```angular
<ul auto-animate [options]="{ duration: 300 }">
  <li *ngFor="let item of items">{{ item.name }}</li>
</ul>
```

**Module registration** (for Angular < 16):

```typescript
import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';
import { AppComponent } from './app.component';
import { AutoAnimateModule } from '@formkit/auto-animate/angular';

@NgModule({
  declarations: [AppComponent],
  imports: [BrowserModule, AutoAnimateModule],
  providers: [],
  bootstrap: [AppComponent],
})
export class AppModule {}
```

**Standalone component** (Angular 16+):

```typescript
import { Component } from '@angular/core';
import { AutoAnimateDirective } from '@formkit/auto-animate/angular';

@Component({
  selector: 'app-list',
  template: `
    <ul auto-animate [options]="animateOptions">
      <li *ngFor="let item of items">{{ item.name }}</li>
    </ul>
  `,
  standalone: true,
  directives: [AutoAnimateDirective],
})
export class ListComponent {
  items = ['Item 1', 'Item 2'];
  animateOptions = { duration: 300, easing: 'ease-out' };
}
```

**Directive signature:**
```typescript
interface AutoAnimateDirective {
  options?: Partial<AutoAnimateOptions>;
}
```

The directive uses the `[options]` input property to configure animations.

---

## Vanilla / Plain JavaScript

The core function works anywhere without framework dependencies:

```typescript
import autoAnimate from '@formkit/auto-animate';

const listEl = document.querySelector('ul');
const controller = autoAnimate(listEl, { duration: 300 });

// Later: disable or enable
controller.disable();
controller.enable();
```

---

## Configuration: `AutoAnimateOptions`

Pass an options object to customize animations:

```typescript
interface AutoAnimateOptions {
  /**
   * Duration of a single animation sequence in milliseconds.
   * Default: 250
   */
  duration: number;

  /**
   * CSS easing string.
   * Default: "ease-in-out"
   * Supports: "linear", "ease-in", "ease-out", "ease-in-out", or any valid CSS easing
   */
  easing:
    | "linear"
    | "ease-in"
    | "ease-out"
    | "ease-in-out"
    | ({} & string); // allows custom easing like "cubic-bezier(...)"

  /**
   * If true, animations play even if the user has set prefers-reduced-motion: reduce.
   * Default: false (respects user preference)
   * Not recommended to override.
   */
  disrespectUserMotionPreference?: boolean;
}
```

**Usage:**

```typescript
// React
const [parent, enable] = useAutoAnimate({
  duration: 400,
  easing: "cubic-bezier(0.4, 0, 0.2, 1)",
});

// Vue directive
<ul v-auto-animate="{ duration: 500, easing: 'ease-out' }"></ul>

// Vanilla
autoAnimate(el, { duration: 300, easing: "linear" });
```

### Respecting `prefers-reduced-motion`

By default, AutoAnimate disables animations if the user has set `prefers-reduced-motion: reduce` in their OS settings. **Do not override this** unless there's a strong user-facing reason.

```typescript
// Disabled by default if prefers-reduced-motion is set
const [parent, enable] = useAutoAnimate({ duration: 300 });

// Override (NOT RECOMMENDED)
const [parent, enable] = useAutoAnimate({
  duration: 300,
  disrespectUserMotionPreference: true,
});
```

---

## Custom Animations: Plugins

Instead of built-in animations, you can provide a custom animation function. Pass a **function** as the second argument (instead of options).

```typescript
interface AutoAnimationPlugin {
  (
    el: Element,
    action: "add" | "remove" | "remain",
    newCoordinates?: Coordinates,
    oldCoordinates?: Coordinates
  ): KeyframeEffect | [KeyframeEffect, AutoAnimationPluginOptions];
}

interface Coordinates {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface AutoAnimationPluginOptions {
  /**
   * Custom CSS styles or false to disable the default style reset
   */
  styleReset: CSSStyleDeclaration | false;
}
```

**Action-specific behavior:**
- **`"add"`** — Element is inserted. Receives `newCoordinates` only (element's final position). `oldCoordinates` is `undefined`.
- **`"remove"`** — Element is deleted. Receives `oldCoordinates` only (element's position before removal). `newCoordinates` is `undefined`.
- **`"remain"`** — Element moves or resizes. Receives both `oldCoordinates` (before mutation) and `newCoordinates` (after mutation).

**Plugin example:**

```typescript
import autoAnimate from '@formkit/auto-animate';

const customPlugin = (
  el: Element,
  action: 'add' | 'remove' | 'remain',
  newCoords?: { top: number; left: number; width: number; height: number },
  oldCoords?: { top: number; left: number; width: number; height: number }
): KeyframeEffect => {
  if (action === 'add') {
    // Element is being added; newCoords is the final position
    return new KeyframeEffect(el, [
      { opacity: 0, transform: 'rotateZ(0deg)' },
      { opacity: 1, transform: 'rotateZ(360deg)' },
    ], { duration: 600 });
  }

  if (action === 'remove') {
    // Element is being removed; oldCoords is the position before removal
    return new KeyframeEffect(el, [
      { opacity: 1, transform: 'scale(1)' },
      { opacity: 0, transform: 'scale(0)' },
    ], { duration: 400 });
  }

  // remain: element moved or resized
  // Both oldCoords and newCoords are available
  if (oldCoords && newCoords) {
    const deltaX = oldCoords.left - newCoords.left;
    const deltaY = oldCoords.top - newCoords.top;
    return new KeyframeEffect(el, [
      { transform: `translate(${deltaX}px, ${deltaY}px)` },
      { transform: 'translate(0, 0)' },
    ], { duration: 300, easing: 'ease-out' });
  }

  return new KeyframeEffect(el, [], {});
};

const controller = autoAnimate(parentEl, customPlugin);
```

**React:**
```typescript
const customPlugin = (el, action, newCoords, oldCoords) => {
  // ... same plugin function
};

const [parent] = useAutoAnimate(customPlugin);
```

**Returning a tuple** — to customize the style reset on removal:

```typescript
const customPlugin = (el, action, newCoords, oldCoords) => {
  if (action === 'remove') {
    const keyframes = new KeyframeEffect(el, [
      { opacity: 1 },
      { opacity: 0 },
    ], { duration: 300 });

    return [
      keyframes,
      {
        styleReset: {
          position: 'absolute',
          top: '0',
          left: '0',
          zIndex: '1000',
        } as Partial<CSSStyleDeclaration>,
      },
    ];
  }

  return new KeyframeEffect(el, [], {});
};
```

> **Gotcha:** The `oldCoords` parameter is **only** provided for the `"remain"` action. `"add"` receives `newCoords` only; `"remove"` receives `oldCoords` only (the position before removal). Always guard against `undefined` when accessing coordinates.

---

## Built-in Animations

### Default "Add" Animation
```
Scale: 0.98 → 1
Opacity: 0 → 1
Duration: 1.5x the configured duration
Easing: ease-in
```

### Default "Remove" Animation
```
Scale: 1 → 0.98
Opacity: 1 → 0
Duration: configured duration
Easing: ease-out
```

The removed element is repositioned to `position: absolute` so it animates in place while other elements shift.

### Default "Remain" (Move/Resize) Animation
```
Transform: translate from old position to new position, scale if size changed
Duration: configured duration
Easing: configured easing
```

Uses FLIP to avoid layout thrashing.

---

## AnimationController API

The `autoAnimate()` function returns an `AnimationController`. Framework hooks return different structures but expose similar methods.

**Vanilla / Framework-agnostic interface:**
```typescript
interface AnimationController {
  readonly parent: Element;
  enable(): void;
  disable(): void;
  isEnabled(): boolean;
  destroy?(): void; // Svelte only
}
```

**Methods:**

- **`enable()`** — Re-enable animations on this parent.
- **`disable()`** — Turn off animations (in-flight animations are cancelled).
- **`isEnabled()`** — Check if animations are currently active.
- **`destroy()`** — *Svelte-specific.* Fully clean up observers and stop all animations. Automatically called by Svelte's action lifecycle. For other frameworks, call manually on component unmount if needed (though most frameworks handle this implicitly).

**Example (Vanilla):**

```typescript
const controller = autoAnimate(el, { duration: 300 });

// Later
if (someCondition) {
  controller.disable();
}

controller.enable(); // re-enable

console.log(controller.isEnabled()); // true
```

> **Note:** React, Vue, Preact, Solid, and Angular frameworks handle lifecycle cleanup automatically. Only Svelte exposes `destroy()` directly in the action's return object. For vanilla JavaScript, manually call `destroy()` if you need to fully clean up before the element is removed from the DOM.

---

## How It Works: FLIP + Web Animations API

AutoAnimate uses the FLIP technique internally:

1. **First:** before a mutation, capture the position/size of all children.
2. **Last:** after a mutation, capture the new position/size.
3. **Invert:** calculate the delta (old position − new position).
4. **Play:** animate from the inverted position back to the final position.

This avoids expensive layout thrashing and works correctly even with complex CSS transforms.

The library uses the **Web Animations API** (`Element.animate()`) and `KeyframeEffect` under the hood, making animations GPU-accelerated and cancellable.

---

## Constraints & Gotchas

### 1. **Animates Direct Children Only**

AutoAnimate watches **only the immediate children** of the parent element. Nested changes inside grandchildren do not trigger animations.

```html
<!-- This animates -->
<ul ref={parent}>
  <li>Item 1</li>  <!-- add/remove/move this -->
  <li>Item 2</li>
</ul>

<!-- This does NOT animate -->
<div ref={parent}>
  <section>
    <div>Deep child</div>  <!-- changes here are ignored -->
  </section>
</div>
```

If you need to animate nested children, wrap them with their own parent ref:
```tsx
<div ref={parentA}>
  <section ref={parentB}>
    <div>Deep child</div>  <!-- now animates -->
  </section>
</div>
```

### 2. **Does Not Animate Content Changes**

AutoAnimate only reacts to **DOM mutations** (add/remove/move). Changing text, attributes, or inline styles within a child does **not** trigger an animation.

```tsx
// This does NOT animate
<ul ref={parent}>
  <li>{count}</li>  <!-- changing count updates text, no animation -->
</ul>

// This DOES animate
<ul ref={parent}>
  {items.map(item => <li key={item.id}>{item.name}</li>)}
  {/* adding/removing li elements animates */}
</ul>
```

### 3. **One Parent Ref Per Container**

Do not attach the same parent ref to multiple elements. Each container must have its own controller.

```tsx
// ✅ Correct
const [parent1, enable1] = useAutoAnimate();
const [parent2, enable2] = useAutoAnimate();

<ul ref={parent1}>{items1}</ul>
<ul ref={parent2}>{items2}</ul>

// ❌ Wrong: both lists try to use the same controller
const [parent, enable] = useAutoAnimate();
<ul ref={parent}>{items1}</ul>
<ul ref={parent}>{items2}</ul>
```

### 4. **Avoid Extra Layout Wrappers**

Extra `<div>` elements between the parent and children can interfere with animation calculations. Keep the DOM structure flat:

```tsx
// ✅ Correct: direct children
<ul ref={parent}>
  <li>Item 1</li>
  <li>Item 2</li>
</ul>

// ⚠️ Risky: extra wrapper
<ul ref={parent}>
  <div>  {/* extra wrapper */}
    <li>Item 1</li>
  </div>
</ul>
```

### 5. **React Keys & Reconciliation**

Keys determine React's DOM reconciliation. Without keys, list items remount instead of moving:

```tsx
// ✅ Correct: animations move items
<ul ref={parent}>
  {items.map(item => <li key={item.id}>{item.name}</li>)}
</ul>

// ❌ Wrong: no keys, items remount (remove + add)
<ul ref={parent}>
  {items.map((item, i) => <li key={i}>{item.name}</li>)}
</ul>
```

### 6. **List Virtualization & Offscreen Elements**

AutoAnimate skips animations for elements outside the viewport to avoid unnecessary work. If you're using a virtual scroller (`react-window`, `react-virtualized`), animations only play for visible items.

### 7. **Memoize Options to Avoid Recreating Controllers**

In React, passing inline options creates a new object every render, which can reset the controller:

```tsx
// ❌ Wrong: options recreated every render
const [parent] = useAutoAnimate({ duration: 300 });

// ✅ Correct: options are stable
const options = useMemo(() => ({ duration: 300 }), []);
const [parent] = useAutoAnimate(options);
```

The hook internally memoizes options, but this is good practice.

### 8. **Stale Closures in Custom Plugins**

If your plugin function references external state, be careful about stale closures:

```tsx
// ⚠️ Risky: `duration` may be stale
const duration = 300;
const [parent] = useAutoAnimate((el, action) => {
  return new KeyframeEffect(el, [...], { duration }); // stale?
});

// ✅ Better: re-create the plugin when duration changes
const plugin = useCallback(
  (el, action) => {
    return new KeyframeEffect(el, [...], { duration });
  },
  [duration]
);
const [parent] = useAutoAnimate(plugin);
```

### 9. **Position Static on Parent**

AutoAnimate sets `position: relative` on the parent if it's `static`. This prevents layout issues but can affect styling. Use CSS to override:

```css
.my-list {
  position: relative; /* AutoAnimate may set this */
}
```

### 10. **Scroll Adjustment on Removal**

When an element is removed at the bottom of the page, AutoAnimate adjusts the window scroll to keep content in place. This matches user expectations but can interact unexpectedly with smooth scroll behavior.

### 11. **Duration and Easing Defaults**

The default duration is **250ms**. For complex animations or longer sequences, increase the duration:

```typescript
const [parent] = useAutoAnimate({ duration: 500 }); // slower
```

Choose easing based on the animation's purpose:
- **`ease-out`** — natural, decelerating (good for enter/exit)
- **`ease-in`** — accelerating (good for exit → new state)
- **`ease-in-out`** — smooth both directions (default, safest)
- **`linear`** — constant speed (rarely needed)

---

## When to Use AutoAnimate vs. Framer Motion

| Scenario | AutoAnimate | Framer Motion |
|----------|-------------|---------------|
| Simple add/remove/move animations | ✅ Perfect | Overkill |
| List filtering/sorting | ✅ Perfect | Overkill |
| Layout changes on grid/flex | ✅ Perfect | Overkill |
| Gesture-driven animations | ❌ No | ✅ Yes |
| Shared-element transitions | ❌ No | ✅ Yes |
| Exit choreography | ❌ Limited | ✅ Yes |
| Spring physics | ❌ No | ✅ Yes |
| Scroll-linked animations | ❌ No | ✅ Yes |
| Page transitions | ❌ No | ✅ Yes |
| Fine-grained animation control | ❌ No | ✅ Yes |

**Decision:**
- **Use AutoAnimate** if you just want DOM-change motion with zero effort and no orchestration.
- **Use Framer Motion** if you need gestures, advanced choreography, physics, or scroll/drag interactions.

AutoAnimate is lighter (3kb vs 50kb+) and requires **zero configuration**—perfect for adding motion to list/grid updates. Framer Motion is a full animation engine for building interactive experiences.

---

## Installation & Setup Summary

```bash
npm install @formkit/auto-animate
```

**React:**
```typescript
import { useAutoAnimate } from "@formkit/auto-animate/react";
const [parent, enable] = useAutoAnimate();
<div ref={parent}>{children}</div>
```

**Preact:**
```typescript
import { useAutoAnimate } from "@formkit/auto-animate/preact";
const [parent, enable] = useAutoAnimate();
<div ref={parent}>{children}</div>
```

**Vue:**
```typescript
import { vAutoAnimate } from "@formkit/auto-animate/vue";
// or use composable: useAutoAnimate
```

**Solid:**
```typescript
import { createAutoAnimate } from "@formkit/auto-animate/solid";
const [setParent, setEnabled] = createAutoAnimate();
```

**Svelte:**
```typescript
import autoAnimate from "@formkit/auto-animate";
<div use:autoAnimate>{children}</div>
```

**Angular:**
```typescript
import { AutoAnimateDirective } from "@formkit/auto-animate/angular";
// Use: <div auto-animate [options]="{ duration: 300 }"></div>
```

**Vanilla:**
```typescript
import autoAnimate from "@formkit/auto-animate";
const controller = autoAnimate(element, options);
```

---

## Common Patterns

### Filtered List (React)

```tsx
import { useAutoAnimate } from "@formkit/auto-animate/react";
import { useState } from "react";

export function FilteredList({ items }) {
  const [parent] = useAutoAnimate();
  const [filter, setFilter] = useState("");

  const filtered = items.filter(item =>
    item.name.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <>
      <input
        placeholder="Filter..."
        value={filter}
        onChange={e => setFilter(e.target.value)}
      />
      <ul ref={parent}>
        {filtered.map(item => (
          <li key={item.id}>{item.name}</li>
        ))}
      </ul>
    </>
  );
}
```

### Sorted List (Vue)

```vue
<template>
  <button @click="sort">Sort A–Z</button>
  <ul v-auto-animate="{ duration: 300 }">
    <li v-for="item in sorted" :key="item.id">{{ item.name }}</li>
  </ul>
</template>

<script setup>
import { ref, computed } from "vue";
import { vAutoAnimate } from "@formkit/auto-animate/vue";

const items = ref([...]);
const sorted = computed(() => [...items.value].sort((a, b) => a.name.localeCompare(b.name)));

function sort() {
  items.value = [...items.value].reverse();
}
</script>
```

### Custom Add Animation (Vanilla)

```typescript
import autoAnimate from "@formkit/auto-animate";

const customPlugin = (el, action) => {
  if (action === "add") {
    return new KeyframeEffect(
      el,
      [
        { opacity: 0, transform: "translateY(-20px)" },
        { opacity: 1, transform: "translateY(0)" },
      ],
      { duration: 500, easing: "ease-out" }
    );
  }
  return new KeyframeEffect(el, [], {});
};

const controller = autoAnimate(listEl, customPlugin);
```

---

## Browser Support

AutoAnimate requires:
- **Web Animations API** (all modern browsers)
- **ResizeObserver** (all modern browsers)
- **MutationObserver** (all modern browsers)

Supported:
- Chrome/Edge 75+
- Firefox 63+
- Safari 13.1+
- iOS Safari 13.4+

**Not supported:** IE 11 (no fallback).

---

## Troubleshooting

### Animations not playing

1. **Check `prefers-reduced-motion`:** OS accessibility settings disable animations by default.
   ```javascript
   controller.isEnabled(); // should be true
   ```

2. **Verify ref is attached:** the ref must point to an `HTMLElement`.
   ```tsx
   <div ref={parent}>{children}</div> // ✅
   <Component ref={parent} /> // ❌
   ```

3. **Check for async rendering:** if children render asynchronously, AutoAnimate may miss the mutation. Use a key to force React to treat items distinctly.

### Scroll jumps on removal

AutoAnimate adjusts scroll when removing elements at the page bottom. If this is unwanted, disable it via a custom plugin that returns `styleReset: false`.

### Performance issues

- Avoid animating hundreds of items at once. AutoAnimate tracks every mutation.
- Use list virtualization for large lists.
- Disable animations in performance-critical sections with `controller.disable()`.

### Stale animations

If animations appear to pause or stall, check:
- Is the parent still in the DOM?
- Did you call `controller.destroy()` (Svelte only)?
- Are there errors in the console?

---

## API Reference (Complete)

### Core Function
```typescript
function autoAnimate(
  el: HTMLElement,
  config?: Partial<AutoAnimateOptions> | AutoAnimationPlugin
): AnimationController
```

### React Hook
```typescript
function useAutoAnimate<T extends Element>(
  options?: Partial<AutoAnimateOptions> | AutoAnimationPlugin
): [RefCallback<T>, (enabled: boolean) => void]
```

### Preact Hook
```typescript
function useAutoAnimate<T extends Element>(
  options?: Partial<AutoAnimateOptions> | AutoAnimationPlugin
): [RefCallback<T>, (enabled: boolean) => void]
```

### Vue Composable
```typescript
function useAutoAnimate<T extends Element | Component>(
  options?: Partial<AutoAnimateOptions> | AutoAnimationPlugin
): [Ref<T>, (enabled: boolean) => void]
```

### Vue Directive
```typescript
const vAutoAnimate: Directive<HTMLElement, Partial<AutoAnimateOptions>>
function createVAutoAnimate(
  defaults?: Partial<AutoAnimateOptions> | AutoAnimationPlugin
): Directive<...>
```

### Solid Primitive
```typescript
function createAutoAnimate<T extends HTMLElement>(
  options?: Partial<AutoAnimateOptions> | AutoAnimationPlugin
): [Setter<T | null>, (enabled: boolean) => void]
```

### Solid Directive
```typescript
function createAutoAnimateDirective(): DirectiveFn
```

### Svelte Action
```typescript
export default function autoAnimate(
  node: HTMLElement,
  options?: Partial<AutoAnimateOptions> | AutoAnimationPlugin
): { destroy(): void; update?(params: any): void }
```

### Angular Directive
```typescript
@Directive({
  selector: '[auto-animate]',
  standalone: true,
})
export class AutoAnimateDirective {
  options?: Partial<AutoAnimateOptions>;
}
```

### Options Interface
```typescript
interface AutoAnimateOptions {
  duration: number; // ms, default 250
  easing: string; // CSS easing, default "ease-in-out"
  disrespectUserMotionPreference?: boolean; // default false
}
```

### Plugin Interface
```typescript
type AutoAnimationPlugin = (
  el: Element,
  action: "add" | "remove" | "remain",
  newCoordinates?: Coordinates,
  oldCoordinates?: Coordinates
) => KeyframeEffect | [KeyframeEffect, AutoAnimationPluginOptions];

interface AutoAnimationPluginOptions {
  styleReset: CSSStyleDeclaration | false;
}

interface Coordinates {
  top: number;
  left: number;
  width: number;
  height: number;
}
```

### Controller Interface
```typescript
interface AnimationController<P = unknown> {
  readonly parent: Element;
  enable(): void;
  disable(): void;
  isEnabled(): boolean;
  destroy?(): void; // Svelte only
}
```

---

## Version Notes

This reference covers **@formkit/auto-animate@0.9.0**.

Recent versions:
- **0.9.0** (current) — stable, mature API.
- **0.8.x** — previous stable release.
- **1.0.0-beta** — experimental, API may change.

No breaking changes are anticipated in 0.9.x. The package is production-ready.
