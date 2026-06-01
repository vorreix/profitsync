import { useTranslation } from "react-i18next"
import { ArrowRight, CircleCheckBig } from "lucide-react"
import { Container } from "../components/Container"
import { Button } from "../components/Button"
import { Reveal } from "../components/Reveal"

export function CTA() {
  const { t } = useTranslation()

  return (
    <section id="get-started" className="py-20 sm:py-28">
      <Container>
        <Reveal>
          <div className="relative overflow-hidden rounded-[2rem] border border-border bg-card px-6 py-16 text-center shadow-sm sm:px-12 sm:py-20">
            <div aria-hidden className="pointer-events-none absolute inset-0">
              <div className="ps-grid absolute inset-0 text-foreground/[0.06]" />
              <div className="absolute -bottom-24 start-1/2 size-[30rem] -translate-x-1/2 rounded-full bg-emerald-500/[0.07] blur-3xl" />
            </div>

            <div className="relative mx-auto max-w-2xl">
              <h2 className="ps-display text-balance text-3xl font-bold leading-[1.1] text-foreground sm:text-[2.75rem]">
                {t("cta.title")}
              </h2>
              <p className="mx-auto mt-5 max-w-xl text-pretty text-base text-muted-foreground sm:text-lg">
                {t("cta.subtitle")}
              </p>
              <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <Button href="/signup" size="lg" className="group">
                  {t("cta.primary")}
                  <ArrowRight className="size-[18px] transition-transform duration-200 group-hover:translate-x-0.5 rtl:rotate-180 rtl:group-hover:-translate-x-0.5" />
                </Button>
                <Button href="#features" variant="outline" size="lg">
                  {t("cta.secondary")}
                </Button>
              </div>
              <p className="mt-6 inline-flex items-center gap-2 text-sm text-muted-foreground">
                <CircleCheckBig className="size-4 text-emerald-500" />
                {t("cta.microtrust")}
              </p>
            </div>
          </div>
        </Reveal>
      </Container>
    </section>
  )
}
