import type { LucideIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Home, HandCoins, Lock, Crown } from "lucide-react"
import { Container } from "../components/Container"
import { Reveal } from "../components/Reveal"
import { Button } from "../components/Button"

type Item = { title: string; desc: string }

const ICONS: LucideIcon[] = [Home, HandCoins, Lock, Crown]

// "Built for your whole family" — the third pillar alongside personal & business.
// Reuses the existing landing tokens/components (Container + Reveal) so it sits
// naturally in the page and inherits the design system.
export function Family() {
  const { t } = useTranslation()
  const items = t("familyLanding.items", { returnObjects: true }) as Item[]

  return (
    <section id="family" className="py-20 sm:py-28">
      <Container>
        <Reveal>
          <div className="mx-auto max-w-2xl text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-500/10 px-3 py-1 text-xs font-medium text-rose-700 ring-1 ring-rose-500/20 dark:text-rose-300">
              {t("familyLanding.badge")}
            </span>
            <h2 className="ps-display mt-4 text-balance text-3xl font-bold leading-tight sm:text-4xl">
              {t("familyLanding.title")}
            </h2>
            <p className="mt-4 text-pretty text-base text-muted-foreground sm:text-lg">{t("familyLanding.subtitle")}</p>
          </div>
        </Reveal>

        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {items.map((item, i) => {
            const Icon = ICONS[i]
            return (
              <Reveal key={item.title} delay={i * 80}>
                <div className="flex h-full flex-col items-start gap-3 rounded-2xl border bg-card p-5">
                  <span className="grid size-11 place-items-center rounded-xl bg-rose-500/10 text-rose-600 ring-1 ring-rose-500/15 dark:text-rose-300">
                    {Icon && <Icon className="size-5" />}
                  </span>
                  <h3 className="ps-display text-base font-semibold">{item.title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{item.desc}</p>
                </div>
              </Reveal>
            )
          })}
        </div>

        <Reveal delay={120}>
          <div className="mt-10 text-center">
            <Button href="/signup" size="lg">
              {t("familyLanding.cta")}
            </Button>
          </div>
        </Reveal>
      </Container>
    </section>
  )
}
