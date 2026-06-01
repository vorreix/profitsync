import { useTranslation } from "react-i18next"
import { ArrowRight, CircleCheckBig, Sparkles } from "lucide-react"
import { Container } from "../components/Container"
import { Button } from "../components/Button"
import { DashboardMockup } from "../components/DashboardMockup"
import { Reveal } from "../components/Reveal"

export function Hero() {
  const { t } = useTranslation()

  return (
    <section className="relative overflow-hidden pt-28 pb-16 sm:pt-32 sm:pb-24 lg:pt-36">
      {/* Background textures (monochrome, theme-aware) */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="ps-grid absolute inset-0 text-foreground/[0.07]" />
        <div className="ps-spotlight absolute inset-0" />
        <div className="absolute -top-24 start-1/2 size-[36rem] -translate-x-1/2 rounded-full bg-emerald-500/[0.06] blur-3xl" />
      </div>

      <Container>
        <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_1fr] lg:gap-10">
          {/* Copy */}
          <div className="flex flex-col items-start">
            <Reveal>
              <span className="inline-flex items-center gap-2 rounded-full border border-border bg-background/70 px-3.5 py-1.5 text-xs font-medium text-foreground/80 shadow-sm backdrop-blur-sm">
                <Sparkles className="size-3.5 text-emerald-500" />
                {t("hero.badge")}
              </span>
            </Reveal>

            <Reveal delay={60}>
              <h1 className="ps-display mt-6 text-balance text-[2.6rem] font-extrabold leading-[1.04] tracking-tight text-foreground sm:text-6xl lg:text-[4rem]">
                {t("hero.titleLine1")}
                <br />
                <span className="bg-gradient-to-br from-foreground to-foreground/55 bg-clip-text text-transparent">
                  {t("hero.titleLine2")}
                </span>
              </h1>
            </Reveal>

            <Reveal delay={120}>
              <p className="mt-6 max-w-xl text-pretty text-lg leading-relaxed text-muted-foreground">
                {t("hero.subtitle")}
              </p>
            </Reveal>

            <Reveal delay={180}>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button href="/signup" size="lg" className="group">
                  {t("hero.ctaPrimary")}
                  <ArrowRight className="size-[18px] transition-transform duration-200 group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" />
                </Button>
                <Button href="#how" variant="outline" size="lg">
                  {t("hero.ctaSecondary")}
                </Button>
              </div>
            </Reveal>

            <Reveal delay={240}>
              <p className="mt-5 inline-flex items-center gap-2 text-sm text-muted-foreground">
                <CircleCheckBig className="size-4 text-emerald-500" />
                {t("hero.microtrust")}
              </p>
            </Reveal>
          </div>

          {/* Product preview */}
          <Reveal delay={120} className="relative">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 -z-10 translate-y-8 scale-95 rounded-[2rem] bg-foreground/5 blur-2xl"
            />
            <DashboardMockup />
          </Reveal>
        </div>
      </Container>
    </section>
  )
}
