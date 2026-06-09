import type { ReactNode } from "react"
import { TrendingUp } from "lucide-react"

/**
 * The full-screen onboarding canvas: soft grid + radial glow background, a brand
 * header, and a thin top progress bar. Narrow (max-w-lg) and centered so each step
 * is a single focused, no-scroll screen on mobile. `progress` is 0..1.
 */
export function OnboardingShell({ progress, children }: { progress: number; children: ReactNode }) {
  const pct = Math.max(0, Math.min(1, progress)) * 100
  return (
    <div className="relative min-h-dvh overflow-hidden bg-background text-foreground">
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.4] dark:opacity-[0.25]"
        style={{
          backgroundImage:
            "linear-gradient(to right, color-mix(in oklch, var(--border) 60%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in oklch, var(--border) 60%, transparent) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage: "radial-gradient(ellipse 80% 60% at 50% 0%, black 30%, transparent 75%)",
        }}
      />
      <div className="pointer-events-none absolute -top-32 left-1/2 size-[36rem] -translate-x-1/2 rounded-full bg-gradient-to-b from-primary/10 to-transparent blur-3xl" />

      <div className="relative mx-auto flex min-h-dvh w-full max-w-lg flex-col px-5 pb-[calc(1.25rem_+_env(safe-area-inset-bottom))] pt-[calc(1.25rem_+_env(safe-area-inset-top))] sm:px-6 sm:pt-10">
        <header className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <TrendingUp className="size-4" />
            </div>
            <span className="text-sm font-semibold tracking-tight">ProfitSync</span>
          </div>
          <div className="ml-auto h-1.5 w-24 overflow-hidden rounded-full bg-border sm:w-32" aria-hidden>
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
        </header>
        {children}
      </div>
    </div>
  )
}
