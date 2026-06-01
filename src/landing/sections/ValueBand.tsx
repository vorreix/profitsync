import type { LucideIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Gift, Globe, ShieldCheck, Users } from "lucide-react"
import { Container } from "../components/Container"
import { Reveal } from "../components/Reveal"

type Item = { title: string; desc: string }

const ICONS: LucideIcon[] = [Gift, ShieldCheck, Globe, Users]

// Dark band built from the app's existing tokens: invert background/foreground
// (white ↔ near-black) for a high-contrast section without inventing new colors.
export function ValueBand() {
  const { t } = useTranslation()
  const items = t("value.items", { returnObjects: true }) as Item[]

  return (
    <section id="why" className="py-20 sm:py-28">
      <Container>
        <Reveal>
          <div className="relative overflow-hidden rounded-[2rem] bg-foreground px-6 py-14 text-background sm:px-12 sm:py-16">
            {/* Subtle texture + glow on the dark surface */}
            <div
              aria-hidden
              className="ps-grid pointer-events-none absolute inset-0 text-background/[0.06]"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute -right-20 -top-24 size-80 rounded-full bg-emerald-500/20 blur-3xl"
            />

            <div className="relative mx-auto max-w-2xl text-center">
              <h2 className="ps-display text-balance text-3xl font-bold leading-tight sm:text-4xl">
                {t("value.title")}
              </h2>
              <p className="mt-4 text-pretty text-base text-background/70 sm:text-lg">{t("value.subtitle")}</p>
            </div>

            <div className="relative mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {items.map((item, i) => {
                const Icon = ICONS[i]
                return (
                  <div key={item.title} className="flex flex-col items-start gap-3">
                    <span className="grid size-11 place-items-center rounded-xl bg-background/10 text-background ring-1 ring-background/15">
                      <Icon className="size-5" />
                    </span>
                    <h3 className="ps-display text-base font-semibold">{item.title}</h3>
                    <p className="text-sm leading-relaxed text-background/65">{item.desc}</p>
                  </div>
                )
              })}
            </div>
          </div>
        </Reveal>
      </Container>
    </section>
  )
}
