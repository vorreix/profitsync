import { useTranslation } from "react-i18next"
import { Container } from "../components/Container"
import { Reveal } from "../components/Reveal"
import { SectionHeading } from "../components/SectionHeading"

type Step = { title: string; desc: string }

export function HowItWorks() {
  const { t } = useTranslation()
  const steps = t("how.steps", { returnObjects: true }) as Step[]

  return (
    <section id="how" className="scroll-mt-24 border-t border-border bg-muted/30 py-20 sm:py-28">
      <Container>
        <SectionHeading eyebrow={t("how.eyebrow")} title={t("how.title")} subtitle={t("how.subtitle")} />

        <div className="relative mt-16">
          {/* Connector line behind the step numbers (desktop) */}
          <div
            aria-hidden
            className="absolute inset-x-0 top-6 hidden h-px bg-gradient-to-r from-transparent via-border to-transparent lg:block"
          />
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
            {steps.map((step, i) => (
              <Reveal key={step.title} delay={i * 90} className="relative flex flex-col items-start">
                <span className="ps-tnum relative z-10 grid size-12 place-items-center rounded-2xl border border-border bg-background text-lg font-bold text-foreground shadow-sm">
                  {i + 1}
                </span>
                <h3 className="ps-display mt-5 text-lg font-semibold text-foreground">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.desc}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </Container>
    </section>
  )
}
