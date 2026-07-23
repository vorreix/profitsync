import { useId, type CSSProperties, type Ref } from "react"
import { cn } from "@/lib/utils"

/**
 * The AI "energy orb": a dark glass sphere wrapped by slowly-drifting silk
 * ribbons of emerald-green light (gold for the free plan). Pure CSS/SVG — flattened
 * ellipse rings, each tilted in 3D and spinning very slowly in its own plane,
 * screen-blended so crossings brighten. All motion is compositor-only; styles
 * live in index.css under "AI energy orb".
 *
 * Modes: `idle` (slow drift — the persistent trigger), `listening` (adds a
 * ~3s breath; drive `--ai-orb-level` 0..1 imperatively on the root element
 * from the mic meter for glow + scale), `thinking` (adds a stage swirl +
 * halo pulse while the server works).
 */
export function AiOrb({ size = 44, mode = "idle", gold = false, className, ref }: {
  size?: number
  mode?: "idle" | "listening" | "thinking"
  gold?: boolean
  className?: string
  ref?: Ref<HTMLDivElement>
}) {
  // Namespace the SVG defs — the trigger and the overlay orb coexist.
  const uid = useId()
  const g1 = `${uid}-g1`
  const g2 = `${uid}-g2`
  const b1 = `${uid}-b1`
  const b2 = `${uid}-b2`

  const ribbons: Array<{ rx: number; ry: number; w: number; grad: string; blur: string }> = [
    { rx: 46, ry: 20, w: 7, grad: g1, blur: b1 },
    { rx: 47, ry: 26, w: 5.5, grad: g2, blur: b1 },
    { rx: 45, ry: 17, w: 9, grad: g1, blur: b2 },
    { rx: 47, ry: 30, w: 5, grad: g2, blur: b1 },
    { rx: 44, ry: 22, w: 8, grad: g1, blur: b2 },
  ]

  return (
    <div
      ref={ref}
      aria-hidden
      className={cn(
        "ai-orb",
        gold && "ai-orb-gold",
        mode === "listening" && "ai-orb-listening",
        mode === "thinking" && "ai-orb-thinking",
        className,
      )}
      style={{ "--ai-orb-size": `${size}px` } as CSSProperties}
    >
      <svg width="0" height="0" className="absolute">
        <defs>
          {/* var() is invalid inside SVG presentation attributes — stop
              colors go through inline style so the gold accent swap works */}
          <linearGradient id={g1} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style={{ stopColor: "rgb(var(--ai-orb-c1))", stopOpacity: 0 }} />
            <stop offset="22%" style={{ stopColor: "rgb(var(--ai-orb-c2))", stopOpacity: 0.55 }} />
            <stop offset="50%" style={{ stopColor: "rgb(var(--ai-orb-c3))", stopOpacity: 0.85 }} />
            <stop offset="78%" style={{ stopColor: "rgb(var(--ai-orb-c1))", stopOpacity: 0.5 }} />
            <stop offset="100%" style={{ stopColor: "rgb(var(--ai-orb-c1))", stopOpacity: 0 }} />
          </linearGradient>
          <linearGradient id={g2} x1="100%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" style={{ stopColor: "rgb(var(--ai-orb-c1))", stopOpacity: 0 }} />
            <stop offset="30%" style={{ stopColor: "rgb(var(--ai-orb-c1))", stopOpacity: 0.5 }} />
            <stop offset="55%" style={{ stopColor: "rgb(var(--ai-orb-c3))", stopOpacity: 0.75 }} />
            <stop offset="80%" style={{ stopColor: "rgb(var(--ai-orb-c2))", stopOpacity: 0.45 }} />
            <stop offset="100%" style={{ stopColor: "rgb(var(--ai-orb-c1))", stopOpacity: 0 }} />
          </linearGradient>
          <filter id={b1} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="2.2" />
          </filter>
          <filter id={b2} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="3.8" />
          </filter>
        </defs>
      </svg>
      <div className="ai-orb-stage">
        {ribbons.map((r, i) => (
          <div
            key={i}
            className={`ai-orb-rib ai-orb-rib-${i + 1}`}
            // Start each ribbon mid-flight so the pose is balanced from the
            // first frame (and stays balanced when reduced-motion pauses it).
            style={{ animationDelay: `-${(i + 1) * 5.3}s` }}
          >
            <svg viewBox="0 0 100 100">
              <ellipse cx="50" cy="50" rx={r.rx} ry={r.ry} fill="none" stroke={`url(#${r.grad})`} strokeWidth={r.w} filter={`url(#${r.blur})`} />
            </svg>
          </div>
        ))}
      </div>
    </div>
  )
}
